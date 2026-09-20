import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { deleteAiVaultSecret, readAiVaultSecret, storeAiVaultSecret } from "./ai-secret-store";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SECRET_ID = "22222222-2222-4222-8222-222222222222";

function clientWithRpc(result: { data?: unknown; error?: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("provider-scoped AI Vault operations", () => {
  it("stores a key under the selected provider", async () => {
    const { client, rpc } = clientWithRpc({ data: SECRET_ID });

    await expect(storeAiVaultSecret(client, USER_ID, "google", "  google-key  ")).resolves.toBe(SECRET_ID);
    expect(rpc).toHaveBeenCalledWith("repo_finisher_store_ai_provider_secret", {
      p_user_id: USER_ID,
      p_provider: "google",
      p_secret: "google-key",
      p_existing_secret_id: null,
    });
  });

  it("reads only through the selected provider RPC", async () => {
    const { client, rpc } = clientWithRpc({ data: "  openrouter-key  " });

    await expect(readAiVaultSecret(client, USER_ID, "openrouter", SECRET_ID)).resolves.toBe("openrouter-key");
    expect(rpc).toHaveBeenCalledWith("repo_finisher_read_ai_provider_secret", {
      p_user_id: USER_ID,
      p_provider: "openrouter",
      p_secret_id: SECRET_ID,
    });
  });

  it("deletes only the selected provider credential", async () => {
    const { client, rpc } = clientWithRpc({});

    await deleteAiVaultSecret(client, USER_ID, "anthropic", SECRET_ID);
    expect(rpc).toHaveBeenCalledWith("repo_finisher_delete_ai_provider_secret", {
      p_user_id: USER_ID,
      p_provider: "anthropic",
      p_secret_id: SECRET_ID,
    });
  });

  it("rejects unsupported provider names before touching Vault", async () => {
    const { client, rpc } = clientWithRpc({ data: SECRET_ID });

    await expect(storeAiVaultSecret(client, USER_ID, "made-up", "key")).rejects.toThrow("Unsupported AI provider");
    expect(rpc).not.toHaveBeenCalled();
  });
});
