import { describe, expect, it } from "vitest";
import {
  evaluatePolicy,
  validateRepair,
  type PolicyRule,
  type ProposedChange,
} from "./policy-evaluator";

function change(overrides: Partial<ProposedChange> = {}): ProposedChange {
  return {
    filesChanged: ["src/widget.ts"],
    diffSummary: "Fix widget behavior",
    touchesTests: false,
    touchesCiConfig: false,
    touchesSecurityDocs: false,
    touchesLockfile: false,
    removesAssertions: false,
    confidenceScore: 0.4,
    ...overrides,
  };
}

describe("evaluatePolicy", () => {
  it("allows a confident repair that does not touch protected areas", () => {
    expect(evaluatePolicy(change())).toEqual({ allowed: true, violations: [] });
  });

  it("treats confidence exactly at the threshold as valid", () => {
    expect(evaluatePolicy(change({ confidenceScore: 0.4 })).allowed).toBe(true);
  });

  it.each([
    ["no-test-deletion", { touchesTests: true, removesAssertions: true }],
    ["no-ci-weakening", { touchesCiConfig: true }],
    ["no-security-doc-reduction", { touchesSecurityDocs: true }],
    ["no-lockfile-tampering", { touchesLockfile: true }],
    ["low-confidence-guard", { confidenceScore: 0.399 }],
  ])("blocks %s violations", (ruleId, overrides) => {
    const result = evaluatePolicy(change(overrides));
    expect(result.allowed).toBe(false);
    expect(result.violations.map((violation) => violation.ruleId)).toContain(ruleId);
  });

  it("allows warning-only extra rules to pass", () => {
    const warningRule: PolicyRule = {
      id: "review-nudge",
      description: "Ask for a quick look",
      severity: "warn",
      evaluate: () => ({ ruleId: "review-nudge", severity: "warn", message: "Consider a review" }),
    };
    expect(evaluatePolicy(change(), [warningRule])).toEqual({
      allowed: true,
      violations: [{ ruleId: "review-nudge", severity: "warn", message: "Consider a review" }],
    });
  });

  it("lets extra blocking rules participate in the decision", () => {
    const extraRule: PolicyRule = {
      id: "no-delete-readme",
      description: "Keep the README",
      severity: "block",
      evaluate: () => ({ ruleId: "no-delete-readme", severity: "block", message: "README deletion is blocked" }),
    };
    const result = evaluatePolicy(change(), [extraRule]);
    expect(result.allowed).toBe(false);
    expect(result.violations[0]?.ruleId).toBe("no-delete-readme");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1])("rejects invalid confidence %s", (confidence) => {
    expect(() => evaluatePolicy(change({ confidenceScore: confidence }))).toThrow(/confidenceScore/);
  });
});

describe("validateRepair", () => {
  it("throws a rule-id-rich error for blocked repairs", () => {
    expect(() =>
      validateRepair(change({ touchesCiConfig: true, confidenceScore: 0.2 })),
    ).toThrow(/\[no-ci-weakening\].*\[low-confidence-guard\]/);
  });

  it("returns normally for an allowed repair", () => {
    expect(() => validateRepair(change())).not.toThrow();
  });
});
