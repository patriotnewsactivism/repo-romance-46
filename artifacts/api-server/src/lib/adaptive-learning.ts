import type { SupabaseClient } from "@supabase/supabase-js";

export type LearningOutcome = "success" | "failure" | "partial" | "observation";

export interface RepoLearningEntry {
  action: string;
  outcome: LearningOutcome;
  duration_ms: number;
  details: string;
  files_affected: string[];
  error_message?: string;
  fix_pattern?: string;
  prompt_version?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface StrategyPerformance {
  pattern: string;
  samples: number;
  successes: number;
  failures: number;
  averageOutcomeScore: number | null;
  averageCompletionDelta: number | null;
  averageReadinessDelta: number | null;
}

export interface AdaptiveLearningContext {
  repo: string;
  hasHistory: boolean;
  recentSuccesses: RepoLearningEntry[];
  recentFailures: RepoLearningEntry[];
  patterns: string[];
  crossRepoPatterns: Array<{
    pattern: string;
    confidence: number;
    recommendation: string;
  }>;
  strategyPerformance: StrategyPerformance[];
  promptGuidance: string[];
}

function asEntries(value: unknown): RepoLearningEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is RepoLearningEntry => {
    if (!entry || typeof entry !== "object") return false;
    const record = entry as Record<string, unknown>;
    return typeof record.action === "string" && typeof record.outcome === "string";
  });
}

function patternKey(entry: RepoLearningEntry): string | null {
  const explicit = entry.fix_pattern?.trim().toLowerCase();
  if (explicit) return explicit.slice(0, 160);
  if (entry.action === "completion_run") return "completion-run";
  if (entry.action === "investment_intelligence") return "investment-intelligence";
  return null;
}

function metadataNumber(entry: RepoLearningEntry, key: string): number | null {
  const value = entry.metadata?.[key];
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function summarizeStrategyPerformance(history: RepoLearningEntry[]): StrategyPerformance[] {
  const groups = new Map<string, RepoLearningEntry[]>();
  for (const entry of history) {
    const key = patternKey(entry);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }

  const average = (values: Array<number | null>): number | null => {
    const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
    if (finite.length === 0) return null;
    return Math.round((finite.reduce((sum, value) => sum + value, 0) / finite.length) * 10) / 10;
  };

  return [...groups.entries()]
    .map(([pattern, entries]) => ({
      pattern,
      samples: entries.length,
      successes: entries.filter((entry) => entry.outcome === "success").length,
      failures: entries.filter((entry) => entry.outcome === "failure").length,
      averageOutcomeScore: average(entries.map((entry) => metadataNumber(entry, "outcome_score"))),
      averageCompletionDelta: average(entries.map((entry) => metadataNumber(entry, "completion_delta"))),
      averageReadinessDelta: average(entries.map((entry) => metadataNumber(entry, "readiness_delta"))),
    }))
    .sort((a, b) => {
      const aScore = a.averageOutcomeScore ?? -1;
      const bScore = b.averageOutcomeScore ?? -1;
      return bScore - aScore || b.samples - a.samples || a.pattern.localeCompare(b.pattern);
    })
    .slice(0, 20);
}

function detectPatterns(history: RepoLearningEntry[]): string[] {
  const totals = new Map<string, { success: number; failure: number; partial: number }>();
  for (const entry of history) {
    const key = patternKey(entry);
    if (!key) continue;
    const current = totals.get(key) ?? { success: 0, failure: 0, partial: 0 };
    if (entry.outcome === "success") current.success += 1;
    if (entry.outcome === "failure") current.failure += 1;
    if (entry.outcome === "partial") current.partial += 1;
    totals.set(key, current);
  }

  return [...totals.entries()]
    .filter(([, counts]) => counts.success + counts.failure + counts.partial >= 2)
    .sort((a, b) => {
      const aTotal = a[1].success + a[1].failure + a[1].partial;
      const bTotal = b[1].success + b[1].failure + b[1].partial;
      return bTotal - aTotal || a[0].localeCompare(b[0]);
    })
    .slice(0, 20)
    .map(([key]) => key);
}

function buildGuidance(
  history: RepoLearningEntry[],
  crossRepo: AdaptiveLearningContext["crossRepoPatterns"],
  strategyPerformance: StrategyPerformance[],
): string[] {
  const guidance: string[] = [];

  for (const strategy of strategyPerformance.filter((item) => item.samples >= 2).slice(0, 6)) {
    if (strategy.averageOutcomeScore !== null && strategy.averageOutcomeScore >= 75) {
      guidance.push(
        `Prefer '${strategy.pattern}' when the repository evidence fits: ${strategy.samples} measured run(s) average ${strategy.averageOutcomeScore}/100 outcome score${strategy.averageCompletionDelta === null ? "" : ` and ${strategy.averageCompletionDelta >= 0 ? "+" : ""}${strategy.averageCompletionDelta} completion points`}.`,
      );
    } else if (strategy.averageOutcomeScore !== null && strategy.averageOutcomeScore <= 40) {
      guidance.push(
        `Do not repeat '${strategy.pattern}' unchanged: ${strategy.samples} measured run(s) average only ${strategy.averageOutcomeScore}/100 outcome score${strategy.averageCompletionDelta === null ? "" : ` with ${strategy.averageCompletionDelta >= 0 ? "+" : ""}${strategy.averageCompletionDelta} completion points`}. Change the plan before using it again.`,
      );
    }
  }

  const grouped = new Map<string, RepoLearningEntry[]>();
  for (const entry of history) {
    const key = patternKey(entry);
    if (!key) continue;
    const group = grouped.get(key) ?? [];
    group.push(entry);
    grouped.set(key, group);
  }

  for (const [key, entries] of grouped.entries()) {
    const successes = entries.filter((entry) => entry.outcome === "success").length;
    const failures = entries.filter((entry) => entry.outcome === "failure").length;
    if (failures > successes) {
      const lastFailure = [...entries].reverse().find((entry) => entry.outcome === "failure");
      guidance.push(
        `Avoid repeating the '${key}' approach unchanged; it has ${failures} failure(s) vs ${successes} success(es).${lastFailure?.error_message ? ` Last failure: ${lastFailure.error_message.slice(0, 240)}` : ""}`,
      );
    } else if (successes >= 2) {
      guidance.push(`Prefer the proven '${key}' pattern when it fits; it succeeded ${successes} time(s) in prior runs.`);
    }
  }

  for (const pattern of crossRepo.filter((item) => item.confidence >= 60).slice(0, 5)) {
    guidance.push(`Cross-repo lesson (${pattern.confidence}% confidence): ${pattern.recommendation || pattern.pattern}`);
  }

  return [...new Set(guidance)].slice(0, 12);
}

export async function loadAdaptiveLearningContext(
  supabase: SupabaseClient,
  userId: string,
  repo: string,
): Promise<AdaptiveLearningContext> {
  const [{ data: learning, error: learningError }, { data: crossRepo, error: crossRepoError }] = await Promise.all([
    supabase
      .from("repo_learnings")
      .select("history, patterns_detected")
      .eq("user_id", userId)
      .eq("repo", repo)
      .maybeSingle(),
    supabase
      .from("cross_repo_patterns")
      .select("pattern, confidence, recommendation")
      .eq("user_id", userId)
      .order("confidence", { ascending: false })
      .limit(10),
  ]);

  // Learning is an enhancement, never a reason to block repository completion.
  if (learningError || crossRepoError) {
    return {
      repo,
      hasHistory: false,
      recentSuccesses: [],
      recentFailures: [],
      patterns: [],
      crossRepoPatterns: [],
      strategyPerformance: [],
      promptGuidance: [],
    };
  }

  const history = asEntries((learning as Record<string, unknown> | null)?.history);
  const patterns = Array.isArray((learning as Record<string, unknown> | null)?.patterns_detected)
    ? ((learning as Record<string, unknown>).patterns_detected as unknown[]).map(String)
    : [];
  const crossRepoPatterns = (crossRepo ?? []).map((row) => ({
    pattern: String((row as Record<string, unknown>).pattern || ""),
    confidence: Number((row as Record<string, unknown>).confidence || 0),
    recommendation: String((row as Record<string, unknown>).recommendation || ""),
  }));
  const strategyPerformance = summarizeStrategyPerformance(history);

  return {
    repo,
    hasHistory: history.length > 0,
    recentSuccesses: history.filter((entry) => entry.outcome === "success").slice(-6).reverse(),
    recentFailures: history.filter((entry) => entry.outcome === "failure").slice(-6).reverse(),
    patterns,
    crossRepoPatterns,
    strategyPerformance,
    promptGuidance: buildGuidance(history, crossRepoPatterns, strategyPerformance),
  };
}

async function updateCrossRepoPattern(
  supabase: SupabaseClient,
  userId: string,
  repo: string,
  entry: RepoLearningEntry,
) {
  const key = patternKey(entry);
  if (!key || entry.outcome === "observation") return;

  const { data: existing } = await supabase
    .from("cross_repo_patterns")
    .select("id, occurrences")
    .eq("user_id", userId)
    .eq("pattern", key)
    .maybeSingle();

  const current = existing as { id: string; occurrences: unknown } | null;
  const occurrences = Array.isArray(current?.occurrences) ? current.occurrences.slice(-49) : [];
  occurrences.push({
    repo,
    timestamp: entry.timestamp,
    outcome: entry.outcome,
    outcome_score: metadataNumber(entry, "outcome_score"),
    completion_delta: metadataNumber(entry, "completion_delta"),
    readiness_delta: metadataNumber(entry, "readiness_delta"),
    prompt_version: entry.prompt_version ?? null,
  });

  const successful = occurrences.filter((item) => (item as Record<string, unknown>).outcome === "success").length;
  const scored = occurrences
    .map((item) => {
      const value = (item as Record<string, unknown>).outcome_score;
      const number = typeof value === "number" ? value : Number(value);
      return Number.isFinite(number) ? number : null;
    })
    .filter((value): value is number => value !== null);
  const successRate = successful / Math.max(1, occurrences.length);
  const averageOutcomeScore = scored.length > 0
    ? scored.reduce((sum, value) => sum + value, 0) / scored.length
    : null;
  const confidence = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        averageOutcomeScore === null
          ? successRate * 100
          : successRate * 60 + averageOutcomeScore * 0.4,
      ),
    ),
  );
  const measuredSuffix = averageOutcomeScore === null
    ? ""
    : ` Average measured outcome score ${Math.round(averageOutcomeScore * 10) / 10}/100.`;
  const recommendation =
    confidence >= 70
      ? `Prefer ${key} when repository evidence matches; ${successful}/${occurrences.length} recorded outcomes succeeded.${measuredSuffix}`
      : confidence <= 35
        ? `Treat ${key} as high-risk; only ${successful}/${occurrences.length} recorded outcomes succeeded.${measuredSuffix}`
        : `Use ${key} selectively and verify with CI; ${successful}/${occurrences.length} recorded outcomes succeeded.${measuredSuffix}`;

  if (current) {
    await supabase
      .from("cross_repo_patterns")
      .update({ occurrences, confidence, recommendation, updated_at: new Date().toISOString() })
      .eq("id", current.id);
  } else {
    await supabase.from("cross_repo_patterns").insert({
      user_id: userId,
      pattern: key,
      category: "repo-finisher",
      occurrences,
      confidence,
      recommendation,
    });
  }
}

export async function recordRepoLearning(
  supabase: SupabaseClient,
  userId: string,
  repo: string,
  entry: RepoLearningEntry,
): Promise<void> {
  const { data: existing, error } = await supabase
    .from("repo_learnings")
    .select("id, history")
    .eq("user_id", userId)
    .eq("repo", repo)
    .maybeSingle();
  if (error) return;

  const row = existing as { id: string; history: unknown } | null;
  const history = asEntries(row?.history);
  history.push(entry);
  const trimmed = history.slice(-100);
  const values = {
    history: trimmed,
    patterns_detected: detectPatterns(trimmed),
    updated_at: new Date().toISOString(),
  };

  if (row) {
    await supabase.from("repo_learnings").update(values).eq("id", row.id);
  } else {
    await supabase.from("repo_learnings").insert({ user_id: userId, repo, ...values });
  }

  await updateCrossRepoPattern(supabase, userId, repo, entry);
}
