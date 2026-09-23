import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  estimateCommercializationProbability,
  estimateRemainingWork,
  projectPotential,
  rankInvestmentOpportunities,
  valueRepository,
  type IntelligenceEvidence,
  type InvestmentOpportunityInput,
  type ScenarioInput,
} from "@workspace/repo-os";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "../lib/async-handler";
import { loadGithubCredential, requireGithubCredential } from "../lib/credentials";
import { recordRepoLearning } from "../lib/adaptive-learning";

const router: IRouter = Router();
const GH_API = "https://api.github.com";
const METHODOLOGY_VERSION = "portfolio-intelligence-v2-full-coverage";
const MAX_PORTFOLIO_REPOS = 500;
const REQUEST_TIMEOUT_MS = 15_000;

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
  topics?: string[];
  size: number;
  pushed_at: string;
  archived: boolean;
  fork: boolean;
  homepage?: string | null;
  license?: { name?: string } | null;
}

interface GhTreeEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
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

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

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
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${GH_API}${path}`, {
      headers: ghHeaders(token),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub ${path} returned ${res.status}: ${text.slice(0, 180)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function contextsByRepo(items: Array<Record<string, unknown>>) {
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

function activityScore(pushedAt: string) {
  const days = Math.max(0, (Date.now() - new Date(pushedAt).getTime()) / 86_400_000);
  if (days <= 7) return 100;
  if (days <= 30) return 90;
  if (days <= 90) return 75;
  if (days <= 180) return 58;
  if (days <= 365) return 40;
  if (days <= 730) return 22;
  return 10;
}

function tractionScore(repo: GhRepo) {
  const stars = Math.log10(repo.stargazers_count + 1) * 24;
  const forks = Math.log10(repo.forks_count + 1) * 16;
  const subscribers = Math.log10(repo.subscribers_count + 1) * 18;
  return Math.round(clamp(stars + forks + subscribers));
}

function hasAny(paths: string[], patterns: RegExp[]) {
  return patterns.some((pattern) => paths.some((path) => pattern.test(path)));
}

function sourceStats(tree: GhTreeEntry[]) {
  const sourcePattern = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|swift|vue|svelte|cs|cpp|c|h)$/i;
  const source = tree.filter((entry) => entry.type === "blob" && sourcePattern.test(entry.path));
  return {
    files: source.length,
    bytes: source.reduce((sum, entry) => sum + (entry.size ?? 0), 0),
  };
}

function structuralScores(repo: GhRepo, tree: GhTreeEntry[], context: AnalysisItemContext | null) {
  const paths = tree.filter((entry) => entry.type === "blob").map((entry) => entry.path.toLowerCase());
  const source = sourceStats(tree);
  const hasSource = source.files > 0;
  const hasManifest = hasAny(paths, [/(^|\/)package\.json$/, /(^|\/)pyproject\.toml$/, /(^|\/)requirements\.txt$/, /(^|\/)cargo\.toml$/, /(^|\/)go\.mod$/]);
  const hasReadme = hasAny(paths, [/(^|\/)readme(\.|$)/]);
  const hasTests = hasAny(paths, [/(^|\/)(__tests__|tests?|specs?)(\/|\.)/, /\.(test|spec)\.[a-z0-9]+$/]);
  const hasCi = hasAny(paths, [/^\.github\/workflows\//, /(^|\/)gitlab-ci\.yml$/, /(^|\/)circleci\//]);
  const hasDeploy = hasAny(paths, [/(^|\/)vercel\.json$/, /(^|\/)render\.ya?ml$/, /(^|\/)firebase\.json$/, /(^|\/)cloudbuild\.ya?ml$/, /(^|\/)dockerfile$/, /(^|\/)docker-compose\.ya?ml$/]);
  const hasEnvExample = hasAny(paths, [/(^|\/)\.env\.example$/, /(^|\/)\.env\.sample$/]);
  const hasLicense = hasAny(paths, [/(^|\/)license(\.|$)/]);
  const hasDocs = hasAny(paths, [/(^|\/)docs\//, /(^|\/)documentation\//]);
  const active = activityScore(repo.pushed_at);

  let completion = 0;
  completion += hasSource ? 20 : 0;
  completion += hasManifest ? 12 : 0;
  completion += hasReadme ? 10 : 0;
  completion += hasTests ? 14 : 0;
  completion += hasCi ? 14 : 0;
  completion += hasDeploy ? 12 : 0;
  completion += hasEnvExample ? 5 : 0;
  completion += hasLicense ? 4 : 0;
  completion += hasDocs ? 4 : 0;
  completion += Math.round(active * 0.05);
  if (context) completion += Math.max(0, 5 - Math.max(0, context.effort - 1));

  let readiness = 0;
  readiness += hasSource ? 18 : 0;
  readiness += hasManifest ? 10 : 0;
  readiness += hasTests ? 18 : 0;
  readiness += hasCi ? 18 : 0;
  readiness += hasDeploy ? 16 : 0;
  readiness += hasEnvExample ? 8 : 0;
  readiness += hasLicense ? 4 : 0;
  readiness += Math.round(active * 0.08);

  return {
    completion: Math.round(clamp(completion)),
    readiness: Math.round(clamp(readiness)),
    source,
    signals: { hasSource, hasManifest, hasReadme, hasTests, hasCi, hasDeploy, hasEnvExample, hasLicense, hasDocs },
  };
}

function marketModel(repo: GhRepo, context: AnalysisItemContext | null) {
  const activity = activityScore(repo.pushed_at);
  const traction = tractionScore(repo);
  const marketNeed = Math.round(clamp(context?.marketPotential ? context.marketPotential * 20 : 45 + traction * 0.22));
  const demand = Math.round(clamp(28 + traction * 0.48 + activity * 0.18));
  const competitivePressure = 50;
  const baseCustomers = Math.max(20, Math.round((marketNeed + demand) * 1.15));
  const scenarios: ScenarioInput[] = [
    {
      name: "conservative",
      customers: Math.max(10, Math.round(baseCustomers * 0.35)),
      arpuMonthlyUsd: 15,
      grossMarginPct: 72,
      probability: 0.55,
      assumptions: ["Planning estimate based on repository evidence; no verified customer data supplied"],
    },
    {
      name: "base",
      customers: baseCustomers,
      arpuMonthlyUsd: 25,
      grossMarginPct: 78,
      probability: 0.3,
      assumptions: ["Planning estimate that assumes a usable launch and active distribution"],
    },
    {
      name: "strong-execution",
      customers: Math.max(baseCustomers + 1, Math.round(baseCustomers * 3.5)),
      arpuMonthlyUsd: 35,
      grossMarginPct: 82,
      probability: 0.15,
      assumptions: ["Upside scenario only; not observed traction or a forecast"],
    },
  ];
  return { marketNeed, demand, competitivePressure, scenarios, activity, traction };
}

function missingSteps(signals: ReturnType<typeof structuralScores>["signals"]) {
  const steps: string[] = [];
  if (!signals.hasTests) steps.push("Add automated tests around the repository's critical user flows and failure paths.");
  if (!signals.hasCi) steps.push("Add CI that enforces build, typecheck/lint, and tests on every pull request.");
  if (!signals.hasDeploy) steps.push("Add a production deployment target plus a post-deploy smoke check.");
  if (!signals.hasEnvExample) steps.push("Document required runtime configuration in a safe .env.example or equivalent.");
  if (!signals.hasReadme) steps.push("Add a concise README with setup, architecture, deployment, and verification instructions.");
  return steps;
}

function isGithubRateLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /API rate limit exceeded|rate limit/i.test(message);
}

function inspectRepoFromAnalysisContext(repoName: string, context: AnalysisItemContext | null, reason: string) {
  const effort = Math.max(1, Math.min(5, context?.effort || 3));
  const nextStepCount = context?.nextSteps?.length ?? 0;
  const completion = Math.round(clamp(84 - (effort - 1) * 9 - Math.min(10, nextStepCount) * 1.2, 24, 84));
  const readiness = Math.round(clamp(completion - 14, 12, 76));
  const estimatedTotalHours = Math.max(
    context?.estimatedHours || 0,
    40,
    effort * 42 + nextStepCount * 6,
  );

  const marketNeed = Math.round(clamp(context?.marketPotential ? context.marketPotential * 20 : 48));
  const demand = Math.round(clamp(28 + marketNeed * 0.42));
  const competitivePressure = 52;
  const scenarios: ScenarioInput[] = [
    {
      name: "conservative",
      customers: Math.max(8, Math.round(marketNeed * 0.35)),
      arpuMonthlyUsd: 12,
      grossMarginPct: 70,
      probability: 0.55,
      assumptions: ["Analysis-derived planning scenario; fresh GitHub telemetry unavailable"],
    },
    {
      name: "base",
      customers: Math.max(18, Math.round(marketNeed * 0.9)),
      arpuMonthlyUsd: 22,
      grossMarginPct: 78,
      probability: 0.3,
      assumptions: ["Analysis-derived planning scenario; requires launch and distribution"],
    },
    {
      name: "strong-execution",
      customers: Math.max(35, Math.round(marketNeed * 2.5)),
      arpuMonthlyUsd: 32,
      grossMarginPct: 82,
      probability: 0.15,
      assumptions: ["Upside planning scenario only; not observed traction"],
    },
  ];

  const present = valueRepository({
    replacement: {
      estimatedHours: estimatedTotalHours,
      completionPct: completion,
      marketPotential: Math.max(1, Math.min(5, marketNeed / 20)),
      stars: 0,
      hasRevenueSignals: false,
    },
  });
  const potential = projectPotential(scenarios, "low");
  const potentialLow = Math.max(
    present.range.low,
    Math.min(...potential.scenarios.map((scenario) => scenario.valuationRange.low)),
  );
  const potentialHigh = Math.max(
    present.range.high,
    Math.max(...potential.scenarios.map((scenario) => scenario.valuationRange.high)),
  );

  const remainingWork = estimateRemainingWork({
    completionPct: completion,
    sourceFiles: 0,
    sourceBytes: 0,
    missingCriticalDimensions: 3,
  });
  const commercializationProbability = estimateCommercializationProbability({
    completionPct: completion,
    productionReadinessPct: readiness,
    marketNeed,
    demand,
    competitivePressure,
    tractionScore: 5,
    activityScore: 10,
  });
  const evidenceConfidence = context ? 34 : 22;

  const evidence: IntelligenceEvidence[] = [
    {
      class: context ? "derived" : "insufficient",
      label: "Completed analysis evidence",
      detail: context
        ? "Valuation fallback uses the repository's persisted RepoFinisher analysis recommendation, effort, market-potential, estimated-hours, and next-step evidence."
        : "The repository was recorded in the analysis, but no repository-specific recommendation row was available.",
    },
    {
      class: "insufficient",
      label: "Fresh GitHub telemetry unavailable",
      detail: reason,
      source: "https://github.com/" + repoName,
    },
    {
      class: "derived",
      label: "Present value",
      detail:
        "Conservative replacement-cost model using persisted analysis evidence only. Range $" +
        present.range.low.toLocaleString() +
        "-$" +
        present.range.high.toLocaleString() +
        ".",
    },
    {
      class: "model_estimate",
      label: "Market and upside model",
      detail: "Market need, demand, and upside are conservative planning estimates derived from the completed analysis; no fresh GitHub traction is assumed.",
    },
  ];

  const recommendedNextSteps = (context?.nextSteps ?? []).slice(0, 10);
  const opportunity: InvestmentOpportunityInput = {
    repo: repoName,
    completionPct: completion,
    productionReadinessPct: readiness,
    presentValueUsd: present.range,
    potentialValueUsd: { low: potentialLow, high: potentialHigh },
    marketNeed,
    demand,
    competitivePressure,
    commercializationProbability,
    remainingWork,
    evidenceConfidence,
    evidence,
  };

  return {
    opportunity,
    details: {
      repo: repoName,
      kind: context?.kind || "finish",
      title: context?.title || repoName.split("/").pop() || repoName,
      pitch: context?.pitch || "Repository valuation derived from completed portfolio analysis evidence.",
      github: {
        stars: 0,
        forks: 0,
        subscribers: 0,
        openIssues: 0,
        lastPush: "",
        sourceFiles: 0,
        sourceBytes: 0,
      },
      completion: {
        overall: completion,
        signals: {
          hasSource: false,
          hasManifest: false,
          hasReadme: false,
          hasTests: false,
          hasCi: false,
          hasDeploy: false,
          hasEnvExample: false,
          hasLicense: false,
          hasDocs: false,
        },
      },
      readiness: { overall: readiness },
      currentValuation: present,
      potentialValue: potential,
      market: {
        market_need_score: marketNeed,
        demand_score: demand,
        competitive_pressure_score: competitivePressure,
        confidence: evidenceConfidence,
        market_summary: "Analysis-backed fallback valuation used because fresh GitHub telemetry was unavailable.",
      },
      recommendedNextSteps,
      degradedEvidence: true,
      degradedReason: reason,
    },
  };
}

async function inspectRepo(token: string, repoName: string, context: AnalysisItemContext | null) {
  const repo = await ghJson<GhRepo>(token, `/repos/${repoName}`);
  const defaultBranch = repo.default_branch || "main";
  let tree: GhTreeEntry[] = [];
  try {
    const result = await ghJson<{ tree?: GhTreeEntry[] }>(
      token,
      `/repos/${repoName}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`,
    );
    tree = result.tree ?? [];
  } catch {
    tree = [];
  }

  const structural = structuralScores(repo, tree, context);
  const market = marketModel(repo, context);
  const estimatedTotalHours = Math.round(
    Math.max(
      context?.estimatedHours || 0,
      35,
      structural.source.files * 1.25 + structural.source.bytes / 14_000 + repo.size / 450,
    ),
  );
  const remainingWork = estimateRemainingWork({
    completionPct: structural.completion,
    sourceFiles: structural.source.files,
    sourceBytes: structural.source.bytes,
    missingCriticalDimensions: [structural.signals.hasTests, structural.signals.hasCi, structural.signals.hasDeploy].filter((value) => !value).length,
  });

  const present = valueRepository({
    replacement: {
      estimatedHours: estimatedTotalHours,
      completionPct: structural.completion,
      marketPotential: Math.max(1, Math.min(5, (market.marketNeed + market.demand) / 40)),
      stars: repo.stargazers_count,
      hasRevenueSignals: false,
    },
    traction: {
      githubStars: repo.stargazers_count,
      sources: [
        {
          claim: "GitHub repository telemetry",
          url: `https://github.com/${repoName}`,
          retrievedAt: new Date().toISOString(),
        },
      ],
    },
  });

  const potential = projectPotential(market.scenarios, context ? "medium" : "low");
  const potentialLow = Math.max(present.range.low, Math.min(...potential.scenarios.map((scenario) => scenario.valuationRange.low)));
  const potentialHigh = Math.max(present.range.high, Math.max(...potential.scenarios.map((scenario) => scenario.valuationRange.high)));
  const commercializationProbability = estimateCommercializationProbability({
    completionPct: structural.completion,
    productionReadinessPct: structural.readiness,
    marketNeed: market.marketNeed,
    demand: market.demand,
    competitivePressure: market.competitivePressure,
    tractionScore: market.traction,
    activityScore: market.activity,
  });

  const evidenceConfidence = Math.round(clamp(
    (tree.length > 0 ? 45 : 25) +
      (context ? 12 : 0) +
      (structural.signals.hasCi ? 8 : 0) +
      (structural.signals.hasTests ? 8 : 0) +
      (repo.stargazers_count > 0 || repo.forks_count > 0 ? 7 : 0),
  ));

  const evidence: IntelligenceEvidence[] = [
    {
      class: "verified",
      label: "GitHub repository telemetry",
      detail: `${repo.stargazers_count} stars, ${repo.forks_count} forks, ${repo.subscribers_count} subscribers, ${repo.open_issues_count} open issues, last pushed ${repo.pushed_at}.`,
      source: `https://github.com/${repoName}`,
    },
    {
      class: tree.length > 0 ? "derived" : "insufficient",
      label: "Repository structure coverage",
      detail: tree.length > 0
        ? `${tree.filter((entry) => entry.type === "blob").length} files inspected structurally; ${structural.source.files} source files detected.`
        : "The Git tree could not be read, so completion confidence is reduced.",
    },
    {
      class: "derived",
      label: "Present value",
      detail: `Deterministic replacement/traction model only; no revenue is assumed. Range $${present.range.low.toLocaleString()}-$${present.range.high.toLocaleString()}.`,
    },
    {
      class: "model_estimate",
      label: "Market and upside model",
      detail: "Market need and demand are planning estimates derived from analysis context, activity, and GitHub traction. Customer and ARPU scenarios are explicit assumptions, not observed sales.",
    },
    {
      class: "insufficient",
      label: "Commercial competition",
      detail: "Commercial competitor pricing, market share, and paid demand are not independently verified in the fast full-portfolio pass.",
    },
  ];

  const recommendedNextSteps = [
    ...(context?.nextSteps ?? []),
    ...missingSteps(structural.signals),
  ].filter((step, index, all) => step && all.indexOf(step) === index).slice(0, 10);

  const opportunity: InvestmentOpportunityInput = {
    repo: repoName,
    completionPct: structural.completion,
    productionReadinessPct: structural.readiness,
    presentValueUsd: present.range,
    potentialValueUsd: { low: potentialLow, high: potentialHigh },
    marketNeed: market.marketNeed,
    demand: market.demand,
    competitivePressure: market.competitivePressure,
    commercializationProbability,
    remainingWork,
    evidenceConfidence,
    evidence,
  };

  return {
    opportunity,
    details: {
      repo: repoName,
      kind: context?.kind || "finish",
      title: context?.title || repo.name,
      pitch: context?.pitch || repo.description || "No repository description supplied.",
      github: {
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        subscribers: repo.subscribers_count,
        openIssues: repo.open_issues_count,
        lastPush: repo.pushed_at,
        sourceFiles: structural.source.files,
        sourceBytes: structural.source.bytes,
      },
      completion: { overall: structural.completion, signals: structural.signals },
      readiness: { overall: structural.readiness },
      currentValuation: present,
      potentialValue: potential,
      market: {
        market_need_score: market.marketNeed,
        demand_score: market.demand,
        competitive_pressure_score: market.competitivePressure,
        confidence: evidenceConfidence,
        market_summary: "Full-portfolio planning model using analysis context and verified GitHub telemetry.",
      },
      recommendedNextSteps,
    },
  };
}

router.post(
  "/portfolio-intelligence/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const userId = req.userId!;

    const [{ data: analysis, error: analysisError }, { data: items, error: itemsError }] = await Promise.all([
      req.supabase!
        .from("analyses")
        .select("id, analyzed_repo_names, investment_intelligence")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle(),
      req.supabase!
        .from("analysis_items")
        .select("repo:repos, kind, title, pitch, effort, market_potential, estimated_hours, next_steps, repos")
        .eq("analysis_id", id)
        .order("rank", { ascending: true }),
    ]);

    if (analysisError) throw new Error(`Failed to load analysis: ${analysisError.message}`);
    if (itemsError) throw new Error(`Failed to load analysis items: ${itemsError.message}`);
    if (!analysis) throw Object.assign(new Error("Analysis not found"), { status: 404 });

    const itemRows = (items ?? []) as Array<Record<string, unknown>>;
    const contexts = contextsByRepo(itemRows);
    const analyzedNames = Array.isArray((analysis as Record<string, unknown>).analyzed_repo_names)
      ? ((analysis as Record<string, unknown>).analyzed_repo_names as unknown[]).map(String)
      : [];
    const repos = [...new Set([...analyzedNames, ...contexts.keys()])].filter(Boolean);

    if (repos.length === 0) {
      throw Object.assign(new Error("No repositories were recorded for this analysis."), { status: 400 });
    }
    if (repos.length > MAX_PORTFOLIO_REPOS) {
      throw Object.assign(
        new Error(`This portfolio contains ${repos.length} repositories. Full-portfolio intelligence currently supports up to ${MAX_PORTFOLIO_REPOS} repositories per run.`),
        { status: 400 },
      );
    }

    const github = requireGithubCredential(await loadGithubCredential(req.supabase!, userId));
    const inspected: Awaited<ReturnType<typeof inspectRepo>>[] = [];
    const errors: string[] = [];
    let cursor = 0;

    let githubRateLimited = false;
    try {
      await ghJson<GhRepo>(github.token, "/repos/" + repos[0]);
    } catch (error) {
      if (isGithubRateLimitError(error)) {
        githubRateLimited = true;
        errors.push(
          "GitHub API rate limit is exhausted. Valuation continued from persisted analysis evidence with reduced confidence instead of failing.",
        );
      }
    }

    if (githubRateLimited) {
      for (const repo of repos) {
        inspected.push(
          inspectRepoFromAnalysisContext(
            repo,
            contexts.get(repo) ?? null,
            "GitHub API rate limit prevented fresh repository telemetry during this valuation run.",
          ),
        );
      }
    } else {
      const concurrency = Math.min(4, repos.length);
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (cursor < repos.length) {
            const repo = repos[cursor++];
            try {
              inspected.push(await inspectRepo(github.token, repo, contexts.get(repo) ?? null));
            } catch (error) {
              const reason = error instanceof Error ? error.message : String(error);
              inspected.push(inspectRepoFromAnalysisContext(repo, contexts.get(repo) ?? null, reason));
              errors.push(repo + ": GitHub enrichment unavailable; used persisted analysis evidence instead.");
            }
          }
        }),
      );
    }

    if (inspected.length === 0) {
      throw new Error("Portfolio intelligence could not score any repository from either GitHub or persisted analysis evidence.");
    }

    const storedIntelligence = analysis && (analysis as Record<string, unknown>).investment_intelligence;
    const existingIntelligence = storedIntelligence !== null && typeof storedIntelligence === "object"
      ? storedIntelligence as Record<string, unknown>
      : {};
    const existingIsMeasured = String(existingIntelligence.methodologyVersion || "").startsWith("investment-intelligence");
    const existingRanking = Array.isArray(existingIntelligence.ranking)
      ? (existingIntelligence.ranking as Array<Record<string, unknown>>)
      : [];
    const measuredByRepo = new Map(existingRanking.map((row) => [String(row.repo || ""), row]));
    const opportunities = inspected.map((entry) => {
      const measured = existingIsMeasured ? measuredByRepo.get(entry.opportunity.repo) : undefined;
      if (!measured || typeof measured.completionPct !== "number") {
        return { ...entry.opportunity, evidence: [...(entry.opportunity.evidence ?? []), { class: "derived" as const, label: "Scoring pass", detail: "Coverage heuristic. Open Finish, Value & Reports after a deep score to replace this with measured completion." }] };
      }
      return {
        ...entry.opportunity,
        completionPct: Number(measured.completionPct),
        productionReadinessPct: Number(measured.productionReadinessPct ?? entry.opportunity.productionReadinessPct),
        presentValueUsd: (measured.presentValueUsd as typeof entry.opportunity.presentValueUsd) ?? entry.opportunity.presentValueUsd,
        potentialValueUsd: (measured.potentialValueUsd as typeof entry.opportunity.potentialValueUsd) ?? entry.opportunity.potentialValueUsd,
        evidenceConfidence: Number(measured.evidenceConfidence ?? entry.opportunity.evidenceConfidence),
        commercializationProbability: Number(measured.commercializationProbability ?? entry.opportunity.commercializationProbability),
        remainingWork: (measured.remainingWork as typeof entry.opportunity.remainingWork) ?? entry.opportunity.remainingWork,
        evidence: Array.isArray(measured.evidence) ? measured.evidence as typeof entry.opportunity.evidence : entry.opportunity.evidence,
      };
    });
    const ranked = rankInvestmentOpportunities(opportunities);
    const detailByRepo = new Map(inspected.map((entry) => [entry.details.repo, entry.details]));
    const ranking = ranked.map((entry) => ({
      ...entry,
      details: {
        ...detailByRepo.get(entry.repo),
        scoringPass: existingIsMeasured && measuredByRepo.has(entry.repo) ? "measured" : "coverage",
      },
    }));
    const generatedAt = new Date().toISOString();
    const result = {
      methodologyVersion: existingIsMeasured ? `${METHODOLOGY_VERSION}+measured-overlay` : METHODOLOGY_VERSION,
      generatedAt,
      analysisId: id,
      ranking,
      errors,
      portfolio: {
        reposRequested: repos.length,
        reposScored: ranking.length,
        coveragePct: Math.round((ranking.length / repos.length) * 1000) / 10,
        partialFailures: errors.length,
        presentValueLow: ranking.reduce((sum, item) => sum + item.presentValueUsd.low, 0),
        presentValueHigh: ranking.reduce((sum, item) => sum + item.presentValueUsd.high, 0),
        potentialValueLow: ranking.reduce((sum, item) => sum + item.potentialValueUsd.low, 0),
        potentialValueHigh: ranking.reduce((sum, item) => sum + item.potentialValueUsd.high, 0),
        weightedCommercializationProbability: Math.round(
          ranking.reduce((sum, item) => sum + item.commercializationProbability, 0) / ranking.length,
        ),
        scope: errors.some((message) => /rate limit|enrichment unavailable/i.test(message))
          ? "full analyzed portfolio (analysis-backed fallback for unavailable GitHub evidence)"
          : "full analyzed portfolio",
      },
      recommendation: ranking[0]
        ? `Finish ${ranking[0].repo} first. Its ${ranking[0].finishFirstScore}/100 finish-first score is the strongest risk-adjusted value-unlock opportunity across the analyzed portfolio.`
        : "No ranked recommendation is available.",
      evidencePolicy:
        errors.some((message) => /rate limit|enrichment unavailable/i.test(message))
          ? "The full-portfolio pass prefers verified GitHub telemetry, but when GitHub is unavailable or rate-limited it uses persisted RepoFinisher analysis evidence with reduced confidence instead of failing. Market and upside figures remain planning estimates; unverified revenue or customer claims are never assumed."
          : "The full-portfolio pass values every recorded repository with verified GitHub telemetry and conservative structural heuristics. Market and upside figures are labeled planning estimates; unverified revenue or customer claims are never assumed.",
    };

    const { error: saveError } = await req.supabase!
      .from("analyses")
      .update({ investment_intelligence: result, investment_intelligence_updated_at: generatedAt })
      .eq("id", id)
      .eq("user_id", userId);
    if (saveError) throw new Error(`Failed to save portfolio intelligence: ${saveError.message}`);

    await Promise.all(
      ranking.slice(0, 50).map((item) =>
        recordRepoLearning(req.supabase!, userId, item.repo, {
          action: "portfolio_intelligence",
          outcome: "observation",
          duration_ms: 0,
          details: `Rank #${item.rank}; finish-first ${item.finishFirstScore}/100; completion ${item.completionPct}%; commercialization ${item.commercializationProbability}%.`,
          files_affected: [],
          fix_pattern: "portfolio-intelligence-v2",
          prompt_version: METHODOLOGY_VERSION,
          metadata: {
            rank: item.rank,
            finishFirstScore: item.finishFirstScore,
            evidenceConfidence: item.evidenceConfidence,
          },
          timestamp: generatedAt,
        }),
      ),
    ).catch(() => undefined);

    res.json(result);
  }),
);

router.get(
  "/portfolio-intelligence/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { data, error } = await req.supabase!
      .from("analyses")
      .select("investment_intelligence")
      .eq("id", id)
      .eq("user_id", req.userId!)
      .maybeSingle();
    if (error) throw new Error(`Failed to load portfolio intelligence: ${error.message}`);
    if (!data) throw Object.assign(new Error("Analysis not found"), { status: 404 });
    res.json((data as Record<string, unknown>).investment_intelligence ?? null);
  }),
);

export default router;
