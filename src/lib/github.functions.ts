import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createHmac } from "crypto";

function hmac(userId: string) {
  const secret = process.env.GITHUB_CLIENT_SECRET;
  if (!secret) throw new Error("GitHub OAuth not configured. Ask the admin to set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.");
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
      throw new Error("GitHub OAuth not configured yet. Add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET secrets.");
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
