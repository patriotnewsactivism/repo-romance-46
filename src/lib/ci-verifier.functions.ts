// CI Verifier — checks GitHub Actions workflow status after PR creation.
// Polls for CI completion, extracts failure logs, and reports results.
// Used by the step sequencer to verify each atomic change before continuing.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ─── Types ─────────────────────────────────────────────────────

export interface CICheckResult {
  status: "pending" | "success" | "failure" | "no_ci" | "timeout";
  checks: CICheck[];
  summary: string;
  failureLogs: string[];
  durationMs: number;
}

export interface CICheck {
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: string | null; // success, failure, cancelled, skipped, etc.
  url: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

// ─── GitHub helpers ────────────────────────────────────────────

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "repo-finisher",
  };
}

async function ghFetch(token: string, path: string): Promise<Response> {
  return fetch(`https://api.github.com${path}`, { headers: ghHeaders(token) });
}

// ─── Poll for CI completion ────────────────────────────────────

async function pollCIStatus(
  token: string,
  repo: string,
  commitSha: string,
  timeoutMs: number = 300000, // 5 min default
  pollIntervalMs: number = 15000, // 15 sec
): Promise<CICheckResult> {
  const started = Date.now();

  // First check if repo even has CI configured
  const workflowRes = await ghFetch(token, `/repos/${repo}/actions/workflows`);
  if (!workflowRes.ok) {
    return {
      status: "no_ci",
      checks: [],
      summary: "Could not access GitHub Actions — either not configured or no permissions.",
      failureLogs: [],
      durationMs: Date.now() - started,
    };
  }
  const workflows = (await workflowRes.json()) as { total_count: number };
  if (workflows.total_count === 0) {
    return {
      status: "no_ci",
      checks: [],
      summary: "No GitHub Actions workflows configured on this repo.",
      failureLogs: [],
      durationMs: Date.now() - started,
    };
  }

  // Poll check runs for the commit
  while (Date.now() - started < timeoutMs) {
    const checkRes = await ghFetch(
      token,
      `/repos/${repo}/commits/${commitSha}/check-runs`,
    );
    if (!checkRes.ok) {
      // May not have checks yet — wait and retry
      await sleep(pollIntervalMs);
      continue;
    }

    const checkData = (await checkRes.json()) as {
      total_count: number;
      check_runs: Array<{
        name: string;
        status: string;
        conclusion: string | null;
        html_url: string | null;
        started_at: string | null;
        completed_at: string | null;
        output?: { title?: string; summary?: string; text?: string };
      }>;
    };

    if (checkData.total_count === 0) {
      // No check runs yet — might still be queuing
      if (Date.now() - started > 60000) {
        // After 1 minute with no checks, likely no CI
        return {
          status: "no_ci",
          checks: [],
          summary: "No CI check runs appeared within 60 seconds. Repo may not have CI configured for this branch.",
          failureLogs: [],
          durationMs: Date.now() - started,
        };
      }
      await sleep(pollIntervalMs);
      continue;
    }

    const checks: CICheck[] = checkData.check_runs.map((cr) => ({
      name: cr.name,
      status: cr.status as CICheck["status"],
      conclusion: cr.conclusion,
      url: cr.html_url,
      startedAt: cr.started_at,
      completedAt: cr.completed_at,
    }));

    // Check if all completed
    const allCompleted = checks.every((c) => c.status === "completed");
    if (allCompleted) {
      const anyFailed = checks.some(
        (c) => c.conclusion === "failure" || c.conclusion === "cancelled",
      );

      // Extract failure logs
      const failureLogs: string[] = [];
      if (anyFailed) {
        for (const cr of checkData.check_runs) {
          if (cr.conclusion === "failure" && cr.output) {
            const log = [
              `### ${cr.name}`,
              cr.output.title ? `**${cr.output.title}**` : "",
              cr.output.summary || "",
              cr.output.text ? cr.output.text.slice(0, 2000) : "",
            ]
              .filter(Boolean)
              .join("\n");
            failureLogs.push(log);
          }
        }

        // Also try to get the actual log output from failed runs
        for (const cr of checkData.check_runs) {
          if (cr.conclusion === "failure" && failureLogs.length < 3) {
            try {
              const annotationsRes = await ghFetch(
                token,
                `/repos/${repo}/check-runs/${(cr as Record<string, unknown>).id}/annotations`,
              );
              if (annotationsRes.ok) {
                const annotations = (await annotationsRes.json()) as Array<{
                  path: string;
                  message: string;
                  annotation_level: string;
                }>;
                if (annotations.length > 0) {
                  const annotLog = annotations
                    .filter((a) => a.annotation_level === "failure")
                    .slice(0, 10)
                    .map((a) => `  ${a.path}: ${a.message}`)
                    .join("\n");
                  if (annotLog) failureLogs.push(`**Annotations (${cr.name}):**\n${annotLog}`);
                }
              }
            } catch {
              // Annotations endpoint may not be available
            }
          }
        }
      }

      const passed = checks.filter((c) => c.conclusion === "success").length;
      const failed = checks.filter((c) => c.conclusion === "failure").length;
      const skipped = checks.filter((c) => c.conclusion === "skipped").length;

      return {
        status: anyFailed ? "failure" : "success",
        checks,
        summary: anyFailed
          ? `CI failed: ${failed}/${checks.length} checks failed. ${passed} passed, ${skipped} skipped.`
          : `CI passed: all ${checks.length} checks succeeded.`,
        failureLogs,
        durationMs: Date.now() - started,
      };
    }

    // Still running — wait and poll again
    await sleep(pollIntervalMs);
  }

  // Timeout
  return {
    status: "timeout",
    checks: [],
    summary: `CI check timed out after ${Math.round(timeoutMs / 1000)}s.`,
    failureLogs: [],
    durationMs: Date.now() - started,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Get PR's head commit SHA ──────────────────────────────────

async function getPRHeadSha(token: string, repo: string, prNumber: number): Promise<string | null> {
  const res = await ghFetch(token, `/repos/${repo}/pulls/${prNumber}`);
  if (!res.ok) return null;
  const pr = (await res.json()) as { head: { sha: string } };
  return pr.head.sha;
}

// ─── Get workflow run logs (truncated) ─────────────────────────

async function getWorkflowRunLogs(
  token: string,
  repo: string,
  commitSha: string,
): Promise<string | null> {
  // Find the workflow run for this commit
  const runsRes = await ghFetch(
    token,
    `/repos/${repo}/actions/runs?head_sha=${commitSha}&per_page=5`,
  );
  if (!runsRes.ok) return null;

  const runs = (await runsRes.json()) as {
    workflow_runs: Array<{
      id: number;
      status: string;
      conclusion: string | null;
      name: string;
    }>;
  };

  const failedRun = runs.workflow_runs.find((r) => r.conclusion === "failure");
  if (!failedRun) return null;

  // Get jobs for the failed run
  const jobsRes = await ghFetch(
    token,
    `/repos/${repo}/actions/runs/${failedRun.id}/jobs`,
  );
  if (!jobsRes.ok) return null;

  const jobs = (await jobsRes.json()) as {
    jobs: Array<{
      name: string;
      conclusion: string | null;
      steps: Array<{
        name: string;
        status: string;
        conclusion: string | null;
        number: number;
      }>;
    }>;
  };

  const failedSteps: string[] = [];
  for (const job of jobs.jobs) {
    if (job.conclusion === "failure") {
      for (const step of job.steps || []) {
        if (step.conclusion === "failure") {
          failedSteps.push(`Job "${job.name}", Step "${step.name}": FAILED`);
        }
      }
    }
  }

  return failedSteps.length > 0
    ? `Failed steps:\n${failedSteps.join("\n")}`
    : `Workflow "${failedRun.name}" failed (no step details available)`;
}

// ─── Server functions ──────────────────────────────────────────

/**
 * Check CI status for a specific PR.
 * Polls GitHub Actions until all checks complete or timeout.
 */
export const checkPRCI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (d: { repo: string; prNumber: number; timeoutMs?: number }) =>
      z
        .object({
          repo: z.string(),
          prNumber: z.number().int(),
          timeoutMs: z.number().int().min(10000).max(600000).optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { data: conn } = await context.supabase
      .from("github_connections")
      .select("access_token")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!conn) throw new Error("Connect GitHub first.");
    const token = (conn as { access_token: string }).access_token;

    const sha = await getPRHeadSha(token, data.repo, data.prNumber);
    if (!sha) throw new Error(`Could not find PR #${data.prNumber} on ${data.repo}`);

    const result = await pollCIStatus(
      token,
      data.repo,
      sha,
      data.timeoutMs ?? 300000,
    );

    // If failed, try to get workflow run logs for extra context
    if (result.status === "failure") {
      const logDetail = await getWorkflowRunLogs(token, data.repo, sha);
      if (logDetail) {
        result.failureLogs.push(logDetail);
      }
    }

    return result;
  });

/**
 * Quick check: does this repo have GitHub Actions CI configured?
 */
export const hasCI = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { repo: string }) => z.object({ repo: z.string() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: conn } = await context.supabase
      .from("github_connections")
      .select("access_token")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!conn) throw new Error("Connect GitHub first.");
    const token = (conn as { access_token: string }).access_token;

    // Check for workflow files
    const res = await ghFetch(token, `/repos/${data.repo}/actions/workflows`);
    if (!res.ok) return { hasCI: false, workflows: 0 };
    const workflows = (await res.json()) as { total_count: number };
    return { hasCI: workflows.total_count > 0, workflows: workflows.total_count };
  });
