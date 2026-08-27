import { describe, expect, it } from "vitest";
import {
  estimateCommercializationProbability,
  estimateRemainingWork,
  rankInvestmentOpportunities,
} from "./investment-intelligence";

describe("Repository Investment Intelligence", () => {
  it("ranks a stronger value-unlock opportunity ahead of a weak near-complete repo", () => {
    const ranked = rankInvestmentOpportunities([
      {
        repo: "acme/weak-near-done",
        completionPct: 94,
        productionReadinessPct: 90,
        presentValueUsd: { low: 15_000, high: 25_000 },
        potentialValueUsd: { low: 20_000, high: 32_000 },
        marketNeed: 30,
        demand: 25,
        competitivePressure: 80,
        commercializationProbability: 35,
        remainingWork: { hours: 12, costUsd: { low: 720, high: 1_800 } },
        evidenceConfidence: 80,
      },
      {
        repo: "acme/strong-opportunity",
        completionPct: 72,
        productionReadinessPct: 68,
        presentValueUsd: { low: 20_000, high: 40_000 },
        potentialValueUsd: { low: 180_000, high: 500_000 },
        marketNeed: 85,
        demand: 82,
        competitivePressure: 45,
        commercializationProbability: 74,
        remainingWork: { hours: 80, costUsd: { low: 4_800, high: 12_000 } },
        evidenceConfidence: 72,
      },
    ]);

    expect(ranked[0].repo).toBe("acme/strong-opportunity");
    expect(ranked[0].rank).toBe(1);
    expect(ranked[0].finishFirstScore).toBeGreaterThan(ranked[1].finishFirstScore);
  });

  it("keeps commercialization estimates bounded", () => {
    const probability = estimateCommercializationProbability({
      completionPct: 100,
      productionReadinessPct: 100,
      marketNeed: 100,
      demand: 100,
      competitivePressure: 0,
      tractionScore: 100,
      activityScore: 100,
    });
    expect(probability).toBe(100);
  });

  it("derives remaining time and cost from completion and codebase size", () => {
    const estimate = estimateRemainingWork({
      completionPct: 60,
      sourceFiles: 100,
      sourceBytes: 600_000,
      missingCriticalDimensions: 3,
    });
    expect(estimate.hours).toBeGreaterThan(4);
    expect(estimate.costUsd.high).toBeGreaterThan(estimate.costUsd.low);
  });
});
