export type RateLimitScope = 'api' | 'provider' | 'unknown';

export interface RateLimitCooldown {
  retryAt: number;
  scope: RateLimitScope;
}

const DEFAULT_RETRY_DELAY_MS = 60_000;

function secondsToDelay(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

/** The server's Retry-After takes priority, including HTTP-date values. */
export function readRateLimitCooldown(error: unknown, now = Date.now()): RateLimitCooldown | null {
  if (!error || typeof error !== 'object' || !('status' in error) || error.status !== 429) return null;
  const data = 'data' in error && error.data && typeof error.data === 'object'
    ? error.data as Record<string, unknown>
    : {};
  const headers = 'headers' in error && error.headers instanceof Headers ? error.headers : null;
  let delay: number | null = null;
  const retryAfter = headers?.get('Retry-After')?.trim();
  if (retryAfter) {
    delay = secondsToDelay(retryAfter);
    if (delay === null && !/^[-+]?\d/.test(retryAfter)) {
      const date = Date.parse(retryAfter);
      if (Number.isFinite(date)) delay = Math.max(0, date - now);
    }
  }
  if (delay === null) {
    // express-rate-limit's draft-7 header: limit=120, remaining=0, reset=25.
    const rateLimit = headers?.get('RateLimit') || '';
    const resets = [...rateLimit.matchAll(/(?:^|[,;])\s*(?:reset|t)\s*=\s*"?(\d+(?:\.\d+)?)"?(?=\s*(?:[,;]|$))/gi)]
      .map((match) => secondsToDelay(match[1]) ?? 0);
    if (resets.length) delay = Math.max(...resets);
  }
  delay ??= secondsToDelay(data.retry_after) ?? DEFAULT_RETRY_DELAY_MS;
  return {
    retryAt: now + delay,
    scope: data.code === 'API_RATE_LIMITED' ? 'api'
      : data.code === 'AI_PROVIDER_RATE_LIMITED' ? 'provider' : 'unknown',
  };
}

/** Concurrent failures must never shorten a cooldown already in progress. */
export function extendRateLimitCooldown(
  current: RateLimitCooldown | null,
  incoming: RateLimitCooldown,
): RateLimitCooldown {
  return current && current.retryAt > incoming.retryAt ? current : incoming;
}
