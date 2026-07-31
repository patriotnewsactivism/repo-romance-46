import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      supabase?: SupabaseClient;
      userId?: string;
    }
  }
}

function getSupabaseUrl(): string {
  // SUPABASE_URL may lack https:// in some environments; prefer VITE_- prefixed as fallback
  const raw = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"] || "";
  if (raw && !raw.startsWith("http")) return `https://${raw}`;
  return raw;
}

function getAnonKey(): string {
  return process.env["SUPABASE_ANON_KEY"] || process.env["VITE_SUPABASE_ANON_KEY"] || "";
}

/** Extract user ID from a Supabase JWT without a full verify (RLS enforces correctness) */
function extractUserIdFromJwt(token: string): string | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as { sub?: string };
    return decoded.sub ?? null;
  } catch {
    return null;
  }
}

/**
 * Middleware that requires a valid Supabase session.
 * Attaches a per-request Supabase client (authenticated as the calling user) to req.supabase.
 * RLS policies on Supabase enforce authorization — the JWT itself is verified by PostgREST.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  const userId = extractUserIdFromJwt(token);
  if (!userId) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  const supabaseUrl = getSupabaseUrl();
  const anonKey = getAnonKey();
  if (!supabaseUrl || !anonKey) {
    res.status(500).json({ error: "Supabase not configured" });
    return;
  }

  // Create a per-request client authenticated as the calling user.
  // Supabase's PostgREST will apply RLS policies using this token.
  req.supabase = createClient(supabaseUrl, anonKey, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  req.userId = userId;
  next();
}
