import { describe, expect, it } from "vitest";
import { evidenceCeiling, scoreCompletion, scoreProductionReadiness, weightProfileFor } from "./scoring";
import { abandonedScaffoldFixture, healthyApiFixture, libraryFixture } from "./repo.fixtures";
import type { AcceptanceEvidence, RepoKind } from "./types";

const FULLY_VERIFIED: AcceptanceEvidence = {
  buildPassed: true,
  typecheckPassed: true,
  testsPassed: true,
  testsRun: 80,
  lintPassed: true,
  migrationsApplied: true,
  deploymentSucceeded: true,
  smokeTestsPassed: true,
  criticalJourneyVerified: true,
  securityBlockersResolved: true,
};

describe("weightProfileFor", () => {
  const kinds: RepoKind[] = ["saas", "api", "web-app", "library", "cli", "static-site", "mobile-app", "infrastructure", "data-pipeline", "game", "ai-agent", "dev-tool", "browser-extension"];

  it.each(kinds)("normalizes the %s profile to 100 points", (kind) => {
    const total = Object.values(weightProfileFor(kind)).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(100, 6);
  });

  it("does not penalize a library for having no frontend", () => {
    expect(weightProfileFor("library")["frontend-ux"]).toBe(0);
  });

  it("weights the API surface more heavily for an API than for a static site", () => {
    expect(weightProfileFor("api")["backend-api"]).toBeGreaterThan(weightProfileFor("static-site")["backend-api"]);
  });
});

describe("evidenceCeiling", () => {
  it("caps hard when nothing has been verified", () => {
    expect(evidenceCeiling({})).toBe(75);
  });

  it("lifts the ceiling as checks pass", () => {
    expect(evidenceCeiling({ buildPassed: true })).toBe(85);
    expect(evidenceCeiling({ buildPassed: true, testsPassed: true })).toBe(90);
  });

  it("only removes the ceiling once everything is verified", () => {
    expect(evidenceCeiling(FULLY_VERIFIED)).toBeNull();
  });
});

describe("scoreCompletion", () => {
  it("scores an abandoned scaffold far below a finished service", () => {
    const scaffold = scoreCompletion(abandonedScaffoldFixture(), "library");
    const healthy = scoreCompletion(healthyApiFixture(), "api", FULLY_VERIFIED);
    expect(scaffold.overall).toBeLessThan(35);
    expect(healthy.overall).toBeGreaterThan(scaffold.overall + 30);
  });

  it("refuses to reach 100% without verification evidence", () => {
    const withoutEvidence = scoreCompletion(healthyApiFixture(), "api");
    expect(withoutEvidence.overall).toBeLessThanOrEqual(75);
    expect(withoutEvidence.evidenceCeiling).toBe(75);
  });

  it("never reaches 100% even when every check passes", () => {
    expect(scoreCompletion(healthyApiFixture(), "api", FULLY_VERIFIED).overall).toBeLessThan(100);
  });

  it("rises only when verification evidence arrives, not when files change", () => {
    const index = healthyApiFixture();
    const before = scoreCompletion(index, "api");
    const after = scoreCompletion(index, "api", { buildPassed: true, testsPassed: true, testsRun: 12 });
    expect(after.overall).toBeGreaterThan(before.overall);
    expect(scoreCompletion(index, "api").overall).toBe(before.overall);
  });

  it("marks dimensions that are capped pending evidence", () => {
    const card = scoreCompletion(healthyApiFixture(), "api");
    const testing = card.dimensions.find((d) => d.key === "testing");
    expect(testing?.cappedPendingEvidence).toBe(true);
    expect(testing?.missing.join(" ")).toMatch(/tests never observed passing/);
  });

  it("explains where the missing points come from, largest gap first", () => {
    const card = scoreCompletion(abandonedScaffoldFixture(), "library");
    expect(card.missingBreakdown.length).toBeGreaterThan(0);
    const lost = card.missingBreakdown.map((m) => m.lostPoints);
    expect([...lost].sort((a, b) => b - a)).toEqual(lost);
    expect(card.missingBreakdown[0]?.reasons.length).toBeGreaterThan(0);
  });

  it("keeps the point total consistent with the dimension weights", () => {
    const card = scoreCompletion(libraryFixture(), "library", FULLY_VERIFIED);
    const weightTotal = card.dimensions.reduce((sum, d) => sum + d.weight, 0);
    expect(weightTotal).toBeCloseTo(100, 1);
    for (const d of card.dimensions) {
      expect(d.earnedPoints).toBeLessThanOrEqual(d.weight + 1e-6);
      expect(d.earnedPoints).toBeGreaterThanOrEqual(0);
    }
  });

  it("does not mark a library down for missing a login page", () => {
    const asLibrary = scoreCompletion(libraryFixture(), "library", FULLY_VERIFIED);
    const asSaas = scoreCompletion(libraryFixture(), "saas", FULLY_VERIFIED);
    expect(asLibrary.overall).toBeGreaterThan(asSaas.overall);
  });

  it("assigns a verdict consistent with the score", () => {
    expect(scoreCompletion(abandonedScaffoldFixture(), "library").verdict).toMatch(/abandoned-scaffolding|early-stage/);
  });
});

describe("scoreProductionReadiness", () => {
  it("stays independent of completion", () => {
    const index = healthyApiFixture();
    const completion = scoreCompletion(index, "api", FULLY_VERIFIED);
    const readiness = scoreProductionReadiness(index, {});
    expect(readiness.overall).toBeLessThan(completion.overall);
  });

  it("lists blocking gaps explicitly", () => {
    const readiness = scoreProductionReadiness(abandonedScaffoldFixture(), {});
    expect(readiness.blockers.length).toBeGreaterThan(0);
    expect(readiness.blockers.join(" ")).toMatch(/Deployment configuration|Authentication/);
  });

  it("treats a committed .env as a blocking secret exposure", () => {
    const index = healthyApiFixture();
    const leaky = { ...index, files: [...index.files, { path: ".env", size: 100, language: null, role: "config" as const, analyzed: false }] };
    const readiness = scoreProductionReadiness(leaky, FULLY_VERIFIED);
    expect(readiness.blockers.join(" ")).toMatch(/committed \.env/);
  });

  it("reaches a high score once everything is verified", () => {
    expect(scoreProductionReadiness(healthyApiFixture(), FULLY_VERIFIED).overall).toBeGreaterThan(85);
  });
});
