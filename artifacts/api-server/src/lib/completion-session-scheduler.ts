import type { SupabaseClient } from "@supabase/supabase-js";
import { runInBackground } from "./background-tasks";
import { dispatchCompletionSessionJob } from "./cloud-run-jobs";
import { processCompletionSession } from "./completion-session-worker";

export type CompletionWorkerMode = "cloud-run-job" | "in-process";

/**
 * Dispatch completion-session work to Cloud Run Jobs when the production worker
 * plane is configured. Local development and unconfigured deployments retain a
 * safe in-process fallback so the product remains usable during migration.
 */
export async function scheduleCompletionSession(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
): Promise<CompletionWorkerMode> {
  try {
    if (await dispatchCompletionSessionJob(userId, sessionId)) return "cloud-run-job";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({
      level: "error",
      event: "completion_session_job_dispatch_failed",
      sessionId,
      message,
      fallback: "in-process",
    }));
  }

  runInBackground(processCompletionSession(supabase, userId, sessionId), `completion-session:${sessionId}`);
  return "in-process";
}
