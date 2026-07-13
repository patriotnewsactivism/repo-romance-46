// Autonomous Runner — intelligent background task processing.
// Reasons about repo state, decides what to do next, executes safely,
// logs everything, and learns from outcomes.
//
// Can run as:
// 1. Cron job (periodic sweeps)
// 2. Queue processor (user-initiated background tasks)
// 3. Reactive agent (responds to webhook events like push, PR merge)

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequest } from "@tanstack/react-start/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAI, resolveAIConfig, type AIProviderConfig } from "@/lib/ai-provider";
import { logLearningEntry, type LearningEntry } from "@/lib/learning-log.functions";
import type { Json } from "@/integrations/supabase/types";

// ─── Types ─────────────────────────────────────────────────────

export type JobStatus = "queued" | "running" | "paused" | "complete" | "failed";
export type JobKind =
  | "deep_analysis"
  | "finish_step"
  | "dependency_audit"
  | "test_gap_scan"
  | "health_recheck"
  | "portfolio_sweep"
  | "pattern_review";

export interface BackgroundJob {
  id: string;
  user_id: string;
  repo: string | null;
  kind: JobKind;
  status: JobStatus;
  priority: number; // 0-100, higher = more urgent
  context: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  max_attempts: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  next_step: string | null; // what to do next if this is part of a pipeline
}

export interface ReasoningDecision {
  action: JobKind | "skip" | "wait";
  repo: string | null;
  priority: number;
  reasoning: string;
  context: Record<string, unknown>;
}

// ─── Queue Management ──────────────────────────────────────────

/**
 * Enqueue a background job for processing.
 * Jobs are stored in the background_jobs table and picked up by the runner.
 */
export const enqueueJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (d: {
      repo: string | null;
      kind: JobKind;
      priority?: number;
      context?: Record<string, unknown>;
      nextStep?: string;
    }) =>
      z
        .object({
          repo: z.string().nullable(),
          kind: z.enum([
            "deep_analysis",
            "finish_step",
            "dependency_audit",
            "test_gap_scan",
            "health_recheck",
            "portfolio_sweep",
            "pattern_review",
          ]),
          priority: z.number().min(0).max(100).optional(),
          context: z.record(z.unknown()).optional(),
          nextStep: z.string().optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error, data: job } = await (context.supabase as SupabaseClient)
      .from("background_jobs")
      .insert({
        user_id: context.userId,
        repo: data.repo,
        kind: data.kind,
        status: "queued" as JobStatus,
        priority: data.priority ?? 50,
        context: (data.context ?? {}) as Json,
        max_attempts: 3,
        next_step: data.nextStep ?? null,
      })
      .select("id")
      .single();

    if (error) throw new Error(`Failed to enqueue job: ${error.message}`);
    return { jobId: (job as { id: string }).id, status: "queued" };
  });

/**
 * Get the status of background jobs for the current user.
 */
export const getJobStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { jobId?: string }) =>
    z.object({ jobId: z.string().uuid().optional() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    if (data.jobId) {
      const { data: job } = await (context.supabase as SupabaseClient)
        .from("background_jobs")
        .select("*")
        .eq("id", data.jobId)
        .eq("user_id", context.userId)
        .maybeSingle();
      return { jobs: job ? [job] : [] };
    }

    const { data: jobs } = await (context.supabase as SupabaseClient)
      .from("background_jobs")
      .select("*")
      .eq("user_id", context.userId)
      .in("status", ["queued", "running", "paused"])
      .order("priority", { ascending: false })
      .limit(20);

    return { jobs: jobs ?? [] };
  });

/**
 * Get recent completed/failed jobs for review.
 */
export const getJobHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: jobs } = await (context.supabase as SupabaseClient)
      .from("background_jobs")
      .select("*")
      .eq("user_id", context.userId)
      .in("status", ["complete", "failed"])
      .order("completed_at", { ascending: false })
      .limit(50);

    return { jobs: jobs ?? [] };
  });

// ─── Intelligent Reasoning Layer ───────────────────────────────

/**
 * The "brain" — looks at current state and decides what to do next.
 * Considers: repo analyses, learning history, pending jobs, recent outcomes.
 */
async function reasonAboutNextAction(
  supabase: SupabaseClient,
  userId: string,
  aiConfig: AIProviderConfig,
): Promise<ReasoningDecision[]> {
  // Gather context for the AI to reason about

  // 1. Recent analyses
  const { data: analyses } = await supabase
    .from("analyses")
    .select("id, status, summary_md, repo_count, created_at")
    .eq("user_id", userId)
    .eq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(3);

  // 2. Pending/recent background jobs
  const { data: recentJobs } = await supabase
    .from("background_jobs")
    .select("kind, repo, status, result, error, completed_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);

  // 3. Repo learnings with patterns
  const { data: learnings } = await supabase
    .from("repo_learnings")
    .select("repo, patterns_detected, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(10);

  // 4. Cross-repo patterns
  const { data: patterns } = await supabase
    .from("cross_repo_patterns")
    .select("pattern, category, confidence, recommendation")
    .eq("user_id", userId)
    .order("confidence", { ascending: false })
    .limit(5);

  // 5. Unfinished analysis items (repos needing work)
  const latestAnalysis = (analyses as { id: string }[] | null)?.[0];
  let unfinishedItems: unknown[] = [];
  if (latestAnalysis) {
    const { data: items } = await supabase
      .from("analysis_items")
      .select("kind, title, repos, effort, market_potential, finish_result, deep_analysis, iteration_count")
      .eq("analysis_id", latestAnalysis.id)
      .order("rank", { ascending: true });
    unfinishedItems = (items ?? []).filter(
      (it: Record<string, unknown>) => !it.finish_result && it.kind === "finish",
    );
  }

  // Build the context string for the AI
  const contextStr = `
## Current State

### Recent Analyses
${(analyses as Record<string, unknown>[] | null)?.map((a) => `- ${a.created_at}: ${a.repo_count} repos analyzed. ${(a.summary_md as string)?.slice(0, 200) || "No summary"}`).join("\n") || "None yet"}

### Recent Background Jobs
${(recentJobs as Record<string, unknown>[] | null)?.map((j) => `- [${j.status}] ${j.kind} on ${j.repo || "portfolio"}: ${j.error || "ok"}`).join("\n") || "None"}

### Repos With Learning History
${(learnings as Record<string, unknown>[] | null)?.map((l) => `- ${l.repo}: ${(l.patterns_detected as string[])?.length || 0} patterns detected`).join("\n") || "None"}

### Cross-Repo Patterns
${(patterns as Record<string, unknown>[] | null)?.map((p) => `- [${p.confidence}% confidence] ${p.pattern}: ${p.recommendation}`).join("\n") || "None"}

### Unfinished Repos (from latest analysis)
${(unfinishedItems as Record<string, unknown>[]).map((it) => `- [effort ${it.effort}/5, market ${it.market_potential}/5] ${it.title} — repos: ${(it.repos as string[]).join(", ")} — ${it.deep_analysis ? "has deep analysis" : "needs deep analysis"} — ${it.iteration_count || 0} finish passes done`).join("\n") || "None — all caught up!"}
`.trim();

  const systemPrompt = `You are an intelligent autonomous agent managing a developer's GitHub repo portfolio.
Your job is to decide what background work to do next — prioritizing high-impact, low-risk actions.

Available actions:
- deep_analysis: Run a deep structural analysis on a repo (finds stubs, dep health, test coverage, completion %)
- finish_step: Execute one step of the finish pipeline on a repo (small, testable increment)
- dependency_audit: Check a repo's dependencies for outdated/vulnerable packages
- test_gap_scan: Identify which parts of a repo lack test coverage
- health_recheck: Re-run health scoring on a repo that was recently modified
- portfolio_sweep: Run a fresh portfolio-wide analysis
- pattern_review: Review cross-repo patterns and generate recommendations
- skip: Nothing useful to do right now
- wait: Wait for human input before proceeding

DECISION RULES:
1. Prefer deep_analysis on repos that haven't been analyzed yet — you need data before acting.
2. Only run finish_step on repos where deep_analysis has been done AND completion < 80%.
3. Never run finish_step on repos with recurring failure patterns unless the approach has changed.
4. If all repos are analyzed and healthy, suggest pattern_review or skip.
5. Prioritize repos with high market_potential and low effort remaining.
6. Space out operations on the same repo — don't hammer one repo with 5 jobs in a row.
7. If recent jobs failed, investigate the pattern before retrying.

Return JSON array of 1-3 decisions, ordered by priority (highest first).
Each decision: { action, repo (full_name or null), priority (0-100), reasoning (1-2 sentences), context (any metadata for the job) }
If nothing to do: [{ action: "skip", repo: null, priority: 0, reasoning: "...", context: {} }]`;

  try {
    const resp = await callAI(
      {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: contextStr },
        ],
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: "reasoning_decisions",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                decisions: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      action: {
                        type: "string",
                        enum: [
                          "deep_analysis",
                          "finish_step",
                          "dependency_audit",
                          "test_gap_scan",
                          "health_recheck",
                          "portfolio_sweep",
                          "pattern_review",
                          "skip",
                          "wait",
                        ],
                      },
                      repo: { type: ["string", "null"] },
                      priority: { type: "integer" },
                      reasoning: { type: "string" },
                      context: {
                        type: "object",
                        additionalProperties: true,
                      },
                    },
                    required: ["action", "repo", "priority", "reasoning", "context"],
                  },
                },
              },
              required: ["decisions"],
            },
          },
        },
      },
      aiConfig,
    );

    const parsed = JSON.parse(resp.content || '{"decisions": []}');
    return (parsed.decisions || []) as ReasoningDecision[];
  } catch (e) {
    console.error("[autonomous-runner] Reasoning failed:", e);
    return [
      {
        action: "skip",
        repo: null,
        priority: 0,
        reasoning: `Reasoning failed: ${(e as Error).message}`,
        context: {},
      },
    ];
  }
}

// ─── Job Execution ─────────────────────────────────────────────

async function executeJob(
  supabase: SupabaseClient,
  userId: string,
  job: BackgroundJob,
  aiConfig: AIProviderConfig,
): Promise<{ success: boolean; result: Record<string, unknown>; nextStep?: string }> {
  const startTime = Date.now();

  try {
    switch (job.kind) {
      case "deep_analysis": {
        if (!job.repo) throw new Error("deep_analysis requires a repo");
        // Import and call the deep analysis function directly
        const { deepAnalyzeRepo } = await import("@/lib/deep-analysis.functions");
        const result = await (deepAnalyzeRepo as unknown as (args: {
          data: { repo: string };
          context: { supabase: unknown; userId: string };
        }) => Promise<unknown>)({
          data: { repo: job.repo },
          context: { supabase, userId },
        });
        return {
          success: true,
          result: {
            type: "deep_analysis",
            repo: job.repo,
            ...(result as Record<string, unknown>),
          },
        };
      }

      case "finish_step": {
        if (!job.repo) throw new Error("finish_step requires a repo");
        const { finishRepo } = await import("@/lib/repo-finisher.functions");
        const nextSteps = (job.context.nextSteps as string[]) || [
          "Fix the most impactful issue identified in the deep analysis",
          "Ensure all imports resolve correctly",
          "Add missing error handling",
        ];
        const result = await (finishRepo as unknown as (args: {
          data: { repo: string; nextSteps: string[]; analysisId?: string; itemRank?: number };
          context: { supabase: unknown; userId: string };
        }) => Promise<unknown>)({
          data: {
            repo: job.repo,
            nextSteps,
            analysisId: job.context.analysisId as string | undefined,
            itemRank: job.context.itemRank as number | undefined,
          },
          context: { supabase, userId },
        });
        return {
          success: true,
          result: {
            type: "finish_step",
            repo: job.repo,
            ...(result as Record<string, unknown>),
          },
          nextStep: job.next_step || undefined,
        };
      }

      case "dependency_audit": {
        if (!job.repo) throw new Error("dependency_audit requires a repo");
        // Reuse deep analysis but focus on deps
        const { deepAnalyzeRepo } = await import("@/lib/deep-analysis.functions");
        const analysis = await (deepAnalyzeRepo as unknown as (args: {
          data: { repo: string };
          context: { supabase: unknown; userId: string };
        }) => Promise<Record<string, unknown>>)({
          data: { repo: job.repo },
          context: { supabase, userId },
        });
        return {
          success: true,
          result: {
            type: "dependency_audit",
            repo: job.repo,
            dependencyHealth: analysis.dependencyHealth,
            summary: `Dependency audit complete for ${job.repo}`,
          },
        };
      }

      case "test_gap_scan": {
        if (!job.repo) throw new Error("test_gap_scan requires a repo");
        const { deepAnalyzeRepo } = await import("@/lib/deep-analysis.functions");
        const analysis = await (deepAnalyzeRepo as unknown as (args: {
          data: { repo: string };
          context: { supabase: unknown; userId: string };
        }) => Promise<Record<string, unknown>>)({
          data: { repo: job.repo },
          context: { supabase, userId },
        });
        return {
          success: true,
          result: {
            type: "test_gap_scan",
            repo: job.repo,
            testCoverage: analysis.testCoverage,
            summary: `Test gap scan complete for ${job.repo}`,
          },
        };
      }

      case "health_recheck": {
        if (!job.repo) throw new Error("health_recheck requires a repo");
        const { getRepoHealth } = await import("@/lib/github.functions");
        const health = await (getRepoHealth as unknown as (args: {
          data: { repo: string };
          context: { supabase: unknown; userId: string };
        }) => Promise<unknown>)({
          data: { repo: job.repo },
          context: { supabase, userId },
        });
        return {
          success: true,
          result: {
            type: "health_recheck",
            repo: job.repo,
            ...(health as Record<string, unknown>),
          },
        };
      }

      case "portfolio_sweep": {
        // Trigger a full re-analysis
        const analysisMod = await import("@/lib/analysis.functions");
        // Get GitHub token
        const { data: conn } = await supabase
          .from("github_connections")
          .select("access_token, github_login")
          .eq("user_id", userId)
          .maybeSingle();
        if (!conn) throw new Error("No GitHub connection");

        const { data: prefs } = await supabase
          .from("user_preferences")
          .select(
            "custom_ai_provider, custom_ai_key, filter_max_repos, filter_languages, filter_min_stars, filter_exclude_archived",
          )
          .eq("user_id", userId)
          .maybeSingle();

        const ctx = {
          supabase,
          userId,
          token: (conn as { access_token: string }).access_token,
          prefs: prefs as { custom_ai_provider: string; custom_ai_key: string | null; filter_max_repos: number; filter_languages: string[] | null; filter_min_stars: number; filter_exclude_archived: boolean } | null,
          triggerType: "background",
          onProgress: async (msg: string) => {
            // Update job context with progress
            await supabase
              .from("background_jobs")
              .update({ context: { ...job.context, progress: msg } as Json })
              .eq("id", job.id);
          },
        };

        const result = await analysisMod.executeAnalysis(ctx as Parameters<typeof analysisMod.executeAnalysis>[0]);
        return {
          success: true,
          result: {
            type: "portfolio_sweep",
            analysisId: result.id,
            summary: "Portfolio sweep complete",
          },
        };
      }

      case "pattern_review": {
        // Review cross-repo patterns and generate recommendations
        const { data: patterns } = await supabase
          .from("cross_repo_patterns")
          .select("*")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(20);

        if (!patterns || patterns.length === 0) {
          return {
            success: true,
            result: {
              type: "pattern_review",
              summary: "No patterns to review yet",
              recommendations: [],
            },
          };
        }

        const resp = await callAI(
          {
            messages: [
              {
                role: "system",
                content:
                  "You are an engineering lead reviewing cross-repo patterns. Identify the most actionable insights and suggest concrete next steps.",
              },
              {
                role: "user",
                content: `Review these cross-repo patterns:\n${JSON.stringify(patterns, null, 2)}\n\nProvide 3-5 actionable recommendations.`,
              },
            ],
          },
          aiConfig,
        );

        return {
          success: true,
          result: {
            type: "pattern_review",
            patterns: patterns.length,
            analysis: resp.content,
            summary: `Reviewed ${patterns.length} cross-repo patterns`,
          },
        };
      }

      default:
        throw new Error(`Unknown job kind: ${job.kind}`);
    }
  } catch (e) {
    const duration = Date.now() - startTime;
    // Log the failure
    if (job.repo) {
      await logLearningEntry(supabase, userId, job.repo, {
        action: `background-${job.kind}`,
        outcome: "failure",
        duration_ms: duration,
        details: (e as Error).message,
        files_affected: [],
        error_message: (e as Error).message,
        fix_pattern: job.kind,
        timestamp: new Date().toISOString(),
      });
    }
    return {
      success: false,
      result: { error: (e as Error).message, duration_ms: duration },
    };
  }
}

// ─── Background Runner (cron-triggered) ────────────────────────

/**
 * Main autonomous runner — called by cron or manually.
 * 1. Picks up queued jobs (priority order)
 * 2. If no queued jobs, uses AI reasoning to decide what to do
 * 3. Executes jobs with safety checks
 * 4. Logs outcomes to learning system
 * 5. Chains follow-up jobs if needed
 */
export const runBackgroundProcessor = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const authHeader = request?.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return { error: "Unauthorized", processed: 0 };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { error: "Supabase not configured", processed: 0 };
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Get all users with GitHub connections (potential background work candidates)
  const { data: connections } = await supabase
    .from("github_connections")
    .select("user_id, access_token");

  if (!connections || connections.length === 0) {
    return { message: "No users with GitHub connections", processed: 0 };
  }

  let totalProcessed = 0;
  const results: { userId: string; jobs: number; decisions: string[] }[] = [];

  for (const conn of connections as { user_id: string; access_token: string }[]) {
    const userId = conn.user_id;

    try {
      // 1. Check for queued jobs first
      const { data: queuedJobs } = await supabase
        .from("background_jobs")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "queued")
        .order("priority", { ascending: false })
        .limit(3);

      const aiConfig = await resolveAIConfig(supabase, userId);
      let jobsProcessed = 0;
      const decisionsLog: string[] = [];

      if (queuedJobs && queuedJobs.length > 0) {
        // Process queued jobs
        for (const rawJob of queuedJobs) {
          const job = rawJob as unknown as BackgroundJob;

          // Mark as running
          await supabase
            .from("background_jobs")
            .update({
              status: "running",
              started_at: new Date().toISOString(),
              attempts: job.attempts + 1,
            })
            .eq("id", job.id);

          const outcome = await executeJob(supabase, userId, job, aiConfig);

          // Update job status
          await supabase
            .from("background_jobs")
            .update({
              status: outcome.success ? "complete" : (job.attempts + 1 >= job.max_attempts ? "failed" : "queued"),
              result: outcome.result as Json,
              error: outcome.success ? null : (outcome.result.error as string) || "Unknown error",
              completed_at: outcome.success ? new Date().toISOString() : null,
            })
            .eq("id", job.id);

          // Log learning
          if (job.repo) {
            await logLearningEntry(supabase, userId, job.repo, {
              action: `background-${job.kind}`,
              outcome: outcome.success ? "success" : "failure",
              duration_ms: 0,
              details: JSON.stringify(outcome.result).slice(0, 500),
              files_affected: [],
              fix_pattern: job.kind,
              timestamp: new Date().toISOString(),
            });
          }

          // Chain follow-up job if specified
          if (outcome.success && outcome.nextStep) {
            await supabase.from("background_jobs").insert({
              user_id: userId,
              repo: job.repo,
              kind: outcome.nextStep as JobKind,
              status: "queued",
              priority: Math.max(0, job.priority - 10),
              context: outcome.result as Json,
              max_attempts: 3,
            });
          }

          jobsProcessed++;
          decisionsLog.push(
            `${outcome.success ? "✓" : "✗"} ${job.kind} on ${job.repo || "portfolio"}`,
          );
        }
      } else {
        // 2. No queued jobs — use AI reasoning to decide what to do
        const decisions = await reasonAboutNextAction(supabase, userId, aiConfig);

        for (const decision of decisions) {
          if (decision.action === "skip" || decision.action === "wait") {
            decisionsLog.push(`⏭ ${decision.action}: ${decision.reasoning}`);
            continue;
          }

          // Enqueue the decided action
          await supabase.from("background_jobs").insert({
            user_id: userId,
            repo: decision.repo,
            kind: decision.action as JobKind,
            status: "queued",
            priority: decision.priority,
            context: decision.context as Json,
            max_attempts: 3,
          });

          decisionsLog.push(
            `📋 Queued ${decision.action} on ${decision.repo || "portfolio"}: ${decision.reasoning}`,
          );
          jobsProcessed++;
        }
      }

      totalProcessed += jobsProcessed;
      results.push({ userId, jobs: jobsProcessed, decisions: decisionsLog });
    } catch (e) {
      results.push({
        userId,
        jobs: 0,
        decisions: [`Error: ${(e as Error).message}`],
      });
    }
  }

  return { processed: totalProcessed, results };
});

// ─── Manual trigger: reason and show plan ──────────────────────

/**
 * Let the user see what the autonomous runner WOULD do without executing.
 * Useful for understanding the AI's reasoning before enabling auto-mode.
 */
export const previewAutonomousPlan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const aiConfig = await resolveAIConfig(context.supabase, context.userId);
    const decisions = await reasonAboutNextAction(
      context.supabase as SupabaseClient,
      context.userId,
      aiConfig,
    );
    return { decisions };
  });

/**
 * User-triggered: run the autonomous reasoning and immediately execute.
 * Unlike the cron version, this runs in the user's session context.
 */
export const runAutonomousNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as SupabaseClient;
    const aiConfig = await resolveAIConfig(supabase, context.userId);
    const decisions = await reasonAboutNextAction(supabase, context.userId, aiConfig);

    const results: {
      action: string;
      repo: string | null;
      success: boolean;
      summary: string;
    }[] = [];

    for (const decision of decisions) {
      if (decision.action === "skip" || decision.action === "wait") {
        results.push({
          action: decision.action,
          repo: null,
          success: true,
          summary: decision.reasoning,
        });
        continue;
      }

      // Enqueue and immediately process
      const { data: job } = await supabase
        .from("background_jobs")
        .insert({
          user_id: context.userId,
          repo: decision.repo,
          kind: decision.action as JobKind,
          status: "running",
          priority: decision.priority,
          context: decision.context as Json,
          max_attempts: 3,
          started_at: new Date().toISOString(),
          attempts: 1,
        })
        .select("*")
        .single();

      if (!job) continue;

      const outcome = await executeJob(
        supabase,
        context.userId,
        job as unknown as BackgroundJob,
        aiConfig,
      );

      await supabase
        .from("background_jobs")
        .update({
          status: outcome.success ? "complete" : "failed",
          result: outcome.result as Json,
          error: outcome.success ? null : (outcome.result.error as string) || null,
          completed_at: new Date().toISOString(),
        })
        .eq("id", (job as { id: string }).id);

      results.push({
        action: decision.action,
        repo: decision.repo,
        success: outcome.success,
        summary: outcome.success
          ? JSON.stringify(outcome.result).slice(0, 200)
          : (outcome.result.error as string) || "Failed",
      });
    }

    return { results };
  });
