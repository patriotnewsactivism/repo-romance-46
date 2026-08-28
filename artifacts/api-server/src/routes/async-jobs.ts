import { Router, type IRouter } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { requireAuth } from "../middlewares/auth";
import { loadAsyncJob } from "../lib/platform-jobs";

const router: IRouter = Router();

router.get(
  "/repo-finisher/async-jobs/:jobId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { jobId } = z.object({ jobId: z.string().uuid() }).parse(req.params);
    const job = await loadAsyncJob(req.supabase!, req.userId!, jobId);
    res.json({
      id: job.id,
      kind: job.kind,
      status: job.status,
      result: job.status === "succeeded" ? job.result : null,
      error: job.error,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    });
  }),
);

router.post(
  "/repo-finisher/async-jobs/:jobId/cancel",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { jobId } = z.object({ jobId: z.string().uuid() }).parse(req.params);
    const job = await loadAsyncJob(req.supabase!, req.userId!, jobId);
    if (job.status !== "queued") {
      throw Object.assign(new Error(`Background job cannot be cancelled from status ${job.status}.`), { status: 409 });
    }
    const now = new Date().toISOString();
    const { data, error } = await req.supabase!
      .from("async_jobs")
      .update({ status: "cancelled", completed_at: now, updated_at: now })
      .eq("id", jobId)
      .eq("user_id", req.userId!)
      .eq("status", "queued")
      .select("id, status")
      .maybeSingle();
    if (error) throw new Error(`Failed to cancel background job: ${error.message}`);
    if (!data) throw Object.assign(new Error("Background job state changed before cancellation."), { status: 409 });
    res.json(data);
  }),
);

export default router;
