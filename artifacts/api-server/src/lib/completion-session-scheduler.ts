import type { SupabaseClient } from "@supabase/supabase-js";
import { runInBackground } from "./background-tasks";
import { processCompletionSession } from "./completion-session-worker";

export type CompletionWorkerMode =
  | "railway-worker"
  | "in-process"
  | "already-running";

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

  const heartbeat = data.heartbeat_at ? new Date(String(data.heartbeat_at)).getTime() : 0;
  return Number.isFinite(heartbeat) && heartbeat > now - 30_000;
}

function workerMode() {
  return String(process.env.REPOFINISHER_WORKER_MODE || "").trim().toLowerCase();
}

/**
 * Railway production uses a persistent worker service that polls durable
 * completion-session state in Supabase. The API only needs to leave the session
 * active/queued; the worker claims it using the existing row lease/heartbeat
 * contract. Local development keeps the in-process fallback.
 */
export async function scheduleCompletionSession(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
): Promise<CompletionWorkerMode> {
  if (await recentlyActive(supabase, userId, sessionId)) return "already-running";

  const mode = workerMode();
  if (mode === "railway-persistent" || mode === "railway-worker" || mode === "persistent") {
    return "railway-worker";
  }

  runInBackground(processCompletionSession(supabase, userId, sessionId), `completion-session:${sessionId}`);
  return "in-process";
}
