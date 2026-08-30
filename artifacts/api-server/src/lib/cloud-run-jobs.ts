const CLOUD_RUN_API = "https://run.googleapis.com/v2";
const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

function truthy(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function cloudRunJobConfig() {
  const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "";
  const region = process.env.GCP_REGION || process.env.GOOGLE_CLOUD_REGION || "us-central1";
  const completionSessionJob = process.env.COMPLETION_SESSION_JOB || "repofinisher-completion-session";
  const enabled = truthy(process.env.CLOUD_RUN_JOBS_ENABLED);
  return { enabled, projectId, region, completionSessionJob };
}

async function metadataAccessToken() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(METADATA_TOKEN_URL, {
      headers: { "Metadata-Flavor": "Google" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Google metadata token request failed with HTTP ${response.status}.`);
    }
    const payload = (await response.json()) as { access_token?: string };
    if (!payload.access_token) throw new Error("Google metadata token response did not include an access token.");
    return payload.access_token;
  } finally {
    clearTimeout(timer);
  }
}

export function cloudRunJobsEnabled() {
  const cfg = cloudRunJobConfig();
  return cfg.enabled && Boolean(cfg.projectId && cfg.region && cfg.completionSessionJob);
}

export async function dispatchCompletionSessionJob(userId: string, sessionId: string): Promise<boolean> {
  const cfg = cloudRunJobConfig();
  if (!cfg.enabled) return false;
  if (!cfg.projectId) throw new Error("CLOUD_RUN_JOBS_ENABLED is true but GCP_PROJECT_ID/GOOGLE_CLOUD_PROJECT is missing.");

  const accessToken = await metadataAccessToken();
  const endpoint = `${CLOUD_RUN_API}/projects/${encodeURIComponent(cfg.projectId)}/locations/${encodeURIComponent(cfg.region)}/jobs/${encodeURIComponent(cfg.completionSessionJob)}:run`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        overrides: {
          containerOverrides: [
            {
              env: [
                { name: "REPOFINISHER_USER_ID", value: userId },
                { name: "REPOFINISHER_SESSION_ID", value: sessionId },
              ],
            },
          ],
          taskCount: 1,
          timeout: "1800s",
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`Cloud Run completion-session job dispatch failed with HTTP ${response.status}: ${detail}`);
    }
    return true;
  } finally {
    clearTimeout(timer);
  }
}
