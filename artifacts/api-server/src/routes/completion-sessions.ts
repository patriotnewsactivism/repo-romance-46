import { Router, type IRouter } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { requireAuth } from "../middlewares/auth";
import {
  listCompletionSessionEvents,
  loadCompletionSession,
  retryBlockedIteration,
} from "../lib/completion-session-worker";
import { scheduleCompletionSession } from "../lib/completion-session-scheduler";
import { startCompletionSession } from "../lib/start-completion-session";

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
    const started = await startCompletionSession(req.supabase!, userId, {
      repo: input.repo,
      analysisId: input.analysisId,
      itemRank: input.itemRank,
      nextSteps: input.nextSteps,
      targetCompletionPct: input.targetCompletionPct,
      targetReadinessPct: input.targetReadinessPct,
      maxIterations: input.maxIterations,
      maxNoProgressIterations: input.maxNoProgressIterations,
      maxEstimatedCostUsd: input.maxEstimatedCostUsd,
    });
    res.status(201).json({
      session: started.session,
      baseline: started.baseline,
      scheduled: started.scheduled,
      workerMode: started.workerMode,
      automaticMerge: false,
    });
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
  "/repo-finisher/completion-sessions/:sessionId/retry-iteration",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { sessionId } = z.object({ sessionId: z.string().uuid() }).parse(req.params);
    const { session, retried, workerMode } = await retryBlockedIteration(req.supabase!, req.userId!, sessionId);
    res.status(retried ? 202 : 200).json({
      sessionId,
      status: session.status,
      phase: session.phase,
      iteration: session.iteration_count,
      retried,
      scheduled: retried,
      workerMode,
    });
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
