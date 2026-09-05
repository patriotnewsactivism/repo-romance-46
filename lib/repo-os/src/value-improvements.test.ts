import { describe, expect, it } from "vitest";
import { scoreCompletion, scoreProductionReadiness } from "./scoring";
import { suggestValueImprovements, valueImprovementsToNextSteps } from "./value-improvements";
import { abandonedScaffoldFixture, healthyApiFixture } from "./repo.fixtures";

describe("suggestValueImprovements", () => {
  it("produces an abundant ranked set from incomplete scorecards", () => {
    const completion = scoreCompletion(abandonedScaffoldFixture(), "library");
    const readiness = scoreProductionReadiness(abandonedScaffoldFixture());
    const suggestions = suggestValueImprovements({
      repo: "acme/scaffold",
      completion,
      readiness,
      analysisNextSteps: ["Wire the public CLI entrypoint and add a smoke script"],
      maxSuggestions: 20,
    });

    expect(suggestions.length).toBeGreaterThanOrEqual(8);
    expect(suggestions[0].priority).toBeGreaterThanOrEqual(suggestions[1].priority);
    expect(
      suggestions.some((s) => s.whyItRaisesValue.includes("completion points") || s.category === "readiness"),
    ).toBe(true);
    expect(suggestions.every((s) => s.action.length > 10 && s.whyItRaisesValue.length > 10)).toBe(true);
  });

  it("includes evidence-ceiling unlock when acceptance is missing", () => {
    const completion = scoreCompletion(healthyApiFixture(), "api");
    const suggestions = suggestValueImprovements({
      repo: "acme/api",
      completion,
      maxSuggestions: 15,
    });

    expect(suggestions.some((s) => s.id.includes("evidence-ceiling"))).toBe(true);
  });

  it("flattens into finish-ready next steps", () => {
    const completion = scoreCompletion(abandonedScaffoldFixture(), "web-app");
    const suggestions = suggestValueImprovements({
      repo: "acme/app",
      completion,
      maxSuggestions: 5,
    });
    const steps = valueImprovementsToNextSteps(suggestions, 5);
    expect(steps).toHaveLength(Math.min(5, suggestions.length));
    expect(steps[0]).toMatch(/Acceptance:/);
  });
});
