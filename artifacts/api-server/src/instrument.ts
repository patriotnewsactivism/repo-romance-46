import type { Express } from "express";
import * as Sentry from "@sentry/node";

const DEFAULT_TRACE_SAMPLE_RATE = 0.05;
const SECRET_FIELD =
  /authorization|cookie|token|api[-_]?key|secret|password|credential|session/i;
const REDACTED = "[Filtered]";

export function parseSampleRate(
  raw: string | undefined,
  fallback = DEFAULT_TRACE_SAMPLE_RATE,
): number {
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
}

/** Remove query strings and fragments before a URL reaches telemetry. */
export function sanitizeUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  try {
    const url = new URL(raw, "https://telemetry.invalid");
    if (url.origin === "https://telemetry.invalid") return url.pathname;
    return `${url.origin}${url.pathname}`;
  } catch {
    return raw.split(/[?#]/, 1)[0];
  }
}

/**
 * Recursively redact secret-bearing keys from explicitly attached context.
 * Depth and array limits prevent telemetry scrubbing from becoming a second
 * unbounded serializer on an already-failing request.
 */
export function scrubTelemetry(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[Truncated]";
  if (Array.isArray(value))
    return value.slice(0, 50).map((entry) => scrubTelemetry(entry, depth + 1));
  if (!value || typeof value !== "object") return value;

  const clean: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(
    value as Record<string, unknown>,
  ).slice(0, 100)) {
    clean[key] = SECRET_FIELD.test(key)
      ? REDACTED
      : scrubTelemetry(entry, depth + 1);
  }
  return clean;
}

const dsn = process.env["SENTRY_DSN"]?.trim() || "";
const tracesSampleRate = parseSampleRate(
  process.env["SENTRY_TRACES_SAMPLE_RATE"],
);

export const sentryEnabled = Boolean(dsn);
export const sentryEnvironment =
  process.env["SENTRY_ENVIRONMENT"] ||
  process.env["VERCEL_ENV"] ||
  process.env["NODE_ENV"] ||
  "development";
export const sentryRelease =
  process.env["SENTRY_RELEASE"] ||
  process.env["VERCEL_GIT_COMMIT_SHA"] ||
  undefined;

if (sentryEnabled) {
  Sentry.init({
    dsn,
    environment: sentryEnvironment,
    release: sentryRelease,
    sendDefaultPii: false,
    tracesSampleRate,
    beforeSend(event) {
      if (event.request) {
        event.request.url = sanitizeUrl(event.request.url);
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.query_string;
        event.request.headers = scrubTelemetry(event.request.headers) as Record<
          string,
          string
        >;
      }
      if (event.user) {
        event.user = event.user.id ? { id: String(event.user.id) } : undefined;
      }
      if (event.extra)
        event.extra = scrubTelemetry(event.extra) as Record<string, unknown>;
      return event;
    },
    beforeSendTransaction(event) {
      if (event.request) {
        event.request.url = sanitizeUrl(event.request.url);
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.query_string;
        event.request.headers = scrubTelemetry(event.request.headers) as Record<
          string,
          string
        >;
      }
      return event;
    },
  });
}

interface CaptureContext {
  tags?: Record<string, string | number | boolean | null | undefined>;
  extra?: Record<string, unknown>;
}

export function captureException(
  error: unknown,
  context: CaptureContext = {},
): void {
  if (!sentryEnabled) return;

  const normalized = error instanceof Error ? error : new Error(String(error));
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context.tags ?? {})) {
      if (value !== null && value !== undefined && !SECRET_FIELD.test(key)) {
        scope.setTag(key, String(value).slice(0, 200));
      }
    }

    const extras = scrubTelemetry(context.extra ?? {}) as Record<
      string,
      unknown
    >;
    if (Object.keys(extras).length > 0) scope.setExtras(extras);
    Sentry.captureException(normalized);
  });
}

/** Install Sentry after application routes and before the final app error handler. */
export function installExpressErrorHandler(app: Express): void {
  if (sentryEnabled) Sentry.setupExpressErrorHandler(app);
}

export function getSentryStatus() {
  return {
    enabled: sentryEnabled,
    environment: sentryEnvironment,
    release: sentryRelease ?? null,
    traces_sample_rate: tracesSampleRate,
  };
}

export async function flushSentry(timeoutMs = 1500): Promise<boolean> {
  if (!sentryEnabled) return true;
  return Sentry.flush(timeoutMs);
}
