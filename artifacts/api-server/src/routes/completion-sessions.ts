import { Router, type IRouter } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { requireAuth } from "../middlewares/auth";
import { loadBaselineInvestmentMetrics } from "../lib/post-run-evolution";
import {
  listCompletionSessionEvents,
  loadCompletionSession,
} from "../lib/completion-session-worker";
import { scheduleCompletionSession } from "../lib/completion-session-scheduler";

const router: IRouter = Router();

const createSchema = z.object({
  repo: z.string().regex(/^[A-Za-z0-9.-]+\/[A-Za-z0-9._-]+$/),
  analysisId: z.string().uuid(),
  itemRank: z.number().int().nonnegative().optional(),
  nextSteps: z.array(z.string().min(1).max(1000)).max(25).default([]),
  targetCompletionPct: z.number().int().min(70).max(100).default(95),
  targetReadinessPct: z.number().int().min(70).max(100).default(90),
  maxIterations: z.number().int().min(1).max(12).default(5),
  maxNoProgressIterations: z.number().int().min(1).max(5).default(2),
  maxEstimatedCostUsd: z.number().positive().max(1_000_000).optional(),
  boundedAutonomyAcknowledged: z.literal(true),
});

router.post(
  "/repo-finisher/completion-sessions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const userId = req.userId!;
    const existing = await req.supabase!
      .from("repo_completion_sessions")
      .select("id, status, phase, created_at")
      .eq("user_id", userId)
      .eq("repo", input.repo)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing.error) throw new Error(`Failed to check active completion sessions: ${existing.error.message}`);
    if (existing.data) {
      throw Object.assign(new Error(`An active finish-until-target session already exists for ${input.repo}. Resume or cancel that session before starting another.`), { status: 409 });
    }

    const baseline = await loadBaselineInvestmentMetrics(req.supabase!, userId, input.analysisId, input.repo);
    if (!baseline || baseline.completionPct === null || baseline.productionReadinessPct === null) {
      throw Object.assign(new Error("Finish-until-target requires a current Investment Intelligence analysis with measured completion and production-readiness scores for this repository."), { status: 409 });
    }
    const now = new Date().toISOString();
    const alreadyComplete = baseline.completionPct >= input.targetCompletionPct &&
      baseline.productionReadinessPct >= input.targetReadinessPct;
    const { data: session, error } = await req.supabase!
      .from("repo_completion_sessions")
      .insert({
        user_id: userId,
        repo: input.repo,
        analysis_id: input.analysisId,
        status: alreadyComplete ? "succeeded" : "active",
        phase: alreadyComplete ? "complete" : "queued",
        target_completion_pct: input.targetCompletionPct,
        target_readiness_pct: input.targetReadinessPct,
        max_iterations: input.maxIterations,
        max_no_progress_iterations: input.maxNoProgressIterations,
        iteration_count: 0,
        no_progress_count: 0,
        last_completion_pct: baseline.completionPct,
        last_readiness_pct: baseline.productionReadinessPct,
        max_estimated_cost_usd: input.maxEstimatedCostUsd ?? null,
        estimated_cost_used_usd: 0,
        requested_next_steps: input.nextSteps,
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

    await req.supabase!.from("repo_completion_session_events").insert({
      session_id: session.id,
      user_id: userId,
      iteration: null,
      kind: "session_created",
      status: alreadyComplete ? "success" : "info",
      message: alreadyComplete
        ? `Repository already meets the requested completion/readiness targets; no branch write was necessary.`
        : `Bounded finish-until-target session created. It may perform up to ${input.maxIterations} exact-plan iterations on one draft PR, with bounded CI repair, no-progress stopping, and automatic merge disabled.`,
      metadata: {
        baseline,
        targets: { completionPct: input.targetCompletionPct, readinessPct: input.targetReadinessPct },
        maxIterations: input.maxIterations,
        maxNoProgressIterations: input.maxNoProgressIterations,
        maxEstimatedCostUsd: input.maxEstimatedCostUsd ?? null,
        automaticMerge: false,
      },
    });

    const workerMode = alreadyComplete
      ? null
      : await scheduleCompletionSession(req.supabase!, userId, String(session.id));
    res.status(201).json({ session, baseline, scheduled: !alreadyComplete, workerMode, automaticMerge: false });
  }),
);

router.get(
  "/repo-finisher/completion-sessions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = z.object({ repo: z.string().optional(), status: z.enum(["active", "succeeded", "blocked", "budget_exhausted", "cancelled"]).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(req.query);
    let request = req.supabase!
      .from("repo_completion_sessions")
      .select("*")
      .eq("user_id", req.userId!)
      .order("created_at", { ascending: false })
      .limit(query.limit);
    if (query.repo) request = request.eq("repo", query.repo);
    if (query.status) request = request.eq("status", query.status);
    const { data, error } = await request;
    if (error) throw new Error(`Failed to list completion sessions: ${error.message}`);
    res.json(data ?? []);
  }),
);

router.get(
  "/repo-finisher/completion-sessions/:sessionId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { sessionId } = z.object({ sessionId: z.string().uuid() }).parse(req.params);
    const session = await loadCompletionSession(req.supabase!, req.userId!, sessionId);
    if (session.status === "active") await scheduleCompletionSession(req.supabase!, req.userId!, sessionId);
    const [events, runs] = await Promise.all([
      listCompletionSessionEvents(req.supabase!, req.userId!, sessionId),
      req.supabase!
        .from("completion_runs")
        .select("id, status, session_iteration, base_sha, head_sha, branch_name, pr_number, pr_url, ci_status, repair_attempts, max_repair_attempts, prompt_version, outcome_score, outcome_metrics, error, created_at, updated_at, evaluated_at")
        .eq("user_id", req.userId!)
        .eq("completion_session_id", sessionId)
        .order("session_iteration", { ascending: true }),
    ]);
    if (runs.error) throw new Error(`Failed to load completion-session iterations: ${runs.error.message}`);
    res.json({ session, iterations: runs.data ?? [], events, automaticMerge: false });
  }),
);

router.post(
  "/repo-finisher/completion-sessions/:sessionId/resume",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { sessionId } = z.object({ sessionId: z.string().uuid() }).parse(req.params);
    const session = await loadCompletionSession(req.supabase!, req.userId!, sessionId);
    if (session.status !== "active") {
      throw Object.assign(new Error(`Session cannot resume from terminal status ${session.status}.`), { status: 409 });
    }
    const workerMode = await scheduleCompletionSession(req.supabase!, req.userId!, sessionId);
    res.status(202).json({ sessionId, status: session.status, phase: session.phase, scheduled: true, workerMode });
  }),
);

router.post(
  "/repo-finisher/completion-sessions/:sessionId/cancel",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { sessionId } = z.object({ sessionId: z.string().uuid() }).parse(req.params);
    const session = await loadCompletionSession(req.supabase!, req.userId!, sessionId);
    if (session.status !== "active") {
      throw Object.assign(new Error(`Session cannot be cancelled from terminal status ${session.status}.`), { status: 409 });
    }
    const now = new Date().toISOString();
    const reason = "Cancelled by user. Existing draft PR/branch is preserved for inspection; nothing is automatically merged or deleted.";
    const { error } = await req.supabase!
      .from("repo_completion_sessions")
      .update({ status: "cancelled", phase: "blocked", stop_reason: reason, worker_token: null, lease_expires_at: null, completed_at: now, updated_at: now })
      .eq("id", sessionId)
      .eq("user_id", req.userId!)
      .eq("status", "active");
    if (error) throw new Error(`Failed to cancel completion session: ${error.message}`);
    await req.supabase!.from("repo_completion_session_events").insert({
      session_id: sessionId,
      user_id: req.userId!,
      iteration: session.iteration_count || null,
      kind: "session_cancelled",
      status: "warning",
      message: reason,
      metadata: { branch: session.branch_name, prUrl: session.pr_url },
    });
    res.json({ sessionId, status: "cancelled", cancelledAt: now, branch: session.branch_name, prUrl: session.pr_url });
  }),
);

export default router;
