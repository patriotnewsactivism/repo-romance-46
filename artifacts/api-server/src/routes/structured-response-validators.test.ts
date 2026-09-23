import { describe, expect, it } from "vitest";
import { isValidDomainClusters } from "./analysis";
import { hasValidMarketScenarios, isScenarioInput } from "./investment-intelligence";
import { storedInvestmentIntelligence } from "./portfolio-intelligence";
import { portfolioItemDisplayedError, portfolioLaunchSlots } from "./portfolio-finisher";
import { isFinishPlanChange } from "./repo-finisher";
import { isTieredIntelligenceResult } from "./tiered-intelligence";
import { isCompleteValuation } from "./valuation";
import { isCombinePlan } from "./vibe-tools";

const scenario = (name: "conservative" | "base" | "strong-execution", overrides: Record<string, unknown> = {}) => ({
  name,
  customers: 12,
  arpuMonthlyUsd: 25,
  grossMarginPct: 70,
  probability: 0.4,
  assumptions: ["paid conversion holds"],
  ...overrides,
});

const tiered = {
  architecture_quality: 80,
  product_readiness: 70,
  monetization_readiness: 60,
  maintainability: 75,
  differentiation_signal: 50,
  technical_risk: 40,
  confidence: 66,
  summary: "usable",
  architect_view: "layered",
  product_view: "narrow",
  quality_security_view: "tests exist",
  blockers: ["no billing"],
  next_actions: ["add checkout"],
};

const valuation = {
  repo: "owner/repo",
  estimated_value_low: 1000,
  estimated_value_high: 4000,
  currency: "USD",
  valuation_method: "comparable",
  confidence: "medium" as const,
  factors: [{ label: "demand", score: 1, weight: 1, detail: "niche" }],
  revenue_potential: { model: "subscription", monthly_revenue_low: 100, monthly_revenue_high: 800, timeline: "12 months" },
  comparables: [{ name: "peer", outcome: "acquired", multiple: "4x", relevance: "same buyer" }],
  risks: ["churn"],
  upsides: ["expansion"],
  summary: "Small subscription opportunity.",
};

describe("portfolio launch slots", () => {
  it("waits while executing work fills the concurrency cap", () => {
    expect(portfolioLaunchSlots(2, 2, 6)).toEqual({ slots: 0, wait: true, stop: false });
  });

  it("stops when nothing is queued and every slot is busy", () => {
    expect(portfolioLaunchSlots(2, 2, 2)).toEqual({ slots: 0, wait: false, stop: true });
  });

  it("launches only the open slots", () => {
    expect(portfolioLaunchSlots(2, 1, 5)).toEqual({ slots: 1, wait: false, stop: false });
  });
});

describe("portfolio item errors", () => {
  it("does not surface a succeeded session stop_reason as an error", () => {
    expect(portfolioItemDisplayedError(null, { status: "succeeded", stop_reason: "Targets already satisfied" })).toBeNull();
  });

  it("keeps a real item error ahead of the session stop reason", () => {
    expect(portfolioItemDisplayedError("plan rejected", { status: "blocked", stop_reason: "worker failed" })).toBe("plan rejected");
  });

  it("uses the session stop reason when the item failed without its own error", () => {
    expect(portfolioItemDisplayedError(null, { status: "blocked", stop_reason: "worker failed" })).toBe("worker failed");
  });
});

describe("structured response validators", () => {
  it("requires a complete scenario before accepting a market model", () => {
    const valid = [scenario("conservative"), scenario("base"), scenario("strong-execution")];
    expect(hasValidMarketScenarios(valid)).toBe(true);
    expect(hasValidMarketScenarios([scenario("base", { customers: 1.5 }), ...valid.slice(1)])).toBe(false);
    expect(hasValidMarketScenarios(valid.slice(0, 2))).toBe(false);
    expect(isScenarioInput(scenario("base", { assumptions: [1] }))).toBe(false);
    expect(isScenarioInput(scenario("base", { name: "breakout" }))).toBe(false);
  });

  it("rejects null and partial domain clusters while allowing an empty list", () => {
    expect(isValidDomainClusters([])).toBe(true);
    expect(isValidDomainClusters(null)).toBe(false);
    expect(isValidDomainClusters([{ name: "web", theme: "apps", repos: ["a/b"] }])).toBe(true);
    expect(isValidDomainClusters([{ name: "web", repos: ["a/b"] }])).toBe(false);
    expect(isValidDomainClusters([{ name: "web", theme: "apps", repos: [1] }])).toBe(false);
    expect(isValidDomainClusters([null])).toBe(false);
  });

  it("rejects null investment intelligence", () => {
    expect(storedInvestmentIntelligence(null)).toEqual({});
    expect(storedInvestmentIntelligence([])).toEqual({});
    expect(storedInvestmentIntelligence({ methodologyVersion: "investment-intelligence-v2" })).toEqual({
      methodologyVersion: "investment-intelligence-v2",
    });
  });

  it("rejects an empty finish-plan change", () => {
    expect(isFinishPlanChange({})).toBe(false);
    expect(
      isFinishPlanChange({ path: "src/app.ts", status: "modified", content: "export {}", description: "wire route" }),
    ).toBe(true);
    expect(isFinishPlanChange({ path: "src/app.ts", status: "renamed", content: "", description: "" })).toBe(false);
  });

  it("requires every tiered score to be an integer from 0 to 100", () => {
    expect(isTieredIntelligenceResult(tiered)).toBe(true);
    expect(isTieredIntelligenceResult({ ...tiered, confidence: 80.5 })).toBe(false);
    expect(isTieredIntelligenceResult({ summary: "partial" })).toBe(false);
    expect(isTieredIntelligenceResult({ ...tiered, blockers: ["ok", 1] })).toBe(false);
  });

  it("requires the valuation revenue model before accepting the object", () => {
    expect(isCompleteValuation(valuation)).toBe(true);
    const { revenue_potential: _ignored, ...withoutRevenue } = valuation;
    expect(isCompleteValuation(withoutRevenue)).toBe(false);
    expect(isCompleteValuation({ ...valuation, revenue_potential: { monthly_revenue_low: 1, monthly_revenue_high: 2, timeline: "soon" } })).toBe(false);
  });

  it("rejects a partial combine plan", () => {
    const plan = {
      repo_name: "combined-app",
      description: "one product",
      readme_md: "# Combined",
      integration_plan_md: "Move packages under apps/.",
      first_pr_title: "scaffold monorepo",
      structure: [{ path: "apps/web", purpose: "frontend" }],
    };
    expect(isCombinePlan(plan)).toBe(true);
    expect(isCombinePlan([plan])).toBe(false);
    expect(isCombinePlan({ ...plan, description: undefined, structure: [{ path: "apps/web" }] })).toBe(false);
  });
});
