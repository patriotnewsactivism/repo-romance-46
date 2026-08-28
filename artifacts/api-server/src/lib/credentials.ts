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
  let token: string | null = null;
  try {
    token = decryptSecret(row.access_token);
  } catch {
    // Hosting migrations can legitimately rotate the server-side encryption key.
    // Treat an unreadable stored envelope as unavailable rather than crashing
    // every authenticated route. The ciphertext stays untouched so it can still
    // be recovered if the original key is restored; reconnecting GitHub writes a
    // fresh envelope under the current key.
    token = null;
  }
  if (!token) return null;
  return { token, login: row.github_login };
}

export function requireGithubCredential(credential: GithubCredential | null): GithubCredential {
  if (!credential) {
    throw Object.assign(new Error("Connect GitHub first."), { status: 400 });
  }
  return credential;
}

export type AiCredentialSource = "byok" | "platform" | "none";

export interface AiCredential {
  provider: string;
  apiKey: string | null;
  source: AiCredentialSource;
}

const SUPPORTED_PLATFORM_PROVIDERS = new Set(["google", "openai", "anthropic"]);

export function platformAiProvider(): string {
  const configured = (process.env.AI_PROVIDER || "google").trim().toLowerCase();
  return SUPPORTED_PLATFORM_PROVIDERS.has(configured) ? configured : "google";
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

/** Safe platform readiness metadata. Never includes credential values. */
export function platformAiStatus() {
  return {
    defaultProvider: platformAiProvider(),
    providers: {
      google: { platformConfigured: Boolean(platformAiKey("google")) },
      openai: { platformConfigured: Boolean(platformAiKey("openai")) },
      anthropic: { platformConfigured: Boolean(platformAiKey("anthropic")) },
    },
  };
}

/**
 * Resolve which provider and key to use for a user.
 *
 * Google Gemini remains the default when AI_PROVIDER is unset. A user's
 * encrypted BYOK credential wins when present; otherwise the server-side
 * credential for the selected provider is used. Historical `github_models`
 * preferences are transparently routed to the current platform default because
 * GitHub Models has been retired.
 */
export async function loadAiCredential(
  supabase: SupabaseClient,
  userId: string,
  _githubToken?: string | null,
): Promise<AiCredential> {
  const { data, error } = await supabase
    .from("user_preferences")
    .select("custom_ai_provider, custom_ai_key")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load AI preferences: ${error.message}`);

  const row = (data ?? null) as { custom_ai_provider: string | null; custom_ai_key: string | null } | null;
  const fallbackProvider = platformAiProvider();
  const requestedProvider = row?.custom_ai_provider || fallbackProvider;
  const provider = requestedProvider === "github_models" ? fallbackProvider : requestedProvider;

  let userKey: string | null = null;
  try {
    userKey = decryptSecret(row?.custom_ai_key ?? null);
  } catch {
    // Do not turn a provider migration/key-rotation issue into a full API outage.
    // The stored ciphertext remains intact, but this runtime treats it as an
    // unavailable BYOK key and falls back to a platform credential when one is
    // configured. The user can also re-enter the key from Settings.
    userKey = null;
  }
  if (userKey) return { provider, apiKey: userKey, source: "byok" };

  const platformKey = platformAiKey(provider);
  if (platformKey) return { provider, apiKey: platformKey, source: "platform" };

  return { provider, apiKey: null, source: "none" };
}