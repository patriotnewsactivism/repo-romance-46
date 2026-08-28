import { randomUUID } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { Router, type IRouter } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { callAI } from "../lib/ai-provider";
import { loadAiCredential, loadGithubCredential, requireGithubCredential } from "../lib/credentials";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
const WORKER_LEASE_MS = 9 * 60_000;
const WORKER_BUDGET_MS = 7 * 60_000;
const MAX_FILE_CHARS = 70_000;
const MAX_DEEP_CONTEXT_CHARS = 120_000;
const MAX_COUNCIL_CONTEXT_CHARS = 200_000;
const METHOD_VERSION = "tiered-intelligence-v1";

interface RankingEntry {
  repo: string;
  rank: number;
  finishFirstScore: number;
  completionPct?: number;
  productionReadinessPct?: number;
  presentValueUsd?: { low?: number; high?: number };
  potentialValueUsd?: { low?: number; high?: number };
  marketNeed?: number;
  demand?: number;
  commercializationProbability?: number;
  evidenceConfidence?: number;
  remainingWork?: { hours?: number; costUsd?: { low?: number; high?: number } };
  details?: unknown;
}

interface TierRun {
  id: string;
  user_id: string;
  analysis_id: string;
  status: "queued" | "running" | "complete" | "partial_failed" | "failed" | "cancelled";
  total_repos: number;
  deep_limit: number;
  council_limit: number;
  completed_count: number;
  failed_count: number;
  progress_message: string | null;
  summary: unknown;
  worker_token: string | null;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TierItem {
  id: string;
  run_id: string;
  user_id: string;
  analysis_id: string;
  repo: string;
  initial_rank: number;
  initial_finish_first_score: number;
  target_depth: "deep_source" | "council";
  status: "queued" | "running" | "complete" | "failed" | "cancelled";
  refined_score: number | null;
  confidence: number | null;
  source_head_sha: string | null;
  result: unknown;
  error: string | null;
}

interface GhRepo {
  full_name: string;
  default_branch: string;
  description: string | null;
  language: string | null;
  topics?: string[];
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  size: number;
  pushed_at: string;
}

interface GhTreeEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
}

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "repo-finisher-tiered-intelligence",
  };
}

async function ghJson<T>(token: string, path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`https://api.github.com${path}`, { headers: ghHeaders(token), signal: controller.signal });
    if (!res.ok) throw new Error(`GitHub ${path} returned ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function ghRaw(token: string, repo: string, path: string, ref: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`, {
      headers: { ...ghHeaders(token), Accept: "application/vnd.github.raw" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, MAX_FILE_CHARS);
  } finally {
    clearTimeout(timeout);
  }
}

function pathPriority(path: string) {
  const lower = path.toLowerCase();
  if (/(^|\/)package\.json$|pyproject\.toml$|cargo\.toml$|go\.mod$/.test(lower)) return 100;
  if (/(^|\/)readme(\.|$)/.test(lower)) return 96;
  if (/^\.github\/workflows\//.test(lower)) return 92;
  if (/(dockerfile|vercel\.json|render\.ya?ml|firebase\.json|cloudbuild\.ya?ml|\.env\.example)$/.test(lower)) return 90;
  if (/(test|spec|__tests__)/.test(lower)) return 84;
  if (/^(src|app|server|api|lib)\//.test(lower) && /\.(ts|tsx|js|jsx|py|go|rs|rb|java|kt|swift|vue|svelte)$/.test(lower)) return 75;
  if (/\.(ts|tsx|js|jsx|py|go|rs|rb|java|kt|swift|vue|svelte)$/.test(lower)) return 55;
  if (/\.(md|json|ya?ml|toml|sql)$/.test(lower)) return 35;
  return 0;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

async function collectSourceContext(token: string, repoName: string, depth: TierItem["target_depth"]) {
  const repo = await ghJson<GhRepo>(token, `/repos/${repoName}`);
  const branch = repo.default_branch || "main";
  const ref = await ghJson<{ object: { sha: string } }>(token, `/repos/${repoName}/git/ref/heads/${encodeURIComponent(branch)}`);
  const headSha = ref.object.sha;
  const tree = await ghJson<{ tree?: GhTreeEntry[]; truncated?: boolean }>(token, `/repos/${repoName}/git/trees/${headSha}?recursive=1`);
  const maxChars = depth === "council" ? MAX_COUNCIL_CONTEXT_CHARS : MAX_DEEP_CONTEXT_CHARS;
  const maxFiles = depth === "council" ? 32 : 20;
  const selected = (tree.tree ?? [])
    .filter((entry) => entry.type === "blob" && (entry.size ?? 0) <= 220_000)
    .map((entry) => ({ entry, priority: pathPriority(entry.path) }))
    .filter(({ priority }) => priority > 0)
    .sort((a, b) => b.priority - a.priority || a.entry.path.localeCompare(b.entry.path))
    .slice(0, maxFiles)
    .map(({ entry }) => entry);

  const files: Array<{ path: string; content: string }> = [];
  let used = 0;
  for (const entry of selected) {
    if (used >= maxChars) break;
    const content = await ghRaw(token, repoName, entry.path, headSha);
    if (content === null) continue;
    const bounded = content.slice(0, maxChars - used);
    files.push({ path: entry.path, content: bounded });
    used += bounded.length;
  }
  return {
    repo: {
      name: repo.full_name,
      description: repo.description,
      language: repo.language,
      topics: repo.topics ?? [],
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      openIssues: repo.open_issues_count,
      size: repo.size,
      pushedAt: repo.pushed_at,
    },
    branch,
    headSha,
    treeTruncated: Boolean(tree.truncated),
    totalTreeEntries: (tree.tree ?? []).length,
    files,
    contextChars: used,
  };
}

async function analyzeCandidate(
  supabase: SupabaseClient,
  userId: string,
  githubToken: string,
  item: TierItem,
  base: RankingEntry,
) {
  const source = await collectSourceContext(githubToken, item.repo, item.target_depth);
  const ai = await loadAiCredential(supabase, userId, githubToken);
  if (!ai.apiKey) throw new Error(`No usable ${ai.provider} credential is configured for tiered intelligence.`);
  const council = item.target_depth === "council";
  const system = council
    ? `You are the senior review council for RepoFinisher. Evaluate this already top-ranked repository from three lenses at once: principal software architect, product/commercialization strategist, and quality/security reviewer. Use only the supplied repository evidence. Produce a decisive refinement of the existing deterministic portfolio score. Do not invent users, revenue, customers, TAM, security findings, or market traction. Lower confidence when evidence is thin. Return strict JSON only.`
    : `You are RepoFinisher's deep source-analysis agent. Refine an existing deterministic portfolio ranking by inspecting selected source/configuration files. Judge architecture, product readiness, monetization readiness, maintainability, differentiation signals, and technical risk from evidence only. Do not invent revenue, customers, market facts, or vulnerabilities. Return strict JSON only.`;
  const response = await callAI(
    {
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify({ baseRanking: base, source }) },
      ],
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "tiered_repository_intelligence",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              architecture_quality: { type: "integer", minimum: 0, maximum: 100 },
              product_readiness: { type: "integer", minimum: 0, maximum: 100 },
              monetization_readiness: { type: "integer", minimum: 0, maximum: 100 },
              maintainability: { type: "integer", minimum: 0, maximum: 100 },
              differentiation_signal: { type: "integer", minimum: 0, maximum: 100 },
              technical_risk: { type: "integer", minimum: 0, maximum: 100 },
              confidence: { type: "integer", minimum: 0, maximum: 100 },
              summary: { type: "string" },
              blockers: { type: "array", maxItems: 8, items: { type: "string" } },
              next_actions: { type: "array", maxItems: 8, items: { type: "string" } },
              architect_view: { type: "string" },
              product_view: { type: "string" },
              quality_security_view: { type: "string" },
            },
            required: [
              "architecture_quality",
              "product_readiness",
              "monetization_readiness",
              "maintainability",
              "differentiation_signal",
              "technical_risk",
              "confidence",
              "summary",
              "blockers",
              "next_actions",
              "architect_view",
              "product_view",
              "quality_security_view"
            ],
          },
        },
      },
      thinkingLevel: council ? "high" : "medium",
      timeoutMs: council ? 60_000 : 45_000,
    },
    { provider: ai.provider, apiKey: ai.apiKey, model: ai.model },
  );
  const result = JSON.parse(response.content || "{}") as Record<string, unknown>;
  const opportunityQuality = clamp(
    (Number(result.architecture_quality) + Number(result.product_readiness) + Number(result.monetization_readiness) + Number(result.maintainability) + Number(result.differentiation_signal)) / 5 - Number(result.technical_risk) * 0.22,
  );
  const refinedScore = Math.round(clamp(Number(base.finishFirstScore) * 0.65 + opportunityQuality * 0.35));
  return {
    sourceHeadSha: source.headSha,
    refinedScore,
    confidence: Number(result.confidence),
    result: {
      methodologyVersion: METHOD_VERSION,
      depth: item.target_depth,
      initialRank: item.initial_rank,
      initialFinishFirstScore: item.initial_finish_first_score,
      refinedFinishFirstScore: refinedScore,
      opportunityQuality: Math.round(opportunityQuality),
      sourceCoverage: {
        headSha: source.headSha,
        filesRead: source.files.length,
        contextChars: source.contextChars,
        totalTreeEntries: source.totalTreeEntries,
        treeTruncated: source.treeTruncated,
      },
      ...result,
    },
  };
}

async function loadRun(supabase: SupabaseClient, userId: string, runId: string) {
  const { data, error } = await supabase.from("portfolio_intelligence_runs").select("*").eq("id", runId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`Failed to load tiered intelligence run: ${error.message}`);
  if (!data) throw Object.assign(new Error("Tiered intelligence run not found."), { status: 404 });
  return data as TierRun;
}

async function baseRanking(supabase: SupabaseClient, userId: string, analysisId: string) {
  const { data, error } = await supabase.from("analyses").select("investment_intelligence").eq("id", analysisId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`Failed to load portfolio ranking: ${error.message}`);
  if (!data) throw Object.assign(new Error("Analysis not found."), { status: 404 });
  const intelligence = (data as Record<string, unknown>).investment_intelligence;
  const ranking = intelligence && typeof intelligence === "object" ? (intelligence as Record<string, unknown>).ranking : null;
  if (!Array.isArray(ranking) || ranking.length === 0) {
    throw Object.assign(new Error("Calculate Full Portfolio Value before starting tiered intelligence."), { status: 409 });
  }
  return ranking as RankingEntry[];
}

async function refreshSummary(supabase: SupabaseClient, userId: string, run: TierRun) {
  const { data: items, error } = await supabase
    .from("portfolio_intelligence_items")
    .select("repo, initial_rank, target_depth, status, refined_score, confidence, result, error")
    .eq("run_id", run.id)
    .eq("user_id", userId)
    .order("initial_rank", { ascending: true });
  if (error) throw new Error(`Failed to summarize tiered intelligence: ${error.message}`);
  const rows = (items ?? []) as Array<Record<string, unknown>>;
  const completed = rows.filter((row) => row.status === "complete");
  const failed = rows.filter((row) => row.status === "failed");
  const queued = rows.filter((row) => row.status === "queued" || row.status === "running");
  if (queued.length > 0) {
    await supabase.from("portfolio_intelligence_runs").update({
      status: "running",
      completed_count: completed.length,
      failed_count: failed.length,
      progress_message: `Deepened ${completed.length + failed.length}/${rows.length} selected candidates; Tier 1 still covers all ${run.total_repos} repositories.`,
      updated_at: new Date().toISOString(),
    }).eq("id", run.id).eq("user_id", userId);
    return false;
  }

  const refined = completed
    .map((row) => ({
      repo: String(row.repo),
      initialRank: Number(row.initial_rank),
      depth: String(row.target_depth),
      refinedScore: Number(row.refined_score),
      confidence: Number(row.confidence),
      result: row.result,
    }))
    .sort((a, b) => b.refinedScore - a.refinedScore || a.initialRank - b.initialRank);
  const councilCompleted = refined.filter((row) => row.depth === "council").length;
  const deepCompleted = refined.length;
  const avgConfidence = refined.length ? Math.round(refined.reduce((sum, row) => sum + row.confidence, 0) / refined.length) : 0;
  const status: TierRun["status"] = failed.length === 0 ? "complete" : completed.length > 0 ? "partial_failed" : "failed";
  const now = new Date().toISOString();
  const summary = {
    methodologyVersion: METHOD_VERSION,
    generatedAt: now,
    analysisId: run.analysis_id,
    tier1: {
      depth: "structural_full_portfolio",
      repositories: run.total_repos,
      coveragePct: 100,
    },
    tier2: {
      depth: "deep_source",
      requested: run.deep_limit,
      completed: deepCompleted,
      coveragePct: run.total_repos > 0 ? Math.round((deepCompleted / run.total_repos) * 1000) / 10 : 0,
    },
    tier3: {
      depth: "council",
      requested: run.council_limit,
      completed: councilCompleted,
      coveragePct: run.total_repos > 0 ? Math.round((councilCompleted / run.total_repos) * 1000) / 10 : 0,
    },
    averageDeepConfidence: avgConfidence,
    failedCandidates: failed.map((row) => ({ repo: row.repo, error: row.error })),
    topRefined: refined.slice(0, 20),
    costPolicy: "Tier 1 covers the full portfolio deterministically. AI source reasoning is reserved for the highest-ranked candidates, and council-depth reasoning is reserved for the smallest top cohort.",
  };
  await Promise.all([
    supabase.from("portfolio_intelligence_runs").update({
      status,
      completed_count: completed.length,
      failed_count: failed.length,
      progress_message: status === "complete" ? "Tiered intelligence complete." : "Tiered intelligence complete with partial failures.",
      summary,
      completed_at: now,
      updated_at: now,
    }).eq("id", run.id).eq("user_id", userId),
    supabase.from("analyses").update({ tiered_intelligence: summary, tiered_intelligence_updated_at: now }).eq("id", run.analysis_id).eq("user_id", userId),
  ]);
  return true;
}

async function claimLease(supabase: SupabaseClient, userId: string, runId: string) {
  const now = new Date();
  await supabase.from("portfolio_intelligence_runs").update({ worker_token: null, lease_expires_at: null })
    .eq("id", runId).eq("user_id", userId).lt("lease_expires_at", now.toISOString());
  const token = randomUUID();
  const { data, error } = await supabase.from("portfolio_intelligence_runs").update({
    worker_token: token,
    lease_expires_at: new Date(now.getTime() + WORKER_LEASE_MS).toISOString(),
    heartbeat_at: now.toISOString(),
    started_at: now.toISOString(),
    status: "running",
    updated_at: now.toISOString(),
  }).eq("id", runId).eq("user_id", userId).is("worker_token", null).in("status", ["queued", "running"]).select("*").maybeSingle();
  if (error) throw new Error(`Failed to claim tiered intelligence worker: ${error.message}`);
  return data ? { token, run: data as TierRun } : null;
}

async function processRun(supabase: SupabaseClient, userId: string, runId: string) {
  const lease = await claimLease(supabase, userId, runId);
  if (!lease) return;
  const started = Date.now();
  try {
    const github = requireGithubCredential(await loadGithubCredential(supabase, userId));
    const ranking = await baseRanking(supabase, userId, lease.run.analysis_id);
    const baseByRepo = new Map(ranking.map((entry) => [entry.repo, entry]));
    while (Date.now() - started < WORKER_BUDGET_MS) {
      const run = await loadRun(supabase, userId, runId);
      if (run.status === "cancelled") break;
      const { data: queued, error } = await supabase.from("portfolio_intelligence_items").select("*")
        .eq("run_id", runId).eq("user_id", userId).eq("status", "queued").order("initial_rank", { ascending: true }).limit(3);
      if (error) throw new Error(`Failed to load tiered intelligence queue: ${error.message}`);
      const wave = (queued ?? []) as TierItem[];
      if (wave.length === 0) {
        await refreshSummary(supabase, userId, run);
        break;
      }
      await Promise.all(wave.map(async (item) => {
        const startedAt = new Date().toISOString();
        const { data: claimed } = await supabase.from("portfolio_intelligence_items").update({ status: "running", started_at: startedAt, error: null, updated_at: startedAt })
          .eq("id", item.id).eq("user_id", userId).eq("status", "queued").select("id").maybeSingle();
        if (!claimed) return;
        try {
          const base = baseByRepo.get(item.repo);
          if (!base) throw new Error("Repository is no longer present in the base portfolio ranking.");
          const enriched = await analyzeCandidate(supabase, userId, github.token, item, base);
          const now = new Date().toISOString();
          await supabase.from("portfolio_intelligence_items").update({
            status: "complete",
            refined_score: enriched.refinedScore,
            confidence: enriched.confidence,
            source_head_sha: enriched.sourceHeadSha,
            result: enriched.result,
            completed_at: now,
            updated_at: now,
          }).eq("id", item.id).eq("user_id", userId).eq("status", "running");
        } catch (candidateError) {
          const now = new Date().toISOString();
          await supabase.from("portfolio_intelligence_items").update({
            status: "failed",
            error: candidateError instanceof Error ? candidateError.message : String(candidateError),
            completed_at: now,
            updated_at: now,
          }).eq("id", item.id).eq("user_id", userId).eq("status", "running");
        }
      }));
      const heartbeat = new Date().toISOString();
      await supabase.from("portfolio_intelligence_runs").update({
        heartbeat_at: heartbeat,
        lease_expires_at: new Date(Date.now() + WORKER_LEASE_MS).toISOString(),
        updated_at: heartbeat,
      }).eq("id", runId).eq("user_id", userId).eq("worker_token", lease.token);
      await refreshSummary(supabase, userId, await loadRun(supabase, userId, runId));
    }
  } finally {
    await supabase.from("portfolio_intelligence_runs").update({ worker_token: null, lease_expires_at: null, updated_at: new Date().toISOString() })
      .eq("id", runId).eq("user_id", userId).eq("worker_token", lease.token);
  }
}

function kick(supabase: SupabaseClient, userId: string, runId: string) {
  const job = processRun(supabase, userId, runId).catch(() => undefined);
  try { waitUntil(job); } catch { void job; }
}

async function detail(supabase: SupabaseClient, userId: string, runId: string) {
  const run = await loadRun(supabase, userId, runId);
  const { data: items, error } = await supabase.from("portfolio_intelligence_items").select("*")
    .eq("run_id", runId).eq("user_id", userId).order("initial_rank", { ascending: true });
  if (error) throw new Error(`Failed to load tiered intelligence items: ${error.message}`);
  return { run, items: items ?? [] };
}

router.post(
  "/portfolio-intelligence/:analysisId/tiered",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { analysisId } = z.object({ analysisId: z.string().uuid() }).parse(req.params);
    const body = z.object({
      deepLimit: z.number().int().min(1).max(100).default(30),
      councilLimit: z.number().int().min(0).max(25).default(8),
    }).refine((value) => value.councilLimit <= value.deepLimit, { message: "councilLimit cannot exceed deepLimit" }).parse(req.body);
    const ranking = await baseRanking(req.supabase!, req.userId!, analysisId);
    const deepLimit = Math.min(body.deepLimit, ranking.length);
    const councilLimit = Math.min(body.councilLimit, deepLimit);
    const now = new Date().toISOString();
    const { data: runData, error } = await req.supabase!.from("portfolio_intelligence_runs").insert({
      user_id: req.userId!, analysis_id: analysisId, status: "queued", total_repos: ranking.length,
      deep_limit: deepLimit, council_limit: councilLimit, progress_message: `Tier 1 covers all ${ranking.length} repositories; preparing deep analysis for the top ${deepLimit}.`,
      created_at: now, updated_at: now,
    }).select("*").single();
    if (error || !runData) throw new Error(`Failed to create tiered intelligence run: ${error?.message ?? "unknown database error"}`);
    const run = runData as TierRun;
    const rows = ranking.slice(0, deepLimit).map((entry, index) => ({
      run_id: run.id,
      user_id: req.userId!,
      analysis_id: analysisId,
      repo: entry.repo,
      initial_rank: Number(entry.rank || index + 1),
      initial_finish_first_score: Number(entry.finishFirstScore || 0),
      target_depth: index < councilLimit ? "council" : "deep_source",
      status: "queued",
      created_at: now,
      updated_at: now,
    }));
    const { error: itemError } = await req.supabase!.from("portfolio_intelligence_items").insert(rows);
    if (itemError) {
      await req.supabase!.from("portfolio_intelligence_runs").delete().eq("id", run.id).eq("user_id", req.userId!);
      throw new Error(`Failed to create tiered intelligence work items: ${itemError.message}`);
    }
    kick(req.supabase!, req.userId!, run.id);
    res.status(202).json(await detail(req.supabase!, req.userId!, run.id));
  }),
);

router.get(
  "/portfolio-intelligence/tiered-runs/:runId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(req.params);
    const run = await loadRun(req.supabase!, req.userId!, runId);
    if (run.status === "queued" || run.status === "running") kick(req.supabase!, req.userId!, runId);
    res.json(await detail(req.supabase!, req.userId!, runId));
  }),
);

router.get(
  "/portfolio-intelligence/:analysisId/tiered",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { analysisId } = z.object({ analysisId: z.string().uuid() }).parse(req.params);
    const { data: runs, error } = await req.supabase!.from("portfolio_intelligence_runs").select("*")
      .eq("analysis_id", analysisId).eq("user_id", req.userId!).order("created_at", { ascending: false }).limit(5);
    if (error) throw new Error(`Failed to list tiered intelligence runs: ${error.message}`);
    res.json(runs ?? []);
  }),
);

export default router;
