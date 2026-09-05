import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  buildRepoIndex,
  classifyRepository,
  estimateCommercializationProbability,
  estimateRemainingWork,
  primaryKind,
  projectPotential,
  rankInvestmentOpportunities,
  scoreCompletion,
  scoreProductionReadiness,
  suggestValueImprovements,
  valueImprovementsToNextSteps,
  valueRepository,
  type AcceptanceEvidence,
  type IntelligenceEvidence,
  type InvestmentOpportunityInput,
  type ScenarioInput,
  type ValueImprovementSuggestion,
} from "@workspace/repo-os";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "../lib/async-handler";
import { callAI } from "../lib/ai-provider";
import { loadAiCredential, loadGithubCredential, requireGithubCredential } from "../lib/credentials";
import { recordRepoLearning } from "../lib/adaptive-learning";

const router: IRouter = Router();
const GH_API = "https://api.github.com";
const METHODOLOGY_VERSION = "investment-intelligence-v2";
/** Cap deep valuation work so large portfolios still finish within API budgets. */
export const INVESTMENT_INTELLIGENCE_REPO_LIMIT = 50;

interface GhRepo {
  full_name: string;
  name: string;
  description: string | null;
  default_branch: string;
  stargazers_count: number;
  forks_count: number;
  subscribers_count: number;
  open_issues_count: number;
  language: string | null;
  topics: string[];
  size: number;
  pushed_at: string;
  created_at: string;
  homepage: string | null;
  archived: boolean;
  fork: boolean;
  license: { name?: string } | null;
}

interface GhTreeEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
  sha?: string;
}

interface CompetitionRepo {
  repo: string;
  stars: number;
  forks: number;
  pushed_at: string;
  description: string | null;
}

interface CompetitionResult {
  query: string;
  totalCount: number;
  competitors: CompetitionRepo[];
}

interface MarketModel {
  market_need_score: number;
  demand_score: number;
  competitive_pressure_score: number;
  confidence: number;
  market_summary: string;
  recommended_next_steps: string[];
  scenarios: ScenarioInput[];
}

interface AnalysisItemContext {
  repo: string;
  kind: string;
  title: string;
  pitch: string;
  marketPotential: number;
  effort: number;
  estimatedHours: number | null;
  nextSteps: string[];
}

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "repo-finisher",
  };
}

async function ghJson<T>(token: string, path: string): Promise<{ data: T; headers: Headers }> {
  const res = await fetch(`${GH_API}${path}`, { headers: ghHeaders(token) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${path} returned ${res.status}: ${text.slice(0, 180)}`);
  }
  return { data: (await res.json()) as T, headers: res.headers };
}

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function ghRaw(token: string, repo: string, path: string, ref: string): Promise<string | null> {
  const res = await fetch(
    `${GH_API}/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
    { headers: { ...ghHeaders(token), Accept: "application/vnd.github.raw" } },
  );
  if (!res.ok) return null;
  const text = await res.text();
  return text.length <= 220_000 ? text : null;
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

async function fetchIndexInputs(token: string, repo: GhRepo, tree: GhTreeEntry[], headSha: string) {
  const selected = tree
    .filter((entry) => entry.type === "blob" && (entry.size ?? 0) <= 220_000)
    .map((entry) => ({ entry, score: priority(entry.path) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path))
    .slice(0, 60)
    .map(({ entry }) => entry);

  const files: Array<{ path: string; content: string }> = [];
  const workers = Math.min(6, selected.length);
  let cursor = 0;
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

function parseLastPage(link: string | null): number | null {
  if (!link) return null;
  const match = link.match(/[?&]page=(\d+)>; rel="last"/);
  return match ? Number(match[1]) : null;
}

async function fetchCommitCount(token: string, repo: string): Promise<number> {
  try {
    const { data, headers } = await ghJson<unknown[]>(token, `/repos/${repo}/commits?per_page=1`);
    return parseLastPage(headers.get("link")) ?? data.length;
  } catch {
    return 0;
  }
}

async function fetchAcceptanceEvidence(token: string, repo: string, headSha: string): Promise<AcceptanceEvidence> {
  try {
    const { data } = await ghJson<{ check_runs?: Array<{ name: string; status: string; conclusion: string | null }> }>(
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

function searchTerms(repo: GhRepo): string[] {
  const topics = (repo.topics ?? []).filter((topic) => /^[a-z0-9-]{2,40}$/i.test(topic)).slice(0, 2);
  if (topics.length > 0) return topics.map((topic) => `topic:${topic}`);
  const words = `${repo.name} ${repo.description || ""}`
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, " ")
    .split(/\s+/)
    .filter(
      (word) =>
        word.length >= 4 &&
        !["with", "from", "that", "this", "your", "repo", "application"].includes(word),
    );
  return [...new Set(words)].slice(0, 3);
}

async function fetchCompetition(token: string, repo: GhRepo): Promise<CompetitionResult> {
  const terms = searchTerms(repo);
  if (terms.length === 0) return { query: "", totalCount: 0, competitors: [] };

  const query = `${terms.join(" ")}${repo.language ? ` language:${repo.language}` : ""}`;
  try {
    const { data } = await ghJson<{
      total_count: number;
      items: Array<{
        full_name: string;
        description: string | null;
        stargazers_count: number;
        forks_count: number;
        pushed_at: string;
      }>;
    }>(token, `/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=10`);

    const competitors: CompetitionRepo[] = data.items
      .filter((item) => item.full_name !== repo.full_name)
      .slice(0, 8)
      .map((item) => ({
        repo: item.full_name,
        stars: item.stargazers_count,
        forks: item.forks_count,
        pushed_at: item.pushed_at,
        description: item.description,
      }));

    return { query, totalCount: data.total_count, competitors };
  } catch {
    return { query, totalCount: 0, competitors: [] };
  }
}

function fallbackMarketModel(
  repo: GhRepo,
  context: AnalysisItemContext | null,
  competition: CompetitionResult,
): MarketModel {
  const descriptionQuality = Math.min(
    18,
    Math.round(((repo.description?.trim().length ?? 0) / 20) * 3),
  );
  const topicBoost = Math.min(12, (repo.topics?.length ?? 0) * 3);
  const homepageBoost = repo.homepage ? 10 : 0;
  const licenseBoost = repo.license ? 4 : 0;
  const activityBoost = Math.round(activityScore(repo.pushed_at) * 0.15);
  const analysisNeed = context?.marketPotential ? context.marketPotential * 16 : 40;
  const marketNeed = Math.max(
    20,
    Math.min(88, analysisNeed * 0.55 + descriptionQuality + topicBoost + homepageBoost + licenseBoost),
  );

  const demand = Math.max(
    22,
    Math.min(
      88,
      28 +
        Math.log10(repo.stargazers_count + repo.forks_count + 2) * 11 +
        Math.log10(repo.subscribers_count + 1) * 6 +
        activityBoost +
        (repo.homepage ? 6 : 0),
    ),
  );

  const topStars = competition.competitors.reduce((max, item) => Math.max(max, item.stars), 0);
  const pressure = Math.max(
    18,
    Math.min(
      92,
      22 +
        Math.log10(competition.totalCount + 1) * 10 +
        Math.log10(topStars + 1) * 8 -
        (repo.stargazers_count >= topStars && topStars > 0 ? 8 : 0),
    ),
  );

  const evidenceBits = [
    repo.description ? "description present" : "thin description",
    `${repo.topics?.length ?? 0} topics`,
    repo.homepage ? "homepage set" : "no homepage",
    repo.license ? "license present" : "no license",
    `${competition.competitors.length} GitHub competitors sampled`,
  ];

  const confidence = Math.round(
    Math.min(
      62,
      22 +
        (competition.competitors.length > 0 ? 14 : 0) +
        (repo.homepage ? 8 : 0) +
        (repo.topics?.length ? 6 : 0) +
        (repo.description && repo.description.length > 40 ? 6 : 0) +
        (context?.marketPotential ? 4 : 0),
    ),
  );

  const baseCustomers = Math.max(15, Math.round(20 + Math.log10(repo.stargazers_count + 2) * 40));
  const baseArpu = repo.homepage || (repo.topics?.length ?? 0) >= 2 ? 29 : 19;

  return {
    market_need_score: Math.round(marketNeed),
    demand_score: Math.round(demand),
    competitive_pressure_score: Math.round(pressure),
    confidence,
    market_summary:
      `Heuristic market proxy from repository signals (${evidenceBits.join("; ")}). ` +
      "Broader customer demand, TAM, and commercial competitors are not independently verified.",
    recommended_next_steps: context?.nextSteps?.slice(0, 10) ?? [],
    scenarios: [
      {
        name: "conservative",
        customers: Math.round(baseCustomers * 0.25),
        arpuMonthlyUsd: Math.max(12, baseArpu - 8),
        grossMarginPct: 75,
        probability: 0.55,
        assumptions: ["Planning assumption; no customer evidence supplied"],
      },
      {
        name: "base",
        customers: baseCustomers,
        arpuMonthlyUsd: baseArpu,
        grossMarginPct: 80,
        probability: 0.3,
        assumptions: ["Planning assumption; requires launch and distribution"],
      },
      {
        name: "strong-execution",
        customers: Math.round(baseCustomers * 4),
        arpuMonthlyUsd: baseArpu + 10,
        grossMarginPct: 82,
        probability: 0.15,
        assumptions: ["Upside scenario, not a forecast"],
      },
    ],
  };
}

async function generateMarketModel(
  repo: GhRepo,
  context: AnalysisItemContext | null,
  competition: CompetitionResult,
  ai: { provider: string; apiKey: string | null },
): Promise<MarketModel> {
  const fallback = fallbackMarketModel(repo, context, competition);
  if (!ai.apiKey) return fallback;

  const system = `You are the market-intelligence agent in a repository investment system.
Estimate market NEED, DEMAND, and COMPETITIVE PRESSURE only from the evidence provided. These are planning estimates, not facts.
Do not invent revenue, customers, acquisitions, TAM figures, or named competitors that are not in the evidence.
When evidence is thin, lower confidence rather than pretending certainty.
Create three commercialization scenarios named conservative, base, and strong-execution. Customer counts and ARPU are explicit planning assumptions, not observed traction.
Return strict JSON only.`;

  const user = JSON.stringify({
    repository: {
      name: repo.full_name,
      description: repo.description,
      language: repo.language,
      topics: repo.topics,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      subscribers: repo.subscribers_count,
      open_issues: repo.open_issues_count,
      homepage: repo.homepage,
    },
    analysis_context: context,
    github_market_proxy: competition,
  });

  try {
    const result = await callAI(
      {
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: "market_intelligence",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                market_need_score: { type: "integer", minimum: 0, maximum: 100 },
                demand_score: { type: "integer", minimum: 0, maximum: 100 },
                competitive_pressure_score: { type: "integer", minimum: 0, maximum: 100 },
                confidence: { type: "integer", minimum: 0, maximum: 100 },
                market_summary: { type: "string" },
                recommended_next_steps: {
                  type: "array",
                  maxItems: 10,
                  items: { type: "string" },
                },
                scenarios: {
                  type: "array",
                  minItems: 3,
                  maxItems: 3,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      name: {
                        type: "string",
                        enum: ["conservative", "base", "strong-execution"],
                      },
                      customers: { type: "integer", minimum: 0 },
                      arpuMonthlyUsd: { type: "number", minimum: 0 },
                      grossMarginPct: { type: "number", minimum: 0, maximum: 100 },
                      probability: { type: "number", minimum: 0, maximum: 1 },
                      assumptions: { type: "array", items: { type: "string" } },
                    },
                    required: [
                      "name",
                      "customers",
                      "arpuMonthlyUsd",
                      "grossMarginPct",
                      "probability",
                      "assumptions",
                    ],
                  },
                },
              },
              required: [
                "market_need_score",
                "demand_score",
                "competitive_pressure_score",
                "confidence",
                "market_summary",
                "recommended_next_steps",
                "scenarios",
              ],
            },
          },
        },
      },
      ai,
    );
    return JSON.parse(result.content || "{}") as MarketModel;
  } catch {
    return fallback;
  }
}

function contextByRepo(items: Array<Record<string, unknown>>): Map<string, AnalysisItemContext> {
  const map = new Map<string, AnalysisItemContext>();
  for (const item of items) {
    const repos = Array.isArray(item.repos) ? item.repos.map(String) : [];
    for (const repo of repos) {
      if (map.has(repo)) continue;
      map.set(repo, {
        repo,
        kind: String(item.kind || "finish"),
        title: String(item.title || ""),
        pitch: String(item.pitch || ""),
        marketPotential: Number(item.market_potential || 0),
        effort: Number(item.effort || 0),
        estimatedHours: item.estimated_hours == null ? null : Number(item.estimated_hours),
        nextSteps: Array.isArray(item.next_steps) ? item.next_steps.map(String) : [],
      });
    }
  }
  return map;
}

async function inspectOneRepo(
  token: string,
  repoName: string,
  context: AnalysisItemContext | null,
  ai: { provider: string; apiKey: string | null },
) {
  const { data: repo } = await ghJson<GhRepo>(token, `/repos/${repoName}`);
  const defaultBranch = repo.default_branch || "main";
  const { data: branch } = await ghJson<{ commit: { sha: string } }>(
    token,
    `/repos/${repoName}/branches/${encodeURIComponent(defaultBranch)}`,
  );
  const headSha = branch.commit.sha;

  const [{ data: treeResult }, commitCount, acceptance, competition] = await Promise.all([
    ghJson<{ tree: GhTreeEntry[]; truncated?: boolean }>(
      token,
      `/repos/${repoName}/git/trees/${headSha}?recursive=1`,
    ),
    fetchCommitCount(token, repoName),
    fetchAcceptanceEvidence(token, repoName, headSha),
    fetchCompetition(token, repo),
  ]);

  const tree = treeResult.tree ?? [];
  const fetchedFiles = await fetchIndexInputs(token, repo, tree, headSha);
  const index = buildRepoIndex({ repo: repoName, defaultBranch, tree, files: fetchedFiles });
  const classifications = classifyRepository(index);
  const kind = primaryKind(classifications);
  const completion = scoreCompletion(index, kind, acceptance);
  const readiness = scoreProductionReadiness(index, acceptance);
  const market = await generateMarketModel(repo, context, competition, ai);

  const sourceFiles = index.files.filter((file) => file.role === "source");
  const sourceBytes = sourceFiles.reduce((sum, file) => sum + file.size, 0);
  const criticalGaps = completion.missingBreakdown.filter((gap) => gap.lostPoints >= 3).length;
  const remainingWork = estimateRemainingWork({
    completionPct: completion.overall,
    sourceFiles: sourceFiles.length,
    sourceBytes,
    missingCriticalDimensions: criticalGaps,
  });

  const estimatedTotalBuildHours = Math.max(
    context?.estimatedHours || 0,
    40,
    sourceFiles.length * 1.8 + sourceBytes / 10_000,
  );
  const current = valueRepository({
    replacement: {
      estimatedHours: estimatedTotalBuildHours,
      completionPct: completion.overall,
      marketPotential: Math.max(
        1,
        Math.min(5, (market.market_need_score + market.demand_score) / 40),
      ),
      stars: repo.stargazers_count,
      hasRevenueSignals: false,
    },
    traction: {
      githubStars: repo.stargazers_count,
      sources: [
        {
          claim: "GitHub stars",
          url: `https://github.com/${repoName}`,
          retrievedAt: new Date().toISOString(),
        },
      ],
    },
  });

  const potential = projectPotential(
    market.scenarios,
    market.confidence >= 70 ? "medium" : "low",
  );
  const potentialLows = potential.scenarios.map((scenario) => scenario.valuationRange.low);
  const potentialHighs = potential.scenarios.map((scenario) => scenario.valuationRange.high);
  const potentialRange = {
    low: Math.max(current.range.low, Math.min(...potentialLows)),
    high: Math.max(current.range.high, Math.max(...potentialHighs)),
  };

  const activity = activityScore(repo.pushed_at);
  const traction = tractionScore(repo);
  const commercializationProbability = estimateCommercializationProbability({
    completionPct: completion.overall,
    productionReadinessPct: readiness.overall,
    marketNeed: market.market_need_score,
    demand: market.demand_score,
    competitivePressure: market.competitive_pressure_score,
    tractionScore: traction,
    activityScore: activity,
  });

  const analyzedCoverage =
    index.totalFileCount === 0
      ? 0
      : Math.min(1, index.analyzedFileCount / Math.min(60, index.totalFileCount));
  const evidenceConfidence = Math.round(
    Math.min(
      100,
      25 +
        analyzedCoverage * 25 +
        (acceptance.verifiedAt ? 15 : 0) +
        (competition.competitors.length > 0 ? 15 : 0) +
        market.confidence * 0.2,
    ),
  );

  const evidence: IntelligenceEvidence[] = [
    {
      class: "verified",
      label: "GitHub repository telemetry",
      detail: `${repo.stargazers_count} stars, ${repo.forks_count} forks, ${repo.subscribers_count} subscribers, ${commitCount} commits observed via GitHub API.`,
      source: `https://github.com/${repoName}`,
    },
    {
      class: "derived",
      label: "Completion score",
      detail: `${completion.overall}% using deterministic ${kind} scoring with an evidence ceiling of ${completion.evidenceCeiling ?? 100}%.`,
    },
    {
      class: "derived",
      label: "Present value",
      detail: `Replacement/traction model only; no revenue evidence was supplied. Range $${current.range.low.toLocaleString()}-$${current.range.high.toLocaleString()}.`,
    },
    {
      class: "model_estimate",
      label: "Market scores and upside scenarios",
      detail: market.market_summary,
    },
    {
      class: competition.competitors.length > 0 ? "verified" : "insufficient",
      label: "Competitive pressure proxy",
      detail:
        competition.competitors.length > 0
          ? `${competition.totalCount.toLocaleString()} GitHub search matches; ${competition.competitors.length} leading open-source alternatives sampled.`
          : "No reliable GitHub competition sample was available; broader commercial competition is unknown.",
    },
    {
      class: "insufficient",
      label: "Revenue and customer evidence",
      detail:
        "No verified MRR, paying-customer, retention, or active-user evidence was provided, so present value confidence remains conservative.",
    },
  ];

  const valueImprovements: ValueImprovementSuggestion[] = suggestValueImprovements({
    repo: repoName,
    completion,
    readiness,
    analysisNextSteps: context?.nextSteps ?? [],
    maxSuggestions: 24,
  });

  const recommendedNextSteps = [
    ...valueImprovementsToNextSteps(valueImprovements, 16),
    ...market.recommended_next_steps,
    ...(context?.nextSteps ?? []),
  ]
    .filter((step, index, all) => step && all.indexOf(step) === index)
    .slice(0, 20);

  return {
    opportunity: {
      repo: repoName,
      completionPct: completion.overall,
      productionReadinessPct: readiness.overall,
      presentValueUsd: current.range,
      potentialValueUsd: potentialRange,
      marketNeed: market.market_need_score,
      demand: market.demand_score,
      competitivePressure: market.competitive_pressure_score,
      commercializationProbability,
      remainingWork,
      evidenceConfidence,
      evidence,
    } satisfies InvestmentOpportunityInput,
    details: {
      repo: repoName,
      kind,
      classifications,
      completion,
      readiness,
      currentValuation: current,
      potentialValue: potential,
      github: {
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        subscribers: repo.subscribers_count,
        openIssues: repo.open_issues_count,
        commitCount,
        lastPush: repo.pushed_at,
        activityScore: activity,
        tractionScore: traction,
        sourceFiles: sourceFiles.length,
        sourceBytes,
        homepage: repo.homepage,
        topics: repo.topics ?? [],
      },
      market: { ...market, githubCompetition: competition },
      valueImprovements,
      recommendedNextSteps,
      autonomousAgentPlan: [
        {
          role: "architect",
          objective:
            "Turn the highest-value verified gaps into the smallest safe implementation plan.",
        },
        {
          role: "implementation",
          objective:
            "Write complete production code for the approved plan while preserving working behavior.",
        },
        {
          role: "test",
          objective: "Add or strengthen tests around changed behavior and edge cases.",
        },
        {
          role: "security-review",
          objective:
            "Challenge auth, secret handling, injection, permissions, and dependency risks before execution.",
        },
        {
          role: "release",
          objective:
            "Verify CI, deployment health, smoke tests, and measurable completion-score improvement.",
        },
      ],
    },
  };
}

export async function generateAndPersistInvestmentIntelligence(input: {
  supabase: SupabaseClient;
  userId: string;
  analysisId: string;
  githubToken: string;
  ai: { provider: string; apiKey: string | null };
  /** Soft cap — excess repos are skipped after rank order, not hard-failed. */
  repoLimit?: number;
}): Promise<Record<string, unknown>> {
  const {
    supabase,
    userId,
    analysisId,
    githubToken,
    ai,
    repoLimit = INVESTMENT_INTELLIGENCE_REPO_LIMIT,
  } = input;

  const { data: analysis, error: analysisError } = await supabase
    .from("analyses")
    .select("id")
    .eq("id", analysisId)
    .eq("user_id", userId)
    .maybeSingle();
  if (analysisError) throw new Error(`Failed to load analysis: ${analysisError.message}`);
  if (!analysis) throw Object.assign(new Error("Analysis not found"), { status: 404 });

  const { data: items, error: itemsError } = await supabase
    .from("analysis_items")
    .select("*")
    .eq("analysis_id", analysisId)
    .order("rank", { ascending: true });
  if (itemsError) throw new Error(`Failed to load analysis items: ${itemsError.message}`);

  const itemRows = (items ?? []) as Array<Record<string, unknown>>;
  const contexts = contextByRepo(itemRows);
  const allRepos = [...contexts.keys()];
  if (allRepos.length === 0) {
    throw Object.assign(new Error("No repositories were found in this analysis."), { status: 400 });
  }

  const repos = allRepos.slice(0, Math.max(1, repoLimit));
  const skipped = allRepos.length - repos.length;

  const inspected: Awaited<ReturnType<typeof inspectOneRepo>>[] = [];
  const errors: string[] = [];
  if (skipped > 0) {
    errors.push(
      `Scored the top ${repos.length} ranked repositories; ${skipped} additional repositories were deferred to keep valuation within budget.`,
    );
  }

  let cursor = 0;
  const concurrency = Math.min(3, repos.length);
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (cursor < repos.length) {
        const repo = repos[cursor++];
        try {
          inspected.push(await inspectOneRepo(githubToken, repo, contexts.get(repo) ?? null, ai));
        } catch (error) {
          errors.push(`${repo}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }),
  );

  if (inspected.length === 0) {
    throw new Error(`Investment intelligence failed for every repository: ${errors.join("; ")}`);
  }

  const ranked = rankInvestmentOpportunities(inspected.map((entry) => entry.opportunity));
  const detailByRepo = new Map(inspected.map((entry) => [entry.details.repo, entry.details]));
  const ranking = ranked.map((entry) => ({
    ...entry,
    details: detailByRepo.get(entry.repo),
  }));
  const generatedAt = new Date().toISOString();
  const totalValueImprovements = ranking.reduce((sum, item) => {
    const details = item.details as { valueImprovements?: unknown[] } | undefined;
    return sum + (Array.isArray(details?.valueImprovements) ? details.valueImprovements.length : 0);
  }, 0);

  const result = {
    methodologyVersion: METHODOLOGY_VERSION,
    generatedAt,
    analysisId,
    ranking,
    errors,
    portfolio: {
      reposScored: ranking.length,
      reposInAnalysis: allRepos.length,
      reposDeferred: skipped,
      valueImprovementsGenerated: totalValueImprovements,
      presentValueLow: ranking.reduce((sum, item) => sum + item.presentValueUsd.low, 0),
      presentValueHigh: ranking.reduce((sum, item) => sum + item.presentValueUsd.high, 0),
      potentialValueLow: ranking.reduce((sum, item) => sum + item.potentialValueUsd.low, 0),
      potentialValueHigh: ranking.reduce((sum, item) => sum + item.potentialValueUsd.high, 0),
      weightedCommercializationProbability: Math.round(
        ranking.reduce((sum, item) => sum + item.commercializationProbability, 0) / ranking.length,
      ),
    },
    recommendation: ranking[0]
      ? `Finish ${ranking[0].repo} first. Its ${ranking[0].finishFirstScore}/100 finish-first score is the strongest risk-adjusted value-unlock opportunity in this analysis.`
      : "No ranked recommendation is available.",
    evidencePolicy:
      "Every claim is classified as verified evidence, derived metric, model estimate, or insufficient evidence. Model estimates are never presented as observed facts. Dollar figures without revenue evidence are replacement-cost / scenario planning ranges, not appraisals.",
  };

  const { error: saveError } = await supabase
    .from("analyses")
    .update({
      investment_intelligence: result,
      investment_intelligence_updated_at: generatedAt,
    })
    .eq("id", analysisId)
    .eq("user_id", userId);
  if (saveError) {
    if (saveError.code === "42703" || /investment_intelligence/i.test(saveError.message)) {
      throw Object.assign(
        new Error(
          "Investment intelligence schema is not applied yet. Run the repository migration first.",
        ),
        { status: 503 },
      );
    }
    throw new Error(`Failed to save investment intelligence: ${saveError.message}`);
  }

  await Promise.all(
    ranking.map((item) =>
      recordRepoLearning(supabase, userId, item.repo, {
        action: "investment_intelligence",
        outcome: "observation",
        duration_ms: 0,
        details: `Rank #${item.rank}; finish-first ${item.finishFirstScore}/100; completion ${item.completionPct}%; commercialization ${item.commercializationProbability}%.`,
        files_affected: [],
        fix_pattern: "investment-intelligence",
        prompt_version: METHODOLOGY_VERSION,
        metadata: {
          rank: item.rank,
          finishFirstScore: item.finishFirstScore,
          evidenceConfidence: item.evidenceConfidence,
          valueImprovementCount: Array.isArray(
            (item.details as { valueImprovements?: unknown[] } | undefined)?.valueImprovements,
          )
            ? (item.details as { valueImprovements: unknown[] }).valueImprovements.length
            : 0,
        },
        timestamp: generatedAt,
      }),
    ),
  );

  return result;
}

router.post(
  "/investment-intelligence/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const userId = req.userId!;
    const github = requireGithubCredential(await loadGithubCredential(req.supabase!, userId));
    const aiCredential = await loadAiCredential(req.supabase!, userId, github.token);
    const result = await generateAndPersistInvestmentIntelligence({
      supabase: req.supabase!,
      userId,
      analysisId: id,
      githubToken: github.token,
      ai: { provider: aiCredential.provider, apiKey: aiCredential.apiKey },
    });
    res.json(result);
  }),
);

router.get(
  "/investment-intelligence/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { data, error } = await req.supabase!
      .from("analyses")
      .select("investment_intelligence, investment_intelligence_updated_at")
      .eq("id", id)
      .eq("user_id", req.userId!)
      .maybeSingle();
    if (error) {
      if (error.code === "42703" || /investment_intelligence/i.test(error.message)) {
        throw Object.assign(
          new Error("Investment intelligence schema is not applied yet."),
          { status: 503 },
        );
      }
      throw new Error(`Failed to load investment intelligence: ${error.message}`);
    }
    if (!data) throw Object.assign(new Error("Analysis not found"), { status: 404 });
    res.json((data as Record<string, unknown>).investment_intelligence ?? null);
  }),
);

export default router;
