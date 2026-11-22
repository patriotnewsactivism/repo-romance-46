import type { SupabaseClient } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { DEFAULT_AI_MODELS } from "./ai-model-config";
import { decryptSecret, encryptSecret } from "./secrets";

/**
 * Derived from the canonical provider map rather than duplicated. A hardcoded
 * copy here silently rejected a newly added provider before its credential
 * could be stored, so adding a provider had to be remembered in four separate
 * places. Now it is one.
 */
const SUPPORTED_PROVIDERS = new Set<string>(Object.keys(DEFAULT_AI_MODELS));

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
 * BYOK storage.
 *
 * Supabase Vault held these keys; on self-hosted Postgres they are sealed with
 * AES-256-GCM under SECRET_ENCRYPTION_KEY and written to the user's own
 * `ai_provider_credentials` row. Provider is part of the identity, so a Google
 * key, OpenRouter key, OpenAI key and Anthropic key can coexist for the same
 * user. Changing the selected model never creates or rotates a credential.
 */
export async function readAiVaultSecret(
  supabase: SupabaseClient,
  userId: string,
  provider: string,
  secretId: string | null | undefined,
): Promise<string | null> {
  if (!secretId) return null;
  const normalizedProvider = normalizeProvider(provider);

  const { data, error } = await supabase
    .from<{ encrypted_secret: string | null }>("ai_provider_credentials")
    .select("encrypted_secret")
    .eq("user_id", userId)
    .eq("provider", normalizedProvider)
    .eq("vault_secret_id", secretId)
    .maybeSingle();

  if (error) throw new Error(`Failed to read ${normalizedProvider} credential: ${error.message}`);

  // A whitespace-only secret is not a usable credential: it is truthy, so it
  // would reach the provider as an empty bearer ****** and fail authentication
  // with an error that looks nothing like "no key configured".
  const secret = decryptSecret(data?.encrypted_secret)?.trim() ?? "";
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

  // The column keeps its historical name so existing rows and references stay
  // valid; it now holds a row identifier, not a Vault secret id.
  const secretId = normalizeSecretId(existingSecretId) ?? randomUUID();

  const { error } = await supabase.from("ai_provider_credentials").upsert(
    {
      user_id: userId,
      provider: normalizedProvider,
      vault_secret_id: secretId,
      encrypted_secret: encryptSecret(secret),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" },
  );

  if (error) throw new Error(`Failed to store ${normalizedProvider} credential: ${error.message}`);
  return secretId;
}

export async function deleteAiVaultSecret(
  supabase: SupabaseClient,
  userId: string,
  provider: string,
  secretId?: string | null,
): Promise<void> {
  if (!secretId) return;
  const normalizedProvider = normalizeProvider(provider);

  const { error } = await supabase
    .from("ai_provider_credentials")
    .delete()
    .eq("user_id", userId)
    .eq("provider", normalizedProvider);

  if (error) throw new Error(`Failed to remove ${normalizedProvider} credential: ${error.message}`);
}
