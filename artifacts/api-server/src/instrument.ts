import * as Sentry from "@sentry/node";

const dsn = process.env["SENTRY_DSN"]?.trim() || "";
const rawSampleRate = Number(process.env["SENTRY_TRACES_SAMPLE_RATE"] ?? "0.05");
const tracesSampleRate = Number.isFinite(rawSampleRate)
  ? Math.max(0, Math.min(1, rawSampleRate))
  : 0.05;

export const sentryEnabled = Boolean(dsn);

if (sentryEnabled) {
  Sentry.init({
    dsn,
    environment:
      process.env["SENTRY_ENVIRONMENT"] ||
      process.env["VERCEL_ENV"] ||
      process.env["NODE_ENV"] ||
      "development",
    release: process.env["SENTRY_RELEASE"] || process.env["VERCEL_GIT_COMMIT_SHA"] || undefined,
    sendDefaultPii: false,
    tracesSampleRate,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.headers) {
          for (const key of Object.keys(event.request.headers)) {
            if (/authorization|cookie|token|api[-_]?key|secret/i.test(key)) {
              delete event.request.headers[key];
            }
          }
        }
      }
      return event;
    },
  });
}

interface CaptureContext {
  tags?: Record<string, string | number | boolean | null | undefined>;
  extra?: Record<string, unknown>;
}

const SECRET_FIELD = /authorization|cookie|token|api[-_]?key|secret|password|credential/i;

export function captureException(error: unknown, context: CaptureContext = {}): void {
  if (!sentryEnabled) return;

  const normalized = error instanceof Error ? error : new Error(String(error));
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context.tags ?? {})) {
      if (value !== null && value !== undefined && !SECRET_FIELD.test(key)) {
        scope.setTag(key, String(value).slice(0, 200));
      }
    }

    const extras: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context.extra ?? {})) {
      if (!SECRET_FIELD.test(key)) extras[key] = value;
    }
    if (Object.keys(extras).length > 0) scope.setExtras(extras);

    Sentry.captureException(normalized);
  });
}

export async function flushSentry(timeoutMs = 1500): Promise<boolean> {
  if (!sentryEnabled) return true;
  return Sentry.flush(timeoutMs);
}
