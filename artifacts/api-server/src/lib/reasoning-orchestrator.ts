import type { SupabaseClient } from "@supabase/supabase-js";
import { callAI } from "./ai-provider";
import { loadAdaptiveLearningContext } from "./adaptive-learning";
import { loadAiCredential, loadGithubCredential, requireGithubCredential } from "./credentials";
import { loadOperationalMemory, memoryGuidance } from "./learning-memory";
import { IMMUTABLE_AGENT_SAFETY_POLICY, resolvePromptStrategy } from "./prompt-strategy-evolution";
import { selectSpecialists, specialistObjective, type SpecialistRole } from "./specialist-agents";

const MAX_EVIDENCE_FILES = 24;
const MAX_FILE_CHARS = 4_000;
const MAX_TOTAL_EVIDENCE_CHARS = 84_000;
const REASONING_VERSION = "reasoning-orchestrator-v3";

interface RepoTreeEntry {
  path: string;
  type: string;
  size?: number;
}

interface RepoEvidence {
  repository: {
    repo: string;
    description: string | null;
    language: string | null;
    topics: string[];
    defaultBranch: string;
    headSha: string;
    stars: number;
    forks: number;
    openIssues: number;
    archived: boolean;
  };
  treeSignals: {
    fileCount: number;
    hasTests: boolean;
    hasCi: boolean;
    hasDocker: boolean;
    hasDatabaseMigrations: boolean;
    hasAuthSignals: boolean;
    hasPaymentsSignals: boolean;
    hasFrontendSignals: boolean;
    hasBackendSignals: boolean;
  };
  files: Array<{ path: string; content: string }>;
}

interface Finding {
  id: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  confidence: number;
  evidence: string[];
  rootCause: string;
  recommendedAction: string;
  validation: string;
}

interface EvidenceAnalysis {
  summary: string;
  findings: Finding[];
  unknowns: string[];
}

interface CriticResult {
  acceptedFindingIds: string[];
  rejectedFindingIds: string[];
  critique: string[];
  regressionRisks: string[];
  missingEvidence: string[];
  confidence: number;
}

interface SpecialistResult {
  role: SpecialistRole;
  summary: string;
  priorities: string[];
  risks: string[];
  validation: string[];
}

export interface ReasonedPlanningResult {
  traceId: string | null;
  version: string;
  repo: string;
  promptVersion: string;
  strategyArm: "incumbent" | "challenger";
  specialists: SpecialistRole[];
  summary: string;
  nextSteps: string[];
  risks: string[];
  validation: string[];
  stopConditions: string[];
  confidence: number;
  evidence: RepoEvidence;
}

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "repo-finisher-reasoning",
  };
}

async function ghFetch(token: string, path: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: { ...ghHeaders(token), ...(init?.headers || {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function filePriority(path: string, requested: string[]) {
  const lower = path.toLowerCase();
  let score = 0;
  if (/^(package\.json|pyproject\.toml|cargo\.toml|go\.mod|requirements.*\.txt)$/.test(lower)) score += 120;
  if (/(^|\/)readme(\.|$)/.test(lower)) score += 110;
  if (lower.startsWith(".github/workflows/")) score += 105;
  if (/(dockerfile|vercel\.json|render\.yaml|firebase\.json|cloudbuild\.ya?ml|docker-compose)/.test(lower)) score += 100;
  if (/(^|\/)(supabase\/migrations|migrations|prisma|drizzle)(\/|$)/.test(lower)) score += 95;
  if (/(auth|oauth|session|permission|security|middleware)/.test(lower)) score += 90;
  if (/(stripe|billing|checkout|subscription|pricing)/.test(lower)) score += 85;
  if (/(test|spec|__tests__)/.test(lower)) score += 82;
  if (/^(src|app|server|api|lib)\//.test(lower) && /\.(ts|tsx|js|jsx|py|go|rs|java|kt)$/.test(lower)) score += 70;
  const requestedWords = requested.join(" ").toLowerCase().split(/[^a-z0-9_-]+/).filter((word) => word.length >= 5);
  score += requestedWords.filter((word) => lower.includes(word)).length * 12;
  return score;
}

async function fetchFile(token: string, repo: string, path: string, ref: string) {
  const response = await ghFetch(token, `/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`);
  if (!response.ok) return null;
  const json = (await response.json()) as { content?: string; encoding?: string };
  if (json.encoding !== "base64" || !json.content) return null;
  return Buffer.from(json.content, "base64").toString("utf-8");
}

async function collectRepoEvidence(token: string, repoName: string, requestedNextSteps: string[]): Promise<RepoEvidence> {
  const repoResponse = await ghFetch(token, `/repos/${repoName}`);
  if (!repoResponse.ok) throw Object.assign(new Error(`Repo not found or inaccessible: ${repoName}`), { status: 404 });
  const repo = (await repoResponse.json()) as Record<string, unknown>;
  const defaultBranch = String(repo.default_branch || "main");
  const branchResponse = await ghFetch(token, `/repos/${repoName}/branches/${encodeURIComponent(defaultBranch)}`);
  if (!branchResponse.ok) throw new Error(`Unable to inspect ${repoName} default branch.`);
  const branch = (await branchResponse.json()) as { commit?: { sha?: string } };
  const headSha = String(branch.commit?.sha || "");
  const treeResponse = await ghFetch(token, `/repos/${repoName}/git/trees/${headSha}?recursive=1`);
  if (!treeResponse.ok) throw new Error(`Unable to inspect ${repoName} tree.`);
  const treeJson = (await treeResponse.json()) as { tree?: RepoTreeEntry[]; truncated?: boolean };
  const tree = (treeJson.tree ?? []).filter((entry) => entry.type === "blob");

  const selected = tree
    .filter((entry) => (entry.size ?? 0) <= 250_000)
    .map((entry) => ({ entry, score: filePriority(entry.path, requestedNextSteps) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path))
    .slice(0, MAX_EVIDENCE_FILES)
    .map(({ entry }) => entry.path);

  const files: Array<{ path: string; content: string }> = [];
  let total = 0;
  let cursor = 0;
  const workers = Math.min(6, selected.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (cursor < selected.length) {
      const path = selected[cursor++];
      if (total >= MAX_TOTAL_EVIDENCE_CHARS) continue;
      const content = await fetchFile(token, repoName, path, headSha);
      if (content === null) continue;
      const bounded = content.slice(0, Math.min(MAX_FILE_CHARS, MAX_TOTAL_EVIDENCE_CHARS - total));
      total += bounded.length;
      files.push({ path, content: bounded });
    }
  }));

  const paths = tree.map((entry) => entry.path.toLowerCase());
  return {
    repository: {
      repo: repoName,
      description: typeof repo.description === "string" ? repo.description : null,
      language: typeof repo.language === "string" ? repo.language : null,
      topics: Array.isArray(repo.topics) ? repo.topics.map(String) : [],
      defaultBranch,
      headSha,
      stars: Number(repo.stargazers_count || 0),
      forks: Number(repo.forks_count || 0),
      openIssues: Number(repo.open_issues_count || 0),
      archived: Boolean(repo.archived),
    },
    treeSignals: {
      fileCount: tree.length,
      hasTests: paths.some((path) => /(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\./.test(path)),
      hasCi: paths.some((path) => path.startsWith(".github/workflows/")),
      hasDocker: paths.some((path) => /(^|\/)(dockerfile|docker-compose)/.test(path)),
      hasDatabaseMigrations: paths.some((path) => /(supabase\/migrations|\/migrations\/|prisma|drizzle)/.test(path)),
      hasAuthSignals: paths.some((path) => /(auth|oauth|session|permission|jwt)/.test(path)),
      hasPaymentsSignals: paths.some((path) => /(stripe|billing|checkout|subscription|pricing)/.test(path)),
      hasFrontendSignals: paths.some((path) => /\.(tsx|jsx|vue|svelte)$/.test(path) || /^(app|pages|src\/components)\//.test(path)),
      hasBackendSignals: paths.some((path) => /^(api|server|functions|src\/server)\//.test(path)),
    },
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

async function loadAnalysisContext(supabase: SupabaseClient, userId: string, analysisId: string | undefined, repo: string) {
  if (!analysisId) return null;
  const { data, error } = await supabase
    .from("analyses")
    .select("investment_intelligence, strategy_summary, critique_md, developer_profile")
    .eq("id", analysisId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  const record = data as Record<string, unknown>;
  const intelligence = record.investment_intelligence && typeof record.investment_intelligence === "object"
    ? record.investment_intelligence as Record<string, unknown>
    : null;
  const ranking = Array.isArray(intelligence?.ranking) ? intelligence!.ranking as Array<Record<string, unknown>> : [];
  return {
    repoIntelligence: ranking.find((entry) => String(entry.repo || "") === repo) ?? null,
    strategySummary: record.strategy_summary ?? null,
    critique: record.critique_md ?? null,
    developerProfile: record.developer_profile ?? null,
  };
}

async function insertTrace(
  supabase: SupabaseClient,
  userId: string,
  input: { repo: string; analysisId?: string; completionRunId?: string; portfolioRunId?: string; mode?: string },
) {
  const { data } = await supabase
    .from("reasoning_traces")
    .insert({
      user_id: userId,
      repo: input.repo,
      analysis_id: input.analysisId ?? null,
      completion_run_id: input.completionRunId ?? null,
      portfolio_run_id: input.portfolioRunId ?? null,
      mode: input.mode ?? "plan",
      stage: "collecting_evidence",
      status: "running",
    })
    .select("id")
    .maybeSingle();
  return data ? String((data as Record<string, unknown>).id) : null;
}

async function updateTrace(supabase: SupabaseClient, userId: string, traceId: string | null, values: Record<string, unknown>) {
  if (!traceId) return;
  await supabase
    .from("reasoning_traces")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", traceId)
    .eq("user_id", userId);
}

async function runEvidenceAnalyst(
  ai: { provider: string; apiKey: string | null },
  context: Record<string, unknown>,
): Promise<EvidenceAnalysis> {
  const result = await callAI({
    messages: [
      {
        role: "system",
        content: `You are RepoFinisher's evidence analyst. Diagnose why this repository is not yet finished using only supplied evidence.\n\n${IMMUTABLE_AGENT_SAFETY_POLICY}\n\nDo not assume a feature is broken merely because it exists. Distinguish verified blockers, likely blockers, and unknowns. Root-cause the highest-value gaps before proposing changes. Return strict JSON.`,
      },
      { role: "user", content: JSON.stringify(context) },
    ],
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "repo_evidence_analysis",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            summary: { type: "string" },
            findings: {
              type: "array",
              maxItems: 16,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "string" },
                  category: { type: "string" },
                  severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                  confidence: { type: "number", minimum: 0, maximum: 100 },
                  evidence: { type: "array", maxItems: 8, items: { type: "string" } },
                  rootCause: { type: "string" },
                  recommendedAction: { type: "string" },
                  validation: { type: "string" },
                },
                required: ["id", "category", "severity", "confidence", "evidence", "rootCause", "recommendedAction", "validation"],
              },
            },
            unknowns: { type: "array", maxItems: 10, items: { type: "string" } },
          },
          required: ["summary", "findings", "unknowns"],
        },
      },
    },
    thinkingLevel: "high",
    timeoutMs: 60_000,
  }, ai);
  return JSON.parse(result.content || "{}") as EvidenceAnalysis;
}

async function runCritic(
  ai: { provider: string; apiKey: string | null },
  context: Record<string, unknown>,
): Promise<CriticResult> {
  const result = await callAI({
    messages: [
      {
        role: "system",
        content: `You are RepoFinisher's skeptical verification critic. Attack the proposed diagnosis, reject unsupported findings, identify regression risk and missing evidence, and protect existing working behavior.\n\n${IMMUTABLE_AGENT_SAFETY_POLICY}\n\nReturn strict JSON only.`,
      },
      { role: "user", content: JSON.stringify(context) },
    ],
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "repo_reasoning_critique",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            acceptedFindingIds: { type: "array", maxItems: 16, items: { type: "string" } },
            rejectedFindingIds: { type: "array", maxItems: 16, items: { type: "string" } },
            critique: { type: "array", maxItems: 12, items: { type: "string" } },
            regressionRisks: { type: "array", maxItems: 12, items: { type: "string" } },
            missingEvidence: { type: "array", maxItems: 12, items: { type: "string" } },
            confidence: { type: "number", minimum: 0, maximum: 100 },
          },
          required: ["acceptedFindingIds", "rejectedFindingIds", "critique", "regressionRisks", "missingEvidence", "confidence"],
        },
      },
    },
    thinkingLevel: "high",
    timeoutMs: 60_000,
  }, ai);
  return JSON.parse(result.content || "{}") as CriticResult;
}

async function runSpecialist(
  ai: { provider: string; apiKey: string | null },
  role: SpecialistRole,
  context: Record<string, unknown>,
): Promise<SpecialistResult> {
  const result = await callAI({
    messages: [
      {
        role: "system",
        content: `You are RepoFinisher's ${role} specialist. ${specialistObjective(role)}\n\n${IMMUTABLE_AGENT_SAFETY_POLICY}\n\nChallenge the shared diagnosis where your specialty evidence disagrees. Return strict JSON only.`,
      },
      { role: "user", content: JSON.stringify(context) },
    ],
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: `${role.replace(/-/g, "_")}_specialist`,
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
    thinkingLevel: "medium",
    timeoutMs: 50_000,
  }, ai);
  const parsed = JSON.parse(result.content || "{}") as Omit<SpecialistResult, "role">;
  return { role, ...parsed };
}

async function runPlanner(
  ai: { provider: string; apiKey: string | null },
  context: Record<string, unknown>,
) {
  const result = await callAI({
    messages: [
      {
        role: "system",
        content: `You are RepoFinisher's principal planner. Synthesize evidence, the skeptical critique, measured learning, prompt-strategy guidance, and specialist reviews into the smallest ordered completion plan that has the highest probability of passing validation.\n\n${IMMUTABLE_AGENT_SAFETY_POLICY}\n\nRules:\n- Every next step must correspond to supplied evidence or an accepted finding.\n- Prefer root-cause fixes over symptoms.\n- Put prerequisites before dependents.\n- Include validation requirements in the plan, but never change acceptance criteria merely to pass.\n- Explicitly stop if evidence is too weak, budget/risk is exceeded, or repeated attempts show no measurable progress.\n- Return strict JSON only.`,
      },
      { role: "user", content: JSON.stringify(context) },
    ],
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "repo_reasoned_completion_plan",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            summary: { type: "string" },
            nextSteps: { type: "array", minItems: 1, maxItems: 25, items: { type: "string" } },
            risks: { type: "array", maxItems: 12, items: { type: "string" } },
            validation: { type: "array", maxItems: 12, items: { type: "string" } },
            stopConditions: { type: "array", maxItems: 8, items: { type: "string" } },
            confidence: { type: "number", minimum: 0, maximum: 100 },
          },
          required: ["summary", "nextSteps", "risks", "validation", "stopConditions", "confidence"],
        },
      },
    },
    thinkingLevel: "high",
    timeoutMs: 65_000,
  }, ai);
  return JSON.parse(result.content || "{}") as {
    summary: string;
    nextSteps: string[];
    risks: string[];
    validation: string[];
    stopConditions: string[];
    confidence: number;
  };
}

function unique(values: string[], max = 25) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= max) break;
  }
  return out;
}

export async function reasonAboutRepositoryPlan(
  supabase: SupabaseClient,
  userId: string,
  input: {
    repo: string;
    requestedNextSteps?: string[];
    analysisId?: string;
    itemRank?: number;
    completionRunId?: string;
    portfolioRunId?: string;
    mode?: "plan" | "replan";
  },
): Promise<ReasonedPlanningResult> {
  const requestedNextSteps = unique(input.requestedNextSteps ?? [], 25);
  const traceId = await insertTrace(supabase, userId, {
    repo: input.repo,
    analysisId: input.analysisId,
    completionRunId: input.completionRunId,
    portfolioRunId: input.portfolioRunId,
    mode: input.mode ?? "plan",
  });

  try {
    const github = requireGithubCredential(await loadGithubCredential(supabase, userId));
    const [evidence, learning, memories, analysisContext, strategy] = await Promise.all([
      collectRepoEvidence(github.token, input.repo, requestedNextSteps),
      loadAdaptiveLearningContext(supabase, userId, input.repo),
      loadOperationalMemory(supabase, userId, input.repo),
      loadAnalysisContext(supabase, userId, input.analysisId, input.repo),
      resolvePromptStrategy(supabase, userId),
    ]);
    const aiCredential = await loadAiCredential(supabase, userId, github.token);
    const ai = { provider: aiCredential.provider, apiKey: aiCredential.apiKey };
    const memory = memoryGuidance(memories, 14);
    const legacyGuidance = learning.promptGuidance.slice(0, 12);
    const specialistSelections = selectSpecialists({
      repo: input.repo,
      description: evidence.repository.description,
      language: evidence.repository.language,
      topics: evidence.repository.topics,
      requestedNextSteps,
      analysisText: [
        JSON.stringify(analysisContext?.repoIntelligence ?? {}),
        String(analysisContext?.strategySummary ?? ""),
        String(analysisContext?.critique ?? ""),
      ],
    }, 3);

    await updateTrace(supabase, userId, traceId, {
      stage: "diagnosing",
      prompt_version: strategy.version,
      strategy_arm: strategy.arm,
      specialists: specialistSelections,
      evidence: {
        repository: evidence.repository,
        treeSignals: evidence.treeSignals,
        filesInspected: evidence.files.map((file) => file.path),
        requestedNextSteps,
        analysisContext,
        memory,
        legacyGuidance,
      },
    });

    if (!ai.apiKey) {
      const fallback = unique([
        ...requestedNextSteps,
        ...memory,
        ...legacyGuidance,
        "Run existing tests, typechecks, build, security checks, and deployment-preview smoke verification; fix root causes rather than weakening acceptance criteria.",
      ]);
      const result: ReasonedPlanningResult = {
        traceId,
        version: REASONING_VERSION,
        repo: input.repo,
        promptVersion: strategy.version,
        strategyArm: strategy.arm,
        specialists: specialistSelections.map((item) => item.role),
        summary: "AI reasoning credential unavailable; using measured operational memory and deterministic repository evidence instead of silently dropping learning.",
        nextSteps: fallback,
        risks: ["Multi-agent reasoning could not run because no usable AI credential was available."],
        validation: ["Require CI and deployment-preview verification before treating changes as successful."],
        stopConditions: ["Stop if validation cannot be observed or the repository base moves during execution."],
        confidence: memory.length ? 55 : 35,
        evidence,
      };
      await updateTrace(supabase, userId, traceId, {
        stage: "complete",
        status: "partial",
        decision: result,
        confidence: result.confidence,
        completed_at: new Date().toISOString(),
      });
      return result;
    }

    const sharedContext = {
      reasoningVersion: REASONING_VERSION,
      repositoryEvidence: evidence,
      requestedNextSteps,
      analysisContext,
      measuredLearning: {
        operationalMemory: memory,
        priorSuccesses: learning.recentSuccesses,
        priorFailures: learning.recentFailures,
        crossRepoPatterns: learning.crossRepoPatterns,
        strategyPerformance: learning.strategyPerformance,
      },
      promptStrategy: {
        version: strategy.version,
        arm: strategy.arm,
        mutableGuidance: strategy.guidance,
        experiment: strategy.experiment,
      },
    };

    const diagnosis = await runEvidenceAnalyst(ai, sharedContext);
    await updateTrace(supabase, userId, traceId, {
      stage: "critic_review",
      hypotheses: diagnosis.findings,
      decision: { evidenceSummary: diagnosis.summary, unknowns: diagnosis.unknowns },
    });

    const critic = await runCritic(ai, { ...sharedContext, diagnosis });
    await updateTrace(supabase, userId, traceId, {
      stage: "specialist_review",
      critiques: critic,
      confidence: critic.confidence,
    });

    const specialists = await Promise.all(
      specialistSelections.map((selection) => runSpecialist(ai, selection.role, { ...sharedContext, diagnosis, critic })),
    );
    await updateTrace(supabase, userId, traceId, {
      stage: "synthesizing_plan",
      specialists: specialists.length ? specialists : specialistSelections,
    });

    const planned = await runPlanner(ai, { ...sharedContext, diagnosis, critic, specialists });
    const nextSteps = unique([
      ...planned.nextSteps,
      ...planned.validation.map((step) => `Validation requirement: ${step}`),
    ]);
    const result: ReasonedPlanningResult = {
      traceId,
      version: REASONING_VERSION,
      repo: input.repo,
      promptVersion: strategy.version,
      strategyArm: strategy.arm,
      specialists: specialists.map((item) => item.role),
      summary: planned.summary,
      nextSteps,
      risks: unique([...critic.regressionRisks, ...specialists.flatMap((item) => item.risks), ...planned.risks], 16),
      validation: unique([...specialists.flatMap((item) => item.validation), ...planned.validation], 16),
      stopConditions: unique(planned.stopConditions, 8),
      confidence: Math.round(Math.min(planned.confidence, Math.max(critic.confidence, 40)) * 10) / 10,
      evidence,
    };

    await updateTrace(supabase, userId, traceId, {
      stage: "complete",
      status: "succeeded",
      hypotheses: diagnosis.findings,
      critiques: { critic, specialists },
      decision: result,
      confidence: result.confidence,
      completed_at: new Date().toISOString(),
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateTrace(supabase, userId, traceId, {
      stage: "failed",
      status: "failed",
      error: message,
      completed_at: new Date().toISOString(),
    });
    throw error;
  }
}
