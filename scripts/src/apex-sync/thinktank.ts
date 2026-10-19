import type { FileChange } from "./types.js";

type FetchLike = typeof fetch;

export class ThinkTankError extends Error {}

export interface ThinkTankOptions {
  endpoint: string;
  input: string;
  customContext: string;
  maxRounds?: number;
  pollMs?: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface ThinkTankResult {
  sessionId: string;
  changes: FileChange[];
}

/** Accept both `https://host` and the pasted `https://host/api/debate`. */
export function baseUrl(endpoint: string): string {
  return endpoint.replace(/\/+$/, "").replace(/\/api\/debate$/, "");
}

async function readJson(res: Response, maxBytes: number): Promise<unknown> {
  const text = await res.text();
  if (text.length > maxBytes) throw new ThinkTankError(`response exceeded ${maxBytes} bytes`);
  try {
    return JSON.parse(text);
  } catch {
    throw new ThinkTankError("response was not JSON");
  }
}

/**
 * Think Tank's /api/debate is async and unauthenticated: POST returns {sessionId},
 * the run is polled at /api/debate/runs/:id, and file blocks come from /export/changes.
 * Every failure path throws ThinkTankError; callers treat that as BLOCKED (no retries here).
 */
export async function runThinkTank(opts: ThinkTankOptions): Promise<ThinkTankResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const base = baseUrl(opts.endpoint);
  const maxBytes = opts.maxResponseBytes ?? 2_000_000;
  const deadline = now() + (opts.timeoutMs ?? 10 * 60_000);

  const start = await doFetch(`${base}/api/debate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: opts.input,
      customContext: opts.customContext,
      maxRounds: Math.min(Math.max(opts.maxRounds ?? 2, 1), 2),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!start.ok) throw new ThinkTankError(`start failed: HTTP ${start.status}`);
  const started = (await readJson(start, maxBytes)) as { sessionId?: unknown };
  if (typeof started.sessionId !== "string" || !/^[\w-]+$/.test(started.sessionId)) {
    throw new ThinkTankError("start response missing sessionId");
  }
  const sessionId = started.sessionId;

  for (;;) {
    if (now() > deadline) throw new ThinkTankError("timed out waiting for debate");
    await sleep(opts.pollMs ?? 10_000);
    const poll = await doFetch(`${base}/api/debate/runs/${sessionId}`, { signal: AbortSignal.timeout(30_000) });
    if (!poll.ok) throw new ThinkTankError(`poll failed: HTTP ${poll.status}`);
    const run = (await readJson(poll, maxBytes * 5)) as { status?: string; error?: string };
    if (run.status === "error") throw new ThinkTankError(`debate errored: ${String(run.error ?? "unknown")}`);
    if (run.status === "complete") break;
  }

  const res = await doFetch(`${base}/api/debate/runs/${sessionId}/export/changes`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new ThinkTankError(`changes export failed: HTTP ${res.status}`);
  const body = (await readJson(res, maxBytes)) as { changes?: Array<{ path?: unknown; content?: unknown; action?: unknown }> };
  const changes: FileChange[] = [];
  for (const c of body.changes ?? []) {
    if (c.action === "DELETE") throw new ThinkTankError("deletions are not permitted");
    if (typeof c.path !== "string" || typeof c.content !== "string") continue;
    changes.push({ path: c.path, content: c.content });
  }
  return { sessionId, changes };
}
