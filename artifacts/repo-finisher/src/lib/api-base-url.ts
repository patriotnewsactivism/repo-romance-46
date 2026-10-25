const productionApiOrigin = 'https://api.portfolio.donmatthews.live';
const localHostnames = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Ignore stale build variables that still point at decommissioned hosts. */
export function resolveApiBaseUrl(configured: string | undefined, hostname: string | undefined) {
  const local = hostname !== undefined && localHostnames.has(hostname);
  if (configured?.trim()) {
    try {
      const url = new URL(configured.trim());
      const retired = url.hostname.endsWith('.railway.app') || url.hostname.endsWith('.run.app');
      const secure = url.protocol === 'https:' || (url.protocol === 'http:' && localHostnames.has(url.hostname));
      if (!retired && secure && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) {
        return url.origin;
      }
    } catch { /* Fall back to the canonical API or the local development proxy. */ }
  }
  return local ? undefined : productionApiOrigin;
}

export const apiBaseUrl = resolveApiBaseUrl(
  import.meta.env.VITE_API_BASE_URL as string | undefined,
  typeof window === 'undefined' ? undefined : window.location.hostname,
);
