/**
 * Survey recommendations and completion scores must be grounded in the
 * repository digest, not in a coerced FINISH label.
 *
 * Completion uses the same 0–100 structural weights as
 * `structuralScores` in `routes/portfolio-intelligence.ts`:
 * source 20, manifest 12, README 10, tests 14, CI 14, deploy 12,
 * env example 5, license 4, docs 4, plus up to 5 points for recent activity.
 * Readiness uses that function's readiness weights (source 18, manifest 10,
 * tests 18, CI 18, deploy 16, env example 8, license 4, activity up to 8).
 *
 * Those checks are the digest-visible slice of `docs/DEFINITION_OF_DONE.md`:
 * tests, CI, README, and deployment/config signals. A model finish percentage
 * or a coerced FINISH kind is recorded as `modelEstimate`. It is not the
 * stored completion score when it is higher than the digest evidence.
 */

export const UNGROUNDED_BATCH_MESSAGE =
  "AI batch returned no recommendation that cited the repository digest.";

/** Matches `verdictFor` in lib/repo-os scoring: 70 is "mostly-done". */
export const HIGH_COMPLETION_SCORE = 70;

export interface SurveyRecommendation {
  kind: string;
  title: string;
  repos: string[];
  pitch: string;
  effort?: number | null;
  next_steps: string[];
  tech_stack?: string[] | null;
}

export interface DigestSignals {
  hasSource: boolean;
  hasManifest: boolean;
  hasReadme: boolean;
  hasTests: boolean;
  hasCi: boolean;
  hasDeploy: boolean;
  hasEnvExample: boolean;
  hasLicense: boolean;
  hasDocs: boolean;
}

export interface DigestEvidence extends DigestSignals {
  repo: string;
  paths: string[];
  workflowNames: string[];
}

export interface DigestCompletionRecord {
  completionPct: number;
  productionReadinessPct: number;
  /** Model finish claim, retained as an input and not used as the stored score when it exceeds the digest. */
  modelEstimate: number | null;
  signals: DigestSignals;
}

export interface ModelFinishClaim {
  kind?: string | null;
  effort?: number | null;
  nextStepCount?: number | null;
  /** Explicit percentage from the model, when the payload included one. */
  completionPct?: number | null;
}

const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|swift|vue|svelte|cs|cpp|c|h)$/i;
const README_PATH = /(^|\/)readme(\.[^/]+)?$/i;
const TEST_PATH = /(^|\/)(__tests__|tests?|specs?)(\/|\.)|\.(test|spec)\.[a-z0-9]+$/i;
const CI_PATH = /(^|\/)\.github\/workflows\/.+\.ya?ml$|(^|\/)gitlab-ci\.yml$|(^|\/)\.circleci\/config\.yml$/i;
const DEPLOY_PATH =
  /(^|\/)(vercel\.json|render\.ya?ml|firebase\.json|cloudbuild\.ya?ml|dockerfile|docker-compose\.ya?ml)$/i;
const MANIFEST_PATH = /(^|\/)(package\.json|pyproject\.toml|requirements\.txt|cargo\.toml|go\.mod)$/i;
const ENV_EXAMPLE_PATH = /(^|\/)\.env\.(example|sample)$/i;
const LICENSE_PATH = /(^|\/)license(\.[^/]+)?$/i;
const DOCS_PATH = /(^|\/)docs\/|(^|\/)documentation\//i;

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function activityScore(pushedAt: string | null): number {
  if (!pushedAt) return 0;
  const parsed = Date.parse(pushedAt);
  if (!Number.isFinite(parsed)) return 0;
  const days = Math.max(0, (Date.now() - parsed) / 86_400_000);
  if (days <= 7) return 100;
  if (days <= 30) return 90;
  if (days <= 90) return 75;
  if (days <= 180) return 58;
  if (days <= 365) return 40;
  if (days <= 730) return 22;
  return 10;
}

function pathAppears(text: string, path: string): boolean {
  const trimmed = path.trim();
  if (trimmed.length < 3) return false;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9_./-])${escaped}(?:$|[^A-Za-z0-9_./-])`, "i").test(text);
}

export function claimsMissingReadme(text: string): boolean {
  return (
    /\b(?:no|missing|absent|without|lacks?|add|write|create)\b(?:\s+\w+){0,6}\s+readme\b/i.test(text) ||
    /\breadme\b(?:\s+\w+){0,6}\s+(?:is\s+)?(?:missing|absent|not present)\b/i.test(text)
  );
}

export function claimsMissingCi(text: string): boolean {
  return (
    /\b(?:no|missing|absent|without|lacks?|add|create)\b(?:\s+\w+){0,6}\s+(?:ci\b|github actions|workflows?)\b/i.test(text) ||
    /\b(?:ci|github actions|workflows?)\b(?:\s+\w+){0,6}\s+(?:is\s+)?(?:missing|absent|not present)\b/i.test(text)
  );
}

export function claimsMissingTests(text: string): boolean {
  return (
    /\b(?:no|missing|absent|without|lacks?)\b(?:\s+\w+){0,6}\s+(?:test script|tests?|test suite)\b/i.test(text) ||
    /\b(?:add|create|write)\b(?:\s+\w+){0,4}\s+(?:a\s+)?(?:test script|tests?|test suite)\b/i.test(text) ||
    /\b(?:test script|tests?|test suite)\b(?:\s+\w+){0,6}\s+(?:is\s+)?(?:missing|absent|not present)\b/i.test(text)
  );
}

function fileLines(block: string): string[] {
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.includes(" ") && !line.startsWith("==="));
}

export function parseDigestEvidence(digest: string): DigestEvidence {
  const repo = digest.match(/^REPO:\s*(\S+)/m)?.[1]?.trim() ?? "";
  const paths = new Set<string>();
  const filesBlock = digest.match(/FILES \([^)]*\):\n([\s\S]*?)(?:\n\n|$)/);
  if (filesBlock?.[1]) {
    for (const line of fileLines(filesBlock[1])) paths.add(line);
  }
  for (const match of digest.matchAll(/--- FILE:\s*(\S+)\s*---/g)) {
    paths.add(match[1]);
  }

  const hasReadmeSection = /README \(truncated\):/.test(digest);
  const hasReadme = hasReadmeSection || [...paths].some((path) => README_PATH.test(path));
  if (hasReadmeSection && ![...paths].some((path) => README_PATH.test(path))) {
    paths.add("README.md");
  }

  const workflowNames = new Set<string>();
  for (const path of paths) {
    const workflow = path.match(/(?:^|\/)\.github\/workflows\/([^/]+\.ya?ml)$/i);
    if (!workflow) continue;
    workflowNames.add(path);
    workflowNames.add(workflow[1]);
  }

  const joined = [...paths];
  const hasTests =
    joined.some((path) => TEST_PATH.test(path)) ||
    /"test"\s*:/.test(digest) ||
    /\[tool\.pytest/.test(digest);
  const signals: DigestSignals = {
    hasSource: joined.some((path) => SOURCE_FILE.test(path) && !TEST_PATH.test(path)),
    hasManifest: joined.some((path) => MANIFEST_PATH.test(path)),
    hasReadme,
    hasTests,
    hasCi: joined.some((path) => CI_PATH.test(path)),
    hasDeploy: joined.some((path) => DEPLOY_PATH.test(path)),
    hasEnvExample: joined.some((path) => ENV_EXAMPLE_PATH.test(path)),
    hasLicense: joined.some((path) => LICENSE_PATH.test(path)) || /^LICENSE:/m.test(digest),
    hasDocs: joined.some((path) => DOCS_PATH.test(path)),
  };

  return {
    repo,
    paths: [...paths],
    workflowNames: [...workflowNames],
    ...signals,
  };
}

function completionFromSignals(signals: DigestSignals, pushedAt: string | null): number {
  let score = 0;
  if (signals.hasSource) score += 20;
  if (signals.hasManifest) score += 12;
  if (signals.hasReadme) score += 10;
  if (signals.hasTests) score += 14;
  if (signals.hasCi) score += 14;
  if (signals.hasDeploy) score += 12;
  if (signals.hasEnvExample) score += 5;
  if (signals.hasLicense) score += 4;
  if (signals.hasDocs) score += 4;
  score += Math.round(activityScore(pushedAt) * 0.05);
  return Math.round(clamp(score));
}

function readinessFromSignals(signals: DigestSignals, pushedAt: string | null): number {
  let score = 0;
  if (signals.hasSource) score += 18;
  if (signals.hasManifest) score += 10;
  if (signals.hasTests) score += 18;
  if (signals.hasCi) score += 18;
  if (signals.hasDeploy) score += 16;
  if (signals.hasEnvExample) score += 8;
  if (signals.hasLicense) score += 4;
  score += Math.round(activityScore(pushedAt) * 0.08);
  return Math.round(clamp(score));
}

function pushedAtFromDigest(digest: string): string | null {
  return digest.match(/pushed:\s*([0-9]{4}-[0-9]{2}-[0-9]{2}[^ \n]*)/i)?.[1] ?? null;
}

/**
 * The effort formula previously used when GitHub enrichment was unavailable:
 * a FINISH with effort 1 scored 84 even if the digest had no tests, CI, or README.
 * Kept only so that claim can be compared with digest evidence.
 */
export function modelFinishEstimate(claim: ModelFinishClaim): number | null {
  if (typeof claim.completionPct === "number" && Number.isFinite(claim.completionPct)) {
    return clamp(claim.completionPct);
  }
  if (String(claim.kind ?? "").trim().toLowerCase() !== "finish") return null;
  const effort = Math.max(1, Math.min(5, claim.effort || 1));
  const nextStepCount = Math.max(0, claim.nextStepCount ?? 0);
  return Math.round(clamp(84 - (effort - 1) * 9 - Math.min(10, nextStepCount) * 1.2, 24, 84));
}

export function adjustCompletionFromDigest(digest: string, claim: ModelFinishClaim = {}): DigestCompletionRecord {
  const evidence = parseDigestEvidence(digest);
  const pushedAt = pushedAtFromDigest(digest);
  const evidenceCompletion = completionFromSignals(evidence, pushedAt);
  const modelEstimate = modelFinishEstimate(claim);
  // Evidence is the stored completion signal. An optimistic model claim is
  // discarded. A lower model claim still participates by averaging, so it
  // remains an input without being the only number saved.
  const completionPct =
    modelEstimate == null || modelEstimate > evidenceCompletion
      ? evidenceCompletion
      : Math.round((evidenceCompletion + modelEstimate) / 2);

  const signals: DigestSignals = {
    hasSource: evidence.hasSource,
    hasManifest: evidence.hasManifest,
    hasReadme: evidence.hasReadme,
    hasTests: evidence.hasTests,
    hasCi: evidence.hasCi,
    hasDeploy: evidence.hasDeploy,
    hasEnvExample: evidence.hasEnvExample,
    hasLicense: evidence.hasLicense,
    hasDocs: evidence.hasDocs,
  };
  return {
    completionPct,
    productionReadinessPct: readinessFromSignals(evidence, pushedAt),
    modelEstimate,
    signals,
  };
}

export function isUngroundedSurveyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("cited the repository digest");
}

function normalizeRepo(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\.git$/, "");
}

function reposMatch(left: string, right: string): boolean {
  const a = normalizeRepo(left);
  const b = normalizeRepo(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes("/") && b.includes("/")) return false;
  const short = a.includes("/") ? b : a;
  const full = a.includes("/") ? a : b;
  return short.length > 0 && full.endsWith(`/${short}`);
}

function recommendationText(recommendation: SurveyRecommendation): string {
  return [recommendation.title, recommendation.pitch, ...(recommendation.next_steps ?? []), ...(recommendation.tech_stack ?? [])]
    .filter((part) => typeof part === "string" && part.trim().length > 0)
    .join("\n");
}

function citesDigest(text: string, fact: DigestEvidence): boolean {
  const missingReadme = claimsMissingReadme(text);
  const missingCi = claimsMissingCi(text);
  const missingTests = claimsMissingTests(text);
  if (!fact.hasReadme && missingReadme) return true;
  if (!fact.hasCi && missingCi) return true;
  if (!fact.hasTests && missingTests) return true;

  const contradicted = (fact.hasReadme && missingReadme) || (fact.hasCi && missingCi) || (fact.hasTests && missingTests);
  const skipPath = (path: string) => {
    if (!contradicted) return false;
    return README_PATH.test(path) || CI_PATH.test(path) || TEST_PATH.test(path);
  };

  for (const path of fact.paths) {
    if (skipPath(path)) continue;
    if (pathAppears(text, path)) return true;
  }
  if (fact.hasReadme && !missingReadme && /\breadme(?:\.[a-z0-9]+)?\b/i.test(text)) return true;
  for (const name of fact.workflowNames) {
    if (pathAppears(text, name)) return true;
  }
  return false;
}

function digestsForRecommendation(recommendation: SurveyRecommendation, facts: DigestEvidence[]): DigestEvidence[] {
  const named = recommendation.repos.filter((repo) => repo.trim().length > 0);
  if (named.length === 0 || facts.length === 0) return [];
  const matched = named.map((repo) => facts.find((fact) => fact.repo && reposMatch(repo, fact.repo)) ?? null);
  if (matched.some((fact) => fact == null)) return [];
  return matched.filter((fact): fact is DigestEvidence => fact != null);
}

/**
 * Drop recommendations that do not cite something present in the matching
 * repo digest: a real file path, a missing README/CI/test script the digest
 * confirms, or a named workflow. A coerced FINISH with no such citation is
 * removed.
 */
export function groundRecommendationsInDigests<T extends SurveyRecommendation>(
  recommendations: T[],
  digests: string[],
): T[] {
  const facts = digests.map(parseDigestEvidence).filter((fact) => fact.repo.length > 0);
  return recommendations.filter((recommendation) => {
    const relevant = digestsForRecommendation(recommendation, facts);
    if (relevant.length === 0) return false;
    const text = recommendationText(recommendation);
    return relevant.every((fact) => citesDigest(text, fact));
  });
}

export function groundBatchRecommendations<T extends { recommendations: SurveyRecommendation[] }>(
  batch: T,
  digests: string[],
): T {
  const recommendations = groundRecommendationsInDigests(batch.recommendations, digests);
  if (recommendations.length === 0) {
    throw new Error(UNGROUNDED_BATCH_MESSAGE);
  }
  return { ...batch, recommendations };
}

export function completionSignalsForRecommendations(
  digests: string[],
  recommendations: SurveyRecommendation[],
): Record<string, DigestCompletionRecord> {
  const facts = digests.map(parseDigestEvidence).filter((fact) => fact.repo.length > 0);
  const digestByRepo = new Map(facts.map((fact) => [fact.repo.toLowerCase(), fact.repo]));
  const rawDigestByRepo = new Map<string, string>();
  for (const digest of digests) {
    const repo = parseDigestEvidence(digest).repo;
    if (repo) rawDigestByRepo.set(repo.toLowerCase(), digest);
  }

  const scores: Record<string, DigestCompletionRecord> = {};
  for (const recommendation of recommendations) {
    for (const name of recommendation.repos) {
      const fact = facts.find((candidate) => reposMatch(name, candidate.repo));
      if (!fact) continue;
      const key = digestByRepo.get(fact.repo.toLowerCase()) ?? fact.repo;
      if (scores[key]) continue;
      const digest = rawDigestByRepo.get(fact.repo.toLowerCase());
      if (!digest) continue;
      scores[key] = adjustCompletionFromDigest(digest, {
        kind: recommendation.kind,
        effort: recommendation.effort,
        nextStepCount: recommendation.next_steps.length,
      });
    }
  }
  return scores;
}

export function readDigestCompletionMap(portfolioStats: unknown): Map<string, DigestCompletionRecord> {
  const map = new Map<string, DigestCompletionRecord>();
  if (!portfolioStats || typeof portfolioStats !== "object" || Array.isArray(portfolioStats)) return map;
  const raw = (portfolioStats as Record<string, unknown>)._digest_completion;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return map;
  for (const [repo, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    const completionPct = Number(record.completionPct);
    const productionReadinessPct = Number(record.productionReadinessPct);
    if (!Number.isFinite(completionPct) || !Number.isFinite(productionReadinessPct)) continue;
    const modelEstimate = Number(record.modelEstimate);
    const signals = record.signals && typeof record.signals === "object" ? (record.signals as DigestSignals) : null;
    map.set(repo, {
      completionPct,
      productionReadinessPct,
      modelEstimate: Number.isFinite(modelEstimate) ? modelEstimate : null,
      signals: {
        hasSource: Boolean(signals?.hasSource),
        hasManifest: Boolean(signals?.hasManifest),
        hasReadme: Boolean(signals?.hasReadme),
        hasTests: Boolean(signals?.hasTests),
        hasCi: Boolean(signals?.hasCi),
        hasDeploy: Boolean(signals?.hasDeploy),
        hasEnvExample: Boolean(signals?.hasEnvExample),
        hasLicense: Boolean(signals?.hasLicense),
        hasDocs: Boolean(signals?.hasDocs),
      },
    });
  }
  return map;
}

/**
 * Choose the completion percentage that portfolio fallback scoring may store.
 * Digest evidence wins. With no digest, a model FINISH/effort estimate is
 * capped at 44 so the label alone cannot read as a high finish score.
 */
export function storedSurveyCompletion(input: {
  modelEstimate: number | null;
  digestCompletionPct: number | null;
}): number {
  if (input.digestCompletionPct != null && Number.isFinite(input.digestCompletionPct)) {
    return clamp(input.digestCompletionPct);
  }
  if (input.modelEstimate == null || !Number.isFinite(input.modelEstimate)) return 0;
  // 44 stays under the half-built threshold. A FINISH label with no digest
  // must not be stored as a high completion score.
  return Math.min(clamp(input.modelEstimate), 44);
}
