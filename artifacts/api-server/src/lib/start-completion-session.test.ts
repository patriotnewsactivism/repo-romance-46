import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("./completion-session-scheduler", () => ({
  scheduleCompletionSession: vi.fn(),
}));

vi.mock("./post-run-evolution", async () => {
  const actual = await vi.importActual<typeof import("./post-run-evolution")>("./post-run-evolution");
  return {
    ...actual,
    loadBaselineInvestmentMetrics: vi.fn(),
  };
});

import { scheduleCompletionSession } from "./completion-session-scheduler";
import { loadBaselineInvestmentMetrics } from "./post-run-evolution";
import { startCompletionSession } from "./start-completion-session";

type Result = { data?: unknown; error?: unknown };

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
    this.calls.push({ method: "maybeSingle", args: [] });
    return Promise.resolve(this.result);
  }
  single() {
    this.calls.push({ method: "single", args: [] });
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

function blockedUpdate(queryLog: { table: string; query: FakeQuery }[]) {
  const updates = queryLog.filter((entry) => entry.table === "repo_completion_sessions");
  const update = updates.map((entry) => entry.query.calls.find((call) => call.method === "update")).find(Boolean);
  return update?.args[0] as Record<string, unknown> | undefined;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("startCompletionSession dispatch failure", () => {
  it("marks a reused active session blocked instead of leaving it active", async () => {
    vi.mocked(scheduleCompletionSession).mockRejectedValue(new Error("railway queue down"));
    const { client, queryLog } = makeFakeSupabase({
      repo_completion_sessions: [
        { data: { id: "session-1", last_completion_pct: 40, last_readiness_pct: 30 }, error: null },
        { data: null, error: null },
      ],
      repo_completion_session_events: [{ data: null, error: null }],
    });

    await expect(
      startCompletionSession(client, "user-1", {
        repo: "owner/repo",
        analysisId: "analysis-1",
        reuseExisting: true,
      }),
    ).rejects.toThrow("railway queue down");

    expect(blockedUpdate(queryLog)).toMatchObject({
      status: "blocked",
      phase: "blocked",
      worker_token: null,
      lease_expires_at: null,
      heartbeat_at: null,
    });
    const event = queryLog.find((entry) => entry.table === "repo_completion_session_events");
    const insert = event?.query.calls.find((call) => call.method === "insert");
    expect(insert?.args[0]).toMatchObject({ kind: "worker_dispatch_failed", session_id: "session-1" });
  });

  it("marks a newly created session blocked when the first dispatch throws", async () => {
    vi.mocked(scheduleCompletionSession).mockRejectedValue(new Error("worker unavailable"));
    vi.mocked(loadBaselineInvestmentMetrics).mockResolvedValue({
      completionPct: 10,
      productionReadinessPct: 10,
    } as Awaited<ReturnType<typeof loadBaselineInvestmentMetrics>>);
    const { client, queryLog } = makeFakeSupabase({
      repo_completion_sessions: [
        { data: null, error: null },
        { data: { id: "session-new" }, error: null },
        { data: null, error: null },
      ],
      repo_completion_session_events: [
        { data: null, error: null },
        { data: null, error: null },
      ],
    });

    await expect(
      startCompletionSession(client, "user-1", { repo: "owner/repo", analysisId: "analysis-1" }),
    ).rejects.toThrow("worker unavailable");

    expect(blockedUpdate(queryLog)).toMatchObject({ status: "blocked", phase: "blocked" });
    const events = queryLog.filter((entry) => entry.table === "repo_completion_session_events");
    const kinds = events.map((entry) => (entry.query.calls.find((call) => call.method === "insert")?.args[0] as { kind?: string })?.kind);
    expect(kinds).toContain("worker_dispatch_failed");
  });
});
