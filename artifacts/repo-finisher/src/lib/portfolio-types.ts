export interface RepoSuggestion {
  id: string;
  title: string;
  action: string;
  why: string;
  effort: 1 | 2 | 3 | 4 | 5;
}

export interface PortfolioRankingItem {
  repo: string;
  rank: number;
  finishFirstScore: number;
  completionPct: number;
  productionReadinessPct: number;
  uniquenessPct?: number;
  presentValueUsd: { low: number; high: number };
  potentialValueUsd: { low: number; high: number };
  marketNeed: number;
  demand: number;
  competitivePressure: number;
  commercializationProbability: number;
  remainingWork: { hours: number; costUsd: { low: number; high: number } };
  evidenceConfidence: number;
  rationale: string[];
  evidence?: Array<{
    class: string;
    label: string;
    detail: string;
    source?: string;
  }>;
  details?: {
    kind?: string;
    title?: string;
    pitch?: string;
    analysisItemRank?: number | null;
    scoringPass?: string;
    language?: string | null;
    recommendedNextSteps?: string[];
    suggestions?: RepoSuggestion[];
    valueImprovements?: Array<{
      id: string;
      title: string;
      category: string;
      problem: string;
      action: string;
      whyItRaisesValue: string;
      estimatedCompletionLiftPts: number;
      valueImpact: number;
      effort: number;
      priority: number;
      acceptanceHint: string;
    }>;
    market?: { market_summary?: string; differentiation?: number };
    github?: { stars?: number; lastPush?: string; language?: string | null; topics?: string[] };
    completion?: { overall?: number; evidenceCeiling?: number | null };
  };
}

export interface PortfolioIntelligenceSnapshot {
  methodologyVersion: string;
  generatedAt: string;
  analysisId: string;
  ranking: PortfolioRankingItem[];
  errors: string[];
  portfolio: {
    reposRequested?: number;
    reposScored: number;
    reposInAnalysis?: number;
    reposDeferred?: number;
    valueImprovementsGenerated?: number;
    coveragePct?: number;
    partialFailures?: number;
    scope?: string;
    presentValueLow: number;
    presentValueHigh: number;
    potentialValueLow: number;
    potentialValueHigh: number;
    weightedCommercializationProbability: number;
  };
  recommendation: string;
  evidencePolicy: string;
}

const FALLBACKS: Array<Omit<RepoSuggestion, 'id'>> = [
  {
    title: 'Raise core product completeness',
    action: 'Implement the highest-value unfinished core user journey end-to-end and verify it with a smoke path.',
    why: 'Core journey gaps dominate completeness and keep commercialization probability discounted.',
    effort: 4,
  },
  {
    title: 'Add production readiness evidence',
    action: 'Wire CI build/tests and a deployable target with a post-deploy smoke check.',
    why: 'Without CI and deploy evidence, readiness and evidence ceilings suppress shippable valuation.',
    effort: 3,
  },
  {
    title: 'Document setup and verification',
    action: 'Add a concise README covering setup, architecture, deployment, and how to verify the critical path.',
    why: 'Clear operator docs reduce remaining work risk and raise buyer/operator confidence.',
    effort: 2,
  },
];

/** Normalize API or legacy ranking rows into a stable 3–10 suggestion list. */
export function resolveRepoSuggestions(item: PortfolioRankingItem): RepoSuggestion[] {
  const existing = item.details?.suggestions;
  if (Array.isArray(existing) && existing.length >= 3) {
    return existing.slice(0, 10);
  }

  const merged: RepoSuggestion[] = [];
  const seen = new Set<string>();
  const push = (suggestion: RepoSuggestion) => {
    const key = `${suggestion.title}:${suggestion.action}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(suggestion);
  };

  for (const suggestion of existing ?? []) {
    if (suggestion?.title && suggestion?.action) push(suggestion);
  }

  for (const improvement of item.details?.valueImprovements ?? []) {
    push({
      id: improvement.id,
      title: improvement.title,
      action: improvement.action,
      why: improvement.whyItRaisesValue,
      effort: Math.max(1, Math.min(5, Math.round(improvement.effort || 3))) as 1 | 2 | 3 | 4 | 5,
    });
  }

  for (const step of item.details?.recommendedNextSteps ?? []) {
    const trimmed = step.trim();
    if (!trimmed) continue;
    push({
      id: `${item.repo}-step-${merged.length + 1}`,
      title: trimmed.length > 72 ? `${trimmed.slice(0, 69)}…` : trimmed,
      action: trimmed,
      why: 'Portfolio analysis identified this as part of the finish path.',
      effort: 3,
    });
  }

  let fallbackIndex = 0;
  while (merged.length < 3 && fallbackIndex < FALLBACKS.length) {
    const fallback = FALLBACKS[fallbackIndex];
    fallbackIndex += 1;
    push({
      id: `${item.repo}-fallback-${fallbackIndex}`,
      ...fallback,
    });
  }

  return merged.slice(0, 10);
}

export function displayScore(value: number | undefined | null): number {
  if (value == null || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(100, Math.round(value)));
}

export function uniquenessScore(item: PortfolioRankingItem): number {
  if (typeof item.uniquenessPct === 'number' && Number.isFinite(item.uniquenessPct)) {
    return displayScore(item.uniquenessPct);
  }
  const differentiation = item.details?.market?.differentiation;
  if (typeof differentiation === 'number') {
    return displayScore(0.55 * differentiation + 0.45 * (100 - displayScore(item.competitivePressure)));
  }
  return displayScore(100 - displayScore(item.competitivePressure));
}
