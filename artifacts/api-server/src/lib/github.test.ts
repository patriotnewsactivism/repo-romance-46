import { describe, expect, it } from "vitest";
import { assertBranchName, assertCommitSha, assertRepoSlug, encodePath } from "./github";

describe("assertRepoSlug", () => {
  it("accepts an ordinary owner/name", () => {
    expect(assertRepoSlug("patriotnewsactivism/repo-romance-46")).toBe("patriotnewsactivism/repo-romance-46");
  });

  it.each([
    "../../orgs/acme/repos",
    "owner/name/../../../user",
    "owner",
    "owner/name/extra",
    "owner/na me",
    "owner/name?query=1",
    "owner/name#frag",
    "https://api.github.com/user",
    "",
  ])("rejects %s", (repo) => {
    expect(() => assertRepoSlug(repo)).toThrow(/Invalid repository/);
  });

  it("attaches a 400 status so it surfaces as a client error", () => {
    try {
      assertRepoSlug("../evil");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(400);
    }
  });
});

describe("assertBranchName", () => {
  it("accepts slashes in branch names", () => {
    expect(assertBranchName("repo-romance/plan-abc")).toBe("repo-romance/plan-abc");
  });

  it.each(["../main", "/main", "main/", "main branch", "main?x=1", ""])("rejects %s", (branch) => {
    expect(() => assertBranchName(branch)).toThrow(/Invalid branch name/);
  });
});

describe("assertCommitSha", () => {
  it("accepts a full 40-character sha", () => {
    expect(assertCommitSha("a".repeat(40))).toBe("a".repeat(40));
  });

  it.each(["a".repeat(39), "a".repeat(41), "A".repeat(40), "zzzz", ""])("rejects %s", (sha) => {
    expect(() => assertCommitSha(sha)).toThrow(/Invalid commit sha/);
  });
});

describe("encodePath", () => {
  it("encodes each segment while preserving the separators", () => {
    expect(encodePath("src/my file.ts")).toBe("src/my%20file.ts");
    expect(encodePath("docs/a?b#c.md")).toBe("docs/a%3Fb%23c.md");
  });
});
