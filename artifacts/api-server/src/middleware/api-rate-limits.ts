import { createHmac, randomBytes } from "node:crypto";
import type { Express, Request } from "express";
import cors from "cors";
import rateLimit, { type RateLimitInfo } from "express-rate-limit";

export const API_RATE_LIMITS = { global: 300, expensive: 10, telemetry: 30 } as const;
export const API_RATE_LIMIT_WINDOW_MS = 60_000;
export const API_RATE_LIMIT_EXPOSED_HEADERS = ["Retry-After", "RateLimit", "RateLimit-Policy"];

type LimiterCategory = keyof typeof API_RATE_LIMITS;
type DiagnosticLogger = { warn: (fields: Record<string, unknown>, message: string) => void };

// This key is never persisted or logged. Bucket IDs correlate only within one
// API process lifetime, across its routes and rate-limit windows.
const diagnosticKey = randomBytes(32);

const fixedPaths = new Set([
  "/api/healthz",
  "/api/preferences",
  "/api/preferences/ai",
  "/api/preferences/ai-status",
  "/api/preferences/ai-test",
  "/api/preferences/openrouter-models",
  "/api/observability/client-error",
  "/api/github/connect",
  "/api/github/connection",
  "/api/github/status",
  "/api/github/portfolio-summary",
  "/api/analysis",
  "/api/analysis/run",
  "/api/repo-finisher/runs",
  "/api/repo-finisher/external-prompts",
  "/api/repo-finisher/completion-sessions",
  "/api/repo-finisher/portfolio-runs",
  "/api/repo-finisher/portfolio-graph",
  "/api/repo-finisher/preview",
  "/api/repo-finisher/agentic-preview",
  "/api/repo-finisher/agentic-preview-async",
  "/api/repo-finisher/external-prompt",
  "/api/repo-finisher/finish",
  "/api/repo-finisher/status",
]);

const diagnosticFamilies = new Set([
  "preferences", "observability", "github", "analysis", "repo-finisher",
  "valuation", "investment-intelligence", "portfolio-intelligence",
  "portfolio-valuation-v2", "vibe-tools", "repo-growth-tools", "investor-report", "public",
]);

/** Only return bounded, known route labels; never arbitrary URL segments. */
export function normalizeRateLimitPath(url: string): string {
  const path = url.split(/[?#]/, 1)[0].replace(/\/+$/, "");
  if (fixedPaths.has(path)) return path;

  const history = path.match(/^\/api\/repo-finisher\/(runs|external-prompts|completion-sessions|portfolio-runs|async-jobs)\/[^/]+(?:\/(approve|execute|cancel|resume|retry-iteration|repair-policy|self-heal))?$/);
  if (history) return `/api/repo-finisher/${history[1]}/:id${history[2] ? `/${history[2]}` : ""}`;
  const analysis = path.match(/^\/api\/analysis\/[^/]+(?:\/(share|rerun|action-plan|merge-instructions))?$/);
  if (analysis) return `/api/analysis/:id${analysis[1] ? `/${analysis[1]}` : ""}`;
  const repository = path.match(/^\/api\/repo-finisher\/(assurance|learning)\/[^/]+\/[^/]+$/);
  if (repository) return `/api/repo-finisher/${repository[1]}/:owner/:repo`;

  const family = path.match(/^\/api\/([^/]+)(?:\/|$)/)?.[1];
  return family && diagnosticFamilies.has(family) ? `/api/${family}/:unmatched` : "/api/:unmatched";
}

/** Expose cooldown metadata only to the existing exact CORS origin allowlist. */
export function apiCors(allowedOrigins: readonly string[]) {
  return cors({
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.includes(origin));
    },
    credentials: true,
    exposedHeaders: API_RATE_LIMIT_EXPOSED_HEADERS,
  });
}

export function rateLimitRetryAfter(resetTime: Date | undefined, windowMs: number, now = Date.now()): number {
  const resetMs = resetTime?.getTime();
  const milliseconds = resetMs !== undefined && Number.isFinite(resetMs) ? resetMs - now : windowMs;
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(milliseconds / 1_000)));
}

function proxyDiagnostics(req: Request) {
  const forwarded = req.headers["x-forwarded-for"];
  const entries = typeof forwarded === "string" ? forwarded.split(",").filter((entry) => entry.trim()).length : 0;
  return {
    request_ip_source: req.ips.length > 0 ? "trusted_forwarded" : "socket",
    trusted_forwarded_hops: req.ips.length,
    forwarded_header_present: forwarded !== undefined,
    forwarded_header_entries: entries,
    selected_ip_equals_socket_peer: req.ip === req.socket.remoteAddress,
  };
}

interface ApiRateLimitOptions {
  logger?: DiagnosticLogger;
  /** Testable windows/budgets. Production uses the unchanged defaults. */
  windowMs?: number;
  limits?: Partial<Record<LimiterCategory, number>>;
}

/** Keep all API limits before authentication; caller/header claims are not keys. */
export function installApiRateLimits(app: Express, options: ApiRateLimitOptions = {}) {
  const windowMs = options.windowMs ?? API_RATE_LIMIT_WINDOW_MS;
  const messages = {
    global: "Too many requests — slow down.",
    expensive: "Too many analysis or repository-write requests — try again in a minute.",
    telemetry: "Too many client error reports — slow down.",
  };

  const createLimiter = (category: LimiterCategory) => rateLimit({
    windowMs,
    limit: options.limits?.[category] ?? API_RATE_LIMITS[category],
    standardHeaders: "draft-7",
    legacyHeaders: false,
    ...(category === "expensive" ? {
      skip: (req: Request) => req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS",
    } : {}),
    handler(req, res) {
      const info = (req as Request & { rateLimit?: RateLimitInfo }).rateLimit;
      const retryAfter = rateLimitRetryAfter(info?.resetTime, windowMs);
      // Use the actual library key so IPv6 subnet buckets stay identical to
      // enforcement. Hashing req.ip itself would misleadingly split that bucket.
      const bucket = info?.key ? createHmac("sha256", diagnosticKey).update(info.key).digest("hex").slice(0, 24) : undefined;
      options.logger?.warn({
        event: "api_rate_limited",
        limiter: category,
        method: req.method,
        route: normalizeRateLimitPath(req.originalUrl),
        ...(bucket ? { ip_bucket: bucket } : {}),
        limit: info?.limit,
        used: info?.used,
        reset_at: info?.resetTime && Number.isFinite(info.resetTime.getTime()) ? info.resetTime.toISOString() : undefined,
        retry_after: retryAfter,
        ...proxyDiagnostics(req),
      }, "API request rate limited");
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        error: messages[category],
        code: "API_RATE_LIMITED",
        limiter: category,
        retry_after: retryAfter,
      });
    },
  });

  const global = createLimiter("global");
  const expensive = createLimiter("expensive");
  const telemetry = createLimiter("telemetry");
  app.use("/api", global);
  app.post("/api/preferences/ai-test", expensive);
  app.post("/api/observability/client-error", telemetry);
  app.use(
    ["/api/analysis", "/api/repo-finisher", "/api/vibe-tools", "/api/valuation", "/api/investment-intelligence"],
    expensive,
  );
  return { global, expensive, telemetry };
}
