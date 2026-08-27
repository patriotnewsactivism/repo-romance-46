import { describe, expect, it } from "vitest";
import { lowRiskSubset, rankRecommendations, recommendationSchema, recommendationScore, type Recommendation } from "./recommendations";

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  return recommendationSchema.parse({
    id: "rec_1",
    repo: "acme/widget",
    title: "Add a CI workflow",
    kind: "harden",
    problem: "Nothing runs the tests",
    whyItMatters: "Regressions ship unnoticed",
    proposedSolution: "Add a GitHub Actions workflow running install, typecheck and test",
    expectedBenefit: "Every push is verified",
    effort: 2,
    estimatedHours: 4,
    estimatedCostUsd: 300,
    risk: 1,
    confidence: 0.9,
    completionImpact: 4,
    valueImpact: 3,
    revenueImpact: 2,
    securityImpact: 2,
    marketPotential: 3,
    filesAffected: [".github/workflows/ci.yml"],
    dependencies: [],
    acceptanceCriteria: [{ description: "CI passes on the default branch", verification: "test", command: "pnpm test" }],
    ...overrides,
  });
}

describe("recommendationSchema", () => {
  it("requires at least one acceptance criterion", () => {
    expect(() => rec({ acceptanceCriteria: [] })).toThrow();
  });

  it("rejects out-of-range ratings", () => {
    expect(() => rec({ effort: 9 })).toThrow();
    expect(() => rec({ confidence: 1.5 })).toThrow();
  });

  it("accepts a fully specified recommendation", () => {
    expect(rec().acceptanceCriteria[0]?.verification).toBe("test");
  });
});

describe("recommendationScore", () => {
  it("prefers high market potential at low effort", () => {
    expect(recommendationScore(rec({ marketPotential: 5, effort: 1 }))).toBeGreaterThan(
      recommendationScore(rec({ marketPotential: 2, effort: 5 })),
    );
  });

  it("promotes security work over equivalent non-security work", () => {
    expect(recommendationScore(rec({ securityImpact: 5 }))).toBeGreaterThan(recommendationScore(rec({ securityImpact: 1 })));
  });

  it("demotes work the system has repeatedly failed at", () => {
    expect(recommendationScore(rec({ failurePenalty: 4 }))).toBeLessThan(recommendationScore(rec({ failurePenalty: 0 })));
  });

  it("prefers finishing a nearly complete repo over a barely started one", () => {
    expect(recommendationScore(rec({ kind: "finish", completionPct: 80 }))).toBeGreaterThan(
      recommendationScore(rec({ kind: "finish", completionPct: 10 })),
    );
  });

  it("discounts low-confidence proposals", () => {
    expect(recommendationScore(rec({ confidence: 0.95 }))).toBeGreaterThan(recommendationScore(rec({ confidence: 0.2 })));
  });

  it("penalizes risk at equal benefit", () => {
    expect(recommendationScore(rec({ risk: 1 }))).toBeGreaterThan(recommendationScore(rec({ risk: 5 })));
  });
});

describe("rankRecommendations", () => {
  it("orders by score and keeps ties in their original order", () => {
    const a = rec({ id: "a", marketPotential: 2, effort: 4 });
    const b = rec({ id: "b", marketPotential: 5, effort: 1 });
    const c = rec({ id: "c", marketPotential: 2, effort: 4 });
    expect(rankRecommendations([a, b, c]).map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("does not mutate the input array", () => {
    const items = [rec({ id: "a", marketPotential: 1 }), rec({ id: "b", marketPotential: 5 })];
    const before = items.map((r) => r.id);
    rankRecommendations(items);
    expect(items.map((r) => r.id)).toEqual(before);
  });
});

describe("lowRiskSubset", () => {
  it("includes only cheap, confident, low-risk work", () => {
    const safe = rec({ id: "safe", risk: 1, effort: 2, confidence: 0.9 });
    const risky = rec({ id: "risky", risk: 4, effort: 2, confidence: 0.9 });
    const big = rec({ id: "big", risk: 1, effort: 5, confidence: 0.9 });
    const unsure = rec({ id: "unsure", risk: 1, effort: 2, confidence: 0.3 });
    expect(lowRiskSubset([safe, risky, big, unsure]).map((r) => r.id)).toEqual(["safe"]);
  });
});
