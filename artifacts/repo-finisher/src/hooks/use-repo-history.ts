import { useCallback, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthenticatedCacheScope } from "@/lib/authenticated-cache";
import { beginRepoHistoryRead, publishRepoHistory, prepareRepoHistoryUpdate, repoHistoryKey, repoHistoryOptions, type HistoryKind } from "@/lib/repo-history-cache";

/** Cache the complete latest-history lookup, including a confirmed absence. */
export function useRepoHistory<T>(
  kind: HistoryKind,
  repo: string,
  analysisId: string | undefined,
  restore: (signal: AbortSignal) => Promise<T | null>,
) {
  const authScope = useAuthenticatedCacheScope();
  const queryClient = useQueryClient();
  const queryKey = repoHistoryKey(authScope.userId, kind, repo, analysisId);
  const identity = JSON.stringify(queryKey);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const scope = useMemo(() => ({
    ...authScope,
    isCurrent: () => authScope.isCurrent() && identityRef.current === identity,
  }), [authScope, identity]);
  const query = useQuery({
    ...repoHistoryOptions(queryKey, restore),
    enabled: scope.ready && Boolean(scope.userId),
  });

  const prepareForUpdate = useCallback(
    () => prepareRepoHistoryUpdate(queryClient, scope, queryKey),
    [queryClient, scope, kind, repo, analysisId],
  );

  const publish = useCallback(
    (value: T, latest = false, readRevision?: number) => publishRepoHistory(queryClient, scope, queryKey, value, latest, readRevision),
    [queryClient, scope, kind, repo, analysisId],
  );

  const beginRead = useCallback(
    () => beginRepoHistoryRead(queryClient, queryKey),
    [queryClient, kind, repo, analysisId, authScope.userId],
  );

  return { ...query, scope, prepareForUpdate, publish, beginRead };
}
