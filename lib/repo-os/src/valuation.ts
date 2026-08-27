/**
 * Evidence-driven valuation.
 *
 * Two separate questions, never blurred:
 *   `valueRepository()`  — what is this asset worth today, on evidence?
 *   `projectPotential()` — what could it be worth if execution goes well?
 *
 * Both refuse to invent numbers. With no traction and no revenue, the current
 * valuation falls back to replacement cost with `low` confidence and a wide
 * range, and says so in `missingInformation`.
 *
 * The replacement-cost model is RESTORED from
 * `.migration-backup/src/lib/scoring.ts` (`costReplacementBounds`), which
 * calibrated indie-portfolio valuations sensibly and was otherwise lost.
 */

export type Confidence = "low" | "medium" | "high";

export interface MoneyRange {
  low: number;
  high: number;
}

export interface TractionEvidence {
  users?: number;
  monthlyActiveUsers?: number;
  downloads?: number;
  githubStars?: number;
  payingCustomers?: number;
  monthlyRecurringRevenueUsd?: number;
  annualRecurringRevenueUsd?: number;
  monthlyChurnRate?: number;
  /** Where each of the above came from, with retrieval dates. */
  sources?: { claim: string; url: string; retrievedAt: string }[];
}

export interface ReplacementCostInput {
  /** Engineer-hours a competent team would need to reproduce what exists. */
  estimatedHours: number | null | undefined;
  /** 0–100 completion — unfinished code is worth less to a buyer. */
  completionPct?: number | null;
  hourlyRateUsd?: number;
  /** 1–5 market-potential rating, when market research supports one. */
  marketPotential?: number | null;
  stars?: number;
  hasRevenueSignals?: boolean;
}

export interface ReplacementCostBounds {
  floor: number;
  ceiling: number;
  midpoint: number;
}

export interface CurrentValuation {
  range: MoneyRange;
  confidence: Confidence;
  primaryMethod: "replacement-cost" | "revenue-multiple" | "traction-adjusted";
  methodsApplied: string[];
  assumptions: string[];
  evidence: string[];
  missingInformation: string[];
  /** Facts that, if established, would move this range the most. */
  whatWouldChangeIt: string[];
}

export type ScenarioName = "conservative" | "base" | "strong-execution" | "breakout";

export interface ScenarioInput {
  name: ScenarioName;
  customers: number;
  arpuMonthlyUsd: number;
  grossMarginPct: number;
  /** Subjective 0–1 likelihood; must be supplied, never invented downstream. */
  probability: number;
  assumptions: string[];
}

export interface ScenarioProjection extends ScenarioInput {
  mrrUsd: number;
  arrUsd: number;
  grossProfitUsd: number;
  valuationRange: MoneyRange;
}

export interface PotentialValue {
  label: "scenario-based — not a present-day valuation";
  scenarios: ScenarioProjection[];
  /** Probability-weighted ARR across the supplied scenarios. */
  expectedArrUsd: number;
  confidence: Confidence;
  caveats: string[];
}

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

/**
 * Deterministic cost-replacement floor/ceiling.
 * Most side projects stay in the low tens of thousands unless traction exists.
 */
export function replacementCostBounds(input: ReplacementCostInput): ReplacementCostBounds {
  const rate = input.hourlyRateUsd ?? 75;
  const hours = Math.max(0, input.estimatedHours ?? 40);
  const completion = (input.completionPct ?? 50) / 100;
  // Value of code already written ≈ total project hours × completion × rate × build premium
  const investedHours = hours / Math.max(0.15, 1 - completion * 0.5);
  const raw = investedHours * completion * rate * 1.2;

  const market = input.marketPotential ?? 3;
  const marketMult = 0.6 + market * 0.25; // 0.85 … 1.85
  const starBoost = Math.min(1.5, 1 + Math.log10(Math.max(1, (input.stars ?? 0) + 1)) * 0.15);

  let mid = raw * marketMult * starBoost;
  if (input.hasRevenueSignals) mid *= 1.4;

  mid = clamp(mid, 500, 5_000_000);
  return { floor: Math.round(mid * 0.45), ceiling: Math.round(mid * 2.2), midpoint: Math.round(mid) };
}

/** SaaS ARR multiples vary widely; this band is deliberately conservative. */
const ARR_MULTIPLE_RANGE = { low: 1.5, high: 5 };

export function valueRepository(input: {
  replacement: ReplacementCostInput;
  traction?: TractionEvidence;
}): CurrentValuation {
  const bounds = replacementCostBounds(input.replacement);
  const traction = input.traction ?? {};
  const methodsApplied: string[] = ["replacement-cost"];
  const evidence: string[] = [];
  const assumptions: string[] = [
    `Replacement cost assumes a blended rate of $${input.replacement.hourlyRateUsd ?? 75}/hour`,
    `Assumes ${input.replacement.completionPct ?? 50}% of the intended product exists today`,
  ];
  const missingInformation: string[] = [];
  const whatWouldChangeIt: string[] = [];

  const arr =
    traction.annualRecurringRevenueUsd ??
    (traction.monthlyRecurringRevenueUsd !== undefined ? traction.monthlyRecurringRevenueUsd * 12 : undefined);

  let range: MoneyRange;
  let confidence: Confidence;
  let primaryMethod: CurrentValuation["primaryMethod"];

  if (arr !== undefined && arr > 0) {
    primaryMethod = "revenue-multiple";
    methodsApplied.push("revenue-multiple");
    const revenueRange = { low: Math.round(arr * ARR_MULTIPLE_RANGE.low), high: Math.round(arr * ARR_MULTIPLE_RANGE.high) };
    // The asset is worth at least what it costs to rebuild it.
    range = { low: Math.max(revenueRange.low, bounds.floor), high: Math.max(revenueRange.high, bounds.midpoint) };
    confidence = traction.sources && traction.sources.length > 0 ? "high" : "medium";
    evidence.push(`Reported ARR of $${arr.toLocaleString()}`);
    assumptions.push(`Applies a ${ARR_MULTIPLE_RANGE.low}×–${ARR_MULTIPLE_RANGE.high}× ARR multiple`);
    if (traction.monthlyChurnRate === undefined) {
      missingInformation.push("Churn rate unknown — revenue durability is unverified");
      whatWouldChangeIt.push("Retention/churn data would tighten the multiple substantially");
    }
  } else if (hasMeaningfulTraction(traction)) {
    primaryMethod = "traction-adjusted";
    methodsApplied.push("traction-adjusted");
    const multiplier = tractionMultiplier(traction);
    range = { low: Math.round(bounds.floor * multiplier), high: Math.round(bounds.ceiling * multiplier) };
    confidence = traction.sources && traction.sources.length > 0 ? "medium" : "low";
    evidence.push(...describeTraction(traction));
    assumptions.push(`Traction adjusts replacement cost by ${multiplier.toFixed(2)}×`);
    missingInformation.push("No revenue reported — value rests on usage, not cash flow");
    whatWouldChangeIt.push("Any paying customer converts this from a cost-basis to a revenue-basis valuation");
  } else {
    primaryMethod = "replacement-cost";
    range = { low: bounds.floor, high: bounds.ceiling };
    confidence = "low";
    missingInformation.push(
      "No usage, customer, or revenue evidence — this is a cost-to-rebuild estimate, not a market price",
    );
    whatWouldChangeIt.push("Usage or revenue evidence would replace the cost basis entirely");
    whatWouldChangeIt.push("A verified working deployment would raise the credible floor");
  }

  if (traction.githubStars !== undefined) {
    assumptions.push("GitHub stars are treated as a weak attention signal, never as revenue");
  }

  return {
    range: { low: Math.round(range.low), high: Math.round(Math.max(range.high, range.low + 500)) },
    confidence,
    primaryMethod,
    methodsApplied,
    assumptions,
    evidence,
    missingInformation,
    whatWouldChangeIt,
  };
}

function hasMeaningfulTraction(t: TractionEvidence): boolean {
  return Boolean(
    (t.monthlyActiveUsers ?? 0) > 0 ||
      (t.users ?? 0) > 0 ||
      (t.downloads ?? 0) > 0 ||
      (t.payingCustomers ?? 0) > 0 ||
      (t.githubStars ?? 0) >= 100,
  );
}

function tractionMultiplier(t: TractionEvidence): number {
  let m = 1;
  const mau = t.monthlyActiveUsers ?? 0;
  if (mau > 0) m += Math.min(1.5, Math.log10(mau + 1) * 0.4);
  const downloads = t.downloads ?? 0;
  if (downloads > 0) m += Math.min(0.8, Math.log10(downloads + 1) * 0.2);
  const stars = t.githubStars ?? 0;
  if (stars > 0) m += Math.min(0.5, Math.log10(stars + 1) * 0.15);
  if ((t.payingCustomers ?? 0) > 0) m += 0.5;
  return clamp(m, 1, 4);
}

function describeTraction(t: TractionEvidence): string[] {
  const out: string[] = [];
  if (t.monthlyActiveUsers) out.push(`${t.monthlyActiveUsers.toLocaleString()} monthly active users`);
  if (t.users) out.push(`${t.users.toLocaleString()} registered users`);
  if (t.downloads) out.push(`${t.downloads.toLocaleString()} downloads`);
  if (t.payingCustomers) out.push(`${t.payingCustomers.toLocaleString()} paying customers`);
  if (t.githubStars) out.push(`${t.githubStars.toLocaleString()} GitHub stars (attention signal only)`);
  return out;
}

/**
 * Scenario-based upside. Explicitly labeled so it can never be presented as a
 * current valuation. Callers supply the scenarios; this projects them.
 */
export function projectPotential(scenarios: ScenarioInput[], confidence: Confidence = "low"): PotentialValue {
  const projected: ScenarioProjection[] = scenarios.map((s) => {
    const mrr = s.customers * s.arpuMonthlyUsd;
    const arr = mrr * 12;
    const grossProfit = arr * (clamp(s.grossMarginPct, 0, 100) / 100);
    return {
      ...s,
      mrrUsd: Math.round(mrr),
      arrUsd: Math.round(arr),
      grossProfitUsd: Math.round(grossProfit),
      valuationRange: {
        low: Math.round(arr * ARR_MULTIPLE_RANGE.low),
        high: Math.round(arr * ARR_MULTIPLE_RANGE.high),
      },
    };
  });

  const probabilityTotal = projected.reduce((sum, s) => sum + clamp(s.probability, 0, 1), 0);
  const expectedArr =
    probabilityTotal > 0
      ? projected.reduce((sum, s) => sum + s.arrUsd * clamp(s.probability, 0, 1), 0) / probabilityTotal
      : 0;

  return {
    label: "scenario-based — not a present-day valuation",
    scenarios: projected,
    expectedArrUsd: Math.round(expectedArr),
    confidence,
    caveats: [
      "Scenario ARR assumes the product is finished, shipped and sold — none of which is implied by the current completion score",
      "Customer and ARPU inputs are planning assumptions supplied by the caller, not measured facts",
      `Valuation ranges apply a ${ARR_MULTIPLE_RANGE.low}×–${ARR_MULTIPLE_RANGE.high}× ARR multiple and ignore financing, dilution and market timing`,
    ],
  };
}
