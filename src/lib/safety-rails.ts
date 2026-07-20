// Safety Rails â enforced in code, not just prompted.
// Every GitHub write operation goes through this module.
// Non-negotiable: no auto-merge, no force-push, no touching main/production.

// âââ Forbidden Operations ââââââââââââââââââââââââââââââââââââââ

export const PROTECTED_BRANCHES = new Set([
  "main",
  "master",
  "production",
  "prod",
  "release",
  "staging",
]);

export const FORBIDDEN_OPERATIONS = [
  "force-push",
  "auto-merge",
  "delete-branch-main",
  "cross-repo-overwrite",
] as const;

export type ForbiddenOp = (typeof FORBIDDEN_OPERATIONS)[number];

// âââ Risk Levels âââââââââââââââââââââââââââââââââââââââââââââââ

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RiskAssessment {
  level: RiskLevel;
  factors: string[];
  irreversible: boolean;
  recommendation: string;
}

// âââ Validation Functions ââââââââââââââââââââââââââââââââââââââ

/**
 * Validate that a branch name is NOT a protected branch.
 * Throws if someone tries to commit directly to main/production.
 */
export function assertNotProtectedBranch(branch: string): void {
  const normalized = branch.toLowerCase().replace(/^refs\/heads\//, "");
  if (PROTECTED_BRANCHES.has(normalized)) {
    throw new SafetyRailError(
      `BLOCKED: Direct writes to "${branch}" are forbidden. ` +
        `All changes must land as a PR on a feature branch for review.`,
      "direct-write-protected-branch",
    );
  }
}

/**
 * Validate that a git push is not a force push.
 * Checks for force-push flags in the arguments.
 */
export function assertNotForcePush(args: string[]): void {
  const forceFlags = ["--force", "-f", "--force-with-lease"];
  for (const arg of args) {
    if (forceFlags.includes(arg.toLowerCase())) {
      throw new SafetyRailError(
        `BLOCKED: Force-push is forbidden. Use normal pushes to feature branches only.`,
        "force-push",
      );
    }
  }
}

/**
 * Validate that we're not auto-merging a PR.
 * PRs must be reviewed and merged by the human owner.
 */
export function assertNoAutoMerge(operation: string): void {
  if (operation === "merge" || operation === "auto-merge") {
    throw new SafetyRailError(
      `BLOCKED: Auto-merging PRs is forbidden. PRs are for the repo owner to review and merge.`,
      "auto-merge",
    );
  }
}

/**
 * Validate that a destructive cross-repo operation is not happening automatically.
 * Merging repos, large refactors, major-version dependency bumps must be PR-only.
 */
export function assertNoCrossRepoOverwrite(
  sourceRepo: string,
  targetRepo: string,
  operation: string,
): void {
  if (sourceRepo !== targetRepo && ["overwrite", "replace", "delete"].includes(operation)) {
    throw new SafetyRailError(
      `BLOCKED: Cross-repo destructive operation "${operation}" from ${sourceRepo} â ${targetRepo} is forbidden. ` +
        `This must be proposed as a PR with a risk callout for the owner to review.`,
      "cross-repo-overwrite",
    );
  }
}

// âââ Risk Assessment âââââââââââââââââââââââââââââââââââââââââââ

/**
 * Assess the risk of a proposed change set before executing it.
 * Returns a risk assessment with factors and recommendations.
 */
export function assessChangeRisk(changes: {
  filesCreated: number;
  filesModified: number;
  filesDeleted: number;
  touchesSrc: boolean;
  touchesConfig: boolean;
  touchesDeps: boolean;
  isCrossRepo: boolean;
  isMajorRefactor: boolean;
  isMajorVersionBump: boolean;
}): RiskAssessment {
  const factors: string[] = [];
  let level: RiskLevel = "low";
  let irreversible = false;

  // File deletion is medium risk
  if (changes.filesDeleted > 0) {
    factors.push(`${changes.filesDeleted} file(s) will be deleted`);
    level = "medium";
  }

  // Source code changes
  if (changes.touchesSrc && changes.filesModified > 3) {
    factors.push(`Modifies ${changes.filesModified} source files â wide blast radius`);
    level = level === "low" ? "medium" : level;
  }

  // Config changes
  if (changes.touchesConfig) {
    factors.push("Modifies build/deploy configuration â could break deployments");
    level = level === "low" ? "medium" : level;
  }

  // Dependency changes
  if (changes.touchesDeps) {
    factors.push("Changes dependencies â could introduce breaking changes or vulnerabilities");
    level = level === "low" ? "medium" : level;
  }

  // Major version bumps
  if (changes.isMajorVersionBump) {
    factors.push("Major version bump â likely contains breaking API changes");
    level = "high";
  }

  // Cross-repo operations
  if (changes.isCrossRepo) {
    factors.push("Cross-repo operation â affects multiple repositories");
    level = "high";
    irreversible = true;
  }

  // Major refactor
  if (changes.isMajorRefactor) {
    factors.push("Major refactor â significant structural changes to the codebase");
    level = "critical";
    irreversible = true;
  }

  // Build recommendation
  let recommendation: string;
  switch (level) {
    case "low":
      recommendation = "Safe to proceed as a PR. Low risk of breaking changes.";
      break;
    case "medium":
      recommendation =
        "Review the PR carefully before merging. Check that tests pass and deployment works.";
      break;
    case "high":
      recommendation =
        "â ï¸ HIGH RISK: Review thoroughly. Test in a staging environment before merging. " +
        "Consider breaking this into smaller PRs.";
      break;
    case "critical":
      recommendation =
        "ð¨ CRITICAL: This change is potentially irreversible. " +
        "Do NOT merge without thorough review, backup, and a rollback plan.";
      break;
  }

  return { level, factors, irreversible, recommendation };
}

/**
 * Format a risk assessment as a markdown callout for PR descriptions.
 */
export function formatRiskCallout(assessment: RiskAssessment): string {
  const emoji =
    assessment.level === "critical"
      ? "ð¨"
      : assessment.level === "high"
        ? "â ï¸"
        : assessment.level === "medium"
          ? "ð"
          : "â";

  const lines = [
    `### ${emoji} Risk Assessment: ${assessment.level.toUpperCase()}`,
    "",
    ...assessment.factors.map((f) => `- ${f}`),
    "",
  ];

  if (assessment.irreversible) {
    lines.push("**â ï¸ This change may be irreversible.**");
    lines.push("");
  }

  lines.push(`**Recommendation:** ${assessment.recommendation}`);
  return lines.join("\n");
}

// âââ Safe GitHub Write Wrapper âââââââââââââââââââââââââââââââââ

/**
 * Wrap a GitHub API write call with safety checks.
 * All GitHub write operations should go through this.
 */
export async function safeGitHubWrite<T>(opts: {
  operation: string;
  targetBranch: string;
  repo: string;
  secondaryRepo?: string;
  execute: () => Promise<T>;
}): Promise<T> {
  // Check 1: Protected branch
  assertNotProtectedBranch(opts.targetBranch);

  // Check 2: Cross-repo overwrite
  if (opts.secondaryRepo) {
    assertNoCrossRepoOverwrite(opts.secondaryRepo, opts.repo, opts.operation);
  }

  // Check 3: No auto-merge
  assertNoAutoMerge(opts.operation);

  // All checks passed â execute
  return opts.execute();
}

// âââ Custom Error ââââââââââââââââââââââââââââââââââââââââââââââ

export class SafetyRailError extends Error {
  public readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "SafetyRailError";
    this.code = code;
  }
}
