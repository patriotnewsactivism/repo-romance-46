import { describe, expect, it } from "vitest";
import { memoryGuidance, type OperationalMemory } from "./learning-memory";

function memory(overrides: Partial<OperationalMemory> = {}): OperationalMemory {
  return {
    repo: "owner/repo",
    scope: "repo",
    category: "planning",
    memoryKey: "x",
    observation: "Observed result",
    recommendation: "Use the proven path.",
    confidence: 80,
    samples: 5,
    successes: 4,
    failures: 1,
    averageOutcomeScore: 82,
    averageCompletionDelta: 6,
    averageReadinessDelta: 4,
    outcomeScoreSamples: 4,
    completionDeltaSamples: 3,
    readinessDeltaSamples: 3,
    evidence: [],
    lastOutcome: "success",
    lastSeenAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("memoryGuidance", () => {
  it("prioritizes high-confidence measured memories", () => {
    const guidance = memoryGuidance([
      memory({ memoryKey: "low", confidence: 44, recommendation: "ignore me" }),
      memory({ memoryKey: "high", confidence: 92, recommendation: "prefer this" }),
      memory({ memoryKey: "mid", confidence: 65, recommendation: "use selectively" }),
    ]);
    expect(guidance).toHaveLength(2);
    expect(guidance[0]).toContain("prefer this");
    expect(guidance[0]).toContain("92% confidence");
    expect(guidance[0]).toContain("4 scored samples");
  });

  it("keeps unknown outcome scores explicit instead of inventing them", () => {
    const guidance = memoryGuidance([memory({ averageOutcomeScore: null, outcomeScoreSamples: 0, samples: 3 })]);
    expect(guidance[0]).toContain("3 observed samples");
    expect(guidance[0]).not.toContain("avg outcome");
  });
});
