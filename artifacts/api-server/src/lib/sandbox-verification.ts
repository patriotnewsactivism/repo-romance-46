export type SandboxState = "skipped" | "pending" | "passed" | "failed";

export interface SandboxSmokeProbe {
  url: string;
  statusCode: number | null;
  outcome: "passed" | "protected" | "pending" | "failed" | "not_probed";
  message: string;
}

export interface SandboxVerificationResult {
  state: SandboxState;
  deploymentCount: number;
  provider: string | null;
  environment: string | null;
  previewUrl: string | null;
  deploymentState: string | null;
  logUrls: string[];
  databaseChangeDetected: boolean;
  databaseCheckDetected: boolean;
  databaseCheckPassed: boolean | null;
  smoke: SandboxSmokeProbe | null;
  message: string;
}

interface GitHubDeployment {
  id: number;
  environment?: string | null;
  description?: string | null;
  creator?: { login?: string | null } | null;
}

interface GitHubDeploymentStatus {
  state: string;
  environment?: string | null;
  environment_url?: string | null;
  target_url?: string | null;
  log_url?: string | null;
  description?: string | null;
  creator?: { login?: string | null } | null;
  created_at?: string | null;
}

interface GitHubCommitFile {
  filename?: string;
}

interface GitHubCheckRun {
  name?: string;
  status?: string;
  conclusion?: string | null;
}

const GH_API = "https://api.github.com";
const PREVIEW_HOST_SUFFIXES = [
  ".vercel.app",
  ".netlify.app",
  ".onrender.com",
  ".pages.dev",
  ".web.app",
  ".firebaseapp.com",
  ".run.app",
  ".github.io",
] as const;
const TERMINAL_FAILURE_STATES = new Set(["failure", "error"]);
const PENDING_STATES = new Set(["queued", "pending", "in_progress"]);
const SUCCESS_STATES = new Set(["success"]);

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "repo-finisher",
  };
}

async function ghJson<T>(token: string, path: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${GH_API}${path}`, {
      headers: ghHeaders(token),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function isSafePreviewHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!normalized || normalized === "localhost") return false;
  return PREVIEW_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix) && normalized.length > suffix.length);
}

export function safePreviewUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
    if (!isSafePreviewHost(parsed.hostname)) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

export function reduceDeploymentState(states: string[]): "pending" | "passed" | "failed" | "unknown" {
  const normalized = states.map((state) => state.toLowerCase());
  if (normalized.some((state) => TERMINAL_FAILURE_STATES.has(state))) return "failed";
  if (normalized.some((state) => PENDING_STATES.has(state))) return "pending";
  if (normalized.some((state) => SUCCESS_STATES.has(state))) return "passed";
  return "unknown";
}

function inferProvider(status: GitHubDeploymentStatus | null, deployment: GitHubDeployment | null): string | null {
  const text = [
    status?.creator?.login,
    deployment?.creator?.login,
    status?.description,
    deployment?.description,
    status?.environment,
    deployment?.environment,
    status?.environment_url,
    status?.target_url,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/vercel/.test(text)) return "vercel";
  if (/netlify/.test(text)) return "netlify";
  if (/render/.test(text)) return "render";
  if (/firebase|web\.app/.test(text)) return "firebase";
  if (/cloud run|run\.app/.test(text)) return "cloud-run";
  if (/cloudflare|pages\.dev/.test(text)) return "cloudflare-pages";
  if (/github pages|github\.io/.test(text)) return "github-pages";
  return null;
}

function deploymentRank(deployment: GitHubDeployment, status: GitHubDeploymentStatus | null): number {
  const environment = `${status?.environment ?? ""} ${deployment.environment ?? ""}`.toLowerCase();
  let score = 0;
  if (/preview/.test(environment)) score += 100;
  if (/staging|development|dev/.test(environment)) score += 80;
  if (/production|prod/.test(environment)) score -= 100;
  if (safePreviewUrl(status?.environment_url) || safePreviewUrl(status?.target_url)) score += 25;
  if (status?.state === "success") score += 10;
  return score;
}

function hasDatabaseChange(files: GitHubCommitFile[] | undefined): boolean {
  return (files ?? []).some((file) => {
    const path = String(file.filename || "").toLowerCase();
    return (
      path.startsWith("supabase/migrations/") ||
      path.startsWith("migrations/") ||
      path.includes("/migrations/") ||
      path.endsWith("schema.sql") ||
      path.endsWith("prisma/schema.prisma")
    );
  });
}

function databaseCheckSummary(checks: GitHubCheckRun[] | undefined) {
  const databaseChecks = (checks ?? []).filter((check) =>
    /supabase|database|migration|schema|prisma/i.test(String(check.name || "")),
  );
  if (databaseChecks.length === 0) {
    return { detected: false, passed: null as boolean | null };
  }
  const failed = databaseChecks.some((check) =>
    ["failure", "timed_out", "cancelled", "action_required", "startup_failure"].includes(String(check.conclusion || "")),
  );
  const pending = databaseChecks.some((check) => String(check.status || "") !== "completed");
  return { detected: true, passed: failed ? false : pending ? null : true };
}

async function smokePreview(url: string): Promise<SandboxSmokeProbe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        "User-Agent": "RepoFinisher-Sandbox-Validator/1.0",
      },
      signal: controller.signal,
    });
    if (response.status >= 200 && response.status < 400) {
      return {
        url,
        statusCode: response.status,
        outcome: "passed",
        message: `Preview answered HTTP ${response.status}.`,
      };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        url,
        statusCode: response.status,
        outcome: "protected",
        message: `Preview is access-protected (HTTP ${response.status}); provider deployment success is retained but anonymous smoke coverage is unavailable.`,
      };
    }
    if (response.status >= 500) {
      return {
        url,
        statusCode: response.status,
        outcome: "failed",
        message: `Preview returned HTTP ${response.status}.`,
      };
    }
    return {
      url,
      statusCode: response.status,
      outcome: "failed",
      message: `Preview root returned HTTP ${response.status}.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      url,
      statusCode: null,
      outcome: "pending",
      message: /abort/i.test(message)
        ? "Preview smoke request timed out; validation will retry while the run remains verifying."
        : `Preview is not reachable yet: ${message.slice(0, 180)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyDeploymentSandbox(
  token: string,
  repo: string,
  headSha: string,
): Promise<SandboxVerificationResult> {
  const [deployments, commit, checksResponse] = await Promise.all([
    ghJson<GitHubDeployment[]>(token, `/repos/${repo}/deployments?sha=${encodeURIComponent(headSha)}&per_page=20`),
    ghJson<{ files?: GitHubCommitFile[] }>(token, `/repos/${repo}/commits/${encodeURIComponent(headSha)}`),
    ghJson<{ check_runs?: GitHubCheckRun[] }>(token, `/repos/${repo}/commits/${encodeURIComponent(headSha)}/check-runs?per_page=100`),
  ]);

  const databaseChangeDetected = hasDatabaseChange(commit?.files);
  const dbCheck = databaseCheckSummary(checksResponse?.check_runs);
  const deploymentList = deployments ?? [];

  if (deploymentList.length === 0) {
    const databaseNote = databaseChangeDetected && !dbCheck.detected
      ? " Database/schema changes are present, but no explicit database sandbox check was reported."
      : "";
    return {
      state: "skipped",
      deploymentCount: 0,
      provider: null,
      environment: null,
      previewUrl: null,
      deploymentState: null,
      logUrls: [],
      databaseChangeDetected,
      databaseCheckDetected: dbCheck.detected,
      databaseCheckPassed: dbCheck.passed,
      smoke: null,
      message: `No GitHub deployment provider exposed an isolated preview for this commit.${databaseNote}`,
    };
  }

  const withStatuses = await Promise.all(
    deploymentList.map(async (deployment) => {
      const statuses = await ghJson<GitHubDeploymentStatus[]>(
        token,
        `/repos/${repo}/deployments/${deployment.id}/statuses?per_page=20`,
      );
      return { deployment, statuses: statuses ?? [], latest: (statuses ?? [])[0] ?? null };
    }),
  );
  withStatuses.sort((a, b) => deploymentRank(b.deployment, b.latest) - deploymentRank(a.deployment, a.latest));
  const selected = withStatuses[0];
  const allStates = selected.statuses.map((status) => String(status.state || "").toLowerCase());
  const reduced = reduceDeploymentState(allStates);
  const latest = selected.latest;
  const previewUrl = safePreviewUrl(latest?.environment_url) ?? safePreviewUrl(latest?.target_url);
  const logUrls = [...new Set(selected.statuses.map((status) => status.log_url).filter((url): url is string => Boolean(url)))].slice(0, 5);
  const provider = inferProvider(latest, selected.deployment);
  const environment = latest?.environment ?? selected.deployment.environment ?? null;
  const deploymentState = latest?.state ?? null;

  const base = {
    deploymentCount: deploymentList.length,
    provider,
    environment,
    previewUrl,
    deploymentState,
    logUrls,
    databaseChangeDetected,
    databaseCheckDetected: dbCheck.detected,
    databaseCheckPassed: dbCheck.passed,
  };

  if (reduced === "failed") {
    return {
      ...base,
      state: "failed",
      smoke: null,
      message: `Isolated ${provider ?? "deployment"} preview reported a failed deployment state.`,
    };
  }

  if (reduced === "pending" || reduced === "unknown") {
    return {
      ...base,
      state: "pending",
      smoke: null,
      message: `Isolated ${provider ?? "deployment"} preview is still building or has not reported a terminal success state.`,
    };
  }

  if (!previewUrl) {
    return {
      ...base,
      state: "passed",
      smoke: {
        url: latest?.environment_url || latest?.target_url || "",
        statusCode: null,
        outcome: "not_probed",
        message: "Deployment provider reported success, but its URL was not on the server-side smoke-test allowlist.",
      },
      message: `Isolated ${provider ?? "deployment"} preview reported success; URL probing was safely skipped.`,
    };
  }

  const smoke = await smokePreview(previewUrl);
  if (smoke.outcome === "failed") {
    return {
      ...base,
      state: "failed",
      smoke,
      message: `Isolated preview deployed, but the live smoke probe failed: ${smoke.message}`,
    };
  }
  if (smoke.outcome === "pending") {
    return {
      ...base,
      state: "pending",
      smoke,
      message: smoke.message,
    };
  }

  const databaseNote = databaseChangeDetected
    ? dbCheck.detected
      ? dbCheck.passed === true
        ? " Database migration/schema validation also passed."
        : dbCheck.passed === false
          ? " Database migration/schema validation reported a failure."
          : " Database migration/schema validation is still pending."
      : " Database/schema changes were detected without an explicit disposable-database check; deployment validation is therefore partial for database behavior."
    : "";

  if (databaseChangeDetected && dbCheck.passed === false) {
    return {
      ...base,
      state: "failed",
      smoke,
      message: `Preview smoke passed, but database migration/schema validation failed.${databaseNote}`,
    };
  }
  if (databaseChangeDetected && dbCheck.detected && dbCheck.passed === null) {
    return {
      ...base,
      state: "pending",
      smoke,
      message: `Preview smoke passed; database migration/schema validation is still pending.`,
    };
  }

  return {
    ...base,
    state: "passed",
    smoke,
    message: `Isolated ${provider ?? "deployment"} preview passed deployment and live HTTP smoke validation.${databaseNote}`,
  };
}
