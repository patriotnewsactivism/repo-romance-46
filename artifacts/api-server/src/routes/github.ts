import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "../lib/async-handler";
import { makeState } from "../lib/github-state";

const router: IRouter = Router();

const GH_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "repo-finisher",
});

router.get(
  "/github/oauth/start",
  requireAuth,
  asyncHandler(async (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      throw Object.assign(new Error("GitHub OAuth not configured yet. Add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET secrets."), { status: 400 });
    }
    const state = makeState(req.userId!);
    const host = (req.headers["x-forwarded-host"] as string) ?? req.headers.host ?? "";
    const proto = (req.headers["x-forwarded-proto"] as string) ?? "https";
    const origin = process.env.APP_ORIGIN ?? (host ? `${proto}://${host}` : "");
    const redirectUri = `${origin}/api/public/github/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "read:user repo",
      state,
      allow_signup: "false",
    });
    res.json({ url: `https://github.com/login/oauth/authorize?${params}` });
  }),
);

router.get(
  "/github/status",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { data } = await req.supabase!
      .from("github_connections")
      .select("github_login, connected_at")
      .eq("user_id", req.userId!)
      .maybeSingle();
    res.json({
      connected: !!data,
      login: data?.github_login ?? null,
      connected_at: data?.connected_at ?? null,
    });
  }),
);

router.post(
  "/github/disconnect",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { error } = await req.supabase!.from("github_connections").delete().eq("user_id", req.userId!);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  }),
);

router.get(
  "/github/portfolio-summary",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { data: conn } = await req.supabase!
      .from("github_connections")
      .select("access_token, github_login")
      .eq("user_id", req.userId!)
      .maybeSingle();
    if (!conn) return void res.json({ connected: false, summary: null });

    const token = conn.access_token;
    const ghRes = await fetch("https://api.github.com/user/repos?per_page=100&affiliation=owner&sort=pushed", {
      headers: GH_HEADERS(token),
    });
    if (!ghRes.ok) return void res.json({ connected: true, summary: null });
    const repos = (await ghRes.json()) as Array<{
      name: string;
      full_name: string;
      language: string | null;
      stargazers_count: number;
      fork: boolean;
      archived: boolean;
      pushed_at: string;
      size: number;
      description: string | null;
    }>;

    const active = repos.filter((r) => !r.fork && !r.archived);
    const now = Date.now();
    const sixMonthsAgo = now - 180 * 24 * 60 * 60 * 1000;

    const langCounts: Record<string, number> = {};
    let totalStars = 0;
    let totalSize = 0;
    let dormant = 0;
    let mostRecent = "";

    for (const r of active) {
      if (r.language) langCounts[r.language] = (langCounts[r.language] ?? 0) + 1;
      totalStars += r.stargazers_count;
      totalSize += r.size;
      if (new Date(r.pushed_at).getTime() < sixMonthsAgo) dormant++;
      if (!mostRecent || r.pushed_at > mostRecent) mostRecent = r.pushed_at;
    }

    const topLangs = Object.entries(langCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count, pct: Math.round((count / active.length) * 100) }));

    res.json({
      connected: true,
      summary: {
        login: conn.github_login,
        totalRepos: active.length,
        totalStars,
        dormantCount: dormant,
        avgSizeKb: active.length ? Math.round(totalSize / active.length) : 0,
        topLanguages: topLangs,
        mostRecentPush: mostRecent,
      },
    });
  }),
);

router.get(
  "/github/repo-health",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { repo } = z.object({ repo: z.string() }).parse(req.query);

    const { data: conn } = await req.supabase!
      .from("github_connections")
      .select("access_token")
      .eq("user_id", req.userId!)
      .maybeSingle();
    if (!conn) throw Object.assign(new Error("Connect GitHub first."), { status: 400 });
    const token = conn.access_token;
    const headers = GH_HEADERS(token);

    const repoRes = await fetch(`https://api.github.com/repos/${repo}`, { headers });
    if (!repoRes.ok) throw new Error(`Repo not found: ${repo}`);
    const repoData = (await repoRes.json()) as Record<string, unknown>;

    let hasCI = false;
    let ciProvider: string | null = null;
    try {
      const wfRes = await fetch(`https://api.github.com/repos/${repo}/contents/.github/workflows`, { headers });
      if (wfRes.ok) {
        const workflows = (await wfRes.json()) as Array<Record<string, unknown>>;
        if (workflows.length > 0) {
          hasCI = true;
          ciProvider = "GitHub Actions";
        }
      }
    } catch {
      /* ignore */
    }

    let license: string | null = null;
    try {
      const licRes = await fetch(`https://api.github.com/repos/${repo}/license`, { headers });
      if (licRes.ok) {
        const lic = (await licRes.json()) as Record<string, { spdx_id?: string }>;
        license = lic.license?.spdx_id ?? null;
      }
    } catch {
      /* ignore */
    }

    let hasTests = false;
    try {
      const treeRes = await fetch(
        `https://api.github.com/repos/${repo}/git/trees/${repoData.default_branch as string}?recursive=1`,
        { headers },
      );
      if (treeRes.ok) {
        const tree = (await treeRes.json()) as { tree: Array<{ path: string }> };
        hasTests = tree.tree.some((t) => /test|spec|__tests__|\.test\.|\.spec\./i.test(t.path));
      }
    } catch {
      /* ignore */
    }

    let score = 0;
    const factors: { name: string; status: boolean; weight: number }[] = [];

    const hasReadme = !!repoData.description;
    factors.push({ name: "Has description", status: hasReadme, weight: 10 });
    if (hasReadme) score += 10;

    factors.push({ name: "CI configured", status: hasCI, weight: 20 });
    if (hasCI) score += 20;

    factors.push({ name: "Has tests", status: hasTests, weight: 20 });
    if (hasTests) score += 20;

    factors.push({ name: "Has license", status: !!license, weight: 10 });
    if (license) score += 10;

    const hasTopics = ((repoData.topics as string[]) ?? []).length > 0;
    factors.push({ name: "Has topics", status: hasTopics, weight: 10 });
    if (hasTopics) score += 10;

    const pushedAt = new Date(repoData.pushed_at as string);
    const recentlyPushed = Date.now() - pushedAt.getTime() < 90 * 24 * 60 * 60 * 1000;
    factors.push({ name: "Active (pushed <3mo)", status: recentlyPushed, weight: 15 });
    if (recentlyPushed) score += 15;

    const hasStars = (repoData.stargazers_count as number) > 0;
    factors.push({ name: "Has stars", status: hasStars, weight: 5 });
    if (hasStars) score += 5;

    const hasHomepage = !!repoData.homepage;
    factors.push({ name: "Has homepage/demo", status: hasHomepage, weight: 10 });
    if (hasHomepage) score += 10;

    res.json({
      repo,
      healthScore: score,
      grade: score >= 80 ? "A" : score >= 60 ? "B" : score >= 40 ? "C" : score >= 20 ? "D" : "F",
      factors,
      ciProvider,
      license,
      hasTests,
      hasCI,
      stars: (repoData.stargazers_count as number) ?? 0,
      openIssues: (repoData.open_issues_count as number) ?? 0,
      lastPush: (repoData.pushed_at as string) ?? new Date().toISOString(),
    });
  }),
);

export default router;
