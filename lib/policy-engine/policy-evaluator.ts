/**
 * Policy Enforcement Agent (PEA) – declarative Policy-as-Code evaluator.
 * Prevents gaming of acceptance criteria (e.g. deleting tests to pass CI).
 */

export interface PolicyRule {
  id: string;
  description: string;
  severity: 'block' | 'warn';
  evaluate: (change: ProposedChange) => PolicyViolation | null;
}

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
  severity: 'block' | 'warn';
  message: string;
}

const defaultRules: PolicyRule[] = [
  {
    id: 'no-test-deletion',
    description: 'Must not delete or weaken tests to achieve green CI',
    severity: 'block',
    evaluate: (c) =>
      c.touchesTests && c.removesAssertions
        ? { ruleId: 'no-test-deletion', severity: 'block', message: 'Proposed change removes or weakens test assertions' }
        : null,
  },
  {
    id: 'no-ci-weakening',
    description: 'Must not modify CI/security governance merely to pass',
    severity: 'block',
    evaluate: (c) =>
      c.touchesCiConfig
        ? { ruleId: 'no-ci-weakening', severity: 'block', message: 'Changes to CI configuration are not permitted in self-healing repairs' }
        : null,
  },
  {
    id: 'no-security-doc-reduction',
    description: 'Must not reduce CODEOWNERS or SECURITY.md controls',
    severity: 'block',
    evaluate: (c) =>
      c.touchesSecurityDocs
        ? { ruleId: 'no-security-doc-reduction', severity: 'block', message: 'Modifications to security governance documents are blocked' }
        : null,
  },
  {
    id: 'low-confidence-guard',
    description: 'Reject low-confidence repairs',
    severity: 'block',
    evaluate: (c) =>
      c.confidenceScore < 0.4
        ? { ruleId: 'low-confidence-guard', severity: 'block', message: `Confidence ${c.confidenceScore} below threshold 0.4` }
        : null,
  },
];

export function evaluatePolicy(
  change: ProposedChange,
  extraRules: PolicyRule[] = []
): { allowed: boolean; violations: PolicyViolation[] } {
  const rules = [...defaultRules, ...extraRules];
  const violations: PolicyViolation[] = [];

  for (const rule of rules) {
    const v = rule.evaluate(change);
    if (v) violations.push(v);
  }

  const blocked = violations.some((v) => v.severity === 'block');
  return { allowed: !blocked, violations };
}

export function validateRepair(repair: ProposedChange): void {
  const result = evaluatePolicy(repair);
  if (!result.allowed) {
    const msgs = result.violations.map((v) => `[${v.ruleId}] ${v.message}`).join('; ');
    throw new Error(`Policy Enforcement Agent blocked repair: ${msgs}`);
  }
}
