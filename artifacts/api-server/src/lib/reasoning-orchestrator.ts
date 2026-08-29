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
const REASONING_VERSION = "reasoning-orchestrator-v4-hypothesis-critic-specialists";

interface RepoTreeEntry {
  path: string;
  type: string;
  size?: number;
}

export interface RepoEvidence {
  repository: {
    repo: string;
    description: string | null;
    language: string | null;
    topics: string[];
    defaultBranch: string;
    evidenceRef: string;
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
  alternativeCauses: string[];
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
  confidence: number;
}

interface PlannerResult {
  summary: string;
  nextSteps: string[];
  risks: string[];
  validation: string[];
  stopConditions: string[];
  confidence: number;
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

function arrayOfStrings(value: unknown, max = 25): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, max);
}

function finite(value: unknown, fallback: number, min = 0, max = 100) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function unique(values: string[], max = 25) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = String(raw || "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= max) break;
  }
  return result;
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
  const json = await response.json() as { content?: string; encoding?: string };
  if (json.encoding !== "base64" || !json.content) return null;
  return Buffer.from(json.content, "base64").toString("utf-8");
}

async function collectRepoEvidence(token: string, repoName: string, requestedNextSteps: string[], ref?: string): Promise<RepoEvidence> {
  const repoResponse = await ghFetch(token, `/repos/${repoName}`);
  if (!repoResponse.ok) throw Object.assign(new Error(`Repo not found or inaccessible: ${repoName}`), { status: 404 });
  const repo = await repoResponse.json() as Record<string, unknown>;
  const defaultBranch = String(repo.default_branch || "main");
  const evidenceRef = ref?.trim() || defaultBranch;
  const branchResponse = await ghFetch(token, `/repos/${repoName}/branches/${encodeURIComponent(evidenceRef)}`);
  if (!branchResponse.ok) throw new Error(`Unable to inspect ${repoName} ref ${evidenceRef}.`);
  const branch = await branchResponse.json() as { commit?: { sha?: string } };
  const headSha = String(branch.commit?.sha || "");
  if (!/^[0-9a-f]{40}$/i.test(headSha)) throw new Error(`Unable to resolve a valid head SHA for ${repoName}.`);
  const treeResponse = await ghFetch(token, `/repos/${repoName}/git/trees/${headSha}?recursive=1`);
  if (!treeResponse.ok) throw new Error(`Unable to inspect ${repoName} tree.`);
  const treeJson = await treeResponse.json() as { tree?: RepoTreeEntry[]; truncated?: boolean };
  if (treeJson.truncated) throw new Error(`Repository tree for ${repoName} is truncated; refusing to reason from incomplete structural evidence.`);
  const tree = (treeJson.tree ?? []).filter((entry) => entry.type === "blob");

  const selected = tree
    .filter((entry) => (entry.size ?? 0) <= 250_000)
    .map((entry) => ({ path: entry.path, score: filePriority(entry.path, requestedNextSteps) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, MAX_EVIDENCE_FILES);

  // Fetch concurrently for latency, then enforce the global evidence budget in a
  // deterministic sequential packing pass. No worker mutates a shared budget.
  const fetched = new Map<string, string>();
  let cursor = 0;
  const workers = Math.min(6, selected.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (cursor < selected.length) {
      const item = selected[cursor++];
      const content = await fetchFile(token, repoName, item.path, headSha);
      if (content !== null) fetched.set(item.path, content.slice(0, MAX_FILE_CHARS));
    }
  }));

  const files: Array<{ path: string; content: string }> = [];
  let remaining = MAX_TOTAL_EVIDENCE_CHARS;
  for (const item of selected) {
    if (remaining <= 0) break;
    const content = fetched.get(item.path);
    if (content === undefined) continue;
    const bounded = content.slice(0, Math.min(MAX_FILE_CHARS, remaining));
    if (!bounded) continue;
    files.push({ path: item.path, content: bounded });
    remaining -= bounded.length;
  }

  const paths = tree.map((entry) => entry.path.toLowerCase());
  return {
    repository: {
      repo: repoName,
      description: typeof repo.description === "string" ? repo.description : null,
      language: typeof repo.language === "string" ? repo.language : null,
      topics: Array.isArray(repo.topics) ? repo.topics.map(String) : [],
      defaultBranch,
      evidenceRef,
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
    files,
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
  const ranking = Array.isArray(intelligence?.ranking) ? intelligence.ranking as Array<Record<string, unknown>> : [];
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
  await supabase.from("reasoning_traces").update({ ...values, updated_at: new Date().toISOString() }).eq("id", traceId).eq("user_id", userId);
}

function normalizeFinding(value: unknown, index: number): Finding | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const severity = ["critical", "high", "medium", "low"].includes(String(row.severity)) ? String(row.severity) as Finding["severity"] : "medium";
  const rootCause = String(row.rootCause || "").trim();
  const recommendedAction = String(row.recommendedAction || "").trim();
  if (!rootCause || !recommendedAction) return null;
  return {
    id: String(row.id || `finding-${index + 1}`),
    category: String(row.category || "general"),
    severity,
    confidence: finite(row.confidence, 50),
    evidence: arrayOfStrings(row.evidence, 8),
    rootCause,
    alternativeCauses: arrayOfStrings(row.alternativeCauses, 6),
    recommendedAction,
    validation: String(row.validation || "Validate with the repository's existing tests/build/runtime evidence."),
  };
}

function normalizeEvidenceAnalysis(value: unknown): EvidenceAnalysis {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawFindings = Array.isArray(row.findings) ? row.findings : [];
  return {
    summary: String(row.summary || "Repository evidence was inspected, but the analyst returned no reliable summary."),
    findings: rawFindings.map(normalizeFinding).filter((item): item is Finding => item !== null).slice(0, 16),
    unknowns: arrayOfStrings(row.unknowns, 10),
  };
}

function normalizeCritic(value: unknown): CriticResult {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    acceptedFindingIds: arrayOfStrings(row.acceptedFindingIds, 16),
    rejectedFindingIds: arrayOfStrings(row.rejectedFindingIds, 16),
    critique: arrayOfStrings(row.critique, 12),
    regressionRisks: arrayOfStrings(row.regressionRisks, 12),
    missingEvidence: arrayOfStrings(row.missingEvidence, 12),
    confidence: finite(row.confidence, 50),
  };
}

function normalizeSpecialist(role: SpecialistRole, value: unknown): SpecialistResult {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    role,
    summary: String(row.summary || `No reliable ${role} specialist summary was returned.`),
    priorities: arrayOfStrings(row.priorities, 8),
    risks: arrayOfStrings(row.risks, 8),
    validation: arrayOfStrings(row.validation, 8),
    confidence: finite(row.confidence, 50),
  };
}

function normalizePlanner(value: unknown): PlannerResult {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    summary: String(row.summary || "Complete the verified blockers in prerequisite order and prove each result."),
    nextSteps: arrayOfStrings(row.nextSteps, 25),
    risks: arrayOfStrings(row.risks, 12),
    validation: arrayOfStrings(row.validation, 12),
    stopConditions: arrayOfStrings(row.stopConditions, 8),
    confidence: finite(row.confidence, 50),
  };
}

async function runEvidenceAnalyst(ai: { provider: string; apiKey: string | null }, context: Record<string, unknown>): Promise<EvidenceAnalysis> {
  const result = await callAI({
    messages: [
      {
        role: "system",
        content: `You are RepoFinisher's evidence analyst and root-cause investigator. Diagnose why this repository is not yet genuinely finished using only supplied evidence.\n\n${IMMUTABLE_AGENT_SAFETY_POLICY}\n\nFor every material gap, distinguish verified evidence from inference, state the most likely root cause, list plausible alternative causes that must be disproved, and define an observable validation result. Prefer blockers to cosmetic scope. Return strict JSON only.`,
      },
      { role: "user", content: JSON.stringify(context) },
    ],
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "repo_evidence_analysis_v4",
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
                  alternativeCauses: { type: "array", maxItems: 6, items: { type: "string" } },
                  recommendedAction: { type: "string" },
                  validation: { type: "string" },
                },
                required: ["id", "category", "severity", "confidence", "evidence", "rootCause", "alternativeCauses", "recommendedAction", "validation"],
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
  try { return normalizeEvidenceAnalysis(JSON.parse(result.content || "{}")); } catch { return normalizeEvidenceAnalysis({}); }
}

async function runCritic(ai: { provider: string; apiKey: string | null }, context: Record<string, unknown>): Promise<CriticResult> {
  const result = await callAI({
    messages: [
      {
        role: "system",
        content: `You are RepoFinisher's skeptical verification critic. Try to falsify the diagnosis. Reject unsupported findings, identify missing evidence and regression risk, detect plans that merely move symptoms, and protect existing working behavior.\n\n${IMMUTABLE_AGENT_SAFETY_POLICY}\n\nConfidence means confidence in your critique, not a cap on the planner. Return strict JSON only.`,
      },
      { role: "user", content: JSON.stringify(context) },
    ],
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "repo_reasoning_critique_v4",
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
  try { return normalizeCritic(JSON.parse(result.content || "{}")); } catch { return normalizeCritic({}); }
}

async function runSpecialist(ai: { provider: string; apiKey: string | null }, role: SpecialistRole, context: Record<string, unknown>): Promise<SpecialistResult> {
  const result = await callAI({
    messages: [
      {
        role: "system",
        content: `You are RepoFinisher's ${role} specialist. ${specialistObjective(role)}\n\n${IMMUTABLE_AGENT_SAFETY_POLICY}\n\nChallenge the shared diagnosis when specialty evidence disagrees. Prioritize only changes that materially improve verified completion/readiness. Return strict JSON only.`,
      },
      { role: "user", content: JSON.stringify(context) },
    ],
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: `${role.replace(/-/g, "_")}_specialist_v4`,
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            summary: { type: "string" },
            priorities: { type: "array", maxItems: 8, items: { type: "string" } },
            risks: { type: "array", maxItems: 8, items: { type: "string" } },
            validation: { type: "array", maxItems: 8, items: { type: "string" } },
            confidence: { type: "number", minimum: 0, maximum: 100 },
          },
          required: ["summary", "priorities", "risks", "validation", "confidence"],
        },
      },
    },
    thinkingLevel: "medium",
    timeoutMs: 50_000,
  }, ai);
  try { return normalizeSpecialist(role, JSON.parse(result.content || "{}")); } catch { return normalizeSpecialist(role, {}); }
}

async function runPlanner(ai: { provider: string; apiKey: string | null }, context: Record<string, unknown>): Promise<PlannerResult> {
  const result = await callAI({
    messages: [
      {
        role: "system",
        content: `You are RepoFinisher's principal completion planner. Synthesize repository evidence, competing root-cause hypotheses, skeptical critique, measured operational learning, prompt-strategy guidance, and specialist reviews into the smallest ordered plan most likely to make the intended product genuinely complete.\n\n${IMMUTABLE_AGENT_SAFETY_POLICY}\n\nRules:\n- Every next step must be grounded in supplied evidence, an accepted finding, or a clearly labeled prerequisite.\n- Prefer root-cause fixes over symptoms and high-value user-flow completion over cosmetic scope.\n- Put prerequisites before dependents.\n- Explicitly plan verification and failure handling, but never change acceptance criteria just to pass.\n- Use measured learning as evidence, not dogma; current repository evidence wins when they conflict.\n- Reject repeated failed strategies unless new evidence materially changes the hypothesis.\n- Stop if evidence is too weak, risk/budget is exceeded, or repeated attempts show no measurable progress.\n- Return strict JSON only.`,
      },
      { role: "user", content: JSON.stringify(context) },
    ],
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "repo_reasoned_completion_plan_v4",
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
  try { return normalizePlanner(JSON.parse(result.content || "{}")); } catch { return normalizePlanner({}); }
}

function evidenceConfidence(diagnosis: EvidenceAnalysis, critic: CriticResult) {
  const accepted = new Set(critic.acceptedFindingIds);
  const findings = diagnosis.findings.filter((finding) => accepted.size === 0 ? !critic.rejectedFindingIds.includes(finding.id) : accepted.has(finding.id));
  if (!findings.length) return 40;
  return findings.reduce((sum, finding) => sum + finding.confidence, 0) / findings.length;
}

function finalConfidence(planner: PlannerResult, diagnosis: EvidenceAnalysis, critic: CriticResult, specialists: SpecialistResult[]) {
  const evidence = evidenceConfidence(diagnosis, critic);
  const specialist = specialists.length
    ? specialists.reduce((sum, item) => sum + item.confidence, 0) / specialists.length
    : 55;
  const raw = planner.confidence * 0.5 + evidence * 0.25 + specialist * 0.15 + critic.confidence * 0.1;
  const uncertaintyPenalty = Math.min(18, diagnosis.unknowns.length * 1.5 + critic.missingEvidence.length * 1.5);
  return Math.round(Math.max(10, Math.min(99, raw - uncertaintyPenalty)) * 10) / 10;
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
    ref?: string;
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
      collectRepoEvidence(github.token, input.repo, requestedNextSteps, input.ref),
      loadAdaptiveLearningContext(supabase, userId, input.repo),
      loadOperationalMemory(supabase, userId, input.repo),
      loadAnalysisContext(supabase, userId, input.analysisId, input.repo),
      resolvePromptStrategy(supabase, userId),
    ]);
    const aiCredential = await loadAiCredential(supabase, userId, github.token);
    const ai = { provider: aiCredential.provider, apiKey: aiCredential.apiKey };
    const memory = memoryGuidance(memories, 14);
    const legacyGuidance = arrayOfStrings(learning.promptGuidance, 12);
    const specialistSelections = selectSpecialists({
      repo: input.repo,
      description: evidence.repository.description,
      language: evidence.repository.language,
      topics: evidence.repository.topics,
      requestedNextSteps,
      analysisText: [JSON.stringify(analysisContext?.repoIntelligence ?? {}), String(analysisContext?.strategySummary ?? ""), String(analysisContext?.critique ?? "")],
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
        evidenceChars: evidence.files.reduce((sum, file) => sum + file.content.length, 0),
        requestedNextSteps,
        analysisContext,
        operationalMemory: memory,
        legacyGuidance,
      },
    });

    if (!ai.apiKey) {
      const nextSteps = unique([
        ...requestedNextSteps,
        ...memory,
        ...legacyGuidance,
        "Run existing tests, typechecks, build, security checks, and deployment-preview smoke verification; repair root causes without weakening acceptance criteria.",
      ]);
      const fallback: ReasonedPlanningResult = {
        traceId,
        version: REASONING_VERSION,
        repo: input.repo,
        promptVersion: strategy.version,
        strategyArm: strategy.arm,
        specialists: specialistSelections.map((item) => item.role),
        summary: "No usable AI reasoning credential was available, so this plan is limited to deterministic repository evidence and measured operational memory.",
        nextSteps,
        risks: ["Multi-agent hypothesis testing and critique could not run for this plan."],
        validation: ["Require CI and deployment/runtime verification before treating changes as successful."],
        stopConditions: ["Stop if validation cannot be observed or the repository base moves during execution."],
        confidence: memory.length ? 55 : 35,
        evidence,
      };
      await updateTrace(supabase, userId, traceId, { stage: "complete", status: "partial", decision: fallback, confidence: fallback.confidence, completed_at: new Date().toISOString() });
      return fallback;
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
    await updateTrace(supabase, userId, traceId, { stage: "specialist_review", critiques: critic, confidence: critic.confidence });

    const specialists = await Promise.all(
      specialistSelections.map((selection) => runSpecialist(ai, selection.role, { ...sharedContext, diagnosis, critic })),
    );
    await updateTrace(supabase, userId, traceId, { stage: "synthesizing_plan", specialists: specialists.length ? specialists : specialistSelections });

    const planned = await runPlanner(ai, { ...sharedContext, diagnosis, critic, specialists });
    const nextSteps = unique([
      ...planned.nextSteps,
      ...planned.validation.map((step) => `Validation requirement: ${step}`),
    ]);
    if (!nextSteps.length) {
      nextSteps.push("Re-inspect the highest-severity accepted finding and implement the smallest evidence-backed repair with an executable validation check.");
    }

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
      confidence: finalConfidence(planned, diagnosis, critic, specialists),
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
    await updateTrace(supabase, userId, traceId, { stage: "failed", status: "failed", error: message, completed_at: new Date().toISOString() });
    throw error;
  }
}
