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
import { readAiVaultSecret } from "./ai-secret-store";
import { normalizeOpenRouterReasoningEffort, type OpenRouterReasoningEffort } from "./openrouter-models";

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
  model: string | null;
  apiKey: string | null;
  source: AiCredentialSource;
  reasoningEffort: OpenRouterReasoningEffort | null;
}

export const SUPPORTED_AI_PROVIDERS = ["google", "openai", "anthropic", "openrouter"] as const;
const SUPPORTED_PLATFORM_PROVIDERS = new Set<string>(SUPPORTED_AI_PROVIDERS);

export function normalizeAiProvider(value: string | null | undefined, fallback = "openrouter"): string {
  const configured = String(value || "").trim().toLowerCase();
  if (SUPPORTED_PLATFORM_PROVIDERS.has(configured)) return configured;
  if (configured === "github_models" || configured === "lovable" || !configured) return fallback;
  return fallback;
}

/**
 * Resolve the platform provider without silently stranding production on a
 * provider whose server-side key is missing. An explicitly configured provider
 * still wins when it is usable; otherwise OpenRouter is preferred, followed by
 * the other configured platform credentials. With no platform key at all,
 * OpenRouter remains the default so the Settings BYOK flow lands on the
 * preferred multi-model provider instead of an unrelated legacy default.
 */
export function platformAiProvider(): string {
  const configuredRaw = process.env.AI_PROVIDER?.trim().toLowerCase();
  const configured = configuredRaw ? normalizeAiProvider(configuredRaw, "openrouter") : null;

  if (configured && platformAiKey(configured)) return configured;
  if (platformAiKey("openrouter")) return "openrouter";
  if (platformAiKey("google")) return "google";
  if (platformAiKey("openai")) return "openai";
  if (platformAiKey("anthropic")) return "anthropic";

  return configured || "openrouter";
}

/**
 * A credential that is present but blank is not a credential.
 *
 * Env vars and stored rows can both hold whitespace, and a whitespace string is
 * truthy, so a blank key used to survive every `if (key)` check between here and
 * the provider call and go out as `Authorization: Bearer `. OpenRouter answers
 * that with `401 Missing Authentication header`, which reads like an integration
 * bug rather than an unconfigured key. Normalizing here makes a blank value
 * indistinguishable from an absent one, so the caller reports the real problem.
 *
 * Trimming also rescues the common case of a key pasted with surrounding
 * whitespace, which is otherwise a working key that always fails to authenticate.
 */
export function normalizeCredentialValue(raw: string | null | undefined): string | null {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

export function platformAiKey(provider: string): string | null {
  switch (provider) {
    case "google":
      return normalizeCredentialValue(process.env.GEMINI_API_KEY) ?? normalizeCredentialValue(process.env.GOOGLE_API_KEY);
    case "openai":
      return normalizeCredentialValue(process.env.OPENAI_API_KEY);
    case "anthropic":
      return normalizeCredentialValue(process.env.ANTHROPIC_API_KEY);
    case "openrouter":
      return normalizeCredentialValue(process.env.OPENROUTER_API_KEY);
    default:
      return null;
  }
}

function platformAiModel(provider: string): string | null {
  const common = process.env.AI_MODEL?.trim();
  if (common) return common;
  switch (provider) {
    case "google": return process.env.GEMINI_MODEL?.trim() || "gemini-3.7-flash";
    case "openai": return process.env.OPENAI_MODEL?.trim() || null;
    case "anthropic": return process.env.ANTHROPIC_MODEL?.trim() || null;
    case "openrouter": return process.env.OPENROUTER_MODEL?.trim() || "deepseek/deepseek-v4-flash-0731";
    default: return null;
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
      openrouter: { platformConfigured: Boolean(platformAiKey("openrouter")) },
    },
  };
}

/**
 * Resolve which provider, model, and key to use for a user.
 *
 * BYOK credentials are stored in Supabase Vault. The historical custom_ai_key
 * column is read only as a compatibility fallback for old rows that have not
 * yet been migrated. A user's BYOK credential wins over a platform credential.
 */
export async function loadAiCredential(
  supabase: SupabaseClient,
  userId: string,
  _githubToken?: string | null,
): Promise<AiCredential> {
  const { data, error } = await supabase
    .from("user_preferences")
    .select("custom_ai_provider, custom_ai_model, custom_ai_reasoning_effort, custom_ai_key, custom_ai_vault_secret_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load AI preferences: ${error.message}`);

  const row = (data ?? null) as {
    custom_ai_provider: string | null;
    custom_ai_model: string | null;
    custom_ai_reasoning_effort: string | null;
    custom_ai_key: string | null;
    custom_ai_vault_secret_id: string | null;
  } | null;
  const fallbackProvider = platformAiProvider();
  const provider = normalizeAiProvider(row?.custom_ai_provider, fallbackProvider);
  const model = row?.custom_ai_model?.trim() || platformAiModel(provider);
  const reasoningEffort = provider === "openrouter"
    ? normalizeOpenRouterReasoningEffort(row?.custom_ai_reasoning_effort)
    : null;

  let userKey: string | null = null;
  if (row?.custom_ai_vault_secret_id) {
    try {
      userKey = normalizeCredentialValue(await readAiVaultSecret(supabase, userId, row.custom_ai_vault_secret_id));
    } catch {
      userKey = null;
    }
  }

  if (!userKey && row?.custom_ai_key) {
    try {
      userKey = normalizeCredentialValue(decryptSecret(row.custom_ai_key));
    } catch {
      userKey = null;
    }
  }
  if (userKey) return { provider, model, apiKey: userKey, source: "byok", reasoningEffort };

  const platformKey = platformAiKey(provider);
  if (platformKey) return { provider, model, apiKey: platformKey, source: "platform", reasoningEffort };

  return { provider, model, apiKey: null, source: "none", reasoningEffort };
}
