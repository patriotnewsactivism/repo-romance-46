/**
 * Secrets at rest.
 *
 * User-supplied AI provider keys and GitHub tokens were stored as plaintext in
 * Supabase and read straight back out — `GET /preferences` even returned the
 * AI key to the browser. Both are now sealed with AES-256-GCM before they are
 * persisted, and the key is never returned to a client again: the API reports
 * only whether one is set.
 *
 * Rows written before this change are still plaintext. `decryptSecret` passes
 * those through unchanged so nothing breaks mid-migration; they are re-sealed
 * the next time the user saves.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config, requireConfig } from "./config";

// Single dot-free token: the envelope is split on ".", so a prefix containing
// a dot would shift every field by one.
const ENVELOPE_PREFIX = "enc1";
const IV_BYTES = 12;

function keyBuffer(): Buffer {
  const raw = requireConfig(config.secretEncryptionKey, "SECRET_ENCRYPTION_KEY");
  const buf = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw Object.assign(
      new Error("SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 or hex)"),
      { status: 500 },
    );
  }
  return buf;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(`${ENVELOPE_PREFIX}.`);
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyBuffer(), iv);
  const sealed = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_PREFIX, iv.toString("base64url"), tag.toString("base64url"), sealed.toString("base64url")].join(".");
}

/**
 * Unseal a stored secret. Legacy plaintext is returned unchanged; a value that
 * claims to be sealed but fails authentication throws rather than leaking a
 * partially decrypted result.
 */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!isEncrypted(stored)) return stored;

  const [, ivPart, tagPart, dataPart] = stored.split(".");
  if (!ivPart || !tagPart || !dataPart) {
    throw Object.assign(new Error("Stored secret is malformed"), { status: 500 });
  }

  const decipher = createDecipheriv("aes-256-gcm", keyBuffer(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, "base64url")), decipher.final()]).toString("utf8");
}

/** True when encryption is available; features can degrade rather than crash. */
export function secretsConfigured(): boolean {
  try {
    keyBuffer();
    return true;
  } catch {
    return false;
  }
}
