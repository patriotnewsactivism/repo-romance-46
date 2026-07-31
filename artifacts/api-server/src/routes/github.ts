import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "../lib/async-handler";

const router: IRouter = Router();

/** Exchange GitHub OAuth code for an access token and store it. */
router.post(
  "/github/connect",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { code } = z.object({ code: z.string().min(1) }).parse(req.body);

    const clientId = process.env["GITHUB_CLIENT_ID"];
    const clientSecret = process.env["GITHUB_CLIENT_SECRET"];
    if (!clientId || !clientSecret) {
      throw Object.assign(new Error("GitHub OAuth not configured"), { status: 500 });
    }

    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      throw Object.assign(
        new Error(tokenData.error || "GitHub OAuth failed — invalid or expired code"),
        { status: 400 },
      );
    }

    // Fetch GitHub user info
    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "repo-finisher",
      },
    });
    const ghUser = (await userRes.json()) as { id: number; login: string; avatar_url: string; name: string | null };

    // Upsert github connection
    const { error } = await req.supabase!.from("github_connections").upsert(
      {
        user_id: req.userId!,
        github_id: String(ghUser.id),
        github_login: ghUser.login,
        avatar_url: ghUser.avatar_url,
        display_name: ghUser.name,
        access_token: tokenData.access_token,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);

    res.json({ login: ghUser.login, avatarUrl: ghUser.avatar_url, displayName: ghUser.name });
  }),
);

router.get(
  "/github/connection",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { data, error } = await req.supabase!
      .from("github_connections")
      .select("github_login, avatar_url, display_name, updated_at")
      .eq("user_id", req.userId!)
      .maybeSingle();
    if (error) throw new Error(error.message);
    res.json(data ?? null);
  }),
);

router.get(
  "/github/status",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { data } = await req.supabase!
      .from("github_connections")
      .select("github_login, avatar_url, display_name, access_token")
      .eq("user_id", req.userId!)
      .maybeSingle();

    if (!data) {
      res.json({ connected: false, login: null, avatarUrl: null, displayName: null, repoCount: null });
      return;
    }

    const conn = data as { github_login: string; avatar_url: string | null; display_name: string | null; access_token: string };

    // Optionally fetch live repo count
    let repoCount: number | null = null;
    try {
      const r = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${conn.access_token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "repo-finisher",
        },
      });
      if (r.ok) {
        const u = (await r.json()) as { public_repos?: number; total_private_repos?: number };
        repoCount = (u.public_repos ?? 0) + (u.total_private_repos ?? 0);
      }
    } catch {
      // Not critical
    }

    res.json({
      connected: true,
      login: conn.github_login,
      avatarUrl: conn.avatar_url,
      displayName: conn.display_name,
      repoCount,
    });
  }),
);

router.get(
  "/github/portfolio-summary",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { data: conn } = await req.supabase!
      .from("github_connections")
      .select("access_token")
      .eq("user_id", req.userId!)
      .maybeSingle();

    if (!conn) {
      res.json({ repoCount: 0, languages: [], totalStars: 0, lastPushed: null });
      return;
    }

    const { data: prefs } = await req.supabase!
      .from("user_preferences")
      .select("filter_max_repos, filter_exclude_archived")
      .eq("user_id", req.userId!)
      .maybeSingle();

    try {
      const reposRes = await fetch(
        `https://api.github.com/user/repos?per_page=100&affiliation=owner&sort=pushed`,
        {
          headers: {
            Authorization: `Bearer ${(conn as { access_token: string }).access_token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "repo-finisher",
          },
        },
      );
      if (!reposRes.ok) throw new Error("GitHub API error");
      const repos = (await reposRes.json()) as {
        fork: boolean;
        archived: boolean;
        language: string | null;
        stargazers_count: number;
        pushed_at: string;
      }[];

      let shortlist = repos.filter((r) => !r.fork);
      if ((prefs as { filter_exclude_archived?: boolean } | null)?.filter_exclude_archived) {
        shortlist = shortlist.filter((r) => !r.archived);
      }
      const maxRepos = (prefs as { filter_max_repos?: number } | null)?.filter_max_repos ?? 50;
      shortlist = shortlist.slice(0, maxRepos);

      const langCounts = new Map<string, number>();
      for (const r of shortlist) {
        const lang = r.language || "Other";
        langCounts.set(lang, (langCounts.get(lang) || 0) + 1);
      }
      const languages = Array.from(langCounts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);

      const totalStars = shortlist.reduce((s, r) => s + (r.stargazers_count || 0), 0);
      const lastPushed = shortlist[0]?.pushed_at ?? null;

      res.json({ repoCount: shortlist.length, languages, totalStars, lastPushed });
    } catch {
      res.json({ repoCount: 0, languages: [], totalStars: 0, lastPushed: null });
    }
  }),
);

router.delete(
  "/github/connection",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { error } = await req.supabase!
      .from("github_connections")
      .delete()
      .eq("user_id", req.userId!);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  }),
);

export default router;
