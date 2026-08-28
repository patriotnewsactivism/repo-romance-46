import { describe, expect, it } from "vitest";
import { buildPortfolioValuation, type PortfolioValuationRepoInput } from "./portfolio-valuation";

function repo(overrides: Partial<PortfolioValuationRepoInput> = {}): PortfolioValuationRepoInput {
  return {
    repo: "acme/billing-platform",
    kind: "saas",
    title: "Billing Platform",
    description: "Multi-tenant billing automation platform",
    language: "TypeScript",
    topics: ["billing", "saas", "automation"],
    presentValueUsd: { low: 20_000, high: 40_000 },
    potentialValueUsd: { low: 80_000, high: 240_000 },
    completionPct: 78,
    productionReadinessPct: 70,
    commercializationProbability: 68,
    evidenceConfidence: 80,
    demandScore: 72,
    marketNeedScore: 76,
    stars: 20,
    forks: 5,
    subscribers: 3,
    openIssues: 4,
    activityScore: 90,
    sourceFiles: 120,
    sourceBytes: 900_000,
    hasReadme: true,
    hasLicense: true,
    hasCi: true,
    hasTests: true,
    hasDeploy: true,
    hasHomepage: true,
    competitivePressureVerified: null,
    ...overrides,
  };
}

describe("buildPortfolioValuation", () => {
  it("discounts standalone value when evidence confidence is weaker", () => {
    const result = buildPortfolioValuation([
      repo({ evidenceConfidence: 28, stars: 0, forks: 0, subscribers: 0, hasTests: false, hasCi: false }),
    ]);
    const item = result.repos[0];
    expect(item.confidencePct).toBeLessThan(80);
    expect(item.confidenceAdjustedPresentValueUsd.low).toBeLessThan(item.standalonePresentValueUsd.low);
    expect(item.confidenceAdjustedPresentValueUsd.high).toBeLessThan(item.standalonePresentValueUsd.high);
  });

  it("applies a capped duplicate-IP discount to near-duplicate repositories", () => {
    const result = buildPortfolioValuation([
      repo(),
      repo({
        repo: "acme/billing-platform-v2",
        title: "Billing Platform V2",
        description: "Multi tenant billing automation SaaS platform",
        stars: 2,
      }),
    ]);
    expect(result.overlapDiscountUsd.high).toBeGreaterThan(0);
    expect(result.overlapPct).toBeGreaterThan(0);
    const discounted = result.repos.find((item) => item.overlapWithRepo !== null);
    expect(discounted).toBeDefined();
    if (discounted) {
      const maxAllowed = discounted.confidenceAdjustedPresentValueUsd.high * 0.38 + 1;
      expect(discounted.overlapDiscountUsd.high).toBeLessThanOrEqual(maxAllowed);
    }
  });

  it("does not discount unrelated repositories", () => {
    const result = buildPortfolioValuation([
      repo(),
      repo({
        repo: "acme/photo-editor",
        kind: "desktop",
        title: "Photo Editor",
        description: "Local image crop and color correction utility",
        language: "Rust",
        topics: ["image", "desktop", "graphics"],
      }),
    ]);
    expect(result.overlapDiscountUsd).toEqual({ low: 0, high: 0 });
    expect(result.overlapPct).toBe(0);
  });

  it("produces ordered transparent replacement-cost bands", () => {
    const result = buildPortfolioValuation([repo()]);
    expect(result.replacementCostUsd.low).toBeGreaterThanOrEqual(0);
    expect(result.replacementCostUsd.low).toBeLessThan(result.replacementCostUsd.base);
    expect(result.replacementCostUsd.base).toBeLessThan(result.replacementCostUsd.high);
  });

  it("keeps portfolio synergy conservative and capped", () => {
    const result = buildPortfolioValuation([
      repo(),
      repo({
        repo: "acme/subscription-api",
        kind: "api",
        title: "Subscription API",
        description: "Subscription API for SaaS automation products",
        topics: ["subscription", "api", "saas"],
      }),
    ]);
    expect(result.synergyUpliftUsd.high).toBeLessThanOrEqual(
      Math.round(result.confidenceAdjustedBeforeOverlapUsd.high * 0.08) + 1,
    );
  });

  it("leaves competitive saturation unknown without verified competition evidence", () => {
    const unknown = buildPortfolioValuation([repo({ competitivePressureVerified: null })]).repos[0];
    expect(unknown.competitiveSaturationScore).toBeNull();
    const verified = buildPortfolioValuation([repo({ competitivePressureVerified: 73 })]).repos[0];
    expect(verified.competitiveSaturationScore).toBe(73);
  });

  it("is deterministic and aggregate math remains internally consistent", () => {
    const inputs = [repo(), repo({ repo: "acme/worker", title: "Queue Worker", description: "Background queue worker", topics: ["queue", "worker"] })];
    const first = buildPortfolioValuation(inputs);
    const second = buildPortfolioValuation(inputs);
    expect(second).toEqual(first);
    expect(first.confidenceAdjustedPortfolioValueUsd.low).toBe(
      first.confidenceAdjustedBeforeOverlapUsd.low - first.overlapDiscountUsd.low + first.synergyUpliftUsd.low,
    );
    expect(first.confidenceAdjustedPotentialValueUsd.high).toBe(
      first.confidenceAdjustedPotentialBeforeOverlapUsd.high - first.potentialOverlapDiscountUsd.high + first.potentialSynergyUpliftUsd.high,
    );
  });

  it("handles an empty portfolio without NaN or fabricated value", () => {
    const result = buildPortfolioValuation([]);
    expect(result.reposScored).toBe(0);
    expect(result.confidenceAdjustedPortfolioValueUsd).toEqual({ low: 0, high: 0 });
    expect(result.averageConfidencePct).toBe(0);
  });
});
