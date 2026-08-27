import { describe, expect, it } from "vitest";
import { summarizeStrategyPerformance, type RepoLearningEntry } from "./adaptive-learning";

function entry(
  pattern: string,
  outcome: RepoLearningEntry["outcome"],
  score: number,
  completionDelta: number,
): RepoLearningEntry {
  return {
    action: "completion_run_evaluated",
    outcome,
    duration_ms: 1000,
    details: "measured run",
    files_affected: ["src/app.ts"],
    fix_pattern: pattern,
    prompt_version: pattern.replace(/^prompt:/, ""),
    metadata: {
      outcome_score: score,
      completion_delta: completionDelta,
      readiness_delta: completionDelta / 2,
    },
    timestamp: new Date().toISOString(),
  };
}

describe("summarizeStrategyPerformance", () => {
  it("ranks strategies by measured outcome quality rather than raw occurrence count", () => {
    const summary = summarizeStrategyPerformance([
      entry("prompt:weak", "success", 38, 1),
      entry("prompt:weak", "success", 42, 2),
      entry("prompt:weak", "success", 40, 1),
      entry("prompt:strong", "success", 91, 12),
      entry("prompt:strong", "success", 87, 10),
    ]);

    expect(summary[0].pattern).toBe("prompt:strong");
    expect(summary[0].averageOutcomeScore).toBe(89);
    expect(summary[0].averageCompletionDelta).toBe(11);
    expect(summary[1].samples).toBe(3);
  });

  it("tracks failures separately from quantitative score", () => {
    const summary = summarizeStrategyPerformance([
      entry("prompt:mixed", "success", 80, 8),
      entry("prompt:mixed", "failure", 8, 0),
    ]);

    expect(summary[0]).toMatchObject({
      pattern: "prompt:mixed",
      samples: 2,
      successes: 1,
      failures: 1,
      averageOutcomeScore: 44,
    });
  });

  it("does not turn absent metrics into artificial zero scores", () => {
    const missing: RepoLearningEntry = {
      action: "completion_run_evaluated",
      outcome: "success",
      duration_ms: 1000,
      details: "legacy run without metrics",
      files_affected: [],
      fix_pattern: "prompt:legacy",
      prompt_version: "legacy",
      metadata: {
        outcome_score: null,
        completion_delta: null,
        readiness_delta: null,
      },
      timestamp: new Date().toISOString(),
    };

    expect(summarizeStrategyPerformance([missing])[0]).toMatchObject({
      pattern: "prompt:legacy",
      samples: 1,
      averageOutcomeScore: null,
      averageCompletionDelta: null,
      averageReadinessDelta: null,
    });
  });
});
