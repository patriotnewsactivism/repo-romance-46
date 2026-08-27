/**
 * Deterministic Repository Investment Intelligence.
 *
 * Market inputs can be evidence-backed or model-assisted upstream, but the
 * ranking itself is pure and auditable. The same portfolio facts always produce
 * the same "finish first" ordering.
 */

import type { MoneyRange } from "./valuation";

export type EvidenceClass = "verified" | "derived" | "model_estimate" | "insufficient";

export interface IntelligenceEvidence {
  class: EvidenceClass;
  label: string;
  detail: string;
  source?: string;
}

export interface RemainingWorkEstimate {
  hours: number;
  costUsd: MoneyRange;
}

export interface InvestmentOpportunityInput {
  repo: string;
  completionPct: number;
  productionReadinessPct: number;
  presentValueUsd: MoneyRange;
  potentialValueUsd: MoneyRange;
  marketNeed: number;
  demand: number;
  competitivePressure: number;
  commercializationProbability: number;
  remainingWork: RemainingWorkEstimate;
  evidenceConfidence: number;
  evidence?: IntelligenceEvidence[];
}

export interface InvestmentScoreBreakdown {
  commercialization: number;
  valueUnlock: number;
  marketOpportunity: number;
  completionLeverage: number;
  costEfficiency: number;
  evidenceConfidence: number;
}

export interface RankedInvestmentOpportunity extends InvestmentOpportunityInput {
  rank: number;
  finishFirstScore: number;
  valueUnlockUsd: number;
  scoreBreakdown: InvestmentScoreBreakdown;
  rationale: string[];
}

const clamp100 = (value: number): number => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
const midpoint = (range: MoneyRange): number => (Math.max(0, range.low) + Math.max(0, range.high)) / 2;

function normalize(values: number[], value: number, invert = false): number {
  if (values.length <= 1) return 50;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max <= min) return 50;
  const score = ((value - min) / (max - min)) * 100;
  return clamp100(invert ? 100 - score : score);
}

function logNormalize(values: number[], value: number): number {
  const logged = values.map((n) => Math.log10(Math.max(1, n) + 1));
  return normalize(logged, Math.log10(Math.max(1, value) + 1));
}

/**
 * Rank a portfolio by economic value unlocked per unit of execution risk.
 *
 * Weighting intentionally favors commercialization and value unlock over raw
 * code completion. A nearly-finished repo with no demand should not outrank a
 * strong opportunity simply because it has fewer TODOs.
 */
export function rankInvestmentOpportunities(
  inputs: InvestmentOpportunityInput[],
): RankedInvestmentOpportunity[] {
  if (inputs.length === 0) return [];

  const unlocks = inputs.map((item) => Math.max(0, midpoint(item.potentialValueUsd) - midpoint(item.presentValueUsd)));
  const costs = inputs.map((item) => Math.max(1, midpoint(item.remainingWork.costUsd)));

  const ranked = inputs.map((item, index): RankedInvestmentOpportunity => {
    const valueUnlockUsd = unlocks[index];
    const valueUnlock = logNormalize(unlocks, valueUnlockUsd);
    const costEfficiency = normalize(costs, costs[index], true);
    const marketOpportunity = clamp100(
      item.marketNeed * 0.35 + item.demand * 0.35 + (100 - item.competitivePressure) * 0.3,
    );
    const completionLeverage = clamp100(item.completionPct * 0.75 + item.productionReadinessPct * 0.25);
    const commercialization = clamp100(item.commercializationProbability);
    const evidenceConfidence = clamp100(item.evidenceConfidence);

    const finishFirstScore = clamp100(
      commercialization * 0.25 +
        valueUnlock * 0.22 +
        marketOpportunity * 0.2 +
        completionLeverage * 0.13 +
        costEfficiency * 0.1 +
        evidenceConfidence * 0.1,
    );

    const rationale = [
      `${Math.round(commercialization)}% commercialization probability`,
      `$${Math.round(valueUnlockUsd).toLocaleString()} modeled value unlock`,
      `${Math.round(marketOpportunity)}/100 market opportunity`,
      `${Math.round(item.completionPct)}% complete with ${Math.round(item.remainingWork.hours)}h estimated remaining`,
      `${Math.round(evidenceConfidence)}/100 evidence confidence`,
    ];

    return {
      ...item,
      rank: 0,
      finishFirstScore: Math.round(finishFirstScore * 10) / 10,
      valueUnlockUsd: Math.round(valueUnlockUsd),
      scoreBreakdown: {
        commercialization: Math.round(commercialization * 10) / 10,
        valueUnlock: Math.round(valueUnlock * 10) / 10,
        marketOpportunity: Math.round(marketOpportunity * 10) / 10,
        completionLeverage: Math.round(completionLeverage * 10) / 10,
        costEfficiency: Math.round(costEfficiency * 10) / 10,
        evidenceConfidence: Math.round(evidenceConfidence * 10) / 10,
      },
      rationale,
    };
  });

  ranked.sort(
    (a, b) =>
      b.finishFirstScore - a.finishFirstScore ||
      b.commercializationProbability - a.commercializationProbability ||
      b.valueUnlockUsd - a.valueUnlockUsd ||
      a.repo.localeCompare(b.repo),
  );

  return ranked.map((item, index) => ({ ...item, rank: index + 1 }));
}

/**
 * Estimate commercialization probability from observable readiness plus market
 * scores. This is still an estimate; callers should label it as derived, not a
 * historical probability or guarantee.
 */
export function estimateCommercializationProbability(input: {
  completionPct: number;
  productionReadinessPct: number;
  marketNeed: number;
  demand: number;
  competitivePressure: number;
  tractionScore: number;
  activityScore: number;
}): number {
  const probability =
    clamp100(input.completionPct) * 0.22 +
    clamp100(input.productionReadinessPct) * 0.2 +
    clamp100(input.demand) * 0.2 +
    clamp100(input.marketNeed) * 0.15 +
    clamp100(input.tractionScore) * 0.08 +
    clamp100(input.activityScore) * 0.1 +
    (100 - clamp100(input.competitivePressure)) * 0.05;
  return Math.round(clamp100(probability) * 10) / 10;
}

export function estimateRemainingWork(input: {
  completionPct: number;
  sourceFiles: number;
  sourceBytes: number;
  missingCriticalDimensions: number;
  hourlyRateLow?: number;
  hourlyRateHigh?: number;
}): RemainingWorkEstimate {
  const completion = clamp100(input.completionPct) / 100;
  const implementationHours = Math.max(
    24,
    input.sourceFiles * 1.4 + input.sourceBytes / 12_000,
  );
  const remediationHours = Math.max(0, input.missingCriticalDimensions) * 6;
  const remaining = Math.max(4, implementationHours * (1 - completion) + remediationHours);
  const hours = Math.round(remaining * 10) / 10;
  const lowRate = input.hourlyRateLow ?? 60;
  const highRate = input.hourlyRateHigh ?? 150;
  return {
    hours,
    costUsd: {
      low: Math.round(hours * lowRate),
      high: Math.round(hours * highRate),
    },
  };
}
