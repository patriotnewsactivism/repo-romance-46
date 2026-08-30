import { setTimeout as sleep } from "node:timers/promises";
import { backgroundTaskCount, drainBackgroundTasks } from "./lib/background-tasks";
import { createServiceSupabaseClient } from "./lib/service-supabase";
import { loadCompletionSession, processCompletionSession } from "./lib/completion-session-worker";

const JOB_BUDGET_MS = 27 * 60_000;
const BACKGROUND_DRAIN_MS = 7 * 60_000;

function requireUuidEnv(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${name} must be a UUID.`);
  }
  return value;
}

function retryDelayMs(phase: string) {
  if (phase === "queued" || phase === "replanning" || phase === "planning" || phase === "executing") return 2_000;
  if (phase === "repairing") return 5_000;
  return 12_000;
}

async function main() {
  const userId = requireUuidEnv("REPOFINISHER_USER_ID");
  const sessionId = requireUuidEnv("REPOFINISHER_SESSION_ID");
  const supabase = createServiceSupabaseClient();
  const deadline = Date.now() + JOB_BUDGET_MS;

  console.log(JSON.stringify({
    level: "info",
    event: "completion_session_job_started",
    sessionId,
  }));

  while (Date.now() < deadline) {
    await processCompletionSession(supabase, userId, sessionId);

    // CI repair currently uses the shared background-task tracker. A Cloud Run
    // Job must explicitly drain it because there is no HTTP server shutdown hook
    // keeping the process alive for repair promises.
    if (backgroundTaskCount() > 0) {
      await drainBackgroundTasks(Math.min(BACKGROUND_DRAIN_MS, Math.max(1_000, deadline - Date.now())));
    }

    const session = await loadCompletionSession(supabase, userId, sessionId);
    if (session.status !== "active") {
      console.log(JSON.stringify({
        level: "info",
        event: "completion_session_job_finished",
        sessionId,
        status: session.status,
        phase: session.phase,
        iterations: session.iteration_count,
      }));
      return;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 1_000) break;
    await sleep(Math.min(retryDelayMs(session.phase), remaining - 250));
  }

  const session = await loadCompletionSession(supabase, userId, sessionId);
  console.log(JSON.stringify({
    level: "info",
    event: "completion_session_job_yielded",
    sessionId,
    status: session.status,
    phase: session.phase,
    iterations: session.iteration_count,
    message: "Cloud Run Job execution budget reached. The durable session remains resumable and can be dispatched again without duplicating branch writes.",
  }));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({
    level: "error",
    event: "completion_session_job_failed",
    message,
  }));
  process.exitCode = 1;
});
