import { describe, expect, it } from "vitest";
import { normalizeInvestmentMetrics, scoreRunOutcome } from "./run-outcome-score";

describe("normalizeInvestmentMetrics", () => {
  it("extracts the comparable investment fields", () => {
    expect(
      normalizeInvestmentMetrics({
        completionPct: 70,
        productionReadinessPct: 62,
        finishFirstScore: 74.5,
        commercializationProbability: 68,
        remainingWork: { hours: 40, costUsd: { low: 2400, high: 6000 } },
        presentValueUsd: { low: 10000, high: 20000 },
        potentialValueUsd: { low: 50000, high: 120000 },
      }),
    ).toEqual({
      completionPct: 70,
      productionReadinessPct: 62,
      finishFirstScore: 74.5,
      commercializationProbability: 68,
      remainingHours: 40,
      presentValueMidpointUsd: 15000,
      potentialValueMidpointUsd: 85000,
    });
  });
});

describe("scoreRunOutcome", () => {
  const baseline = normalizeInvestmentMetrics({
    completionPct: 60,
    productionReadinessPct: 52,
    finishFirstScore: 63,
    commercializationProbability: 58,
    remainingWork: { hours: 50, costUsd: { low: 3000, high: 7500 } },
    presentValueUsd: { low: 8000, high: 16000 },
    potentialValueUsd: { low: 40000, high: 90000 },
  });

  it("rewards verified completion, readiness, and remaining-work improvement", () => {
    const after = normalizeInvestmentMetrics({
      completionPct: 74,
      productionReadinessPct: 68,
      finishFirstScore: 76,
      commercializationProbability: 70,
      remainingWork: { hours: 30, costUsd: { low: 1800, high: 4500 } },
      presentValueUsd: { low: 11000, high: 23000 },
      potentialValueUsd: { low: 40000, high: 90000 },
    });

    const result = scoreRunOutcome({
      status: "succeeded",
      baseline,
      after,
      durationMs: 20 * 60_000,
      filesChanged: 6,
    });

    expect(result.outcomeScore).toBeGreaterThan(80);
    expect(result.deltas.completionPct).toBe(14);
    expect(result.deltas.productionReadinessPct).toBe(16);
    expect(result.deltas.remainingHours).toBe(-20);
  });

  it("penalizes a verified run that makes measured readiness worse", () => {
    const after = normalizeInvestmentMetrics({
      completionPct: 56,
      productionReadinessPct: 40,
      finishFirstScore: 50,
      commercializationProbability: 49,
      remainingWork: { hours: 65, costUsd: { low: 3900, high: 9750 } },
      presentValueUsd: { low: 7000, high: 14000 },
      potentialValueUsd: { low: 40000, high: 90000 },
    });

    const result = scoreRunOutcome({
      status: "succeeded",
      baseline,
      after,
      durationMs: 90 * 60_000,
      filesChanged: 18,
    });

    expect(result.outcomeScore).toBeLessThan(55);
    expect(result.deltas.completionPct).toBe(-4);
    expect(result.deltas.productionReadinessPct).toBe(-12);
  });

  it("keeps failures and stale-base blocks clearly below successful improvements", () => {
    expect(
      scoreRunOutcome({ status: "failed", baseline, after: null, durationMs: 1_000, filesChanged: 0 }).outcomeScore,
    ).toBe(8);
    expect(
      scoreRunOutcome({ status: "stale", baseline, after: null, durationMs: 1_000, filesChanged: 0 }).outcomeScore,
    ).toBe(22);
  });
});
