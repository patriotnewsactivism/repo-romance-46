import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "../lib/async-handler";

const router: IRouter = Router();

/**
 * Store a GitHub access token obtained by the frontend's Supabase GitHub OAuth
 * sign-in (session.provider_token) into github_connections. Supabase already
 * performs the OAuth handshake (with `scope: 'repo'`) — this just persists the
 * resulting token server-side so other routes can call the GitHub API.
 */
router.post(
  "/github/connect",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { providerToken } = z.object({ providerToken: z.string().min(1) }).parse(req.body);

    // Fetch GitHub user info
    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${providerToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "repo-finisher",
      },
    });
    if (!userRes.ok) {
      throw Object.assign(new Error("Invalid or expired GitHub token"), { status: 400 });
    }

    // GitHub returns the token's granted OAuth scopes in this header for
    // classic OAuth App tokens (which is what Supabase's GitHub provider
    // issues). Without 'repo' scope, every downstream feature (analysis,
    // repo-finisher, valuation, vibe-tools) would fail later with opaque
    // errors instead of telling the user to reconnect now.
    const grantedScopes = (userRes.headers.get("x-oauth-scopes") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (grantedScopes.length > 0 && !grantedScopes.includes("repo")) {
      throw Object.assign(
        new Error("GitHub token is missing 'repo' scope — reconnect and grant repository access."),
        { status: 400 },
      );
    }

    const ghUser = (await userRes.json()) as { id: number; login: string; avatar_url: string; name: string | null };

    // Upsert github connection
    const { error } = await req.supabase!.from("github_connections").upsert(
      {
        user_id: req.userId!,
        github_id: String(ghUser.id),
        github_login: ghUser.login,
        avatar_url: ghUser.avatar_url,
        display_name: ghUser.name,
        access_token: providerToken,
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
