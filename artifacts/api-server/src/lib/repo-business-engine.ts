/**
 * Repository business intelligence.
 *
 * Answers three questions for every repository, from evidence rather than
 * vibes:
 *
 *   1. Where is this repository actually at?   → `gradeRepository`
 *   2. Is anyone likely to want it?            → `measureDemand`
 *   3. What is a fair market value today, and
 *      what could it be worth finished?        → `valueRepositoryBusiness`
 *
 * Everything here is deterministic and pure. That matters: a valuation that
 * moves because a model's mood moved is not a valuation. Model output is an
 * *input* (measured completion/readiness/market scores), never the arithmetic.
 *
 * Unknown evidence is treated as unknown. A dimension with no evidence is
 * reported as `missing`, drags confidence down, and caps the overall grade —
 * it is never silently scored as if it were fine.
 */

export const REPO_BUSINESS_METHODOLOGY_VERSION = "repo-business-v1";

/** Blended senior engineering rate used for replacement-cost math. */
export const REPLACEMENT_HOURLY_RATE_USD = 95;

export type DimensionConfidence = "measured" | "derived" | "missing";

export interface DimensionScore {
  key: string;
  label: string;
  /** 0–100. */
  score: number;
  /** Relative weight in the overall grade. */
  weight: number;
  confidence: DimensionConfidence;
  note: string;
}

export type RepoStage =
  | "concept"
  | "scaffold"
  | "functional-mvp"
  | "beta"
  | "launch-ready"
  | "production";

export type GradeLetter =
  | "A+"
  | "A"
  | "A-"
  | "B+"
  | "B"
  | "B-"
  | "C+"
  | "C"
  | "C-"
  | "D"
  | "F";

export interface RepoGrade {
  /** 0–100 weighted score after the evidence ceiling is applied. */
  overall: number;
  /** 0–100 before the evidence ceiling. */
  rawOverall: number;
  /** Highest score the available evidence can support. */
  evidenceCeiling: number;
  letter: GradeLetter;
  stage: RepoStage;
  stageLabel: string;
  dimensions: DimensionScore[];
  blockers: string[];
  confidence: DimensionConfidence;
}

export type DemandBand = "proven" | "emerging" | "speculative" | "unproven";

export interface DemandDriver {
  label: string;
  score: number;
  weight: number;
  note: string;
}

export interface RepoDemand {
  /** 0–100 composite demand index. */
  index: number;
  band: DemandBand;
  bandLabel: string;
  drivers: DemandDriver[];
  evidenceGaps: string[];
  confidence: DimensionConfidence;
  summary: string;
}

export interface ValuationScenario {
  name: "conservative" | "base" | "upside";
  probability: number;
  low: number;
  high: number;
  assumptions: string[];
}

export interface RepoValuation {
  currency: "USD";
  presentValue: { low: number; base: number; high: number };
  potentialValue: { low: number; base: number; high: number };
  /** Potential minus present, i.e. the value unlocked by finishing. */
  valueGap: number;
  valuePerRemainingHour: number | null;
  remainingHours: number | null;
  replacementCost: number;
  confidence: "low" | "medium" | "high";
  confidenceScore: number;
  method: string;
  scenarios: ValuationScenario[];
  assumptions: string[];
  drivers: string[];
}

export interface RepoSignalInput {
  repo: string;
  description?: string | null;
  language?: string | null;
  topics?: string[] | null;
  homepage?: string | null;
  stars?: number | null;
  forks?: number | null;
  openIssues?: number | null;
  watchers?: number | null;
  sizeKb?: number | null;
  pushedAt?: string | null;
  createdAt?: string | null;
  archived?: boolean | null;
  isFork?: boolean | null;
  private?: boolean | null;
  fileCount?: number | null;
  contributors?: number | null;
  commitCount90d?: number | null;

  hasReadme?: boolean | null;
  hasTests?: boolean | null;
  hasCi?: boolean | null;
  hasDocker?: boolean | null;
  hasDeployConfig?: boolean | null;
  hasEnvExample?: boolean | null;
  hasLicense?: boolean | null;
  hasDocs?: boolean | null;
  hasContributing?: boolean | null;
  hasDatabaseMigrations?: boolean | null;
  hasAuthSignals?: boolean | null;
  hasPaymentsSignals?: boolean | null;
  hasFrontendSignals?: boolean | null;
  hasBackendSignals?: boolean | null;
  hasObservabilitySignals?: boolean | null;

  completionPct?: number | null;
  productionReadinessPct?: number | null;
  marketNeed?: number | null;
  demand?: number | null;
  competitivePressure?: number | null;
  uniquenessPct?: number | null;
  commercializationProbability?: number | null;
  evidenceConfidence?: number | null;
  remainingHours?: number | null;
  presentValueUsd?: { low: number; high: number } | null;
  potentialValueUsd?: { low: number; high: number } | null;

  suggestions?: Array<{ title?: string | null; action?: string | null; why?: string | null; effort?: number | null }>;
  nextSteps?: string[] | null;
}

const DIMENSION_WEIGHTS = {
  completeness: 0.18,
  readiness: 0.16,
  quality: 0.12,
  security: 0.1,
  deployability: 0.1,
  documentation: 0.06,
  market: 0.1,
  differentiation: 0.06,
  monetization: 0.06,
  traction: 0.06,
} as const;

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function daysSince(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, (Date.now() - parsed) / 86_400_000);
}

/**
 * Weighted sum of *known* dimensions only. Treating unknown as zero would
 * punish a repository for a missing measurement instead of reporting that the
 * measurement is missing, so the weights are renormalized over what we know.
 */
function weightedKnownScore(dimensions: DimensionScore[]): number {
  let total = 0;
  let weight = 0;
  for (const dimension of dimensions) {
    if (dimension.confidence === "missing") continue;
    total += dimension.score * dimension.weight;
    weight += dimension.weight;
  }
  return weight === 0 ? 0 : total / weight;
}

/** Structural completion, used only when no measured completion exists. */
export function deriveCompletionScore(input: RepoSignalInput): { score: number; confidence: DimensionConfidence } {
  const measured = finite(input.completionPct);
  if (measured !== null) return { score: clamp(measured), confidence: "measured" };

  const signals = [
    bool(input.hasReadme),
    bool(input.hasTests),
    bool(input.hasCi),
    bool(input.hasDocker) ?? bool(input.hasDeployConfig),
    bool(input.hasAuthSignals),
    bool(input.hasPaymentsSignals),
    bool(input.hasFrontendSignals),
    bool(input.hasBackendSignals),
    bool(input.hasDatabaseMigrations),
    bool(input.hasDocs),
  ];
  const known = signals.filter((value) => value !== null) as boolean[];
  if (known.length === 0) return { score: 0, confidence: "missing" };

  const present = known.filter(Boolean).length;
  const fileCount = finite(input.fileCount) ?? 0;
  const depthBonus = Math.min(12, fileCount > 0 ? Math.log10(fileCount + 1) * 6 : 0);
  const score = clamp(8 + (present / known.length) * 70 + depthBonus);
  return { score, confidence: "derived" };
}

export function deriveReadinessScore(input: RepoSignalInput): { score: number; confidence: DimensionConfidence } {
  const measured = finite(input.productionReadinessPct);
  if (measured !== null) return { score: clamp(measured), confidence: "measured" };

  const parts: Array<[boolean | null, number]> = [
    [bool(input.hasCi), 22],
    [bool(input.hasTests), 20],
    [bool(input.hasDocker), 14],
    [bool(input.hasDeployConfig), 14],
    [bool(input.hasEnvExample), 10],
    [bool(input.hasDatabaseMigrations), 8],
    [bool(input.hasObservabilitySignals), 7],
    [bool(input.hasLicense), 5],
  ];
  const known = parts.filter(([value]) => value !== null);
  if (known.length === 0) return { score: 0, confidence: "missing" };

  const availableWeight = known.reduce((sum, [, weight]) => sum + weight, 0);
  const earned = known.reduce((sum, [value, weight]) => sum + (value ? weight : 0), 0);
  return { score: clamp((earned / availableWeight) * 100), confidence: "derived" };
}

function activityScore(pushedAt: string | null | undefined): number {
  const days = daysSince(pushedAt);
  if (days === null) return 50;
  if (days <= 7) return 100;
  if (days <= 30) return 90;
  if (days <= 90) return 76;
  if (days <= 180) return 60;
  if (days <= 365) return 42;
  if (days <= 730) return 24;
  return 10;
}

function tractionScore(input: RepoSignalInput): { score: number; confidence: DimensionConfidence } {
  const stars = finite(input.stars);
  const forks = finite(input.forks);
  const watchers = finite(input.watchers);
  if (stars === null && forks === null && watchers === null) {
    return { score: 0, confidence: "missing" };
  }
  const starScore = Math.min(70, Math.log10((stars ?? 0) + 1) * 22);
  const forkScore = Math.min(20, Math.log10((forks ?? 0) + 1) * 12);
  const watchScore = Math.min(10, Math.log10((watchers ?? 0) + 1) * 6);
  return { score: clamp(starScore + forkScore + watchScore), confidence: "measured" };
}

export function gradeRepository(input: RepoSignalInput): RepoGrade {
  const completion = deriveCompletionScore(input);
  const readiness = deriveReadinessScore(input);
  const traction = tractionScore(input);

  const qualityParts: Array<[boolean | null, number]> = [
    [bool(input.hasTests), 28],
    [bool(input.hasCi), 18],
    [bool(input.hasDocs), 10],
    [bool(input.hasContributing), 5],
    [bool(input.hasLicense), 5],
    [bool(input.hasReadme), 8],
  ];
  const qualityKnown = qualityParts.filter(([value]) => value !== null);
  const qualityEarned = qualityKnown.reduce((sum, [value, weight]) => sum + (value ? weight : 0), 0);
  const qualityWeight = qualityKnown.reduce((sum, [, weight]) => sum + weight, 0);
  const fileCount = finite(input.fileCount);
  const qualityStructure = fileCount === null ? 0 : Math.min(12, Math.log10(fileCount + 1) * 5);
  const qualityScore =
    qualityKnown.length === 0 ? 0 : clamp((qualityEarned / qualityWeight) * 88 + qualityStructure + activityScore(input.pushedAt) * 0.04);

  const openIssues = finite(input.openIssues) ?? 0;
  const stars = finite(input.stars) ?? 0;
  const issuePressure = stars > 0 ? Math.min(30, (openIssues / Math.max(1, stars)) * 30) : Math.min(20, openIssues * 1.5);
  const securityParts: Array<[boolean | null, number]> = [
    [bool(input.hasAuthSignals), 22],
    [bool(input.hasEnvExample), 22],
    [bool(input.hasTests), 12],
    [bool(input.hasCi), 14],
    [bool(input.hasLicense), 8],
  ];
  const securityKnown = securityParts.filter(([value]) => value !== null);
  const securityEarned = securityKnown.reduce((sum, [value, weight]) => sum + (value ? weight : 0), 0);
  const securityWeight = securityKnown.reduce((sum, [, weight]) => sum + weight, 0);
  const securityScore =
    securityKnown.length === 0 ? 0 : clamp((securityEarned / securityWeight) * 78 + (30 - issuePressure));

  const deployParts: Array<[boolean | null, number]> = [
    [bool(input.hasDocker), 28],
    [bool(input.hasDeployConfig), 26],
    [bool(input.hasCi), 20],
    [bool(input.hasEnvExample), 14],
    [bool(input.hasReadme), 12],
  ];
  const deployKnown = deployParts.filter(([value]) => value !== null);
  const deployEarned = deployKnown.reduce((sum, [value, weight]) => sum + (value ? weight : 0), 0);
  const deployWeight = deployKnown.reduce((sum, [, weight]) => sum + weight, 0);
  const deployabilityScore = deployKnown.length === 0 ? 0 : clamp((deployEarned / deployWeight) * 100);

  const docsParts: Array<[boolean | null, number]> = [
    [bool(input.hasReadme), 42],
    [bool(input.hasDocs), 24],
    [bool(input.hasContributing), 14],
    [bool(input.hasEnvExample), 10],
    [bool(input.hasLicense), 10],
  ];
  const docsKnown = docsParts.filter(([value]) => value !== null);
  const docsEarned = docsKnown.reduce((sum, [value, weight]) => sum + (value ? weight : 0), 0);
  const docsWeight = docsKnown.reduce((sum, [, weight]) => sum + weight, 0);
  const documentationScore = docsKnown.length === 0 ? 0 : clamp((docsEarned / docsWeight) * 100);

  const measuredMarket = finite(input.marketNeed);
  const hasMarketSignal =
    measuredMarket !== null ||
    bool(input.hasFrontendSignals) === true ||
    bool(input.hasBackendSignals) === true ||
    Boolean(input.description?.trim());
  const marketScore = measuredMarket !== null ? clamp(measuredMarket) : clamp(40 + (bool(input.hasBackendSignals) ? 6 : 0) + (bool(input.hasFrontendSignals) ? 6 : 0));

  const uniqueness = finite(input.uniquenessPct);
  const competition = finite(input.competitivePressure);
  const differentiationScore =
    uniqueness !== null ? clamp(uniqueness) : competition !== null ? clamp(100 - competition) : clamp(50);

  const monetizationParts: Array<[boolean | null, number]> = [
    [bool(input.hasPaymentsSignals), 42],
    [bool(input.hasAuthSignals), 22],
    [bool(input.hasFrontendSignals), 14],
    [bool(input.hasBackendSignals), 12],
  ];
  const monetizationKnown = monetizationParts.filter(([value]) => value !== null);
  const monetizationEarned = monetizationKnown.reduce((sum, [value, weight]) => sum + (value ? weight : 0), 0);
  const monetizationWeight = monetizationKnown.reduce((sum, [, weight]) => sum + weight, 0);
  const commercialization = finite(input.commercializationProbability);
  const monetizationScore =
    monetizationKnown.length === 0 && commercialization === null
      ? 0
      : clamp(
          (monetizationWeight > 0 ? (monetizationEarned / monetizationWeight) * 70 : 0) +
            (commercialization !== null ? commercialization * 0.3 : 0),
        );

  const dimensions: DimensionScore[] = [
    {
      key: "completeness",
      label: "Completeness",
      score: round(completion.score, 1),
      weight: DIMENSION_WEIGHTS.completeness,
      confidence: completion.confidence,
      note:
        completion.confidence === "measured"
          ? "Measured by the latest portfolio analysis."
          : "Derived from structural evidence (tests, CI, deploy, auth, payments, source depth).",
    },
    {
      key: "readiness",
      label: "Production readiness",
      score: round(readiness.score, 1),
      weight: DIMENSION_WEIGHTS.readiness,
      confidence: readiness.confidence,
      note:
        readiness.confidence === "measured"
          ? "Measured by the latest portfolio analysis."
          : "Derived from CI, tests, container/deploy config, env template, migrations, and observability signals.",
    },
    {
      key: "quality",
      label: "Engineering quality",
      score: round(qualityScore, 1),
      weight: DIMENSION_WEIGHTS.quality,
      confidence: qualityKnown.length > 0 ? "derived" : "missing",
      note: "Tests, CI, docs, contributor guidance, license, source depth, and recent activity.",
    },
    {
      key: "security",
      label: "Security posture",
      score: round(securityScore, 1),
      weight: DIMENSION_WEIGHTS.security,
      confidence: securityKnown.length > 0 ? "derived" : "missing",
      note: "Auth boundaries, env template hygiene, tests, CI, license, and open-issue pressure.",
    },
    {
      key: "deployability",
      label: "Deployability",
      score: round(deployabilityScore, 1),
      weight: DIMENSION_WEIGHTS.deployability,
      confidence: deployKnown.length > 0 ? "derived" : "missing",
      note: "Container/deploy config, CI, env template, and operator docs.",
    },
    {
      key: "documentation",
      label: "Documentation",
      score: round(documentationScore, 1),
      weight: DIMENSION_WEIGHTS.documentation,
      confidence: docsKnown.length > 0 ? "derived" : "missing",
      note: "README, docs directory, contribution guide, env template, and license.",
    },
    {
      key: "market",
      label: "Market need",
      score: round(marketScore, 1),
      weight: DIMENSION_WEIGHTS.market,
      confidence: measuredMarket !== null ? "measured" : hasMarketSignal ? "derived" : "missing",
      note: measuredMarket !== null ? "Measured by the latest portfolio analysis." : "Weak structural inference; run a portfolio scan for a measured market need.",
    },
    {
      key: "differentiation",
      label: "Differentiation",
      score: round(differentiationScore, 1),
      weight: DIMENSION_WEIGHTS.differentiation,
      confidence: uniqueness !== null || competition !== null ? "measured" : "missing",
      note: "Uniqueness against the rest of the portfolio and the competitive pressure estimate.",
    },
    {
      key: "monetization",
      label: "Monetization readiness",
      score: round(monetizationScore, 1),
      weight: DIMENSION_WEIGHTS.monetization,
      confidence: monetizationKnown.length > 0 || commercialization !== null ? "derived" : "missing",
      note: "Payment/billing signals, auth, a usable surface, and commercialization probability.",
    },
    {
      key: "traction",
      label: "Traction",
      score: round(traction.score, 1),
      weight: DIMENSION_WEIGHTS.traction,
      confidence: traction.confidence,
      note: "Stars, forks, watchers, and recency of pushes.",
    },
  ];

  const rawOverall = weightedKnownScore(dimensions);

  // The evidence ceiling is deliberately blunt: a repository with no tests and
  // no CI cannot be graded as production-ready no matter how nice the code is.
  const ceilingReasons: string[] = [];
  let evidenceCeiling = 100;
  if (bool(input.hasTests) === false) {
    evidenceCeiling = Math.min(evidenceCeiling, 64);
    ceilingReasons.push("no automated tests");
  }
  if (bool(input.hasCi) === false) {
    evidenceCeiling = Math.min(evidenceCeiling, 72);
    ceilingReasons.push("no CI workflow");
  }
  if (bool(input.hasReadme) === false) {
    evidenceCeiling = Math.min(evidenceCeiling, 78);
    ceilingReasons.push("no README");
  }
  if (bool(input.archived)) {
    evidenceCeiling = Math.min(evidenceCeiling, 40);
    ceilingReasons.push("repository is archived");
  }

  const overall = round(Math.min(rawOverall, evidenceCeiling), 1);
  const blockers: string[] = [];
  for (const dimension of dimensions) {
    if (dimension.confidence !== "missing" && dimension.score < 45) {
      blockers.push(`${dimension.label} is ${Math.round(dimension.score)}/100`);
    }
  }
  for (const reason of ceilingReasons) blockers.push(reason);

  const knownCount = dimensions.filter((dimension) => dimension.confidence !== "missing").length;
  const confidence: DimensionConfidence =
    knownCount >= 8 ? "measured" : knownCount >= 4 ? "derived" : "missing";

  return {
    overall,
    rawOverall: round(rawOverall, 1),
    evidenceCeiling,
    letter: gradeLetter(overall),
    stage: stageFor(overall),
    stageLabel: STAGE_LABELS[stageFor(overall)],
    dimensions,
    blockers: [...new Set(blockers)].slice(0, 12),
    confidence,
  };
}

export const STAGE_LABELS: Record<RepoStage, string> = {
  concept: "Concept",
  scaffold: "Scaffold",
  "functional-mvp": "Functional MVP",
  beta: "Beta",
  "launch-ready": "Launch-ready",
  production: "Production",
};

export function stageFor(overall: number): RepoStage {
  if (overall >= 88) return "production";
  if (overall >= 75) return "launch-ready";
  if (overall >= 60) return "beta";
  if (overall >= 40) return "functional-mvp";
  if (overall >= 20) return "scaffold";
  return "concept";
}

export function gradeLetter(overall: number): GradeLetter {
  if (overall >= 95) return "A+";
  if (overall >= 90) return "A";
  if (overall >= 85) return "A-";
  if (overall >= 80) return "B+";
  if (overall >= 74) return "B";
  if (overall >= 68) return "B-";
  if (overall >= 62) return "C+";
  if (overall >= 55) return "C";
  if (overall >= 48) return "C-";
  if (overall >= 40) return "D";
  return "F";
}

export function measureDemand(input: RepoSignalInput): RepoDemand {
  const marketNeed = finite(input.marketNeed);
  const demand = finite(input.demand);
  const competition = finite(input.competitivePressure);
  const uniqueness = finite(input.uniquenessPct);
  const traction = tractionScore(input);
  const stars = finite(input.stars) ?? 0;

  // Absent evidence is not average demand. Defaults are deliberately below the
  // "speculative" threshold so an unmeasured repository reads as unproven until
  // a portfolio scan produces real market and demand signals.
  const marketScore = marketNeed !== null ? clamp(marketNeed) : clamp(25);
  const demandScore = demand !== null ? clamp(demand) : clamp(25);
  const competitionScore = competition !== null ? clamp(100 - competition) : clamp(50);
  const uniquenessScore = uniqueness !== null ? clamp(uniqueness) : clamp(40);
  const tractionValue = traction.confidence === "missing" ? 15 : traction.score;

  const drivers: DemandDriver[] = [
    {
      label: "Market need",
      score: round(marketScore, 1),
      weight: 0.28,
      note: marketNeed !== null ? "Measured market need from the latest analysis." : "No measured market need; conservative placeholder until a portfolio scan runs.",
    },
    {
      label: "Observed demand",
      score: round(demandScore, 1),
      weight: 0.24,
      note: demand !== null ? "Measured demand signal from the latest analysis." : "No measured demand signal yet.",
    },
    {
      label: "Traction",
      score: round(tractionValue, 1),
      weight: 0.18,
      note: traction.confidence === "missing" ? "No stars/forks/watchers available." : `${stars} stars, ${finite(input.forks) ?? 0} forks, ${finite(input.watchers) ?? 0} watchers.`,
    },
    {
      label: "Differentiation",
      score: round(uniquenessScore, 1),
      weight: 0.16,
      note: uniqueness !== null ? "Uniqueness against the analyzed portfolio." : "No uniqueness measurement available.",
    },
    {
      label: "Competitive room",
      score: round(competitionScore, 1),
      weight: 0.14,
      note: competition !== null ? `Competitive pressure estimated at ${Math.round(competition)}/100.` : "No competitive-pressure estimate available.",
    },
  ];

  const index = round(
    drivers.reduce((sum, driver) => sum + driver.score * driver.weight, 0),
    1,
  );

  const evidenceGaps: string[] = [];
  if (marketNeed === null) evidenceGaps.push("No measured market need");
  if (demand === null) evidenceGaps.push("No measured demand signal");
  if (competition === null) evidenceGaps.push("No competitive-pressure estimate");
  if (uniqueness === null) evidenceGaps.push("No uniqueness measurement");
  if (traction.confidence === "missing") evidenceGaps.push("No repository traction data");
  if (!input.description?.trim()) evidenceGaps.push("No repository description to position the product");
  if (!input.topics?.length) evidenceGaps.push("No topics/tags describing the product");
  if (bool(input.hasPaymentsSignals) === false) evidenceGaps.push("No pricing or billing surface to test willingness to pay");
  if (bool(input.hasDocs) === false) evidenceGaps.push("No product docs or user-facing explanation");

  const band = demandBand(index);
  return {
    index,
    band,
    bandLabel: DEMAND_BAND_LABELS[band],
    drivers,
    evidenceGaps: evidenceGaps.slice(0, 8),
    confidence: evidenceGaps.length <= 2 ? "measured" : evidenceGaps.length <= 5 ? "derived" : "missing",
    summary: demandSummary(band, index, marketNeed, traction.confidence !== "missing"),
  };
}

export const DEMAND_BAND_LABELS: Record<DemandBand, string> = {
  proven: "Proven demand",
  emerging: "Emerging demand",
  speculative: "Speculative demand",
  unproven: "Unproven demand",
};

export function demandBand(index: number): DemandBand {
  if (index >= 75) return "proven";
  if (index >= 58) return "emerging";
  if (index >= 38) return "speculative";
  return "unproven";
}

function demandSummary(band: DemandBand, index: number, marketNeed: number | null, hasTraction: boolean): string {
  switch (band) {
    case "proven":
      return `Demand index ${index}/100. There is measurable appetite${marketNeed !== null ? ` (market need ${Math.round(marketNeed)}/100)` : ""} and the repository has visible traction. Finishing it is a distribution problem, not a validation problem.`;
    case "emerging":
      return `Demand index ${index}/100. Signals point to a real audience, but willingness to pay is not yet proven. Finish the core journey and put a pricing surface in front of real users before investing further.`;
    case "speculative":
      return `Demand index ${index}/100. The product idea may be sound, but current evidence does not support a market claim. Treat any value here as scenario value, not fair market value.`;
    default:
      return `Demand index ${index}/100. No credible demand evidence${hasTraction ? "" : " and no visible traction"}. The honest next step is a narrow validation test, not more building.`;
  }
}

export function valueRepositoryBusiness(
  input: RepoSignalInput,
  grade: RepoGrade,
  demand: RepoDemand,
): RepoValuation {
  const completion = deriveCompletionScore(input);
  const readiness = deriveReadinessScore(input);
  const remainingHours = finite(input.remainingHours);

  const completionFraction = clamp(completion.score) / 100;
  const readinessFraction = clamp(readiness.score) / 100;
  const qualityDimension = grade.dimensions.find((dimension) => dimension.key === "quality");
  const qualityFraction = qualityDimension && qualityDimension.confidence !== "missing" ? qualityDimension.score / 100 : 0.5;
  const monetizationDimension = grade.dimensions.find((dimension) => dimension.key === "monetization");
  const monetizationFraction =
    monetizationDimension && monetizationDimension.confidence !== "missing" ? monetizationDimension.score / 100 : 0.35;

  const fileCount = finite(input.fileCount);
  const inferredTotalHours =
    40 +
    Math.min(600, (fileCount ?? 0) * 0.35) +
    (bool(input.hasFrontendSignals) ? 70 : 0) +
    (bool(input.hasBackendSignals) ? 80 : 0) +
    (bool(input.hasDatabaseMigrations) ? 30 : 0) +
    (bool(input.hasAuthSignals) ? 30 : 0) +
    (bool(input.hasPaymentsSignals) ? 40 : 0) +
    (bool(input.hasTests) ? 25 : 0);

  const totalHours =
    remainingHours !== null && completionFraction < 0.98
      ? Math.max(remainingHours, remainingHours / Math.max(0.1, 1 - completionFraction))
      : Math.max(40, inferredTotalHours);

  const replacementCost = round(totalHours * REPLACEMENT_HOURLY_RATE_USD);

  // Present value: replacement cost discounted by how much of the product
  // actually exists, how solid it is, and whether anyone wants it.
  const presentBase = round(
    replacementCost * completionFraction * (0.55 + 0.45 * qualityFraction) * (0.6 + 0.6 * (demand.index / 100)),
  );

  // Potential value: the finished product, priced off the same replacement cost
  // but with demand and monetization carrying the multiple.
  const potentialBase = round(
    replacementCost *
      (0.85 + 0.55 * (demand.index / 100)) *
      (0.75 + 0.35 * monetizationFraction) *
      (0.85 + 0.3 * readinessFraction),
  );

  const storedPresent = normalizeRange(input.presentValueUsd);
  const storedPotential = normalizeRange(input.potentialValueUsd);

  const presentRange = storedPresent
    ? {
        low: round(storedPresent.low),
        base: round((storedPresent.low + storedPresent.high) / 2),
        high: round(storedPresent.high),
      }
    : {
        low: round(presentBase * 0.72),
        base: presentBase,
        high: round(presentBase * 1.32),
      };

  const modelledPotential = {
    low: round(Math.max(potentialBase * 0.7, presentRange.low)),
    base: Math.max(potentialBase, presentRange.base),
    high: round(Math.max(potentialBase * 1.45, presentRange.high)),
  };
  const potentialRange = storedPotential
    ? {
        low: round(Math.max(storedPotential.low, presentRange.low)),
        base: round((storedPotential.low + storedPotential.high) / 2),
        high: round(Math.max(storedPotential.high, presentRange.high)),
      }
    : modelledPotential;

  const valueGap = round(Math.max(0, potentialRange.base - presentRange.base));
  const valuePerRemainingHour = remainingHours && remainingHours > 0 ? round(valueGap / remainingHours) : null;

  const evidenceConfidence = finite(input.evidenceConfidence);
  // Confidence follows *measured* evidence, not the number of dimensions we
  // were able to infer. A repository whose entire grade is inferred from
  // missing files is not a high-confidence valuation.
  const measuredDimensions = grade.dimensions.filter((dimension) => dimension.confidence === "measured").length;
  const confidenceScore = round(
    clamp(
      evidenceConfidence ??
        measuredDimensions * 14 + (demand.confidence === "measured" ? 20 : demand.confidence === "derived" ? 8 : 0),
    ),
    1,
  );
  const confidence = confidenceScore >= 68 ? "high" : confidenceScore >= 40 ? "medium" : "low";

  const scenarios: ValuationScenario[] = [
    {
      name: "conservative",
      probability: 0.5,
      low: round(presentRange.low * 0.9),
      high: round(presentRange.base * 1.05),
      assumptions: [
        "Sold or operated as-is, with the current completion and readiness level.",
        "No new demand evidence appears.",
      ],
    },
    {
      name: "base",
      probability: 0.32,
      low: round(potentialRange.low * 0.8),
      high: round(potentialRange.base),
      assumptions: [
        "The ordered finish plan is executed and verified.",
        "Demand index stays at its current level.",
      ],
    },
    {
      name: "upside",
      probability: 0.18,
      low: round(potentialRange.base),
      high: round(potentialRange.high),
      assumptions: [
        "Finishing is followed by a working distribution channel and a paid surface.",
        "Demand index improves by 15+ points with real usage evidence.",
      ],
    },
  ];

  const drivers = [
    `Completion ${Math.round(completion.score)}% and readiness ${Math.round(readiness.score)}% set the present-value discount.`,
    `Demand index ${demand.index}/100 (${demand.bandLabel.toLowerCase()}) drives the potential multiple.`,
    `Replacement cost assumes ${Math.round(totalHours)} engineering hours at $${REPLACEMENT_HOURLY_RATE_USD}/hour.`,
    `Monetization readiness contributes ${Math.round(monetizationFraction * 100)}% of the upside multiplier.`,
  ];

  return {
    currency: "USD",
    presentValue: presentRange,
    potentialValue: potentialRange,
    valueGap,
    valuePerRemainingHour,
    remainingHours: remainingHours !== null ? round(remainingHours, 1) : null,
    replacementCost,
    confidence,
    confidenceScore,
    method: storedPresent
      ? "Measured analysis value, blended with the replacement-cost/demand model."
      : "Replacement cost × completion × quality × demand, with an explicit potential scenario.",
    scenarios,
    assumptions: [
      `Blended senior engineering rate $${REPLACEMENT_HOURLY_RATE_USD}/hour.`,
      "Present value is what the repository is worth in its current state, not what it could become.",
      "Potential value is a labeled scenario, never a promise or a revenue forecast.",
      "No invented TAM, comparables, or customer counts are used.",
    ],
    drivers,
  };
}

function normalizeRange(value: { low?: number; high?: number } | null | undefined): { low: number; high: number } | null {
  if (!value) return null;
  const low = finite(value.low);
  const high = finite(value.high);
  if (low === null || high === null) return null;
  return { low: Math.min(low, high), high: Math.max(low, high) };
}

export interface FinalityGap {
  key: string;
  label: string;
  score: number;
  target: number;
  delta: number;
  note: string;
}

export interface RepoFinality {
  /** 0–100: how close the repository is to genuinely finished. */
  score: number;
  isFinished: boolean;
  gaps: FinalityGap[];
  blockers: string[];
  nextBestAction: string;
}

/**
 * "Finality" is not the same as completion. A repository can be 100% coded and
 * still not finished: no tests, no deploy, no docs, no operator path. This
 * score answers the question a buyer or a builder agent actually asks — what
 * still stands between this and done?
 */
export function measureFinality(input: RepoSignalInput, grade: RepoGrade): RepoFinality {
  const targets: Record<string, number> = {
    completeness: 90,
    readiness: 88,
    quality: 82,
    security: 80,
    deployability: 85,
    documentation: 80,
    monetization: 65,
  };

  const gaps: FinalityGap[] = [];
  for (const [key, target] of Object.entries(targets)) {
    const dimension = grade.dimensions.find((entry) => entry.key === key);
    if (!dimension || dimension.confidence === "missing") {
      gaps.push({
        key,
        label: dimension?.label ?? key,
        score: 0,
        target,
        delta: target,
        note: "No evidence yet — this dimension is unmeasured, not passing.",
      });
      continue;
    }
    if (dimension.score < target) {
      gaps.push({
        key,
        label: dimension.label,
        score: round(dimension.score, 1),
        target,
        delta: round(target - dimension.score, 1),
        note: dimension.note,
      });
    }
  }
  gaps.sort((a, b) => b.delta - a.delta);

  const criticalKeys = new Set(["completeness", "readiness", "quality", "deployability"]);
  const criticalGaps = gaps.filter((gap) => criticalKeys.has(gap.key));
  const score = round(
    clamp(
      grade.overall * 0.55 +
        (gaps.length === 0 ? 45 : Math.max(0, 45 - gaps.reduce((sum, gap) => sum + gap.delta, 0) * 0.55)),
    ),
    1,
  );

  const blockers = grade.blockers.slice(0, 8);
  const isFinished = score >= 88 && criticalGaps.length === 0 && blockers.length === 0;

  return {
    score,
    isFinished,
    gaps: gaps.slice(0, 8),
    blockers,
    nextBestAction: gaps[0]
      ? `Close the ${gaps[0].label.toLowerCase()} gap (${Math.round(gaps[0].score)} → ${gaps[0].target}).`
      : "No material finality gap remains; verify with a fresh run and ship.",
  };
}

export interface RepoBusinessReport {
  repo: string;
  methodologyVersion: string;
  generatedAt: string;
  grade: RepoGrade;
  demand: RepoDemand;
  valuation: RepoValuation;
  finality: RepoFinality;
  signals: {
    completionPct: number;
    productionReadinessPct: number;
    language: string | null;
    stars: number | null;
    pushedAt: string | null;
    archived: boolean;
    measuredCompletion: boolean;
    measuredReadiness: boolean;
  };
}

export function buildRepoBusinessReport(input: RepoSignalInput): RepoBusinessReport {
  const grade = gradeRepository(input);
  const demand = measureDemand(input);
  const valuation = valueRepositoryBusiness(input, grade, demand);
  const finality = measureFinality(input, grade);
  const completion = deriveCompletionScore(input);
  const readiness = deriveReadinessScore(input);

  return {
    repo: input.repo,
    methodologyVersion: REPO_BUSINESS_METHODOLOGY_VERSION,
    generatedAt: new Date().toISOString(),
    grade,
    demand,
    valuation,
    finality,
    signals: {
      completionPct: round(completion.score, 1),
      productionReadinessPct: round(readiness.score, 1),
      language: input.language ?? null,
      stars: finite(input.stars),
      pushedAt: input.pushedAt ?? null,
      archived: bool(input.archived) ?? false,
      measuredCompletion: completion.confidence === "measured",
      measuredReadiness: readiness.confidence === "measured",
    },
  };
}

const TREE_PATTERNS = {
  readme: /(^|\/)readme(\.[^/]+)?$/i,
  tests: /(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\.[a-z0-9]+$/i,
  ci: /(^|\/)\.github\/workflows\/.+\.ya?ml$|(^|\/)gitlab-ci\.yml$|(^|\/)\.circleci\/config\.yml$/i,
  docker: /(^|\/)(dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/i,
  deploy: /(^|\/)(vercel\.json|netlify\.toml|render\.ya?ml|fly\.toml|railway\.json|firebase\.json|cloudbuild\.ya?ml|k8s\/|helm\/)/i,
  envExample: /(^|\/)\.env\.(example|sample|template)$/i,
  license: /(^|\/)license(\.[^/]+)?$/i,
  docs: /(^|\/)(docs|documentation)\//i,
  contributing: /(^|\/)contributing(\.[^/]+)?$/i,
  migrations: /(^|\/)(migrations|prisma\/migrations|drizzle)\//i,
  auth: /(^|\/)(auth|authentication|authorization|middleware\/auth|supabase\/auth)[^/]*\.[a-z]+$|(^|\/)middlewares?\/auth/i,
  payments: /(stripe|billing|checkout|subscription|pricing|payments?)/i,
  frontend: /(^|\/)(src\/)?(pages|components|app|views)\/.+\.(tsx|jsx|vue|svelte)$|(^|\/)index\.html$/i,
  backend: /(^|\/)(server|api|routes|controllers|handlers)\/.+\.(ts|js|py|go|rs)$/i,
  observability: /(sentry|opentelemetry|otel|datadog|newrelic|prometheus|metrics)\.[a-z]+$|(^|\/)(observability|telemetry|instrument)[^/]*\.[a-z]+$/i,
} as const;

export type RepoTreeSignals = {
  hasReadme: boolean;
  hasTests: boolean;
  hasCi: boolean;
  hasDocker: boolean;
  hasDeployConfig: boolean;
  hasEnvExample: boolean;
  hasLicense: boolean;
  hasDocs: boolean;
  hasContributing: boolean;
  hasDatabaseMigrations: boolean;
  hasAuthSignals: boolean;
  hasPaymentsSignals: boolean;
  hasFrontendSignals: boolean;
  hasBackendSignals: boolean;
  hasObservabilitySignals: boolean;
  fileCount: number;
};

/**
 * Derive structural signals from a repository tree. Pure and exported so the
 * detail route and tests share exactly one interpretation of "has tests".
 */
export function signalsFromPaths(paths: string[]): RepoTreeSignals {
  const files = paths.filter((path) => path && !path.endsWith("/"));
  const has = (pattern: RegExp) => files.some((path) => pattern.test(path));
  return {
    hasReadme: has(TREE_PATTERNS.readme),
    hasTests: has(TREE_PATTERNS.tests),
    hasCi: has(TREE_PATTERNS.ci),
    hasDocker: has(TREE_PATTERNS.docker),
    hasDeployConfig: has(TREE_PATTERNS.deploy),
    hasEnvExample: has(TREE_PATTERNS.envExample),
    hasLicense: has(TREE_PATTERNS.license),
    hasDocs: has(TREE_PATTERNS.docs),
    hasContributing: has(TREE_PATTERNS.contributing),
    hasDatabaseMigrations: has(TREE_PATTERNS.migrations),
    hasAuthSignals: has(TREE_PATTERNS.auth),
    hasPaymentsSignals: has(TREE_PATTERNS.payments),
    hasFrontendSignals: has(TREE_PATTERNS.frontend),
    hasBackendSignals: has(TREE_PATTERNS.backend),
    hasObservabilitySignals: has(TREE_PATTERNS.observability),
    fileCount: files.length,
  };
}

/**
 * Weak signals inferred from repository metadata when no tree is available.
 * Every inferred field is marked by the engine as `derived`, never `measured`.
 */
export function inferSignalsFromMetadata(input: RepoSignalInput): Partial<RepoTreeSignals> {
  const text = [input.description, input.language, ...(input.topics ?? [])].filter(Boolean).join(" ").toLowerCase();
  const has = (pattern: RegExp) => pattern.test(text);
  return {
    hasFrontendSignals: has(/\b(react|next|vue|svelte|angular|frontend|ui|tailwind|vite)\b/) || undefined,
    hasBackendSignals: has(/\b(api|server|express|fastify|backend|node|python|django|flask|go|rust)\b/) || undefined,
    hasAuthSignals: has(/\b(auth|oauth|login|supabase|clerk|session)\b/) || undefined,
    hasPaymentsSignals: has(/\b(stripe|billing|checkout|subscription|payments?|pricing)\b/) || undefined,
    hasDatabaseMigrations: has(/\b(postgres|database|supabase|prisma|drizzle|migrations?|sql)\b/) || undefined,
    hasObservabilitySignals: has(/\b(sentry|observability|monitoring|telemetry|logging)\b/) || undefined,
    hasDeployConfig: has(/\b(vercel|netlify|docker|kubernetes|deploy|cloud)\b/) || undefined,
  };
}
