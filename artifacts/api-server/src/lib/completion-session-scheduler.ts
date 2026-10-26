import type { SupabaseClient } from "@supabase/supabase-js";
import { runInBackground } from "./background-tasks";
import { processCompletionSession } from "./completion-session-worker";

export type CompletionWorkerMode =
  | "persistent-worker"
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

export function configuredCompletionWorker(): "persistent-worker" | "in-process" {
  const mode = workerMode();
  if (mode === "persistent" || mode === "persistent-worker" || (!mode && process.env.NODE_ENV === "production")) {
    return "persistent-worker";
  }
  if (mode && mode !== "in-process") throw new Error("Unsupported REPOFINISHER_WORKER_MODE. Use persistent or in-process.");
  return "in-process";
}

/**
 * Production uses a persistent worker service on Contabo that polls durable
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

  if (configuredCompletionWorker() === "persistent-worker") {
    return "persistent-worker";
  }

  runInBackground(processCompletionSession(supabase, userId, sessionId), `completion-session:${sessionId}`);
  return "in-process";
}
