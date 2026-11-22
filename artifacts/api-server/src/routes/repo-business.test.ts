import { describe, expect, it } from "vitest";
import { buildRepoBusinessReport } from "../lib/repo-business-engine";
import { portfolioSummary, rankingFromAnalysis, signalInputFromRanking } from "./repo-business";

const storedAnalysis = {
  investment_intelligence: {
    methodologyVersion: "portfolio-intelligence-v2-full-coverage",
    ranking: [
      {
        repo: "acme/launchpad",
        rank: 1,
        finishFirstScore: 78.4,
        completionPct: 71,
        productionReadinessPct: 64,
        marketNeed: 82,
        demand: 74,
        competitivePressure: 38,
        uniquenessPct: 66,
        commercializationProbability: 61,
        evidenceConfidence: 72,
        remainingWork: { hours: 52, costUsd: { low: 3000, high: 8000 } },
        presentValueUsd: { low: 14_000, high: 22_000 },
        potentialValueUsd: { low: 70_000, high: 140_000 },
        details: {
          language: "TypeScript",
          github: { stars: 120, forks: 9, subscribers: 18, topics: ["react", "billing"], lastPush: "2026-11-01T00:00:00Z" },
          suggestions: [{ title: "Add smoke test", action: "Cover the checkout path", why: "Highest risk", effort: 2 }],
          recommendedNextSteps: ["Finish onboarding", "Add CI"],
        },
      },
    ],
  },
};

describe("rankingFromAnalysis", () => {
  it("reads the persisted investment intelligence ranking", () => {
    const ranking = rankingFromAnalysis(storedAnalysis);
    expect(ranking).toHaveLength(1);
    expect(ranking[0].repo).toBe("acme/launchpad");
  });

  it("returns an empty list for an analysis with no intelligence yet", () => {
    expect(rankingFromAnalysis(null)).toEqual([]);
    expect(rankingFromAnalysis({})).toEqual([]);
    expect(rankingFromAnalysis({ investment_intelligence: { ranking: "nope" } })).toEqual([]);
  });
});

describe("signalInputFromRanking", () => {
  it("carries measured values and GitHub metadata into the engine input", () => {
    const input = signalInputFromRanking(rankingFromAnalysis(storedAnalysis)[0], {
      full_name: "acme/launchpad",
      description: "Onboarding platform",
      language: "TypeScript",
      topics: ["react", "billing"],
      private: false,
      fork: false,
      archived: false,
      stars: 130,
      forks: 10,
      open_issues: 4,
      watchers: 20,
      size_kb: 4096,
      default_branch: "main",
      pushed_at: "2026-11-02T00:00:00Z",
      created_at: "2026-01-01T00:00:00Z",
    });

    expect(input.repo).toBe("acme/launchpad");
    expect(input.completionPct).toBe(71);
    expect(input.productionReadinessPct).toBe(64);
    expect(input.presentValueUsd).toEqual({ low: 14_000, high: 22_000 });
    expect(input.remainingHours).toBe(52);
    expect(input.stars).toBe(120);
    expect(input.description).toBe("Onboarding platform");
    expect(input.suggestions?.[0]?.title).toBe("Add smoke test");
  });

  it("infers only metadata-level signals and never invents test or CI evidence", () => {
    const input = signalInputFromRanking({
      repo: "acme/thing",
      details: { github: { topics: ["stripe", "react"] } },
    });
    expect(input.hasPaymentsSignals).toBe(true);
    expect(input.hasFrontendSignals).toBe(true);
    expect(input.hasTests).toBeUndefined();
    expect(input.hasCi).toBeUndefined();
  });
});

describe("portfolioSummary", () => {
  it("aggregates value, demand, and stage counts", () => {
    const first = buildRepoBusinessReport({
      repo: "acme/one",
      completionPct: 80,
      productionReadinessPct: 70,
      marketNeed: 70,
      demand: 65,
      stars: 40,
      hasTests: true,
      hasCi: true,
      hasReadme: true,
      hasDocker: true,
      hasEnvExample: true,
      hasLicense: true,
    });
    const second = buildRepoBusinessReport({ repo: "acme/two", hasTests: false, hasCi: false, hasReadme: false });

    const summary = portfolioSummary([first, second]);
    expect(summary.repos).toBe(2);
    expect(summary.presentValueLow).toBeLessThanOrEqual(summary.presentValueHigh);
    expect(summary.potentialValueHigh).toBeGreaterThanOrEqual(summary.presentValueLow);
    expect(Object.values(summary.stageCounts).reduce((total, count) => total + count, 0)).toBe(2);
    expect(Object.values(summary.demandBands).reduce((total, count) => total + count, 0)).toBe(2);
  });

  it("handles an empty portfolio without dividing by zero", () => {
    expect(portfolioSummary([])).toMatchObject({ repos: 0, averageGrade: 0, averageDemand: 0, averageFinality: 0 });
  });
});
