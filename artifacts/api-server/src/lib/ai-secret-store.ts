import type { SupabaseClient } from "@supabase/supabase-js";

function normalizeSecretId(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

/**
 * BYOK Vault operations deliberately use the already-authenticated, user-scoped
 * Supabase client from the request. The database RPCs are SECURITY DEFINER but
 * verify auth.uid() matches p_user_id before touching Vault, so saving a user's
 * provider key does not depend on a service-role/secret key being present on the
 * API host.
 */
export async function readAiVaultSecret(
  supabase: SupabaseClient,
  userId: string,
  secretId: string | null | undefined,
): Promise<string | null> {
  if (!secretId) return null;
  const { data, error } = await supabase.rpc("repo_finisher_read_ai_secret", {
    p_user_id: userId,
    p_secret_id: secretId,
  });
  if (error) throw new Error(`Failed to read AI credential from Vault: ${error.message}`);
  // A whitespace-only secret is not a usable credential: it is truthy, so it
  // would reach the provider as an empty bearer token and fail authentication
  // with an error that looks nothing like "no key configured".
  const secret = typeof data === "string" ? data.trim() : "";
  return secret.length > 0 ? secret : null;
}

export async function storeAiVaultSecret(
  supabase: SupabaseClient,
  userId: string,
  plaintext: string,
  existingSecretId?: string | null,
): Promise<string> {
  const secret = plaintext.trim();
  if (!secret) throw new Error("AI provider key cannot be empty.");
  const { data, error } = await supabase.rpc("repo_finisher_store_ai_secret", {
    p_user_id: userId,
    p_secret: secret,
    p_existing_secret_id: existingSecretId || null,
  });
  if (error) throw new Error(`Failed to store AI credential in Vault: ${error.message}`);
  const id = normalizeSecretId(data);
  if (!id) throw new Error("Supabase Vault did not return a valid secret reference.");
  return id;
}

export async function deleteAiVaultSecret(
  supabase: SupabaseClient,
  userId: string,
  secretId?: string | null,
): Promise<void> {
  if (!secretId) return;
  const { error } = await supabase.rpc("repo_finisher_delete_ai_secret", {
    p_user_id: userId,
    p_secret_id: secretId,
  });
  if (error) throw new Error(`Failed to remove AI credential from Vault: ${error.message}`);
}
