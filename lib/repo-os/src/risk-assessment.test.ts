import { describe, expect, it } from "vitest";
import { assessRisk, type RiskFactors } from "./risk-assessment";

function factors(overrides: Partial<RiskFactors> = {}): RiskFactors {
  return {
    codeChurnLines: 0,
    filesTouched: 0,
    touchesSecuritySensitive: false,
    touchesAuth: false,
    touchesPayments: false,
    touchesMigrations: false,
    aiConfidence: 1,
    hasCodeowners: false,
    diffSizeKb: 0,
    ...overrides,
  };
}

describe("assessRisk", () => {
  it("classifies a small confident change as low risk and auto-mergeable", () => {
    expect(assessRisk(factors())).toEqual({
      level: "low",
      score: 0,
      reasons: ["No elevated risk signals detected"],
      recommendedAutonomy: "auto-merge",
    });
  });

  it("classifies moderate non-sensitive changes as medium risk", () => {
    const assessment = assessRisk(
      factors({ codeChurnLines: 101, filesTouched: 6, aiConfidence: 0.69, diffSizeKb: 21 }),
    );
    expect(assessment.level).toBe("medium");
    expect(assessment.recommendedAutonomy).toBe("one-click-approve");
    expect(assessment.reasons).toContain("Moderate code churn: 101 lines changed");
  });

  it("classifies a large non-sensitive change as high risk", () => {
    const assessment = assessRisk(
      factors({ codeChurnLines: 501, filesTouched: 21, aiConfidence: 0.89, diffSizeKb: 101 }),
    );
    expect(assessment.level).toBe("high");
    expect(assessment.recommendedAutonomy).toBe("full-review");
    expect(assessment.score).toBeGreaterThanOrEqual(50);
    expect(assessment.score).toBeLessThan(80);
  });

  it("requires human review for sensitive changes even when CODEOWNERS is present", () => {
    const assessment = assessRisk(factors({ touchesAuth: true, hasCodeowners: true }));
    expect(assessment.level).toBe("critical");
    expect(assessment.score).toBeGreaterThanOrEqual(80);
    expect(assessment.recommendedAutonomy).toBe("human-required");
    expect(assessment.reasons.some((reason) => reason.includes("CODEOWNERS"))).toBe(true);
  });

  it("uses CODEOWNERS to reduce non-critical risk", () => {
    const base = factors({ codeChurnLines: 101, filesTouched: 6 });
    const withoutOwners = assessRisk(base);
    const withOwners = assessRisk({ ...base, hasCodeowners: true });
    expect(withOwners.score).toBeLessThan(withoutOwners.score);
    expect(withOwners.reasons.some((reason) => reason.includes("CODEOWNERS"))).toBe(true);
  });

  it("bounds the score at 100", () => {
    const assessment = assessRisk(
      factors({
        codeChurnLines: 1000,
        filesTouched: 100,
        touchesSecuritySensitive: true,
        touchesAuth: true,
        touchesPayments: true,
        touchesMigrations: true,
        aiConfidence: 0,
        diffSizeKb: 1000,
      }),
    );
    expect(assessment.score).toBe(100);
    expect(assessment.level).toBe("critical");
  });

  it("rejects invalid confidence values", () => {
    expect(() => assessRisk(factors({ aiConfidence: -0.1 }))).toThrow(/aiConfidence/);
    expect(() => assessRisk(factors({ aiConfidence: 1.1 }))).toThrow(/aiConfidence/);
    expect(() => assessRisk(factors({ aiConfidence: Number.NaN }))).toThrow(/aiConfidence/);
  });
});
