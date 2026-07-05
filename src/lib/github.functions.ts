import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createHmac } from "crypto";
import { z } from "zod";

function hmac(userId: string) {
  const secret = process.env.GITHUB_CLIENT_SECRET;
  if (!secret)
    throw new Error(
      "GitHub OAuth not configured. Ask the admin to set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.",
    );
  return createHmac("sha256", secret).update(userId).digest("hex").slice(0, 32);
}

export function makeState(userId: string) {
  return `${userId}.${hmac(userId)}`;
}

export function parseState(state: string): string | null {
  const [userId, sig] = state.split(".");
  if (!userId || !sig) return null;
  try {
    if (hmac(userId) !== sig) return null;
    return userId;
  } catch {
    return null;
  }
}

export const startGithubOAuth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      throw new Error(
        "GitHub OAuth not configured yet. Add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET secrets.",
      );
    }
    const state = makeState(context.userId);
    const req = getRequest();
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const origin = process.env.APP_ORIGIN ?? (host ? `${proto}://${host}` : "");
    const redirectUri = `${origin}/api/public/github/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "read:user repo",
      state,
      allow_signup: "false",
    });
    return { url: `https://github.com/login/oauth/authorize?${params}` };
  });

export const getConnectionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("github_connections")
      .select("github_login, connected_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    return {
      connected: !!data,
      login: data?.github_login ?? null,
      connected_at: data?.connected_at ?? null,
    };
  });

export const disconnectGithub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("github_connections")
      .delete()
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getPortfolioSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: conn } = await context.supabase
      .from("github_connections")
      .select("access_token, github_login")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!conn) return { connected: false, summary: null };

    const token = conn.access_token;

    // Fetch repos — just metadata, no deep sampling
    const res = await fetch(
      "https://api.github.com/user/repos?per_page=100&affiliation=owner&sort=pushed",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "repo-finisher",
        },
      },
    );
    if (!res.ok) return { connected: true, summary: null };
    const repos = (await res.json()) as Array<{
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

    // Language breakdown
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

    return {
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
    };
  });

export const getRepoHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { repo: string }) => z.object({ repo: z.string() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: conn } = await context.supabase
      .from("github_connections")
      .select("access_token")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!conn) throw new Error("Connect GitHub first.");
    const token = conn.access_token;

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "repo-finisher",
    };

    // Fetch repo metadata
    const repoRes = await fetch(`https://api.github.com/repos/${data.repo}`, { headers });
    if (!repoRes.ok) throw new Error(`Repo not found: ${data.repo}`);
    const repo = (await repoRes.json()) as Record<string, unknown>;

    // Check for CI workflows
    let hasCI = false;
    let ciProvider = null;
    try {
      const wfRes = await fetch(
        `https://api.github.com/repos/${data.repo}/contents/.github/workflows`,
        { headers },
      );
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

    // Check for license
    let license = null;
    try {
      const licRes = await fetch(`https://api.github.com/repos/${data.repo}/license`, { headers });
      if (licRes.ok) {
        const lic = (await licRes.json()) as Record<string, { spdx_id?: string }>;
        license = lic.license?.spdx_id ?? null;
      }
    } catch {
      /* ignore */
    }

    // Check for tests (common test file patterns)
    let hasTests = false;
    try {
      const treeRes = await fetch(
        `https://api.github.com/repos/${data.repo}/git/trees/${repo.default_branch as string}?recursive=1`,
        { headers },
      );
      if (treeRes.ok) {
        const tree = (await treeRes.json()) as { tree: Array<{ path: string }> };
        hasTests = tree.tree.some((t) => /test|spec|__tests__|\.test\.|\.spec\./i.test(t.path));
      }
    } catch {
      /* ignore */
    }

    // Calculate health score
    let score = 0;
    const factors: { name: string; status: boolean; weight: number }[] = [];

    // Has README
    const hasReadme = !!repo.description;
    factors.push({ name: "Has description", status: hasReadme, weight: 10 });
    if (hasReadme) score += 10;

    // Has CI
    factors.push({ name: "CI configured", status: hasCI, weight: 20 });
    if (hasCI) score += 20;

    // Has tests
    factors.push({ name: "Has tests", status: hasTests, weight: 20 });
    if (hasTests) score += 20;

    // Has license
    factors.push({ name: "Has license", status: !!license, weight: 10 });
    if (license) score += 10;

    // Has topics
    const hasTopics = (repo.topics as string[])?.length > 0;
    factors.push({ name: "Has topics", status: hasTopics, weight: 10 });
    if (hasTopics) score += 10;

    // Recently pushed (within 3 months)
    const pushedAt = new Date(repo.pushed_at as string);
    const recentlyPushed = Date.now() - pushedAt.getTime() < 90 * 24 * 60 * 60 * 1000;
    factors.push({ name: "Active (pushed <3mo)", status: recentlyPushed, weight: 15 });
    if (recentlyPushed) score += 15;

    // Has stars
    const hasStars = (repo.stargazers_count as number) > 0;
    factors.push({ name: "Has stars", status: hasStars, weight: 5 });
    if (hasStars) score += 5;

    // Has homepage
    const hasHomepage = !!repo.homepage;
    factors.push({ name: "Has homepage/demo", status: hasHomepage, weight: 10 });
    if (hasHomepage) score += 10;

    return {
      repo: data.repo,
      healthScore: score,
      grade: (score >= 80
        ? "A"
        : score >= 60
          ? "B"
          : score >= 40
            ? "C"
            : score >= 20
              ? "D"
              : "F") as string,
      factors,
      ciProvider,
      license,
      hasTests,
      hasCI,
      stars: (repo.stargazers_count as number) ?? 0,
      openIssues: (repo.open_issues_count as number) ?? 0,
      lastPush: (repo.pushed_at as string) ?? new Date().toISOString(),
    };
  });
