import { Router, type IRouter } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { requireAuth } from "../middlewares/auth";
import { loadOperationalMemory, memoryGuidance } from "../lib/learning-memory";

const router: IRouter = Router();

router.get(
  "/repo-finisher/learning/:repoOwner/:repoName",
  requireAuth,
  asyncHandler(async (req, res) => {
    const params = z.object({ repoOwner: z.string(), repoName: z.string() }).parse(req.params);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(40) }).parse(req.query);
    const repo = `${params.repoOwner}/${params.repoName}`;
    const userId = req.userId!;
    const [memories, tracesResult, runsResult, readinessResult] = await Promise.all([
      loadOperationalMemory(req.supabase!, userId, repo, undefined, query.limit),
      req.supabase!
        .from("reasoning_traces")
        .select("*")
        .eq("user_id", userId)
        .eq("repo", repo)
        .order("created_at", { ascending: false })
        .limit(query.limit),
      req.supabase!
        .from("completion_runs")
        .select("id, repo, status, prompt_version, plan, ci_status, error, repair_attempts, max_repair_attempts, outcome_score, outcome_metrics, head_sha, pr_url, created_at, updated_at, evaluated_at")
        .eq("user_id", userId)
        .eq("repo", repo)
        .order("created_at", { ascending: false })
        .limit(query.limit),
      req.supabase!
        .from("product_readiness_runs")
        .select("*")
        .eq("user_id", userId)
        .eq("repo", repo)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    if (tracesResult.error) throw new Error(`Failed to load reasoning history: ${tracesResult.error.message}`);
    if (runsResult.error) throw new Error(`Failed to load completion history: ${runsResult.error.message}`);
    if (readinessResult.error) throw new Error(`Failed to load readiness history: ${readinessResult.error.message}`);

    const runs = (runsResult.data ?? []) as Array<Record<string, unknown>>;
    const runIds = runs.map((run) => String(run.id));
    let repairAttempts: unknown[] = [];
    let events: unknown[] = [];
    if (runIds.length) {
      const [repairs, eventRows] = await Promise.all([
        req.supabase!
          .from("completion_repair_attempts")
          .select("*")
          .eq("user_id", userId)
          .in("run_id", runIds)
          .order("created_at", { ascending: false })
          .limit(100),
        req.supabase!
          .from("completion_events")
          .select("*")
          .eq("user_id", userId)
          .in("run_id", runIds)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      if (repairs.error) throw new Error(`Failed to load repair history: ${repairs.error.message}`);
      if (eventRows.error) throw new Error(`Failed to load completion events: ${eventRows.error.message}`);
      repairAttempts = repairs.data ?? [];
      events = eventRows.data ?? [];
    }

    const scored = runs.filter(
      (run) => run.outcome_score !== null && run.outcome_score !== undefined && Number.isFinite(Number(run.outcome_score)),
    );
    const averageOutcomeScore = scored.length
      ? Math.round((scored.reduce((sum, run) => sum + Number(run.outcome_score), 0) / scored.length) * 10) / 10
      : null;
    const terminalRuns = runs.filter((run) => ["succeeded", "failed", "stale"].includes(String(run.status)));
    const successRate = terminalRuns.length
      ? Math.round((terminalRuns.filter((run) => run.status === "succeeded").length / terminalRuns.length) * 1000) / 10
      : null;

    res.json({
      repo,
      summary: {
        completionRuns: runs.length,
        terminalCompletionRuns: terminalRuns.length,
        successRate,
        averageOutcomeScore,
        reasoningTraces: (tracesResult.data ?? []).length,
        durableMemories: memories.length,
        repairAttempts: repairAttempts.length,
        latestReadinessScore: (readinessResult.data?.[0] as Record<string, unknown> | undefined)?.score ?? null,
      },
      currentGuidance: memoryGuidance(memories, 20),
      memories,
      reasoningTraces: tracesResult.data ?? [],
      completionRuns: runs,
      repairAttempts,
      completionEvents: events,
      readinessRuns: readinessResult.data ?? [],
    });
  }),
);

router.get(
  "/repo-finisher/audit/run/:runId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(req.params);
    const userId = req.userId!;
    const { data: run, error: runError } = await req.supabase!
      .from("completion_runs")
      .select("*")
      .eq("id", runId)
      .eq("user_id", userId)
      .maybeSingle();
    if (runError) throw new Error(`Failed to load completion run: ${runError.message}`);
    if (!run) throw Object.assign(new Error("Completion run not found."), { status: 404 });

    const [steps, events, repairs, traces] = await Promise.all([
      req.supabase!.from("completion_steps").select("*").eq("run_id", runId).eq("user_id", userId).order("ordinal"),
      req.supabase!.from("completion_events").select("*").eq("run_id", runId).eq("user_id", userId).order("created_at"),
      req.supabase!.from("completion_repair_attempts").select("*").eq("run_id", runId).eq("user_id", userId).order("attempt"),
      req.supabase!.from("reasoning_traces").select("*").eq("completion_run_id", runId).eq("user_id", userId).order("created_at"),
    ]);
    for (const result of [steps, events, repairs, traces]) {
      if (result.error) throw new Error(`Failed to load run audit evidence: ${result.error.message}`);
    }

    res.json({
      run,
      reasoningTraces: traces.data ?? [],
      steps: steps.data ?? [],
      repairAttempts: repairs.data ?? [],
      events: events.data ?? [],
      auditNote: "This view exposes evidence, compact agent hypotheses/critiques, selected strategy, exact-plan binding, repair history, CI/deployment verification, and measured outcomes. It is not a hidden chain-of-thought transcript.",
    });
  }),
);

export default router;
