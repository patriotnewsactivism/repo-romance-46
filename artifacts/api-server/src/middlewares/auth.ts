import { createClient, pool, type SupabaseClient } from "@workspace/db";
import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { captureException } from "../instrument";

declare global {
  namespace Express {
    interface Request {
      supabase?: SupabaseClient;
      userId?: string;
    }
  }
}

interface CachedIdentity {
  userId: string;
  expiresAt: number;
}

/**
 * Verified identities, keyed by a hash of the bearer ****** so the token itself
 * never sits in memory as a map key. Short-lived: a revoked session stops
 * working within `IDENTITY_TTL_MS`, and the session table remains the source
 * of truth.
 */
const identityCache = new Map<string, CachedIdentity>();
const IDENTITY_TTL_MS = 60_000;
const IDENTITY_CACHE_MAX = 5_000;

function cacheKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function readCache(key: string): string | null {
  const hit = identityCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    identityCache.delete(key);
    return null;
  }
  return hit.userId;
}

function writeCache(key: string, userId: string): void {
  if (identityCache.size >= IDENTITY_CACHE_MAX) identityCache.clear();
  identityCache.set(key, { userId, expiresAt: Date.now() + IDENTITY_TTL_MS });
}

/** Exposed for tests and for sign-out flows that should drop a session early. */
export function clearIdentityCache(): void {
  identityCache.clear();
}

/** Request-scoped client: reads and writes are constrained to this user. */
function userClient(userId: string): SupabaseClient {
  return createClient("", "", { userId });
}

async function resolveSessionUserId(token: string): Promise<string | null> {
  const { rows } = await pool.query<{ user_id: string }>(
    `select user_id from app_sessions where token_hash = $1 and expires_at > now()`,
    [cacheKey(token)],
  );
  return rows[0]?.user_id ?? null;
}

/**
 * Require a verified session.
 *
 * Sessions are opaque tokens issued by /api/auth/*. The hash is looked up in
 * `app_sessions` before any identity is attached, so a forged or expired token
 * can never act as another user. The attached client is scoped to that user,
 * which is the replacement for the row-level security the database used to
 * enforce.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }

  const key = cacheKey(token);
  const cached = readCache(key);
  if (cached) {
    req.supabase = userClient(cached);
    req.userId = cached;
    next();
    return;
  }

  resolveSessionUserId(token)
    .then((userId) => {
      if (!userId) {
        res.status(401).json({ error: "Invalid or expired session" });
        return;
      }
      writeCache(key, userId);
      req.supabase = userClient(userId);
      req.userId = userId;
      next();
    })
    .catch((err: unknown) => {
      req.log?.error({ err }, "Failed to verify session");
      captureException(err, { tags: { subsystem: "auth-verification" } });
      res.status(503).json({ error: "Could not verify session" });
    });
}
