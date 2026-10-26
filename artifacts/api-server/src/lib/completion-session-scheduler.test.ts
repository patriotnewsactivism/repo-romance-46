import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ process: vi.fn(async () => undefined), background: vi.fn() }));
vi.mock("./completion-session-worker", () => ({ processCompletionSession: mocks.process }));
vi.mock("./background-tasks", () => ({ runInBackground: mocks.background }));

import { configuredCompletionWorker, scheduleCompletionSession } from "./completion-session-scheduler";

function database(row: Record<string, unknown> | null = null, error: { message: string } | null = null) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: row, error })),
  };
  return { from: vi.fn(() => query) } as unknown as SupabaseClient;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("persistent completion scheduling", () => {
  it("leaves production sessions queued even when no mode variable is supplied", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REPOFINISHER_WORKER_MODE", "");
    expect(configuredCompletionWorker()).toBe("persistent-worker");
    expect(await scheduleCompletionSession(database(), "user", "session")).toBe("persistent-worker");
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.background).not.toHaveBeenCalled();
  });

  it.each(["persistent", "persistent-worker"])("queues %s work for the separate worker", async (mode) => {
    vi.stubEnv("REPOFINISHER_WORKER_MODE", mode);
    expect(await scheduleCompletionSession(database(), "user", "session")).toBe("persistent-worker");
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it("preserves an unexpired lease instead of scheduling duplicate work", async () => {
    vi.stubEnv("REPOFINISHER_WORKER_MODE", "persistent");
    const db = database({ status: "active", worker_token: "lease", lease_expires_at: new Date(Date.now() + 60_000).toISOString() });
    expect(await scheduleCompletionSession(db, "user", "session")).toBe("already-running");
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it("preserves the explicit local in-process fallback", async () => {
    vi.stubEnv("REPOFINISHER_WORKER_MODE", "in-process");
    const db = database();
    expect(await scheduleCompletionSession(db, "user", "session")).toBe("in-process");
    expect(mocks.process).toHaveBeenCalledWith(db, "user", "session");
    expect(mocks.background).toHaveBeenCalledOnce();
  });

  it("rejects unknown runtime configuration instead of silently running work in HTTP requests", () => {
    vi.stubEnv("REPOFINISHER_WORKER_MODE", "misspelled-persistent");
    expect(() => configuredCompletionWorker()).toThrow("Unsupported REPOFINISHER_WORKER_MODE");
  });

  it("does not schedule work when checking its existing lease fails", async () => {
    vi.stubEnv("REPOFINISHER_WORKER_MODE", "persistent");
    await expect(scheduleCompletionSession(database(null, { message: "unavailable" }), "user", "session")).rejects.toThrow("Failed to inspect completion worker lease");
    expect(mocks.process).not.toHaveBeenCalled();
  });
});
