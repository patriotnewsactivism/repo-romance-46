import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildRepoIndex,
  classifyRepository,
  estimateCommercializationProbability,
  estimateRemainingWork,
  primaryKind,
  rankInvestmentOpportunities,
  scoreCompletion,
  scoreProductionReadiness,
  valueRepository,
  type AcceptanceEvidence,
  type InvestmentOpportunityInput,
  type MoneyRange,
} from "@workspace/repo-os";
import { loadGithubCredential, requireGithubCredential } from "./credentials";
import { recordRepoLearning } from "./adaptive-learning";
import { recordRunOutcomeMemories } from "./learning-memory";
import {
  normalizeInvestmentMetrics,
  scoreRunOutcome,
  type InvestmentMetrics,
  type RunOutcomeScore,
} from "./run-outcome-score";
import type { PreparedFinishPlan } from "./repo-finisher-engine";

interface EvolvableCompletionRun {
  id: string;
  user_id: string;
  repo: string;
  plan: PreparedFinishPlan;
  status: "succeeded" | "failed" | "stale" | string;
  head_sha: string | null;
  error: string | null;
  ci_status?: string | null;
  created_at: string;
  updated_at: string;
  analysis_id?: string | null;
  item_rank?: number | null;
  prompt_version?: string | null;
  baseline_metrics?: unknown;
  outcome_metrics?: unknown;
  outcome_score?: number | null;
  evaluated_at?: string | null;
}

interface GhRepo {
  full_name: string;
  default_branch: string;
  stargazers_count: number;
  forks_count: number;
  subscribers_count: number;
  pushed_at: string;
}

interface GhTreeEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
}

interface RepositoryOutcomeSnapshot {
  repo: string;
  completionPct: number;
  productionReadinessPct: number;
  presentValueUsd: MoneyRange;
  commercializationProbability: number;
  remainingWork: { hours: number; costUsd: MoneyRange };
  completion: unknown;
  readiness: unknown;
  currentValuation: unknown;
  github: {
    stars: number;
    forks: number;
    subscribers: number;
    lastPush: string;
    sourceFiles: number;
    sourceBytes: number;
  };
}

const GH_API = "https://api.github.com";

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "repo-finisher",
  };
}

async function ghJson<T>(token: string, path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${GH_API}${path}`, { headers: ghHeaders(token), signal: controller.signal });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub ${path} returned ${response.status}: ${body.slice(0, 180)}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function ghRaw(token: string, repo: string, path: string, ref: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(
      `${GH_API}/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
      { headers: { ...ghHeaders(token), Accept: "application/vnd.github.raw" }, signal: controller.signal },
    );
    if (!response.ok) return null;
    const text = await response.text();
    return text.length <= 220_000 ? text : null;
  } finally {
    clearTimeout(timer);
  }
}

function priority(path: string): number {
  const lower = path.toLowerCase();
  if (/(^|\/)package\.json$|pyproject\.toml$|cargo\.toml$|go\.mod$/.test(lower)) return 100;
  if (/(^|\/)readme(\.|$)|(^|\/)license(\.|$)/.test(lower)) return 95;
  if (lower.startsWith(".github/workflows/")) return 92;
  if (/(dockerfile|vercel\.json|render\.yaml|firebase\.json|cloudbuild\.yaml|\.env\.example)$/.test(lower)) return 90;
  if (/(test|spec|__tests__)/.test(lower)) return 82;
  if (/^(src|app|server|api|lib)\//.test(lower) && /\.(ts|tsx|js|jsx|py|go|rs|rb|java|kt|swift)$/.test(lower)) return 75;
  if (/\.(ts|tsx|js|jsx|py|go|rs|rb|java|kt|swift)$/.test(lower)) return 55;
  if (/\.(md|yml|yaml|json|toml|sql)$/.test(lower)) return 35;
  return 0;
}

async function fetchIndexFiles(token: string, repo: GhRepo, tree: GhTreeEntry[], headSha: string) {
  const selected = tree
    .filter((entry) => entry.type === "blob" && (entry.size ?? 0) <= 220_000)
    .map((entry) => ({ entry, score: priority(entry.path) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path))
    .slice(0, 60)
    .map(({ entry }) => entry);

  const files: Array<{ path: string; content: string }> = [];
  let cursor = 0;
  const workers = Math.min(6, selected.length);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (cursor < selected.length) {
        const entry = selected[cursor++];
        const content = await ghRaw(token, repo.full_name, entry.path, headSha);
        if (content !== null) files.push({ path: entry.path, content });
      }
    }),
  );
  return files;
}

async function fetchAcceptanceEvidence(token: string, repo: string, headSha: string): Promise<AcceptanceEvidence> {
  try {
    const data = await ghJson<{ check_runs?: Array<{ name: string; status: string; conclusion: string | null }> }>(
      token,
      `/repos/${repo}/commits/${headSha}/check-runs?per_page=100`,
    );
    const checks = data.check_runs ?? [];
    const passed = (pattern: RegExp) =>
      checks.some(
        (check) =>
          pattern.test(check.name) &&
          check.status === "completed" &&
          ["success", "neutral", "skipped"].includes(check.conclusion || ""),
      );
    return {
      buildPassed: passed(/build|ci|verify/i),
      typecheckPassed: passed(/type|tsc|ci|verify/i),
      testsPassed: passed(/test|ci|verify/i),
      securityBlockersResolved: passed(/security|codeql|sast|dependency/i) || undefined,
      verifiedAt: checks.length > 0 ? new Date().toISOString() : undefined,
    };
  } catch {
    return {};
  }
}

function activityScore(pushedAt: string): number {
  const days = Math.max(0, (Date.now() - new Date(pushedAt).getTime()) / 86_400_000);
  if (days <= 7) return 100;
  if (days <= 30) return 90;
  if (days <= 90) return 72;
  if (days <= 180) return 52;
  if (days <= 365) return 30;
  return 10;
}

function tractionScore(repo: GhRepo): number {
  const stars = Math.log10(repo.stargazers_count + 1) * 22;
  const forks = Math.log10(repo.forks_count + 1) * 15;
  const subscribers = Math.log10(repo.subscribers_count + 1) * 18;
  return Math.max(0, Math.min(100, Math.round(stars + forks + subscribers)));
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function moneyRange(value: unknown): MoneyRange | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const low = finiteNumber(record.low);
  const high = finiteNumber(record.high);
  if (low === null || high === null) return null;
  return { low, high };
}

function asOpportunity(entry: unknown): InvestmentOpportunityInput | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const presentValueUsd = moneyRange(record.presentValueUsd);
  const potentialValueUsd = moneyRange(record.potentialValueUsd);
  const remaining = record.remainingWork && typeof record.remainingWork === "object"
    ? (record.remainingWork as Record<string, unknown>)
    : null;
  const remainingCost = moneyRange(remaining?.costUsd);
  const repo = typeof record.repo === "string" ? record.repo : "";
  const completionPct = finiteNumber(record.completionPct);
  const productionReadinessPct = finiteNumber(record.productionReadinessPct);
  const marketNeed = finiteNumber(record.marketNeed);
  const demand = finiteNumber(record.demand);
  const competitivePressure = finiteNumber(record.competitivePressure);
  const commercializationProbability = finiteNumber(record.commercializationProbability);
  const evidenceConfidence = finiteNumber(record.evidenceConfidence);
  const remainingHours = finiteNumber(remaining?.hours);

  if (
    !repo ||
    !presentValueUsd ||
    !potentialValueUsd ||
    !remainingCost ||
    completionPct === null ||
    productionReadinessPct === null ||
    marketNeed === null ||
    demand === null ||
    competitivePressure === null ||
    commercializationProbability === null ||
    evidenceConfidence === null ||
    remainingHours === null
  ) {
    return null;
  }

  return {
    repo,
    completionPct,
    productionReadinessPct,
    presentValueUsd,
    potentialValueUsd,
    marketNeed,
    demand,
    competitivePressure,
    commercializationProbability,
    remainingWork: { hours: remainingHours, costUsd: remainingCost },
    evidenceConfidence,
    evidence: Array.isArray(record.evidence) ? (record.evidence as InvestmentOpportunityInput["evidence"]) : undefined,
  };
}

export async function loadBaselineInvestmentMetrics(
  supabase: SupabaseClient,
  userId: string,
  analysisId: string | undefined,
  repo: string,
): Promise<InvestmentMetrics | null> {
  if (!analysisId) return null;
  const { data, error } = await supabase
    .from("analyses")
    .select("investment_intelligence")
    .eq("id", analysisId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  const intelligence = (data as Record<string, unknown>).investment_intelligence;
  if (!intelligence || typeof intelligence !== "object") return null;
  const ranking = (intelligence as Record<string, unknown>).ranking;
  if (!Array.isArray(ranking)) return null;
  const entry = ranking.find((item) => (item as Record<string, unknown>)?.repo === repo);
  return normalizeInvestmentMetrics(entry);
}

async function inspectRepositoryAtCommit(
  supabase: SupabaseClient,
  userId: string,
  repoName: string,
  headSha: string,
  baselineOpportunity: InvestmentOpportunityInput,
): Promise<RepositoryOutcomeSnapshot> {
  const github = requireGithubCredential(await loadGithubCredential(supabase, userId));
  const token = github.token;
  const repo = await ghJson<GhRepo>(token, `/repos/${repoName}`);
  const treeResult = await ghJson<{ tree: GhTreeEntry[]; truncated?: boolean }>(
    token,
    `/repos/${repoName}/git/trees/${headSha}?recursive=1`,
  );
  const tree = treeResult.tree ?? [];
  const [files, acceptance] = await Promise.all([
    fetchIndexFiles(token, repo, tree, headSha),
    fetchAcceptanceEvidence(token, repoName, headSha),
  ]);

  const index = buildRepoIndex({
    repo: repoName,
    defaultBranch: repo.default_branch || "main",
    tree,
    files,
  });
  const classifications = classifyRepository(index);
  const kind = primaryKind(classifications);
  const completion = scoreCompletion(index, kind, acceptance);
  const readiness = scoreProductionReadiness(index, acceptance);
  const sourceFiles = index.files.filter((file) => file.role === "source");
  const sourceBytes = sourceFiles.reduce((sum, file) => sum + file.size, 0);
  const criticalGaps = completion.missingBreakdown.filter((gap) => gap.lostPoints >= 3).length;
  const remainingWork = estimateRemainingWork({
    completionPct: completion.overall,
    sourceFiles: sourceFiles.length,
    sourceBytes,
    missingCriticalDimensions: criticalGaps,
  });
  const estimatedTotalBuildHours = Math.max(40, sourceFiles.length * 1.8 + sourceBytes / 10_000);
  const currentValuation = valueRepository({
    replacement: {
      estimatedHours: estimatedTotalBuildHours,
      completionPct: completion.overall,
      marketPotential: Math.max(
        1,
        Math.min(5, (baselineOpportunity.marketNeed + baselineOpportunity.demand) / 40),
      ),
      stars: repo.stargazers_count,
      hasRevenueSignals: false,
    },
    traction: { githubStars: repo.stargazers_count },
  });
  const commercializationProbability = estimateCommercializationProbability({
    completionPct: completion.overall,
    productionReadinessPct: readiness.overall,
    marketNeed: baselineOpportunity.marketNeed,
    demand: baselineOpportunity.demand,
    competitivePressure: baselineOpportunity.competitivePressure,
    tractionScore: tractionScore(repo),
    activityScore: activityScore(repo.pushed_at),
  });

  return {
    repo: repoName,
    completionPct: completion.overall,
    productionReadinessPct: readiness.overall,
    presentValueUsd: currentValuation.range,
    commercializationProbability,
    remainingWork,
    completion,
    readiness,
    currentValuation,
    github: {
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      subscribers: repo.subscribers_count,
      lastPush: repo.pushed_at,
      sourceFiles: sourceFiles.length,
      sourceBytes,
    },
  };
}

function portfolioSummary(ranking: Array<InvestmentOpportunityInput & { rank: number; finishFirstScore: number }>) {
  return {
    reposScored: ranking.length,
    presentValueLow: ranking.reduce((sum, item) => sum + item.presentValueUsd.low, 0),
    presentValueHigh: ranking.reduce((sum, item) => sum + item.presentValueUsd.high, 0),
    potentialValueLow: ranking.reduce((sum, item) => sum + item.potentialValueUsd.low, 0),
    potentialValueHigh: ranking.reduce((sum, item) => sum + item.potentialValueUsd.high, 0),
    weightedCommercializationProbability:
      ranking.length === 0
        ? 0
        : Math.round(
            ranking.reduce((sum, item) => sum + item.commercializationProbability, 0) /
              ranking.length,
          ),
  };
}

function effectivePromptVersion(run: EvolvableCompletionRun) {
  const planVersion = run.plan?.reasoning?.promptVersion;
  return planVersion || run.prompt_version || "unknown";
}

async function rescorePortfolio(
  supabase: SupabaseClient,
  userId: string,
  run: EvolvableCompletionRun,
): Promise<{ after: InvestmentMetrics | null; intelligenceUpdated: boolean }> {
  if (!run.analysis_id || !run.head_sha) return { after: null, intelligenceUpdated: false };

  const { data: analysis, error } = await supabase
    .from("analyses")
    .select("investment_intelligence")
    .eq("id", run.analysis_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !analysis) return { after: null, intelligenceUpdated: false };

  const intelligence = (analysis as Record<string, unknown>).investment_intelligence;
  if (!intelligence || typeof intelligence !== "object") {
    return { after: null, intelligenceUpdated: false };
  }
  const intelligenceRecord = intelligence as Record<string, unknown>;
  const existingRanking = Array.isArray(intelligenceRecord.ranking) ? intelligenceRecord.ranking : [];
  const opportunities = existingRanking
    .map(asOpportunity)
    .filter((item): item is InvestmentOpportunityInput => item !== null);
  const baselineOpportunity = opportunities.find((item) => item.repo === run.repo);
  if (!baselineOpportunity) return { after: null, intelligenceUpdated: false };

  const snapshot = await inspectRepositoryAtCommit(
    supabase,
    userId,
    run.repo,
    run.head_sha,
    baselineOpportunity,
  );
  const updatedOpportunity: InvestmentOpportunityInput = {
    ...baselineOpportunity,
    completionPct: snapshot.completionPct,
    productionReadinessPct: snapshot.productionReadinessPct,
    presentValueUsd: snapshot.presentValueUsd,
    commercializationProbability: snapshot.commercializationProbability,
    remainingWork: snapshot.remainingWork,
    evidence: [
      ...(baselineOpportunity.evidence ?? []),
      {
        class: "verified",
        label: "Post-run verification snapshot",
        detail: `Completion and readiness were re-scored at verified run commit ${run.head_sha}.`,
        source: `https://github.com/${run.repo}/commit/${run.head_sha}`,
      },
    ],
  };

  const reranked = rankInvestmentOpportunities(
    opportunities.map((item) => (item.repo === run.repo ? updatedOpportunity : item)),
  );
  const oldDetails = new Map(
    existingRanking
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item) => [String(item.repo || ""), item.details]),
  );
  const ranking = reranked.map((item) => ({
    ...item,
    details:
      item.repo === run.repo
        ? {
            ...(oldDetails.get(item.repo) && typeof oldDetails.get(item.repo) === "object"
              ? (oldDetails.get(item.repo) as Record<string, unknown>)
              : {}),
            completion: snapshot.completion,
            readiness: snapshot.readiness,
            currentValuation: snapshot.currentValuation,
            github: {
              ...((oldDetails.get(item.repo) as Record<string, unknown> | undefined)?.github as Record<string, unknown> | undefined),
              ...snapshot.github,
            },
            lastPostRunCommit: run.head_sha,
          }
        : oldDetails.get(item.repo),
  }));

  const target = ranking.find((item) => item.repo === run.repo);
  const after = normalizeInvestmentMetrics(target);
  const generatedAt = new Date().toISOString();
  const promptVersion = effectivePromptVersion(run);
  const updatedIntelligence = {
    ...intelligenceRecord,
    generatedAt,
    ranking,
    portfolio: portfolioSummary(reranked),
    recommendation: reranked[0]
      ? `Finish ${reranked[0].repo} first. Its ${reranked[0].finishFirstScore}/100 finish-first score is the strongest risk-adjusted value-unlock opportunity in this analysis.`
      : "No ranked recommendation is available.",
    lastPostRunRescore: {
      runId: run.id,
      repo: run.repo,
      commit: run.head_sha,
      promptVersion,
      generatedAt,
    },
  };

  const { error: updateError } = await supabase
    .from("analyses")
    .update({
      investment_intelligence: updatedIntelligence,
      investment_intelligence_updated_at: generatedAt,
    })
    .eq("id", run.analysis_id)
    .eq("user_id", userId);

  return { after, intelligenceUpdated: !updateError };
}

function filesAffected(run: EvolvableCompletionRun): string[] {
  return Array.isArray(run.plan?.changes)
    ? run.plan.changes.map((change) => change.path).filter(Boolean).slice(0, 25)
    : [];
}

export async function finalizeRunEvolution(
  supabase: SupabaseClient,
  userId: string,
  run: EvolvableCompletionRun,
): Promise<RunOutcomeScore | null> {
  if (!["succeeded", "failed", "stale"].includes(run.status)) return null;
  if (run.evaluated_at) return null;

  const baseline = normalizeInvestmentMetrics(run.baseline_metrics);
  let after: InvestmentMetrics | null = null;
  let intelligenceUpdated = false;
  let rescoreError: string | null = null;

  if (run.status === "succeeded" && run.head_sha && run.analysis_id) {
    try {
      const result = await rescorePortfolio(supabase, userId, run);
      after = result.after;
      intelligenceUpdated = result.intelligenceUpdated;
    } catch (error) {
      rescoreError = error instanceof Error ? error.message : String(error);
    }
  }

  const durationMs = Math.max(
    0,
    new Date(run.updated_at).getTime() - new Date(run.created_at).getTime(),
  );
  const outcome = scoreRunOutcome({
    status: run.status as "succeeded" | "failed" | "stale",
    baseline,
    after,
    durationMs,
    filesChanged: filesAffected(run).length,
  });
  const evaluatedAt = new Date().toISOString();
  const promptVersion = effectivePromptVersion(run);
  const outcomeMetrics = {
    baseline,
    after,
    deltas: outcome.deltas,
    summary: outcome.summary,
    intelligenceUpdated,
    rescoreError,
    promptVersion,
    reasoning: run.plan?.reasoning ?? null,
    evaluatedAt,
  };

  const { data: claimed, error: updateError } = await supabase
    .from("completion_runs")
    .update({
      outcome_metrics: outcomeMetrics,
      outcome_score: outcome.outcomeScore,
      evaluated_at: evaluatedAt,
      prompt_version: promptVersion,
    })
    .eq("id", run.id)
    .eq("user_id", userId)
    .is("evaluated_at", null)
    .select("id")
    .maybeSingle();
  if (updateError || !claimed) return null;

  const strategy = `prompt:${promptVersion}`;
  await recordRepoLearning(supabase, userId, run.repo, {
    action: "completion_run_evaluated",
    outcome: run.status === "succeeded" ? "success" : run.status === "stale" ? "partial" : "failure",
    duration_ms: durationMs,
    details: outcome.summary,
    files_affected: filesAffected(run),
    error_message: run.error ?? rescoreError ?? undefined,
    fix_pattern: strategy,
    prompt_version: promptVersion,
    metadata: {
      outcome_score: outcome.outcomeScore,
      completion_delta: outcome.deltas.completionPct,
      readiness_delta: outcome.deltas.productionReadinessPct,
      finish_first_delta: outcome.deltas.finishFirstScore,
      commercialization_delta: outcome.deltas.commercializationProbability,
      remaining_hours_delta: outcome.deltas.remainingHours,
      present_value_midpoint_delta: outcome.deltas.presentValueMidpointUsd,
      analysis_id: run.analysis_id ?? null,
      item_rank: run.item_rank ?? null,
      intelligence_updated: intelligenceUpdated,
      reasoning_trace_id: run.plan?.reasoning?.traceId ?? null,
      reasoning_confidence: run.plan?.reasoning?.confidence ?? null,
      specialists: run.plan?.reasoning?.specialists ?? [],
      run_id: run.id,
      head_sha: run.head_sha,
    },
    timestamp: evaluatedAt,
  });

  await recordRunOutcomeMemories(supabase, userId, {
    repo: run.repo,
    promptVersion,
    status: run.status as "succeeded" | "failed" | "stale",
    outcomeScore: outcome.outcomeScore,
    completionDelta: outcome.deltas.completionPct,
    readinessDelta: outcome.deltas.productionReadinessPct,
    error: run.error ?? rescoreError,
    filesAffected: filesAffected(run),
  }).catch(() => undefined);

  await supabase.from("completion_events").insert({
    run_id: run.id,
    user_id: userId,
    kind: "post_run_evaluation",
    status: run.status === "succeeded" ? "success" : run.status === "stale" ? "warning" : "error",
    message: outcome.summary,
    metadata: outcomeMetrics,
  });

  return outcome;
}
