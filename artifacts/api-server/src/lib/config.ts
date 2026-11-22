/**
 * Validated runtime configuration.
 *
 * Reading `process.env` inline hid two real problems: the server booted with
 * its data layer unconfigured and only failed on the first request, and
 * secret-bearing features silently degraded instead of refusing to start.
 * Everything the server needs is resolved and checked here.
 */

function normalizeUrl(raw: string): string {
  if (!raw) return "";
  return raw.startsWith("http") ? raw : `https://${raw}`;
}

function env(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return "";
}

const KNOWN_FRONTEND_ORIGINS = [
  "https://portfolio.donmatthews.live",
  "https://repo-romance-46-swart.vercel.app",
] as const;

function corsAllowedOrigins(): string[] {
  const configured = env("CORS_ALLOWED_ORIGINS")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return [...new Set([...KNOWN_FRONTEND_ORIGINS, ...configured])];
}

export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  /** Postgres connection string. The API is the only component that needs it. */
  databaseUrl: string;
  /** HMAC key for signing change plans. Required before any repository write. */
  planSigningSecret: string;
  /** AES-256-GCM key (32 bytes, base64 or hex) for secrets at rest. */
  secretEncryptionKey: string;
  /** Exact origins allowed to call this API. */
  corsAllowedOrigins: string[];
  /** Public origin of the web app. GitHub OAuth returns here after sign-in. */
  publicOrigin: string;
  /** GitHub OAuth app credentials (created by the operator, not in the repo). */
  githubClientId: string;
  githubClientSecret: string;
}

export function loadConfig(): AppConfig {
  const nodeEnv = process.env["NODE_ENV"] ?? "development";
  return {
    nodeEnv,
    isProduction: nodeEnv === "production",
    databaseUrl: env("DATABASE_URL"),
    planSigningSecret: env("PLAN_SIGNING_SECRET"),
    secretEncryptionKey: env("SECRET_ENCRYPTION_KEY", "AI_KEY_ENCRYPTION_KEY"),
    corsAllowedOrigins: corsAllowedOrigins(),
    publicOrigin: normalizeUrl(env("PUBLIC_ORIGIN")) || "http://localhost:3000",
    githubClientId: env("GITHUB_OAUTH_CLIENT_ID", "GITHUB_CLIENT_ID"),
    githubClientSecret: env("GITHUB_OAUTH_CLIENT_SECRET", "GITHUB_CLIENT_SECRET"),
  };
}

export const config: AppConfig = loadConfig();

/** Throw a 500-shaped error when a feature's required configuration is absent. */
export function requireConfig(value: string, name: string): string {
  if (!value) {
    throw Object.assign(new Error(`${name} is not configured on the server`), {
      status: 500,
    });
  }
  return value;
}
