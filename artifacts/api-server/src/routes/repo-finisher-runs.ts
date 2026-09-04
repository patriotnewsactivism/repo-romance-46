import { Router, type IRouter } from "express";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { asyncHandler } from "../lib/async-handler";
import { requireAuth } from "../middlewares/auth";
import {
  executePreparedPlan,
  hashPreparedPlan,
  prepareFinishPlan,
  verifyCommitChecks,
  type PreparedFinishPlan,
  type VerificationResult,
} from "../lib/repo-finisher-engine";
import { finalizeRunEvolution, loadBaselineInvestmentMetrics } from "../lib/post-run-evolution";
import { insertCompletionRunCompat } from "../lib/completion-run-persistence";
import { markLatestRepairVerified, tryScheduleCiRepair, type SelfHealingRun } from "../lib/ci-repair";

const router: IRouter = Router();
const DIRECT_PROMPT_VERSION = "direct-finisher-v4-explicit-bounded-repair";

type RunStatus =
  | "awaiting_approval"
  | "approved"
  | "executing"
  | "verifying"
  | "repairing"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "stale";

interface CompletionRunRow {
  id: string;
  user_id: string;
  repo: string;
  default_branch: string;
  base_sha: string;
  plan_hash: string;
  plan: PreparedFinishPlan;
  status: RunStatus;
  approved_hash: string | null;
  approved_at: string | null;
  branch_name: string | null;
  head_sha: string | null;
  pr_number: number | null;
  pr_url: string | null;
  ci_status: string | null;
  error: string | null;
  auto_repair_enabled?: boolean;
  repair_attempts?: number;
  max_repair_attempts?: number;
  last_repair_error?: string | null;
  analysis_id?: string | null;
  item_rank?: number | null;
  prompt_version?: string | null;
  baseline_metrics?: unknown;
  outcome_metrics?: unknown;
  outcome_score?: number | null;
  evaluated_at?: string | null;
  created_at: string;
  updated_at: string;
}

function asServiceUnavailable(message: string) {
  return Object.assign(new Error(message), { status: 503 });
}

function dbError(action: string, error: { message: string; code?: string } | null) {
  if (!error) return null;
  if (error.code === "42P01" || error.code === "PGRST205" || /completion_(runs|steps|events|approvals)/i.test(error.message)) {
    return asServiceUnavailable("RepoFinisher durable-run schema is not available on this database. Apply the repository Supabase migrations before using approval-bound runs.");
  }
  return new Error(`${action}: ${error.message}`);
}

async function recordEvent(
  supabase: SupabaseClient,
  userId: string,
  runId: string,
  kind: string,
  status: "info" | "success" | "warning" | "error",
  message: string,
  metadata: Record<string, unknown> = {},
) {
  const { error } = await supabase.from("completion_events").insert({ run_id: runId, user_id: userId, kind, status, message, metadata });
  if (error) throw dbError("Failed to record completion event", error);
}

async function loadRun(supabase: SupabaseClient, userId: string, runId: string): Promise<CompletionRunRow> {
  const { data, error } = await supabase
    .from("completion_runs")
    .select("*")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw dbError("Failed to load completion run", error);
  if (!data) throw Object.assign(new Error("Completion run not found."), { status: 404 });
  return data as CompletionRunRow;
}

async function finalizeVerification(
  supabase: SupabaseClient,
  userId: string,
  run: CompletionRunRow,
  verification: VerificationResult,
): Promise<RunStatus> {
  if (run.status !== "verifying") return run.status;

  if (verification.state === "failed" && run.auto_repair_enabled) {
    const scheduled = await tryScheduleCiRepair(supabase, userId, run as unknown as SelfHealingRun, verification);
    if (scheduled) return "repairing";
  }

  if (verification.state === "pending") {
    await supabase
      .from("completion_runs")
      .update({ ci_status: "pending", updated_at: new Date().toISOString() })
      .eq("id", run.id)
      .eq("user_id", userId)
      .eq("status", "verifying");
    return "verifying";
  }

  const succeeded = verification.state === "passed";
  const nextStatus: RunStatus = succeeded ? "succeeded" : "failed";
  const now = new Date().toISOString();
  const nextError = succeeded ? null : verification.message;
  const { error } = await supabase
    .from("completion_runs")
    .update({ status: nextStatus, ci_status: verification.state, error: nextError, updated_at: now })
    .eq("id", run.id)
    .eq("user_id", userId)
    .eq("status", "verifying");
  if (error) throw dbError("Failed to update verification state", error);

  const { error: stepError } = await supabase
    .from("completion_steps")
    .update({ status: succeeded ? "passed" : "failed", error: nextError, completed_at: now, updated_at: now })
    .eq("run_id", run.id)
    .eq("user_id", userId);
  if (stepError) throw dbError("Failed to update completion steps", stepError);

  if (succeeded && Number(run.repair_attempts ?? 0) > 0) {
    await markLatestRepairVerified(supabase, userId, run.id).catch(() => undefined);
  }

  await recordEvent(
    supabase,
    userId,
    run.id,
    "ci_verification",
    succeeded ? "success" : "error",
    verification.message,
    {
      totalChecks: verification.totalChecks,
      completedChecks: verification.completedChecks,
      failedChecks: verification.failedChecks,
      sandbox: verification.sandbox ?? null,
      repairAttempts: run.repair_attempts ?? 0,
    },
  );

  await finalizeRunEvolution(supabase, userId, {
    ...run,
    status: nextStatus,
    ci_status: verification.state,
    error: nextError,
    updated_at: now,
  }).catch(() => null);

  return nextStatus;
}

router.post(
  "/repo-finisher/preview",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = z.object({
      repo: z.string().regex(/^[A-Za-z0-9.-]+\/[A-Za-z0-9._-]+$/),
      nextSteps: z.array(z.string()).max(25).optional(),
      analysisId: z.string().uuid().optional(),
      itemRank: z.number().int().nonnegative().optional(),
      boundedAutonomyAcknowledged: z.boolean().default(false),
      // Subdirectory to scope this run to (e.g. "artifacts/api-server"),
      // required when the repo's full tree is too large for GitHub's
      // recursive listing — see prepareFinishPlan / getRepoTree, which
      // returns a 409 with details.suggestedScopes when that happens.
      scopePath: z.string().trim().min(1).max(300).optional(),
    }).parse(req.body);

    const [{ plan, planHash, reasoning }, baselineMetrics] = await Promise.all([
      prepareFinishPlan(req.supabase!, req.userId!, input),
      loadBaselineInvestmentMetrics(req.supabase!, req.userId!, input.analysisId, input.repo),
    ]);
    const now = new Date().toISOString();
    const promptVersion = plan.reasoning?.promptVersion ?? DIRECT_PROMPT_VERSION;
    const repairEnabled = input.boundedAutonomyAcknowledged;
    const approvalPolicy = {
      mode: repairEnabled ? "exact_plan_plus_bounded_ci_repair" : "exact_plan_only",
      acknowledgedAt: repairEnabled ? now : null,
      initialPlanRequiresExplicitApproval: true,
      repairWritesLimitedToApprovedRunBranch: repairEnabled,
      maxRepairAttempts: repairEnabled ? 3 : 0,
      automaticMerge: false,
    };
    const runInsert = await insertCompletionRunCompat(req.supabase!, {
      user_id: req.userId!,
      repo: plan.repo,
      default_branch: plan.defaultBranch,
      base_sha: plan.baseSha,
      plan_hash: planHash,
      plan,
      status: "awaiting_approval",
      analysis_id: input.analysisId ?? null,
      item_rank: input.itemRank ?? null,
      prompt_version: promptVersion,
      baseline_metrics: baselineMetrics,
      approval_policy: approvalPolicy,
      ...(repairEnabled ? { auto_repair_enabled: true, max_repair_attempts: 3 } : {}),
      created_at: now,
      updated_at: now,
    });
    if (runInsert.error || !runInsert.data) throw dbError("Failed to create completion run", runInsert.error);
    const run = runInsert.data as unknown as CompletionRunRow;

    if (reasoning?.traceId) {
      await req.supabase!
        .from("reasoning_traces")
        .update({ completion_run_id: run.id, updated_at: now })
        .eq("id", reasoning.traceId)
        .eq("user_id", req.userId!);
    }

    const stepRows = plan.changes.map((change, index) => ({
      run_id: run.id,
      user_id: req.userId!,
      ordinal: index + 1,
      title: `${change.status === "created" ? "Create" : change.status === "modified" ? "Modify" : "Delete"} ${change.path}`,
      description: change.description,
      status: "pending",
      scope: [{ path: change.path, action: change.status }],
      created_at: now,
      updated_at: now,
    }));
    const { error: stepError } = await req.supabase!.from("completion_steps").insert(stepRows);
    if (stepError) {
      await req.supabase!.from("completion_runs").delete().eq("id", run.id).eq("user_id", req.userId!);
      throw dbError("Failed to create completion steps", stepError);
    }

    await recordEvent(req.supabase!, req.userId!, run.id, "plan_created", "info", `Prepared ${plan.changes.length} exact file change${plan.changes.length === 1 ? "" : "s"} after multi-stage reasoning and measured-learning retrieval.`, {
      baseSha: plan.baseSha,
      planHash,
      promptVersion,
      reasoning: plan.reasoning ?? null,
      baselineMetrics,
      approvalPolicy,
      outcomeTelemetryPersisted: runInsert.telemetryPersisted,
    });

    res.status(201).json({
      runId: run.id,
      status: run.status,
      repo: plan.repo,
      defaultBranch: plan.defaultBranch,
      baseSha: plan.baseSha,
      planHash,
      summary: plan.summary,
      nextSteps: plan.nextSteps,
      changes: plan.changes.map(({ mode: _mode, ...change }) => change),
      promptVersion,
      reasoning: plan.reasoning ?? null,
      baselineMetrics,
      autoRepair: { enabled: repairEnabled, maxAttempts: repairEnabled ? 3 : 0, requiresBoundedAutonomyAcknowledgement: true },
      outcomeTelemetryPersisted: runInsert.telemetryPersisted,
      createdAt: run.created_at,
    });
  }),
);

router.post(
  "/repo-finisher/runs/:runId/approve",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(req.params);
    const body = z.object({ planHash: z.string().regex(/^[0-9a-f]{64}$/) }).parse(req.body);
    const run = await loadRun(req.supabase!, req.userId!, runId);
    if (run.status !== "awaiting_approval") throw Object.assign(new Error(`Run cannot be approved from status ${run.status}.`), { status: 409 });
    if (run.plan_hash !== body.planHash || hashPreparedPlan(run.plan) !== body.planHash) {
      throw Object.assign(new Error("Approval hash does not match the exact stored plan."), { status: 409 });
    }

    const now = new Date().toISOString();
    const { error: approvalError } = await req.supabase!.from("completion_approvals").insert({
      run_id: run.id,
      user_id: req.userId!,
      base_sha: run.base_sha,
      plan_hash: body.planHash,
      approved_at: now,
    });
    if (approvalError) throw dbError("Failed to record approval", approvalError);

    const { data: updated, error } = await req.supabase!
      .from("completion_runs")
      .update({ status: "approved", approved_hash: body.planHash, approved_at: now, updated_at: now })
      .eq("id", run.id)
      .eq("user_id", req.userId!)
      .eq("status", "awaiting_approval")
      .select("id")
      .maybeSingle();
    if (error) throw dbError("Failed to approve completion run", error);
    if (!updated) {
      await req.supabase!.from("completion_approvals").delete().eq("run_id", run.id).eq("user_id", req.userId!).eq("plan_hash", body.planHash);
      throw Object.assign(new Error("Run changed while approval was being recorded. Refresh and try again."), { status: 409 });
    }

    await recordEvent(req.supabase!, req.userId!, run.id, "plan_approved", "success", "Exact completion plan approved.", { baseSha: run.base_sha, planHash: body.planHash });
    res.json({ runId: run.id, status: "approved", approvedAt: now, planHash: body.planHash });
  }),
);

router.post(
  "/repo-finisher/runs/:runId/execute",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(req.params);
    const run = await loadRun(req.supabase!, req.userId!, runId);
    if (run.status !== "approved" || !run.approved_hash || run.approved_hash !== run.plan_hash) {
      throw Object.assign(new Error("Run must have a matching exact-plan approval before execution."), { status: 409 });
    }
    if (hashPreparedPlan(run.plan) !== run.plan_hash) throw Object.assign(new Error("Stored plan changed after approval; execution blocked."), { status: 409 });

    const now = new Date().toISOString();
    const { data: claimed, error: claimError } = await req.supabase!
      .from("completion_runs")
      .update({ status: "executing", error: null, updated_at: now })
      .eq("id", run.id)
      .eq("user_id", req.userId!)
      .eq("status", "approved")
      .select("id")
      .maybeSingle();
    if (claimError) throw dbError("Failed to claim completion run", claimError);
    if (!claimed) throw Object.assign(new Error("Run is already being executed or its state changed."), { status: 409 });

    await req.supabase!.from("completion_steps").update({ status: "running", started_at: now, updated_at: now }).eq("run_id", run.id).eq("user_id", req.userId!).eq("status", "pending");
    await recordEvent(req.supabase!, req.userId!, run.id, "execution_started", "info", "Executing the approved atomic plan.", {
      baseSha: run.base_sha,
      planHash: run.plan_hash,
      promptVersion: run.plan.reasoning?.promptVersion ?? run.prompt_version,
      reasoningTraceId: run.plan.reasoning?.traceId ?? null,
      autoRepairEnabled: Boolean(run.auto_repair_enabled),
    });

    try {
      const result = await executePreparedPlan(req.supabase!, req.userId!, run.plan, run.plan_hash);
      const verifyingAt = new Date().toISOString();
      const { error: updateError } = await req.supabase!
        .from("completion_runs")
        .update({ status: "verifying", branch_name: result.branch, head_sha: result.head_sha, pr_number: result.pr_number, pr_url: result.pr_url, ci_status: "pending", updated_at: verifyingAt })
        .eq("id", run.id)
        .eq("user_id", req.userId!)
        .eq("status", "executing");
      if (updateError) throw dbError("Failed to persist execution result", updateError);

      const { error: stepError } = await req.supabase!
        .from("completion_steps")
        .update({ status: "verifying", result: { branch: result.branch, headSha: result.head_sha, prNumber: result.pr_number, prUrl: result.pr_url }, updated_at: verifyingAt })
        .eq("run_id", run.id)
        .eq("user_id", req.userId!);
      if (stepError) throw dbError("Failed to persist completion step result", stepError);

      await recordEvent(req.supabase!, req.userId!, run.id, "draft_pr_created", "success", `Created draft PR #${result.pr_number}; waiting for checks.${run.auto_repair_enabled ? " Bounded self-healing is armed for verification failures." : ""}`, {
        prUrl: result.pr_url,
        branch: result.branch,
        headSha: result.head_sha,
      });

      const verification = await verifyCommitChecks(req.supabase!, req.userId!, run.repo, result.head_sha);
      const status = await finalizeVerification(req.supabase!, req.userId!, {
        ...run,
        status: "verifying",
        head_sha: result.head_sha,
        branch_name: result.branch,
        pr_number: result.pr_number,
        pr_url: result.pr_url,
        ci_status: "pending",
        updated_at: verifyingAt,
      }, verification);
      res.json({ runId: run.id, status, result, verification, autoRepairScheduled: status === "repairing" });
    } catch (error) {
      const executionError = error as Error & { code?: string };
      const failedAt = new Date().toISOString();
      const stale = executionError.code === "STALE_BASE" || /Repository changed after preview/i.test(executionError.message);
      const status: RunStatus = stale ? "stale" : "failed";
      await Promise.all([
        req.supabase!.from("completion_runs").update({ status, error: executionError.message, updated_at: failedAt }).eq("id", run.id).eq("user_id", req.userId!).eq("status", "executing"),
        req.supabase!.from("completion_steps").update({ status: stale ? "cancelled" : "failed", error: executionError.message, completed_at: failedAt, updated_at: failedAt }).eq("run_id", run.id).eq("user_id", req.userId!),
      ]);
      await recordEvent(req.supabase!, req.userId!, run.id, stale ? "base_became_stale" : "execution_failed", stale ? "warning" : "error", executionError.message);
      await finalizeRunEvolution(req.supabase!, req.userId!, { ...run, status, error: executionError.message, updated_at: failedAt }).catch(() => null);
      throw error;
    }
  }),
);

router.get(
  "/repo-finisher/runs/:runId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(req.params);
    let run = await loadRun(req.supabase!, req.userId!, runId);
    let verification: VerificationResult | null = null;

    if (run.status === "verifying" && run.head_sha) {
      verification = await verifyCommitChecks(req.supabase!, req.userId!, run.repo, run.head_sha);
      await finalizeVerification(req.supabase!, req.userId!, run, verification);
      run = await loadRun(req.supabase!, req.userId!, runId);
    }
    if ((run.status === "succeeded" || run.status === "failed" || run.status === "stale") && !run.evaluated_at) {
      await finalizeRunEvolution(req.supabase!, req.userId!, run).catch(() => null);
      run = await loadRun(req.supabase!, req.userId!, runId);
    }

    const [{ data: steps, error: stepsError }, { data: events, error: eventsError }, { data: traces, error: tracesError }] = await Promise.all([
      req.supabase!.from("completion_steps").select("*").eq("run_id", run.id).eq("user_id", req.userId!).order("ordinal", { ascending: true }),
      req.supabase!.from("completion_events").select("*").eq("run_id", run.id).eq("user_id", req.userId!).order("created_at", { ascending: true }),
      req.supabase!.from("reasoning_traces").select("*").eq("completion_run_id", run.id).eq("user_id", req.userId!).order("created_at", { ascending: true }),
    ]);
    if (stepsError) throw dbError("Failed to load completion steps", stepsError);
    if (eventsError) throw dbError("Failed to load completion events", eventsError);
    if (tracesError) throw new Error(`Failed to load reasoning traces: ${tracesError.message}`);

    res.json({
      run: {
        id: run.id,
        repo: run.repo,
        defaultBranch: run.default_branch,
        baseSha: run.base_sha,
        planHash: run.plan_hash,
        status: run.status,
        approvedAt: run.approved_at,
        branchName: run.branch_name,
        headSha: run.head_sha,
        prNumber: run.pr_number,
        prUrl: run.pr_url,
        ciStatus: run.ci_status,
        error: run.error,
        summary: run.plan.summary,
        reasoning: run.plan.reasoning ?? null,
        analysisId: run.analysis_id,
        itemRank: run.item_rank,
        promptVersion: run.plan.reasoning?.promptVersion ?? run.prompt_version,
        autoRepairEnabled: Boolean(run.auto_repair_enabled),
        repairAttempts: run.repair_attempts ?? 0,
        maxRepairAttempts: run.max_repair_attempts ?? 0,
        lastRepairError: run.last_repair_error ?? null,
        baselineMetrics: run.baseline_metrics,
        outcomeMetrics: run.outcome_metrics,
        outcomeScore: run.outcome_score,
        evaluatedAt: run.evaluated_at,
        createdAt: run.created_at,
        updatedAt: run.updated_at,
      },
      steps: steps || [],
      events: events || [],
      reasoningTraces: traces || [],
      verification,
    });
  }),
);

router.post(
  "/repo-finisher/runs/:runId/cancel",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(req.params);
    const run = await loadRun(req.supabase!, req.userId!, runId);
    if (run.status !== "awaiting_approval" && run.status !== "approved") {
      throw Object.assign(new Error(`Run cannot be cancelled from status ${run.status}.`), { status: 409 });
    }
    const now = new Date().toISOString();
    const { data: cancelled, error } = await req.supabase!
      .from("completion_runs")
      .update({ status: "cancelled", updated_at: now })
      .eq("id", run.id)
      .eq("user_id", req.userId!)
      .in("status", ["awaiting_approval", "approved"])
      .select("id")
      .maybeSingle();
    if (error) throw dbError("Failed to cancel completion run", error);
    if (!cancelled) throw Object.assign(new Error("Run state changed before cancellation."), { status: 409 });

    await Promise.all([
      req.supabase!.from("completion_approvals").update({ revoked_at: now }).eq("run_id", run.id).eq("user_id", req.userId!).is("revoked_at", null),
      req.supabase!.from("completion_steps").update({ status: "cancelled", completed_at: now, updated_at: now }).eq("run_id", run.id).eq("user_id", req.userId!).eq("status", "pending"),
    ]);
    await recordEvent(req.supabase!, req.userId!, run.id, "run_cancelled", "warning", "Completion run cancelled before execution.");
    res.json({ runId: run.id, status: "cancelled", cancelledAt: now });
  }),
);

export default router;
