/**
 * Recommendation records and ranking.
 *
 * A recommendation the user cannot evaluate is not a recommendation, so the
 * schema makes the expensive fields mandatory: what breaks, what it costs,
 * what it is worth, and — critically — the acceptance criteria that decide
 * whether the work actually landed. Scoring may only rise when those criteria
 * are met, which is why they are required here rather than optional prose.
 *
 * The ranking heuristic is RESTORED from
 * `.migration-backup/src/lib/scoring.ts` (`recommendationScore`), extended
 * with the confidence and impact fields this schema adds.
 */

import { z } from "zod";

export const recommendationKinds = ["finish", "fix", "harden", "test", "deploy", "repurpose", "document"] as const;
export type RecommendationKind = (typeof recommendationKinds)[number];

export const acceptanceCriterionSchema = z.object({
  description: z.string().min(1).max(300),
  /** How the criterion is checked — a command, an endpoint, a manual journey. */
  verification: z.enum(["test", "build", "typecheck", "lint", "endpoint", "migration", "deployment", "manual"]),
  /** The exact command or URL, when the verification is automated. */
  command: z.string().max(300).optional(),
});

export const recommendationSchema = z.object({
  id: z.string().min(1).max(120),
  repo: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  kind: z.enum(recommendationKinds),
  problem: z.string().min(1).max(2000),
  whyItMatters: z.string().min(1).max(2000),
  proposedSolution: z.string().min(1).max(4000),
  expectedBenefit: z.string().min(1).max(2000),
  /** 1 (trivial) – 5 (major project). */
  effort: z.number().int().min(1).max(5),
  estimatedHours: z.number().min(0).max(2000).nullable(),
  estimatedCostUsd: z.number().min(0).nullable(),
  /** 1 (safe) – 5 (could break production). */
  risk: z.number().int().min(1).max(5),
  /** 0–1 confidence that this is both correct and achievable. */
  confidence: z.number().min(0).max(1),
  /** Percentage points of completion this is expected to add. */
  completionImpact: z.number().min(-100).max(100),
  /** 1 (none) – 5 (transformative). */
  valueImpact: z.number().int().min(1).max(5),
  revenueImpact: z.number().int().min(1).max(5),
  securityImpact: z.number().int().min(1).max(5),
  /** 1 (no demand) – 5 (strong, evidenced demand). */
  marketPotential: z.number().int().min(1).max(5),
  filesAffected: z.array(z.string().max(400)).max(200),
  dependencies: z.array(z.string().max(200)).max(50),
  acceptanceCriteria: z.array(acceptanceCriterionSchema).min(1).max(20),
  /** 0–100 structural completion of the repo when this was produced. */
  completionPct: z.number().min(0).max(100).nullable().optional(),
  /** Prior failed attempts at this recommendation, fed back by outcome learning. */
  failurePenalty: z.number().min(0).max(10).optional(),
});

export type Recommendation = z.infer<typeof recommendationSchema>;

export type ApprovalDecision = "approve" | "reject" | "modify" | "defer";

export const approvalDecisionSchema = z.object({
  recommendationId: z.string().min(1),
  decision: z.enum(["approve", "reject", "modify", "defer"]),
  decidedBy: z.string().min(1),
  decidedAt: z.string().datetime(),
  note: z.string().max(2000).optional(),
});

export type RecommendationDecision = z.infer<typeof approvalDecisionSchema>;

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

/**
 * Ranking heuristic: market potential pulls up, effort pulls down, and work
 * that is nearly finished or fixes a security hole jumps the queue. Repeated
 * failures demote a recommendation so the system stops proposing what it has
 * already proved it cannot do.
 */
export function recommendationScore(r: Recommendation): number {
  let score = r.marketPotential * 2 - r.effort;

  const hours = r.estimatedHours;
  if (hours != null && Number.isFinite(hours) && hours > 0) {
    if (hours <= 8) score += 1.5;
    else if (hours <= 24) score += 1;
    else if (hours <= 40) score += 0.5;
    else if (hours > 120) score -= 1;
    else if (hours > 80) score -= 0.5;
  }

  const completion = r.completionPct;
  if (completion != null && Number.isFinite(completion)) {
    const c = clamp(completion, 0, 100);
    if (r.kind === "finish") {
      if (c >= 70) score += 1.5;
      else if (c >= 50) score += 0.75;
      else if (c < 20) score -= 1.25;
      else if (c < 35) score -= 0.5;
    } else if (r.kind === "repurpose" && c >= 60) {
      score += 0.5;
    }
  }

  // Security work outranks feature work at equal effort.
  if (r.securityImpact >= 4) score += 1.5;
  else if (r.securityImpact === 3) score += 0.5;

  // Believable work first: a high-value guess is still a guess.
  score += (r.confidence - 0.5) * 2;

  // Risky changes need a bigger payoff to be worth scheduling.
  score -= (r.risk - 1) * 0.25;

  score += (r.valueImpact - 3) * 0.3;
  score += (r.revenueImpact - 3) * 0.2;

  if (r.failurePenalty && r.failurePenalty > 0) score -= Math.min(3, r.failurePenalty * 0.75);

  if (r.kind === "finish") score += 0.15;
  else if (r.kind === "repurpose") score += 0.05;

  return Math.round(score * 1000) / 1000;
}

/** Stable ranking: equal scores keep their original order. */
export function rankRecommendations(items: Recommendation[]): Recommendation[] {
  return [...items]
    .map((item, originalIndex) => ({ item, originalIndex, score: recommendationScore(item) }))
    .sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex)
    .map((x) => x.item);
}

/**
 * Which recommendations may be approved in bulk as "all low-risk work".
 * Deliberately conservative: anything touching security or rated risky needs
 * an individual decision.
 */
export function lowRiskSubset(items: Recommendation[]): Recommendation[] {
  return items.filter((r) => r.risk <= 2 && r.effort <= 3 && r.confidence >= 0.6);
}
