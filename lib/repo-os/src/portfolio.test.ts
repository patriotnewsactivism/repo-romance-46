import { describe, expect, it } from "vitest";
import { rankPortfolio, scoreOpportunity, sortPortfolio, type MarketSignal, type PortfolioRow } from "./portfolio";

const strong = (key: MarketSignal["key"], value: number): MarketSignal => ({
  key,
  value,
  strength: "strong",
  sources: [{ url: "https://example.com/report", retrievedAt: "2026-01-01" }],
});

describe("scoreOpportunity", () => {
  it("refuses to pretend confidence when most signals were never researched", () => {
    const result = scoreOpportunity([strong("search-demand", 80)]);
    expect(result.insufficientEvidence).toBe(true);
    expect(result.confidence).toBe("low");
    expect(result.rationale.join(" ")).toMatch(/Insufficient evidence/);
    expect(result.range.high - result.range.low).toBeGreaterThan(40);
  });

  it("narrows the range as coverage improves", () => {
    const all: MarketSignal[] = [
      strong("search-demand", 70),
      strong("market-growth", 70),
      strong("competitive-intensity", 60),
      strong("customer-pain", 80),
      strong("willingness-to-pay", 75),
      strong("differentiation", 65),
      strong("distribution", 60),
      strong("existing-traction", 40),
      strong("switching-costs", 50),
      strong("defensibility", 55),
      strong("recurring-revenue", 70),
      strong("time-to-market", 60),
    ];
    const result = scoreOpportunity(all);
    expect(result.insufficientEvidence).toBe(false);
    expect(result.confidence).toBe("high");
    expect(result.range.low).toBe(result.range.high);
    expect(result.score).toBeGreaterThan(50);
  });

  it("lists the signals nobody researched", () => {
    const result = scoreOpportunity([strong("search-demand", 90)]);
    expect(result.missingSignals).toContain("willingness-to-pay");
  });

  it("calls out claims that assert strong evidence but cite no source", () => {
    const result = scoreOpportunity([{ key: "market-growth", value: 95, strength: "strong" }]);
    expect(result.rationale.join(" ")).toMatch(/cites no source/);
  });

  it("discounts weak evidence relative to strong evidence", () => {
    const weak = scoreOpportunity([{ key: "customer-pain", value: 100, strength: "weak" }]);
    const firm = scoreOpportunity([strong("customer-pain", 100)]);
    expect(firm.confidence === "low" && weak.confidence === "low").toBe(true);
    expect(firm.range.high - firm.range.low).toBeLessThan(weak.range.high - weak.range.low);
  });
});

describe("rankPortfolio", () => {
  it("puts the cheapest path to a valuable outcome first", () => {
    const ranked = rankPortfolio([
      { repo: "a/slow-slog", opportunity: 90, potentialValueUsd: 2_000_000, probabilityOfSuccess: 0.6, strategicFit: 0.9, remainingEffortHours: 900 },
      { repo: "a/quick-win", opportunity: 70, potentialValueUsd: 400_000, probabilityOfSuccess: 0.8, strategicFit: 0.9, remainingEffortHours: 40 },
    ]);
    expect(ranked[0]?.repo).toBe("a/quick-win");
    expect(ranked[0]?.priority).toBe(100);
  });

  it("keeps priorities inside 0–100", () => {
    const ranked = rankPortfolio([
      { repo: "a/x", opportunity: 100, potentialValueUsd: 50_000_000, probabilityOfSuccess: 1, strategicFit: 1, remainingEffortHours: 1 },
      { repo: "a/y", opportunity: 0, potentialValueUsd: 0, probabilityOfSuccess: 0, strategicFit: 0, remainingEffortHours: 5_000 },
    ]);
    for (const row of ranked) {
      expect(row.priority).toBeGreaterThanOrEqual(0);
      expect(row.priority).toBeLessThanOrEqual(100);
    }
  });

  it("does not divide by zero when effort is unknown", () => {
    const ranked = rankPortfolio([
      { repo: "a/x", opportunity: 50, potentialValueUsd: 100_000, probabilityOfSuccess: 0.5, strategicFit: 0.5, remainingEffortHours: 0 },
    ]);
    expect(Number.isFinite(ranked[0]?.raw ?? NaN)).toBe(true);
  });

  it("log-scales potential value so one speculative number cannot dominate", () => {
    const ranked = rankPortfolio([
      { repo: "a/modest", opportunity: 80, potentialValueUsd: 100_000, probabilityOfSuccess: 0.8, strategicFit: 0.8, remainingEffortHours: 100 },
      { repo: "a/moonshot", opportunity: 80, potentialValueUsd: 100_000_000, probabilityOfSuccess: 0.8, strategicFit: 0.8, remainingEffortHours: 100 },
    ]);
    const modest = ranked.find((r) => r.repo === "a/modest");
    const moonshot = ranked.find((r) => r.repo === "a/moonshot");
    expect((moonshot?.raw ?? 0) / (modest?.raw ?? 1)).toBeLessThan(3);
  });
});

describe("sortPortfolio", () => {
  const rows: PortfolioRow[] = [
    { repo: "a/almost", completion: 94, productionReadiness: 60, currentValueUsd: 30_000, potentialValueUsd: 500_000, opportunity: 60, remainingEffortHours: 20, priority: 70 },
    { repo: "a/valuable", completion: 64, productionReadiness: 40, currentValueUsd: 120_000, potentialValueUsd: 4_000_000, opportunity: 85, remainingEffortHours: 400, priority: 90 },
    { repo: "a/early", completion: 20, productionReadiness: 10, currentValueUsd: 5_000, potentialValueUsd: 90_000, opportunity: 30, remainingEffortHours: 600, priority: 20 },
  ];

  it.each([
    ["closest-to-finished", "a/almost"],
    ["highest-current-value", "a/valuable"],
    ["highest-potential-value", "a/valuable"],
    ["easiest-win", "a/almost"],
    ["biggest-upside", "a/valuable"],
    ["highest-priority", "a/valuable"],
    ["best-roi-to-finish", "a/almost"],
  ] as const)("%s puts %s first", (sort, expected) => {
    expect(sortPortfolio(rows, sort)[0]?.repo).toBe(expected);
  });

  it("does not mutate the input", () => {
    const before = [...rows];
    sortPortfolio(rows, "highest-priority");
    expect(rows).toEqual(before);
  });
});
