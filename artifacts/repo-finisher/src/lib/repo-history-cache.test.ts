import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@workspace/api-client-react";
import { beginRepoHistoryRead, prepareRepoHistoryUpdate, publishRepoHistory, repoHistoryKey, repoHistoryOptions } from "./repo-history-cache";

const clients: QueryClient[] = [];
function client() {
  const result = new QueryClient();
  clients.push(result);
  return result;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
const scope = { userId: "user-a", isCurrent: () => true };
const key = repoHistoryKey(scope.userId, "run", "owner/repo", "analysis-a");

afterEach(() => {
  for (const cache of clients.splice(0)) cache.clear();
  vi.restoreAllMocks();
});

describe("private repository history cache", () => {
  it("deduplicates the complete list-and-detail lookup for simultaneous controls", async () => {
    const cache = client();
    const list = deferred<Array<{ id: string }>>();
    const detail = { run: { id: "run-1", status: "succeeded" }, events: [{ message: "Verified" }] };
    const fetchList = vi.fn(() => list.promise);
    const fetchDetail = vi.fn(async (_id: string) => detail);
    const options = repoHistoryOptions(key, async () => {
      const runs = await fetchList();
      return runs.length ? fetchDetail(runs[0].id) : null;
    });
    const first = cache.fetchQuery(options);
    const duplicate = cache.fetchQuery(options);
    list.resolve([{ id: "run-1" }]);
    expect(await first).toEqual(detail);
    expect(await duplicate).toEqual(detail);
    expect(await cache.fetchQuery(options)).toEqual(detail);
    expect(fetchList).toHaveBeenCalledTimes(1);
    expect(fetchDetail).toHaveBeenCalledTimes(1);
  });

  it.each([null, { run: { id: "run-1", status: "succeeded" }, events: [] }])(
    "keeps both confirmed absence and complete history fresh for one minute (%j)",
    async (value) => {
      const cache = client();
      const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
      const restore = vi.fn(async () => value);
      const options = repoHistoryOptions(key, restore);
      expect(await cache.fetchQuery(options)).toEqual(value);
      clock.mockReturnValue(1_059_999);
      expect(await cache.fetchQuery(options)).toEqual(value);
      expect(restore).toHaveBeenCalledTimes(1);
      clock.mockReturnValue(1_060_001);
      await cache.fetchQuery(options);
      expect(restore).toHaveBeenCalledTimes(2);
    },
  );

  it("isolates identical repositories by session user and by analysis", async () => {
    const cache = client();
    const otherUser = repoHistoryKey("user-b", "run", "owner/repo", "analysis-a");
    const otherAnalysis = repoHistoryKey("user-a", "run", "owner/repo", "analysis-b");
    await publishRepoHistory(cache, scope, key, { run: { id: "private-run" } });
    expect(cache.getQueryData(otherUser)).toBeUndefined();
    expect(cache.getQueryData(otherAnalysis)).toBeUndefined();
    expect(key).toEqual(["repo-history", "user-a", "run", "owner/repo", "analysis-a"]);
  });

  it("cancels an older restore and replaces cached absence after a new run", async () => {
    const cache = client();
    const repositoryKey = repoHistoryKey("user-a", "run", "owner/repo");
    cache.setQueryData(key, null);
    cache.setQueryData(repositoryKey, null);
    await cache.invalidateQueries({ queryKey: key, refetchType: "none" });
    const older = deferred<null>();
    let signal: AbortSignal | undefined;
    const restore = vi.fn((querySignal: AbortSignal) => {
      signal = querySignal;
      return older.promise;
    });
    const pending = cache.fetchQuery(repoHistoryOptions(key, restore)).catch(() => undefined);
    await prepareRepoHistoryUpdate(cache, scope, key);
    expect(signal?.aborted).toBe(true);
    expect(cache.getQueryState(repositoryKey)?.isInvalidated).toBe(true);
    const created = { run: { id: "new-run", status: "executing" }, events: [] };
    await publishRepoHistory(cache, scope, key, created, true);
    older.resolve(null);
    await pending;
    expect(cache.getQueryData(repositoryKey)).toEqual(created);
    expect(await cache.fetchQuery(repoHistoryOptions(key, restore))).toEqual(created);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("keeps a polled/manual-refresh snapshot current in every lookup for that record", async () => {
    const cache = client();
    const repositoryKey = repoHistoryKey("user-a", "run", "owner/repo");
    const otherAnalysis = repoHistoryKey("user-a", "run", "owner/repo", "analysis-b");
    const active = { run: { id: "run-1", status: "executing" }, events: [] };
    cache.setQueryData(key, active);
    cache.setQueryData(repositoryKey, active);
    cache.setQueryData(otherAnalysis, { run: { id: "other-run", status: "succeeded" } });
    await prepareRepoHistoryUpdate(cache, scope, key);
    const complete = { run: { id: "run-1", status: "succeeded" }, events: [{ message: "CI passed" }] };
    await publishRepoHistory(cache, scope, key, complete);
    const restore = vi.fn(async () => active);
    expect(await cache.fetchQuery(repoHistoryOptions(key, restore))).toEqual(complete);
    expect(await cache.fetchQuery(repoHistoryOptions(repositoryKey, restore))).toEqual(complete);
    expect(restore).not.toHaveBeenCalled();
    expect(cache.getQueryData(otherAnalysis)).toEqual({ run: { id: "other-run", status: "succeeded" } });
    expect(cache.getQueryState(otherAnalysis)?.isInvalidated).toBe(true);
  });

  it("rejects responses from an identity generation that ended while a write was pending", async () => {
    const cache = client();
    let current = true;
    const oldScope = { userId: "user-a", isCurrent: () => current };
    cache.setQueryData(key, null);
    const lateWrite = publishRepoHistory(cache, oldScope, key, { run: { id: "private-run" } });
    current = false;
    cache.clear();
    await lateWrite;
    // The same user may sign back in; the ended generation is still rejected.
    await publishRepoHistory(cache, oldScope, key, { run: { id: "private-run" } });
    expect(cache.getQueryCache().getAll()).toHaveLength(0);
  });

  it("rejects a delayed poll taken before a cancellation changed the same record", async () => {
    const cache = client();
    const repositoryKey = repoHistoryKey("user-a", "run", "owner/repo");
    const active = { run: { id: "run-1", status: "executing" }, events: [] };
    cache.setQueryData(key, active);
    cache.setQueryData(repositoryKey, active);
    const delayedPoll = deferred<typeof active>();
    const pollRevision = beginRepoHistoryRead(cache, repositoryKey);
    const poll = delayedPoll.promise.then((snapshot) => publishRepoHistory(cache, scope, repositoryKey, snapshot, false, pollRevision));
    await prepareRepoHistoryUpdate(cache, scope, key);
    const refreshRevision = beginRepoHistoryRead(cache, key);
    const cancelled = { run: { id: "run-1", status: "cancelled" }, events: [] };
    await publishRepoHistory(cache, scope, key, cancelled, false, refreshRevision);
    delayedPoll.resolve(active);
    await poll;
    expect(cache.getQueryData(key)).toEqual(cancelled);
    expect(cache.getQueryData(repositoryKey)).toEqual(cancelled);
  });

  it("does not retry a rate-limited restore", async () => {
    const cache = client();
    const error = new ApiError(new Response(null, { status: 429 }), { error: "Slow down" }, { method: "GET", url: "/api/repo-finisher/runs" });
    const restore = vi.fn(async () => { throw error; });
    await expect(cache.fetchQuery(repoHistoryOptions(key, restore))).rejects.toBe(error);
    expect(restore).toHaveBeenCalledTimes(1);
  });
});
