/**
 * Opportunity scoring and portfolio ranking — the "which repository should I
 * finish first?" layer.
 *
 * Opportunity is refused rather than guessed: with too little market evidence
 * `scoreOpportunity` returns `insufficientEvidence: true` and a wide band,
 * because a confident-looking number built on nothing is worse than an
 * admission of ignorance.
 */

export type EvidenceStrength = "none" | "weak" | "moderate" | "strong";

export interface MarketSignal {
  key:
    | "search-demand"
    | "market-growth"
    | "competitive-intensity"
    | "customer-pain"
    | "willingness-to-pay"
    | "differentiation"
    | "distribution"
    | "existing-traction"
    | "switching-costs"
    | "defensibility"
    | "recurring-revenue"
    | "time-to-market";
  /** 0–100 for this dimension. Higher is always better for the product. */
  value: number;
  strength: EvidenceStrength;
  /** Where the number came from. Required for anything above "weak". */
  sources?: { url: string; publishedAt?: string; retrievedAt: string }[];
  note?: string;
}

export interface OpportunityScore {
  /** 0–100, or the midpoint of `range` when evidence is thin. */
  score: number;
  range: { low: number; high: number };
  confidence: "low" | "medium" | "high";
  insufficientEvidence: boolean;
  contributions: { key: MarketSignal["key"]; weight: number; value: number; weighted: number; strength: EvidenceStrength }[];
  missingSignals: MarketSignal["key"][];
  rationale: string[];
}

const SIGNAL_WEIGHTS: Record<MarketSignal["key"], number> = {
  "search-demand": 12,
  "market-growth": 10,
  "competitive-intensity": 8,
  "customer-pain": 12,
  "willingness-to-pay": 12,
  differentiation: 10,
  distribution: 8,
  "existing-traction": 8,
  "switching-costs": 5,
  defensibility: 5,
  "recurring-revenue": 6,
  "time-to-market": 4,
};

const STRENGTH_CREDIT: Record<EvidenceStrength, number> = { none: 0, weak: 0.4, moderate: 0.75, strong: 1 };

/** Below this share of weighted evidence, the score is reported as a range. */
const MIN_EVIDENCE_COVERAGE = 0.5;

export function scoreOpportunity(signals: MarketSignal[]): OpportunityScore {
  const byKey = new Map(signals.map((s) => [s.key, s]));
  const allKeys = Object.keys(SIGNAL_WEIGHTS) as MarketSignal["key"][];

  const contributions: OpportunityScore["contributions"] = [];
  const missingSignals: MarketSignal["key"][] = [];
  let weightedSum = 0;
  let coveredWeight = 0;
  const totalWeight = allKeys.reduce((sum, k) => sum + SIGNAL_WEIGHTS[k], 0);

  for (const key of allKeys) {
    const weight = SIGNAL_WEIGHTS[key];
    const signal = byKey.get(key);
    if (!signal || signal.strength === "none") {
      missingSignals.push(key);
      contributions.push({ key, weight, value: 0, weighted: 0, strength: "none" });
      continue;
    }
    const value = Math.max(0, Math.min(100, signal.value));
    const credit = STRENGTH_CREDIT[signal.strength];
    const weighted = (value / 100) * weight * credit;
    weightedSum += weighted;
    coveredWeight += weight * credit;
    contributions.push({ key, weight, value, weighted: Math.round(weighted * 100) / 100, strength: signal.strength });
  }

  const coverage = coveredWeight / totalWeight;
  const insufficientEvidence = coverage < MIN_EVIDENCE_COVERAGE;

  // Score only the evidence that exists; missing signals widen the range
  // instead of silently scoring zero.
  const observed = coveredWeight > 0 ? (weightedSum / coveredWeight) * 100 : 0;
  const uncertainty = (1 - coverage) * 50;

  const rationale: string[] = [];
  if (insufficientEvidence) {
    rationale.push(
      `Insufficient evidence: only ${Math.round(coverage * 100)}% of the weighted market signals were researched`,
    );
  }
  const strongSignals = signals.filter((s) => s.strength === "strong");
  for (const s of strongSignals.slice(0, 3)) {
    rationale.push(`${s.key}: ${s.value}/100 (strong evidence${s.note ? ` — ${s.note}` : ""})`);
  }
  const unsourced = signals.filter((s) => s.strength !== "none" && s.strength !== "weak" && (s.sources?.length ?? 0) === 0);
  for (const s of unsourced) {
    rationale.push(`${s.key} claims ${s.strength} evidence but cites no source — treat with suspicion`);
  }

  return {
    score: Math.round(observed),
    range: { low: Math.round(Math.max(0, observed - uncertainty)), high: Math.round(Math.min(100, observed + uncertainty)) },
    confidence: coverage >= 0.8 ? "high" : coverage >= MIN_EVIDENCE_COVERAGE ? "medium" : "low",
    insufficientEvidence,
    contributions,
    missingSignals,
    rationale,
  };
}

export interface PriorityInput {
  repo: string;
  /** 0–100 opportunity score. */
  opportunity: number;
  /** Midpoint of the scenario-based potential value, in USD. */
  potentialValueUsd: number;
  /** 0–1 — how likely the remaining work actually lands. */
  probabilityOfSuccess: number;
  /** 0–1 — how well this fits the owner's stated strategy. */
  strategicFit: number;
  /** Engineer-hours still required. Must be > 0. */
  remainingEffortHours: number;
}

export interface PriorityScore extends PriorityInput {
  /** Raw, unnormalized value of the formula — useful for debugging ranking. */
  raw: number;
  /** 0–100, normalized across the batch that was ranked together. */
  priority: number;
}

/**
 * Priority = Opportunity × Potential Value × Probability of Success ×
 *            Strategic Fit ÷ Remaining Effort
 *
 * Potential value is log-scaled: a $10M idea should outrank a $1M idea, but
 * not by 10×, or a single speculative number would dominate the portfolio.
 * Normalization is relative to the batch, so priorities are comparable only
 * within one ranking call — which is how a portfolio is actually read.
 */
export function rankPortfolio(inputs: PriorityInput[]): PriorityScore[] {
  const raws = inputs.map((input) => {
    const effort = Math.max(1, input.remainingEffortHours);
    const valueTerm = Math.log10(Math.max(10, input.potentialValueUsd));
    const raw =
      (Math.max(0, Math.min(100, input.opportunity)) / 100) *
      valueTerm *
      Math.max(0, Math.min(1, input.probabilityOfSuccess)) *
      Math.max(0, Math.min(1, input.strategicFit)) *
      (100 / effort);
    return { input, raw };
  });

  const max = Math.max(...raws.map((r) => r.raw), 0);

  return raws
    .map(({ input, raw }) => ({
      ...input,
      raw: Math.round(raw * 1000) / 1000,
      priority: max > 0 ? Math.round((raw / max) * 100) : 0,
    }))
    .sort((a, b) => b.priority - a.priority || a.repo.localeCompare(b.repo));
}

export type PortfolioSort =
  | "closest-to-finished"
  | "highest-current-value"
  | "highest-potential-value"
  | "best-roi-to-finish"
  | "fastest-path-to-revenue"
  | "easiest-win"
  | "biggest-upside"
  | "highest-priority";

export interface PortfolioRow {
  repo: string;
  completion: number;
  productionReadiness: number;
  currentValueUsd: number;
  potentialValueUsd: number;
  opportunity: number;
  remainingEffortHours: number;
  priority: number;
}

/** Deterministic ordering for each dashboard sort mode. Ties break by repo name. */
export function sortPortfolio(rows: PortfolioRow[], sort: PortfolioSort): PortfolioRow[] {
  const by = (fn: (row: PortfolioRow) => number) => (a: PortfolioRow, b: PortfolioRow) =>
    fn(b) - fn(a) || a.repo.localeCompare(b.repo);

  const comparators: Record<PortfolioSort, (a: PortfolioRow, b: PortfolioRow) => number> = {
    "closest-to-finished": by((r) => r.completion),
    "highest-current-value": by((r) => r.currentValueUsd),
    "highest-potential-value": by((r) => r.potentialValueUsd),
    "best-roi-to-finish": by((r) => r.potentialValueUsd / Math.max(1, r.remainingEffortHours)),
    "fastest-path-to-revenue": by((r) => r.completion * (r.opportunity / 100) - r.remainingEffortHours / 100),
    "easiest-win": by((r) => -r.remainingEffortHours),
    "biggest-upside": by((r) => r.potentialValueUsd - r.currentValueUsd),
    "highest-priority": by((r) => r.priority),
  };

  return [...rows].sort(comparators[sort]);
}
