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

function buildGuidance(history: RepoLearningEntry[], crossRepo: AdaptiveLearningContext["crossRepoPatterns"]): string[] {
  const guidance: string[] = [];
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

  return guidance.slice(0, 10);
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

  return {
    repo,
    hasHistory: history.length > 0,
    recentSuccesses: history.filter((entry) => entry.outcome === "success").slice(-6).reverse(),
    recentFailures: history.filter((entry) => entry.outcome === "failure").slice(-6).reverse(),
    patterns,
    crossRepoPatterns,
    promptGuidance: buildGuidance(history, crossRepoPatterns),
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
  occurrences.push({ repo, timestamp: entry.timestamp, outcome: entry.outcome });
  const successful = occurrences.filter((item) => (item as Record<string, unknown>).outcome === "success").length;
  const confidence = Math.round((successful / Math.max(1, occurrences.length)) * 100);
  const recommendation =
    confidence >= 70
      ? `Prefer ${key} when repository evidence matches; ${successful}/${occurrences.length} recorded outcomes succeeded.`
      : confidence <= 35
        ? `Treat ${key} as high-risk; only ${successful}/${occurrences.length} recorded outcomes succeeded.`
        : `Use ${key} selectively and verify with CI; ${successful}/${occurrences.length} recorded outcomes succeeded.`;

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
