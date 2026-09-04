import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runInBackground } from "./background-tasks";
import {
  executeContinuationPlan,
  executePreparedPlan,
  prepareFinishPlan,
  verifyCommitChecks,
  type PreparedFinishPlan,
  type VerificationResult,
} from "./repo-finisher-engine";
import { finalizeRunEvolution, loadBaselineInvestmentMetrics } from "./post-run-evolution";
import { evaluateCompletionSessionProgress } from "./completion-session-policy";
import { markLatestRepairVerified, tryScheduleCiRepair, type SelfHealingRun } from "./ci-repair";

const SESSION_LEASE_MS = 7 * 60_000;
const SESSION_WORK_BUDGET_MS = 5.5 * 60_000;
const MAX_REPAIR_ATTEMPTS = 3;
const SESSION_PROMPT_FALLBACK = "completion-session-v1-iterative";

type CompletionWorkerModeLike = "cloud-run-job" | "in-process" | "already-running";
type SessionStatus = "active" | "succeeded" | "blocked" | "budget_exhausted" | "cancelled";
type SessionPhase = "queued" | "planning" | "executing" | "verifying" | "repairing" | "rescoring" | "replanning" | "complete" | "blocked";

export interface CompletionSessionRow {
  id: string;
  user_id: string;
  repo: string;
  analysis_id: string;
  portfolio_run_id: string | null;
  status: SessionStatus;
  phase: SessionPhase;
  target_completion_pct: number;
  target_readiness_pct: number;
  max_iterations: number;
  iteration_count: number;
  no_progress_count: number;
  max_no_progress_iterations: number;
  last_completion_pct: number | null;
  last_readiness_pct: number | null;
  last_outcome_score: number | null;
  max_estimated_cost_usd: number | null;
  estimated_cost_used_usd: number;
  last_completion_run_id: string | null;
  requested_next_steps: unknown;
  item_rank: number | null;
  autonomy_acknowledged_at: string;
  branch_name: string | null;
  pr_number: number | null;
  pr_url: string | null;
  current_head_sha: string | null;
  worker_token: string | null;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
  last_progress_at: string | null;
  last_error: string | null;
  stop_reason: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface CompletionRunRow {
  id: string;
  user_id: string;
  repo: string;
  plan: PreparedFinishPlan;
  plan_hash: string;
  status: string;
  approved_hash: string | null;
  default_branch: string;
  base_sha: string;
  branch_name: string | null;
  head_sha: string | null;
  pr_number: number | null;
  pr_url: string | null;
  ci_status: string | null;
  error: string | null;
  auto_repair_enabled: boolean;
  repair_attempts: number;
  max_repair_attempts: number;
  analysis_id: string | null;
  item_rank: number | null;
  prompt_version: string | null;
  baseline_metrics: unknown;
  outcome_metrics: unknown;
  outcome_score: number | null;
  evaluated_at: string | null;
  created_at: string;
  updated_at: string;
}

function stringList(value: unknown, max = 25): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, max);
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function loadCompletionSession(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
): Promise<CompletionSessionRow> {
  const { data, error } = await supabase
    .from("repo_completion_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load completion session: ${error.message}`);
  if (!data) throw Object.assign(new Error("Completion session not found."), { status: 404 });
  return data as CompletionSessionRow;
}

async function loadCompletionRun(
  supabase: SupabaseClient,
  userId: string,
  runId: string,
): Promise<CompletionRunRow> {
  const { data, error } = await supabase
    .from("completion_runs")
    .select("*")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load session completion run: ${error.message}`);
  if (!data) throw new Error("Session completion run no longer exists.");
  return data as CompletionRunRow;
}

async function recordSessionEvent(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  iteration: number | null,
  kind: string,
  status: "info" | "success" | "warning" | "error",
  message: string,
  metadata: Record<string, unknown> = {},
) {
  const { error } = await supabase.from("repo_completion_session_events").insert({
    session_id: sessionId,
    user_id: userId,
    iteration,
    kind,
    status,
    message,
    metadata,
  });
  if (error) throw new Error(`Failed to record completion session event: ${error.message}`);
}

async function recordRunEvent(
  supabase: SupabaseClient,
  userId: string,
  runId: string,
  kind: string,
  status: "info" | "success" | "warning" | "error",
  message: string,
  metadata: Record<string, unknown> = {},
) {
  const { error } = await supabase.from("completion_events").insert({
    run_id: runId,
    user_id: userId,
    kind,
    status,
    message,
    metadata,
  });
  if (error) throw new Error(`Failed to record session run event: ${error.message}`);
}

async function claimSession(supabase: SupabaseClient, userId: string, sessionId: string) {
  const current = await loadCompletionSession(supabase, userId, sessionId);
  if (current.status !== "active") return null;
  const now = Date.now();
  if (current.worker_token && current.lease_expires_at && new Date(current.lease_expires_at).getTime() > now) return null;
  const token = randomUUID();
  const leaseExpiresAt = new Date(now + SESSION_LEASE_MS).toISOString();
  const nowIso = new Date(now).toISOString();
  const { data, error } = await supabase
    .from("repo_completion_sessions")
    .update({
      worker_token: token,
      lease_expires_at: leaseExpiresAt,
      heartbeat_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", sessionId)
    .eq("user_id", userId)
    .eq("status", "active")
    .eq("updated_at", current.updated_at)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`Failed to claim completion session: ${error.message}`);
  return data ? { token, session: data as CompletionSessionRow } : null;
}

async function heartbeat(supabase: SupabaseClient, userId: string, sessionId: string, token: string) {
  const now = new Date().toISOString();
  const leaseExpiresAt = new Date(Date.now() + SESSION_LEASE_MS).toISOString();
  await supabase
    .from("repo_completion_sessions")
    .update({ heartbeat_at: now, lease_expires_at: leaseExpiresAt, updated_at: now })
    .eq("id", sessionId)
    .eq("user_id", userId)
    .eq("worker_token", token);
}

async function releaseSession(supabase: SupabaseClient, userId: string, sessionId: string, token: string) {
  await supabase
    .from("repo_completion_sessions")
    .update({ worker_token: null, lease_expires_at: null, updated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("user_id", userId)
    .eq("worker_token", token);
}

async function blockSession(
  supabase: SupabaseClient,
  userId: string,
  session: CompletionSessionRow,
  reason: string,
  kind = "session_blocked",
) {
  const now = new Date().toISOString();
  await supabase
    .from("repo_completion_sessions")
    .update({
      status: "blocked",
      phase: "blocked",
      stop_reason: reason,
      last_error: reason,
      completed_at: now,
      updated_at: now,
    })
    .eq("id", session.id)
    .eq("user_id", userId)
    .eq("status", "active");
  await recordSessionEvent(supabase, userId, session.id, session.iteration_count || null, kind, "error", reason);
}

async function persistRunPlan(
  supabase: SupabaseClient,
  userId: string,
  session: CompletionSessionRow,
  iteration: number,
  plan: PreparedFinishPlan,
  planHash: string,
) {
  const now = new Date().toISOString();
  const baselineMetrics = await loadBaselineInvestmentMetrics(
    supabase,
    userId,
    session.analysis_id,
    session.repo,
  );
  const approvalPolicy = {
    mode: "bounded_completion_session",
    completionSessionId: session.id,
    iteration,
    acknowledgedAt: session.autonomy_acknowledged_at,
    targets: {
      completionPct: session.target_completion_pct,
      readinessPct: session.target_readiness_pct,
      maxIterations: session.max_iterations,
      maxNoProgressIterations: session.max_no_progress_iterations,
    },
    continuationBranch: session.branch_name,
    automaticMerge: false,
    draftPullRequestOnly: true,
    maxRepairAttempts: MAX_REPAIR_ATTEMPTS,
  };
  const promptVersion = plan.reasoning?.promptVersion ?? SESSION_PROMPT_FALLBACK;
  const { data: run, error } = await supabase
    .from("completion_runs")
    .insert({
      user_id: userId,
      repo: plan.repo,
      default_branch: plan.defaultBranch,
      base_sha: plan.baseSha,
      plan_hash: planHash,
      plan,
      status: "approved",
      approved_hash: planHash,
      approved_at: now,
      analysis_id: session.analysis_id,
      item_rank: session.item_rank,
      prompt_version: promptVersion,
      baseline_metrics: baselineMetrics,
      autonomy_mode: "bounded_completion_session",
      approval_policy: approvalPolicy,
      auto_repair_enabled: true,
      repair_attempts: 0,
      max_repair_attempts: MAX_REPAIR_ATTEMPTS,
      completion_session_id: session.id,
      session_iteration: iteration,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();
  if (error || !run) throw new Error(`Failed to persist session iteration: ${error?.message ?? "unknown database error"}`);

  const runId = String((run as Record<string, unknown>).id);
  const steps = plan.changes.map((change, index) => ({
    run_id: runId,
    user_id: userId,
    ordinal: index + 1,
    title: `${change.status === "created" ? "Create" : change.status === "modified" ? "Modify" : "Delete"} ${change.path}`,
    description: change.description,
    status: "pending",
    scope: [{ path: change.path, action: change.status }],
    created_at: now,
    updated_at: now,
  }));
  const [{ error: stepError }, { error: approvalError }] = await Promise.all([
    supabase.from("completion_steps").insert(steps),
    supabase.from("completion_approvals").insert({
      run_id: runId,
      user_id: userId,
      base_sha: plan.baseSha,
      plan_hash: planHash,
      approved_at: now,
      approval_mode: "bounded_completion_session",
    }),
  ]);
  if (stepError || approvalError) {
    await supabase.from("completion_runs").delete().eq("id", runId).eq("user_id", userId);
    throw new Error(`Failed to persist session iteration approval: ${stepError?.message ?? approvalError?.message ?? "unknown error"}`);
  }
  if (plan.reasoning?.traceId) {
    await supabase
      .from("reasoning_traces")
      .update({ completion_run_id: runId, updated_at: now })
      .eq("id", plan.reasoning.traceId)
      .eq("user_id", userId);
  }
  await recordRunEvent(
    supabase,
    userId,
    runId,
    "bounded_session_approved",
    "success",
    `Iteration ${iteration} exact plan is authorized by the session's explicit bounded-autonomy acknowledgement. Automatic merge remains disabled.`,
    { sessionId: session.id, iteration, planHash, approvalPolicy },
  );
  return run as CompletionRunRow;
}

async function launchIteration(
  supabase: SupabaseClient,
  userId: string,
  session: CompletionSessionRow,
) {
  const iteration = session.iteration_count + 1;
  const now = new Date().toISOString();
  await supabase
    .from("repo_completion_sessions")
    .update({ phase: "planning", last_error: null, updated_at: now })
    .eq("id", session.id)
    .eq("user_id", userId)
    .eq("status", "active");
  await recordSessionEvent(
    supabase,
    userId,
    session.id,
    iteration,
    "iteration_planning",
    "info",
    `Planning bounded iteration ${iteration}/${session.max_iterations} from ${session.branch_name || "the repository default branch"}.`,
    { baseBranch: session.branch_name, currentHeadSha: session.current_head_sha },
  );

  const targetInstruction = `Continue toward the explicit Definition of Done targets: completion >= ${session.target_completion_pct}% and production readiness >= ${session.target_readiness_pct}%. Current measured scores before this iteration are completion ${session.last_completion_pct ?? "unknown"}% and readiness ${session.last_readiness_pct ?? "unknown"}%. Re-inspect the exact current branch head, use prior measured learning, fix the highest-value remaining root causes, and do not repeat a low-value or failed strategy unchanged.`;
  const nextSteps = [...stringList(session.requested_next_steps, 20), targetInstruction].slice(0, 25);
  const prepared = await prepareFinishPlan(supabase, userId, {
    repo: session.repo,
    nextSteps,
    analysisId: session.analysis_id,
    itemRank: session.item_rank ?? undefined,
    mode: iteration === 1 ? "plan" : "replan",
    baseBranch: iteration === 1 ? undefined : session.branch_name ?? undefined,
  });
  const run = await persistRunPlan(supabase, userId, session, iteration, prepared.plan, prepared.planHash);

  await supabase
    .from("repo_completion_sessions")
    .update({
      phase: "executing",
      iteration_count: iteration,
      last_completion_run_id: run.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id)
    .eq("user_id", userId)
    .eq("status", "active");
  await supabase
    .from("completion_steps")
    .update({ status: "running", started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("run_id", run.id)
    .eq("user_id", userId)
    .eq("status", "pending");

  const result = iteration === 1
    ? await executePreparedPlan(supabase, userId, prepared.plan, prepared.planHash)
    : await executeContinuationPlan(
        supabase,
        userId,
        prepared.plan,
        prepared.planHash,
        session.branch_name!,
        session.pr_number!,
        session.pr_url!,
      );

  const verifyingAt = new Date().toISOString();
  await supabase
    .from("completion_runs")
    .update({
      status: "verifying",
      branch_name: result.branch,
      head_sha: result.head_sha,
      pr_number: result.pr_number,
      pr_url: result.pr_url,
      ci_status: "pending",
      error: null,
      updated_at: verifyingAt,
    })
    .eq("id", run.id)
    .eq("user_id", userId)
    .eq("status", "approved");
  await supabase
    .from("completion_steps")
    .update({
      status: "verifying",
      result: { branch: result.branch, headSha: result.head_sha, prNumber: result.pr_number, prUrl: result.pr_url },
      updated_at: verifyingAt,
    })
    .eq("run_id", run.id)
    .eq("user_id", userId);
  await supabase
    .from("repo_completion_sessions")
    .update({
      phase: "verifying",
      branch_name: result.branch,
      pr_number: result.pr_number,
      pr_url: result.pr_url,
      current_head_sha: result.head_sha,
      updated_at: verifyingAt,
    })
    .eq("id", session.id)
    .eq("user_id", userId)
    .eq("status", "active");
  await recordSessionEvent(
    supabase,
    userId,
    session.id,
    iteration,
    "iteration_executed",
    "success",
    iteration === 1
      ? `Created draft PR #${result.pr_number}; verification and bounded self-healing are active.`
      : `Appended iteration ${iteration} to draft PR #${result.pr_number}; verification and bounded self-healing are active.`,
    { headSha: result.head_sha, planHash: prepared.planHash, prUrl: result.pr_url },
  );
}

async function failRunVerification(
  supabase: SupabaseClient,
  userId: string,
  session: CompletionSessionRow,
  run: CompletionRunRow,
  verification: VerificationResult,
) {
  const now = new Date().toISOString();
  await Promise.all([
    supabase.from("completion_runs").update({ status: "failed", ci_status: "failed", error: verification.message, updated_at: now }).eq("id", run.id).eq("user_id", userId),
    supabase.from("completion_steps").update({ status: "failed", error: verification.message, completed_at: now, updated_at: now }).eq("run_id", run.id).eq("user_id", userId),
  ]);
  await finalizeRunEvolution(supabase, userId, { ...run, status: "failed", ci_status: "failed", error: verification.message, updated_at: now } as never).catch(() => null);
  await blockSession(supabase, userId, session, `Iteration ${session.iteration_count} failed verification after bounded repair opportunities: ${verification.message}`, "iteration_verification_failed");
}

async function evaluateVerifiedIteration(
  supabase: SupabaseClient,
  userId: string,
  session: CompletionSessionRow,
  run: CompletionRunRow,
  verification: VerificationResult,
) {
  const now = new Date().toISOString();
  if (run.status !== "succeeded") {
    await Promise.all([
      supabase.from("completion_runs").update({ status: "succeeded", ci_status: "passed", error: null, updated_at: now }).eq("id", run.id).eq("user_id", userId).in("status", ["verifying", "repairing"]),
      supabase.from("completion_steps").update({ status: "passed", error: null, completed_at: now, updated_at: now }).eq("run_id", run.id).eq("user_id", userId),
    ]);
  }
  await markLatestRepairVerified(supabase, userId, run.id).catch(() => undefined);
  await recordRunEvent(supabase, userId, run.id, "ci_verification", "success", verification.message, { sessionId: session.id, iteration: session.iteration_count });
  await finalizeRunEvolution(supabase, userId, { ...run, status: "succeeded", ci_status: "passed", error: null, updated_at: now } as never).catch(() => null);

  const [metrics, refreshedRun] = await Promise.all([
    loadBaselineInvestmentMetrics(supabase, userId, session.analysis_id, session.repo),
    loadCompletionRun(supabase, userId, run.id),
  ]);
  const completionPct = metrics?.completionPct ?? null;
  const readinessPct = metrics?.productionReadinessPct ?? null;
  const decision = evaluateCompletionSessionProgress({
    completionPct,
    readinessPct,
    previousCompletionPct: session.last_completion_pct,
    previousReadinessPct: session.last_readiness_pct,
    targetCompletionPct: session.target_completion_pct,
    targetReadinessPct: session.target_readiness_pct,
    iterationCount: session.iteration_count,
    maxIterations: session.max_iterations,
    noProgressCount: session.no_progress_count,
    maxNoProgressIterations: session.max_no_progress_iterations,
  });
  const update: Record<string, unknown> = {
    phase: decision.action === "continue" ? "replanning" : decision.action === "complete" ? "complete" : "blocked",
    status: decision.action === "continue" ? "active" : decision.action === "complete" ? "succeeded" : "blocked",
    last_completion_pct: completionPct,
    last_readiness_pct: readinessPct,
    last_outcome_score: finite(refreshedRun.outcome_score),
    no_progress_count: decision.noProgressCount,
    last_error: decision.action === "block" ? decision.reason : null,
    stop_reason: decision.action === "continue" ? null : decision.reason,
    last_progress_at: decision.noProgressCount === 0 ? now : session.last_progress_at,
    completed_at: decision.action === "continue" ? null : now,
    updated_at: now,
  };
  await supabase.from("repo_completion_sessions").update(update).eq("id", session.id).eq("user_id", userId);
  await recordSessionEvent(
    supabase,
    userId,
    session.id,
    session.iteration_count,
    decision.action === "complete" ? "targets_reached" : decision.action === "block" ? "session_stop" : "iteration_rescored",
    decision.action === "complete" ? "success" : decision.action === "block" ? "warning" : "info",
    decision.reason,
    { completionPct, readinessPct, outcomeScore: refreshedRun.outcome_score, progress: decision.progress },
  );
  return decision.action;
}

async function processActiveSession(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  token: string,
) {
  const deadline = Date.now() + SESSION_WORK_BUDGET_MS;
  while (Date.now() < deadline) {
    let session = await loadCompletionSession(supabase, userId, sessionId);
    if (session.status !== "active") return;
    await heartbeat(supabase, userId, sessionId, token);

    if (session.phase === "queued" || session.phase === "replanning") {
      try {
        await launchIteration(supabase, userId, session);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await blockSession(supabase, userId, session, `Iteration ${session.iteration_count + 1} could not be safely planned/executed: ${message}`, "iteration_execution_failed");
        return;
      }
      continue;
    }

    if (!session.last_completion_run_id) {
      await blockSession(supabase, userId, session, "Session lost its completion-run pointer; refusing to guess which branch state to continue from.", "session_state_inconsistent");
      return;
    }
    const run = await loadCompletionRun(supabase, userId, session.last_completion_run_id);

    if (run.head_sha && run.head_sha !== session.current_head_sha) {
      await supabase.from("repo_completion_sessions").update({ current_head_sha: run.head_sha, updated_at: new Date().toISOString() }).eq("id", session.id).eq("user_id", userId);
      session = { ...session, current_head_sha: run.head_sha };
    }

    if (run.status === "repairing") {
      await supabase.from("repo_completion_sessions").update({ phase: "repairing", updated_at: new Date().toISOString() }).eq("id", session.id).eq("user_id", userId);
      return;
    }
    if (run.status === "failed" || run.status === "stale") {
      await blockSession(supabase, userId, session, `Iteration ${session.iteration_count} is ${run.status}: ${run.error || "no additional error detail"}.`, "iteration_terminal_failure");
      return;
    }
    if (run.status !== "verifying" && run.status !== "succeeded") {
      // Execution may still be finishing in another worker. Do not duplicate a branch write.
      return;
    }
    if (!run.head_sha) {
      await blockSession(supabase, userId, session, "Verification cannot continue because the iteration has no persisted head SHA.", "session_state_inconsistent");
      return;
    }

    await supabase.from("repo_completion_sessions").update({ phase: "verifying", updated_at: new Date().toISOString() }).eq("id", session.id).eq("user_id", userId);
    const verification = await verifyCommitChecks(supabase, userId, session.repo, run.head_sha);
    if (verification.state === "pending") return;
    if (verification.state === "failed") {
      const scheduled = await tryScheduleCiRepair(supabase, userId, run as unknown as SelfHealingRun, verification);
      if (scheduled) {
        await supabase.from("repo_completion_sessions").update({ phase: "repairing", updated_at: new Date().toISOString() }).eq("id", session.id).eq("user_id", userId);
        await recordSessionEvent(supabase, userId, session.id, session.iteration_count, "repair_started", "warning", `Verification failed; bounded self-healing attempt scheduled before the session is considered failed.`, { failedChecks: verification.failedChecks });
        return;
      }
      await failRunVerification(supabase, userId, session, run, verification);
      return;
    }

    await supabase.from("repo_completion_sessions").update({ phase: "rescoring", updated_at: new Date().toISOString() }).eq("id", session.id).eq("user_id", userId);
    const action = await evaluateVerifiedIteration(supabase, userId, session, run, verification);
    if (action !== "continue") return;
  }
}

export async function processCompletionSession(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
) {
  const claim = await claimSession(supabase, userId, sessionId);
  if (!claim) return;
  try {
    await processActiveSession(supabase, userId, sessionId, claim.token);
  } finally {
    await releaseSession(supabase, userId, sessionId, claim.token).catch(() => undefined);
  }
}

export function scheduleCompletionSession(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
) {
  runInBackground(processCompletionSession(supabase, userId, sessionId), `completion-session:${sessionId}`);
}

const RETRYABLE_BLOCK_KINDS = new Set(["iteration_execution_failed"]);

/**
 * Idempotently retries a session that was blocked because a single planning
 * iteration threw before any branch/PR/run state was persisted (i.e. was
 * blocked with kind "iteration_execution_failed" — see launchIteration's
 * catch above). This is exactly the "formatting error permanently stranded
 * the session at iteration 0" failure mode: `iteration_count` was never
 * incremented and no completion_run row was created for the failed attempt,
 * so resuming just means flipping the session back to active/queued and
 * rescheduling the worker — it will re-run the *same* iteration number from
 * scratch, not create a new one.
 *
 * Calling this on a session that is already "active" is a safe no-op (it
 * just reports current state) so a client can call it repeatedly without
 * side effects. Blocked sessions whose most recent block event is NOT an
 * `iteration_execution_failed` (e.g. verification failed after a real
 * branch/PR already exists, or session state was inconsistent) are
 * rejected with 409 — those failure modes already have branch/PR state that
 * a blind "retry planning" would not safely reconcile, and are out of scope
 * for this idempotent retry path.
 */
export async function retryBlockedIteration(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
): Promise<{ session: CompletionSessionRow; retried: boolean; workerMode: CompletionWorkerModeLike | null }> {
  const session = await loadCompletionSession(supabase, userId, sessionId);

  if (session.status === "active") {
    return { session, retried: false, workerMode: null };
  }

  if (session.status !== "blocked") {
    throw Object.assign(
      new Error(`Session cannot retry an iteration from terminal status "${session.status}".`),
      { status: 409 },
    );
  }

  const events = await listCompletionSessionEvents(supabase, userId, sessionId);
  const lastEvent = events[events.length - 1] as { kind?: string } | undefined;
  if (!lastEvent?.kind || !RETRYABLE_BLOCK_KINDS.has(lastEvent.kind)) {
    throw Object.assign(
      new Error(
        `This session was blocked for a reason ("${lastEvent?.kind ?? session.stop_reason ?? "unknown"}") that is not a bounded planning-format retry. It may already have branch/PR state that requires manual review instead of an automatic retry.`,
      ),
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("repo_completion_sessions")
    .update({
      status: "active",
      phase: "queued",
      stop_reason: null,
      last_error: null,
      completed_at: null,
      updated_at: now,
    })
    .eq("id", sessionId)
    .eq("user_id", userId)
    .eq("status", "blocked")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`Failed to retry completion-session iteration: ${error.message}`);
  if (!updated) {
    // Lost a race with another retry/cancel call between the read above and
    // this update — re-load and report current state rather than throwing,
    // keeping this endpoint idempotent under concurrent calls.
    const latest = await loadCompletionSession(supabase, userId, sessionId);
    return { session: latest, retried: false, workerMode: null };
  }

  await recordSessionEvent(
    supabase,
    userId,
    sessionId,
    session.iteration_count || null,
    "iteration_retry_requested",
    "info",
    `Retrying iteration ${session.iteration_count + 1} after a bounded planning-format failure. No new branch, commit, PR, or iteration record is created by this retry — it re-attempts the same iteration.`,
  );

  const { scheduleCompletionSession } = await import("./completion-session-scheduler");
  const workerMode = await scheduleCompletionSession(supabase, userId, sessionId);
  return { session: updated as CompletionSessionRow, retried: true, workerMode };
}

export async function listCompletionSessionEvents(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
) {
  const { data, error } = await supabase
    .from("repo_completion_session_events")
    .select("*")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(`Failed to load completion session events: ${error.message}`);
  return data ?? [];
}
