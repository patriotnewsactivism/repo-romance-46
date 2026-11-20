import { describe, expect, it, vi } from "vitest";
import {
  GITHUB_SYNC_AFFILIATION,
  fetchAllGithubRepos,
  normalizeGithubRepo,
  parseScopes,
  reposPageUrl,
} from "./github-sync";

function rawRepo(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    full_name: "acme/launchpad",
    name: "launchpad",
    owner: { login: "acme" },
    description: "Onboarding platform",
    language: "TypeScript",
    topics: ["react", "billing"],
    private: false,
    fork: false,
    archived: false,
    disabled: false,
    stargazers_count: 12,
    forks_count: 3,
    open_issues_count: 4,
    subscribers_count: 7,
    size: 2048,
    default_branch: "main",
    pushed_at: "2026-11-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-11-02T00:00:00Z",
    html_url: "https://github.com/acme/launchpad",
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("normalizeGithubRepo", () => {
  it("maps a GitHub payload into the stored shape", () => {
    expect(normalizeGithubRepo(rawRepo())).toEqual({
      github_id: "1",
      full_name: "acme/launchpad",
      name: "launchpad",
      owner: "acme",
      description: "Onboarding platform",
      language: "TypeScript",
      topics: ["react", "billing"],
      private: false,
      fork: false,
      archived: false,
      disabled: false,
      stars: 12,
      forks: 3,
      open_issues: 4,
      watchers: 7,
      size_kb: 2048,
      default_branch: "main",
      pushed_at: "2026-11-01T00:00:00Z",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-11-02T00:00:00Z",
      html_url: "https://github.com/acme/launchpad",
    });
  });

  it("rejects payloads without an id or full name", () => {
    expect(normalizeGithubRepo({ full_name: "acme/x" })).toBeNull();
    expect(normalizeGithubRepo({ id: 2 })).toBeNull();
  });
});

describe("reposPageUrl", () => {
  it("requests every affiliation the user can act on", () => {
    const url = new URL(reposPageUrl(2, 100));
    expect(url.searchParams.get("affiliation")).toBe(GITHUB_SYNC_AFFILIATION);
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("per_page")).toBe("100");
    expect(url.searchParams.get("visibility")).toBe("all");
  });

  it("clamps an absurd page size to GitHub's maximum", () => {
    const url = new URL(reposPageUrl(1, 10_000));
    expect(url.searchParams.get("per_page")).toBe("100");
  });
});

describe("parseScopes", () => {
  it("splits and trims the scope header", () => {
    expect(parseScopes("repo, read:user,user:email")).toEqual(["repo", "read:user", "user:email"]);
    expect(parseScopes(null)).toEqual([]);
  });
});

describe("fetchAllGithubRepos", () => {
  it("paginates and deduplicates repositories by id", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([rawRepo({ id: 1 }), rawRepo({ id: 2, full_name: "acme/two" })], { headers: { "x-oauth-scopes": "repo, read:user" } }))
      .mockResolvedValueOnce(jsonResponse([rawRepo({ id: 2, full_name: "acme/two" })]));

    const result = await fetchAllGithubRepos("token", { fetchImpl: fetchImpl as unknown as typeof fetch, perPage: 2 });
    expect(result.repos.map((repo) => repo.github_id)).toEqual(["1", "2"]);
    expect(result.pages).toBe(2);
    expect(result.scopes).toEqual(["repo", "read:user"]);
    expect(result.truncated).toBe(false);
  });

  it("stops at the configured maximum and reports truncation", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([rawRepo({ id: 1 }), rawRepo({ id: 2 }), rawRepo({ id: 3 })]));
    const result = await fetchAllGithubRepos("token", { fetchImpl: fetchImpl as unknown as typeof fetch, perPage: 3, maxRepos: 2 });
    expect(result.repos).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("surfaces a revoked token as a reconnect error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: "Bad credentials" }, { status: 401 }));
    await expect(fetchAllGithubRepos("token", { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toMatchObject({
      status: 401,
      code: "GITHUB_TOKEN_REVOKED",
    });
  });

  it("distinguishes a rate limit from a scope failure", async () => {
    const rateLimited = vi.fn().mockResolvedValue(
      jsonResponse({ message: "API rate limit exceeded" }, { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1800000000" } }),
    );
    await expect(fetchAllGithubRepos("token", { fetchImpl: rateLimited as unknown as typeof fetch })).rejects.toMatchObject({
      status: 429,
      code: "GITHUB_RATE_LIMITED",
    });

    const scopeDenied = vi.fn().mockResolvedValue(jsonResponse({ message: "Resource not accessible: scope" }, { status: 403 }));
    await expect(fetchAllGithubRepos("token", { fetchImpl: scopeDenied as unknown as typeof fetch })).rejects.toMatchObject({
      status: 403,
      code: "GITHUB_SCOPE_MISSING",
    });
  });
});
