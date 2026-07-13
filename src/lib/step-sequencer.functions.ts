// Step Sequencer — "vibe code to completion" done right.
// Breaks repo finishing into small, atomic, testable steps.
// Each step: analyze → plan 1 change → commit → verify CI → continue or stop.
//
// Key principles:
// 1. Small steps — one logical change per step (1-3 files max)
// 2. CI verification — check if the repo's tests/build pass after each step
// 3. Stop on failure — don't push forward blindly
// 4. Deep-analysis-aware — uses stub/dep/test data to prioritize work
// 5. Learning-integrated — logs every step outcome for future reference

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAI, resolveAIConfig, type AIProviderConfig } from "@/lib/ai-provider";
import {
  safeGitHubWrite,
  assertNotProtectedBranch,
  assessChangeRisk,
  formatRiskCallout,
} from "@/lib/safety-rails";
import { logLearningEntry } from "@/lib/learning-log.functions";
import { createScope, assertWithinScope, formatScopeStatus, type ScopeContext } from "@/lib/scope-guard";
import type { CICheckResult } from "@/lib/ci-verifier.functions";
import type { DeepAnalysisResult } from "@/lib/deep-analysis.functions";
import type { Json } from "@/integrations/supabase/types";

// ─── Types ─────────────────────────────────────────────────────

export type StepStatus = "pending" | "running" | "committed" | "ci_checking" | "ci_passed" | "ci_failed" | "fix_attempted" | "failed" | "skipped";

export interface SequencerStep {
  number: number;
  title: string;
  description: string;
  status: StepStatus;
  files: { path: string; action: "create" | "modify" | "delete" }[];
  prNumber: number | null;
  prUrl: string | null;
  branchName: string | null;
  ciResult: CICheckResult | null;
  fixAttempted: boolean;
  error: string | null;
  durationMs: number;
  startedAt: string | null;
  completedAt: string | null;
}

export interface SequencerPlan {
  repo: string;
  totalSteps: number;
  steps: SequencerStep[];
  strategy: string;
  estimatedMinutes: number;
  deepAnalysisUsed: boolean;
}

export interface SequencerRun {
  id: string;
  repo: string;
  plan: SequencerPlan;
  stepsCompleted: number;
  stepsFailed: number;
  status: "planned" | "running" | "paused" | "completed" | "failed" | "stopped_on_failure";
  startedAt: string;
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

async function ghFetch(token: string, path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: { ...ghHeaders(token), ...(opts?.headers || {}) },
  });
}

async function ghRaw(token: string, repo: string, path: string, ref?: string): Promise<string | null> {
  const refParam = ref ? `?ref=${ref}` : "";
  const res = await fetch(
    `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}${refParam}`,
    {
      headers: {
        ...ghHeaders(token),
        Accept: "application/vnd.github.raw",
      },
    },
  );
  if (!res.ok) return null;
  return res.text();
}

// ─── Step Planning (AI-driven) ─────────────────────────────────

const STEP_PLANNER_PROMPT = `You are a senior engineer planning a step-by-step sequence to complete an unfinished codebase.
You have the deep structural analysis results showing exactly what's built, what's stubbed, what's missing.

RULES:
1. Each step must be SMALL — touch 1-3 files maximum. One logical change.
2. Order matters: fix foundations first, then build on them.
   - Step 1: Fix broken imports, missing types, or core utilities
   - Step 2-3: Implement stub functions starting with the most-depended-on
   - Step 4+: Add tests, then config, then docs
3. Each step must be independently testable — the repo should build after each step.
4. Never combine unrelated changes into one step.
5. Steps must be ordered so each one can be verified before the next begins.
6. Maximum 8 steps per plan. Focus on highest-impact work.
7. If the repo has tests, ensure your changes don't break them.
8. If the repo has NO tests, make step 2 or 3 about adding a basic test.

For each step, specify:
- title: 5-10 word description
- description: What specifically to change and why (1-2 sentences)
- files: Array of { path, action } — what files will be touched
- priority: 1-8 (1 = do first)

Also provide:
- strategy: 2-3 sentences explaining the overall approach
- estimatedMinutes: rough total time estimate for all steps`;

interface AIStepPlan {
  strategy: string;
  estimatedMinutes: number;
  steps: {
    title: string;
    description: string;
    files: { path: string; action: "create" | "modify" | "delete" }[];
    priority: number;
  }[];
}

async function planSteps(
  repo: string,
  repoFiles: Map<string, string>,
  deepAnalysis: DeepAnalysisResult | null,
  tree: { path: string; type: string; size?: number }[],
  aiConfig: AIProviderConfig,
): Promise<AIStepPlan> {
  // Build context from deep analysis if available
  let analysisContext = "";
  if (deepAnalysis) {
    const stubList = deepAnalysis.stubs
      .slice(0, 20)
      .map((s) => `  ${s.file}:${s.line} [${s.kind}] ${s.snippet}`)
      .join("\n");

    analysisContext = `
## Deep Analysis Results
- Completion: ${deepAnalysis.completion.percentage}% (${deepAnalysis.completion.verdict})
- Built functions: ${deepAnalysis.completion.builtCount}, Stubbed: ${deepAnalysis.completion.stubbedCount}
- Test coverage: ${deepAnalysis.testCoverage.testFileCount} test files, ratio: ${deepAnalysis.testCoverage.testToSourceRatio}
- Deploy readiness issues: ${deepAnalysis.deployReadiness.issues.join("; ") || "none"}
- Stubs/TODOs found:
${stubList || "  (none detected)"}

- Uncovered directories (no tests): ${deepAnalysis.testCoverage.uncoveredPaths.slice(0, 10).join(", ") || "none"}
- Outdated deps: ${deepAnalysis.dependencyHealth.filter((d) => d.status === "major-behind").map((d) => d.name).join(", ") || "none"}
`;
  }

  // Show key source files
  const sourceFiles: string[] = [];
  for (const [path, content] of repoFiles) {
    if (/\.(ts|tsx|js|jsx|py|go|rs)$/.test(path) && !path.includes("node_modules")) {
      sourceFiles.push(`--- ${path} (${content.length} chars) ---\n${content.slice(0, 2000)}`);
    }
  }

  const treeStr = tree
    .filter((t) => t.type === "blob" && !t.path.includes("node_modules") && !t.path.includes(".git/"))
    .slice(0, 80)
    .map((t) => `  ${t.path} (${t.size ?? "?"} bytes)`)
    .join("\n");

  const userPrompt = `Repo: ${repo}

## File Tree (${tree.filter((t) => t.type === "blob").length} files)
${treeStr}

${analysisContext}

## Key Source Files
${sourceFiles.slice(0, 10).join("\n\n")}

Plan the step-by-step sequence to bring this repo toward completion.
Focus on the most impactful changes — don't waste steps on cosmetics.`;

  const resp = await callAI(
    {
      messages: [
        { role: "system", content: STEP_PLANNER_PROMPT },
        { role: "user", content: userPrompt },
      ],
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "step_plan",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              strategy: { type: "string" },
              estimatedMinutes: { type: "integer" },
              steps: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                    files: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          path: { type: "string" },
                          action: { type: "string", enum: ["create", "modify", "delete"] },
                        },
                        required: ["path", "action"],
                      },
                    },
                    priority: { type: "integer" },
                  },
                  required: ["title", "description", "files", "priority"],
                },
              },
            },
            required: ["strategy", "estimatedMinutes", "steps"],
          },
        },
      },
    },
    aiConfig,
  );

  return JSON.parse(resp.content || "{}") as AIStepPlan;
}

// ─── Execute a single step ─────────────────────────────────────

const STEP_EXECUTOR_PROMPT = `You are implementing ONE specific step to improve a codebase.
You have the plan, the current source files, and context from prior steps.

RULES:
1. Only produce changes for THIS STEP — nothing else.
2. For "modify" files: output the COMPLETE updated file content.
3. For "create" files: output the complete new file.
4. Every file must be syntactically valid and have correct imports.
5. If you cannot confidently make a change, say so in the analysis — don't guess.
6. Do NOT touch files outside the step's planned scope.
7. The change must be small and testable — the repo should build after this step.
8. If this step builds on prior steps' changes, reference the updated file state (provided).

Return JSON with:
- analysis: 1-2 sentences about what you changed and why
- changes: array of { path, status ("created"|"modified"|"deleted"), content, description }
- confidence: 0-100 — how confident you are this change is correct`;

interface AIStepExecution {
  analysis: string;
  changes: {
    path: string;
    status: "created" | "modified" | "deleted";
    content: string;
    description: string;
  }[];
  confidence: number;
}

async function executeStep(
  repo: string,
  step: { title: string; description: string; files: { path: string; action: string }[] },
  currentFiles: Map<string, string>,
  priorStepsSummary: string,
  aiConfig: AIProviderConfig,
): Promise<AIStepExecution> {
  const fileContents = step.files
    .map((f) => {
      const content = currentFiles.get(f.path);
      if (content) {
        return `--- ${f.path} (current content, ${content.length} chars) ---\n${content.slice(0, 4000)}`;
      }
      return `--- ${f.path} (does not exist yet — will be created) ---`;
    })
    .join("\n\n");

  const user = `Repo: ${repo}

## Step to implement
Title: ${step.title}
Description: ${step.description}
Files to touch: ${step.files.map((f) => `${f.path} (${f.action})`).join(", ")}

## Prior steps completed
${priorStepsSummary || "None yet — this is the first step."}

## Current file contents
${fileContents}`;

  const resp = await callAI(
    {
      messages: [
        { role: "system", content: STEP_EXECUTOR_PROMPT },
        { role: "user", content: user },
      ],
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "step_execution",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              analysis: { type: "string" },
              changes: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    path: { type: "string" },
                    status: { type: "string", enum: ["created", "modified", "deleted"] },
                    content: { type: "string" },
                    description: { type: "string" },
                  },
                  required: ["path", "status", "content", "description"],
                },
              },
              confidence: { type: "integer" },
            },
            required: ["analysis", "changes", "confidence"],
          },
        },
      },
    },
    aiConfig,
  );

  return JSON.parse(resp.content || "{}") as AIStepExecution;
}

// ─── Batch commit (same as repo-finisher but for single step) ──

async function commitStepToBranch(
  token: string,
  repo: string,
  branch: string,
  baseSha: string,
  changes: AIStepExecution["changes"],
  stepTitle: string,
): Promise<{ commitSha: string; filesChanged: number }> {
  assertNotProtectedBranch(branch);

  // Get the commit's tree
  const commitRes = await ghFetch(token, `/repos/${repo}/git/commits/${baseSha}`);
  if (!commitRes.ok) throw new Error(`Failed to get commit: ${commitRes.status}`);
  const baseCommit = (await commitRes.json()) as { tree: { sha: string } };

  // Create blobs for each change
  const treeEntries: Array<{
    path: string;
    mode: string;
    type: string;
    sha?: string | null;
  }> = [];
  let filesChanged = 0;

  for (const change of changes) {
    if (change.status === "deleted") {
      treeEntries.push({ path: change.path, mode: "100644", type: "blob", sha: null as unknown as string });
      filesChanged++;
    } else {
      const blobRes = await ghFetch(token, `/repos/${repo}/git/blobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: change.content, encoding: "utf-8" }),
      });
      if (!blobRes.ok) continue;
      const blob = (await blobRes.json()) as { sha: string };
      treeEntries.push({ path: change.path, mode: "100644", type: "blob", sha: blob.sha });
      filesChanged++;
    }
  }

  if (filesChanged === 0) throw new Error("No files to commit");

  // Create tree
  const treeRes = await ghFetch(token, `/repos/${repo}/git/trees`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: treeEntries }),
  });
  if (!treeRes.ok) throw new Error(`Tree creation failed: ${treeRes.status}`);
  const tree = (await treeRes.json()) as { sha: string };

  // Create commit
  const newCommitRes = await ghFetch(token, `/repos/${repo}/git/commits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `step: ${stepTitle}`,
      tree: tree.sha,
      parents: [baseSha],
    }),
  });
  if (!newCommitRes.ok) throw new Error(`Commit creation failed: ${newCommitRes.status}`);
  const newCommit = (await newCommitRes.json()) as { sha: string };

  // Update branch ref
  const refRes = await ghFetch(token, `/repos/${repo}/git/refs/heads/${branch}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sha: newCommit.sha }),
  });
  if (!refRes.ok) {
    // Branch doesn't exist yet — create it
    const createRefRes = await ghFetch(token, `/repos/${repo}/git/refs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: newCommit.sha }),
    });
    if (!createRefRes.ok) {
      const err = await createRefRes.text();
      throw new Error(`Branch creation failed: ${createRefRes.status} ${err.slice(0, 200)}`);
    }
  }

  return { commitSha: newCommit.sha, filesChanged };
}

// ─── Parallel file fetch ───────────────────────────────────────

async function fetchFilesParallel(
  token: string,
  repo: string,
  paths: string[],
  ref?: string,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  let next = 0;
  async function worker() {
    while (next < paths.length) {
      const i = next++;
      const content = await ghRaw(token, repo, paths[i], ref);
      if (content !== null) results.set(paths[i], content);
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, paths.length) }, worker));
  return results;
}

// ─── Main server functions ─────────────────────────────────────

/**
 * Plan a step-by-step completion sequence for a repo.
 * Uses deep analysis results if available. Does NOT execute — just plans.
 */
export const planSequence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (d: { repo: string }) =>
      z.object({ repo: z.string() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { data: conn } = await context.supabase
      .from("github_connections")
      .select("access_token")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!conn) throw new Error("Connect GitHub first.");
    const token = (conn as { access_token: string }).access_token;
    const aiConfig = await resolveAIConfig(context.supabase, context.userId);

    // Get repo metadata
    const repoRes = await ghFetch(token, `/repos/${data.repo}`);
    if (!repoRes.ok) throw new Error(`Repo not found: ${data.repo}`);
    const repoMeta = (await repoRes.json()) as { default_branch: string };

    // Get file tree
    const treeRes = await ghFetch(
      token,
      `/repos/${data.repo}/git/trees/${repoMeta.default_branch}?recursive=1`,
    );
    if (!treeRes.ok) throw new Error("Failed to fetch file tree");
    const treeData = (await treeRes.json()) as {
      tree: { path: string; type: string; size?: number }[];
    };

    // Fetch key files
    const sourceExts = /\.(ts|tsx|js|jsx|py|go|rs|rb|java)$/;
    const sourceFiles = treeData.tree
      .filter(
        (f) =>
          f.type === "blob" &&
          sourceExts.test(f.path) &&
          !f.path.includes("node_modules") &&
          !f.path.includes("dist"),
      )
      .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
      .slice(0, 15);

    const filesToFetch = [
      "package.json",
      "README.md",
      "tsconfig.json",
      ...sourceFiles.map((f) => f.path),
    ].filter((p) => treeData.tree.some((t) => t.path === p));

    const fileContents = await fetchFilesParallel(token, data.repo, filesToFetch);

    // Check for existing deep analysis
    let deepAnalysis: DeepAnalysisResult | null = null;
    const { data: learning } = await context.supabase
      .from("repo_learnings")
      .select("last_analysis")
      .eq("user_id", context.userId)
      .eq("repo", data.repo)
      .maybeSingle();
    if (learning && (learning as Record<string, unknown>).last_analysis) {
      deepAnalysis = (learning as Record<string, unknown>).last_analysis as DeepAnalysisResult;
    }

    // Plan the steps
    const aiPlan = await planSteps(data.repo, fileContents, deepAnalysis, treeData.tree, aiConfig);

    // Sort by priority and build the plan
    const sortedSteps = aiPlan.steps
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 8);

    const plan: SequencerPlan = {
      repo: data.repo,
      totalSteps: sortedSteps.length,
      steps: sortedSteps.map((s, i) => ({
        number: i + 1,
        title: s.title,
        description: s.description,
        status: "pending" as StepStatus,
        files: s.files as SequencerStep["files"],
        prNumber: null,
        prUrl: null,
        branchName: null,
        ciResult: null,
        fixAttempted: false,
        error: null,
        durationMs: 0,
        startedAt: null,
        completedAt: null,
      })),
      strategy: aiPlan.strategy,
      estimatedMinutes: aiPlan.estimatedMinutes,
      deepAnalysisUsed: !!deepAnalysis,
    };

    // Save the plan
    const { data: saved, error } = await context.supabase
      .from("sequencer_runs")
      .insert({
        user_id: context.userId,
        repo: data.repo,
        plan: plan as unknown as Json,
        status: "planned",
        steps_completed: 0,
        steps_failed: 0,
      })
      .select("id")
      .single();

    if (error) throw new Error(`Failed to save plan: ${error.message}`);

    return {
      runId: (saved as { id: string }).id,
      plan,
    };
  });

/**
 * Execute the step sequence — one step at a time with CI verification.
 * Stops on CI failure. Can be resumed after fixing issues.
 */
export const executeSequence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (d: { runId: string; stopOnCIFailure?: boolean; skipCICheck?: boolean }) =>
      z
        .object({
          runId: z.string().uuid(),
          stopOnCIFailure: z.boolean().optional(),
          skipCICheck: z.boolean().optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    const supabase = context.supabase;
    const stopOnCIFailure = data.stopOnCIFailure ?? true;
    const skipCICheck = data.skipCICheck ?? false;

    // Load the run
    const { data: run, error } = await supabase
      .from("sequencer_runs")
      .select("*")
      .eq("id", data.runId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error || !run) throw new Error("Sequencer run not found");

    const runData = run as {
      id: string;
      repo: string;
      plan: SequencerPlan;
      status: string;
      steps_completed: number;
      steps_failed: number;
    };

    if (runData.status === "running") throw new Error("Sequence already running");
    if (runData.status === "completed") throw new Error("Sequence already completed");

    // Get GitHub token
    const { data: conn } = await supabase
      .from("github_connections")
      .select("access_token")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!conn) throw new Error("Connect GitHub first.");
    const token = (conn as { access_token: string }).access_token;
    const aiConfig = await resolveAIConfig(supabase, context.userId);

    // Set up scope guard — single repo only
    const scope = createScope(runData.repo);

    // Get repo default branch
    const repoRes = await ghFetch(token, `/repos/${runData.repo}`);
    if (!repoRes.ok) throw new Error(`Repo not found: ${runData.repo}`);
    const repoMeta = (await repoRes.json()) as { default_branch: string };
    const defaultBranch = repoMeta.default_branch;

    // Create a working branch
    const branchName = `step-sequencer/${Date.now().toString(36)}`;
    const refRes = await ghFetch(token, `/repos/${runData.repo}/git/refs/heads/${defaultBranch}`);
    if (!refRes.ok) throw new Error("Failed to get default branch ref");
    const baseRef = (await refRes.json()) as { object: { sha: string } };
    let currentSha = baseRef.object.sha;

    // Create the branch
    const createBranchRes = await ghFetch(token, `/repos/${runData.repo}/git/refs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: currentSha }),
    });
    if (!createBranchRes.ok) throw new Error("Failed to create working branch");

    // Mark as running
    await supabase
      .from("sequencer_runs")
      .update({ status: "running" })
      .eq("id", runData.id);

    const plan = runData.plan;
    let stepsCompleted = runData.steps_completed;
    let stepsFailed = runData.steps_failed;
    const priorSteps: string[] = [];
    let prUrl: string | null = null;
    let prNumber: number | null = null;

    // Process each pending step
    for (const step of plan.steps) {
      if (step.status !== "pending") continue;

      const stepStart = Date.now();
      step.status = "running";
      step.startedAt = new Date().toISOString();
      step.branchName = branchName;

      // Enforce scope
      assertWithinScope(scope, runData.repo);

      try {
        // Fetch current file state from the branch (includes prior step changes)
        const filePaths = step.files.map((f) => f.path);
        const currentFiles = await fetchFilesParallel(token, runData.repo, filePaths, branchName);

        // Also fetch any related files the AI might need
        const treeRes = await ghFetch(
          token,
          `/repos/${runData.repo}/git/trees/${branchName}?recursive=1`,
        );
        if (treeRes.ok) {
          const treeData = (await treeRes.json()) as {
            tree: { path: string; type: string; size?: number }[];
          };
          // Also fetch package.json if not already included
          for (const extraFile of ["package.json", "tsconfig.json"]) {
            if (!currentFiles.has(extraFile) && treeData.tree.some((t) => t.path === extraFile)) {
              const content = await ghRaw(token, runData.repo, extraFile, branchName);
              if (content) currentFiles.set(extraFile, content);
            }
          }
        }

        // Generate the code for this step
        const execution = await executeStep(
          runData.repo,
          step,
          currentFiles,
          priorSteps.join("\n"),
          aiConfig,
        );

        if (!execution.changes || execution.changes.length === 0) {
          step.status = "skipped";
          step.error = "AI couldn't generate changes for this step";
          step.durationMs = Date.now() - stepStart;
          step.completedAt = new Date().toISOString();
          continue;
        }

        // Low confidence warning
        if (execution.confidence < 40) {
          step.status = "skipped";
          step.error = `AI confidence too low (${execution.confidence}%) — skipping to avoid breakage. ${execution.analysis}`;
          step.durationMs = Date.now() - stepStart;
          step.completedAt = new Date().toISOString();
          continue;
        }

        // Commit to the branch
        const commitResult = await commitStepToBranch(
          token,
          runData.repo,
          branchName,
          currentSha,
          execution.changes,
          step.title,
        );
        currentSha = commitResult.commitSha;
        step.files = execution.changes.map((c) => ({
          path: c.path,
          action: c.status === "deleted" ? "delete" as const : c.status === "created" ? "create" as const : "modify" as const,
        }));
        step.status = "committed";

        // CI verification (if not skipped)
        if (!skipCICheck) {
          step.status = "ci_checking";

          // Create or update the PR so CI runs against the branch
          if (!prNumber) {
            const prRes = await ghFetch(token, `/repos/${runData.repo}/pulls`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: `🔧 Step Sequencer: ${plan.steps.length}-step completion plan`,
                head: branchName,
                base: defaultBranch,
                body: `## Step-by-Step Completion\n\n**Strategy:** ${plan.strategy}\n\n${formatScopeStatus(scope)}\n\nThis PR is being built step-by-step with CI verification at each stage.\nSteps will be committed incrementally.`,
                draft: true,
              }),
            });
            if (prRes.ok) {
              const pr = (await prRes.json()) as { number: number; html_url: string };
              prNumber = pr.number;
              prUrl = pr.html_url;
            }
          }

          if (prNumber) {
            step.prNumber = prNumber;
            step.prUrl = prUrl;

            // Import CI verifier and check
            try {
              const { checkPRCI } = await import("@/lib/ci-verifier.functions");
              const ciResult = await (checkPRCI as unknown as (args: {
                data: { repo: string; prNumber: number; timeoutMs?: number };
                context: { supabase: unknown; userId: string };
              }) => Promise<CICheckResult>)({
                data: { repo: runData.repo, prNumber, timeoutMs: 180000 }, // 3 min max
                context: { supabase, userId: context.userId },
              });

              step.ciResult = ciResult;

              if (ciResult.status === "success") {
                step.status = "ci_passed";
              } else if (ciResult.status === "no_ci") {
                // No CI — mark as passed (can't verify)
                step.status = "ci_passed";
              } else if (ciResult.status === "failure") {
                step.status = "ci_failed";

                if (stopOnCIFailure) {
                  step.error = `CI failed: ${ciResult.summary}. Stopping sequence.`;
                  stepsFailed++;
                  step.durationMs = Date.now() - stepStart;
                  step.completedAt = new Date().toISOString();

                  // Log learning
                  await logLearningEntry(supabase, context.userId, runData.repo, {
                    action: `step-${step.number}-ci-failure`,
                    outcome: "failure",
                    duration_ms: step.durationMs,
                    details: `Step "${step.title}" broke CI: ${ciResult.summary}`,
                    files_affected: step.files.map((f) => f.path),
                    error_message: ciResult.failureLogs.join("\n").slice(0, 500),
                    fix_pattern: step.title,
                    timestamp: new Date().toISOString(),
                  });

                  // Update run status
                  await supabase
                    .from("sequencer_runs")
                    .update({
                      plan: plan as unknown as Json,
                      status: "stopped_on_failure",
                      steps_completed: stepsCompleted,
                      steps_failed: stepsFailed,
                    })
                    .eq("id", runData.id);

                  return {
                    runId: runData.id,
                    status: "stopped_on_failure",
                    stepsCompleted,
                    stepsFailed,
                    stoppedAtStep: step.number,
                    reason: ciResult.summary,
                    prUrl,
                    plan,
                  };
                }
              }
            } catch (ciError) {
              // CI check itself failed — continue anyway
              step.status = "ci_passed"; // assume ok if can't check
              step.error = `CI check error: ${(ciError as Error).message}`;
            }
          } else {
            step.status = "ci_passed"; // couldn't create PR — skip CI
          }
        } else {
          step.status = "ci_passed"; // CI check skipped by user
        }

        stepsCompleted++;
        step.durationMs = Date.now() - stepStart;
        step.completedAt = new Date().toISOString();

        // Track for next step's context
        priorSteps.push(
          `Step ${step.number} "${step.title}": ${execution.analysis} ` +
            `(changed: ${execution.changes.map((c) => c.path).join(", ")})`,
        );

        // Log learning
        await logLearningEntry(supabase, context.userId, runData.repo, {
          action: `step-${step.number}-complete`,
          outcome: "success",
          duration_ms: step.durationMs,
          details: `Step "${step.title}" completed. ${execution.analysis}`,
          files_affected: step.files.map((f) => f.path),
          fix_pattern: step.title,
          timestamp: new Date().toISOString(),
        });

        // Save progress after each step
        await supabase
          .from("sequencer_runs")
          .update({
            plan: plan as unknown as Json,
            steps_completed: stepsCompleted,
            steps_failed: stepsFailed,
          })
          .eq("id", runData.id);
      } catch (stepError) {
        step.status = "failed";
        step.error = (stepError as Error).message.slice(0, 500);
        step.durationMs = Date.now() - stepStart;
        step.completedAt = new Date().toISOString();
        stepsFailed++;

        // Log failure
        await logLearningEntry(supabase, context.userId, runData.repo, {
          action: `step-${step.number}-error`,
          outcome: "failure",
          duration_ms: step.durationMs,
          details: step.error,
          files_affected: step.files.map((f) => f.path),
          error_message: step.error,
          fix_pattern: step.title,
          timestamp: new Date().toISOString(),
        });

        if (stopOnCIFailure) break;
      }
    }

    // Finalize the PR if it exists
    if (prNumber && stepsCompleted > 0) {
      // Update PR body with results
      const riskAssessment = assessChangeRisk({
        filesCreated: plan.steps.filter((s) => s.status === "ci_passed" && s.files.some((f) => f.action === "create")).length,
        filesModified: plan.steps.filter((s) => s.status === "ci_passed" && s.files.some((f) => f.action === "modify")).length,
        filesDeleted: plan.steps.filter((s) => s.status === "ci_passed" && s.files.some((f) => f.action === "delete")).length,
        touchesSrc: plan.steps.some((s) => s.files.some((f) => f.path.startsWith("src/"))),
        touchesConfig: plan.steps.some((s) => s.files.some((f) => /\.(json|toml|yaml|yml)$/.test(f.path))),
        touchesDeps: plan.steps.some((s) => s.files.some((f) => f.path === "package.json")),
        isCrossRepo: false,
        isMajorRefactor: stepsCompleted > 5,
        isMajorVersionBump: false,
      });

      const stepLog = plan.steps
        .map((s) => {
          const icon = s.status === "ci_passed" ? "✅" : s.status === "ci_failed" ? "❌" : s.status === "skipped" ? "⏭️" : "⬜";
          return `${icon} **Step ${s.number}: ${s.title}** — ${s.description}${s.error ? ` *(${s.error.slice(0, 100)})*` : ""}`;
        })
        .join("\n");

      const prBody = `## Step-by-Step Completion — ${stepsCompleted}/${plan.totalSteps} steps done\n\n` +
        `**Strategy:** ${plan.strategy}\n\n` +
        `${formatRiskCallout(riskAssessment)}\n\n` +
        `${formatScopeStatus(scope)}\n\n` +
        `### Steps\n${stepLog}\n\n` +
        `---\n⚠️ **Review before merging.** Built step-by-step with CI verification at each stage.`;

      await ghFetch(token, `/repos/${runData.repo}/pulls/${prNumber}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: prBody,
          draft: false, // un-draft it
          title: `🔧 Step Sequencer: ${stepsCompleted}/${plan.totalSteps} steps — ${runData.repo.split("/").pop()}`,
        }),
      });
    }

    // Final status
    const finalStatus = stepsFailed > 0 && stepsCompleted === 0
      ? "failed"
      : stepsFailed > 0
        ? "stopped_on_failure"
        : "completed";

    await supabase
      .from("sequencer_runs")
      .update({
        plan: plan as unknown as Json,
        status: finalStatus,
        steps_completed: stepsCompleted,
        steps_failed: stepsFailed,
      })
      .eq("id", runData.id);

    return {
      runId: runData.id,
      status: finalStatus,
      stepsCompleted,
      stepsFailed,
      prUrl,
      prNumber,
      plan,
    };
  });

/**
 * Get the status of a sequencer run.
 */
export const getSequencerRun = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { runId: string }) => z.object({ runId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: run } = await context.supabase
      .from("sequencer_runs")
      .select("*")
      .eq("id", data.runId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!run) throw new Error("Run not found");
    return run;
  });

/**
 * List recent sequencer runs for a repo.
 */
export const listSequencerRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { repo?: string }) => z.object({ repo: z.string().optional() }).parse(d))
  .handler(async ({ context, data }) => {
    let query = context.supabase
      .from("sequencer_runs")
      .select("id, repo, status, steps_completed, steps_failed, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (data.repo) {
      query = query.eq("repo", data.repo);
    }

    const { data: runs } = await query;
    return { runs: runs ?? [] };
  });
