/**
 * Password and session-token primitives for first-party auth.
 *
 * Deliberately dependency-free: scrypt and SHA-256 ship with Node, so there is
 * no native build step and nothing extra to audit.
 */
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, saltPart, hashPart] = stored.split("$");
  if (scheme !== "scrypt" || !saltPart || !hashPart) return false;

  const expected = Buffer.from(hashPart, "base64url");
  const derived = await scryptAsync(password, Buffer.from(saltPart, "base64url"), KEY_LENGTH);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** Opaque session token handed to the browser; only its hash is stored. */
export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const SESSION_TTL_DAYS = 30;

export function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}
