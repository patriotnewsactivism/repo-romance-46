/**
 * Deterministic value-improvement suggestions from completion/readiness gaps.
 *
 * These are not market claims. They translate measured missing work into
 * concrete, ranked suggestions so the product can always surface an abundance
 * of evidence-backed next actions even when an LLM returns thin prose.
 */

import type {
  CompletionScorecard,
  ReadinessScorecard,
  ScoreDimensionKey,
} from "./types";

export interface ValueImprovementSuggestion {
  id: string;
  title: string;
  category: ScoreDimensionKey | "readiness" | "commercialization";
  problem: string;
  action: string;
  whyItRaisesValue: string;
  /** Expected completion-point lift if the gap is closed (planning estimate). */
  estimatedCompletionLiftPts: number;
  /** 1–5 planning estimate of value impact. */
  valueImpact: number;
  effort: 1 | 2 | 3 | 4 | 5;
  priority: number;
  acceptanceHint: string;
}

const CATEGORY_VALUE_IMPACT: Partial<Record<ScoreDimensionKey, number>> = {
  "core-functionality": 5,
  "auth-security": 5,
  deployment: 4,
  testing: 4,
  "backend-api": 4,
  "frontend-ux": 4,
  "data-persistence": 4,
  "build-health": 3,
  observability: 3,
  "product-definition": 3,
  documentation: 2,
  "production-readiness": 5,
};

const CATEGORY_EFFORT: Partial<Record<ScoreDimensionKey, 1 | 2 | 3 | 4 | 5>> = {
  documentation: 2,
  observability: 2,
  "product-definition": 2,
  "build-health": 3,
  testing: 3,
  "frontend-ux": 3,
  "backend-api": 4,
  "data-persistence": 4,
  "auth-security": 4,
  deployment: 4,
  "core-functionality": 5,
  "production-readiness": 4,
};

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function effortForLostPoints(lostPoints: number, base: 1 | 2 | 3 | 4 | 5): 1 | 2 | 3 | 4 | 5 {
  if (lostPoints >= 12) return Math.min(5, base + 1) as 1 | 2 | 3 | 4 | 5;
  if (lostPoints <= 2) return Math.max(1, base - 1) as 1 | 2 | 3 | 4 | 5;
  return base;
}

/**
 * Turn a completion scorecard (and optional readiness blockers) into ranked
 * value-improvement suggestions. Always returns suggestions when gaps exist.
 */
export function suggestValueImprovements(input: {
  repo: string;
  completion: CompletionScorecard;
  readiness?: ReadinessScorecard | null;
  /** Optional analysis next-steps to merge without inventing market facts. */
  analysisNextSteps?: string[];
  maxSuggestions?: number;
}): ValueImprovementSuggestion[] {
  const max = Math.max(5, Math.min(40, input.maxSuggestions ?? 20));
  const suggestions: ValueImprovementSuggestion[] = [];

  for (const gap of input.completion.missingBreakdown) {
    const reasons = gap.reasons.length > 0 ? gap.reasons : [`Close the ${gap.label} gap`];
    for (const reason of reasons.slice(0, 3)) {
      const valueImpact = CATEGORY_VALUE_IMPACT[gap.key] ?? 3;
      const baseEffort = CATEGORY_EFFORT[gap.key] ?? 3;
      const effort = effortForLostPoints(gap.lostPoints, baseEffort);
      const lift = Math.round(Math.min(gap.lostPoints, gap.lostPoints / Math.max(1, reasons.length)) * 10) / 10;
      suggestions.push({
        id: `${slug(input.repo)}-${gap.key}-${slug(reason)}`,
        title: `Raise ${gap.label}`,
        category: gap.key,
        problem: reason,
        action: `Address: ${reason}. Verify with the acceptance check for this dimension before claiming completion.`,
        whyItRaisesValue: `Closing this gap recovers ~${lift} completion points in ${gap.label}, which raises replacement-cost present value and commercialization readiness.`,
        estimatedCompletionLiftPts: lift,
        valueImpact,
        effort,
        priority: Math.round(gap.lostPoints * valueImpact * 10) / 10,
        acceptanceHint: `${gap.label} earned points increase after the change is verified (build/tests/deploy as applicable).`,
      });
    }
  }

  if (input.readiness) {
    for (const blocker of input.readiness.blockers.slice(0, 8)) {
      suggestions.push({
        id: `${slug(input.repo)}-readiness-${slug(blocker)}`,
        title: "Clear production-readiness blocker",
        category: "readiness",
        problem: blocker,
        action: `Resolve readiness blocker: ${blocker}`,
        whyItRaisesValue:
          "Production-readiness blockers suppress commercial confidence and keep potential value discounted.",
        estimatedCompletionLiftPts: 1.5,
        valueImpact: 5,
        effort: 3,
        priority: 40,
        acceptanceHint: "Readiness check flips to passed with durable evidence (CI, deploy, auth, secrets).",
      });
    }

    for (const check of input.readiness.checks.filter((c) => !c.passed).slice(0, 6)) {
      if (input.readiness.blockers.some((b) => b.includes(check.label) || check.detail.includes(b))) {
        continue;
      }
      suggestions.push({
        id: `${slug(input.repo)}-check-${slug(check.key)}`,
        title: `Pass readiness: ${check.label}`,
        category: "readiness",
        problem: check.detail || `${check.label} is not satisfied`,
        action: `Make readiness check "${check.label}" pass.`,
        whyItRaisesValue: check.blocking
          ? "Blocking readiness gaps prevent honest shippable valuation."
          : "Passing optional readiness checks improves evidence confidence and buyer trust.",
        estimatedCompletionLiftPts: check.blocking ? 2 : 1,
        valueImpact: check.blocking ? 5 : 3,
        effort: check.blocking ? 3 : 2,
        priority: check.blocking ? 35 : 18,
        acceptanceHint: check.detail || `${check.label} must pass`,
      });
    }
  }

  if (input.completion.evidenceCeiling != null && input.completion.evidenceCeiling < 95) {
    suggestions.push({
      id: `${slug(input.repo)}-evidence-ceiling`,
      title: "Unlock evidence ceiling with verified CI/deploy/smoke",
      category: "production-readiness",
      problem: `Completion is capped at ${input.completion.evidenceCeiling}% without stronger acceptance evidence.`,
      action:
        "Ensure build, tests, deployment, and critical-journey smoke verification produce durable evidence so completion can rise honestly.",
      whyItRaisesValue:
        "Without acceptance evidence, present value stays conservatively capped even when source looks complete.",
      estimatedCompletionLiftPts: Math.max(3, 95 - input.completion.evidenceCeiling),
      valueImpact: 5,
      effort: 3,
      priority: 45,
      acceptanceHint: "buildPassed + testsPassed + deployVerified + smoke/critical journey evidence",
    });
  }

  for (const step of input.analysisNextSteps ?? []) {
    const trimmed = step.trim();
    if (!trimmed) continue;
    suggestions.push({
      id: `${slug(input.repo)}-analysis-${slug(trimmed)}`,
      title: "Execute analysis completion step",
      category: "commercialization",
      problem: trimmed,
      action: trimmed,
      whyItRaisesValue:
        "Portfolio analysis identified this as part of the path to a finishable, sellable product.",
      estimatedCompletionLiftPts: 2,
      valueImpact: 4,
      effort: 3,
      priority: 22,
      acceptanceHint: "Step completed with objective verification named in the step text when present.",
    });
  }

  const deduped: ValueImprovementSuggestion[] = [];
  const seen = new Set<string>();
  for (const suggestion of suggestions.sort((a, b) => b.priority - a.priority || b.valueImpact - a.valueImpact)) {
    const key = `${suggestion.category}:${suggestion.problem.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(suggestion);
    if (deduped.length >= max) break;
  }

  return deduped;
}

/** Flatten suggestions into executable next-step strings for finish controllers. */
export function valueImprovementsToNextSteps(
  suggestions: ValueImprovementSuggestion[],
  limit = 16,
): string[] {
  return suggestions.slice(0, limit).map((s) => {
    const lift = s.estimatedCompletionLiftPts > 0 ? ` (~+${s.estimatedCompletionLiftPts} completion pts)` : "";
    return `${s.action}${lift}. Acceptance: ${s.acceptanceHint}`;
  });
}
