// Persistent Learning â logs what worked, what broke, and what took longer
// than expected per repo AND cross-repo patterns.
// Before suggesting a fix, checks history to avoid re-suggesting failures.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

// âââ Types âââââââââââââââââââââââââââââââââââââââââââââââââââââ

export interface LearningEntry {
  action: string;
  outcome: "success" | "failure" | "partial";
  duration_ms: number;
  details: string;
  files_affected: string[];
  error_message?: string;
  fix_pattern?: string;
  timestamp: string;
}

export interface CrossRepoPattern {
  pattern: string;
  category: string;
  occurrences: { repo: string; timestamp: string; outcome: string }[];
  recommendation: string;
  confidence: number;
}

// âââ Supabase type helpers âââââââââââââââââââââââââââââââââââââ

type SupabaseOps = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (
        c: string,
        v: string,
      ) => {
        eq?: (
          c: string,
          v: string,
        ) => {
          maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
          order?: (
            c: string,
            o: { ascending: boolean },
          ) => {
            limit?: (n: number) => Promise<{ data: unknown; error: unknown }>;
          } & Promise<{ data: unknown; error: unknown }>;
        };
        maybeSingle?: () => Promise<{ data: unknown; error: unknown }>;
        order?: (
          c: string,
          o: { ascending: boolean },
        ) => {
          limit?: (n: number) => Promise<{ data: unknown; error: unknown }>;
        } & Promise<{ data: unknown; error: unknown }>;
      };
    };
    insert: (v: Record<string, unknown>) => {
      select?: (c: string) => { single: () => Promise<{ data: unknown; error: unknown }> };
    } & Promise<{ data: unknown; error: unknown }>;
    update: (v: Record<string, unknown>) => {
      eq: (c: string, v: string) => {
        eq?: (c: string, v: string) => Promise<{ data: unknown; error: unknown }>;
      } & Promise<{ data: unknown; error: unknown }>;
    };
    upsert: (v: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  };
};

// âââ Log a learning entry for a specific repo ââââââââââââââââââ

export const logRepoLearning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (d: {
      repo: string;
      entry: LearningEntry;
    }) =>
      z
        .object({
          repo: z.string(),
          entry: z.object({
            action: z.string(),
            outcome: z.enum(["success", "failure", "partial"]),
            duration_ms: z.number(),
            details: z.string(),
            files_affected: z.array(z.string()),
            error_message: z.string().optional(),
            fix_pattern: z.string().optional(),
            timestamp: z.string(),
          }),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as unknown as SupabaseOps;

    // Get existing learning record for this repo
    const { data: existing } = await supabase
      .from("repo_learnings")
      .select("id, history, patterns_detected")
      .eq("user_id", context.userId)
      .eq!("repo", data.repo)
      .maybeSingle!();

    const record = existing as {
      id: string;
      history: LearningEntry[];
      patterns_detected: string[];
    } | null;

    const history = record?.history ?? [];
    history.push(data.entry);

    // Cap history at 100 entries per repo
    const trimmedHistory = history.slice(-100);

    // Detect recurring patterns
    const patternsDetected = detectPatterns(trimmedHistory);

    if (record) {
      await supabase
        .from("repo_learnings")
        .update({
          history: trimmedHistory as unknown as Json,
          patterns_detected: patternsDetected,
          updated_at: new Date().toISOString(),
        })
        .eq("id", record.id);
    } else {
      await supabase.from("repo_learnings").insert({
        user_id: context.userId,
        repo: data.repo,
        history: trimmedHistory as unknown as Json,
        patterns_detected: patternsDetected,
        updated_at: new Date().toISOString(),
      });
    }

    // Also update cross-repo patterns
    if (data.entry.fix_pattern) {
      await updateCrossRepoPattern(
        supabase,
        context.userId,
        data.repo,
        data.entry.fix_pattern,
        data.entry.outcome,
        data.entry.action,
      );
    }

    return { ok: true, patternsDetected };
  });

// âââ Get learning history for a repo âââââââââââââââââââââââââââ

export const getRepoLearnings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { repo: string }) => z.object({ repo: z.string() }).parse(d))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as unknown as SupabaseOps;
    const { data: record } = await supabase
      .from("repo_learnings")
      .select("*")
      .eq("user_id", context.userId)
      .eq!("repo", data.repo)
      .maybeSingle!();

    if (!record) {
      return {
        repo: data.repo,
        history: [],
        patterns_detected: [],
        last_analysis: null,
        has_history: false,
      };
    }

    const r = record as {
      history: LearningEntry[];
      patterns_detected: string[];
      last_analysis: unknown;
    };

    return {
      repo: data.repo,
      history: r.history ?? [],
      patterns_detected: r.patterns_detected ?? [],
      last_analysis: r.last_analysis,
      has_history: true,
    };
  });

// âââ Check if a fix pattern has been tried before ââââââââââââââ

export const checkFixHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (d: { repo: string; fixPattern: string }) =>
      z.object({ repo: z.string(), fixPattern: z.string() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as unknown as SupabaseOps;

    // Check repo-specific history
    const { data: record } = await supabase
      .from("repo_learnings")
      .select("history")
      .eq("user_id", context.userId)
      .eq!("repo", data.repo)
      .maybeSingle!();

    const history = (record as { history: LearningEntry[] } | null)?.history ?? [];

    const previousAttempts = history.filter(
      (h) =>
        h.fix_pattern &&
        h.fix_pattern.toLowerCase().includes(data.fixPattern.toLowerCase()),
    );

    const failures = previousAttempts.filter((h) => h.outcome === "failure");

    // Check cross-repo patterns
    const { data: crossRepo } = await supabase
      .from("cross_repo_patterns")
      .select("*")
      .eq("user_id", context.userId)
      .eq!("pattern", data.fixPattern)
      .maybeSingle!();

    const crossRepoData = crossRepo as CrossRepoPattern | null;

    return {
      hasBeenTried: previousAttempts.length > 0,
      previousAttempts: previousAttempts.length,
      failures: failures.length,
      lastAttempt: previousAttempts.length > 0 ? previousAttempts[previousAttempts.length - 1] : null,
      crossRepoInsight: crossRepoData
        ? {
            pattern: crossRepoData.pattern,
            totalOccurrences: crossRepoData.occurrences.length,
            recommendation: crossRepoData.recommendation,
            confidence: crossRepoData.confidence,
          }
        : null,
      warning:
        failures.length > 0
          ? `â ï¸ This fix pattern has failed ${failures.length} time(s) on this repo. ` +
            `Last failure: "${failures[failures.length - 1].error_message || "unknown error"}". ` +
            `Consider adjusting the approach.`
          : null,
    };
  });

// âââ Get cross-repo patterns ââââââââââââââââââââââââââââââââââ

export const getCrossRepoPatterns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as unknown as SupabaseOps;

    const { data: patterns } = await supabase
      .from("cross_repo_patterns")
      .select("*")
      .eq("user_id", context.userId)
      .order!("confidence", { ascending: false })
      .limit!(20);

    return (patterns as CrossRepoPattern[] | null) ?? [];
  });

// âââ Internal: detect recurring patterns in a repo's history âââ

function detectPatterns(history: LearningEntry[]): string[] {
  const patterns: string[] = [];

  // Group failures by action
  const failuresByAction = new Map<string, LearningEntry[]>();
  for (const entry of history) {
    if (entry.outcome === "failure") {
      const group = failuresByAction.get(entry.action) ?? [];
      group.push(entry);
      failuresByAction.set(entry.action, group);
    }
  }

  // Flag recurring failures (same action fails 2+ times)
  for (const [action, failures] of failuresByAction) {
    if (failures.length >= 2) {
      patterns.push(
        `Recurring failure: "${action}" has failed ${failures.length} times â ` +
          `investigate root cause before retrying`,
      );
    }
  }

  // Flag slow operations (> 60s duration)
  const slowOps = history.filter((h) => h.duration_ms > 60000 && h.outcome === "success");
  if (slowOps.length >= 3) {
    const avgDuration = Math.round(
      slowOps.reduce((sum, h) => sum + h.duration_ms, 0) / slowOps.length / 1000,
    );
    patterns.push(
      `Performance pattern: ${slowOps.length} operations took >${avgDuration}s average â ` +
        `consider splitting into smaller chunks`,
    );
  }

  // Flag commonly affected files
  const fileCounts = new Map<string, number>();
  for (const entry of history) {
    for (const file of entry.files_affected) {
      fileCounts.set(file, (fileCounts.get(file) ?? 0) + 1);
    }
  }
  for (const [file, count] of fileCounts) {
    if (count >= 4) {
      patterns.push(`Hot file: "${file}" has been changed ${count} times â may need stabilization`);
    }
  }

  return patterns;
}

// âââ Internal: update cross-repo pattern log âââââââââââââââââââ

async function updateCrossRepoPattern(
  supabase: SupabaseOps,
  userId: string,
  repo: string,
  pattern: string,
  outcome: string,
  action: string,
): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from("cross_repo_patterns")
      .select("*")
      .eq("user_id", userId)
      .eq!("pattern", pattern)
      .maybeSingle!();

    const record = existing as {
      id: string;
      occurrences: { repo: string; timestamp: string; outcome: string }[];
      confidence: number;
    } | null;

    const occurrence = {
      repo,
      timestamp: new Date().toISOString(),
      outcome,
    };

    if (record) {
      const occurrences = [...record.occurrences, occurrence].slice(-50);
      const successRate =
        occurrences.filter((o) => o.outcome === "success").length / occurrences.length;
      const confidence = Math.round(successRate * 100);

      const failedRepos = new Set(
        occurrences.filter((o) => o.outcome === "failure").map((o) => o.repo),
      );
      const successRepos = new Set(
        occurrences.filter((o) => o.outcome === "success").map((o) => o.repo),
      );

      let recommendation: string;
      if (confidence < 30) {
        recommendation = `This pattern fails more often than it succeeds (${confidence}% success). Consider alternative approaches.`;
      } else if (confidence < 70) {
        recommendation = `Mixed results (${confidence}% success). Works on some repos but not others. Check for repo-specific conditions.`;
      } else {
        recommendation = `Reliable pattern (${confidence}% success across ${successRepos.size} repos). Safe to reuse.`;
      }

      if (failedRepos.size >= 3) {
        recommendation += ` â ï¸ Has failed on ${failedRepos.size} different repos â may indicate a systemic issue.`;
      }

      await supabase
        .from("cross_repo_patterns")
        .update({
          occurrences: occurrences as unknown as Json,
          confidence,
          recommendation,
          category: action,
          updated_at: new Date().toISOString(),
        })
        .eq("id", record.id);
    } else {
      await supabase.from("cross_repo_patterns").insert({
        user_id: userId,
        pattern,
        category: action,
        occurrences: [occurrence] as unknown as Json,
        confidence: outcome === "success" ? 100 : 0,
        recommendation:
          outcome === "success"
            ? "First occurrence â worked. Will track across repos."
            : "First occurrence â failed. Will track to see if this is a recurring issue.",
        updated_at: new Date().toISOString(),
      });
    }
  } catch (e) {
    // Learning log is best-effort â never fail the main operation
    console.warn("[learning-log] Failed to update cross-repo pattern:", e);
  }
}

// âââ Log helper for use in repo-finisher âââââââââââââââââââââââ

/**
 * Convenience function to log a learning entry from other server functions.
 * Call this after a finishRepo, iterativeFinish, or similar operation.
 */
export async function logLearningEntry(
  supabase: unknown,
  userId: string,
  repo: string,
  entry: LearningEntry,
): Promise<void> {
  try {
    const sb = supabase as SupabaseOps;

    const { data: existing } = await sb
      .from("repo_learnings")
      .select("id, history")
      .eq("user_id", userId)
      .eq!("repo", repo)
      .maybeSingle!();

    const record = existing as { id: string; history: LearningEntry[] } | null;
    const history = [...(record?.history ?? []), entry].slice(-100);

    if (record) {
      await sb
        .from("repo_learnings")
        .update({
          history: history as unknown as Json,
          patterns_detected: detectPatterns(history),
          updated_at: new Date().toISOString(),
        })
        .eq("id", record.id);
    } else {
      await sb.from("repo_learnings").insert({
        user_id: userId,
        repo,
        history: history as unknown as Json,
        patterns_detected: detectPatterns(history),
        updated_at: new Date().toISOString(),
      });
    }

    // Update cross-repo patterns if applicable
    if (entry.fix_pattern) {
      await updateCrossRepoPattern(sb, userId, repo, entry.fix_pattern, entry.outcome, entry.action);
    }
  } catch (e) {
    console.warn("[learning-log] Failed to log entry:", e);
  }
}
