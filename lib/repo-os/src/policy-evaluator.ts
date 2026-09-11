export type PolicySeverity = "block" | "warn";

export interface ProposedChange {
  filesChanged: string[];
  diffSummary: string;
  touchesTests: boolean;
  touchesCiConfig: boolean;
  touchesSecurityDocs: boolean;
  touchesLockfile: boolean;
  removesAssertions: boolean;
  confidenceScore: number;
}

export interface PolicyViolation {
  ruleId: string;
  severity: PolicySeverity;
  message: string;
}

export interface PolicyRule {
  id: string;
  description: string;
  severity: PolicySeverity;
  evaluate: (change: ProposedChange) => PolicyViolation | null;
}

export interface PolicyEvaluationResult {
  allowed: boolean;
  violations: PolicyViolation[];
}

export const CONFIDENCE_THRESHOLD = 0.4;

export const DEFAULT_POLICY_RULES: readonly PolicyRule[] = [
  {
    id: "no-test-deletion",
    description: "Must not delete or weaken tests to achieve green CI",
    severity: "block",
    evaluate: (change) =>
      change.touchesTests && change.removesAssertions
        ? { ruleId: "no-test-deletion", severity: "block", message: "Proposed change removes or weakens test assertions" }
        : null,
  },
  {
    id: "no-ci-weakening",
    description: "Must not modify CI or security governance merely to pass checks",
    severity: "block",
    evaluate: (change) =>
      change.touchesCiConfig
        ? { ruleId: "no-ci-weakening", severity: "block", message: "Changes to CI configuration are not permitted in self-healing repairs" }
        : null,
  },
  {
    id: "no-security-doc-reduction",
    description: "Must not reduce CODEOWNERS or SECURITY.md controls",
    severity: "block",
    evaluate: (change) =>
      change.touchesSecurityDocs
        ? { ruleId: "no-security-doc-reduction", severity: "block", message: "Modifications to security governance documents are blocked" }
        : null,
  },
  {
    id: "no-lockfile-tampering",
    description: "Must not tamper with dependency lockfiles",
    severity: "block",
    evaluate: (change) =>
      change.touchesLockfile
        ? { ruleId: "no-lockfile-tampering", severity: "block", message: "Changes to dependency lockfiles are not permitted in self-healing repairs" }
        : null,
  },
  {
    id: "low-confidence-guard",
    description: "Reject low-confidence repairs",
    severity: "block",
    evaluate: (change) =>
      change.confidenceScore < CONFIDENCE_THRESHOLD
        ? { ruleId: "low-confidence-guard", severity: "block", message: `Confidence ${change.confidenceScore} is below the required threshold ${CONFIDENCE_THRESHOLD}` }
        : null,
  },
];

export const defaultPolicyRules = DEFAULT_POLICY_RULES;

function assertValidConfidence(change: ProposedChange): void {
  const confidence = change.confidenceScore;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(`Invalid confidenceScore: expected a finite number between 0 and 1`);
  }
}

export function evaluatePolicy(change: ProposedChange, extraRules: readonly PolicyRule[] = []): PolicyEvaluationResult {
  assertValidConfidence(change);
  if (!Array.isArray(extraRules)) throw new Error("extraRules must be an array");

  const violations: PolicyViolation[] = [];
  for (const rule of [...DEFAULT_POLICY_RULES, ...extraRules]) {
    const violation = rule.evaluate(change);
    if (violation) violations.push(violation);
  }

  return { allowed: !violations.some((violation) => violation.severity === "block"), violations };
}

export function validateRepair(repair: ProposedChange): void {
  const result = evaluatePolicy(repair);
  if (result.allowed) return;

  const blocked = result.violations
    .filter((violation) => violation.severity === "block")
    .map((violation) => `[${violation.ruleId}] ${violation.message}`)
    .join("; ");
  throw new Error(`Policy evaluation blocked repair: ${blocked}`);
}
