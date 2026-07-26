import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  calculateCompletion,
  calibrateValuationRange,
  clampPct,
  clampScore1to5,
  computeHealthScore,
  costReplacementBounds,
  countFunctions,
  detectStubs,
  diversificationScore,
  gradeFromScore,
  portfolioRecommendation,
  rankRecommendations,
  recommendationScore,
  sampleSourceFiles,
} from "./scoring.ts";

describe("clamp helpers", () => {
  it("clamps percent and 1-5 scores", () => {
    assert.equal(clampPct(150), 100);
    assert.equal(clampPct(-5), 0);
    assert.equal(clampScore1to5(0), 1);
    assert.equal(clampScore1to5(9), 5);
    assert.equal(clampScore1to5(3.4), 3);
  });
});

describe("health score", () => {
  it("grades bands correctly", () => {
    assert.equal(gradeFromScore(90), "A");
    assert.equal(gradeFromScore(70), "B");
    assert.equal(gradeFromScore(45), "C");
    assert.equal(gradeFromScore(25), "D");
    assert.equal(gradeFromScore(5), "F");
  });

  it("does not treat description as README", () => {
    const withDescOnly = computeHealthScore({
      hasReadme: false,
      hasDescription: true,
      hasCI: false,
      hasTests: false,
      hasLicense: false,
      hasTopics: false,
      daysSincePush: 400,
      stars: 0,
      hasHomepage: false,
    });
    const withReadme = computeHealthScore({
      hasReadme: true,
      hasDescription: true,
      hasCI: false,
      hasTests: false,
      hasLicense: false,
      hasTopics: false,
      daysSincePush: 400,
      stars: 0,
      hasHomepage: false,
    });
    assert.ok(withReadme.healthScore > withDescOnly.healthScore);
    assert.ok(withDescOnly.factors.some((f) => f.name === "Has README" && f.status === false));
  });

  it("gives tiered activity credit", () => {
    const fresh = computeHealthScore({
      hasReadme: true,
      hasDescription: true,
      hasCI: true,
      hasTests: true,
      hasLicense: true,
      hasTopics: true,
      daysSincePush: 10,
      stars: 12,
      hasHomepage: true,
    });
    const stale = computeHealthScore({
      hasReadme: true,
      hasDescription: true,
      hasCI: true,
      hasTests: true,
      hasLicense: true,
      hasTopics: true,
      daysSincePush: 400,
      stars: 12,
      hasHomepage: true,
    });
    assert.ok(fresh.healthScore > stale.healthScore);
    assert.ok(fresh.healthScore >= 80);
  });

  it("penalizes archived repos", () => {
    const base = {
      hasReadme: true,
      hasDescription: true,
      hasCI: true,
      hasTests: true,
      hasLicense: true,
      hasTopics: true,
      daysSincePush: 20,
      stars: 5,
      hasHomepage: true,
    };
    const live = computeHealthScore(base);
    const archived = computeHealthScore({ ...base, isArchived: true });
    assert.ok(archived.healthScore <= live.healthScore - 10);
  });
});

describe("stub and function detection", () => {
  it("detects TODO/FIXME without bare placeholder false positives", () => {
    const code = `
// TODO: implement auth
const label = "placeholder text in UI";
throw new Error("not implemented yet");
`;
    const stubs = detectStubs(code, "a.ts");
    assert.ok(stubs.some((s) => s.kind === "todo"));
    assert.ok(stubs.some((s) => s.kind === "unimplemented"));
    assert.ok(!stubs.some((s) => s.snippet.includes("placeholder text in UI")));
  });

  it("counts functions and detects empty stub bodies", () => {
    const code = `
export function real(a: number) {
  return a + 1;
}
export function empty() {}
export const bare = () => null;
export const ok = (x: number) => x * 2;
`;
    const { total, stubbed } = countFunctions(code);
    assert.ok(total >= 3);
    assert.ok(stubbed >= 2);
  });
});

describe("completion percentage", () => {
  it("returns abandoned for empty scaffolding", () => {
    const result = calculateCompletion({
      stubs: [],
      testCoverage: {
        hasTestFramework: false,
        testFileCount: 0,
        testToSourceRatio: 0,
        coveredPaths: [],
      },
      deployReadiness: {
        hasBuildScript: false,
        hasStartScript: false,
        hasBuildConfig: false,
        hasDeployConfig: false,
        hasEnvExample: false,
        hasDockerfile: false,
        issues: ["No deploy"],
      },
      functionCounts: { total: 0, stubbed: 0 },
      tree: [{ path: "package.json", type: "blob" }],
      hasReadme: false,
      hasLicense: false,
    });
    assert.ok(result.percentage < 35);
    assert.ok(
      result.verdict === "abandoned-scaffolding" || result.verdict === "early-stage",
    );
  });

  it("scores shippable projects high", () => {
    const tree = [
      { path: "src/index.ts", type: "blob" },
      { path: "src/lib/a.ts", type: "blob" },
      { path: "src/lib/a.test.ts", type: "blob" },
      { path: "README.md", type: "blob" },
      { path: "LICENSE", type: "blob" },
      { path: "vite.config.ts", type: "blob" },
      { path: "vercel.json", type: "blob" },
    ];
    const result = calculateCompletion({
      stubs: [],
      testCoverage: {
        hasTestFramework: true,
        testFileCount: 4,
        testToSourceRatio: 0.5,
        coveredPaths: ["src", "src/lib"],
      },
      deployReadiness: {
        hasBuildScript: true,
        hasStartScript: true,
        hasBuildConfig: true,
        hasDeployConfig: true,
        hasEnvExample: true,
        hasDockerfile: false,
        issues: [],
      },
      functionCounts: { total: 20, stubbed: 1 },
      tree,
      hasReadme: true,
      hasLicense: true,
    });
    assert.ok(result.percentage >= 80);
    assert.equal(result.verdict, "shippable");
  });

  it("does not award full code score when functions cannot be counted", () => {
    const tree = Array.from({ length: 12 }, (_, i) => ({
      path: `src/f${i}.ts`,
      type: "blob",
    }));
    const opaque = calculateCompletion({
      stubs: [],
      testCoverage: {
        hasTestFramework: false,
        testFileCount: 0,
        testToSourceRatio: 0,
        coveredPaths: [],
      },
      deployReadiness: {
        hasBuildScript: false,
        hasStartScript: false,
        hasBuildConfig: false,
        hasDeployConfig: false,
        hasEnvExample: false,
        hasDockerfile: false,
        issues: [],
      },
      functionCounts: { total: 0, stubbed: 0 },
      tree,
      hasReadme: false,
      hasLicense: false,
    });
    // Cap without function evidence — should not look shippable from code alone
    assert.ok(opaque.percentage < 50);
  });
});

describe("recommendation ranking", () => {
  it("prefers high market / low effort / finishable hours", () => {
    const ranked = rankRecommendations([
      { effort: 5, market_potential: 3, estimated_hours: 200, kind: "finish" },
      { effort: 2, market_potential: 5, estimated_hours: 12, kind: "finish" },
      { effort: 3, market_potential: 4, estimated_hours: 40, kind: "combine" },
    ]);
    assert.equal(ranked[0].market_potential, 5);
    assert.ok(recommendationScore(ranked[0]) >= recommendationScore(ranked[1]));
  });

  it("applies failure penalty", () => {
    const clean = recommendationScore({
      effort: 2,
      market_potential: 4,
      kind: "finish",
    });
    const penalized = recommendationScore({
      effort: 2,
      market_potential: 4,
      kind: "finish",
      failure_penalty: 3,
    });
    assert.ok(penalized < clean);
  });

  it("boosts near-complete finish candidates", () => {
    const nearDone = recommendationScore({
      effort: 2,
      market_potential: 3,
      kind: "finish",
      completion_pct: 80,
    });
    const early = recommendationScore({
      effort: 2,
      market_potential: 3,
      kind: "finish",
      completion_pct: 15,
    });
    assert.ok(nearDone > early);
  });
});

describe("valuation calibration", () => {
  it("produces positive cost-replacement bounds", () => {
    const b = costReplacementBounds({
      estimatedHours: 40,
      completionPct: 60,
      marketPotential: 4,
      stars: 10,
    });
    assert.ok(b.floor > 0);
    assert.ok(b.ceiling > b.floor);
    assert.ok(b.midpoint >= b.floor && b.midpoint <= b.ceiling);
  });

  it("pulls low-confidence AI highs toward bounds", () => {
    const bounds = costReplacementBounds({
      estimatedHours: 20,
      completionPct: 40,
      marketPotential: 2,
    });
    const calLow = calibrateValuationRange(1_000_000, 10_000_000, bounds, "low");
    const calHigh = calibrateValuationRange(1_000_000, 10_000_000, bounds, "high");
    assert.ok(calLow.high < 10_000_000);
    assert.ok(calLow.high < calHigh.high);
    assert.ok(calLow.high <= bounds.ceiling * 3 + 1);
    assert.ok(calLow.low >= 0);
    assert.ok(calLow.high > calLow.low);
  });

  it("diversification and portfolio recommendation are stable", () => {
    assert.ok(diversificationScore(["saas", "saas", "marketplace"], ["finish", "repurpose"]) > 0);
    assert.ok(portfolioRecommendation(600_000).toLowerCase().includes("strong"));
    assert.ok(portfolioRecommendation(10_000).toLowerCase().includes("early"));
  });
});

describe("sampleSourceFiles", () => {
  it("spreads samples across directories", () => {
    const files = [
      ...Array.from({ length: 10 }, (_, i) => ({ path: `src/a/f${i}.ts`, size: 1000 - i })),
      ...Array.from({ length: 10 }, (_, i) => ({ path: `src/b/f${i}.ts`, size: 500 - i })),
      ...Array.from({ length: 10 }, (_, i) => ({ path: `lib/c/f${i}.ts`, size: 200 - i })),
    ];
    const sample = sampleSourceFiles(files, 9);
    assert.equal(sample.length, 9);
    const dirs = new Set(sample.map((f) => f.path.split("/").slice(0, 2).join("/")));
    assert.ok(dirs.size >= 2);
  });
});
