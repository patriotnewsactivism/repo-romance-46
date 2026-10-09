import { useCallback, useEffect, useRef, useState } from 'react';
import { extendRateLimitCooldown, readRateLimitCooldown, type RateLimitCooldown } from '@/lib/api-rate-limit';

/** Keep retry deadlines in memory; credentials and drafts never enter this state. */
export function useRateLimitCooldown() {
  const sharedRef = useRef<RateLimitCooldown | null>(null);
  const providerRef = useRef<RateLimitCooldown | null>(null);
  const [now, setNow] = useState(Date.now);
  const [shared, setShared] = useState<RateLimitCooldown | null>(null);
  const [provider, setProvider] = useState<RateLimitCooldown | null>(null);

  const recordRateLimit = useCallback((error: unknown) => {
    const cooldown = readRateLimitCooldown(error);
    if (!cooldown) return null;
    if (cooldown.scope === 'provider') {
      providerRef.current = extendRateLimitCooldown(providerRef.current, cooldown);
      setProvider(providerRef.current);
    } else {
      sharedRef.current = extendRateLimitCooldown(sharedRef.current, cooldown);
      setShared(sharedRef.current);
    }
    setNow(Date.now());
    return cooldown;
  }, []);

  const sharedSeconds = Math.max(0, Math.ceil(((shared?.retryAt ?? 0) - now) / 1000));
  const providerSeconds = Math.max(0, Math.ceil(((provider?.retryAt ?? 0) - now) / 1000));
  const ticking = sharedSeconds > 0 || providerSeconds > 0;
  useEffect(() => {
    if (!ticking) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [ticking]);

  return {
    recordRateLimit,
    sharedSeconds,
    providerSeconds,
    sharedScope: shared?.scope,
    // Check the refs as well as disabled buttons to guard rapid repeated clicks.
    canRequestApi: useCallback(() => Date.now() >= (sharedRef.current?.retryAt ?? 0), []),
    canTestProvider: useCallback(() => Date.now() >= Math.max(
      sharedRef.current?.retryAt ?? 0, providerRef.current?.retryAt ?? 0,
    ), []),
  };
}
