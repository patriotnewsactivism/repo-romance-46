import { createServiceSupabaseClient } from "./lib/service-supabase";
import { processCompletionSession } from "./lib/completion-session-worker";

function requireUuidEnv(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${name} must be a UUID.`);
  }
  return value;
}

async function main() {
  const userId = requireUuidEnv("REPOFINISHER_USER_ID");
  const sessionId = requireUuidEnv("REPOFINISHER_SESSION_ID");
  const supabase = createServiceSupabaseClient();

  console.log(JSON.stringify({
    level: "info",
    event: "completion_session_job_started",
    sessionId,
  }));

  await processCompletionSession(supabase, userId, sessionId);

  console.log(JSON.stringify({
    level: "info",
    event: "completion_session_job_finished",
    sessionId,
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
