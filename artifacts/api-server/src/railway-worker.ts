import { setTimeout as sleep } from "node:timers/promises";
import { createServiceSupabaseClient } from "./lib/service-supabase";
import { processCompletionSession } from "./lib/completion-session-worker";

const DEFAULT_POLL_MS = 3_000;
const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 8;

function positiveInteger(raw: string | undefined, fallback: number, max: number) {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

const pollMs = positiveInteger(process.env.RAILWAY_WORKER_POLL_MS, DEFAULT_POLL_MS, 60_000);
const concurrency = positiveInteger(
  process.env.RAILWAY_WORKER_CONCURRENCY,
  DEFAULT_CONCURRENCY,
  MAX_CONCURRENCY,
);

let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});

async function loadCandidates() {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("repo_completion_sessions")
    .select("id,user_id,status,phase,worker_token,lease_expires_at,updated_at")
    .eq("status", "active")
    .order("updated_at", { ascending: true })
    .limit(Math.max(concurrency * 4, 20));

  if (error) throw new Error(`Failed to poll completion sessions: ${error.message}`);

  const now = Date.now();
  return (data ?? []).filter((session) => {
    if (!session.worker_token || !session.lease_expires_at) return true;
    const leaseUntil = new Date(String(session.lease_expires_at)).getTime();
    return !Number.isFinite(leaseUntil) || leaseUntil <= now;
  });
}

async function runBatch() {
  const supabase = createServiceSupabaseClient();
  const candidates = await loadCandidates();
  if (!candidates.length) return 0;

  const selected = candidates.slice(0, concurrency);
  const results = await Promise.allSettled(
    selected.map(async (session) => {
      await processCompletionSession(supabase, String(session.user_id), String(session.id));
    }),
  );

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      const session = selected[index];
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.error(JSON.stringify({
        level: "error",
        event: "railway_worker_session_failed",
        sessionId: session?.id,
        message,
      }));
    }
  });

  return selected.length;
}

async function main() {
  createServiceSupabaseClient();
  console.log(JSON.stringify({
    level: "info",
    event: "railway_worker_started",
    concurrency,
    pollMs,
  }));

  while (!stopping) {
    try {
      const processed = await runBatch();
      if (!processed) await sleep(pollMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({
        level: "error",
        event: "railway_worker_poll_failed",
        message,
      }));
      await sleep(Math.min(Math.max(pollMs, 5_000), 30_000));
    }
  }

  console.log(JSON.stringify({
    level: "info",
    event: "railway_worker_stopped",
  }));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({
    level: "fatal",
    event: "railway_worker_crashed",
    message,
  }));
  process.exitCode = 1;
});
