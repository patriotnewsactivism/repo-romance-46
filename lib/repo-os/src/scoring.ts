/**
 * Adaptive completion scoring and production-readiness scoring.
 *
 * Two rules make these numbers defensible rather than cosmetic:
 *
 *  1. Weights adapt to what the repository *is*. A library is not marked down
 *     for having no deployment pipeline; a SaaS app is.
 *  2. A score never rises because files changed. Dimensions that can only be
 *     confirmed by running something (build, tests, deploy, smoke tests) are
 *     capped until `AcceptanceEvidence` says the check actually passed.
 */

import type {
  AcceptanceEvidence,
  CompletionScorecard,
  CompletionVerdict,
  ReadinessCheck,
  ReadinessScorecard,
  RepoIndex,
  RepoKind,
  ScoreDimension,
  ScoreDimensionKey,
} from "./types";

const DIMENSION_LABELS: Record<ScoreDimensionKey, string> = {
  "product-definition": "Product definition / intended behavior",
  "core-functionality": "Core functionality",
  "frontend-ux": "Frontend / UX / usability",
  "backend-api": "Backend / APIs / integrations",
  "data-persistence": "Data persistence / migrations",
  "auth-security": "Authentication / authorization / security",
  testing: "Testing / QA",
  "build-health": "Build reliability / dependency health",
  deployment: "Deployment / infrastructure",
  observability: "Observability / error reporting",
  documentation: "Documentation / onboarding",
  "production-readiness": "Production readiness",
};

type WeightProfile = Record<ScoreDimensionKey, number>;

/** The application/SaaS baseline from the product spec. Sums to 100. */
const APP_PROFILE: WeightProfile = {
  "product-definition": 10,
  "core-functionality": 20,
  "frontend-ux": 10,
  "backend-api": 10,
  "data-persistence": 8,
  "auth-security": 10,
  testing: 10,
  "build-health": 7,
  deployment: 7,
  observability: 3,
  documentation: 3,
  "production-readiness": 2,
};

/** Per-kind overrides applied on top of the baseline, then renormalized to 100. */
const PROFILE_OVERRIDES: Partial<Record<RepoKind, Partial<WeightProfile>>> = {
  library: { "frontend-ux": 0, "auth-security": 2, deployment: 1, "data-persistence": 0, testing: 18, documentation: 10, "core-functionality": 24, "backend-api": 2 },
  cli: { "frontend-ux": 2, "auth-security": 3, "data-persistence": 2, deployment: 3, testing: 15, documentation: 8, "core-functionality": 24, "backend-api": 3 },
  api: { "frontend-ux": 0, "backend-api": 22, "core-functionality": 18, "auth-security": 12, deployment: 9, observability: 5 },
  "web-app": { "frontend-ux": 18, "backend-api": 6, "data-persistence": 5 },
  "static-site": { "frontend-ux": 22, "backend-api": 0, "data-persistence": 0, "auth-security": 2, testing: 4, deployment: 12, documentation: 6, "core-functionality": 14 },
  "mobile-app": { "frontend-ux": 20, deployment: 9, "backend-api": 6 },
  "dev-tool": { "frontend-ux": 2, testing: 16, documentation: 9, "core-functionality": 24, "auth-security": 4, "data-persistence": 2 },
  "ai-agent": { "core-functionality": 22, observability: 6, "auth-security": 11, testing: 11 },
  infrastructure: { "frontend-ux": 0, "core-functionality": 16, deployment: 20, observability: 8, testing: 8, "data-persistence": 4, "auth-security": 12 },
  "data-pipeline": { "frontend-ux": 0, "data-persistence": 14, observability: 8, testing: 14, "backend-api": 6 },
  game: { "frontend-ux": 20, "backend-api": 4, "data-persistence": 3, "auth-security": 4 },
  "browser-extension": { deployment: 4, "backend-api": 4, "data-persistence": 2, "frontend-ux": 16 },
};

/** Resolve and renormalize the weight profile for a repository kind. */
export function weightProfileFor(kind: RepoKind): WeightProfile {
  const merged: WeightProfile = { ...APP_PROFILE, ...(PROFILE_OVERRIDES[kind] ?? {}) };
  const total = Object.values(merged).reduce((a, b) => a + b, 0);
  if (total === 0) return merged;
  const scaled = Object.fromEntries(
    Object.entries(merged).map(([key, weight]) => [key, (weight / total) * 100]),
  ) as WeightProfile;
  return scaled;
}

interface DimensionResult {
  earned: number;
  evidence: string[];
  missing: string[];
  /** Ceiling on `earned` while the listed verification has not passed. */
  cap?: { limit: number; reason: string };
}

type DimensionScorer = (index: RepoIndex, acceptance: AcceptanceEvidence) => DimensionResult;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

const SCORERS: Record<ScoreDimensionKey, DimensionScorer> = {
  "product-definition": (index) => {
    const evidence: string[] = [];
    const missing: string[] = [];
    let earned = 0;
    if (index.signals.hasReadme) {
      earned += 0.45;
      evidence.push("README present");
    } else {
      missing.push("No README — the intended product is undocumented");
    }
    if (index.signals.docFileCount >= 3) {
      earned += 0.25;
      evidence.push(`${index.signals.docFileCount} documentation files`);
    } else {
      missing.push("Fewer than 3 documentation files");
    }
    if (index.signals.hasEnvExample) {
      earned += 0.15;
      evidence.push(".env example declares required configuration");
    } else {
      missing.push("No .env example — required configuration is implicit");
    }
    if (index.signals.hasLicense) {
      earned += 0.15;
      evidence.push("LICENSE present");
    } else {
      missing.push("No LICENSE — redistribution terms undefined");
    }
    return { earned: clamp01(earned), evidence, missing };
  },

  "core-functionality": (index, acceptance) => {
    const evidence: string[] = [];
    const missing: string[] = [];
    const { total, stubbed } = index.functionCounts;

    let earned: number;
    if (total === 0 && index.signals.sourceFileCount > 5) {
      const markerRatio = Math.min(1, index.stubs.length / Math.max(index.signals.sourceFileCount, 1) / 2);
      earned = (1 - markerRatio) * 0.7;
      missing.push(`Could not count functions across ${index.signals.sourceFileCount} source files — completeness capped without that evidence`);
    } else if (total === 0) {
      earned = index.signals.sourceFileCount > 0 ? 0.35 : 0.05;
      missing.push(index.signals.sourceFileCount > 0 ? "Few detectable functions — early scaffolding" : "No source files detected");
    } else {
      const stubRatio = stubbed / total;
      earned = 1 - stubRatio;
      if (stubRatio > 0.2) {
        missing.push(`${Math.round(stubRatio * 100)}% of detected functions are stubs or empty bodies`);
      }
      evidence.push(`${total - stubbed}/${total} detected functions have real bodies`);
    }

    const stubsPerFile = index.signals.sourceFileCount > 0 ? index.stubs.length / index.signals.sourceFileCount : 0;
    if (stubsPerFile > 1) {
      earned -= 0.12;
      missing.push(`High incomplete-marker density: ${index.stubs.length} markers across ${index.signals.sourceFileCount} source files`);
    } else if (index.stubs.length >= 10) {
      earned -= 0.05;
      missing.push(`${index.stubs.length} TODO/FIXME/stub markers remain`);
    }

    const result: DimensionResult = { earned: clamp01(earned), evidence, missing };
    if (!acceptance.buildPassed) {
      result.cap = { limit: 0.8, reason: "no verified build" };
    }
    return result;
  },

  "frontend-ux": (index) => {
    const evidence: string[] = [];
    const missing: string[] = [];
    let earned = 0;
    const routes = index.signals.frontendRoutes.length;
    if (routes >= 5) {
      earned += 0.5;
      evidence.push(`${routes} client routes`);
    } else if (routes > 0) {
      earned += 0.3;
      evidence.push(`${routes} client routes`);
      missing.push("Fewer than 5 client routes — the user journey may be incomplete");
    } else {
      missing.push("No client routes detected");
    }
    const componentModules = index.modules.filter((m) => /(components?|pages|views|screens)/i.test(m.id));
    if (componentModules.length > 0) {
      earned += 0.3;
      evidence.push(`${componentModules.length} component/page modules`);
    } else {
      missing.push("No component or page modules found");
    }
    if (index.files.some((f) => /\.(css|scss)$/.test(f.path)) || index.dependencies.some((d) => /tailwind|styled-components|emotion/.test(d.name))) {
      earned += 0.2;
      evidence.push("Styling system present");
    } else {
      missing.push("No styling system detected");
    }
    return { earned: clamp01(earned), evidence, missing };
  },

  "backend-api": (index) => {
    const evidence: string[] = [];
    const missing: string[] = [];
    let earned = 0;
    const routes = index.signals.apiRoutes.length;
    if (routes >= 8) {
      earned += 0.5;
      evidence.push(`${routes} server routes registered`);
    } else if (routes > 0) {
      earned += 0.25 + Math.min(0.25, routes * 0.03);
      evidence.push(`${routes} server routes registered`);
      missing.push("Small API surface — core endpoints may be missing");
    } else {
      missing.push("No server routes detected");
    }
    if (index.files.some((f) => /openapi\.(ya?ml|json)$/i.test(f.path))) {
      earned += 0.2;
      evidence.push("API contract (OpenAPI) checked in");
    } else {
      missing.push("No API contract file — clients cannot be generated or verified");
    }
    if (index.signals.hasErrorHandling) {
      earned += 0.15;
      evidence.push("Error handling present in analyzed source");
    } else {
      missing.push("No error handling found in analyzed source");
    }
    if (index.signals.hasHealthEndpoint) {
      earned += 0.15;
      evidence.push("Health endpoint exposed");
    } else {
      missing.push("No health endpoint — deployments cannot be verified automatically");
    }
    return { earned: clamp01(earned), evidence, missing };
  },

  "data-persistence": (index, acceptance) => {
    const evidence: string[] = [];
    const missing: string[] = [];
    let earned = 0;
    if (index.signals.hasMigrations) {
      earned += 0.5;
      evidence.push(`${index.signals.migrationFileCount} migration files`);
    } else {
      missing.push("No migrations — schema changes are not reproducible");
    }
    if (index.dependencies.some((d) => /drizzle-orm|prisma|typeorm|sequelize|mongoose|sqlalchemy|knex/.test(d.name))) {
      earned += 0.3;
      evidence.push("Data-access layer dependency present");
    } else {
      missing.push("No ORM or query-builder dependency detected");
    }
    if (index.modules.some((m) => /(schema|models?|entities|db)/i.test(m.id))) {
      earned += 0.2;
      evidence.push("Schema/model modules present");
    } else {
      missing.push("No schema or model modules found");
    }
    const result: DimensionResult = { earned: clamp01(earned), evidence, missing };
    if (index.signals.hasMigrations && !acceptance.migrationsApplied) {
      result.cap = { limit: 0.85, reason: "migrations never verified against a database" };
    }
    return result;
  },

  "auth-security": (index, acceptance) => {
    const evidence: string[] = [];
    const missing: string[] = [];
    let earned = 0;
    if (index.signals.hasAuth) {
      earned += 0.4;
      evidence.push("Authentication mechanism present");
    } else {
      missing.push("No authentication mechanism detected");
    }
    if (index.signals.hasRateLimit) {
      earned += 0.2;
      evidence.push("Rate limiting present");
    } else {
      missing.push("No rate limiting — endpoints are abusable");
    }
    if (index.signals.hasEnvExample && !index.files.some((f) => /(^|\/)\.env$/.test(f.path))) {
      earned += 0.2;
      evidence.push("Secrets kept out of the repository");
    } else if (index.files.some((f) => /(^|\/)\.env$/.test(f.path))) {
      missing.push("A committed .env file is present — likely secret exposure");
    } else {
      missing.push("Secret handling is undocumented");
    }
    if (index.dependencies.some((d) => /helmet|cors|csurf/.test(d.name))) {
      earned += 0.2;
      evidence.push("HTTP hardening middleware present");
    } else {
      missing.push("No HTTP hardening middleware (helmet/cors) detected");
    }
    const result: DimensionResult = { earned: clamp01(earned), evidence, missing };
    if (!acceptance.securityBlockersResolved) {
      result.cap = { limit: 0.85, reason: "no security review recorded" };
    }
    return result;
  },

  testing: (index, acceptance) => {
    const evidence: string[] = [];
    const missing: string[] = [];
    let earned = 0;
    if (index.signals.hasTestFramework) {
      earned += 0.2;
      evidence.push("Test framework configured");
    } else {
      missing.push("No test framework configured");
    }
    const ratio = index.signals.sourceFileCount > 0 ? index.signals.testFileCount / index.signals.sourceFileCount : 0;
    if (index.signals.testFileCount > 0) {
      earned += Math.min(0.5, ratio * 2);
      evidence.push(`${index.signals.testFileCount} test files for ${index.signals.sourceFileCount} source files`);
      if (ratio < 0.25) missing.push("Test-to-source ratio below 1:4 — coverage is likely thin");
    } else {
      missing.push("No test files found");
    }
    if (index.signals.hasCi) {
      earned += 0.15;
      evidence.push("CI workflow present");
    } else {
      missing.push("No CI workflow — tests are never enforced");
    }
    if (acceptance.testsPassed) {
      earned += 0.15;
      evidence.push(`Test suite verified passing${acceptance.testsRun ? ` (${acceptance.testsRun} tests)` : ""}`);
    } else {
      missing.push("Test suite has not been observed passing");
    }
    const result: DimensionResult = { earned: clamp01(earned), evidence, missing };
    if (!acceptance.testsPassed) {
      result.cap = { limit: 0.6, reason: "tests never observed passing" };
    }
    return result;
  },

  "build-health": (index, acceptance) => {
    const evidence: string[] = [];
    const missing: string[] = [];
    let earned = 0;
    if (index.signals.hasBuildScript) {
      earned += 0.25;
      evidence.push("Build script defined");
    } else {
      missing.push("No build script defined");
    }
    if (index.signals.hasLockfile) {
      earned += 0.25;
      evidence.push("Dependency lockfile committed");
    } else {
      missing.push("No lockfile — builds are not reproducible");
    }
    if (index.signals.hasTypecheckScript) {
      earned += 0.2;
      evidence.push("Typecheck script defined");
    } else {
      missing.push("No typecheck script");
    }
    if (acceptance.buildPassed) {
      earned += 0.2;
      evidence.push("Build verified passing");
    } else {
      missing.push("Build has not been observed passing");
    }
    if (acceptance.typecheckPassed) {
      earned += 0.1;
      evidence.push("Typecheck verified passing");
    } else {
      missing.push("Typecheck has not been observed passing");
    }
    const result: DimensionResult = { earned: clamp01(earned), evidence, missing };
    if (!acceptance.buildPassed) {
      result.cap = { limit: 0.7, reason: "build never observed passing" };
    }
    return result;
  },

  deployment: (index, acceptance) => {
    const evidence: string[] = [];
    const missing: string[] = [];
    let earned = 0;
    if (index.signals.hasDockerfile) {
      earned += 0.3;
      evidence.push("Dockerfile present");
    } else {
      missing.push("No Dockerfile");
    }
    if (index.signals.hasDeployConfig) {
      earned += 0.3;
      evidence.push("Platform deployment config present");
    } else {
      missing.push("No platform deployment config");
    }
    if (index.signals.hasCi) {
      earned += 0.2;
      evidence.push("CI pipeline present");
    } else {
      missing.push("No CI pipeline to build or ship from");
    }
    if (acceptance.deploymentSucceeded) {
      earned += 0.2;
      evidence.push("Deployment verified succeeding");
    } else {
      missing.push("No verified deployment");
    }
    const result: DimensionResult = { earned: clamp01(earned), evidence, missing };
    if (!acceptance.deploymentSucceeded) {
      result.cap = { limit: 0.8, reason: "deployment never verified" };
    }
    return result;
  },

  observability: (index) => {
    const evidence: string[] = [];
    const missing: string[] = [];
    let earned = 0;
    if (index.signals.hasObservability) {
      earned += 0.6;
      evidence.push("Logging or error-reporting dependency present");
    } else {
      missing.push("No structured logging or error reporting");
    }
    if (index.signals.hasHealthEndpoint) {
      earned += 0.4;
      evidence.push("Health endpoint exposed");
    } else {
      missing.push("No health endpoint");
    }
    return { earned: clamp01(earned), evidence, missing };
  },

  documentation: (index) => {
    const evidence: string[] = [];
    const missing: string[] = [];
    let earned = 0;
    if (index.signals.hasReadme) {
      earned += 0.5;
      evidence.push("README present");
    } else {
      missing.push("No README");
    }
    if (index.signals.docFileCount >= 5) {
      earned += 0.3;
      evidence.push(`${index.signals.docFileCount} documentation files`);
    } else {
      missing.push("Sparse documentation");
    }
    if (index.signals.hasEnvExample) {
      earned += 0.2;
      evidence.push("Configuration documented via .env example");
    } else {
      missing.push("Required configuration is not documented");
    }
    return { earned: clamp01(earned), evidence, missing };
  },

  "production-readiness": (_index, acceptance) => {
    const evidence: string[] = [];
    const missing: string[] = [];
    let earned = 0;
    if (acceptance.smokeTestsPassed) {
      earned += 0.5;
      evidence.push("Post-deployment smoke tests passed");
    } else {
      missing.push("No post-deployment smoke tests");
    }
    if (acceptance.criticalJourneyVerified) {
      earned += 0.5;
      evidence.push("Critical user journey verified in a running environment");
    } else {
      missing.push("Critical user journey never verified end to end");
    }
    return { earned: clamp01(earned), evidence, missing };
  },
};

function verdictFor(score: number): CompletionVerdict {
  if (score >= 90) return "shippable";
  if (score >= 70) return "mostly-done";
  if (score >= 45) return "half-built";
  if (score >= 20) return "early-stage";
  return "abandoned-scaffolding";
}

/**
 * The ceiling completion may reach given what has actually been verified.
 * "100% because the AI says so" is impossible by construction.
 */
export function evidenceCeiling(acceptance: AcceptanceEvidence): number | null {
  const gates: { ok: boolean; ceiling: number }[] = [
    { ok: Boolean(acceptance.buildPassed), ceiling: 75 },
    { ok: Boolean(acceptance.testsPassed), ceiling: 85 },
    { ok: Boolean(acceptance.securityBlockersResolved), ceiling: 90 },
    { ok: Boolean(acceptance.deploymentSucceeded), ceiling: 95 },
    { ok: Boolean(acceptance.smokeTestsPassed && acceptance.criticalJourneyVerified), ceiling: 99 },
  ];
  const unmet = gates.filter((g) => !g.ok).map((g) => g.ceiling);
  return unmet.length === 0 ? null : Math.min(...unmet);
}

export function scoreCompletion(
  index: RepoIndex,
  kind: RepoKind,
  acceptance: AcceptanceEvidence = {},
): CompletionScorecard {
  const weights = weightProfileFor(kind);
  const dimensions: ScoreDimension[] = [];

  for (const key of Object.keys(weights) as ScoreDimensionKey[]) {
    const weight = weights[key];
    const scorer = SCORERS[key];
    const result = scorer(index, acceptance);

    let earned = result.earned;
    let cappedPendingEvidence = false;
    if (result.cap && earned > result.cap.limit) {
      earned = result.cap.limit;
      cappedPendingEvidence = true;
      result.missing.push(`Capped at ${Math.round(result.cap.limit * 100)}% — ${result.cap.reason}`);
    }

    dimensions.push({
      key,
      label: DIMENSION_LABELS[key],
      weight: Math.round(weight * 100) / 100,
      earned: Math.round(earned * 1000) / 1000,
      earnedPoints: Math.round(earned * weight * 100) / 100,
      evidence: result.evidence,
      missing: result.missing,
      cappedPendingEvidence,
    });
  }

  const raw = dimensions.reduce((sum, d) => sum + d.earnedPoints, 0);
  const ceiling = evidenceCeiling(acceptance);
  const overall = Math.round(ceiling === null ? raw : Math.min(raw, ceiling));

  const missingBreakdown = dimensions
    .map((d) => ({
      key: d.key,
      label: d.label,
      lostPoints: Math.round((d.weight - d.earnedPoints) * 10) / 10,
      reasons: d.missing,
    }))
    .filter((d) => d.lostPoints > 0.05)
    .sort((a, b) => b.lostPoints - a.lostPoints);

  return {
    overall,
    verdict: verdictFor(overall),
    dimensions,
    missingBreakdown,
    profile: kind,
    evidenceCeiling: ceiling,
  };
}

/**
 * Production readiness, deliberately independent of completion: a feature-
 * complete product can still be unsafe or undeployable.
 */
export function scoreProductionReadiness(index: RepoIndex, acceptance: AcceptanceEvidence = {}): ReadinessScorecard {
  const s = index.signals;
  const committedEnv = index.files.some((f) => /(^|\/)\.env$/.test(f.path));

  const checks: ReadinessCheck[] = [
    { key: "auth", label: "Authentication enforced", weight: 12, passed: s.hasAuth, blocking: true, detail: s.hasAuth ? "Authentication mechanism detected" : "No authentication mechanism detected" },
    { key: "secrets", label: "Secrets kept out of the repository", weight: 12, passed: !committedEnv, blocking: true, detail: committedEnv ? "A committed .env file is present" : "No committed .env file" },
    { key: "security-review", label: "Security blockers resolved", weight: 10, passed: Boolean(acceptance.securityBlockersResolved), blocking: true, detail: acceptance.securityBlockersResolved ? "Security review recorded as clear" : "No security review recorded" },
    { key: "error-handling", label: "Error handling present", weight: 8, passed: s.hasErrorHandling, blocking: false, detail: s.hasErrorHandling ? "Error handling found in analyzed source" : "No error handling found" },
    { key: "logging", label: "Structured logging / error reporting", weight: 8, passed: s.hasObservability, blocking: false, detail: s.hasObservability ? "Logging or error-reporting dependency present" : "No logging or error-reporting dependency" },
    { key: "rate-limit", label: "Rate limiting", weight: 7, passed: s.hasRateLimit, blocking: false, detail: s.hasRateLimit ? "Rate limiting present" : "No rate limiting" },
    { key: "health", label: "Health endpoint", weight: 6, passed: s.hasHealthEndpoint, blocking: false, detail: s.hasHealthEndpoint ? "Health endpoint exposed" : "No health endpoint" },
    { key: "deployability", label: "Deployment configuration", weight: 9, passed: s.hasDockerfile || s.hasDeployConfig, blocking: true, detail: s.hasDockerfile || s.hasDeployConfig ? "Deployment configuration present" : "Nothing describes how this deploys" },
    { key: "ci", label: "CI pipeline", weight: 8, passed: s.hasCi, blocking: false, detail: s.hasCi ? "CI workflow present" : "No CI workflow" },
    { key: "data-safety", label: "Reproducible schema migrations", weight: 6, passed: s.hasMigrations || !s.hasAuth, blocking: false, detail: s.hasMigrations ? "Migrations committed" : "No migrations committed" },
    { key: "reproducible-build", label: "Reproducible build", weight: 6, passed: s.hasLockfile && s.hasBuildScript, blocking: false, detail: s.hasLockfile && s.hasBuildScript ? "Lockfile and build script present" : "Build is not reproducible from the repository alone" },
    { key: "verified-deploy", label: "Deployment verified", weight: 8, passed: Boolean(acceptance.deploymentSucceeded && acceptance.smokeTestsPassed), blocking: true, detail: acceptance.deploymentSucceeded ? (acceptance.smokeTestsPassed ? "Deployment and smoke tests verified" : "Deployed, but smoke tests never passed") : "No verified deployment" },
  ];

  const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0);
  const earned = checks.filter((c) => c.passed).reduce((sum, c) => sum + c.weight, 0);

  return {
    overall: Math.round((earned / totalWeight) * 100),
    checks,
    blockers: checks.filter((c) => c.blocking && !c.passed).map((c) => `${c.label}: ${c.detail}`),
  };
}
