/**
 * Central place to load a user's stored credentials.
 *
 * Routes used to reach into `github_connections` and `user_preferences`
 * themselves, which meant the plaintext-vs-sealed question was answered
 * differently in five files. Every read now goes through here, so unsealing is
 * consistent and there is one place to audit when a secret's storage changes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "./secrets";

export interface GithubCredential {
  token: string;
  login: string;
}

export async function loadGithubCredential(
  supabase: SupabaseClient,
  userId: string,
): Promise<GithubCredential | null> {
  const { data } = await supabase
    .from("github_connections")
    .select("github_login, access_token")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return null;
  const row = data as { github_login: string; access_token: string };
  const token = decryptSecret(row.access_token);
  if (!token) return null;
  return { token, login: row.github_login };
}

export function requireGithubCredential(credential: GithubCredential | null): GithubCredential {
  if (!credential) {
    throw Object.assign(new Error("Connect GitHub first."), { status: 400 });
  }
  return credential;
}

export interface AiCredential {
  provider: string;
  apiKey: string | null;
}

function platformAiKey(provider: string): string | null {
  switch (provider) {
    case "google":
      return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
    case "openai":
      return process.env.OPENAI_API_KEY || null;
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY || null;
    default:
      return null;
  }
}

/**
 * Resolve which provider and key to use for a user.
 *
 * Gemini is the platform default. A user's encrypted BYOK credential wins when
 * present; otherwise the server-side provider credential is used. Historical
 * `github_models` preferences are transparently routed to Google because the
 * GitHub Models service has been retired.
 */
export async function loadAiCredential(
  supabase: SupabaseClient,
  userId: string,
  _githubToken?: string | null,
): Promise<AiCredential> {
  const { data } = await supabase
    .from("user_preferences")
    .select("custom_ai_provider, custom_ai_key")
    .eq("user_id", userId)
    .maybeSingle();

  const row = (data ?? null) as { custom_ai_provider: string | null; custom_ai_key: string | null } | null;
  const requestedProvider = row?.custom_ai_provider || "google";
  const provider = requestedProvider === "github_models" ? "google" : requestedProvider;

  const userKey = decryptSecret(row?.custom_ai_key ?? null);
  const apiKey = userKey || platformAiKey(provider);

  return { provider, apiKey };
}
