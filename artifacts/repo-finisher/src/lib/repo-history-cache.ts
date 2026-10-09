import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { ApiError } from "@workspace/api-client-react";

export type HistoryKind = "run" | "external-prompt" | "completion-session";
export interface HistoryCacheScope {
  userId: string | null;
  isCurrent: () => boolean;
}

export function repoHistoryKey(userId: string | null, kind: HistoryKind, repo: string, analysisId?: string) {
  return ["repo-history", userId, kind, repo, analysisId ?? null] as const;
}

type HistoryKey = ReturnType<typeof repoHistoryKey>;

// Polling/manual GETs are outside TanStack's restore request. A shared
// repository revision also protects every analysis variant from older reads.
const revisions = new WeakMap<QueryClient, Map<string, number>>();

function repositoryRevision(client: QueryClient, key: HistoryKey) {
  let values = revisions.get(client);
  if (!values) {
    values = new Map();
    revisions.set(client, values);
  }
  const repository = JSON.stringify(key.slice(0, 4));
  return {
    get: () => values.get(repository) ?? 0,
    advance: () => {
      const next = (values.get(repository) ?? 0) + 1;
      values.set(repository, next);
      return next;
    },
  };
}

export function beginRepoHistoryRead(client: QueryClient, key: HistoryKey) {
  return repositoryRevision(client, key).advance();
}

export function repoHistoryOptions<T>(key: HistoryKey, restore: (signal: AbortSignal) => Promise<T | null>) {
  return queryOptions({
    queryKey: key,
    queryFn: ({ signal }) => restore(signal),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => !(error instanceof ApiError && error.status === 429) && failureCount < 3,
  });
}

export async function prepareRepoHistoryUpdate(client: QueryClient, scope: HistoryCacheScope, key: HistoryKey) {
  if (!scope.userId || !scope.isCurrent()) return;
  repositoryRevision(client, key).advance();
  const repositoryKey = key.slice(0, 4);
  await client.cancelQueries({ queryKey: repositoryKey });
  if (scope.isCurrent()) {
    // A new analysis-scoped run/prompt can also affect the repository-only
    // lookup. Mark every existing lookup stale without launching extra GETs.
    await client.invalidateQueries({ queryKey: repositoryKey, refetchType: "none" });
  }
}

function recordId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as { id?: string; run?: { id: string }; session?: { id: string } };
  return record.run?.id ?? record.session?.id ?? record.id;
}

export async function publishRepoHistory<T>(
  client: QueryClient,
  scope: HistoryCacheScope,
  key: HistoryKey,
  value: T,
  latest = false,
  readRevision?: number,
) {
  if (!scope.userId || !scope.isCurrent()) return;
  const revision = repositoryRevision(client, key);
  if (readRevision !== undefined && revision.get() !== readRevision) return;
  const repositoryKey = key.slice(0, 4);
  // Cancel restores started before a mutation/manual refresh; their older
  // results must never overwrite the action's complete snapshot.
  await client.cancelQueries({ queryKey: repositoryKey });
  if (!scope.isCurrent() || (readRevision !== undefined && revision.get() !== readRevision)) return;
  revision.advance();
  const valueId = recordId(value);
  for (const query of client.getQueryCache().findAll({ queryKey: repositoryKey })) {
    const sameRecord = valueId !== undefined && recordId(query.state.data) === valueId;
    const repositoryLatest = query.queryKey[4] === null && (latest || query.state.data === null);
    if (sameRecord || repositoryLatest) client.setQueryData(query.queryKey, value);
  }
  client.setQueryData<T | null>(key, value);
}
