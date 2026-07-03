import { supabase } from "@/lib/supabase";

// Mirrors artifacts/repo-finisher/src/lib/api-client.ts (hand-written fetch,
// not @workspace/api-client-react). Talks to the same Express API server.
const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}/`;

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${BASE_URL}api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...headers,
      ...options.headers,
    },
  });

  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const body = await res.json();
      message = body.error || body.message || message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function get<T>(path: string) {
  return apiFetch<T>(path, { method: "GET" });
}

function post<T>(path: string, body?: unknown) {
  return apiFetch<T>(path, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function del<T>(path: string) {
  return apiFetch<T>(path, { method: "DELETE" });
}

// ─── GitHub ─────────────────────────────────────────────────────
export function startGithubOAuth() {
  return get<{ url: string }>("/github/oauth/start");
}

export function getConnectionStatus() {
  return get<{ connected: boolean; login: string | null; connected_at: string | null }>(
    "/github/status",
  );
}

export function disconnectGithub() {
  return post<{ ok: boolean }>("/github/disconnect");
}

export function getPortfolioSummary() {
  return get<{
    connected: boolean;
    summary: {
      login: string;
      totalRepos: number;
      totalStars: number;
      dormantCount: number;
      avgSizeKb: number;
      topLanguages: { name: string; count: number; pct: number }[];
      mostRecentPush: string;
    } | null;
  }>("/github/portfolio-summary");
}

export function getRepoHealth(repo: string) {
  return get<{
    repo: string;
    healthScore: number;
    grade: string;
    factors: { name: string; status: boolean; weight: number }[];
    ciProvider: string | null;
    license: string | null;
    hasTests: boolean;
    hasCI: boolean;
    stars: number;
    openIssues: number;
    lastPush: string;
  }>(`/github/repo-health?repo=${encodeURIComponent(repo)}`);
}

// ─── Analysis ───────────────────────────────────────────────────
export function runAnalysis() {
  return post<{ id: string }>("/analysis/run");
}

export function listAnalyses() {
  return get<{ analyses: Record<string, unknown>[] }>("/analysis");
}

export function getAnalysis(id: string) {
  return get<{ analysis: Record<string, unknown>; items: Record<string, unknown>[] }>(
    `/analysis/${id}`,
  );
}

export function deleteAnalysis(id: string) {
  return del<{ ok: boolean }>(`/analysis/${id}`);
}

export function toggleShare(id: string, isPublic: boolean) {
  return post<{ isPublic: boolean; slug: string | null }>(`/analysis/${id}/share`, { isPublic });
}

export function rerunAnalysis(id: string) {
  return post<Record<string, unknown>>(`/analysis/${id}/rerun`);
}

export function generateActionPlan(analysisId: string) {
  return post<Record<string, unknown>>(`/analysis/${analysisId}/action-plan`);
}

export function generateMergeInstructions(analysisId: string, itemRank: number) {
  return post<Record<string, unknown>>(`/analysis/${analysisId}/merge-instructions`, {
    itemRank,
  });
}

export function getPublicAnalysis(slug: string) {
  return get<{ analysis: Record<string, unknown>; items: Record<string, unknown>[] }>(
    `/public/analysis/${slug}`,
  );
}

// ─── Preferences ────────────────────────────────────────────────
export function getPreferences() {
  return get<Record<string, unknown>>("/preferences");
}

export function updatePreferences(prefs: Record<string, unknown>) {
  return post<Record<string, unknown>>("/preferences", prefs);
}

export function getStarredItems() {
  return get<{ items: Record<string, unknown>[] }>("/preferences/starred");
}

export function toggleStar(itemId: string, starred: boolean) {
  return post<{ isStarred: boolean }>("/preferences/star", { itemId, starred });
}

// ─── Repo finisher ──────────────────────────────────────────────
export function finishRepo(params: {
  repo: string;
  nextSteps?: string[];
  analysisId?: string;
  itemRank?: number;
}) {
  return post<{ result: string }>("/repo-finisher/finish", params);
}

// ─── Valuation ──────────────────────────────────────────────────
export function valuePortfolio(analysisId: string) {
  return post<Record<string, unknown>>(`/valuation/${analysisId}`);
}

export function getValuation(analysisId: string) {
  return get<Record<string, unknown>>(`/valuation/${analysisId}`);
}

// ─── Vibe tools ─────────────────────────────────────────────────
export function assessMarketAndValue(analysisId: string, itemRank: number) {
  return post<Record<string, unknown>>("/vibe-tools/market-value", { analysisId, itemRank });
}

export function generateVibeSpec(analysisId: string, itemRank: number) {
  return post<Record<string, unknown>>("/vibe-tools/vibe-spec", { analysisId, itemRank });
}

export function combineRepos(analysisId: string, itemRank: number) {
  return post<Record<string, unknown>>("/vibe-tools/combine", { analysisId, itemRank });
}

export function iterativeFinish(
  analysisId: string,
  itemRank: number,
  repo: string,
  passes?: number,
) {
  return post<{ history: Record<string, unknown>[]; passes_completed: number }>(
    "/vibe-tools/iterative-finish",
    { analysisId, itemRank, repo, passes },
  );
}
