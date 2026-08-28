import type { IntelligenceEvidence } from "./investment-intelligence";
import type { MoneyRange } from "./valuation";

export interface PortfolioValuationRepoInput {
  repo: string;
  kind?: string | null;
  title?: string | null;
  description?: string | null;
  language?: string | null;
  topics?: string[];
  presentValueUsd: MoneyRange;
  potentialValueUsd: MoneyRange;
  completionPct: number;
  productionReadinessPct: number;
  commercializationProbability: number;
  evidenceConfidence: number;
  demandScore: number;
  marketNeedScore: number;
  stars: number;
  forks: number;
  subscribers?: number;
  openIssues?: number;
  activityScore: number;
  sourceFiles: number;
  sourceBytes: number;
  hasReadme: boolean;
  hasLicense: boolean;
  hasCi: boolean;
  hasTests: boolean;
  hasDeploy: boolean;
  hasHomepage: boolean;
  competitivePressureVerified?: number | null;
}

export interface PortfolioValuationRepoResult {
  repo: string;
  confidencePct: number;
  standalonePresentValueUsd: MoneyRange;
  confidenceAdjustedPresentValueUsd: MoneyRange;
  standalonePotentialValueUsd: MoneyRange;
  confidenceAdjustedPotentialValueUsd: MoneyRange;
  overlapDiscountUsd: MoneyRange;
  potentialOverlapDiscountUsd: MoneyRange;
  synergyContributionUsd: MoneyRange;
  potentialSynergyContributionUsd: MoneyRange;
  adjustedPresentValueUsd: MoneyRange;
  adjustedPotentialValueUsd: MoneyRange;
  replacementCostUsd: { low: number; base: number; high: number };
  monetizationReadinessScore: number;
  demandProxyScore: number;
  distributionAdvantageScore: number;
  recurringRevenuePotentialScore: number;
  competitiveSaturationScore: number | null;
  overlapSimilarityPct: number;
  overlapWithRepo: string | null;
  evidence: IntelligenceEvidence[];
}

export interface PortfolioValuationResult {
  methodologyVersion: "portfolio-valuation-v2-confidence-overlap";
  reposScored: number;
  averageConfidencePct: number;
  grossStandalonePresentValueUsd: MoneyRange;
  confidenceAdjustedBeforeOverlapUsd: MoneyRange;
  overlapDiscountUsd: MoneyRange;
  synergyUpliftUsd: MoneyRange;
  confidenceAdjustedPortfolioValueUsd: MoneyRange;
  grossStandalonePotentialValueUsd: MoneyRange;
  confidenceAdjustedPotentialBeforeOverlapUsd: MoneyRange;
  potentialOverlapDiscountUsd: MoneyRange;
  potentialSynergyUpliftUsd: MoneyRange;
  confidenceAdjustedPotentialValueUsd: MoneyRange;
  replacementCostUsd: { low: number; base: number; high: number };
  overlapPct: number;
  repos: PortfolioValuationRepoResult[];
  evidencePolicy: string;
}

const clamp = (value: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
const rounded = (value: number) => Math.round(Math.max(0, Number.isFinite(value) ? value : 0));
const range = (low: number, high: number): MoneyRange => ({ low: rounded(low), high: rounded(Math.max(low, high)) });
const sumRanges = (values: MoneyRange[]): MoneyRange => ({
  low: rounded(values.reduce((sum, value) => sum + Math.max(0, value.low), 0)),
  high: rounded(values.reduce((sum, value) => sum + Math.max(0, value.high), 0)),
});

function tokens(input: PortfolioValuationRepoInput): Set<string> {
  const text = [
    input.repo.split("/").at(-1),
    input.kind,
    input.title,
    input.description,
    input.language,
    ...(input.topics ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const ignored = new Set(["app", "application", "project", "repo", "repository", "the", "and", "for", "with"]);
  return new Set(
    text
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !ignored.has(token)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function structuralSimilarity(a: PortfolioValuationRepoInput, b: PortfolioValuationRepoInput): number {
  let score = jaccard(tokens(a), tokens(b)) * 0.72;
  if (a.language && b.language && a.language.toLowerCase() === b.language.toLowerCase()) score += 0.1;
  if (a.kind && b.kind && a.kind.toLowerCase() === b.kind.toLowerCase()) score += 0.08;
  const aTopics = new Set((a.topics ?? []).map((topic) => topic.toLowerCase()));
  const bTopics = new Set((b.topics ?? []).map((topic) => topic.toLowerCase()));
  if (aTopics.size > 0 && bTopics.size > 0) score += jaccard(aTopics, bTopics) * 0.1;
  return Math.max(0, Math.min(1, score));
}

function confidence(input: PortfolioValuationRepoInput): number {
  const hygiene = [input.hasReadme, input.hasLicense, input.hasCi, input.hasTests, input.hasDeploy, input.hasHomepage]
    .filter(Boolean).length / 6;
  const sourceCoverage = clamp(Math.log10(Math.max(1, input.sourceFiles) + 1) * 32);
  const telemetry = input.stars > 0 || input.forks > 0 || (input.subscribers ?? 0) > 0 ? 100 : 35;
  return Math.round(clamp(
    clamp(input.evidenceConfidence) * 0.52 +
      clamp(input.completionPct) * 0.1 +
      clamp(input.productionReadinessPct) * 0.08 +
      hygiene * 100 * 0.12 +
      sourceCoverage * 0.1 +
      telemetry * 0.08,
    20,
    96,
  ));
}

function confidenceAdjust(value: MoneyRange, confidencePct: number, speculative = false): MoneyRange {
  const c = clamp(confidencePct) / 100;
  const lowFactor = speculative ? 0.28 + c * 0.62 : 0.5 + c * 0.5;
  const highFactor = speculative ? 0.38 + c * 0.58 : 0.62 + c * 0.38;
  return range(value.low * lowFactor, value.high * highFactor);
}

function replacementCost(input: PortfolioValuationRepoInput) {
  const sourceHours = Math.max(24, input.sourceFiles * 1.4 + input.sourceBytes / 12_000);
  const complexityMultiplier = 1 + Math.min(0.45, Math.log10(Math.max(1, input.sourceFiles) + 1) * 0.12);
  const hours = sourceHours * complexityMultiplier;
  return {
    low: rounded(hours * 60),
    base: rounded(hours * 105),
    high: rounded(hours * 165),
  };
}

function recurringRevenuePotential(input: PortfolioValuationRepoInput): number {
  const text = [input.repo, input.kind, input.title, input.description, ...(input.topics ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const strong = ["saas", "subscription", "billing", "tenant", "platform", "api", "service", "marketplace"];
  const supporting = ["dashboard", "auth", "customer", "workspace", "cloud", "automation", "agent", "hosting"];
  const strongHits = strong.filter((term) => text.includes(term)).length;
  const supportHits = supporting.filter((term) => text.includes(term)).length;
  const productReadiness = clamp(input.productionReadinessPct * 0.55 + input.commercializationProbability * 0.45);
  return Math.round(clamp(18 + strongHits * 12 + supportHits * 5 + productReadiness * 0.3));
}

function repoScores(input: PortfolioValuationRepoInput) {
  const traction = clamp(
    Math.log10(input.stars + 1) * 22 +
      Math.log10(input.forks + 1) * 16 +
      Math.log10((input.subscribers ?? 0) + 1) * 14,
  );
  const distributionAdvantageScore = Math.round(clamp(
    traction * 0.45 +
      clamp(input.activityScore) * 0.2 +
      (input.hasHomepage ? 18 : 0) +
      (input.stars > 0 ? 7 : 0) +
      ((input.topics?.length ?? 0) > 0 ? 5 : 0),
  ));
  const demandProxyScore = Math.round(clamp(
    clamp(input.demandScore) * 0.5 +
      clamp(input.marketNeedScore) * 0.2 +
      traction * 0.18 +
      clamp(input.activityScore) * 0.12,
  ));
  const monetizationReadinessScore = Math.round(clamp(
    clamp(input.commercializationProbability) * 0.45 +
      clamp(input.productionReadinessPct) * 0.3 +
      clamp(input.completionPct) * 0.12 +
      (input.hasDeploy ? 6 : 0) +
      (input.hasHomepage ? 4 : 0) +
      (input.hasTests && input.hasCi ? 3 : 0),
  ));
  return { distributionAdvantageScore, demandProxyScore, monetizationReadinessScore };
}

function subtractRange(value: MoneyRange, discount: MoneyRange): MoneyRange {
  return range(Math.max(0, value.low - discount.low), Math.max(0, value.high - discount.high));
}

function addRange(value: MoneyRange, addition: MoneyRange): MoneyRange {
  return range(value.low + addition.low, value.high + addition.high);
}

/**
 * Produce a conservative portfolio-level valuation layer above the standalone
 * repository estimates. It explicitly discounts weak evidence and duplicated
 * intellectual property, then separately reports small, capped portfolio
 * synergies. It does not infer revenue, customers, TAM, market share, or named
 * competitors from repository code.
 */
export function buildPortfolioValuation(inputs: PortfolioValuationRepoInput[]): PortfolioValuationResult {
  if (inputs.length === 0) {
    return {
      methodologyVersion: "portfolio-valuation-v2-confidence-overlap",
      reposScored: 0,
      averageConfidencePct: 0,
      grossStandalonePresentValueUsd: range(0, 0),
      confidenceAdjustedBeforeOverlapUsd: range(0, 0),
      overlapDiscountUsd: range(0, 0),
      synergyUpliftUsd: range(0, 0),
      confidenceAdjustedPortfolioValueUsd: range(0, 0),
      grossStandalonePotentialValueUsd: range(0, 0),
      confidenceAdjustedPotentialBeforeOverlapUsd: range(0, 0),
      potentialOverlapDiscountUsd: range(0, 0),
      potentialSynergyUpliftUsd: range(0, 0),
      confidenceAdjustedPotentialValueUsd: range(0, 0),
      replacementCostUsd: { low: 0, base: 0, high: 0 },
      overlapPct: 0,
      repos: [],
      evidencePolicy: "No repositories were available to value.",
    };
  }

  // Highest-confidence repositories become the canonical IP anchors. Lower-
  // confidence siblings receive the overlap discount rather than the reverse.
  const ordered = [...inputs].sort((a, b) => confidence(b) - confidence(a) || a.repo.localeCompare(b.repo));
  const provisional: PortfolioValuationRepoResult[] = [];

  for (const input of ordered) {
    const confidencePct = confidence(input);
    const adjustedPresent = confidenceAdjust(input.presentValueUsd, confidencePct, false);
    const adjustedPotential = confidenceAdjust(input.potentialValueUsd, confidencePct, true);
    const scores = repoScores(input);
    const replacementCostUsd = replacementCost(input);

    let bestSimilarity = 0;
    let overlapWithRepo: string | null = null;
    for (const prior of provisional) {
      const priorInput = inputs.find((candidate) => candidate.repo === prior.repo);
      if (!priorInput) continue;
      const similarity = structuralSimilarity(input, priorInput);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        overlapWithRepo = prior.repo;
      }
    }

    // Similarity below 45% is treated as normal portfolio adjacency. Above it,
    // only the duplicated portion receives a discount, capped at 38% per repo.
    const overlapRate = bestSimilarity <= 0.45
      ? 0
      : Math.min(0.38, (bestSimilarity - 0.45) * 0.69);
    const overlapDiscountUsd = range(adjustedPresent.low * overlapRate, adjustedPresent.high * overlapRate);
    const potentialOverlapDiscountUsd = range(adjustedPotential.low * overlapRate, adjustedPotential.high * overlapRate);

    // Small synergy is allowed for related but non-duplicate assets. It is not
    // allowed for near-clones, and the portfolio-level aggregate is capped too.
    const synergyRate = bestSimilarity >= 0.18 && bestSimilarity < 0.68
      ? Math.min(0.045, bestSimilarity * 0.065) * (scores.monetizationReadinessScore / 100)
      : 0;
    const afterOverlap = subtractRange(adjustedPresent, overlapDiscountUsd);
    const potentialAfterOverlap = subtractRange(adjustedPotential, potentialOverlapDiscountUsd);
    const synergyContributionUsd = range(afterOverlap.low * synergyRate, afterOverlap.high * synergyRate);
    const potentialSynergyContributionUsd = range(potentialAfterOverlap.low * synergyRate, potentialAfterOverlap.high * synergyRate);

    const evidence: IntelligenceEvidence[] = [
      {
        class: "derived",
        label: "Confidence-adjusted standalone value",
        detail: `${confidencePct}/100 confidence based on repository evidence coverage, source depth, product hygiene, readiness, and observed GitHub telemetry.`,
      },
      {
        class: overlapRate > 0 ? "derived" : "insufficient",
        label: "Portfolio IP overlap",
        detail: overlapRate > 0
          ? `${Math.round(bestSimilarity * 100)}% structural/topic similarity to ${overlapWithRepo}; this repo receives a ${Math.round(overlapRate * 1000) / 10}% duplicate-IP discount.`
          : "No sufficiently strong repository similarity was detected to justify a duplicate-IP discount.",
      },
      {
        class: "derived",
        label: "Engineering replacement cost",
        detail: `Rebuild-cost proxy from ${input.sourceFiles} source files and ${Math.round(input.sourceBytes / 1024).toLocaleString()} KiB of source, using transparent engineering-rate bands. This is not fair-market value.`,
      },
      {
        class: "derived",
        label: "Demand and distribution proxies",
        detail: `Demand proxy ${scores.demandProxyScore}/100; distribution advantage ${scores.distributionAdvantageScore}/100 from activity, repository traction, homepage/topic presence, and existing planning evidence.`,
      },
      {
        class: "model_estimate",
        label: "Recurring-revenue potential",
        detail: `${recurringRevenuePotential(input)}/100 product-model heuristic. It describes monetization shape only and does not assert revenue, customers, or subscriptions exist.`,
      },
      input.competitivePressureVerified == null
        ? {
            class: "insufficient" as const,
            label: "Competitive saturation",
            detail: "No independently verified competition dataset was supplied to the full-portfolio pass, so saturation is intentionally left unknown rather than invented.",
          }
        : {
            class: "verified" as const,
            label: "Competitive saturation",
            detail: `Verified upstream competition evidence supplied a ${Math.round(clamp(input.competitivePressureVerified))}/100 competitive-pressure score.`,
          },
    ];

    provisional.push({
      repo: input.repo,
      confidencePct,
      standalonePresentValueUsd: range(input.presentValueUsd.low, input.presentValueUsd.high),
      confidenceAdjustedPresentValueUsd: adjustedPresent,
      standalonePotentialValueUsd: range(input.potentialValueUsd.low, input.potentialValueUsd.high),
      confidenceAdjustedPotentialValueUsd: adjustedPotential,
      overlapDiscountUsd,
      potentialOverlapDiscountUsd,
      synergyContributionUsd,
      potentialSynergyContributionUsd,
      adjustedPresentValueUsd: addRange(afterOverlap, synergyContributionUsd),
      adjustedPotentialValueUsd: addRange(potentialAfterOverlap, potentialSynergyContributionUsd),
      replacementCostUsd,
      monetizationReadinessScore: scores.monetizationReadinessScore,
      demandProxyScore: scores.demandProxyScore,
      distributionAdvantageScore: scores.distributionAdvantageScore,
      recurringRevenuePotentialScore: recurringRevenuePotential(input),
      competitiveSaturationScore: input.competitivePressureVerified == null
        ? null
        : Math.round(clamp(input.competitivePressureVerified)),
      overlapSimilarityPct: Math.round(bestSimilarity * 1000) / 10,
      overlapWithRepo: overlapRate > 0 ? overlapWithRepo : null,
      evidence,
    });
  }

  const grossPresent = sumRanges(provisional.map((repo) => repo.standalonePresentValueUsd));
  const adjustedBeforeOverlap = sumRanges(provisional.map((repo) => repo.confidenceAdjustedPresentValueUsd));
  const grossPotential = sumRanges(provisional.map((repo) => repo.standalonePotentialValueUsd));
  const adjustedPotentialBeforeOverlap = sumRanges(provisional.map((repo) => repo.confidenceAdjustedPotentialValueUsd));
  const overlapDiscount = sumRanges(provisional.map((repo) => repo.overlapDiscountUsd));
  const potentialOverlapDiscount = sumRanges(provisional.map((repo) => repo.potentialOverlapDiscountUsd));
  const rawSynergy = sumRanges(provisional.map((repo) => repo.synergyContributionUsd));
  const rawPotentialSynergy = sumRanges(provisional.map((repo) => repo.potentialSynergyContributionUsd));
  const synergyCap = range(adjustedBeforeOverlap.low * 0.08, adjustedBeforeOverlap.high * 0.08);
  const potentialSynergyCap = range(adjustedPotentialBeforeOverlap.low * 0.08, adjustedPotentialBeforeOverlap.high * 0.08);
  const synergyUplift = range(Math.min(rawSynergy.low, synergyCap.low), Math.min(rawSynergy.high, synergyCap.high));
  const potentialSynergyUplift = range(
    Math.min(rawPotentialSynergy.low, potentialSynergyCap.low),
    Math.min(rawPotentialSynergy.high, potentialSynergyCap.high),
  );
  const portfolioAfterOverlap = subtractRange(adjustedBeforeOverlap, overlapDiscount);
  const potentialAfterOverlap = subtractRange(adjustedPotentialBeforeOverlap, potentialOverlapDiscount);
  const replacement = provisional.reduce(
    (sum, repo) => ({
      low: sum.low + repo.replacementCostUsd.low,
      base: sum.base + repo.replacementCostUsd.base,
      high: sum.high + repo.replacementCostUsd.high,
    }),
    { low: 0, base: 0, high: 0 },
  );
  const midpointBefore = (adjustedBeforeOverlap.low + adjustedBeforeOverlap.high) / 2;
  const midpointDiscount = (overlapDiscount.low + overlapDiscount.high) / 2;

  return {
    methodologyVersion: "portfolio-valuation-v2-confidence-overlap",
    reposScored: provisional.length,
    averageConfidencePct: Math.round(provisional.reduce((sum, repo) => sum + repo.confidencePct, 0) / provisional.length),
    grossStandalonePresentValueUsd: grossPresent,
    confidenceAdjustedBeforeOverlapUsd: adjustedBeforeOverlap,
    overlapDiscountUsd: overlapDiscount,
    synergyUpliftUsd: synergyUplift,
    confidenceAdjustedPortfolioValueUsd: addRange(portfolioAfterOverlap, synergyUplift),
    grossStandalonePotentialValueUsd: grossPotential,
    confidenceAdjustedPotentialBeforeOverlapUsd: adjustedPotentialBeforeOverlap,
    potentialOverlapDiscountUsd,
    potentialSynergyUpliftUsd: potentialSynergyUplift,
    confidenceAdjustedPotentialValueUsd: addRange(potentialAfterOverlap, potentialSynergyUplift),
    replacementCostUsd: {
      low: rounded(replacement.low),
      base: rounded(replacement.base),
      high: rounded(replacement.high),
    },
    overlapPct: midpointBefore > 0 ? Math.round((midpointDiscount / midpointBefore) * 1000) / 10 : 0,
    repos: provisional.sort((a, b) => b.adjustedPresentValueUsd.high - a.adjustedPresentValueUsd.high || a.repo.localeCompare(b.repo)),
    evidencePolicy:
      "Portfolio V2 separates standalone value from confidence adjustment, duplicate-IP discounts, and capped synergy. Replacement cost, demand/distribution, monetization readiness, and recurring-revenue potential are derived planning indicators. Revenue, customers, TAM, market share, and competition are never treated as verified without external evidence.",
  };
}
