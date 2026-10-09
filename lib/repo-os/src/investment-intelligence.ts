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
  /** 1–100 uniqueness / differentiation score (higher = more unique). */
  uniquenessPct: number;
  commercializationProbability: number;
  remainingWork: RemainingWorkEstimate;
  evidenceConfidence: number;
  evidence?: IntelligenceEvidence[];
}

/** Product-facing suggestion shown on portfolio repo cards (3–10 per repo). */
export interface RepoSuggestion {
  id: string;
  title: string;
  action: string;
  why: string;
  effort: 1 | 2 | 3 | 4 | 5;
}

export const REPO_SUGGESTION_MIN = 3;
export const REPO_SUGGESTION_MAX = 10;
export const REPO_SUGGESTION_DEFAULT = 8;

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

/**
 * Display scores for the portfolio UI are graded 1–100.
 * Raw 0 is preserved only when the caller marks the score as not measured.
 */
export function displayScore1to100(value: number, options?: { notMeasured?: boolean }): number {
  if (options?.notMeasured) return 0;
  const clamped = clamp100(value);
  return Math.max(1, Math.round(clamped));
}

function tokenSet(parts: Array<string | null | undefined>): Set<string> {
  const tokens = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    for (const token of part.toLowerCase().split(/[^a-z0-9]+/g)) {
      if (token.length >= 3) tokens.add(token);
    }
  }
  return tokens;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / Math.max(1, a.size + b.size - intersection);
}

/**
 * Estimate each repo's strongest in-portfolio IP overlap (0–100).
 * Used to sharpen uniqueness when full portfolio valuation is unavailable.
 */
export function estimatePortfolioOverlapPct(
  repos: Array<{
    repo: string;
    title?: string | null;
    pitch?: string | null;
    language?: string | null;
    topics?: string[] | null;
    kind?: string | null;
  }>,
): Map<string, number> {
  const prepared = repos.map((repo) => ({
    repo: repo.repo,
    language: repo.language?.toLowerCase() || "",
    kind: repo.kind?.toLowerCase() || "",
    topics: new Set((repo.topics ?? []).map((topic) => topic.toLowerCase())),
    tokens: tokenSet([repo.repo, repo.title ?? undefined, repo.pitch ?? undefined, ...(repo.topics ?? [])]),
  }));
  const overlaps = new Map<string, number>();
  for (let i = 0; i < prepared.length; i += 1) {
    let best = 0;
    for (let j = 0; j < prepared.length; j += 1) {
      if (i === j) continue;
      let score = jaccard(prepared[i].tokens, prepared[j].tokens) * 0.72;
      if (prepared[i].language && prepared[i].language === prepared[j].language) score += 0.1;
      if (prepared[i].kind && prepared[i].kind === prepared[j].kind) score += 0.08;
      if (prepared[i].topics.size && prepared[j].topics.size) {
        score += jaccard(prepared[i].topics, prepared[j].topics) * 0.1;
      }
      best = Math.max(best, Math.min(1, score));
    }
    overlaps.set(prepared[i].repo, Math.round(best * 1000) / 10);
  }
  return overlaps;
}

/**
 * Uniqueness combines inverse portfolio IP overlap, differentiation signal,
 * and inverse competitive pressure.
 *
 * Weights: 45% uniqueness-from-overlap, 35% differentiation, 20% open field.
 */
export function scoreUniqueness(input: {
  overlapSimilarityPct?: number | null;
  differentiation?: number | null;
  competitivePressure: number;
}): number {
  const overlap = clamp100(input.overlapSimilarityPct ?? 0);
  const differentiation = clamp100(
    input.differentiation == null || !Number.isFinite(input.differentiation)
      ? 100 - clamp100(input.competitivePressure)
      : input.differentiation,
  );
  const openField = 100 - clamp100(input.competitivePressure);
  const score = 0.45 * (100 - overlap) + 0.35 * differentiation + 0.2 * openField;
  return displayScore1to100(score);
}

const FALLBACK_SUGGESTIONS: Array<Omit<RepoSuggestion, "id">> = [
  {
    title: "Raise core product completeness",
    action: "Implement the highest-value unfinished core user journey end-to-end and verify it with a smoke path.",
    why: "Core journey gaps dominate completeness and keep commercialization probability discounted.",
    effort: 4,
  },
  {
    title: "Add production readiness evidence",
    action: "Wire CI build/tests and a deployable target with a post-deploy smoke check.",
    why: "Without CI and deploy evidence, readiness and evidence ceilings suppress shippable valuation.",
    effort: 3,
  },
  {
    title: "Document setup and verification",
    action: "Add a concise README covering setup, architecture, deployment, and how to verify the critical path.",
    why: "Clear operator docs reduce remaining work risk and raise buyer/operator confidence.",
    effort: 2,
  },
  {
    title: "Harden auth and secrets handling",
    action: "Ensure secrets stay server-side, auth gates sensitive routes, and .env.example documents required config safely.",
    why: "Security and secrets gaps block honest production-readiness scores.",
    effort: 3,
  },
  {
    title: "Strengthen automated tests",
    action: "Add tests around critical flows and failure paths so CI can gate regressions.",
    why: "Test coverage raises completeness and unlocks evidence-backed completion gains.",
    effort: 3,
  },
];

function slugSuggestion(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/**
 * Build a stable 3–10 suggestion list for a repository card.
 * Merges value improvements and analysis next-steps, dedupes, pads, and clamps.
 */
export function buildRepoSuggestions(input: {
  repo: string;
  valueImprovements?: Array<{
    id?: string;
    title?: string;
    action?: string;
    whyItRaisesValue?: string;
    problem?: string;
    effort?: number;
    priority?: number;
  }>;
  nextSteps?: string[];
  maxSuggestions?: number;
}): RepoSuggestion[] {
  const max = Math.max(
    REPO_SUGGESTION_MIN,
    Math.min(REPO_SUGGESTION_MAX, input.maxSuggestions ?? REPO_SUGGESTION_DEFAULT),
  );
  const repoSlug = slugSuggestion(input.repo) || "repo";
  const merged: Array<RepoSuggestion & { priority: number }> = [];
  const seen = new Set<string>();

  const push = (suggestion: RepoSuggestion, priority: number) => {
    const key = `${suggestion.title}:${suggestion.action}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({ ...suggestion, priority });
  };

  for (const item of input.valueImprovements ?? []) {
    const action = (item.action || item.problem || "").trim();
    const title = (item.title || action).trim();
    if (!action || !title) continue;
    const effort = Math.max(1, Math.min(5, Math.round(item.effort ?? 3))) as 1 | 2 | 3 | 4 | 5;
    push(
      {
        id: item.id || `${repoSlug}-${slugSuggestion(title)}`,
        title: title.slice(0, 120),
        action,
        why: (item.whyItRaisesValue || item.problem || "Closes a measured completeness or readiness gap.").trim(),
        effort,
      },
      item.priority ?? 20,
    );
  }

  for (const step of input.nextSteps ?? []) {
    const trimmed = step.trim();
    if (!trimmed) continue;
    push(
      {
        id: `${repoSlug}-step-${slugSuggestion(trimmed)}`,
        title: trimmed.length > 72 ? `${trimmed.slice(0, 69)}…` : trimmed,
        action: trimmed,
        why: "Portfolio analysis identified this as part of the finish path.",
        effort: 3,
      },
      18,
    );
  }

  merged.sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));

  const result: RepoSuggestion[] = merged.slice(0, max).map(({ priority: _priority, ...suggestion }) => suggestion);

  let fallbackIndex = 0;
  while (result.length < REPO_SUGGESTION_MIN && fallbackIndex < FALLBACK_SUGGESTIONS.length) {
    const fallback = FALLBACK_SUGGESTIONS[fallbackIndex];
    fallbackIndex += 1;
    const candidate: RepoSuggestion = {
      id: `${repoSlug}-fallback-${fallbackIndex}`,
      ...fallback,
    };
    const key = `${candidate.title}:${candidate.action}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }

  return result.slice(0, max);
}

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
    const uniquenessPct = displayScore1to100(
      item.uniquenessPct ??
        scoreUniqueness({
          competitivePressure: item.competitivePressure,
        }),
    );
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
      `${displayScore1to100(item.completionPct)}/100 completeness · ${uniquenessPct}/100 uniqueness`,
      `${displayScore1to100(item.demand)}/100 demand · ${displayScore1to100(item.competitivePressure)}/100 competition`,
      `${Math.round(item.remainingWork.hours)}h estimated remaining · ${Math.round(evidenceConfidence)}/100 evidence confidence`,
    ];

    return {
      ...item,
      uniquenessPct,
      completionPct: displayScore1to100(item.completionPct),
      demand: displayScore1to100(item.demand),
      competitivePressure: displayScore1to100(item.competitivePressure),
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
