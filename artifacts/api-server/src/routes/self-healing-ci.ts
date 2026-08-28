import { Router, type IRouter } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { requireAuth } from "../middlewares/auth";
import { tryScheduleCiRepair, type SelfHealingRun } from "../lib/ci-repair";
import { verifyCommitChecks } from "../lib/repo-finisher-engine";

const router: IRouter = Router();

async function loadRun(req: Parameters<typeof requireAuth>[0], runId: string) {
  const { data, error } = await req.supabase!
    .from("completion_runs")
    .select("*")
    .eq("id", runId)
    .eq("user_id", req.userId!)
    .maybeSingle();
  if (error) throw new Error(`Failed to load completion run: ${error.message}`);
  if (!data) throw Object.assign(new Error("Completion run not found."), { status: 404 });
  return data as unknown as SelfHealingRun & Record<string, unknown>;
}

async function reopenFailedRunForRepair(req: Parameters<typeof requireAuth>[0], run: SelfHealingRun & Record<string, unknown>) {
  if (run.status !== "failed") return run;
  const attempts = Number(run.repair_attempts ?? 0);
  const maxAttempts = Number(run.max_repair_attempts ?? 2);
  if (!run.auto_repair_enabled || attempts >= maxAttempts || !run.branch_name || !run.head_sha) return run;
  const now = new Date().toISOString();
  const { data, error } = await req.supabase!
    .from("completion_runs")
    .update({
      status: "verifying",
      ci_status: "failed",
      error: null,
      evaluated_at: null,
      outcome_metrics: null,
      outcome_score: null,
      updated_at: now,
    })
    .eq("id", run.id)
    .eq("user_id", req.userId!)
    .eq("status", "failed")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`Failed to reopen completion run for repair: ${error.message}`);
  if (!data) return run;
  await req.supabase!
    .from("completion_steps")
    .update({ status: "verifying", error: null, completed_at: null, updated_at: now })
    .eq("run_id", run.id)
    .eq("user_id", req.userId!);
  return data as unknown as SelfHealingRun & Record<string, unknown>;
}

router.post(
  "/repo-finisher/runs/:runId/repair-policy",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(req.params);
    const body = z.object({
      enabled: z.boolean(),
      maxAttempts: z.number().int().min(0).max(5).default(2),
    }).parse(req.body);
    const run = await loadRun(req, runId);
    if (!["awaiting_approval", "approved", "executing", "verifying", "repairing", "failed"].includes(run.status)) {
      throw Object.assign(new Error(`CI repair policy cannot be changed from status ${run.status}.`), { status: 409 });
    }
    const attempts = Number(run.repair_attempts ?? 0);
    if (body.maxAttempts < attempts) {
      throw Object.assign(new Error(`maxAttempts cannot be lower than the ${attempts} repair attempt(s) already used.`), { status: 409 });
    }
    const { error } = await req.supabase!
      .from("completion_runs")
      .update({
        auto_repair_enabled: body.enabled,
        max_repair_attempts: body.maxAttempts,
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("user_id", req.userId!);
    if (error) throw new Error(`Failed to save CI repair policy: ${error.message}`);
    res.json({ runId, enabled: body.enabled, maxAttempts: body.maxAttempts });
  }),
);

router.post(
  "/repo-finisher/runs/:runId/self-heal",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(req.params);
    let run = await loadRun(req, runId);
    if (!run.auto_repair_enabled) {
      return res.json({ runId, scheduled: false, status: run.status, reason: "Self-healing CI is not enabled for this run." });
    }
    if (run.status === "repairing") {
      return res.json({ runId, scheduled: true, status: "repairing", repairAttempts: run.repair_attempts ?? 0 });
    }
    run = await reopenFailedRunForRepair(req, run);
    if (run.status !== "verifying" || !run.head_sha) {
      return res.json({ runId, scheduled: false, status: run.status, reason: `Run is not repairable from status ${run.status}.` });
    }

    const verification = await verifyCommitChecks(req.supabase!, req.userId!, run.repo, run.head_sha);
    if (verification.state !== "failed") {
      return res.json({ runId, scheduled: false, status: run.status, verification });
    }
    const scheduled = await tryScheduleCiRepair(req.supabase!, req.userId!, run, verification);
    const latest = await loadRun(req, runId);
    res.json({
      runId,
      scheduled,
      status: latest.status,
      repairAttempts: latest.repair_attempts ?? 0,
      maxRepairAttempts: latest.max_repair_attempts ?? 2,
      verification,
    });
  }),
);

router.post(
  "/repo-finisher/portfolio-runs/:runId/self-heal",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(req.params);
    const { data: portfolioRun, error: portfolioError } = await req.supabase!
      .from("portfolio_completion_runs")
      .select("id, status, autonomy_acknowledged_at")
      .eq("id", runId)
      .eq("user_id", req.userId!)
      .maybeSingle();
    if (portfolioError) throw new Error(`Failed to load portfolio run: ${portfolioError.message}`);
    if (!portfolioRun) throw Object.assign(new Error("Portfolio completion run not found."), { status: 404 });

    const { data: failedItems, error: itemError } = await req.supabase!
      .from("portfolio_completion_items")
      .select("id, completion_run_id")
      .eq("portfolio_run_id", runId)
      .eq("user_id", req.userId!)
      .eq("status", "failed")
      .not("completion_run_id", "is", null)
      .order("rank", { ascending: true })
      .limit(5);
    if (itemError) throw new Error(`Failed to load failed portfolio items: ${itemError.message}`);

    let scheduled = 0;
    for (const item of failedItems ?? []) {
      const completionRunId = String((item as Record<string, unknown>).completion_run_id || "");
      if (!completionRunId) continue;
      let run = await loadRun(req, completionRunId);
      if (run.autonomy_mode !== "bounded_portfolio") continue;
      if (!run.auto_repair_enabled) {
        const { error: policyError } = await req.supabase!
          .from("completion_runs")
          .update({ auto_repair_enabled: true, max_repair_attempts: Math.max(2, Number(run.max_repair_attempts ?? 2)), updated_at: new Date().toISOString() })
          .eq("id", completionRunId)
          .eq("user_id", req.userId!);
        if (policyError) continue;
        run = await loadRun(req, completionRunId);
      }
      run = await reopenFailedRunForRepair(req, run);
      if (run.status !== "verifying" || !run.head_sha) continue;
      const verification = await verifyCommitChecks(req.supabase!, req.userId!, run.repo, run.head_sha);
      if (verification.state !== "failed") continue;
      if (await tryScheduleCiRepair(req.supabase!, req.userId!, run, verification)) {
        scheduled += 1;
        await req.supabase!
          .from("portfolio_completion_items")
          .update({ status: "verifying", error: null, completed_at: null, updated_at: new Date().toISOString() })
          .eq("id", String((item as Record<string, unknown>).id))
          .eq("user_id", req.userId!);
      }
    }

    if (scheduled > 0) {
      await req.supabase!
        .from("portfolio_completion_runs")
        .update({ status: "verifying", completed_at: null, updated_at: new Date().toISOString() })
        .eq("id", runId)
        .eq("user_id", req.userId!);
    }
    res.json({ runId, scheduled, status: scheduled > 0 ? "verifying" : (portfolioRun as Record<string, unknown>).status });
  }),
);

export default router;
