/**
 * Validated runtime configuration.
 *
 * Reading `process.env` inline hid two real problems: the server booted with
 * Supabase unconfigured and only failed on the first authenticated request,
 * and secret-bearing features silently degraded instead of refusing to start.
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
  "https://repofinisher-web-z6kubh2jtq-uc.a.run.app",
  "https://repofinisher.donmatthews.live",
] as const;

function corsAllowedOrigins(): string[] {
  const configured = env("CORS_ALLOWED_ORIGINS")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // These are exact first-party RepoFinisher frontends, not a wildcard. Keeping
  // the direct Cloud Run URL and canonical custom domain here means a malformed
  // hosting env var cannot silently lock the SPA out of its API.
  return [...new Set([...KNOWN_FRONTEND_ORIGINS, ...configured])];
}

export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** HMAC key for signing change plans. Required before any repository write. */
  planSigningSecret: string;
  /** AES-256-GCM key (32 bytes, base64 or hex) for secrets at rest. */
  secretEncryptionKey: string;
  /** Exact origins allowed to call this API. */
  corsAllowedOrigins: string[];
}

export function loadConfig(): AppConfig {
  const nodeEnv = process.env["NODE_ENV"] ?? "development";
  return {
    nodeEnv,
    isProduction: nodeEnv === "production",
    supabaseUrl: normalizeUrl(env("SUPABASE_URL", "VITE_SUPABASE_URL")),
    supabaseAnonKey: env("SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"),
    planSigningSecret: env("PLAN_SIGNING_SECRET"),
    secretEncryptionKey: env("SECRET_ENCRYPTION_KEY", "AI_KEY_ENCRYPTION_KEY"),
    corsAllowedOrigins: corsAllowedOrigins(),
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
