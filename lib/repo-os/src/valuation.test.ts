import { describe, expect, it } from "vitest";
import { projectPotential, replacementCostBounds, valueRepository, type ScenarioInput } from "./valuation";

describe("replacementCostBounds", () => {
  it("produces a floor below the midpoint below the ceiling", () => {
    const bounds = replacementCostBounds({ estimatedHours: 200, completionPct: 60 });
    expect(bounds.floor).toBeLessThan(bounds.midpoint);
    expect(bounds.midpoint).toBeLessThan(bounds.ceiling);
  });

  it("values a more complete codebase higher at equal effort", () => {
    const low = replacementCostBounds({ estimatedHours: 200, completionPct: 20 });
    const high = replacementCostBounds({ estimatedHours: 200, completionPct: 80 });
    expect(high.midpoint).toBeGreaterThan(low.midpoint);
  });

  it("clamps absurd inputs into a sane band", () => {
    expect(replacementCostBounds({ estimatedHours: 0, completionPct: 0 }).midpoint).toBeGreaterThanOrEqual(500);
    expect(replacementCostBounds({ estimatedHours: 10_000_000, completionPct: 100 }).midpoint).toBeLessThanOrEqual(5_000_000);
  });
});

describe("valueRepository", () => {
  it("falls back to replacement cost with low confidence when there is no evidence", () => {
    const valuation = valueRepository({ replacement: { estimatedHours: 300, completionPct: 55 } });
    expect(valuation.primaryMethod).toBe("replacement-cost");
    expect(valuation.confidence).toBe("low");
    expect(valuation.missingInformation.join(" ")).toMatch(/No usage, customer, or revenue evidence/);
    expect(valuation.range.high).toBeGreaterThan(valuation.range.low);
  });

  it("uses a revenue multiple once real revenue exists", () => {
    const valuation = valueRepository({
      replacement: { estimatedHours: 300, completionPct: 80 },
      traction: {
        monthlyRecurringRevenueUsd: 5_000,
        sources: [{ claim: "MRR from Stripe dashboard", url: "https://example.com", retrievedAt: "2026-01-01" }],
      },
    });
    expect(valuation.primaryMethod).toBe("revenue-multiple");
    expect(valuation.confidence).toBe("high");
    expect(valuation.range.low).toBeGreaterThanOrEqual(60_000 * 1.5);
    expect(valuation.assumptions.join(" ")).toMatch(/ARR multiple/);
  });

  it("flags unknown churn as something that would move the number", () => {
    const valuation = valueRepository({
      replacement: { estimatedHours: 100 },
      traction: { annualRecurringRevenueUsd: 120_000 },
    });
    expect(valuation.missingInformation.join(" ")).toMatch(/Churn/);
    expect(valuation.whatWouldChangeIt.join(" ")).toMatch(/Retention/);
  });

  it("adjusts by traction without pretending stars are revenue", () => {
    const valuation = valueRepository({
      replacement: { estimatedHours: 200, completionPct: 70 },
      traction: { monthlyActiveUsers: 4_000, githubStars: 900 },
    });
    expect(valuation.primaryMethod).toBe("traction-adjusted");
    expect(valuation.evidence.join(" ")).toMatch(/attention signal only/);
    expect(valuation.assumptions.join(" ")).toMatch(/never as revenue/);
    expect(valuation.missingInformation.join(" ")).toMatch(/No revenue reported/);
  });

  it("never values a repo below what it would cost to rebuild it", () => {
    const replacement = { estimatedHours: 800, completionPct: 90 };
    const bounds = replacementCostBounds(replacement);
    const valuation = valueRepository({ replacement, traction: { annualRecurringRevenueUsd: 100 } });
    expect(valuation.range.low).toBeGreaterThanOrEqual(bounds.floor);
  });
});

describe("projectPotential", () => {
  const scenarios: ScenarioInput[] = [
    { name: "conservative", customers: 50, arpuMonthlyUsd: 20, grossMarginPct: 80, probability: 0.5, assumptions: ["organic only"] },
    { name: "base", customers: 250, arpuMonthlyUsd: 30, grossMarginPct: 80, probability: 0.3, assumptions: ["light paid acquisition"] },
    { name: "strong-execution", customers: 1_200, arpuMonthlyUsd: 40, grossMarginPct: 82, probability: 0.15, assumptions: ["a working funnel"] },
    { name: "breakout", customers: 8_000, arpuMonthlyUsd: 50, grossMarginPct: 85, probability: 0.05, assumptions: ["category leadership"] },
  ];

  it("labels itself as scenario-based rather than a present-day valuation", () => {
    expect(projectPotential(scenarios).label).toBe("scenario-based — not a present-day valuation");
  });

  it("computes MRR, ARR and gross profit per scenario", () => {
    const base = projectPotential(scenarios).scenarios.find((s) => s.name === "base");
    expect(base?.mrrUsd).toBe(7_500);
    expect(base?.arrUsd).toBe(90_000);
    expect(base?.grossProfitUsd).toBe(72_000);
  });

  it("weights expected ARR by probability", () => {
    const projection = projectPotential(scenarios);
    const conservativeArr = 50 * 20 * 12;
    const breakoutArr = 8_000 * 50 * 12;
    expect(projection.expectedArrUsd).toBeGreaterThan(conservativeArr);
    expect(projection.expectedArrUsd).toBeLessThan(breakoutArr);
  });

  it("always carries caveats that block it being read as current value", () => {
    const projection = projectPotential(scenarios);
    expect(projection.caveats.join(" ")).toMatch(/none of which is implied by the current completion score/);
  });

  it("handles an empty scenario set without dividing by zero", () => {
    expect(projectPotential([]).expectedArrUsd).toBe(0);
  });
});
