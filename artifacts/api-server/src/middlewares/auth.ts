import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { config } from "../lib/config";
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
 * Verified identities, keyed by a hash of the bearer token so the token itself
 * never sits in memory as a map key. Short-lived: a revoked session stops
 * working within `IDENTITY_TTL_MS`, and Supabase remains the source of truth.
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

function anonClient(token: string): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Require a *verified* Supabase session.
 *
 * The previous implementation base64-decoded the JWT payload and trusted its
 * `sub` claim, reasoning that RLS would catch anything wrong. That only holds
 * for calls that go through PostgREST: routes also used `req.userId` to decide
 * whose GitHub token and AI key to load, so a self-signed JWT naming another
 * user's id was enough to act as them. The token is now verified against
 * Supabase before any identity is attached.
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

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    res.status(500).json({ error: "Supabase not configured" });
    return;
  }

  const key = cacheKey(token);
  const cached = readCache(key);
  if (cached) {
    req.supabase = anonClient(token);
    req.userId = cached;
    next();
    return;
  }

  const client = anonClient(token);
  client.auth
    .getUser(token)
    .then(({ data, error }) => {
      const userId = data?.user?.id;
      if (error || !userId) {
        res.status(401).json({ error: "Invalid or expired session" });
        return;
      }
      writeCache(key, userId);
      req.supabase = client;
      req.userId = userId;
      next();
    })
    .catch((err: unknown) => {
      req.log?.error({ err }, "Failed to verify session");
      captureException(err, { tags: { subsystem: "auth-verification" } });
      res.status(503).json({ error: "Could not verify session" });
    });
}
