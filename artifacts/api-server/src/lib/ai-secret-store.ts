import type { SupabaseClient } from "@supabase/supabase-js";

const SUPPORTED_PROVIDERS = new Set(["google", "openai", "anthropic", "openrouter"]);

function normalizeSecretId(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

function normalizeProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (!SUPPORTED_PROVIDERS.has(normalized)) {
    throw new Error(`Unsupported AI provider "${provider}".`);
  }
  return normalized;
}

/**
 * BYOK Vault operations deliberately use the already-authenticated, user-scoped
 * Supabase client from the request. Provider is part of the Vault identity, so a
 * Google key, OpenRouter key, OpenAI key, and Anthropic key can coexist for the
 * same user. Changing the selected model never creates or rotates a secret.
 */
export async function readAiVaultSecret(
  supabase: SupabaseClient,
  userId: string,
  provider: string,
  secretId: string | null | undefined,
): Promise<string | null> {
  if (!secretId) return null;
  const normalizedProvider = normalizeProvider(provider);
  const { data, error } = await supabase.rpc("repo_finisher_read_ai_provider_secret", {
    p_user_id: userId,
    p_provider: normalizedProvider,
    p_secret_id: secretId,
  });
  if (error) throw new Error(`Failed to read ${normalizedProvider} credential from Vault: ${error.message}`);

  // A whitespace-only secret is not a usable credential: it is truthy, so it
  // would reach the provider as an empty bearer token and fail authentication
  // with an error that looks nothing like "no key configured".
  const secret = typeof data === "string" ? data.trim() : "";
  return secret.length > 0 ? secret : null;
}

export async function storeAiVaultSecret(
  supabase: SupabaseClient,
  userId: string,
  provider: string,
  plaintext: string,
  existingSecretId?: string | null,
): Promise<string> {
  const normalizedProvider = normalizeProvider(provider);
  const secret = plaintext.trim();
  if (!secret) throw new Error("AI provider key cannot be empty.");

  const { data, error } = await supabase.rpc("repo_finisher_store_ai_provider_secret", {
    p_user_id: userId,
    p_provider: normalizedProvider,
    p_secret: secret,
    p_existing_secret_id: existingSecretId || null,
  });
  if (error) throw new Error(`Failed to store ${normalizedProvider} credential in Vault: ${error.message}`);
  const id = normalizeSecretId(data);
  if (!id) throw new Error("Supabase Vault did not return a valid secret reference.");
  return id;
}

export async function deleteAiVaultSecret(
  supabase: SupabaseClient,
  userId: string,
  provider: string,
  secretId?: string | null,
): Promise<void> {
  if (!secretId) return;
  const normalizedProvider = normalizeProvider(provider);
  const { error } = await supabase.rpc("repo_finisher_delete_ai_provider_secret", {
    p_user_id: userId,
    p_provider: normalizedProvider,
    p_secret_id: secretId,
  });
  if (error) throw new Error(`Failed to remove ${normalizedProvider} credential from Vault: ${error.message}`);
}
