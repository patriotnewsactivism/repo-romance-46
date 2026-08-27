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

/**
 * Resolve which provider and key to use for a user.
 *
 * `github_models` intentionally falls back to the user's GitHub token, which is
 * how the free tier is reached — but only when the user has not supplied a key
 * of their own.
 */
export async function loadAiCredential(
  supabase: SupabaseClient,
  userId: string,
  githubToken?: string | null,
): Promise<AiCredential> {
  const { data } = await supabase
    .from("user_preferences")
    .select("custom_ai_provider, custom_ai_key")
    .eq("user_id", userId)
    .maybeSingle();

  const row = (data ?? null) as { custom_ai_provider: string | null; custom_ai_key: string | null } | null;
  const provider = row?.custom_ai_provider || "openai";
  let apiKey = decryptSecret(row?.custom_ai_key ?? null);

  if (provider === "github_models" && !apiKey && githubToken) apiKey = githubToken;

  return { provider, apiKey };
}
