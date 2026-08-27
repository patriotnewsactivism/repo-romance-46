/**
 * Canonical domain types for the Repository Completion Operating System.
 *
 * Everything in this package is deterministic and side-effect free: given the
 * same structured input it always produces the same scores, ranges and
 * decisions. LLMs reason *over* these structures — they never produce them.
 */

/** Broad product classifications. A repository may match several. */
export type RepoKind =
  | "saas"
  | "web-app"
  | "api"
  | "mobile-app"
  | "desktop-app"
  | "cli"
  | "library"
  | "ai-agent"
  | "dev-tool"
  | "browser-extension"
  | "ecommerce"
  | "marketplace"
  | "media-platform"
  | "infrastructure"
  | "game"
  | "data-pipeline"
  | "internal-tool"
  | "static-site"
  | "monorepo";

export type FileRole =
  | "source"
  | "test"
  | "manifest"
  | "config"
  | "ci"
  | "infra"
  | "migration"
  | "docs"
  | "asset"
  | "generated"
  | "lockfile"
  | "other";

export type StubKind = "stub" | "todo" | "fixme" | "hack" | "unimplemented" | "placeholder";

export interface StubHit {
  file: string;
  line: number;
  kind: StubKind;
  snippet: string;
}

export interface IndexedFile {
  path: string;
  /** Size in bytes when the host provided it, otherwise 0. */
  size: number;
  language: string | null;
  role: FileRole;
  /** True when this file's contents were actually read during indexing. */
  analyzed: boolean;
}

/** A directory-level module in the repository knowledge graph. */
export interface ModuleNode {
  /** Directory path relative to the repo root; "." for the root module. */
  id: string;
  language: string | null;
  files: string[];
  /** Internal module ids this module imports from. */
  imports: string[];
  /** Bare package specifiers this module imports. */
  externalDeps: string[];
  /** Exported symbol names found in this module's analyzed files. */
  exports: string[];
  functionCount: number;
  stubbedFunctionCount: number;
  stubMarkers: number;
}

export interface DependencyRef {
  name: string;
  range: string;
  kind: "prod" | "dev" | "peer";
}

/** Deterministic capability signals extracted from the tree and manifests. */
export interface RepoSignals {
  hasReadme: boolean;
  hasLicense: boolean;
  hasCi: boolean;
  hasTests: boolean;
  hasTestFramework: boolean;
  hasDockerfile: boolean;
  hasDeployConfig: boolean;
  hasEnvExample: boolean;
  hasMigrations: boolean;
  hasLockfile: boolean;
  hasBuildScript: boolean;
  hasStartScript: boolean;
  hasTypecheckScript: boolean;
  hasTestScript: boolean;
  hasObservability: boolean;
  hasAuth: boolean;
  hasRateLimit: boolean;
  hasHealthEndpoint: boolean;
  hasErrorHandling: boolean;
  hasContainerOrchestration: boolean;
  /** Distinct `process.env.X` / `import.meta.env.X` names referenced in analyzed source. */
  envVarRefs: string[];
  /** Server route paths discovered in analyzed source. */
  apiRoutes: string[];
  /** Client-side route paths discovered in analyzed source. */
  frontendRoutes: string[];
  testFileCount: number;
  sourceFileCount: number;
  docFileCount: number;
  migrationFileCount: number;
}

export interface RepoIndex {
  repo: string;
  defaultBranch: string;
  indexedAt: string;
  files: IndexedFile[];
  modules: ModuleNode[];
  dependencies: DependencyRef[];
  signals: RepoSignals;
  stubs: StubHit[];
  functionCounts: { total: number; stubbed: number };
  /** True when the tree was larger than the ingestion budget. */
  truncated: boolean;
  /** How many files had their contents read (bounded by the ingestion budget). */
  analyzedFileCount: number;
  totalFileCount: number;
}

export interface Classification {
  kind: RepoKind;
  /** 0–1. Derived from how many independent signals agree. */
  confidence: number;
  evidence: string[];
}

/**
 * Facts that were *verified* by running something, not inferred from the tree.
 * Completion may only rise past the "claimed" ceiling when these are present.
 */
export interface AcceptanceEvidence {
  buildPassed?: boolean;
  typecheckPassed?: boolean;
  testsPassed?: boolean;
  testsRun?: number;
  lintPassed?: boolean;
  migrationsApplied?: boolean;
  deploymentSucceeded?: boolean;
  smokeTestsPassed?: boolean;
  criticalJourneyVerified?: boolean;
  securityBlockersResolved?: boolean;
  /** Free-form verified statements, each with the check that produced them. */
  verifiedAt?: string;
}

export type ScoreDimensionKey =
  | "product-definition"
  | "core-functionality"
  | "frontend-ux"
  | "backend-api"
  | "data-persistence"
  | "auth-security"
  | "testing"
  | "build-health"
  | "deployment"
  | "observability"
  | "documentation"
  | "production-readiness";

export interface ScoreDimension {
  key: ScoreDimensionKey;
  label: string;
  /** Share of the 100-point total this dimension is worth for this repo kind. */
  weight: number;
  /** 0–1 fraction of the dimension that is satisfied. */
  earned: number;
  earnedPoints: number;
  evidence: string[];
  missing: string[];
  /** True when the dimension is capped pending verification evidence. */
  cappedPendingEvidence: boolean;
}

export interface CompletionScorecard {
  /** 0–100. */
  overall: number;
  verdict: CompletionVerdict;
  dimensions: ScoreDimension[];
  /** Where the missing points come from, largest gap first. */
  missingBreakdown: { key: ScoreDimensionKey; label: string; lostPoints: number; reasons: string[] }[];
  profile: RepoKind;
  /** Ceiling imposed by the absence of verification evidence, if any. */
  evidenceCeiling: number | null;
}

export type CompletionVerdict =
  | "abandoned-scaffolding"
  | "early-stage"
  | "half-built"
  | "mostly-done"
  | "shippable";

export interface ReadinessCheck {
  key: string;
  label: string;
  weight: number;
  passed: boolean;
  blocking: boolean;
  detail: string;
}

export interface ReadinessScorecard {
  /** 0–100, deliberately independent of completion. */
  overall: number;
  checks: ReadinessCheck[];
  blockers: string[];
}
