import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "../lib/async-handler";
import { callAI } from "../lib/ai-provider";
import { loadAiCredential, loadGithubCredential, requireGithubCredential } from "../lib/credentials";
import { loadAdaptiveLearningContext } from "../lib/adaptive-learning";
import { prepareFinishPlan } from "../lib/repo-finisher-engine";

const router: IRouter = Router();
const AGENT_PROMPT_VERSION = "agentic-finisher-v1";

interface AgentResult {
  role: "architect" | "quality-security" | "product-investment";
  summary: string;
  priorities: string[];
  risks: string[];
  validation: string[];
}

async function ghRepoSnapshot(token: string, repo: string) {
  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "repo-finisher",
    },
  });
  if (!res.ok) throw Object.assign(new Error(`Repo not found or inaccessible: ${repo}`), { status: 404 });
  const data = (await res.json()) as Record<string, unknown>;
  return {
    repo,
    description: data.description ?? null,
    language: data.language ?? null,
    topics: Array.isArray(data.topics) ? data.topics : [],
    stars: Number(data.stargazers_count || 0),
    forks: Number(data.forks_count || 0),
    openIssues: Number(data.open_issues_count || 0),
    archived: Boolean(data.archived),
    defaultBranch: String(data.default_branch || "main"),
    lastPush: data.pushed_at ?? null,
  };
}

async function runCouncilAgent(
  role: AgentResult["role"],
  objective: string,
  context: Record<string, unknown>,
  ai: { provider: string; apiKey: string | null },
): Promise<AgentResult> {
  const system = `You are the ${role} agent in an autonomous repository-completion council.
Your job is to reason independently, challenge weak assumptions, and return only work that moves the repository toward a verifiably finished, deployable product.
${objective}

Rules:
- Base recommendations only on supplied evidence and explicit prior learnings.
- Prefer fixing blockers over adding speculative features.
- Never suggest weakening tests, security, permissions, or approval controls.
- Treat prior failed approaches as warnings; do not repeat them unchanged.
- Priorities must be concrete implementation outcomes suitable for a coding agent.
- Validation must state how CI, tests, deployment, or smoke checks prove success.
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
          name: `${role.replace(/-/g, "_")}_review`,
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
    },
    ai,
  );
  const parsed = JSON.parse(result.content || "{}") as Omit<AgentResult, "role">;
  return { role, ...parsed };
}

function uniqueSteps(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of groups.flat()) {
    const normalized = value.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= 25) break;
  }
  return out;
}

router.post(
  "/repo-finisher/agentic-preview",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        repo: z.string().regex(/^[A-Za-z0-9.-]+\/[A-Za-z0-9._-]+$/),
        nextSteps: z.array(z.string().min(1).max(500)).max(25).optional(),
        analysisId: z.string().uuid().optional(),
        itemRank: z.number().int().positive().optional(),
      })
      .parse(req.body);

    const userId = req.userId!;
    const github = requireGithubCredential(await loadGithubCredential(req.supabase!, userId));
    const [repoSnapshot, learning, aiCredential] = await Promise.all([
      ghRepoSnapshot(github.token, input.repo),
      loadAdaptiveLearningContext(req.supabase!, userId, input.repo),
      loadAiCredential(req.supabase!, userId, github.token),
    ]);

    let analysisContext: Record<string, unknown> | null = null;
    let investmentContext: unknown = null;
    if (input.analysisId) {
      const [{ data: item }, { data: analysis }] = await Promise.all([
        input.itemRank
          ? req.supabase!
              .from("analysis_items")
              .select("kind, title, pitch, effort, market_potential, estimated_hours, next_steps, tech_stack")
              .eq("analysis_id", input.analysisId)
              .eq("rank", input.itemRank)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        req.supabase!
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
        if (Array.isArray(ranking)) {
          investmentContext = ranking.find((entry) => (entry as Record<string, unknown>).repo === input.repo) ?? null;
        }
      }
    }

    const sharedContext: Record<string, unknown> = {
      promptVersion: AGENT_PROMPT_VERSION,
      repository: repoSnapshot,
      requestedNextSteps: input.nextSteps ?? [],
      analysisContext,
      investmentContext,
      adaptiveLearning: {
        priorSuccesses: learning.recentSuccesses.map((entry) => ({ action: entry.action, details: entry.details, fixPattern: entry.fix_pattern })),
        priorFailures: learning.recentFailures.map((entry) => ({ action: entry.action, error: entry.error_message, details: entry.details, fixPattern: entry.fix_pattern })),
        guidance: learning.promptGuidance,
      },
    };

    const ai = { provider: aiCredential.provider, apiKey: aiCredential.apiKey };
    if (!ai.apiKey) {
      throw Object.assign(new Error(`No usable ${ai.provider} credential is configured for autonomous agent planning.`), { status: 400 });
    }

    const architect = await runCouncilAgent(
      "architect",
      "Define the smallest architecture-safe completion sequence. Identify interfaces that must remain stable and prerequisites that must land first.",
      sharedContext,
      ai,
    );
    const qualitySecurity = await runCouncilAgent(
      "quality-security",
      "Act as a skeptical senior reviewer. Find failure modes, missing tests, auth/secret/permission hazards, migration risk, and required acceptance checks in the architect plan.",
      { ...sharedContext, architect },
      ai,
    );
    const productInvestment = await runCouncilAgent(
      "product-investment",
      "Protect commercial value. Remove low-value scope, prioritize the shortest path to a usable product, and identify changes most likely to improve completion, readiness, and finish-first economics.",
      { ...sharedContext, architect, qualitySecurity },
      ai,
    );

    const learnedGuidance = learning.promptGuidance.map((lesson) => `Honor prior learning: ${lesson}`);
    const validationSteps = qualitySecurity.validation.map((step) => `Acceptance requirement: ${step}`);
    const combinedNextSteps = uniqueSteps(
      input.nextSteps ?? [],
      architect.priorities,
      qualitySecurity.priorities,
      productInvestment.priorities,
      learnedGuidance,
      validationSteps,
    );

    const { plan, planHash } = await prepareFinishPlan(req.supabase!, userId, {
      repo: input.repo,
      nextSteps: combinedNextSteps,
      analysisId: input.analysisId,
      itemRank: input.itemRank,
    });

    const now = new Date().toISOString();
    const { data: runData, error: runError } = await req.supabase!
      .from("completion_runs")
      .insert({
        user_id: userId,
        repo: plan.repo,
        default_branch: plan.defaultBranch,
        base_sha: plan.baseSha,
        plan_hash: planHash,
        plan,
        status: "awaiting_approval",
        created_at: now,
        updated_at: now,
      })
      .select("id, status, created_at")
      .single();
    if (runError) throw new Error(`Failed to create autonomous completion run: ${runError.message}`);

    const run = runData as { id: string; status: string; created_at: string };
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
    const { error: stepError } = await req.supabase!.from("completion_steps").insert(stepRows);
    if (stepError) {
      await req.supabase!.from("completion_runs").delete().eq("id", run.id);
      throw new Error(`Failed to persist autonomous completion steps: ${stepError.message}`);
    }

    const agents = [architect, qualitySecurity, productInvestment];
    const { error: eventError } = await req.supabase!.from("completion_events").insert({
      run_id: run.id,
      user_id: userId,
      kind: "agent_council",
      status: "info",
      message: `Three reasoning agents produced an adaptive completion brief before the coding agent generated ${plan.changes.length} exact file changes.`,
      metadata: {
        promptVersion: AGENT_PROMPT_VERSION,
        agents,
        learningGuidance: learning.promptGuidance,
        combinedNextSteps,
      },
    });
    if (eventError) throw new Error(`Failed to record autonomous agent trace: ${eventError.message}`);

    res.status(201).json({
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
      learning: {
        hasHistory: learning.hasHistory,
        guidance: learning.promptGuidance,
        promptVersion: AGENT_PROMPT_VERSION,
      },
      createdAt: run.created_at,
    });
  }),
);

export default router;
