import type { Incident, Severity } from "./types.js";

export class ObserveError extends Error {}

type FetchLike = typeof fetch;

interface ComponentRow {
  component?: unknown;
  status?: unknown;
  detail?: unknown;
  consecutiveFailures?: unknown;
}

const HEALTHY = new Set(["healthy", "ok", "up"]);
const SEVERITY_ORDER: Record<Severity, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

function severityFor(status: string, failures: number): Severity {
  if (failures >= 5) return "P1";
  if (status === "unhealthy" || status === "down" || status === "critical") return "P2";
  return "P3";
}

/**
 * Read-only: GET /api/health/components with a Bearer token.
 * Any transport/auth/shape failure throws so the run exits without acting (fail closed).
 * `files` is filled from the operator-maintained component map; unmapped components
 * come back with no files and are BLOCKED by the planner rather than guessed at.
 */
export async function observeApex(opts: {
  baseUrl: string;
  token: string;
  componentFiles?: Record<string, string[]>;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<Incident[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/api/health/components`;
  let res: Response;
  try {
    res = await doFetch(url, {
      headers: { Authorization: `Bearer ${opts.token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
  } catch (err) {
    throw new ObserveError(`Apex unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new ObserveError(`Apex health returned HTTP ${res.status}`);
  const body: unknown = await res.json().catch(() => undefined);
  if (!Array.isArray(body)) throw new ObserveError("Apex health response was not an array");

  const incidents: Incident[] = [];
  for (const row of body as ComponentRow[]) {
    if (typeof row.component !== "string" || typeof row.status !== "string") continue;
    const status = row.status.toLowerCase();
    if (HEALTHY.has(status)) continue;
    const failures = typeof row.consecutiveFailures === "number" ? row.consecutiveFailures : 0;
    const detail = typeof row.detail === "string" ? row.detail.slice(0, 500) : undefined;
    incidents.push({
      severity: severityFor(status, failures),
      component: row.component,
      errorSignature: `${status}${detail ? `: ${detail}` : ""}`,
      ...(detail ? { detail } : {}),
      files: opts.componentFiles?.[row.component] ?? [],
    });
  }
  return incidents.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
