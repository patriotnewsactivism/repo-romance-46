import { afterEach, describe, expect, it, vi } from "vitest";
import { getRepoTree, normalizeScopePath, type GitHubTreeEntry } from "./repo-finisher-engine";

function treeEntry(path: string, sha = "sha-" + path, type: "blob" | "tree" = "blob"): GitHubTreeEntry {
  return { path, sha, type, mode: "100644" } as GitHubTreeEntry;
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("normalizeScopePath", () => {
  it("trims and strips leading/trailing slashes", () => {
    expect(normalizeScopePath("/artifacts/api-server/")).toBe("artifacts/api-server");
  });

  it("rejects path traversal and invalid characters", () => {
    expect(() => normalizeScopePath("../etc")).toThrow(/Invalid scope path/);
    expect(() => normalizeScopePath("a/../b")).toThrow(/Invalid scope path/);
    expect(() => normalizeScopePath("")).toThrow(/Invalid scope path/);
  });
});

describe("getRepoTree — large-repo scoped runs (Defect 2)", () => {
  it("returns full-repo blobs unchanged when the recursive tree is not truncated", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({ truncated: false, tree: [treeEntry("README.md"), treeEntry("src", "sha-src", "tree")] }),
    );
    const tree = await getRepoTree("token", "owner/repo", "root-sha");
    expect(tree).toEqual([{ path: "README.md", sha: "sha-README.md", type: "blob", mode: "100644" }]);
  });

  it("throws a structured 409 with suggestedScopes (never a bare string-only error) when the full tree is truncated", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("recursive=1")) {
        return jsonResponse({ truncated: true, tree: [] });
      }
      // Non-recursive root listing used to build suggestedScopes.
      return jsonResponse({
        tree: [treeEntry("artifacts", "sha-artifacts", "tree"), treeEntry("lib", "sha-lib", "tree"), treeEntry("README.md")],
      });
    });

    await expect(getRepoTree("token", "owner/repo", "root-sha")).rejects.toMatchObject({
      status: 409,
      code: "REPO_TOO_LARGE",
      details: { suggestedScopes: ["artifacts", "lib"] },
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("resolves a nested scope path segment-by-segment and re-prefixes returned blob paths to full repo-relative paths", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/git/trees/root-sha")) {
        return jsonResponse({ tree: [treeEntry("artifacts", "sha-artifacts", "tree")] });
      }
      if (url.endsWith("/git/trees/sha-artifacts")) {
        return jsonResponse({ tree: [treeEntry("api-server", "sha-api-server", "tree")] });
      }
      if (url.includes("/git/trees/sha-api-server?recursive=1")) {
        // Paths here are relative to the subtree, per GitHub's actual API behavior.
        return jsonResponse({ truncated: false, tree: [treeEntry("src/index.ts"), treeEntry("package.json")] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const tree = await getRepoTree("token", "owner/repo", "root-sha", "artifacts/api-server");
    expect(tree.map((entry) => entry.path)).toEqual(["artifacts/api-server/src/index.ts", "artifacts/api-server/package.json"]);
  });

  it("throws a plain 400 when the scope path does not exist as a directory", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ tree: [treeEntry("lib", "sha-lib", "tree")] }));
    await expect(getRepoTree("token", "owner/repo", "root-sha", "nonexistent")).rejects.toMatchObject({ status: 400 });
  });

  it("throws a 409 (no suggestedScopes needed) when even the requested scope is itself too large", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/git/trees/root-sha")) {
        return jsonResponse({ tree: [treeEntry("huge", "sha-huge", "tree")] });
      }
      return jsonResponse({ truncated: true, tree: [] });
    });
    await expect(getRepoTree("token", "owner/repo", "root-sha", "huge")).rejects.toMatchObject({ status: 409, code: "REPO_TOO_LARGE" });
  });
});
