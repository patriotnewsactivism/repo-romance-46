import { describe, expect, it } from "vitest";
import { evaluateCompletionSessionProgress } from "./completion-session-policy";

const base = {
  completionPct: 80,
  readinessPct: 75,
  previousCompletionPct: 70,
  previousReadinessPct: 65,
  targetCompletionPct: 95,
  targetReadinessPct: 90,
  iterationCount: 2,
  maxIterations: 5,
  noProgressCount: 0,
  maxNoProgressIterations: 2,
};

describe("evaluateCompletionSessionProgress", () => {
  it("completes only when both measured targets are reached", () => {
    const result = evaluateCompletionSessionProgress({ ...base, completionPct: 96, readinessPct: 91 });
    expect(result.action).toBe("complete");
    expect(result.noProgressCount).toBe(0);
  });

  it("continues when measurable progress remains below target", () => {
    const result = evaluateCompletionSessionProgress(base);
    expect(result.action).toBe("continue");
    expect(result.progress.completionDelta).toBe(10);
    expect(result.progress.readinessDelta).toBe(10);
  });

  it("blocks at the bounded iteration limit", () => {
    const result = evaluateCompletionSessionProgress({ ...base, iterationCount: 5 });
    expect(result.action).toBe("block");
    expect(result.reason).toContain("Maximum");
  });

  it("stops repeated score churn instead of looping forever", () => {
    const result = evaluateCompletionSessionProgress({
      ...base,
      completionPct: 80.2,
      readinessPct: 75.1,
      previousCompletionPct: 80,
      previousReadinessPct: 75,
      noProgressCount: 1,
    });
    expect(result.action).toBe("block");
    expect(result.noProgressCount).toBe(2);
  });

  it("allows one more bounded iteration when evidence is incomplete", () => {
    const result = evaluateCompletionSessionProgress({
      ...base,
      completionPct: null,
      readinessPct: null,
      previousCompletionPct: null,
      previousReadinessPct: null,
    });
    expect(result.action).toBe("continue");
  });
});
