import type { ReactElement, ReactNode } from "react";
import * as Sentry from "@sentry/react";

const dsn =
  (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim() ?? "";

function parseSampleRate(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function sanitizeRequestUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  try {
    const url = new URL(raw, window.location.origin);
    return `${url.origin}${url.pathname}`;
  } catch {
    return raw.split(/[?#]/, 1)[0];
  }
}

function traceTargets(): Array<string | RegExp> {
  const targets: Array<string | RegExp> = [/^\//, window.location.origin];
  const apiBase = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (apiBase) {
    try {
      targets.push(new URL(apiBase, window.location.origin).origin);
    } catch {
      // Invalid API configuration will fail normally; do not broaden tracing.
    }
  }
  return [...new Set(targets)];
}

export const browserSentryEnabled = Boolean(dsn);

if (browserSentryEnabled) {
  Sentry.init({
    dsn,
    environment:
      (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) ||
      (import.meta.env.MODE === "production"
        ? "production"
        : import.meta.env.MODE),
    release:
      typeof __SENTRY_RELEASE__ === "string" && __SENTRY_RELEASE__
        ? __SENTRY_RELEASE__
        : undefined,
    sendDefaultPii: false,
    tracesSampleRate: parseSampleRate(
      import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE as string | undefined,
      0.05,
    ),
    tracePropagationTargets: traceTargets(),
    integrations: [Sentry.browserTracingIntegration()],
    beforeSend(event) {
      if (event.request) {
        event.request.url = sanitizeRequestUrl(event.request.url);
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.query_string;
        delete event.request.headers;
      }
      if (event.user)
        event.user = event.user.id ? { id: String(event.user.id) } : undefined;
      return event;
    },
    beforeSendTransaction(event) {
      if (event.request) {
        event.request.url = sanitizeRequestUrl(event.request.url);
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.query_string;
        delete event.request.headers;
      }
      return event;
    },
  });
}

function shouldReport(error: unknown): boolean {
  if (!browserSentryEnabled) return false;
  if (!error || typeof error !== "object") return true;
  const status = (error as { status?: unknown }).status;
  return typeof status !== "number" || status >= 500;
}

export function captureOperationalError(
  error: unknown,
  operation: string,
): void {
  if (!shouldReport(error)) return;
  Sentry.withScope((scope) => {
    scope.setTag("operation", operation.slice(0, 120));
    Sentry.captureException(
      error instanceof Error ? error : new Error(String(error)),
    );
  });
}

export function setSentryUser(userId: string | null): void {
  if (!browserSentryEnabled) return;
  Sentry.setUser(userId ? { id: userId } : null);
}

export function setSentryRoute(route: string): void {
  if (!browserSentryEnabled) return;
  Sentry.setTag("route", route.split(/[?#]/, 1)[0].slice(0, 200));
}

function CrashFallback({
  resetError,
}: {
  error: unknown;
  resetError: () => void;
}): ReactElement {
  return (
    <main className="min-h-screen bg-background text-foreground grid place-items-center p-6">
      <section className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-xl">
        <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          RepoFinisher recovery
        </p>
        <h1 className="mt-2 text-2xl font-semibold">
          The interface hit an unexpected error.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The failure was recorded without repository contents, credentials, or
          request bodies. Retry the interface; your approved repository changes
          were not automatically re-run.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            onClick={resetError}
          >
            Try again
          </button>
          <button
            className="rounded-md border border-border px-4 py-2 text-sm font-medium"
            onClick={() => window.location.reload()}
          >
            Reload app
          </button>
        </div>
      </section>
    </main>
  );
}

export function SentryErrorBoundary({ children }: { children: ReactNode }) {
  if (!browserSentryEnabled) return children;
  return (
    <Sentry.ErrorBoundary fallback={CrashFallback}>
      {children}
    </Sentry.ErrorBoundary>
  );
}
