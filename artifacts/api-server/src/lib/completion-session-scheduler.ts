import type { SupabaseClient } from "@supabase/supabase-js";
import { runInBackground } from "./background-tasks";
import { dispatchCompletionSessionJob } from "./cloud-run-jobs";
import { processCompletionSession } from "./completion-session-worker";

export type CompletionWorkerMode = "cloud-run-job" | "in-process" | "already-running";

async function recentlyActive(supabase: SupabaseClient, userId: string, sessionId: string) {
  const { data, error } = await supabase
    .from("repo_completion_sessions")
    .select("status, worker_token, lease_expires_at, heartbeat_at")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to inspect completion worker lease: ${error.message}`);
  if (!data || data.status !== "active") return false;

  const now = Date.now();
  const leaseUntil = data.lease_expires_at ? new Date(String(data.lease_expires_at)).getTime() : 0;
  if (data.worker_token && Number.isFinite(leaseUntil) && leaseUntil > now) return true;

  // A Cloud Run Job releases the row-level lease between polling cycles. Treat a
  // very recent heartbeat as ownership too so ordinary UI polling does not spawn
  // duplicate paid job executions during that small gap.
  const heartbeat = data.heartbeat_at ? new Date(String(data.heartbeat_at)).getTime() : 0;
  return Number.isFinite(heartbeat) && heartbeat > now - 30_000;
}

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
  if (await recentlyActive(supabase, userId, sessionId)) return "already-running";

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
