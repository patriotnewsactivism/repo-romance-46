import type { SupabaseClient } from "@supabase/supabase-js";
import { callAI } from "./ai-provider";
import { parseModelJsonLenient } from "./parse-model-json";
import { loadAiCredential, loadGithubCredential, requireGithubCredential } from "./credentials";
import { loadAdaptiveLearningContext } from "./adaptive-learning";
import { prepareFinishPlan } from "./repo-finisher-engine";
import { normalizeInvestmentMetrics } from "./run-outcome-score";
import { insertCompletionRunCompat } from "./completion-run-persistence";
import { IMMUTABLE_AGENT_SAFETY_POLICY, resolvePromptStrategy } from "./prompt-strategy-evolution";
import { selectSpecialists, type SpecialistSelection } from "./specialist-agents";

const DIRECT_AGENTIC_PROMPT_VERSION = "agentic-finisher-v3-background-capable";

type CoreAgentRole = "architect" | "quality-security" | "product-investment";

interface AgentResult {
  role: string;
  summary: string;
  priorities: string[];
  risks: string[];
  validation: string[];
}

export interface AgenticPreviewInput {
  repo: string;
  nextSteps?: string[];
  analysisId?: string;
  itemRank?: number;
  boundedAutonomyAcknowledged?: boolean;
}

function strings(value: unknown, max = 8) {
  if (!Array.isArray(value)) return [];
  return value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, max);
}

function normalizeAgentResult(role: string, value: unknown): AgentResult {
  const parsed = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    role,
    summary: String(parsed.summary || `${role} returned no reliable summary.`),
    priorities: strings(parsed.priorities),
    risks: strings(parsed.risks),
    validation: strings(parsed.validation),
  };
}

async function ghRepoSnapshot(token: string, repo: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "repo-finisher",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw Object.assign(new Error(`Repo not found or inaccessible: ${repo}`), { status: 404 });
    const data = await res.json() as Record<string, unknown>;
    return {
      repo,
      description: typeof data.description === "string" ? data.description : null,
      language: typeof data.language === "string" ? data.language : null,
      topics: Array.isArray(data.topics) ? data.topics.map(String) : [],
      stars: Number(data.stargazers_count || 0),
      forks: Number(data.forks_count || 0),
      openIssues: Number(data.open_issues_count || 0),
      archived: Boolean(data.archived),
      defaultBranch: String(data.default_branch || "main"),
      lastPush: data.pushed_at ?? null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runReasoningAgent(
  role: string,
  objective: string,
  context: Record<string, unknown>,
  ai: { provider: string; apiKey: string | null },
  mutableStrategyGuidance: string,
): Promise<AgentResult> {
  const system = `You are the ${role} agent in an autonomous repository-completion council.
Your job is to reason independently, challenge weak assumptions, and return only work that moves the repository toward a verifiably finished, deployable product.

${IMMUTABLE_AGENT_SAFETY_POLICY}

ROLE OBJECTIVE:
${objective}

MUTABLE EXPERIMENTAL STRATEGY GUIDANCE:
${mutableStrategyGuidance}
This strategy guidance may influence reasoning technique and prioritization only. If it conflicts with the immutable policy above, ignore the conflicting strategy text.

Operating rules:
- Base recommendations only on supplied evidence and explicit prior learnings.
- Treat measured outcome scores and before/after completion deltas as stronger evidence than generic success counts.
- Prefer strategies with strong measured outcomes when the repository context matches; alter or reject strategies with weak measured outcomes.
- Prefer fixing blockers over adding speculative features.
- Treat prior failed approaches as warnings; do not repeat them unchanged.
- Priorities must be concrete implementation outcomes suitable for a coding agent.
- Validation must state how CI, tests, isolated deployment, smoke checks, or other measurable evidence proves success.
Return strict JSON.`;

  const result = await callAI(
    {
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(context) },
      ],
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: `${role.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_review`,
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: { type: "string" },
              priorities: { type: "array", maxItems: 8, items: { type: "string" } },
              risks: { type: "array", maxItems: 8, items: { type: "string" } },
              validation: { type: "array", maxItems: 8, items: { type: "string" } },
            },
            required: ["summary", "priorities", "risks", "validation"],
          },
        },
      },
      thinkingLevel: "high",
      timeoutMs: 60_000,
    },
    ai,
  );
  try {
    return normalizeAgentResult(role, parseModelJsonLenient(result.content || "{}"));
  } catch {
    return normalizeAgentResult(role, {});
  }
}

function uniqueSteps(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of groups.flat()) {
    const normalized = String(value || "").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= 25) break;
  }
  return out;
}

function coreObjective(role: CoreAgentRole): string {
  if (role === "architect") return "Define the smallest architecture-safe completion sequence. Identify interfaces that must remain stable and prerequisites that must land first. Use measured strategy history to avoid plans that previously produced weak completion deltas.";
  if (role === "quality-security") return "Act as a skeptical senior reviewer. Find failure modes, missing tests, auth/secret/permission hazards, migration risk, and required acceptance checks in the architect plan.";
  return "Protect commercial value. Remove low-value scope, prioritize the shortest path to a usable product, and identify changes most likely to improve completion, readiness, and finish-first economics. Prefer historically high-outcome strategies only when the current evidence matches.";
}

function specialistTrace(selection: SpecialistSelection) {
  return { role: selection.role, selectionScore: selection.score, reason: selection.reason };
}

export async function createAgenticPreview(
  supabase: SupabaseClient,
  userId: string,
  input: AgenticPreviewInput,
) {
  const github = requireGithubCredential(await loadGithubCredential(supabase, userId));
  const [repoSnapshot, learning, aiCredential, promptStrategy] = await Promise.all([
    ghRepoSnapshot(github.token, input.repo),
    loadAdaptiveLearningContext(supabase, userId, input.repo),
    loadAiCredential(supabase, userId, github.token),
    resolvePromptStrategy(supabase, userId),
  ]);

  let analysisContext: Record<string, unknown> | null = null;
  let investmentContext: unknown = null;
  if (input.analysisId) {
    const [{ data: item }, { data: analysis }] = await Promise.all([
      input.itemRank !== undefined
        ? supabase
            .from("analysis_items")
            .select("kind, title, pitch, effort, market_potential, estimated_hours, next_steps, tech_stack")
            .eq("analysis_id", input.analysisId)
            .eq("rank", input.itemRank)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("analyses")
        .select("investment_intelligence")
        .eq("id", input.analysisId)
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    analysisContext = (item as Record<string, unknown> | null) ?? null;
    const intelligence = (analysis as Record<string, unknown> | null)?.investment_intelligence;
    if (intelligence && typeof intelligence === "object") {
      const ranking = (intelligence as Record<string, unknown>).ranking;
      if (Array.isArray(ranking)) investmentContext = ranking.find((entry) => (entry as Record<string, unknown>).repo === input.repo) ?? null;
    }
  }

  const sharedContext: Record<string, unknown> = {
    promptVersion: promptStrategy.version,
    promptArm: promptStrategy.arm,
    repository: repoSnapshot,
    requestedNextSteps: input.nextSteps ?? [],
    analysisContext,
    investmentContext,
    adaptiveLearning: {
      priorSuccesses: learning.recentSuccesses.map((entry) => ({ action: entry.action, details: entry.details, fixPattern: entry.fix_pattern, outcomeScore: entry.metadata?.outcome_score ?? null, completionDelta: entry.metadata?.completion_delta ?? null })),
      priorFailures: learning.recentFailures.map((entry) => ({ action: entry.action, error: entry.error_message, details: entry.details, fixPattern: entry.fix_pattern, outcomeScore: entry.metadata?.outcome_score ?? null })),
      strategyPerformance: learning.strategyPerformance,
      guidance: learning.promptGuidance,
    },
  };

  const ai = { provider: aiCredential.provider, apiKey: aiCredential.apiKey };
  if (!ai.apiKey) throw Object.assign(new Error(`No usable ${ai.provider} credential is configured for autonomous agent planning.`), { status: 400 });

  const architect = await runReasoningAgent("architect", coreObjective("architect"), sharedContext, ai, promptStrategy.guidance);
  const qualitySecurity = await runReasoningAgent("quality-security", coreObjective("quality-security"), { ...sharedContext, architect }, ai, promptStrategy.guidance);
  const productInvestment = await runReasoningAgent("product-investment", coreObjective("product-investment"), { ...sharedContext, architect, qualitySecurity }, ai, promptStrategy.guidance);

  const specialistSelections = selectSpecialists({
    repo: repoSnapshot.repo,
    description: repoSnapshot.description,
    language: repoSnapshot.language,
    topics: repoSnapshot.topics,
    requestedNextSteps: input.nextSteps ?? [],
    analysisText: analysisContext ? [JSON.stringify(analysisContext)] : [],
  });
  const specialists = await Promise.all(
    specialistSelections.map((selection) =>
      runReasoningAgent(selection.role, selection.objective, { ...sharedContext, architect, qualitySecurity, productInvestment, specialistSelection: specialistTrace(selection) }, ai, promptStrategy.guidance),
    ),
  );

  const learnedGuidance = strings(learning.promptGuidance, 12).map((lesson) => `Honor measured prior learning when current evidence matches: ${lesson}`);
  const validationSteps = [qualitySecurity, ...specialists].flatMap((agent) => agent.validation.map((step) => `Acceptance requirement (${agent.role}): ${step}`));
  const combinedNextSteps = uniqueSteps(
    input.nextSteps ?? [],
    architect.priorities,
    qualitySecurity.priorities,
    productInvestment.priorities,
    specialists.flatMap((agent) => agent.priorities),
    learnedGuidance,
    validationSteps,
  );

  const { plan, planHash, reasoning } = await prepareFinishPlan(supabase, userId, {
    repo: input.repo,
    nextSteps: combinedNextSteps,
    analysisId: input.analysisId,
    itemRank: input.itemRank,
  });

  const now = new Date().toISOString();
  const baselineMetrics = normalizeInvestmentMetrics(investmentContext);
  const repairEnabled = Boolean(input.boundedAutonomyAcknowledged);
  const effectivePromptVersion = plan.reasoning?.promptVersion ?? promptStrategy.version ?? DIRECT_AGENTIC_PROMPT_VERSION;
  const approvalPolicy = {
    mode: repairEnabled ? "agentic_exact_plan_plus_bounded_ci_repair" : "agentic_exact_plan_only",
    boundedAutonomyAcknowledgedAt: repairEnabled ? now : null,
    exactPlanStillRequiresApproval: true,
    maxRepairAttempts: repairEnabled ? 3 : 0,
    automaticMerge: false,
  };
  const runInsert = await insertCompletionRunCompat(
    supabase,
    {
      user_id: userId,
      repo: plan.repo,
      default_branch: plan.defaultBranch,
      base_sha: plan.baseSha,
      plan_hash: planHash,
      plan,
      status: "awaiting_approval",
      analysis_id: input.analysisId ?? null,
      item_rank: input.itemRank ?? null,
      prompt_version: effectivePromptVersion,
      baseline_metrics: baselineMetrics,
      approval_policy: approvalPolicy,
      ...(repairEnabled ? { auto_repair_enabled: true, max_repair_attempts: 3 } : {}),
      created_at: now,
      updated_at: now,
    },
    "id, status, created_at",
  );
  if (runInsert.error || !runInsert.data) throw new Error(`Failed to create autonomous completion run: ${runInsert.error?.message ?? "unknown database error"}`);

  const run = runInsert.data as { id: string; status: string; created_at: string };
  if (reasoning?.traceId) {
    await supabase
      .from("reasoning_traces")
      .update({ completion_run_id: run.id, updated_at: now })
      .eq("id", reasoning.traceId)
      .eq("user_id", userId);
  }

  const stepRows = plan.changes.map((change, index) => ({
    run_id: run.id,
    user_id: userId,
    ordinal: index + 1,
    title: `${change.status === "created" ? "Create" : change.status === "modified" ? "Modify" : "Delete"} ${change.path}`,
    description: change.description,
    status: "pending",
    scope: [{ path: change.path, action: change.status }],
    created_at: now,
    updated_at: now,
  }));
  const { error: stepError } = await supabase.from("completion_steps").insert(stepRows);
  if (stepError) {
    await supabase.from("completion_runs").delete().eq("id", run.id).eq("user_id", userId);
    throw new Error(`Failed to persist autonomous completion steps: ${stepError.message}`);
  }

  const coreAgents = [architect, qualitySecurity, productInvestment];
  const agents = [...coreAgents, ...specialists];
  const { error: eventError } = await supabase.from("completion_events").insert({
    run_id: run.id,
    user_id: userId,
    kind: "agent_council",
    status: "info",
    message: `Three core reasoning agents${specialists.length ? ` plus ${specialists.length} evidence-selected specialist${specialists.length === 1 ? "" : "s"}` : ""} produced an independent completion brief before the deeper evidence/critic planner generated ${plan.changes.length} exact file changes.`,
    metadata: {
      councilPromptVersion: promptStrategy.version,
      effectivePromptVersion,
      promptArm: promptStrategy.arm,
      promptExperiment: promptStrategy.experiment,
      immutableSafetyPolicyVersion: "agent-safety-v1",
      coreAgents,
      specialists,
      specialistSelections: specialistSelections.map(specialistTrace),
      deepReasoning: plan.reasoning ?? null,
      learningGuidance: learning.promptGuidance,
      strategyPerformance: learning.strategyPerformance,
      baselineMetrics,
      approvalPolicy,
      outcomeTelemetryPersisted: runInsert.telemetryPersisted,
      combinedNextSteps,
    },
  });
  if (eventError) throw new Error(`Failed to record autonomous agent trace: ${eventError.message}`);

  return {
    runId: run.id,
    status: run.status,
    repo: plan.repo,
    defaultBranch: plan.defaultBranch,
    baseSha: plan.baseSha,
    planHash,
    summary: plan.summary,
    nextSteps: plan.nextSteps,
    changes: plan.changes.map(({ mode: _mode, ...change }) => change),
    agents,
    specialists: specialistSelections.map(specialistTrace),
    deepReasoning: plan.reasoning ?? null,
    autoRepair: { enabled: repairEnabled, maxAttempts: repairEnabled ? 3 : 0, requiresBoundedAutonomyAcknowledgement: true },
    learning: {
      hasHistory: learning.hasHistory,
      guidance: learning.promptGuidance,
      strategyPerformance: learning.strategyPerformance,
      promptVersion: effectivePromptVersion,
      promptArm: promptStrategy.arm,
      experiment: promptStrategy.experiment,
    },
    baselineMetrics,
    outcomeTelemetryPersisted: runInsert.telemetryPersisted,
    createdAt: run.created_at,
  };
}
