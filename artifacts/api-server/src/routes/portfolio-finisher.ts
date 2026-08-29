import { randomUUID } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { Router, type IRouter } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { requireAuth } from "../middlewares/auth";
import {
  executePreparedPlan,
  prepareFinishPlan,
  verifyCommitChecks,
  type PreparedFinishPlan,
  type VerificationResult,
} from "../lib/repo-finisher-engine";
import { normalizeInvestmentMetrics } from "../lib/run-outcome-score";
import { finalizeRunEvolution } from "../lib/post-run-evolution";
import {
  markLatestRepairVerified,
  tryScheduleCiRepair,
  type SelfHealingRun,
} from "../lib/ci-repair";

const router: IRouter = Router();
const PORTFOLIO_PROMPT_VERSION = "portfolio-finisher-v1-bounded";
const PORTFOLIO_MAX_REPAIR_ATTEMPTS = 3;
const WORKER_LEASE_MS = 9 * 60_000;
const WORKER_BUDGET_MS = 7 * 60_000;
const ACTIVE_PORTFOLIO_STATUSES = ["queued", "running", "verifying"] as const;

type PortfolioStatus =
  | "queued"
  | "running"
  | "verifying"
  | "succeeded"
  | "partial_failed"
  | "failed"
  | "cancelled";

type PortfolioItemStatus =
  | "queued"
  | "planning"
  | "executing"
  | "verifying"
  | "succeeded"
  | "failed"
  | "skipped"
  | "cancelled";

interface PortfolioRunRow {
  id: string;
  user_id: string;
  analysis_id: string | null;
  status: PortfolioStatus;
  selection_limit: number;
  concurrency: number;
  max_estimated_hours: number | null;
  max_estimated_cost_usd: number | null;
  stop_on_failure: boolean;
  auto_execute: boolean;
  autonomy_acknowledged_at: string;
  requested_count: number;
  planned_count: number;
  succeeded_count: number;
  failed_count: number;
  verifying_count: number;
  skipped_count: number;
  estimated_hours_selected: number;
  estimated_cost_selected: number;
  worker_token: string | null;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PortfolioItemRow {
  id: string;
  portfolio_run_id: string;
  user_id: string;
  repo: string;
  rank: number;
  status: PortfolioItemStatus;
  estimated_hours: number | null;
  estimated_cost_usd: number | null;
  next_steps: unknown;
  completion_run_id: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RankingEntry {
  repo: string;
  rank?: number;
  finishFirstScore?: number;
  completionPct?: number;
  productionReadinessPct?: number;
  presentValueUsd?: { low?: number; high?: number };
  potentialValueUsd?: { low?: number; high?: number };
  commercializationProbability?: number;
  remainingWork?: { hours?: number; costUsd?: { low?: number; high?: number } };
  details?: { recommendedNextSteps?: unknown };
}

function keepAlive(job: Promise<unknown>) {
  try {
    waitUntil(job);
  } catch {
    void job.catch(() => undefined);
  }
}

function numeric(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringList(value: unknown, max = 25) {
  if (!Array.isArray(value)) return [];
  return value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, max);
}

async function recordCompletionEvent(
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
  if (error) throw new Error(`Failed to record completion event: ${error.message}`);
}

async function loadPortfolioRun(supabase: SupabaseClient, userId: string, runId: string) {
  const { data, error } = await supabase
    .from("portfolio_completion_runs")
    .select("*")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load portfolio completion run: ${error.message}`);
  if (!data) throw Object.assign(new Error("Portfolio completion run not found."), { status: 404 });
  return data as PortfolioRunRow;
}

async function loadInvestmentEntry(
  supabase: SupabaseClient,
  userId: string,
  analysisId: string | null,
  repo: string,
) {
  if (!analysisId) return null;
  const { data, error } = await supabase
    .from("analyses")
    .select("investment_intelligence")
    .eq("id", analysisId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  const intelligence = (data as Record<string, unknown>).investment_intelligence;
  if (!intelligence || typeof intelligence !== "object") return null;
  const ranking = (intelligence as Record<string, unknown>).ranking;
  if (!Array.isArray(ranking)) return null;
  return (ranking.find((entry) => (entry as Record<string, unknown>).repo === repo) as RankingEntry | undefined) ?? null;
}

export async function setIndividualVerification(
  supabase: SupabaseClient,
  userId: string,
  item: PortfolioItemRow,
  completionRun: Record<string, unknown>,
  verification: VerificationResult,
) {
  if (verification.state === "pending") return;

  if (verification.state === "failed") {
    const repairScheduled = await tryScheduleCiRepair(
      supabase,
      userId,
      completionRun as unknown as SelfHealingRun,
      verification,
    );
    if (repairScheduled) {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("portfolio_completion_items")
        .update({ status: "verifying", error: null, completed_at: null, updated_at: now })
        .eq("id", item.id)
        .eq("user_id", userId);
      if (error) throw new Error(`Failed to keep portfolio item active during CI repair: ${error.message}`);
      return;
    }
  }

  const now = new Date().toISOString();
  const succeeded = verification.state === "passed";
  const completionStatus = succeeded ? "succeeded" : "failed";
  const errorMessage = succeeded ? null : verification.message;

  const { error: runError } = await supabase
    .from("completion_runs")
    .update({
      status: completionStatus,
      ci_status: verification.state,
      error: errorMessage,
      updated_at: now,
    })
    .eq("id", item.completion_run_id)
    .eq("user_id", userId)
    .eq("status", "verifying");
  if (runError) throw new Error(`Failed to persist portfolio CI result: ${runError.message}`);

  const { error: stepError } = await supabase
    .from("completion_steps")
    .update({
      status: succeeded ? "passed" : "failed",
      error: errorMessage,
      completed_at: now,
      updated_at: now,
    })
    .eq("run_id", item.completion_run_id)
    .eq("user_id", userId);
  if (stepError) throw new Error(`Failed to update portfolio completion steps: ${stepError.message}`);

  const { error: itemError } = await supabase
    .from("portfolio_completion_items")
    .update({
      status: succeeded ? "succeeded" : "failed",
      error: errorMessage,
      completed_at: now,
      updated_at: now,
    })
    .eq("id", item.id)
    .eq("user_id", userId)
    .eq("status", "verifying");
  if (itemError) throw new Error(`Failed to update portfolio item: ${itemError.message}`);

  await recordCompletionEvent(
    supabase,
    userId,
    String(completionRun.id),
    "ci_verification",
    succeeded ? "success" : "error",
    verification.message,
    {
      totalChecks: verification.totalChecks,
      completedChecks: verification.completedChecks,
      failedChecks: verification.failedChecks,
      portfolioRunId: item.portfolio_run_id,
    },
  );

  if (succeeded) {
    await markLatestRepairVerified(supabase, userId, String(completionRun.id)).catch(() => undefined);
  }

  await finalizeRunEvolution(supabase, userId, {
    ...completionRun,
    status: completionStatus,
    ci_status: verification.state,
    error: errorMessage,
    updated_at: now,
  } as never).catch(() => null);
}

async function processPortfolioItem(
  supabase: SupabaseClient,
  userId: string,
  portfolioRun: PortfolioRunRow,
  item: PortfolioItemRow,
) {
  const startedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from("portfolio_completion_items")
    .update({ status: "planning", started_at: startedAt, error: null, updated_at: startedAt })
    .eq("id", item.id)
    .eq("user_id", userId)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();
  if (claimError) throw new Error(`Failed to claim portfolio item: ${claimError.message}`);
  if (!claimed) return;

  const claimedItem = claimed as PortfolioItemRow;
  try {
    const nextSteps = stringList(claimedItem.next_steps);
    const [{ plan, planHash }, investmentEntry] = await Promise.all([
      prepareFinishPlan(supabase, userId, {
        repo: claimedItem.repo,
        nextSteps,
        analysisId: portfolioRun.analysis_id ?? undefined,
      }),
      loadInvestmentEntry(supabase, userId, portfolioRun.analysis_id, claimedItem.repo),
    ]);
    const baselineMetrics = normalizeInvestmentMetrics(investmentEntry);
    const now = new Date().toISOString();
    const approvalPolicy = {
      mode: "bounded_portfolio",
      portfolioRunId: portfolioRun.id,
      acknowledgedAt: portfolioRun.autonomy_acknowledged_at,
      constraints: {
        selectionLimit: portfolioRun.selection_limit,
        concurrency: portfolioRun.concurrency,
        maxEstimatedHours: portfolioRun.max_estimated_hours,
        maxEstimatedCostUsd: portfolioRun.max_estimated_cost_usd,
        stopOnFailure: portfolioRun.stop_on_failure,
        maxRepairAttempts: PORTFOLIO_MAX_REPAIR_ATTEMPTS,
        draftPullRequestsOnly: true,
        automaticMerge: false,
      },
    };

    const { data: completionRun, error: completionError } = await supabase
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
        analysis_id: portfolioRun.analysis_id,
        prompt_version: PORTFOLIO_PROMPT_VERSION,
        baseline_metrics: baselineMetrics,
        portfolio_run_id: portfolioRun.id,
        autonomy_mode: "bounded_portfolio",
        approval_policy: approvalPolicy,
        auto_repair_enabled: true,
        repair_attempts: 0,
        max_repair_attempts: PORTFOLIO_MAX_REPAIR_ATTEMPTS,
        created_at: now,
        updated_at: now,
      })
      .select("*")
      .single();
    if (completionError || !completionRun) {
      throw new Error(`Failed to create bounded completion run: ${completionError?.message ?? "unknown database error"}`);
    }

    const completionRunId = String((completionRun as Record<string, unknown>).id);
    const stepRows = plan.changes.map((change, index) => ({
      run_id: completionRunId,
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
      supabase.from("completion_steps").insert(stepRows),
      supabase.from("completion_approvals").insert({
        run_id: completionRunId,
        user_id: userId,
        base_sha: plan.baseSha,
        plan_hash: planHash,
        approved_at: now,
        approval_mode: "bounded_portfolio",
      }),
    ]);
    if (stepError || approvalError) {
      await supabase.from("completion_runs").delete().eq("id", completionRunId).eq("user_id", userId);
      throw new Error(`Failed to persist bounded approval: ${stepError?.message ?? approvalError?.message ?? "unknown error"}`);
    }

    await recordCompletionEvent(
      supabase,
      userId,
      completionRunId,
      "bounded_portfolio_approved",
      "success",
      "This exact generated plan is authorized by the user's bounded Finish Portfolio action. Execution is limited to a draft pull request; automatic merge is disabled.",
      { portfolioRunId: portfolioRun.id, planHash, approvalPolicy },
    );

    const { error: executingItemError } = await supabase
      .from("portfolio_completion_items")
      .update({ status: "executing", completion_run_id: completionRunId, updated_at: now })
      .eq("id", claimedItem.id)
      .eq("user_id", userId)
      .eq("status", "planning");
    if (executingItemError) throw new Error(`Failed to mark portfolio item executing: ${executingItemError.message}`);

    await supabase
      .from("completion_steps")
      .update({ status: "running", started_at: now, updated_at: now })
      .eq("run_id", completionRunId)
      .eq("user_id", userId)
      .eq("status", "pending");

    const result = await executePreparedPlan(supabase, userId, plan as PreparedFinishPlan, planHash);
    const verifyingAt = new Date().toISOString();
    const { error: runUpdateError } = await supabase
      .from("completion_runs")
      .update({
        status: "verifying",
        branch_name: result.branch,
        head_sha: result.head_sha,
        pr_number: result.pr_number,
        pr_url: result.pr_url,
        ci_status: "pending",
        updated_at: verifyingAt,
      })
      .eq("id", completionRunId)
      .eq("user_id", userId)
      .eq("status", "approved");
    if (runUpdateError) throw new Error(`Failed to persist portfolio execution: ${runUpdateError.message}`);

    await Promise.all([
      supabase
        .from("completion_steps")
        .update({
          status: "verifying",
          result: { branch: result.branch, headSha: result.head_sha, prNumber: result.pr_number, prUrl: result.pr_url },
          updated_at: verifyingAt,
        })
        .eq("run_id", completionRunId)
        .eq("user_id", userId),
      supabase
        .from("portfolio_completion_items")
        .update({ status: "verifying", updated_at: verifyingAt })
        .eq("id", claimedItem.id)
        .eq("user_id", userId)
        .eq("status", "executing"),
    ]);

    await recordCompletionEvent(
      supabase,
      userId,
      completionRunId,
      "draft_pr_created",
      "success",
      `Created bounded-autonomy draft PR #${result.pr_number}; waiting for checks with up to ${PORTFOLIO_MAX_REPAIR_ATTEMPTS} evidence-driven repair attempts armed.`,
      { portfolioRunId: portfolioRun.id, prUrl: result.pr_url, branch: result.branch, headSha: result.head_sha },
    );

    const verification = await verifyCommitChecks(supabase, userId, claimedItem.repo, result.head_sha);
    const verificationItem = { ...claimedItem, status: "verifying", completion_run_id: completionRunId } as PortfolioItemRow;
    const verifyingRun = {
      ...(completionRun as Record<string, unknown>),
      status: "verifying",
      branch_name: result.branch,
      head_sha: result.head_sha,
      pr_number: result.pr_number,
      pr_url: result.pr_url,
      ci_status: "pending",
      auto_repair_enabled: true,
      repair_attempts: 0,
      max_repair_attempts: PORTFOLIO_MAX_REPAIR_ATTEMPTS,
    };
    await setIndividualVerification(
      supabase,
      userId,
      verificationItem,
      verifyingRun,
      verification,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const completedAt = new Date().toISOString();
    const { data: latest } = await supabase
      .from("portfolio_completion_items")
      .select("completion_run_id")
      .eq("id", claimedItem.id)
      .eq("user_id", userId)
      .maybeSingle();
    const completionRunId = (latest as Record<string, unknown> | null)?.completion_run_id;

    await supabase
      .from("portfolio_completion_items")
      .update({ status: "failed", error: message, completed_at: completedAt, updated_at: completedAt })
      .eq("id", claimedItem.id)
      .eq("user_id", userId)
      .in("status", ["planning", "executing", "verifying"]);

    if (typeof completionRunId === "string") {
      await supabase
        .from("completion_runs")
        .update({ status: "failed", error: message, updated_at: completedAt })
        .eq("id", completionRunId)
        .eq("user_id", userId)
        .in("status", ["approved", "executing", "verifying"]);
      await supabase
        .from("completion_steps")
        .update({ status: "failed", error: message, completed_at: completedAt, updated_at: completedAt })
        .eq("run_id", completionRunId)
        .eq("user_id", userId)
        .in("status", ["pending", "running", "verifying"]);
      await recordCompletionEvent(
        supabase,
        userId,
        completionRunId,
        "portfolio_execution_failed",
        "error",
        message,
        { portfolioRunId: portfolioRun.id },
      ).catch(() => undefined);
    }
  }
}

async function pollVerifyingItems(
  supabase: SupabaseClient,
  userId: string,
  portfolioRun: PortfolioRunRow,
) {
  const { data: items, error } = await supabase
    .from("portfolio_completion_items")
    .select("*")
    .eq("portfolio_run_id", portfolioRun.id)
    .eq("user_id", userId)
    .eq("status", "verifying")
    .order("rank", { ascending: true })
    .limit(Math.max(1, portfolioRun.concurrency * 2));
  if (error) throw new Error(`Failed to load verifying portfolio items: ${error.message}`);

  await Promise.all(
    ((items ?? []) as PortfolioItemRow[]).map(async (item) => {
      if (!item.completion_run_id) return;
      const { data: completionRun, error: runError } = await supabase
        .from("completion_runs")
        .select("*")
        .eq("id", item.completion_run_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (runError || !completionRun) return;
      if (String((completionRun as Record<string, unknown>).status) === "repairing") return;
      const headSha = String((completionRun as Record<string, unknown>).head_sha || "");
      if (!headSha) return;
      const verification = await verifyCommitChecks(supabase, userId, item.repo, headSha);
      await setIndividualVerification(
        supabase,
        userId,
        item,
        completionRun as Record<string, unknown>,
        verification,
      );
    }),
  );
}

async function refreshPortfolioSummary(
  supabase: SupabaseClient,
  userId: string,
  portfolioRun: PortfolioRunRow,
) {
  const { data: items, error } = await supabase
    .from("portfolio_completion_items")
    .select("status")
    .eq("portfolio_run_id", portfolioRun.id)
    .eq("user_id", userId);
  if (error) throw new Error(`Failed to summarize portfolio completion run: ${error.message}`);

  const statuses = (items ?? []).map((item) => String((item as Record<string, unknown>).status));
  const count = (status: string) => statuses.filter((value) => value === status).length;
  const succeeded = count("succeeded");
  const failed = count("failed");
  const verifying = count("verifying");
  const skipped = count("skipped") + count("cancelled");
  const active = count("queued") + count("planning") + count("executing");
  const terminal = active === 0 && verifying === 0;

  let status: PortfolioStatus = portfolioRun.status;
  if (portfolioRun.status === "cancelled") {
    status = "cancelled";
  } else if (active > 0) {
    status = "running";
  } else if (verifying > 0) {
    status = "verifying";
  } else if (failed > 0 && succeeded > 0) {
    status = "partial_failed";
  } else if (failed > 0) {
    status = "failed";
  } else {
    status = "succeeded";
  }

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("portfolio_completion_runs")
    .update({
      status,
      succeeded_count: succeeded,
      failed_count: failed,
      verifying_count: verifying,
      skipped_count: skipped,
      completed_at: terminal ? now : null,
      updated_at: now,
    })
    .eq("id", portfolioRun.id)
    .eq("user_id", userId);
  if (updateError) throw new Error(`Failed to update portfolio completion summary: ${updateError.message}`);

  return { status, succeeded, failed, verifying, skipped, active, terminal };
}

async function claimWorkerLease(supabase: SupabaseClient, userId: string, runId: string) {
  const now = new Date();
  await supabase
    .from("portfolio_completion_runs")
    .update({ worker_token: null, lease_expires_at: null })
    .eq("id", runId)
    .eq("user_id", userId)
    .lt("lease_expires_at", now.toISOString());

  const workerToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + WORKER_LEASE_MS).toISOString();
  const { data, error } = await supabase
    .from("portfolio_completion_runs")
    .update({
      worker_token: workerToken,
      lease_expires_at: leaseExpiresAt,
      heartbeat_at: now.toISOString(),
      started_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", runId)
    .eq("user_id", userId)
    .is("worker_token", null)
    .in("status", [...ACTIVE_PORTFOLIO_STATUSES])
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`Failed to claim portfolio worker lease: ${error.message}`);
  return data ? { workerToken, run: data as PortfolioRunRow } : null;
}

async function processPortfolioRun(supabase: SupabaseClient, userId: string, runId: string) {
  const lease = await claimWorkerLease(supabase, userId, runId);
  if (!lease) return;
  const started = Date.now();
  let portfolioRun = lease.run;

  try {
    while (Date.now() - started < WORKER_BUDGET_MS) {
      portfolioRun = await loadPortfolioRun(supabase, userId, runId);
      if (portfolioRun.status === "cancelled") break;

      await pollVerifyingItems(supabase, userId, portfolioRun);
      const summary = await refreshPortfolioSummary(supabase, userId, portfolioRun);
      if (summary.terminal) break;

      if (portfolioRun.stop_on_failure && summary.failed > 0) {
        const now = new Date().toISOString();
        await supabase
          .from("portfolio_completion_items")
          .update({ status: "cancelled", error: "Stopped after a portfolio item failed.", completed_at: now, updated_at: now })
          .eq("portfolio_run_id", runId)
          .eq("user_id", userId)
          .eq("status", "queued");
        await refreshPortfolioSummary(supabase, userId, portfolioRun);
        break;
      }

      const { data: queued, error: queuedError } = await supabase
        .from("portfolio_completion_items")
        .select("*")
        .eq("portfolio_run_id", runId)
        .eq("user_id", userId)
        .eq("status", "queued")
        .order("rank", { ascending: true })
        .limit(portfolioRun.concurrency);
      if (queuedError) throw new Error(`Failed to load queued portfolio work: ${queuedError.message}`);
      const wave = (queued ?? []) as PortfolioItemRow[];
      if (wave.length === 0) break;

      await Promise.all(wave.map((item) => processPortfolioItem(supabase, userId, portfolioRun, item)));
      const heartbeat = new Date().toISOString();
      await supabase
        .from("portfolio_completion_runs")
        .update({ heartbeat_at: heartbeat, lease_expires_at: new Date(Date.now() + WORKER_LEASE_MS).toISOString(), updated_at: heartbeat })
        .eq("id", runId)
        .eq("user_id", userId)
        .eq("worker_token", lease.workerToken);
    }

    portfolioRun = await loadPortfolioRun(supabase, userId, runId);
    await pollVerifyingItems(supabase, userId, portfolioRun);
    await refreshPortfolioSummary(supabase, userId, portfolioRun);
  } finally {
    await supabase
      .from("portfolio_completion_runs")
      .update({ worker_token: null, lease_expires_at: null, updated_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("user_id", userId)
      .eq("worker_token", lease.workerToken);
  }
}

function kickPortfolioRun(supabase: SupabaseClient, userId: string, runId: string) {
  keepAlive(processPortfolioRun(supabase, userId, runId).catch(() => undefined));
}

async function portfolioRunResponse(supabase: SupabaseClient, userId: string, runId: string) {
  const run = await loadPortfolioRun(supabase, userId, runId);
  const { data: items, error: itemError } = await supabase
    .from("portfolio_completion_items")
    .select("*")
    .eq("portfolio_run_id", runId)
    .eq("user_id", userId)
    .order("rank", { ascending: true });
  if (itemError) throw new Error(`Failed to load portfolio completion items: ${itemError.message}`);

  const completionIds = ((items ?? []) as PortfolioItemRow[])
    .map((item) => item.completion_run_id)
    .filter((id): id is string => Boolean(id));
  const completionById = new Map<string, Record<string, unknown>>();
  if (completionIds.length > 0) {
    const { data: completions } = await supabase
      .from("completion_runs")
      .select("id, status, branch_name, head_sha, pr_number, pr_url, ci_status, error, outcome_score")
      .in("id", completionIds)
      .eq("user_id", userId);
    for (const row of completions ?? []) {
      const record = row as Record<string, unknown>;
      completionById.set(String(record.id), record);
    }
  }

  return {
    run: {
      id: run.id,
      analysisId: run.analysis_id,
      status: run.status,
      selectionLimit: run.selection_limit,
      concurrency: run.concurrency,
      maxEstimatedHours: run.max_estimated_hours,
      maxEstimatedCostUsd: run.max_estimated_cost_usd,
      stopOnFailure: run.stop_on_failure,
      requestedCount: run.requested_count,
      plannedCount: run.planned_count,
      succeededCount: run.succeeded_count,
      failedCount: run.failed_count,
      verifyingCount: run.verifying_count,
      skippedCount: run.skipped_count,
      estimatedHoursSelected: run.estimated_hours_selected,
      estimatedCostSelected: run.estimated_cost_selected,
      autonomyAcknowledgedAt: run.autonomy_acknowledged_at,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
    },
    items: ((items ?? []) as PortfolioItemRow[]).map((item) => {
      const completion = item.completion_run_id ? completionById.get(item.completion_run_id) : null;
      return {
        id: item.id,
        repo: item.repo,
        rank: item.rank,
        status: item.status,
        estimatedHours: item.estimated_hours,
        estimatedCostUsd: item.estimated_cost_usd,
        error: item.error,
        completionRunId: item.completion_run_id,
        prNumber: completion?.pr_number ?? null,
        prUrl: completion?.pr_url ?? null,
        ciStatus: completion?.ci_status ?? null,
        outcomeScore: completion?.outcome_score ?? null,
      };
    }),
  };
}

router.post(
  "/repo-finisher/portfolio-runs",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        analysisId: z.string().uuid(),
        selection: z.union([z.literal(5), z.literal(10), z.literal(25), z.literal("all")]).default(5),
        concurrency: z.number().int().min(1).max(5).default(2),
        maxEstimatedHours: z.number().positive().max(100000).optional(),
        maxEstimatedCostUsd: z.number().positive().max(100000000).optional(),
        stopOnFailure: z.boolean().default(false),
        autonomyAcknowledged: z.literal(true),
      })
      .parse(req.body);

    const userId = req.userId!;
    const { data: analysis, error: analysisError } = await req.supabase!
      .from("analyses")
      .select("investment_intelligence")
      .eq("id", input.analysisId)
      .eq("user_id", userId)
      .maybeSingle();
    if (analysisError) throw new Error(`Failed to load portfolio intelligence: ${analysisError.message}`);
    if (!analysis) throw Object.assign(new Error("Analysis not found."), { status: 404 });

    const intelligence = (analysis as Record<string, unknown>).investment_intelligence;
    const ranking = intelligence && typeof intelligence === "object"
      ? (intelligence as Record<string, unknown>).ranking
      : null;
    if (!Array.isArray(ranking) || ranking.length === 0) {
      throw Object.assign(
        new Error("Calculate Full Portfolio Value first so RepoFinisher has a ranked, evidence-backed portfolio to execute."),
        { status: 409 },
      );
    }

    const limit = input.selection === "all" ? Math.min(500, ranking.length) : Math.min(input.selection, ranking.length);
    const candidates = (ranking.slice(0, limit) as RankingEntry[]).filter((entry) => typeof entry.repo === "string" && entry.repo.length > 0);
    if (candidates.length === 0) throw Object.assign(new Error("No executable repositories were found in this portfolio ranking."), { status: 400 });

    let selectedHours = 0;
    let selectedCost = 0;
    let selectedCount = 0;
    const itemRows = candidates.map((entry, index) => {
      const hours = Math.max(0, numeric(entry.remainingWork?.hours, 0));
      const cost = Math.max(0, numeric(entry.remainingWork?.costUsd?.high, 0));
      const exceedsHours = input.maxEstimatedHours !== undefined && selectedHours + hours > input.maxEstimatedHours;
      const exceedsCost = input.maxEstimatedCostUsd !== undefined && selectedCost + cost > input.maxEstimatedCostUsd;
      const skipped = exceedsHours || exceedsCost;
      if (!skipped) {
        selectedHours += hours;
        selectedCost += cost;
        selectedCount += 1;
      }
      return {
        repo: entry.repo,
        rank: numeric(entry.rank, index + 1),
        status: skipped ? "skipped" : "queued",
        estimated_hours: hours,
        estimated_cost_usd: cost,
        next_steps: stringList(entry.details?.recommendedNextSteps),
        error: skipped ? "Excluded by the Finish Portfolio budget limits." : null,
      };
    });
    if (selectedCount === 0) {
      throw Object.assign(new Error("The configured budget excludes every selected repository. Increase the budget or reduce the selection."), { status: 400 });
    }

    const now = new Date().toISOString();
    const { data: portfolioRun, error: runError } = await req.supabase!
      .from("portfolio_completion_runs")
      .insert({
        user_id: userId,
        analysis_id: input.analysisId,
        status: "queued",
        selection_limit: limit,
        concurrency: input.concurrency,
        max_estimated_hours: input.maxEstimatedHours ?? null,
        max_estimated_cost_usd: input.maxEstimatedCostUsd ?? null,
        stop_on_failure: input.stopOnFailure,
        auto_execute: true,
        autonomy_acknowledged_at: now,
        requested_count: candidates.length,
        planned_count: selectedCount,
        skipped_count: candidates.length - selectedCount,
        estimated_hours_selected: selectedHours,
        estimated_cost_selected: selectedCost,
        created_at: now,
        updated_at: now,
      })
      .select("*")
      .single();
    if (runError || !portfolioRun) throw new Error(`Failed to create Finish Portfolio run: ${runError?.message ?? "unknown database error"}`);

    const run = portfolioRun as PortfolioRunRow;
    const { error: itemError } = await req.supabase!.from("portfolio_completion_items").insert(
      itemRows.map((item) => ({ ...item, portfolio_run_id: run.id, user_id: userId, created_at: now, updated_at: now })),
    );
    if (itemError) {
      await req.supabase!.from("portfolio_completion_runs").delete().eq("id", run.id).eq("user_id", userId);
      throw new Error(`Failed to create Finish Portfolio items: ${itemError.message}`);
    }

    kickPortfolioRun(req.supabase!, userId, run.id);
    res.status(202).json(await portfolioRunResponse(req.supabase!, userId, run.id));
  }),
);

router.get(
  "/repo-finisher/portfolio-runs/:runId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(req.params);
    const run = await loadPortfolioRun(req.supabase!, req.userId!, runId);
    if (ACTIVE_PORTFOLIO_STATUSES.includes(run.status as (typeof ACTIVE_PORTFOLIO_STATUSES)[number])) {
      kickPortfolioRun(req.supabase!, req.userId!, runId);
    }
    res.json(await portfolioRunResponse(req.supabase!, req.userId!, runId));
  }),
);

router.get(
  "/repo-finisher/portfolio-runs",
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = z.object({ analysisId: z.string().uuid().optional() }).parse(req.query);
    let request = req.supabase!
      .from("portfolio_completion_runs")
      .select("*")
      .eq("user_id", req.userId!)
      .order("created_at", { ascending: false })
      .limit(10);
    if (query.analysisId) request = request.eq("analysis_id", query.analysisId);
    const { data, error } = await request;
    if (error) throw new Error(`Failed to list Finish Portfolio runs: ${error.message}`);
    res.json(data ?? []);
  }),
);

router.post(
  "/repo-finisher/portfolio-runs/:runId/cancel",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(req.params);
    const run = await loadPortfolioRun(req.supabase!, req.userId!, runId);
    if (!ACTIVE_PORTFOLIO_STATUSES.includes(run.status as (typeof ACTIVE_PORTFOLIO_STATUSES)[number])) {
      throw Object.assign(new Error(`Portfolio run cannot be cancelled from status ${run.status}.`), { status: 409 });
    }
    const now = new Date().toISOString();
    await Promise.all([
      req.supabase!
        .from("portfolio_completion_runs")
        .update({ status: "cancelled", completed_at: now, worker_token: null, lease_expires_at: null, updated_at: now })
        .eq("id", runId)
        .eq("user_id", req.userId!)
        .in("status", [...ACTIVE_PORTFOLIO_STATUSES]),
      req.supabase!
        .from("portfolio_completion_items")
        .update({ status: "cancelled", error: "Portfolio run cancelled by user.", completed_at: now, updated_at: now })
        .eq("portfolio_run_id", runId)
        .eq("user_id", req.userId!)
        .eq("status", "queued"),
    ]);
    res.json(await portfolioRunResponse(req.supabase!, req.userId!, runId));
  }),
);

export default router;
