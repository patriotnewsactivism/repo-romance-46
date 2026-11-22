import { Router, type IRouter } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  pool,
  sessionExpiry,
  verifyPassword,
} from "@workspace/db";
import { config } from "../lib/config";
import { asyncHandler } from "../lib/async-handler";
import { requireAuth } from "../middlewares/auth";
import { encryptSecret, secretsConfigured } from "../lib/secrets";

/**
 * First-party authentication. Replaces Supabase Auth (email/password + GitHub
 * OAuth). Sessions are opaque bearer tokens; only their SHA-256 hash is stored.
 */
const router: IRouter = Router();

const credentials = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(200),
});

interface UserRow {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  github_login: string | null;
}

function publicUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    github_login: row.github_login,
  };
}

async function issueSession(userId: string, userAgent?: string): Promise<string> {
  const token = createSessionToken();
  await pool.query(
    `insert into app_sessions (token_hash, user_id, expires_at, user_agent)
     values ($1, $2, $3, $4)`,
    [hashSessionToken(token), userId, sessionExpiry(), userAgent ?? null],
  );
  return token;
}

function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

router.post(
  "/auth/signup",
  asyncHandler(async (req, res) => {
    const { email, password } = credentials.parse(req.body);

    const existing = await pool.query(`select id from app_users where lower(email) = lower($1)`, [email]);
    if (existing.rowCount) {
      res.status(409).json({ error: "An account with that email already exists." });
      return;
    }

    const { rows } = await pool.query<UserRow>(
      `insert into app_users (email, password_hash, display_name)
       values ($1, $2, $3)
       returning id, email, display_name, avatar_url, github_login`,
      [email, await hashPassword(password), email.split("@")[0]],
    );

    const token = await issueSession(rows[0].id, req.headers["user-agent"]);
    res.status(201).json({ token, user: publicUser(rows[0]) });
  }),
);

router.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    const { email, password } = credentials.parse(req.body);

    const { rows } = await pool.query<UserRow & { password_hash: string | null }>(
      `select id, email, display_name, avatar_url, github_login, password_hash
         from app_users where lower(email) = lower($1)`,
      [email],
    );
    const user = rows[0];

    // Same response for an unknown address and a wrong password: the endpoint
    // must not confirm which emails have accounts.
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      res.status(401).json({ error: "Incorrect email or password." });
      return;
    }

    const token = await issueSession(user.id, req.headers["user-agent"]);
    res.json({ token, user: publicUser(user) });
  }),
);

router.post(
  "/auth/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    const token = bearerToken(req.headers["authorization"]);
    if (token) {
      await pool.query(`delete from app_sessions where token_hash = $1`, [hashSessionToken(token)]);
    }
    res.json({ ok: true });
  }),
);

router.get(
  "/auth/session",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<UserRow>(
      `select id, email, display_name, avatar_url, github_login from app_users where id = $1`,
      [req.userId],
    );
    if (!rows[0]) {
      res.status(401).json({ error: "Invalid or expired session" });
      return;
    }
    res.json({ user: publicUser(rows[0]) });
  }),
);

// ── GitHub OAuth ────────────────────────────────────────────────────────────

const STATE_TTL_MS = 10 * 60 * 1000;

function stateSecret(): string {
  return config.planSigningSecret || "bluebook-local-oauth-state";
}

function createState(): string {
  const issuedAt = Date.now().toString(36);
  const mac = createHmac("sha256", stateSecret()).update(issuedAt).digest("base64url");
  return `${issuedAt}.${mac}`;
}

function verifyState(state: string): boolean {
  const [issuedAt, mac] = state.split(".");
  if (!issuedAt || !mac) return false;
  const expected = createHmac("sha256", stateSecret()).update(issuedAt).digest("base64url");
  const given = Buffer.from(mac);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return false;
  return Date.now() - parseInt(issuedAt, 36) < STATE_TTL_MS;
}

function githubRedirectUri(): string {
  return `${config.publicOrigin}/api/auth/github/callback`;
}

router.get("/auth/github/start", (req, res) => {
  if (!config.githubClientId || !config.githubClientSecret) {
    res.status(503).json({
      error:
        "GitHub sign-in is not configured. Set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET, or sign in with email.",
    });
    return;
  }

  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.githubClientId);
  url.searchParams.set("redirect_uri", githubRedirectUri());
  url.searchParams.set("scope", "repo read:user user:email");
  url.searchParams.set("state", createState());
  res.redirect(url.toString());
});

router.get(
  "/auth/github/callback",
  asyncHandler(async (req, res) => {
    const query = z.object({ code: z.string().min(1), state: z.string().min(1) }).safeParse(req.query);
    if (!query.success) {
      res.redirect(`${config.publicOrigin}/auth/callback#error=${encodeURIComponent("GitHub returned no authorization code.")}`);
      return;
    }
    if (!verifyState(query.data.state)) {
      res.redirect(`${config.publicOrigin}/auth/callback#error=${encodeURIComponent("This sign-in link expired. Try again.")}`);
      return;
    }

    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: config.githubClientId,
        client_secret: config.githubClientSecret,
        code: query.data.code,
        redirect_uri: githubRedirectUri(),
      }),
    });
    const tokenPayload = (await tokenResponse.json()) as { access_token?: string; error_description?: string };
    const accessToken = tokenPayload.access_token;
    if (!accessToken) {
      res.redirect(
        `${config.publicOrigin}/auth/callback#error=${encodeURIComponent(tokenPayload.error_description ?? "GitHub did not return an access token.")}`,
      );
      return;
    }

    const ghHeaders = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "bluebook",
    };
    const ghUser = (await (await fetch("https://api.github.com/user", { headers: ghHeaders })).json()) as {
      id: number;
      login: string;
      name?: string | null;
      avatar_url?: string | null;
      email?: string | null;
    };

    let email = ghUser.email ?? null;
    if (!email) {
      const emails = (await (await fetch("https://api.github.com/user/emails", { headers: ghHeaders })).json()) as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;
      email = emails?.find((entry) => entry.primary && entry.verified)?.email ?? null;
    }

    const githubId = String(ghUser.id);
    let userId: string | undefined;

    const byGithub = await pool.query<{ id: string }>(`select id from app_users where github_user_id = $1`, [githubId]);
    if (byGithub.rows[0]) {
      userId = byGithub.rows[0].id;
    } else if (email) {
      const byEmail = await pool.query<{ id: string }>(`select id from app_users where lower(email) = lower($1)`, [email]);
      userId = byEmail.rows[0]?.id;
    }

    if (userId) {
      await pool.query(
        `update app_users
            set github_user_id = $2, github_login = $3, avatar_url = coalesce($4, avatar_url),
                email = coalesce(email, $5), updated_at = now()
          where id = $1`,
        [userId, githubId, ghUser.login, ghUser.avatar_url ?? null, email],
      );
    } else {
      const inserted = await pool.query<{ id: string }>(
        `insert into app_users (email, display_name, avatar_url, github_user_id, github_login)
         values ($1, $2, $3, $4, $5) returning id`,
        [email, ghUser.name ?? ghUser.login, ghUser.avatar_url ?? null, githubId, ghUser.login],
      );
      userId = inserted.rows[0].id;
    }

    // The repo token is what lets the app read and write repositories; seal it
    // before it touches the database, exactly like the previous Vault path.
    if (secretsConfigured()) {
      await pool.query(
        `insert into github_connections (user_id, github_id, github_login, avatar_url, display_name, access_token, scope, scopes, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $7, now())
         on conflict (user_id) do update set
           github_id = excluded.github_id,
           github_login = excluded.github_login,
           avatar_url = excluded.avatar_url,
           display_name = excluded.display_name,
           access_token = excluded.access_token,
           scope = excluded.scope,
           scopes = excluded.scopes,
           updated_at = now()`,
        [
          userId,
          githubId,
          ghUser.login,
          ghUser.avatar_url ?? null,
          ghUser.name ?? null,
          encryptSecret(accessToken),
          "repo,read:user,user:email",
        ],
      );
    }

    const sessionToken = await issueSession(userId, req.headers["user-agent"]);
    res.redirect(`${config.publicOrigin}/auth/callback#access_token=${encodeURIComponent(sessionToken)}&provider=github`);
  }),
);

export default router;
