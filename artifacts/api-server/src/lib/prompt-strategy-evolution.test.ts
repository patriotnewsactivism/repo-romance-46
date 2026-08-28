import { describe, expect, it } from "vitest";
import {
  assignPromptArm,
  evaluatePromptExperiment,
  summarizePromptArm,
  type PromptOutcomeSample,
} from "./prompt-strategy-evolution";

function samples(version: string, scores: number[], completionDelta = 5): PromptOutcomeSample[] {
  return scores.map((outcomeScore) => ({ promptVersion: version, outcomeScore, completionDelta }));
}

describe("controlled prompt experiments", () => {
  it("routes exactly the configured challenger bucket", () => {
    expect(assignPromptArm(25, 0)).toBe("challenger");
    expect(assignPromptArm(25, 24.99)).toBe("challenger");
    expect(assignPromptArm(25, 25)).toBe("incumbent");
    expect(assignPromptArm(25, 99)).toBe("incumbent");
  });

  it("does not promote before both arms have enough scored runs", () => {
    const decision = evaluatePromptExperiment({
      incumbentVersion: "incumbent",
      challengerVersion: "challenger",
      samples: [...samples("incumbent", [60, 61, 62, 63, 64]), ...samples("challenger", [80, 81, 82, 83, 84])],
      minScoredRuns: 10,
    });
    expect(decision.action).toBe("continue");
  });

  it("promotes only when practical lift and one-sided confidence both clear", () => {
    const incumbent = [58, 60, 61, 59, 62, 60, 58, 61, 59, 60, 62, 58];
    const challenger = [72, 74, 75, 73, 76, 74, 72, 75, 73, 74, 76, 72];
    const decision = evaluatePromptExperiment({
      incumbentVersion: "incumbent",
      challengerVersion: "challenger",
      samples: [...samples("incumbent", incumbent, 4), ...samples("challenger", challenger, 7)],
      minScoredRuns: 10,
      practicalLift: 4,
      confidenceZ: 1.645,
    });
    expect(decision.action).toBe("promote");
    expect(decision.lift).toBeGreaterThanOrEqual(4);
    expect(decision.zScore).toBeGreaterThanOrEqual(1.645);
  });

  it("does not promote a noisy challenger that lacks confidence", () => {
    const decision = evaluatePromptExperiment({
      incumbentVersion: "incumbent",
      challengerVersion: "challenger",
      samples: [
        ...samples("incumbent", [45, 75, 45, 75, 45, 75, 45, 75, 45, 75]),
        ...samples("challenger", [50, 78, 50, 78, 50, 78, 50, 78, 50, 78]),
      ],
      minScoredRuns: 10,
      practicalLift: 2,
      confidenceZ: 1.645,
    });
    expect(decision.action).toBe("continue");
  });

  it("stops a challenger early when completion outcomes regress", () => {
    const decision = evaluatePromptExperiment({
      incumbentVersion: "incumbent",
      challengerVersion: "challenger",
      samples: [...samples("incumbent", [70, 71, 72, 73, 74], 6), ...samples("challenger", [69, 70, 71, 72, 73], 1)],
      minScoredRuns: 10,
    });
    expect(decision.action).toBe("reject");
    expect(decision.reason).toContain("completion delta");
  });

  it("treats low outcome scores as poor outcomes", () => {
    const arm = summarizePromptArm("a", samples("a", [20, 40, 41, 80]));
    expect(arm.poorOutcomeRate).toBe(0.5);
  });
});
