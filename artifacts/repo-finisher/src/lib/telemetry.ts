import { supabase } from '@/integrations/supabase/client';

type ClientErrorKind = 'react' | 'window-error' | 'unhandled-rejection';

interface ClientErrorContext {
  kind: ClientErrorKind;
  componentStack?: string;
}

const apiBaseUrl = ((import.meta.env.VITE_API_BASE_URL as string | undefined) || '').replace(/\/$/, '');
const endpoint = `${apiBaseUrl}/api/observability/client-error`;
const recentlyReported = new Map<string, number>();
const DEDUPE_WINDOW_MS = 10_000;
let handlersInstalled = false;

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error('Unknown client error');
  }
}

function currentRoute(): string {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname.slice(0, 500);
}

function shouldReport(fingerprint: string): boolean {
  const now = Date.now();
  const last = recentlyReported.get(fingerprint) || 0;
  if (now - last < DEDUPE_WINDOW_MS) return false;
  recentlyReported.set(fingerprint, now);

  if (recentlyReported.size > 100) {
    for (const [key, timestamp] of recentlyReported.entries()) {
      if (now - timestamp > DEDUPE_WINDOW_MS) recentlyReported.delete(key);
    }
  }
  return true;
}

export async function reportClientError(error: unknown, context: ClientErrorContext): Promise<void> {
  const normalized = normalizeError(error);
  const route = currentRoute();
  const fingerprint = `${context.kind}|${normalized.name}|${normalized.message}|${route}`;
  if (!shouldReport(fingerprint)) return;

  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        kind: context.kind,
        message: normalized.message.slice(0, 1000),
        name: normalized.name.slice(0, 120),
        stack: normalized.stack?.slice(0, 6000),
        component_stack: context.componentStack?.slice(0, 6000),
        route,
      }),
      keepalive: true,
    });
  } catch {
    // Telemetry must never become a second application failure path.
  }
}

export function installGlobalErrorHandlers(): void {
  if (handlersInstalled || typeof window === 'undefined') return;
  handlersInstalled = true;

  window.addEventListener('error', (event) => {
    void reportClientError(event.error || event.message, { kind: 'window-error' });
  });

  window.addEventListener('unhandledrejection', (event) => {
    void reportClientError(event.reason, { kind: 'unhandled-rejection' });
  });
}
