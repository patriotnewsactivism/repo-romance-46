// Scope Guard — enforces single-repo discipline by default.
// Multi-repo operations require explicit opt-in with risk acknowledgment.
// Prevents accidental cross-repo mutations that could cascade failures.

// ─── Types ─────────────────────────────────────────────────────

export interface ScopeContext {
  /** The repo currently being worked on (null = portfolio-level) */
  activeRepo: string | null;
  /** Whether multi-repo mode is explicitly enabled */
  multiRepoEnabled: boolean;
  /** Repos that have been touched in this session */
  touchedRepos: Set<string>;
  /** Maximum repos allowed in multi-repo mode */
  maxMultiRepos: number;
}

export interface ScopeViolation {
  type: "cross_repo" | "max_repos_exceeded" | "implicit_multi_repo";
  message: string;
  activeRepo: string | null;
  attemptedRepo: string;
  touchedRepos: string[];
}

export class ScopeViolationError extends Error {
  public violation: ScopeViolation;

  constructor(violation: ScopeViolation) {
    super(`Scope violation: ${violation.message}`);
    this.name = "ScopeViolationError";
    this.violation = violation;
  }
}

// ─── Default scope ─────────────────────────────────────────────

const DEFAULT_MAX_MULTI_REPOS = 5;

/**
 * Create a new scope context for a work session.
 * By default: single-repo mode. Call enableMultiRepo() to unlock.
 */
export function createScope(repo?: string): ScopeContext {
  return {
    activeRepo: repo ?? null,
    multiRepoEnabled: false,
    touchedRepos: new Set(repo ? [repo] : []),
    maxMultiRepos: DEFAULT_MAX_MULTI_REPOS,
  };
}

/**
 * Enable multi-repo mode with a risk-aware limit.
 * This is the explicit opt-in that Don's requirements demand.
 */
export function enableMultiRepo(
  scope: ScopeContext,
  maxRepos: number = DEFAULT_MAX_MULTI_REPOS,
): ScopeContext {
  return {
    ...scope,
    multiRepoEnabled: true,
    maxMultiRepos: maxRepos,
  };
}

// ─── Enforcement ───────────────────────────────────────────────

/**
 * Assert that a repo operation is within the current scope.
 * Throws ScopeViolationError if:
 * - In single-repo mode and trying to touch a different repo
 * - In multi-repo mode but exceeding the repo limit
 *
 * Call before any repo-mutating operation (finish, PR, commit, etc.)
 */
export function assertWithinScope(scope: ScopeContext, repo: string): void {
  // First repo sets the scope
  if (scope.activeRepo === null) {
    scope.activeRepo = repo;
    scope.touchedRepos.add(repo);
    return;
  }

  // Same repo — always OK
  if (scope.activeRepo === repo) {
    return;
  }

  // Different repo — check mode
  if (!scope.multiRepoEnabled) {
    throw new ScopeViolationError({
      type: "implicit_multi_repo",
      message: `Attempted to operate on "${repo}" while scoped to "${scope.activeRepo}". ` +
        `Multi-repo mode is not enabled. Enable it explicitly if cross-repo work is intended.`,
      activeRepo: scope.activeRepo,
      attemptedRepo: repo,
      touchedRepos: Array.from(scope.touchedRepos),
    });
  }

  // Multi-repo mode — check limits
  scope.touchedRepos.add(repo);
  if (scope.touchedRepos.size > scope.maxMultiRepos) {
    throw new ScopeViolationError({
      type: "max_repos_exceeded",
      message: `Multi-repo limit exceeded: touched ${scope.touchedRepos.size} repos ` +
        `(max ${scope.maxMultiRepos}). Reduce scope or increase the limit.`,
      activeRepo: scope.activeRepo,
      attemptedRepo: repo,
      touchedRepos: Array.from(scope.touchedRepos),
    });
  }
}

/**
 * Format a scope status for display in PR bodies, logs, etc.
 */
export function formatScopeStatus(scope: ScopeContext): string {
  const mode = scope.multiRepoEnabled ? "multi-repo" : "single-repo";
  const repos = Array.from(scope.touchedRepos);

  if (repos.length === 0) return `🔒 Scope: ${mode} (no repos touched yet)`;
  if (repos.length === 1) return `🔒 Scope: ${mode} — active on \`${repos[0]}\``;
  return `⚠️ Scope: ${mode} — touching ${repos.length} repos: ${repos.map((r) => `\`${r}\``).join(", ")}`;
}

/**
 * Check if a multi-repo operation should get a risk callout.
 * Returns a warning string if risky, null if fine.
 */
export function multiRepoRiskCheck(repos: string[]): string | null {
  if (repos.length <= 1) return null;

  const warnings: string[] = [];
  warnings.push(`⚠️ **Multi-repo operation** touching ${repos.length} repositories.`);
  warnings.push("Each repo will receive its own PR — review and merge them independently.");

  if (repos.length > 3) {
    warnings.push("🔴 **High scope** — operating on 4+ repos in one session increases failure risk.");
    warnings.push("Consider breaking this into smaller batches.");
  }

  return warnings.join("\n");
}
