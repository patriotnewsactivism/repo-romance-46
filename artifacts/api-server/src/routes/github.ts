import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "../lib/async-handler";
import { encryptSecret, secretsConfigured } from "../lib/secrets";
import { loadGithubCredential } from "../lib/credentials";

const router: IRouter = Router();

const disconnectedStatus = {
  connected: false,
  login: null,
  avatarUrl: null,
  displayName: null,
  repoCount: null,
};

async function removeRevokedGithubConnection(req: Parameters<Parameters<typeof asyncHandler>[0]>[0]) {
  const { error } = await req.supabase!
    .from("github_connections")
    .delete()
    .eq("user_id", req.userId!);
  if (error) {
    console.warn("Failed to clear revoked GitHub connection:", error.message);
  }
}

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

    if (!secretsConfigured()) {
      throw Object.assign(
        new Error("Cannot store a GitHub token: SECRET_ENCRYPTION_KEY is not configured on the server."),
        { status: 503 },
      );
    }

    const { error } = await req.supabase!.from("github_connections").upsert(
      {
        user_id: req.userId!,
        github_id: String(ghUser.id),
        github_login: ghUser.login,
        avatar_url: ghUser.avatar_url,
        display_name: ghUser.name,
        access_token: encryptSecret(providerToken),
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
      .select("github_login, avatar_url, display_name")
      .eq("user_id", req.userId!)
      .maybeSingle();

    if (!data) {
      res.json(disconnectedStatus);
      return;
    }

    const conn = data as { github_login: string; avatar_url: string | null; display_name: string | null };
    const credential = await loadGithubCredential(req.supabase!, req.userId!);

    // A row can outlive the credential that it represents: GitHub tokens can be
    // revoked, and hosting migrations can make an old encrypted envelope
    // unreadable. Never report such a row as a healthy connection.
    if (!credential) {
      res.json(disconnectedStatus);
      return;
    }

    let repoCount: number | null = null;
    try {
      const r = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${credential.token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "repo-finisher",
        },
      });

      if (r.status === 401) {
        // This credential is definitively unusable. Remove the dead row so all
        // callers converge on the reconnect flow instead of repeatedly sending
        // a revoked token to GitHub and surfacing "Bad credentials".
        await removeRevokedGithubConnection(req);
        res.json(disconnectedStatus);
        return;
      }

      if (r.ok) {
        const u = (await r.json()) as { public_repos?: number; total_private_repos?: number };
        repoCount = (u.public_repos ?? 0) + (u.total_private_repos ?? 0);
      }
    } catch {
      // A network failure is not proof that a token was revoked. Keep the
      // connection visible and retry on the next status request.
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
    const credential = await loadGithubCredential(req.supabase!, req.userId!);

    if (!credential) {
      res.json({ repoCount: 0, languages: [], totalStars: 0, lastPushed: null });
      return;
    }

    const { data: prefs } = await req.supabase!
      .from("user_preferences")
      .select("filter_max_repos, filter_exclude_archived")
      .eq("user_id", req.userId!)
      .maybeSingle();

    try {
      const requestedLimit = Math.min((prefs as { filter_max_repos?: number } | null)?.filter_max_repos ?? 1000, 1000);
      const repos: {
        fork: boolean;
        archived: boolean;
        language: string | null;
        stargazers_count: number;
        pushed_at: string;
      }[] = [];
      for (let page = 1; page <= Math.ceil(requestedLimit / 100); page += 1) {
        const reposRes = await fetch(
          `https://api.github.com/user/repos?per_page=100&page=${page}&affiliation=owner&sort=pushed`,
          {
            headers: {
              Authorization: `Bearer ${credential.token}`,
              Accept: "application/vnd.github+json",
              "User-Agent": "repo-finisher",
            },
          },
        );

        if (reposRes.status === 401) {
          await removeRevokedGithubConnection(req);
          throw Object.assign(
            new Error("GitHub connection expired or was revoked. Reconnect GitHub and try again."),
            { status: 401 },
          );
        }
        if (!reposRes.ok) throw new Error("GitHub API error");

        const pageRepos = (await reposRes.json()) as typeof repos;
        repos.push(...pageRepos);
        if (pageRepos.length < 100) break;
      }

      let shortlist = repos.filter((r) => !r.fork);
      if ((prefs as { filter_exclude_archived?: boolean } | null)?.filter_exclude_archived) {
        shortlist = shortlist.filter((r) => !r.archived);
      }
      shortlist = shortlist.slice(0, requestedLimit);

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
    } catch (error) {
      if ((error as { status?: number }).status === 401) throw error;
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
