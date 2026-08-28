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
const toRange = (low: number, high: number): MoneyRange => ({ low: rounded(low), high: rounded(Math.max(low, high)) });
const sumRanges = (values: MoneyRange[]): MoneyRange => toRange(
  values.reduce((sum, value) => sum + Math.max(0, value.low), 0),
  values.reduce((sum, value) => sum + Math.max(0, value.high), 0),
);
const addRange = (a: MoneyRange, b: MoneyRange) => toRange(a.low + b.low, a.high + b.high);
const subtractRange = (a: MoneyRange, b: MoneyRange) => toRange(Math.max(0, a.low - b.low), Math.max(0, a.high - b.high));

function tokenSet(input: PortfolioValuationRepoInput) {
  const ignored = new Set(["app", "application", "project", "repo", "repository", "the", "and", "for", "with"]);
  const text = [input.repo.split("/").at(-1), input.kind, input.title, input.description, input.language, ...(input.topics ?? [])]
    .filter(Boolean).join(" ").toLowerCase();
  return new Set(text.split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && !ignored.has(token)));
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / Math.max(1, a.size + b.size - intersection);
}

function similarity(a: PortfolioValuationRepoInput, b: PortfolioValuationRepoInput) {
  let score = jaccard(tokenSet(a), tokenSet(b)) * 0.72;
  if (a.language && b.language && a.language.toLowerCase() === b.language.toLowerCase()) score += 0.1;
  if (a.kind && b.kind && a.kind.toLowerCase() === b.kind.toLowerCase()) score += 0.08;
  const aTopics = new Set((a.topics ?? []).map((value) => value.toLowerCase()));
  const bTopics = new Set((b.topics ?? []).map((value) => value.toLowerCase()));
  if (aTopics.size && bTopics.size) score += jaccard(aTopics, bTopics) * 0.1;
  return Math.min(1, Math.max(0, score));
}

function confidence(input: PortfolioValuationRepoInput) {
  const hygiene = [input.hasReadme, input.hasLicense, input.hasCi, input.hasTests, input.hasDeploy, input.hasHomepage]
    .filter(Boolean).length / 6;
  const sourceCoverage = clamp(Math.log10(Math.max(1, input.sourceFiles) + 1) * 32);
  const telemetry = input.stars > 0 || input.forks > 0 || (input.subscribers ?? 0) > 0 ? 100 : 35;
  return Math.round(clamp(
    clamp(input.evidenceConfidence) * 0.52 + clamp(input.completionPct) * 0.1 +
    clamp(input.productionReadinessPct) * 0.08 + hygiene * 12 + sourceCoverage * 0.1 + telemetry * 0.08,
    20, 96,
  ));
}

function adjustForConfidence(value: MoneyRange, confidencePct: number, speculative = false) {
  const c = clamp(confidencePct) / 100;
  return speculative
    ? toRange(value.low * (0.28 + c * 0.62), value.high * (0.38 + c * 0.58))
    : toRange(value.low * (0.5 + c * 0.5), value.high * (0.62 + c * 0.38));
}

function replacementCost(input: PortfolioValuationRepoInput) {
  const hours = Math.max(24, input.sourceFiles * 1.4 + input.sourceBytes / 12_000) *
    (1 + Math.min(0.45, Math.log10(Math.max(1, input.sourceFiles) + 1) * 0.12));
  return { low: rounded(hours * 60), base: rounded(hours * 105), high: rounded(hours * 165) };
}

function recurringRevenuePotential(input: PortfolioValuationRepoInput) {
  const text = [input.repo, input.kind, input.title, input.description, ...(input.topics ?? [])].filter(Boolean).join(" ").toLowerCase();
  const strong = ["saas", "subscription", "billing", "tenant", "platform", "api", "service", "marketplace"];
  const support = ["dashboard", "auth", "customer", "workspace", "cloud", "automation", "agent", "hosting"];
  const readiness = clamp(input.productionReadinessPct * 0.55 + input.commercializationProbability * 0.45);
  return Math.round(clamp(18 + strong.filter((term) => text.includes(term)).length * 12 + support.filter((term) => text.includes(term)).length * 5 + readiness * 0.3));
}

function drivers(input: PortfolioValuationRepoInput) {
  const traction = clamp(
    Math.log10(input.stars + 1) * 22 + Math.log10(input.forks + 1) * 16 + Math.log10((input.subscribers ?? 0) + 1) * 14,
  );
  const distributionAdvantageScore = Math.round(clamp(
    traction * 0.45 + clamp(input.activityScore) * 0.2 + (input.hasHomepage ? 18 : 0) +
    (input.stars > 0 ? 7 : 0) + ((input.topics?.length ?? 0) > 0 ? 5 : 0),
  ));
  const demandProxyScore = Math.round(clamp(
    clamp(input.demandScore) * 0.5 + clamp(input.marketNeedScore) * 0.2 + traction * 0.18 + clamp(input.activityScore) * 0.12,
  ));
  const monetizationReadinessScore = Math.round(clamp(
    clamp(input.commercializationProbability) * 0.45 + clamp(input.productionReadinessPct) * 0.3 +
    clamp(input.completionPct) * 0.12 + (input.hasDeploy ? 6 : 0) + (input.hasHomepage ? 4 : 0) +
    (input.hasTests && input.hasCi ? 3 : 0),
  ));
  return { distributionAdvantageScore, demandProxyScore, monetizationReadinessScore };
}

function emptyResult(): PortfolioValuationResult {
  const zero = toRange(0, 0);
  return {
    methodologyVersion: "portfolio-valuation-v2-confidence-overlap", reposScored: 0, averageConfidencePct: 0,
    grossStandalonePresentValueUsd: zero, confidenceAdjustedBeforeOverlapUsd: zero, overlapDiscountUsd: zero,
    synergyUpliftUsd: zero, confidenceAdjustedPortfolioValueUsd: zero, grossStandalonePotentialValueUsd: zero,
    confidenceAdjustedPotentialBeforeOverlapUsd: zero, potentialOverlapDiscountUsd: zero, potentialSynergyUpliftUsd: zero,
    confidenceAdjustedPotentialValueUsd: zero, replacementCostUsd: { low: 0, base: 0, high: 0 }, overlapPct: 0, repos: [],
    evidencePolicy: "No repositories were available to value.",
  };
}

export function buildPortfolioValuation(inputs: PortfolioValuationRepoInput[]): PortfolioValuationResult {
  if (!inputs.length) return emptyResult();
  const ordered = [...inputs].sort((a, b) => confidence(b) - confidence(a) || a.repo.localeCompare(b.repo));
  const results: PortfolioValuationRepoResult[] = [];

  for (const input of ordered) {
    const confidencePct = confidence(input);
    const adjustedPresent = adjustForConfidence(input.presentValueUsd, confidencePct);
    const adjustedPotential = adjustForConfidence(input.potentialValueUsd, confidencePct, true);
    const scores = drivers(input);
    let bestSimilarity = 0;
    let overlapWithRepo: string | null = null;
    for (const prior of results) {
      const priorInput = inputs.find((candidate) => candidate.repo === prior.repo);
      if (!priorInput) continue;
      const currentSimilarity = similarity(input, priorInput);
      if (currentSimilarity > bestSimilarity) {
        bestSimilarity = currentSimilarity;
        overlapWithRepo = prior.repo;
      }
    }

    const overlapRate = bestSimilarity <= 0.45 ? 0 : Math.min(0.38, (bestSimilarity - 0.45) * 0.69);
    const overlapDiscountUsd = toRange(adjustedPresent.low * overlapRate, adjustedPresent.high * overlapRate);
    const potentialOverlapDiscountUsd = toRange(adjustedPotential.low * overlapRate, adjustedPotential.high * overlapRate);
    const afterOverlap = subtractRange(adjustedPresent, overlapDiscountUsd);
    const potentialAfterOverlap = subtractRange(adjustedPotential, potentialOverlapDiscountUsd);
    const synergyRate = bestSimilarity >= 0.18 && bestSimilarity < 0.68
      ? Math.min(0.045, bestSimilarity * 0.065) * (scores.monetizationReadinessScore / 100)
      : 0;
    const synergyContributionUsd = toRange(afterOverlap.low * synergyRate, afterOverlap.high * synergyRate);
    const potentialSynergyContributionUsd = toRange(potentialAfterOverlap.low * synergyRate, potentialAfterOverlap.high * synergyRate);
    const recurring = recurringRevenuePotential(input);

    const evidence: IntelligenceEvidence[] = [
      { class: "derived", label: "Confidence adjustment", detail: `${confidencePct}/100 evidence confidence from repository telemetry, source coverage, readiness, and product hygiene.` },
      { class: overlapRate > 0 ? "derived" : "insufficient", label: "Portfolio IP overlap", detail: overlapRate > 0 ? `${Math.round(bestSimilarity * 100)}% similarity to ${overlapWithRepo}; ${Math.round(overlapRate * 1000) / 10}% duplicate-IP discount applied.` : "No similarity strong enough to justify a duplicate-IP discount." },
      { class: "derived", label: "Engineering replacement cost", detail: `Rebuild-cost proxy from ${input.sourceFiles} source files and source byte volume; this is not fair-market value.` },
      { class: "derived", label: "Demand and distribution proxies", detail: `Demand ${scores.demandProxyScore}/100; distribution ${scores.distributionAdvantageScore}/100 from activity and observable GitHub/product signals.` },
      { class: "model_estimate", label: "Recurring-revenue potential", detail: `${recurring}/100 monetization-shape heuristic; no revenue or subscription claim is implied.` },
      input.competitivePressureVerified == null
        ? { class: "insufficient", label: "Competitive saturation", detail: "No independently verified competition dataset was supplied, so saturation remains unknown." }
        : { class: "verified", label: "Competitive saturation", detail: `Verified upstream competition evidence supplied ${Math.round(clamp(input.competitivePressureVerified))}/100 pressure.` },
    ];

    results.push({
      repo: input.repo, confidencePct,
      standalonePresentValueUsd: toRange(input.presentValueUsd.low, input.presentValueUsd.high),
      confidenceAdjustedPresentValueUsd: adjustedPresent,
      standalonePotentialValueUsd: toRange(input.potentialValueUsd.low, input.potentialValueUsd.high),
      confidenceAdjustedPotentialValueUsd: adjustedPotential,
      overlapDiscountUsd, potentialOverlapDiscountUsd, synergyContributionUsd, potentialSynergyContributionUsd,
      adjustedPresentValueUsd: addRange(afterOverlap, synergyContributionUsd),
      adjustedPotentialValueUsd: addRange(potentialAfterOverlap, potentialSynergyContributionUsd),
      replacementCostUsd: replacementCost(input),
      monetizationReadinessScore: scores.monetizationReadinessScore,
      demandProxyScore: scores.demandProxyScore,
      distributionAdvantageScore: scores.distributionAdvantageScore,
      recurringRevenuePotentialScore: recurring,
      competitiveSaturationScore: input.competitivePressureVerified == null ? null : Math.round(clamp(input.competitivePressureVerified)),
      overlapSimilarityPct: Math.round(bestSimilarity * 1000) / 10,
      overlapWithRepo: overlapRate > 0 ? overlapWithRepo : null,
      evidence,
    });
  }

  const grossPresent = sumRanges(results.map((item) => item.standalonePresentValueUsd));
  const adjustedPresent = sumRanges(results.map((item) => item.confidenceAdjustedPresentValueUsd));
  const grossPotential = sumRanges(results.map((item) => item.standalonePotentialValueUsd));
  const adjustedPotential = sumRanges(results.map((item) => item.confidenceAdjustedPotentialValueUsd));
  const overlap = sumRanges(results.map((item) => item.overlapDiscountUsd));
  const potentialOverlap = sumRanges(results.map((item) => item.potentialOverlapDiscountUsd));
  const rawSynergy = sumRanges(results.map((item) => item.synergyContributionUsd));
  const rawPotentialSynergy = sumRanges(results.map((item) => item.potentialSynergyContributionUsd));
  const synergy = toRange(Math.min(rawSynergy.low, adjustedPresent.low * 0.08), Math.min(rawSynergy.high, adjustedPresent.high * 0.08));
  const potentialSynergy = toRange(Math.min(rawPotentialSynergy.low, adjustedPotential.low * 0.08), Math.min(rawPotentialSynergy.high, adjustedPotential.high * 0.08));
  const replacement = results.reduce((sum, item) => ({ low: sum.low + item.replacementCostUsd.low, base: sum.base + item.replacementCostUsd.base, high: sum.high + item.replacementCostUsd.high }), { low: 0, base: 0, high: 0 });
  const adjustedMid = (adjustedPresent.low + adjustedPresent.high) / 2;
  const overlapMid = (overlap.low + overlap.high) / 2;

  return {
    methodologyVersion: "portfolio-valuation-v2-confidence-overlap",
    reposScored: results.length,
    averageConfidencePct: Math.round(results.reduce((sum, item) => sum + item.confidencePct, 0) / results.length),
    grossStandalonePresentValueUsd: grossPresent,
    confidenceAdjustedBeforeOverlapUsd: adjustedPresent,
    overlapDiscountUsd: overlap,
    synergyUpliftUsd: synergy,
    confidenceAdjustedPortfolioValueUsd: addRange(subtractRange(adjustedPresent, overlap), synergy),
    grossStandalonePotentialValueUsd: grossPotential,
    confidenceAdjustedPotentialBeforeOverlapUsd: adjustedPotential,
    potentialOverlapDiscountUsd: potentialOverlap,
    potentialSynergyUpliftUsd: potentialSynergy,
    confidenceAdjustedPotentialValueUsd: addRange(subtractRange(adjustedPotential, potentialOverlap), potentialSynergy),
    replacementCostUsd: { low: rounded(replacement.low), base: rounded(replacement.base), high: rounded(replacement.high) },
    overlapPct: adjustedMid > 0 ? Math.round((overlapMid / adjustedMid) * 1000) / 10 : 0,
    repos: results.sort((a, b) => b.adjustedPresentValueUsd.high - a.adjustedPresentValueUsd.high || a.repo.localeCompare(b.repo)),
    evidencePolicy: "Portfolio V2 separates standalone value from confidence adjustment, duplicate-IP discounts, and capped synergy. Replacement cost, demand/distribution, monetization readiness, and recurring-revenue potential are planning indicators. Revenue, customers, TAM, market share, and competition are never treated as verified without external evidence.",
  };
}
