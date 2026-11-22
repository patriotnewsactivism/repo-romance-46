import type { SupabaseClient } from "@workspace/db";
import { describe, expect, it, vi } from "vitest";

const KEY = Buffer.alloc(32, 7).toString("base64");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const SECRET_ID = "22222222-2222-4222-8222-222222222222";

/**
 * The store seals keys with SECRET_ENCRYPTION_KEY, which `config` resolves at
 * import time — so the module is re-imported per test after the key is set.
 */
async function loadStore() {
  vi.resetModules();
  delete process.env["AI_KEY_ENCRYPTION_KEY"];
  process.env["SECRET_ENCRYPTION_KEY"] = KEY;
  return import("./ai-secret-store");
}

interface SelectCall {
  table: string;
  columns: string;
  filters: Record<string, unknown>;
}
interface WriteCall {
  table: string;
  filters: Record<string, unknown>;
}

function fakeClient(options: { data?: unknown; error?: { message: string } | null } = {}) {
  const selects: SelectCall[] = [];
  const upserts: Array<{ table: string; row: Record<string, unknown>; options: unknown }> = [];
  const deletes: WriteCall[] = [];

  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          const filters: Record<string, unknown> = {};
          const chain = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return chain;
            },
            maybeSingle: async () => {
              selects.push({ table, columns, filters });
              return { data: options.data ?? null, error: options.error ?? null };
            },
          };
          return chain;
        },
        upsert(row: Record<string, unknown>, upsertOptions: unknown) {
          upserts.push({ table, row, options: upsertOptions });
          return Promise.resolve({ error: options.error ?? null });
        },
        delete() {
          const filters: Record<string, unknown> = {};
          const chain: any = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return chain;
            },
            then(onFulfilled: (value: unknown) => unknown) {
              deletes.push({ table, filters });
              return Promise.resolve({ error: options.error ?? null }).then(onFulfilled);
            },
          };
          return chain;
        },
      };
    },
  };

  return { client: client as unknown as SupabaseClient, selects, upserts, deletes };
}

describe("provider-scoped AI credential storage", () => {
  it("seals the key and upserts one row per user and provider", async () => {
    const { storeAiVaultSecret } = await loadStore();
    const { client, upserts } = fakeClient();

    const secretId = await storeAiVaultSecret(client, USER_ID, "Google", "  google-key  ");

    expect(secretId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(upserts).toHaveLength(1);
    const [{ table, row, options }] = upserts;
    expect(table).toBe("ai_provider_credentials");
    expect(options).toEqual({ onConflict: "user_id,provider" });
    expect(row["user_id"]).toBe(USER_ID);
    expect(row["provider"]).toBe("google");
    expect(row["vault_secret_id"]).toBe(secretId);
    const sealed = String(row["encrypted_secret"]);
    expect(sealed.startsWith("enc1.")).toBe(true);
    expect(sealed).not.toContain("google-key");
  });

  it("reuses an existing row id instead of minting a new one", async () => {
    const { storeAiVaultSecret } = await loadStore();
    const { client, upserts } = fakeClient();

    await expect(storeAiVaultSecret(client, USER_ID, "openrouter", "key", SECRET_ID)).resolves.toBe(SECRET_ID);
    expect(upserts[0]?.row["vault_secret_id"]).toBe(SECRET_ID);
  });

  it("rejects a blank key before touching the database", async () => {
    const { storeAiVaultSecret } = await loadStore();
    const { client, upserts } = fakeClient();

    await expect(storeAiVaultSecret(client, USER_ID, "google", "   ")).rejects.toThrow(
      /cannot be empty/i,
    );
    expect(upserts).toHaveLength(0);
  });

  it("rejects an unsupported provider before touching the database", async () => {
    const { storeAiVaultSecret } = await loadStore();
    const { client, upserts } = fakeClient();

    await expect(storeAiVaultSecret(client, USER_ID, "made-up", "key")).rejects.toThrow(
      /Unsupported AI provider/i,
    );
    expect(upserts).toHaveLength(0);
  });

  it("round-trips a stored key through the read path", async () => {
    const { readAiVaultSecret, storeAiVaultSecret } = await loadStore();
    const writer = fakeClient();
    await storeAiVaultSecret(writer.client, USER_ID, "anthropic", "  sk-ant-test  ");
    const sealed = writer.upserts[0]?.row["encrypted_secret"];

    const reader = fakeClient({ data: { encrypted_secret: sealed } });
    await expect(readAiVaultSecret(reader.client, USER_ID, "anthropic", SECRET_ID)).resolves.toBe(
      "sk-ant-test",
    );
    expect(reader.selects[0]?.filters).toEqual({
      user_id: USER_ID,
      provider: "anthropic",
      vault_secret_id: SECRET_ID,
    });
  });

  it("returns null without a query when no secret id is recorded", async () => {
    const { readAiVaultSecret } = await loadStore();
    const { client, selects } = fakeClient({ data: { encrypted_secret: "enc1.x.y.z" } });

    await expect(readAiVaultSecret(client, USER_ID, "google", null)).resolves.toBeNull();
    expect(selects).toHaveLength(0);
  });

  it("treats a whitespace-only stored value as no credential", async () => {
    const { readAiVaultSecret } = await loadStore();
    const { client } = fakeClient({ data: { encrypted_secret: "   " } });

    await expect(readAiVaultSecret(client, USER_ID, "google", SECRET_ID)).resolves.toBeNull();
  });

  it("surfaces a database error with the provider named", async () => {
    const { readAiVaultSecret } = await loadStore();
    const { client } = fakeClient({ data: null, error: { message: "connection reset" } });

    await expect(readAiVaultSecret(client, USER_ID, "google", SECRET_ID)).rejects.toThrow(
      /Failed to read google credential: connection reset/,
    );
  });

  it("deletes only the selected provider credential", async () => {
    const { deleteAiVaultSecret } = await loadStore();
    const { client, deletes } = fakeClient();

    await deleteAiVaultSecret(client, USER_ID, "anthropic", SECRET_ID);

    expect(deletes).toEqual([
      { table: "ai_provider_credentials", filters: { user_id: USER_ID, provider: "anthropic" } },
    ]);
  });

  it("does nothing when there is no credential to delete", async () => {
    const { deleteAiVaultSecret } = await loadStore();
    const { client, deletes } = fakeClient();

    await expect(deleteAiVaultSecret(client, USER_ID, "anthropic", null)).resolves.toBeUndefined();
    expect(deletes).toHaveLength(0);
  });
});

describe("Qwen provider", () => {
  // Regression: a hardcoded provider allowlist in this module rejected Qwen
  // before the write could reach the database, so BYOK was unusable even
  // though Settings and the preferences API both accepted the provider.
  it("stores a Qwen key under the qwen provider", async () => {
    const { storeAiVaultSecret } = await loadStore();
    const { client, upserts } = fakeClient();

    await expect(storeAiVaultSecret(client, USER_ID, "QWEN", "  qwen-key  ")).resolves.toMatch(
      /^[0-9a-f-]{36}$/i,
    );
    expect(upserts[0]?.row["provider"]).toBe("qwen");
  });

  it("still rejects a provider that is genuinely unsupported", async () => {
    const { storeAiVaultSecret } = await loadStore();
    const { client } = fakeClient();

    await expect(storeAiVaultSecret(client, USER_ID, "not-a-provider", "key")).rejects.toThrow(
      /Unsupported AI provider/i,
    );
  });
});
