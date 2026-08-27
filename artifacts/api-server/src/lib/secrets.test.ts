import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = Buffer.alloc(32, 7).toString("base64");

async function loadSecrets(key: string | undefined) {
  vi.resetModules();
  if (key === undefined) delete process.env["SECRET_ENCRYPTION_KEY"];
  else process.env["SECRET_ENCRYPTION_KEY"] = key;
  return import("./secrets");
}

describe("secret sealing", () => {
  beforeEach(() => {
    delete process.env["AI_KEY_ENCRYPTION_KEY"];
  });

  it("round-trips a secret", async () => {
    const { encryptSecret, decryptSecret } = await loadSecrets(KEY);
    const sealed = encryptSecret("ghp_supersecret");
    expect(sealed).not.toContain("ghp_supersecret");
    expect(decryptSecret(sealed)).toBe("ghp_supersecret");
  });

  it("produces a different ciphertext each time", async () => {
    const { encryptSecret } = await loadSecrets(KEY);
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("passes legacy plaintext through so existing rows keep working", async () => {
    const { decryptSecret, isEncrypted } = await loadSecrets(KEY);
    expect(isEncrypted("sk-plain-legacy")).toBe(false);
    expect(decryptSecret("sk-plain-legacy")).toBe("sk-plain-legacy");
  });

  it("returns null for an absent secret", async () => {
    const { decryptSecret } = await loadSecrets(KEY);
    expect(decryptSecret(null)).toBeNull();
    expect(decryptSecret("")).toBeNull();
  });

  it("refuses a tampered ciphertext rather than returning partial plaintext", async () => {
    const { encryptSecret, decryptSecret } = await loadSecrets(KEY);
    const sealed = encryptSecret("ghp_supersecret");
    const parts = sealed.split(".");
    const flipped = Buffer.from(parts[3]!, "base64url");
    flipped[0] = (flipped[0]! ^ 0xff) & 0xff;
    parts[3] = flipped.toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("refuses a secret sealed under a different key", async () => {
    const { encryptSecret } = await loadSecrets(KEY);
    const sealed = encryptSecret("ghp_supersecret");
    const { decryptSecret } = await loadSecrets(Buffer.alloc(32, 9).toString("base64"));
    expect(() => decryptSecret(sealed)).toThrow();
  });

  it("rejects a key that is not 32 bytes", async () => {
    const { encryptSecret, secretsConfigured } = await loadSecrets(Buffer.alloc(16, 1).toString("base64"));
    expect(secretsConfigured()).toBe(false);
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
  });

  it("reports unconfigured rather than throwing at import time", async () => {
    const { secretsConfigured } = await loadSecrets(undefined);
    expect(secretsConfigured()).toBe(false);
  });
});
