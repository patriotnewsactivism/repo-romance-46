import { createServiceSupabaseClient } from "./service-supabase";

function normalizeSecretId(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

export async function readAiVaultSecret(userId: string, secretId: string | null | undefined): Promise<string | null> {
  if (!secretId) return null;
  const service = createServiceSupabaseClient();
  const { data, error } = await service.rpc("repo_finisher_read_ai_secret", {
    p_user_id: userId,
    p_secret_id: secretId,
  });
  if (error) throw new Error(`Failed to read AI credential from Vault: ${error.message}`);
  return typeof data === "string" && data.length > 0 ? data : null;
}

export async function storeAiVaultSecret(
  userId: string,
  plaintext: string,
  existingSecretId?: string | null,
): Promise<string> {
  const secret = plaintext.trim();
  if (!secret) throw new Error("AI provider key cannot be empty.");
  const service = createServiceSupabaseClient();
  const { data, error } = await service.rpc("repo_finisher_store_ai_secret", {
    p_user_id: userId,
    p_secret: secret,
    p_existing_secret_id: existingSecretId || null,
  });
  if (error) throw new Error(`Failed to store AI credential in Vault: ${error.message}`);
  const id = normalizeSecretId(data);
  if (!id) throw new Error("Supabase Vault did not return a valid secret reference.");
  return id;
}

export async function deleteAiVaultSecret(userId: string, secretId?: string | null): Promise<void> {
  if (!secretId) return;
  const service = createServiceSupabaseClient();
  const { error } = await service.rpc("repo_finisher_delete_ai_secret", {
    p_user_id: userId,
    p_secret_id: secretId,
  });
  if (error) throw new Error(`Failed to remove AI credential from Vault: ${error.message}`);
}
