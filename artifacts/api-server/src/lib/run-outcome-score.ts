export interface InvestmentMetrics {
  completionPct: number | null;
  productionReadinessPct: number | null;
  finishFirstScore: number | null;
  commercializationProbability: number | null;
  remainingHours: number | null;
  presentValueMidpointUsd: number | null;
  potentialValueMidpointUsd: number | null;
}

export interface RunOutcomeDeltas {
  completionPct: number | null;
  productionReadinessPct: number | null;
  finishFirstScore: number | null;
  commercializationProbability: number | null;
  remainingHours: number | null;
  presentValueMidpointUsd: number | null;
}

export interface RunOutcomeScore {
  outcomeScore: number;
  deltas: RunOutcomeDeltas;
  summary: string;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function midpoint(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const low = finiteNumber(record.low);
  const high = finiteNumber(record.high);
  if (low === null || high === null) return null;
  return (low + high) / 2;
}

export function normalizeInvestmentMetrics(entry: unknown): InvestmentMetrics | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const remaining = record.remainingWork && typeof record.remainingWork === "object"
    ? (record.remainingWork as Record<string, unknown>)
    : null;

  const metrics: InvestmentMetrics = {
    completionPct: finiteNumber(record.completionPct),
    productionReadinessPct: finiteNumber(record.productionReadinessPct),
    finishFirstScore: finiteNumber(record.finishFirstScore),
    commercializationProbability: finiteNumber(record.commercializationProbability),
    remainingHours: finiteNumber(record.remainingHours) ?? finiteNumber(remaining?.hours),
    presentValueMidpointUsd:
      finiteNumber(record.presentValueMidpointUsd) ?? midpoint(record.presentValueUsd),
    potentialValueMidpointUsd:
      finiteNumber(record.potentialValueMidpointUsd) ?? midpoint(record.potentialValueUsd),
  };

  return Object.values(metrics).some((value) => value !== null) ? metrics : null;
}

function delta(before: number | null, after: number | null): number | null {
  if (before === null || after === null) return null;
  return Math.round((after - before) * 10) / 10;
}

export function scoreRunOutcome(input: {
  status: "succeeded" | "failed" | "stale";
  baseline: InvestmentMetrics | null;
  after: InvestmentMetrics | null;
  durationMs: number;
  filesChanged: number;
}): RunOutcomeScore {
  const { baseline, after } = input;
  const deltas: RunOutcomeDeltas = {
    completionPct: delta(baseline?.completionPct ?? null, after?.completionPct ?? null),
    productionReadinessPct: delta(
      baseline?.productionReadinessPct ?? null,
      after?.productionReadinessPct ?? null,
    ),
    finishFirstScore: delta(baseline?.finishFirstScore ?? null, after?.finishFirstScore ?? null),
    commercializationProbability: delta(
      baseline?.commercializationProbability ?? null,
      after?.commercializationProbability ?? null,
    ),
    remainingHours: delta(baseline?.remainingHours ?? null, after?.remainingHours ?? null),
    presentValueMidpointUsd: delta(
      baseline?.presentValueMidpointUsd ?? null,
      after?.presentValueMidpointUsd ?? null,
    ),
  };

  if (input.status !== "succeeded") {
    const score = input.status === "stale" ? 22 : 8;
    return {
      outcomeScore: score,
      deltas,
      summary:
        input.status === "stale"
          ? "The run was safely blocked because its repository base became stale."
          : "The run failed before it produced a verified repository improvement.",
    };
  }

  let score = 55;
  if (deltas.completionPct !== null) score += clamp(deltas.completionPct * 1.8, -18, 22);
  if (deltas.productionReadinessPct !== null) {
    score += clamp(deltas.productionReadinessPct * 1.2, -14, 16);
  }
  if (deltas.commercializationProbability !== null) {
    score += clamp(deltas.commercializationProbability * 0.8, -8, 10);
  }
  if (deltas.finishFirstScore !== null) score += clamp(deltas.finishFirstScore * 0.6, -6, 8);

  if (
    baseline?.remainingHours !== null &&
    baseline?.remainingHours !== undefined &&
    after?.remainingHours !== null &&
    after?.remainingHours !== undefined &&
    baseline.remainingHours > 0
  ) {
    const reductionPct = ((baseline.remainingHours - after.remainingHours) / baseline.remainingHours) * 100;
    score += clamp(reductionPct * 0.12, -8, 12);
  }

  if (input.filesChanged > 0) {
    score += clamp(5 - Math.max(0, input.filesChanged - 8) * 0.5, 0, 5);
  }

  const durationHours = Math.max(0, input.durationMs) / 3_600_000;
  score += clamp(4 - durationHours * 0.25, 0, 4);

  const outcomeScore = Math.round(clamp(score, 0, 100) * 10) / 10;
  const measured = [
    deltas.completionPct === null ? null : `${deltas.completionPct >= 0 ? "+" : ""}${deltas.completionPct} completion`,
    deltas.productionReadinessPct === null
      ? null
      : `${deltas.productionReadinessPct >= 0 ? "+" : ""}${deltas.productionReadinessPct} readiness`,
    deltas.remainingHours === null
      ? null
      : `${deltas.remainingHours <= 0 ? "" : "+"}${deltas.remainingHours} estimated hours remaining`,
  ].filter(Boolean);

  return {
    outcomeScore,
    deltas,
    summary:
      measured.length > 0
        ? `Verified run scored ${outcomeScore}/100 from measured before/after repository changes: ${measured.join(", ")}.`
        : `Verified run scored ${outcomeScore}/100; no comparable baseline Investment Intelligence snapshot was available.`,
  };
}
