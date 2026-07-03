import type { NextFunction, Request, Response } from "express";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseFetch } from "../lib/supabase-fetch";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      supabase?: SupabaseClient;
      userId?: string;
    }
  }
}

// Express equivalent of the original `requireSupabaseAuth` TanStack middleware:
// builds a user-scoped Supabase client from the caller's Bearer JWT (so RLS
// policies apply), and attaches it + the user id to the request.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const SUPABASE_PUBLISHABLE_KEY =
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      const missing = [
        ...(!SUPABASE_URL ? ["SUPABASE_URL"] : []),
        ...(!SUPABASE_PUBLISHABLE_KEY ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
      ];
      res.status(500).json({ error: `Missing Supabase environment variable(s): ${missing.join(", ")}` });
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.status(401).json({ error: "Unauthorized: No authorization header provided" });
      return;
    }
    if (!authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized: Only Bearer tokens are supported" });
      return;
    }
    const token = authHeader.replace("Bearer ", "");
    if (!token || token.split(".").length !== 3) {
      res.status(401).json({ error: "Unauthorized: Invalid token" });
      return;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      global: {
        fetch: createSupabaseFetch(SUPABASE_PUBLISHABLE_KEY),
        headers: { Authorization: `Bearer ${token}` },
      },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims?.sub) {
      res.status(401).json({ error: "Unauthorized: Invalid token" });
      return;
    }

    req.supabase = supabase;
    req.userId = data.claims.sub as string;
    next();
  } catch (e) {
    res.status(401).json({ error: e instanceof Error ? e.message : "Unauthorized" });
  }
}
