import { describe, expect, it } from "vitest";
import {
  buildRepoBusinessReport,
  demandBand,
  gradeLetter,
  gradeRepository,
  measureDemand,
  measureFinality,
  signalsFromPaths,
  stageFor,
  valueRepositoryBusiness,
  type RepoSignalInput,
} from "./repo-business-engine";

const strongRepo: RepoSignalInput = {
  repo: "acme/launchpad",
  description: "Customer onboarding platform with Stripe billing",
  language: "TypeScript",
  topics: ["react", "api", "stripe"],
  stars: 420,
  forks: 38,
  openIssues: 6,
  watchers: 60,
  fileCount: 340,
  pushedAt: new Date().toISOString(),
  hasReadme: true,
  hasTests: true,
  hasCi: true,
  hasDocker: true,
  hasDeployConfig: true,
  hasEnvExample: true,
  hasLicense: true,
  hasDocs: true,
  hasContributing: true,
  hasDatabaseMigrations: true,
  hasAuthSignals: true,
  hasPaymentsSignals: true,
  hasFrontendSignals: true,
  hasBackendSignals: true,
  hasObservabilitySignals: true,
  completionPct: 92,
  productionReadinessPct: 90,
  marketNeed: 84,
  demand: 78,
  competitivePressure: 32,
  uniquenessPct: 74,
  commercializationProbability: 72,
  evidenceConfidence: 82,
  remainingHours: 30,
};

const bareRepo: RepoSignalInput = {
  repo: "acme/half-built",
  description: null,
  language: "JavaScript",
  stars: 0,
  forks: 0,
  openIssues: 0,
  pushedAt: null,
  hasReadme: false,
  hasTests: false,
  hasCi: false,
  hasDocker: false,
  hasDeployConfig: false,
  hasEnvExample: false,
  hasLicense: false,
  hasDocs: false,
  hasFrontendSignals: true,
  hasBackendSignals: false,
  hasAuthSignals: false,
  hasPaymentsSignals: false,
};

describe("gradeRepository", () => {
  it("grades a finished, verified repository in the production band", () => {
    const grade = gradeRepository(strongRepo);
    expect(grade.overall).toBeGreaterThanOrEqual(75);
    expect(["launch-ready", "production"]).toContain(grade.stage);
    expect(["A-", "A", "A+", "B+"]).toContain(grade.letter);
    expect(grade.confidence).toBe("measured");
  });

  it("caps an untested repository even when completion is claimed high", () => {
    const grade = gradeRepository({ ...strongRepo, hasTests: false });
    expect(grade.evidenceCeiling).toBeLessThanOrEqual(64);
    expect(grade.overall).toBeLessThanOrEqual(64);
    expect(grade.blockers).toContain("no automated tests");
  });

  it("reports missing evidence as missing instead of scoring it as passing", () => {
    const grade = gradeRepository({ repo: "acme/unknown" });
    expect(grade.overall).toBe(0);
    expect(grade.confidence).toBe("missing");
    expect(grade.dimensions.every((dimension) => dimension.confidence === "missing")).toBe(true);
  });

  it("keeps an archived repository out of the ready bands", () => {
    const grade = gradeRepository({ ...strongRepo, archived: true });
    expect(grade.evidenceCeiling).toBeLessThanOrEqual(40);
    expect(grade.blockers).toContain("repository is archived");
  });
});

describe("stage and letter thresholds", () => {
  it("maps scores to monotonic stages", () => {
    expect(stageFor(10)).toBe("concept");
    expect(stageFor(30)).toBe("scaffold");
    expect(stageFor(50)).toBe("functional-mvp");
    expect(stageFor(66)).toBe("beta");
    expect(stageFor(80)).toBe("launch-ready");
    expect(stageFor(95)).toBe("production");
  });

  it("maps scores to letters", () => {
    expect(gradeLetter(96)).toBe("A+");
    expect(gradeLetter(70)).toBe("B-");
    expect(gradeLetter(50)).toBe("C-");
    expect(gradeLetter(10)).toBe("F");
  });
});

describe("measureDemand", () => {
  it("calls out proven demand when market, traction, and differentiation agree", () => {
    const demand = measureDemand(strongRepo);
    expect(demand.index).toBeGreaterThanOrEqual(58);
    expect(["proven", "emerging"]).toContain(demand.band);
    expect(demand.drivers).toHaveLength(5);
  });

  it("treats missing market evidence as unproven and lists the gaps", () => {
    const demand = measureDemand({ repo: "acme/unknown" });
    expect(demand.band).toBe("unproven");
    expect(demand.confidence).toBe("missing");
    expect(demand.evidenceGaps.length).toBeGreaterThan(3);
  });

  it("bands the index consistently", () => {
    expect(demandBand(80)).toBe("proven");
    expect(demandBand(60)).toBe("emerging");
    expect(demandBand(40)).toBe("speculative");
    expect(demandBand(10)).toBe("unproven");
  });
});

describe("valueRepositoryBusiness", () => {
  it("never values the potential below the present", () => {
    const grade = gradeRepository(bareRepo);
    const demand = measureDemand(bareRepo);
    const valuation = valueRepositoryBusiness(bareRepo, grade, demand);
    expect(valuation.potentialValue.low).toBeGreaterThanOrEqual(valuation.presentValue.low);
    expect(valuation.potentialValue.high).toBeGreaterThanOrEqual(valuation.presentValue.high);
    expect(valuation.valueGap).toBeGreaterThanOrEqual(0);
  });

  it("respects measured ranges from the analysis", () => {
    const input: RepoSignalInput = {
      ...strongRepo,
      presentValueUsd: { low: 12_000, high: 20_000 },
      potentialValueUsd: { low: 60_000, high: 120_000 },
    };
    const grade = gradeRepository(input);
    const demand = measureDemand(input);
    const valuation = valueRepositoryBusiness(input, grade, demand);
    expect(valuation.presentValue).toEqual({ low: 12_000, base: 16_000, high: 20_000 });
    expect(valuation.potentialValue.base).toBe(90_000);
    expect(valuation.valueGap).toBe(90_000 - 16_000);
  });

  it("computes value unlocked per remaining hour", () => {
    const input: RepoSignalInput = { ...bareRepo, remainingHours: 100, presentValueUsd: { low: 1000, high: 3000 }, potentialValueUsd: { low: 10_000, high: 30_000 } };
    const grade = gradeRepository(input);
    const demand = measureDemand(input);
    const valuation = valueRepositoryBusiness(input, grade, demand);
    expect(valuation.valuePerRemainingHour).toBeGreaterThan(0);
  });

  it("labels low-evidence valuations as low confidence", () => {
    const grade = gradeRepository(bareRepo);
    const demand = measureDemand(bareRepo);
    const valuation = valueRepositoryBusiness(bareRepo, grade, demand);
    expect(valuation.confidence).toBe("low");
    expect(valuation.scenarios.map((scenario) => scenario.name)).toEqual(["conservative", "base", "upside"]);
  });
});

describe("measureFinality", () => {
  it("declares a strong repository finished only when no material gap remains", () => {
    const grade = gradeRepository(strongRepo);
    const finality = measureFinality(strongRepo, grade);
    expect(finality.score).toBeGreaterThan(50);
    expect(finality.nextBestAction.length).toBeGreaterThan(0);
  });

  it("reports unmeasured dimensions as gaps, not passes", () => {
    const grade = gradeRepository({ repo: "acme/unknown" });
    const finality = measureFinality({ repo: "acme/unknown" }, grade);
    expect(finality.isFinished).toBe(false);
    expect(finality.gaps.length).toBeGreaterThan(0);
    expect(finality.gaps.some((gap) => gap.note.includes("unmeasured"))).toBe(true);
  });
});

describe("signalsFromPaths", () => {
  it("detects the structural signals the grader depends on", () => {
    const signals = signalsFromPaths([
      "README.md",
      "src/app.tsx",
      "src/api/routes.ts",
      "src/components/button.tsx",
      ".github/workflows/ci.yml",
      "tests/app.test.ts",
      "Dockerfile",
      "vercel.json",
      ".env.example",
      "LICENSE",
      "docs/architecture.md",
      "CONTRIBUTING.md",
      "supabase/migrations/001_init.sql",
      "src/middleware/auth.ts",
      "src/billing/stripe.ts",
      "src/observability/sentry.ts",
    ]);
    expect(signals).toMatchObject({
      hasReadme: true,
      hasTests: true,
      hasCi: true,
      hasDocker: true,
      hasDeployConfig: true,
      hasEnvExample: true,
      hasLicense: true,
      hasDocs: true,
      hasContributing: true,
      hasDatabaseMigrations: true,
      hasAuthSignals: true,
      hasPaymentsSignals: true,
      hasFrontendSignals: true,
      hasBackendSignals: true,
      hasObservabilitySignals: true,
    });
    expect(signals.fileCount).toBe(16);
  });

  it("does not invent signals for an empty tree", () => {
    const signals = signalsFromPaths([]);
    expect(signals.hasTests).toBe(false);
    expect(signals.fileCount).toBe(0);
  });
});

describe("buildRepoBusinessReport", () => {
  it("returns a complete, internally consistent report", () => {
    const report = buildRepoBusinessReport(strongRepo);
    expect(report.methodologyVersion).toBe("repo-business-v1");
    expect(report.grade.dimensions).toHaveLength(10);
    expect(report.valuation.presentValue.low).toBeLessThanOrEqual(report.valuation.presentValue.high);
    expect(report.finality.score).toBeGreaterThanOrEqual(0);
    expect(report.finality.score).toBeLessThanOrEqual(100);
    expect(report.signals.measuredCompletion).toBe(true);
  });
});
