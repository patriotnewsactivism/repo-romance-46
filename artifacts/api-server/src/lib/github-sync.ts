/**
 * GitHub repository synchronization.
 *
 * Why this module exists: the product used to ask GitHub for repositories with
 * `affiliation=owner` only, from three different routes, with no persistence.
 * That produced three real failures:
 *
 *  - repositories in an organization or owned by someone else never appeared;
 *  - every screen re-fetched the same list, so a rate limit or an expired token
 *    emptied the whole portfolio at once;
 *  - the OAuth callback only stored a token when Supabase happened to return a
 *    `provider_token`, so a returning user could be "signed in" with no
 *    connection and an empty repository list.
 *
 * Sync once, store the result, and read from the store. A token that GitHub
 * rejects is surfaced as `needsReconnect` instead of an empty portfolio.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Every affiliation a user can legitimately act on. */
export const GITHUB_SYNC_AFFILIATION = "owner,collaborator,organization_member";

/** GitHub's maximum page size for /user/repos. */
export const GITHUB_PAGE_SIZE = 100;

export interface GithubRepoRecord {
  github_id: string;
  full_name: string;
  name: string;
  owner: string;
  description: string | null;
  language: string | null;
  topics: string[];
  private: boolean;
  fork: boolean;
  archived: boolean;
  disabled: boolean;
  stars: number;
  forks: number;
  open_issues: number;
  watchers: number;
  size_kb: number;
  default_branch: string | null;
  pushed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  html_url: string | null;
}

export interface GithubSyncResult {
  repos: GithubRepoRecord[];
  count: number;
  persisted: boolean;
  pages: number;
  truncated: boolean;
  syncedAt: string;
  scopes: string[];
  tokenExpiresAt: string | null;
}

export type GithubSyncFailureCode =
  | "GITHUB_TOKEN_REVOKED"
  | "GITHUB_SCOPE_MISSING"
  | "GITHUB_RATE_LIMITED"
  | "GITHUB_UNAVAILABLE";

function syncError(message: string, status: number, code: GithubSyncFailureCode, detail?: Record<string, unknown>) {
  return Object.assign(new Error(message), { status, code, ...detail });
}

function asNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Normalize one GitHub repository payload into the stored shape. */
export function normalizeGithubRepo(raw: Record<string, unknown>): GithubRepoRecord | null {
  const id = raw.id;
  const fullName = asString(raw.full_name);
  const name = asString(raw.name);
  const ownerRecord = raw.owner && typeof raw.owner === "object" ? (raw.owner as Record<string, unknown>) : {};
  const owner = asString(ownerRecord.login) ?? fullName?.split("/")[0] ?? null;
  if (id === null || id === undefined || !fullName || !name || !owner) return null;

  return {
    github_id: String(id),
    full_name: fullName,
    name,
    owner,
    description: asString(raw.description),
    language: asString(raw.language),
    topics: Array.isArray(raw.topics) ? raw.topics.filter((topic): topic is string => typeof topic === "string") : [],
    private: raw.private === true,
    fork: raw.fork === true,
    archived: raw.archived === true,
    disabled: raw.disabled === true,
    stars: asNumber(raw.stargazers_count),
    forks: asNumber(raw.forks_count),
    open_issues: asNumber(raw.open_issues_count),
    watchers: asNumber(raw.subscribers_count ?? raw.watchers_count),
    size_kb: asNumber(raw.size),
    default_branch: asString(raw.default_branch),
    pushed_at: asString(raw.pushed_at),
    created_at: asString(raw.created_at),
    updated_at: asString(raw.updated_at),
    html_url: asString(raw.html_url),
  };
}

export function reposPageUrl(page: number, perPage = GITHUB_PAGE_SIZE): string {
  const safePage = Math.max(1, Math.floor(page));
  const safePerPage = Math.max(1, Math.min(GITHUB_PAGE_SIZE, Math.floor(perPage)));
  return `https://api.github.com/user/repos?per_page=${safePerPage}&page=${safePage}&affiliation=${encodeURIComponent(
    GITHUB_SYNC_AFFILIATION,
  )}&visibility=all&sort=pushed&direction=desc`;
}

export function parseScopes(header: string | null): string[] {
  return (header ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

/**
 * Page through every repository the token can see.
 *
 * Deduplicates by GitHub id: `affiliation` can return the same repository more
 * than once when a user both owns and collaborates on it, and a duplicate would
 * otherwise become a duplicate row.
 */
export async function fetchAllGithubRepos(
  token: string,
  options: {
    maxRepos?: number;
    perPage?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<{ repos: GithubRepoRecord[]; pages: number; truncated: boolean; scopes: string[] }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const perPage = Math.max(1, Math.min(GITHUB_PAGE_SIZE, options.perPage ?? GITHUB_PAGE_SIZE));
  const maxRepos = Math.max(1, Math.min(5_000, options.maxRepos ?? 1_000));

  const byId = new Map<string, GithubRepoRecord>();
  let pages = 0;
  let scopes: string[] = [];
  let truncated = false;

  for (let page = 1; page <= Math.ceil(maxRepos / perPage) + 1; page += 1) {
    const res = await fetchImpl(reposPageUrl(page, perPage), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "repo-finisher",
      },
    });
    pages += 1;

    if (res.status === 401) {
      throw syncError(
        "GitHub rejected the stored token. Reconnect GitHub to resync repositories.",
        401,
        "GITHUB_TOKEN_REVOKED",
      );
    }

    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      const reset = res.headers.get("x-ratelimit-reset");
      if (res.status === 429 || remaining === "0") {
        const resetAt = reset ? new Date(Number(reset) * 1000).toISOString() : null;
        throw syncError(
          `GitHub rate limit reached${resetAt ? `; it resets at ${resetAt}` : ""}. Try again shortly.`,
          429,
          "GITHUB_RATE_LIMITED",
          { resetAt },
        );
      }
      const detail = (await res.text()).slice(0, 200);
      if (/scope|permission|forbidden/i.test(detail)) {
        throw syncError(
          "The stored GitHub token is missing repository scope. Reconnect GitHub and grant repository access.",
          403,
          "GITHUB_SCOPE_MISSING",
        );
      }
      throw syncError(`GitHub refused the repository request: ${detail}`, 502, "GITHUB_UNAVAILABLE");
    }

    if (!res.ok) {
      throw syncError(`GitHub repository sync failed with HTTP ${res.status}.`, 502, "GITHUB_UNAVAILABLE");
    }

    if (scopes.length === 0) scopes = parseScopes(res.headers.get("x-oauth-scopes"));

    const payload = (await res.json()) as unknown;
    const pageRepos = Array.isArray(payload) ? payload : [];
    for (const raw of pageRepos) {
      if (!raw || typeof raw !== "object") continue;
      const normalized = normalizeGithubRepo(raw as Record<string, unknown>);
      if (!normalized) continue;
      byId.set(normalized.github_id, normalized);
      if (byId.size >= maxRepos) {
        truncated = pageRepos.length >= perPage;
        break;
      }
    }

    if (pageRepos.length < perPage) break;
    if (byId.size >= maxRepos) break;
  }

  return { repos: [...byId.values()], pages, truncated, scopes };
}

function isMissingTableError(error: unknown): boolean {
  const candidate = (error ?? {}) as { code?: string; message?: string; details?: string };
  const code = String(candidate.code ?? "").toUpperCase();
  if (["42P01", "PGRST202", "PGRST205"].includes(code)) return true;
  return /github_repos|column .* does not exist|schema cache/i.test(`${candidate.message ?? ""} ${candidate.details ?? ""}`);
}

/**
 * Fetch and persist the user's repositories.
 *
 * Persistence is best-effort: a database that has not applied the additive
 * migration still gets a correct live response, it just is not cached.
 */
export async function syncGithubRepos(
  supabase: SupabaseClient,
  userId: string,
  token: string,
  options: { maxRepos?: number; tokenExpiresAt?: string | null } = {},
): Promise<GithubSyncResult> {
  const startedAt = new Date().toISOString();
  const { repos, pages, truncated, scopes } = await fetchAllGithubRepos(token, { maxRepos: options.maxRepos });

  let persisted = false;
  if (repos.length > 0) {
    const rows = repos.map((repo) => ({
      user_id: userId,
      ...repo,
      synced_at: startedAt,
    }));

    const { error } = await supabase.from("github_repos").upsert(rows, { onConflict: "user_id,github_id" });
    if (!error) {
      persisted = true;
      // Prune repositories that no longer exist or are no longer accessible.
      // This only ever touches rows for this user and never deletes an
      // analysis or any user-authored data.
      const { error: pruneError } = await supabase
        .from("github_repos")
        .delete()
        .eq("user_id", userId)
        .lt("synced_at", startedAt);
      if (pruneError) {
        console.warn("[github-sync] Repository prune skipped:", pruneError.message);
      }
    } else if (!isMissingTableError(error)) {
      console.warn("[github-sync] Repository cache write failed:", error.message);
    }
  }

  const connectionPatch: Record<string, unknown> = {
    last_synced_at: startedAt,
    repo_count: repos.length,
    updated_at: startedAt,
  };
  if (scopes.length > 0) connectionPatch.scopes = scopes.join(",");
  if (options.tokenExpiresAt) connectionPatch.token_expires_at = options.tokenExpiresAt;

  const { error: connectionError } = await supabase
    .from("github_connections")
    .update(connectionPatch)
    .eq("user_id", userId);
  if (connectionError && !isMissingTableError(connectionError)) {
    console.warn("[github-sync] Connection metadata update failed:", connectionError.message);
  }

  return {
    repos,
    count: repos.length,
    persisted,
    pages,
    truncated,
    syncedAt: startedAt,
    scopes,
    tokenExpiresAt: options.tokenExpiresAt ?? null,
  };
}

/** Read the cached repository list. Returns null when the cache is unavailable. */
export async function readSyncedRepos(supabase: SupabaseClient, userId: string): Promise<GithubRepoRecord[] | null> {
  const { data, error } = await supabase
    .from("github_repos")
    .select(
      "github_id, full_name, name, owner, description, language, topics, private, fork, archived, disabled, stars, forks, open_issues, watchers, size_kb, default_branch, pushed_at, created_at, updated_at, html_url",
    )
    .eq("user_id", userId)
    .order("pushed_at", { ascending: false, nullsFirst: false });

  if (error) return null;
  return (data ?? []) as GithubRepoRecord[];
}
