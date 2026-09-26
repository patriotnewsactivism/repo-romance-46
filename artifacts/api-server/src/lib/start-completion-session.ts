import type { SupabaseClient } from "@supabase/supabase-js";
import { loadBaselineInvestmentMetrics } from "./post-run-evolution";
import { scheduleCompletionSession, type CompletionWorkerMode } from "./completion-session-scheduler";

export interface StartCompletionSessionInput {
  repo: string;
  analysisId: string;
  itemRank?: number;
  nextSteps?: string[];
  targetCompletionPct?: number;
  targetReadinessPct?: number;
  maxIterations?: number;
  maxNoProgressIterations?: number;
  maxEstimatedCostUsd?: number;
  /** Finish Portfolio reuses an active session; the one-repo UI 409s instead. */
  reuseExisting?: boolean;
}

export interface StartCompletionSessionResult {
  session: Record<string, unknown>;
  baseline: { completionPct: number; productionReadinessPct: number };
  scheduled: boolean;
  workerMode: CompletionWorkerMode | null;
  reusedExisting: boolean;
  alreadyComplete: boolean;
}

/**
 * A failed dispatch must not leave an active session that nothing will claim.
 * Portfolio startup uses reuseExisting and does not reschedule on its own, and
 * the one-repo UI only retries sessions that are still active.
 */
async function scheduleOrBlock(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
): Promise<CompletionWorkerMode> {
  try {
    return await scheduleCompletionSession(supabase, userId, sessionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const now = new Date().toISOString();
    await supabase
      .from("repo_completion_sessions")
      .update({
        status: "blocked",
        phase: "blocked",
        stop_reason: `Completion worker dispatch failed: ${message}`.slice(0, 500),
        worker_token: null,
        lease_expires_at: null,
        heartbeat_at: null,
        completed_at: now,
        updated_at: now,
      })
      .eq("id", sessionId)
      .eq("user_id", userId)
      .eq("status", "active");
    await supabase.from("repo_completion_session_events").insert({
      session_id: sessionId,
      user_id: userId,
      iteration: null,
      kind: "worker_dispatch_failed",
      status: "error",
      message: `Completion worker dispatch failed; the session was marked blocked so it cannot stay active without a worker. ${message}`.slice(0, 1000),
      metadata: { scheduled: false },
    });
    throw error;
  }
}

export async function startCompletionSession(
  supabase: SupabaseClient,
  userId: string,
  input: StartCompletionSessionInput,
): Promise<StartCompletionSessionResult> {
  const existing = await supabase
    .from("repo_completion_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("repo", input.repo)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error) throw new Error(`Failed to check active completion sessions: ${existing.error.message}`);
  if (existing.data) {
    if (!input.reuseExisting) {
      throw Object.assign(
        new Error(`An active finish-until-target session already exists for ${input.repo}. Resume or cancel that session before starting another.`),
        { status: 409 },
      );
    }
    const workerMode = await scheduleOrBlock(supabase, userId, String((existing.data as { id: string }).id));
    return {
      session: existing.data as Record<string, unknown>,
      baseline: {
        completionPct: Number((existing.data as Record<string, unknown>).last_completion_pct ?? 0),
        productionReadinessPct: Number((existing.data as Record<string, unknown>).last_readiness_pct ?? 0),
      },
      scheduled: true,
      workerMode,
      reusedExisting: true,
      alreadyComplete: false,
    };
  }

  const baseline = await loadBaselineInvestmentMetrics(supabase, userId, input.analysisId, input.repo);
  if (!baseline || baseline.completionPct === null || baseline.productionReadinessPct === null) {
    throw Object.assign(
      new Error("Finish-until-target requires a current Investment Intelligence analysis with measured completion and production-readiness scores for this repository."),
      { status: 409 },
    );
  }

  const targetCompletionPct = input.targetCompletionPct ?? 95;
  const targetReadinessPct = input.targetReadinessPct ?? 90;
  const maxIterations = input.maxIterations ?? 5;
  const maxNoProgressIterations = input.maxNoProgressIterations ?? 2;
  const now = new Date().toISOString();
  const alreadyComplete =
    baseline.completionPct >= targetCompletionPct && baseline.productionReadinessPct >= targetReadinessPct;

  const { data: session, error } = await supabase
    .from("repo_completion_sessions")
    .insert({
      user_id: userId,
      repo: input.repo,
      analysis_id: input.analysisId,
      status: alreadyComplete ? "succeeded" : "active",
      phase: alreadyComplete ? "complete" : "queued",
      target_completion_pct: targetCompletionPct,
      target_readiness_pct: targetReadinessPct,
      max_iterations: maxIterations,
      max_no_progress_iterations: maxNoProgressIterations,
      iteration_count: 0,
      no_progress_count: 0,
      last_completion_pct: baseline.completionPct,
      last_readiness_pct: baseline.productionReadinessPct,
      max_estimated_cost_usd: input.maxEstimatedCostUsd ?? null,
      estimated_cost_used_usd: 0,
      requested_next_steps: input.nextSteps ?? [],
      item_rank: input.itemRank ?? null,
      autonomy_acknowledged_at: now,
      last_progress_at: now,
      stop_reason: alreadyComplete
        ? `Targets were already satisfied at session creation: completion ${baseline.completionPct}% and readiness ${baseline.productionReadinessPct}%.`
        : null,
      completed_at: alreadyComplete ? now : null,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();
  if (error || !session) throw new Error(`Failed to create completion session: ${error?.message ?? "unknown database error"}`);

  await supabase.from("repo_completion_session_events").insert({
    session_id: (session as { id: string }).id,
    user_id: userId,
    iteration: null,
    kind: "session_created",
    status: alreadyComplete ? "success" : "info",
    message: alreadyComplete
      ? "Repository already meets the requested completion/readiness targets; no branch write was necessary."
      : `Bounded finish-until-target session created. It may perform up to ${maxIterations} exact-plan iterations on one draft PR, with bounded CI repair, no-progress stopping, and automatic merge disabled.`,
    metadata: {
      baseline,
      targets: { completionPct: targetCompletionPct, readinessPct: targetReadinessPct },
      maxIterations,
      maxNoProgressIterations,
      maxEstimatedCostUsd: input.maxEstimatedCostUsd ?? null,
      automaticMerge: false,
    },
  });

  const workerMode = alreadyComplete ? null : await scheduleOrBlock(supabase, userId, String((session as { id: string }).id));
  return {
    session: session as Record<string, unknown>,
    baseline: {
      completionPct: Number(baseline.completionPct),
      productionReadinessPct: Number(baseline.productionReadinessPct),
    },
    scheduled: !alreadyComplete,
    workerMode,
    reusedExisting: false,
    alreadyComplete,
  };
}
