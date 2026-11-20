import { Router, type IRouter } from "express";
import { z } from "zod";
import type { SupabaseClient } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "../lib/async-handler";
import { assertRepoSlug, getRepo, getRepoTree } from "../lib/github";
import { loadAiCredential, loadGithubCredential, toAiProviderConfig } from "../lib/credentials";
import { callAI } from "../lib/ai-provider";
import {
  REPO_BUSINESS_METHODOLOGY_VERSION,
  buildRepoBusinessReport,
  inferSignalsFromMetadata,
  signalsFromPaths,
  type RepoBusinessReport,
  type RepoSignalInput,
} from "../lib/repo-business-engine";
import {
  BUILDER_PROMPT_VERSION,
  buildImprovementSuggestions,
  composeFinalityPrompt,
  type BuilderTarget,
} from "../lib/builder-prompt-composer";

const router: IRouter = Router();

interface SyncedRepoRow {
  full_name: string;
  description: string | null;
  language: string | null;
  topics: string[] | null;
  private: boolean | null;
  fork: boolean | null;
  archived: boolean | null;
  stars: number | null;
  forks: number | null;
  open_issues: number | null;
  watchers: number | null;
  size_kb: number | null;
  default_branch: string | null;
  pushed_at: string | null;
  created_at: string | null;
}

type RankingRow = Record<string, unknown>;

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function moneyRange(value: unknown): { low: number; high: number } | null {
  const range = record(value);
  const low = finite(range.low);
  const high = finite(range.high);
  return low === null || high === null ? null : { low, high };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function rankingFromAnalysis(row: Record<string, unknown> | null): RankingRow[] {
  if (!row) return [];
  const intelligence = record(row.investment_intelligence);
  const ranking = Array.isArray(intelligence.ranking) ? intelligence.ranking : [];
  return ranking
    .filter((entry): entry is RankingRow => Boolean(entry) && typeof entry === "object")
    .map((entry) => entry);
}

export function signalInputFromRanking(row: RankingRow, synced?: SyncedRepoRow): RepoSignalInput {
  const details = record(row.details);
  const github = record(details.github);
  const remaining = record(row.remainingWork);
  const repo = String(row.repo ?? synced?.full_name ?? "");
  const metadataOnly: RepoSignalInput = {
    repo,
    description: synced?.description ?? null,
    language: (typeof details.language === "string" ? details.language : null) ?? synced?.language ?? (typeof github.language === "string" ? github.language : null),
    topics: Array.isArray(github.topics) ? (github.topics as string[]) : synced?.topics ?? null,
    stars: finite(github.stars) ?? synced?.stars ?? null,
    forks: finite(github.forks) ?? synced?.forks ?? null,
    openIssues: synced?.open_issues ?? null,
    watchers: finite(github.subscribers) ?? synced?.watchers ?? null,
    sizeKb: synced?.size_kb ?? null,
    pushedAt: (typeof github.lastPush === "string" ? github.lastPush : null) ?? synced?.pushed_at ?? null,
    createdAt: synced?.created_at ?? null,
    archived: synced?.archived ?? null,
    isFork: synced?.fork ?? null,
    private: synced?.private ?? null,
    completionPct: finite(row.completionPct),
    productionReadinessPct: finite(row.productionReadinessPct),
    marketNeed: finite(row.marketNeed),
    demand: finite(row.demand),
    competitivePressure: finite(row.competitivePressure),
    uniquenessPct: finite(row.uniquenessPct),
    commercializationProbability: finite(row.commercializationProbability),
    evidenceConfidence: finite(row.evidenceConfidence),
    remainingHours: finite(remaining.hours),
    presentValueUsd: moneyRange(row.presentValueUsd),
    potentialValueUsd: moneyRange(row.potentialValueUsd),
    suggestions: Array.isArray(details.suggestions)
      ? (details.suggestions as Array<Record<string, unknown>>).map((suggestion) => ({
          title: typeof suggestion.title === "string" ? suggestion.title : null,
          action: typeof suggestion.action === "string" ? suggestion.action : null,
          why: typeof suggestion.why === "string" ? suggestion.why : null,
          effort: finite(suggestion.effort),
        }))
      : [],
    nextSteps: stringList(details.recommendedNextSteps),
  };

  // Metadata inference is only a fallback. It fills signals a synced repo can
  // honestly hint at (frontend/backend/auth/payments), never test/CI evidence.
  const inferred = inferSignalsFromMetadata(metadataOnly);
  return { ...metadataOnly, ...Object.fromEntries(Object.entries(inferred).filter(([, value]) => value !== undefined)) };
}

async function loadSyncedRepos(supabase: SupabaseClient, userId: string): Promise<Map<string, SyncedRepoRow>> {
  const { data, error } = await supabase
    .from("github_repos")
    .select(
      "full_name, description, language, topics, private, fork, archived, stars, forks, open_issues, watchers, size_kb, default_branch, pushed_at, created_at",
    )
    .eq("user_id", userId);

  // The sync table is additive. A database that has not applied the migration
  // yet must still get a useful report from persisted analysis evidence.
  if (error) return new Map();
  const rows = (data ?? []) as SyncedRepoRow[];
  return new Map(rows.map((row) => [row.full_name.toLowerCase(), row]));
}

async function loadAnalysis(supabase: SupabaseClient, userId: string, analysisId: string) {
  const { data, error } = await supabase
    .from("analyses")
    .select("id, status, repo_count, analyzed_repo_names, investment_intelligence, portfolio_stats, created_at")
    .eq("id", analysisId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw Object.assign(new Error("Analysis not found"), { status: 404 });
  }
  return data as Record<string, unknown>;
}

interface LiveEvidence {
  signals: ReturnType<typeof signalsFromPaths>;
  defaultBranch: string | null;
}

async function loadLiveEvidence(token: string, repo: string): Promise<LiveEvidence | null> {
  try {
    const metadata = await getRepo(token, repo);
    const tree = await getRepoTree(token, repo, metadata.default_branch);
    return {
      signals: signalsFromPaths(tree.map((node) => node.path)),
      defaultBranch: metadata.default_branch,
    };
  } catch {
    // A rate limit or permission gap must not fail the report. The route
    // degrades to stored evidence and labels it as such.
    return null;
  }
}

export function portfolioSummary(reports: RepoBusinessReport[]) {
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const average = (values: number[]) => (values.length ? sum(values) / values.length : 0);
  const stageCounts: Record<string, number> = {};
  const demandBands: Record<string, number> = {};
  for (const report of reports) {
    stageCounts[report.grade.stage] = (stageCounts[report.grade.stage] ?? 0) + 1;
    demandBands[report.demand.band] = (demandBands[report.demand.band] ?? 0) + 1;
  }
  return {
    repos: reports.length,
    averageGrade: Math.round(average(reports.map((report) => report.grade.overall)) * 10) / 10,
    averageDemand: Math.round(average(reports.map((report) => report.demand.index)) * 10) / 10,
    averageFinality: Math.round(average(reports.map((report) => report.finality.score)) * 10) / 10,
    finished: reports.filter((report) => report.finality.isFinished).length,
    presentValueLow: Math.round(sum(reports.map((report) => report.valuation.presentValue.low))),
    presentValueHigh: Math.round(sum(reports.map((report) => report.valuation.presentValue.high))),
    potentialValueLow: Math.round(sum(reports.map((report) => report.valuation.potentialValue.low))),
    potentialValueHigh: Math.round(sum(reports.map((report) => report.valuation.potentialValue.high))),
    valueGap: Math.round(sum(reports.map((report) => report.valuation.valueGap))),
    stageCounts,
    demandBands,
  };
}

function opportunityScore(report: RepoBusinessReport, ranking: RankingRow | undefined): number {
  const finishFirst = finite(ranking?.finishFirstScore);
  if (finishFirst !== null) return Math.round(finishFirst * 10) / 10;
  const hourly = report.valuation.valuePerRemainingHour ?? report.valuation.valueGap / 40;
  const score = Math.min(100, report.grade.overall * 0.25 + report.demand.index * 0.25 + Math.min(50, hourly / 100));
  return Math.round(score * 10) / 10;
}

/**
 * Live tree evidence replaces inferred flags. An inferred "has payments" hint
 * must not survive a tree that proves otherwise, and a tree that proves a
 * capability exists is stronger evidence than metadata.
 */
function mergeLiveEvidence(input: RepoSignalInput, live: LiveEvidence): RepoSignalInput {
  return {
    ...input,
    ...live.signals,
    hasPaymentsSignals: live.signals.hasPaymentsSignals,
    hasAuthSignals: live.signals.hasAuthSignals,
    hasFrontendSignals: live.signals.hasFrontendSignals,
    hasBackendSignals: live.signals.hasBackendSignals,
    hasObservabilitySignals: live.signals.hasObservabilitySignals,
    hasDatabaseMigrations: live.signals.hasDatabaseMigrations,
    hasDeployConfig: live.signals.hasDeployConfig,
    hasTests: live.signals.hasTests,
    hasCi: live.signals.hasCi,
    hasReadme: live.signals.hasReadme,
    hasLicense: live.signals.hasLicense,
    hasDocs: live.signals.hasDocs,
    hasEnvExample: live.signals.hasEnvExample,
    hasContributing: live.signals.hasContributing,
    hasDocker: live.signals.hasDocker,
    fileCount: live.signals.fileCount,
  };
}

router.get(
  "/repo-business/:analysisId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const analysisId = z.string().min(1).parse(req.params.analysisId);
    const supabase = req.supabase!;
    const userId = req.userId!;

    const [analysis, synced] = await Promise.all([loadAnalysis(supabase, userId, analysisId), loadSyncedRepos(supabase, userId)]);
    const ranking = rankingFromAnalysis(analysis);

    if (ranking.length === 0) {
      res.json({
        methodologyVersion: REPO_BUSINESS_METHODOLOGY_VERSION,
        builderPromptVersion: BUILDER_PROMPT_VERSION,
        analysisId,
        generatedAt: new Date().toISOString(),
        portfolio: portfolioSummary([]),
        repos: [],
        message: "Run a portfolio scan first. Business grading needs measured repository evidence.",
      });
      return;
    }

    const rows = ranking.map((row) => {
      const repo = String(row.repo ?? "");
      const syncedRow = synced.get(repo.toLowerCase());
      const report = buildRepoBusinessReport(signalInputFromRanking(row, syncedRow));
      return { report, ranking: row };
    });

    const repos = rows
      .map(({ report, ranking: row }) => ({
        repo: report.repo,
        rank: finite(row.rank),
        opportunityScore: opportunityScore(report, row),
        grade: {
          overall: report.grade.overall,
          letter: report.grade.letter,
          stage: report.grade.stage,
          stageLabel: report.grade.stageLabel,
          evidenceCeiling: report.grade.evidenceCeiling,
          confidence: report.grade.confidence,
        },
        demand: { index: report.demand.index, band: report.demand.band, bandLabel: report.demand.bandLabel },
        valuation: {
          presentValue: report.valuation.presentValue,
          potentialValue: report.valuation.potentialValue,
          valueGap: report.valuation.valueGap,
          valuePerRemainingHour: report.valuation.valuePerRemainingHour,
          remainingHours: report.valuation.remainingHours,
          confidence: report.valuation.confidence,
        },
        finality: { score: report.finality.score, isFinished: report.finality.isFinished, nextBestAction: report.finality.nextBestAction },
        signals: report.signals,
      }))
      .sort((a, b) => b.opportunityScore - a.opportunityScore);

    res.json({
      methodologyVersion: REPO_BUSINESS_METHODOLOGY_VERSION,
      builderPromptVersion: BUILDER_PROMPT_VERSION,
      analysisId,
      generatedAt: new Date().toISOString(),
      portfolio: portfolioSummary(rows.map((entry) => entry.report)),
      repos,
      evidencePolicy:
        "Measured analysis values win. Structural evidence fills gaps and is labeled derived. Unknown evidence is reported as missing and caps the grade — it is never assumed to be passing.",
    });
  }),
);

const detailQuery = z.object({
  repo: z.string().min(3).max(220),
  live: z.enum(["0", "1"]).optional(),
  suggestions: z.coerce.number().int().min(6).max(30).optional(),
});

router.get(
  "/repo-business/:analysisId/detail",
  requireAuth,
  asyncHandler(async (req, res) => {
    const analysisId = z.string().min(1).parse(req.params.analysisId);
    const query = detailQuery.parse(req.query);
    const repo = assertRepoSlug(query.repo);
    const supabase = req.supabase!;
    const userId = req.userId!;

    const [analysis, synced, credential] = await Promise.all([
      loadAnalysis(supabase, userId, analysisId),
      loadSyncedRepos(supabase, userId),
      loadGithubCredential(supabase, userId),
    ]);

    const ranking = rankingFromAnalysis(analysis);
    const row = ranking.find((entry) => String(entry.repo ?? "").toLowerCase() === repo.toLowerCase());
    if (!row && !synced.has(repo.toLowerCase())) {
      throw Object.assign(new Error(`Repository ${repo} is not part of this analysis`), { status: 404 });
    }

    const baseInput = signalInputFromRanking(row ?? { repo }, synced.get(repo.toLowerCase()));

    let liveEvidence: LiveEvidence | null = null;
    if (query.live !== "0" && credential) {
      liveEvidence = await loadLiveEvidence(credential.token, repo);
    }

    const input: RepoSignalInput = liveEvidence ? mergeLiveEvidence(baseInput, liveEvidence) : baseInput;

    const report = buildRepoBusinessReport(input);
    const suggestions = buildImprovementSuggestions({ input, report }, { limit: query.suggestions ?? 18 });
    const composed = composeFinalityPrompt(report, input, suggestions, { target: "provider-neutral", topN: 8 });

    res.json({
      methodologyVersion: REPO_BUSINESS_METHODOLOGY_VERSION,
      builderPromptVersion: BUILDER_PROMPT_VERSION,
      analysisId,
      generatedAt: new Date().toISOString(),
      repo: input.repo,
      evidenceSource: liveEvidence ? "live-github+analysis" : "analysis+metadata",
      report,
      suggestions,
      builderPrompt: {
        prompt: composed.prompt,
        target: composed.target,
        promptVersion: composed.promptVersion,
        quality: composed.quality,
        includedSuggestionIds: composed.includedSuggestionIds,
      },
    });
  }),
);

const promptBody = z.object({
  repo: z.string().min(3).max(220),
  target: z.enum(["provider-neutral", "codex", "claude-code", "gemini-cli"]).optional(),
  topN: z.number().int().min(3).max(12).optional(),
  useAi: z.boolean().optional(),
});

router.post(
  "/repo-business/:analysisId/prompt",
  requireAuth,
  asyncHandler(async (req, res) => {
    const analysisId = z.string().min(1).parse(req.params.analysisId);
    const body = promptBody.parse(req.body);
    const repo = assertRepoSlug(body.repo);
    const supabase = req.supabase!;
    const userId = req.userId!;

    const [analysis, synced, githubCredential] = await Promise.all([
      loadAnalysis(supabase, userId, analysisId),
      loadSyncedRepos(supabase, userId),
      loadGithubCredential(supabase, userId),
    ]);

    const ranking = rankingFromAnalysis(analysis);
    const row = ranking.find((entry) => String(entry.repo ?? "").toLowerCase() === repo.toLowerCase());
    const baseInput = signalInputFromRanking(row ?? { repo }, synced.get(repo.toLowerCase()));

    const liveEvidence = githubCredential ? await loadLiveEvidence(githubCredential.token, repo) : null;
    const input: RepoSignalInput = liveEvidence ? mergeLiveEvidence(baseInput, liveEvidence) : baseInput;

    const report = buildRepoBusinessReport(input);
    const suggestions = buildImprovementSuggestions({ input, report }, { limit: 18 });
    const target = body.target ?? "provider-neutral";
    const composed = composeFinalityPrompt(report, input, suggestions, { target, topN: body.topN ?? 8 });

    if (!body.useAi) {
      res.json({
        prompt: composed.prompt,
        target,
        promptVersion: composed.promptVersion,
        quality: composed.quality,
        source: "deterministic",
        model: null,
      });
      return;
    }

    const credential = await loadAiCredential(supabase, userId);
    if (!credential.apiKey) {
      res.json({
        prompt: composed.prompt,
        target,
        promptVersion: composed.promptVersion,
        quality: composed.quality,
        source: "deterministic",
        model: null,
        note: "No AI credential is configured, so the reviewed deterministic prompt was returned. Add a provider key in Settings for model-tailored wording.",
      });
      return;
    }

    try {
      const refined = await callAI(
        {
          messages: [
            {
              role: "system",
              content:
                "You are a principal engineer who writes execution prompts for autonomous coding agents. You receive a reviewed finality contract. Improve only its clarity, specificity, and repo-grounded detail. Preserve every section, every acceptance criterion, every constraint, and every stop condition. Never remove a verification gate, never soften the Definition of Done, and never invent repository facts that are not in the contract. Return the full prompt as plain markdown, with no preamble.",
            },
            { role: "user", content: composed.prompt },
          ],
          timeoutMs: 60000,
        },
        toAiProviderConfig(credential),
      );
      const refinedPrompt = refined.content?.trim();
      if (!refinedPrompt || refinedPrompt.length < composed.prompt.length * 0.6) {
        throw new Error("Model returned an incomplete prompt");
      }
      const quality = composeFinalityPrompt(report, input, suggestions, { target, topN: body.topN ?? 8 }).quality;
      res.json({
        prompt: refinedPrompt,
        target,
        promptVersion: composed.promptVersion,
        quality,
        source: "ai",
        model: refined.model ?? credential.model,
      });
    } catch (error) {
      res.json({
        prompt: composed.prompt,
        target,
        promptVersion: composed.promptVersion,
        quality: composed.quality,
        source: "deterministic",
        model: null,
        note: `Model refinement was unavailable (${error instanceof Error ? error.message : "unknown error"}). The reviewed deterministic prompt is returned unchanged.`,
      });
    }
  }),
);

export default router;
