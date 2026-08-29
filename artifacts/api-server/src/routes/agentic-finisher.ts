import { Router, type IRouter } from "express";
import { runInBackground } from "../lib/background-tasks";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "../lib/async-handler";
import { createAgenticPreview } from "../lib/agentic-preview";
import {
  claimAsyncJob,
  completeAsyncJob,
  createAsyncJob,
  dispatchNetlifyBackgroundJob,
  failAsyncJob,
  isNetlifyRuntime,
} from "../lib/platform-jobs";

const router: IRouter = Router();

const inputSchema = z.object({
  repo: z.string().regex(/^[A-Za-z0-9.-]+\/[A-Za-z0-9._-]+$/),
  nextSteps: z.array(z.string().min(1).max(500)).max(25).optional(),
  analysisId: z.string().uuid().optional(),
  itemRank: z.number().int().nonnegative().optional(),
  boundedAutonomyAcknowledged: z.boolean().default(false),
});

async function runAgenticPreviewJob(
  supabase: NonNullable<Express.Request["supabase"]>,
  userId: string,
  jobId: string,
) {
  const claimed = await claimAsyncJob(supabase, userId, jobId);
  if (!claimed?.lease_token) return;
  try {
    const input = inputSchema.parse(claimed.payload);
    const result = await createAgenticPreview(supabase, userId, input);
    await completeAsyncJob(supabase, userId, jobId, claimed.lease_token, result);
  } catch (error) {
    await failAsyncJob(
      supabase,
      userId,
      jobId,
      claimed.lease_token,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function keepAlive(job: Promise<unknown>) {
  try {
    runInBackground(job);
  } catch {
    void job.catch(() => undefined);
  }
}

router.post(
  "/repo-finisher/agentic-preview",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = inputSchema.parse(req.body);
    const result = await createAgenticPreview(req.supabase!, req.userId!, input);
    res.status(201).json(result);
  }),
);

/**
 * Background-capable agentic planning endpoint.
 *
 * Netlify's synchronous Functions have a non-configurable 60 second execution
 * limit, while RepoFinisher's multi-agent council + evidence critic + coding
 * planner can legitimately take several minutes. The UI uses this endpoint so
 * deep reasoning is never shortened just to fit a hosting timeout.
 */
router.post(
  "/repo-finisher/agentic-preview-async",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = inputSchema.parse(req.body);
    const job = await createAsyncJob(req.supabase!, req.userId!, "agentic_preview", input, 2);

    try {
      if (isNetlifyRuntime()) {
        await dispatchNetlifyBackgroundJob(job.id, req.userId!);
      } else {
        keepAlive(runAgenticPreviewJob(req.supabase!, req.userId!, job.id));
      }
    } catch (error) {
      await req.supabase!
        .from("async_jobs")
        .update({
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("user_id", req.userId!);
      throw error;
    }

    res.status(202).json({
      jobId: job.id,
      kind: job.kind,
      status: "queued",
      pollUrl: `/api/repo-finisher/async-jobs/${job.id}`,
    });
  }),
);

export default router;
