import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { blockSession, retryBlockedIteration, type CompletionSessionRow } from "./completion-session-worker";

vi.mock("./completion-session-scheduler", () => ({
  scheduleCompletionSession: vi.fn(),
}));

type Result = { data?: unknown; error?: unknown };

/** Minimal thenable Supabase query-builder stand-in that records every call. */
class FakeQuery implements PromiseLike<Result> {
  calls: { method: string; args: unknown[] }[] = [];
  constructor(private result: Result) {}
  select(...args: unknown[]) {
    this.calls.push({ method: "select", args });
    return this;
  }
  update(...args: unknown[]) {
    this.calls.push({ method: "update", args });
    return this;
  }
  insert(...args: unknown[]) {
    this.calls.push({ method: "insert", args });
    return this;
  }
  eq(...args: unknown[]) {
    this.calls.push({ method: "eq", args });
    return this;
  }
  order(...args: unknown[]) {
    this.calls.push({ method: "order", args });
    return this;
  }
  limit(...args: unknown[]) {
    this.calls.push({ method: "limit", args });
    return this;
  }
  maybeSingle() {
    return Promise.resolve(this.result);
  }
  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function makeFakeSupabase(queuedResultsByTable: Record<string, Result[]>) {
  const queryLog: { table: string; query: FakeQuery }[] = [];
  const cursor: Record<string, number> = {};
  const client = {
    from(table: string) {
      const i = cursor[table] ?? 0;
      cursor[table] = i + 1;
      const queue = queuedResultsByTable[table] || [];
      const result = queue[i] ?? queue[queue.length - 1] ?? { data: null, error: null };
      const query = new FakeQuery(result);
      queryLog.push({ table, query });
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, queryLog };
}

function baseSession(overrides: Partial<CompletionSessionRow> = {}): CompletionSessionRow {
  return {
    id: "session-1",
    user_id: "user-1",
    status: "active",
    phase: "queued",
    iteration_count: 2,
    worker_token: null,
    lease_expires_at: null,
    heartbeat_at: null,
    stop_reason: null,
    last_error: null,
    completed_at: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    autonomy_acknowledged_at: null,
    analysis_id: "analysis-1",
    repo: "owner/repo",
    target_completion_pct: 100,
    target_readiness_pct: 100,
    ...overrides,
  } as CompletionSessionRow;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("blockSession — releases the worker lease (Defect: stale lease strands a later retry)", () => {
  it("nulls out worker_token/lease_expires_at/heartbeat_at in the same update that flips status to blocked", async () => {
    const { client, queryLog } = makeFakeSupabase({
      repo_completion_sessions: [{ data: null, error: null }],
      repo_completion_session_events: [{ data: null, error: null }],
    });

    await blockSession(client, "user-1", baseSession({ worker_token: "stale-token", lease_expires_at: "2099-01-01T00:00:00.000Z" }), "boom", "iteration_execution_failed");

    const sessionsUpdate = queryLog.find((q) => q.table === "repo_completion_sessions");
    expect(sessionsUpdate).toBeTruthy();
    const updateCall = sessionsUpdate!.query.calls.find((c) => c.method === "update");
    expect(updateCall).toBeTruthy();
    const payload = updateCall!.args[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      status: "blocked",
      phase: "blocked",
      worker_token: null,
      lease_expires_at: null,
      heartbeat_at: null,
    });
  });
});

describe("retryBlockedIteration — reverts on downstream failure instead of stranding the session (Defect)", () => {
  it("happy path: flips to active, logs the retry event, and dispatches a worker", async () => {
    const { scheduleCompletionSession } = await import("./completion-session-scheduler");
    (scheduleCompletionSession as ReturnType<typeof vi.fn>).mockResolvedValue("in-process");

    const { client } = makeFakeSupabase({
      repo_completion_sessions: [
        { data: baseSession({ status: "blocked" }), error: null }, // loadCompletionSession
        { data: baseSession({ status: "active", phase: "queued" }), error: null }, // the retry update...select().maybeSingle()
      ],
      repo_completion_session_events: [
        { data: [{ kind: "iteration_execution_failed" }], error: null }, // listCompletionSessionEvents
        { data: null, error: null }, // recordSessionEvent insert
      ],
    });

    const result = await retryBlockedIteration(client, "user-1", "session-1");
    expect(result.retried).toBe(true);
    expect(result.workerMode).toBe("in-process");
    expect(scheduleCompletionSession).toHaveBeenCalledTimes(1);
  });

  it("reverts the session back to blocked and rethrows the original error when dispatch fails after the active flip", async () => {
    const { scheduleCompletionSession } = await import("./completion-session-scheduler");
    const dispatchError = new Error("Cloud Run Job dispatch exploded");
    (scheduleCompletionSession as ReturnType<typeof vi.fn>).mockRejectedValue(dispatchError);

    const { client, queryLog } = makeFakeSupabase({
      repo_completion_sessions: [
        { data: baseSession({ status: "blocked" }), error: null }, // loadCompletionSession
        { data: baseSession({ status: "active", phase: "queued" }), error: null }, // the retry's blocked->active update
        { data: null, error: null }, // the revert-to-blocked update on failure
      ],
      repo_completion_session_events: [
        { data: [{ kind: "iteration_execution_failed" }], error: null }, // listCompletionSessionEvents
        { data: null, error: null }, // recordSessionEvent insert
      ],
    });

    await expect(retryBlockedIteration(client, "user-1", "session-1")).rejects.toThrow("Cloud Run Job dispatch exploded");

    const sessionUpdates = queryLog.filter((q) => q.table === "repo_completion_sessions" && q.query.calls.some((c) => c.method === "update"));
    // First update: blocked -> active/queued. Second update: the revert back to blocked on failure.
    expect(sessionUpdates.length).toBe(2);
    const revertUpdate = sessionUpdates[1].query.calls.find((c) => c.method === "update")!.args[0] as Record<string, unknown>;
    expect(revertUpdate).toMatchObject({ status: "blocked", phase: "blocked" });
    const revertEqCalls = sessionUpdates[1].query.calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(revertEqCalls).toEqual(
      expect.arrayContaining([
        ["id", "session-1"],
        ["user_id", "user-1"],
        ["status", "active"],
        ["phase", "queued"],
      ]),
    );
  });
});
