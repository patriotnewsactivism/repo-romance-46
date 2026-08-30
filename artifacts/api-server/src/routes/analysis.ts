import { Router, type IRouter } from "express";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "../lib/async-handler";
import { loadAiCredential, loadGithubCredential, requireGithubCredential } from "../lib/credentials";
import { runInBackground } from "../lib/background-tasks";
import { callAI } from "../lib/ai-provider";
import { captureException, flushSentry } from "../instrument";

const router: IRouter = Router();

const GH_API = "https://api.github.com";

async function gh<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${GH_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "repo-finisher",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub ${path} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function ghText(path: string, token: string): Promise<string | null> {
  const res = await fetch(`${GH_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.raw",
      "User-Agent": "repo-finisher",
    },
  });
  if (!res.ok) return null;
  return res.text();
}

interface Repo {
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  fork: boolean;
  archived: boolean;
  pushed_at: string;
  default_branch: string;
  html_url: string;
  size: number;
  topics?: string[];
  homepage?: string | null;
  license?: { name: string } | null;
  forks_count?: number;
}

interface TreeEntry {
  path: string;
  type: string;
  size?: number;
}

const KEY_FILES = [
  "package.json",
  "README.md",
  "readme.md",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "index.ts",
  "src/index.ts",
  "src/main.ts",
  "src/App.tsx",
  "main.py",
  "app.py",
  "Dockerfile",
  "docker-compose.yml",
  ".env.example",
  "tsconfig.json",
  "vite.config.ts",
  "next.config.js",
  "wrangler.toml",
  "supabase/config.toml",
];

const SAMPLE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".rb", ".java", ".swift", ".kt", ".vue", ".svelte", ".css", ".sql",
]);

async function parallelMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i], i) };
      } catch (e) {
        results[i] = { status: "rejected", reason: e };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

type ProgressFn = (msg: string) => Promise<void>;

function extractDepsFromPackageJson(text: string): string[] {
  try {
    const pkg = JSON.parse(text);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return Object.keys(deps || {}).slice(0, 30);
  } catch {
    return [];
  }
}

function extractDepsFromPyproject(text: string): string[] {
  const deps: string[] = [];
  const inDeps = text.split("[project]")?.[1]?.split("dependencies")?.[1];
  if (inDeps) {
    const matches = inDeps.match(/["']([a-zA-Z0-9_-]+)["']/g);
    if (matches) {
      for (const m of matches.slice(0, 30)) deps.push(m.replace(/["']/g, ""));
    }
  }
  return deps;
}

/** Domain cluster assigned to a repo during context-aware digestion */
interface DomainCluster {
  name: string;
  repos: string[];
  theme: string;
}

/**
 * Digest a repository into a compact text representation.
 * When a cluster hint is provided the function emphasises different
 * file types: ML repos get notebook/model weight, web repos get routing/deploy focus.
 */
async function digestRepo(repo: Repo, token: string, compact = false, clusterHint?: string): Promise<string> {
  const parts: string[] = [];
  parts.push(`REPO: ${repo.full_name}`);
  if (repo.description) parts.push(`DESC: ${repo.description}`);
  parts.push(
    `LANG: ${repo.language ?? "?"} · stars: ${repo.stargazers_count} · forks: ${repo.forks_count ?? 0} · pushed: ${repo.pushed_at} · size: ${repo.size}KB`,
  );
  if (repo.topics?.length) parts.push(`TOPICS: ${repo.topics.join(", ")}`);
  if (repo.homepage) parts.push(`HOMEPAGE: ${repo.homepage}`);
  if (repo.license?.name) parts.push(`LICENSE: ${repo.license.name}`);
  if (clusterHint) parts.push(`CLUSTER: ${clusterHint}`);

  const readmeChars = compact ? 500 : 3000;
  const readme = await ghText(`/repos/${repo.full_name}/readme`, token);
  if (readme) parts.push(`README (truncated):\n${readme.slice(0, readmeChars)}`);

  let tree: TreeEntry[] = [];
  let treeTruncated = false;
  try {
    const treeRes = await gh<{ tree: TreeEntry[]; truncated: boolean }>(
      `/repos/${repo.full_name}/git/trees/${repo.default_branch}?recursive=1`,
      token,
    );
    tree = treeRes.tree.filter((t) => t.type === "blob");
    treeTruncated = treeRes.truncated;
  } catch {
    try {
      const treeRes = await gh<{ tree: TreeEntry[] }>(`/repos/${repo.full_name}/git/trees/${repo.default_branch}`, token);
      tree = treeRes.tree.filter((t) => t.type === "blob");
    } catch {
      /* give up on tree */
    }
  }

  const paths = tree.map((t) => t.path);
  const topFiles = compact ? 25 : 80;
  parts.push(
    `FILES (${paths.length} total${treeTruncated ? " — TRUNCATED, showing partial" : ""}, top ${Math.min(topFiles, paths.length)}):\n${paths.slice(0, topFiles).join("\n")}`,
  );

  // Context-aware key file prioritisation based on cluster theme
  const isMLRepo = clusterHint && /ml|ai|model|data|notebook|research/i.test(clusterHint);
  const isWebRepo = clusterHint && /web|api|saas|service|app|frontend|backend/i.test(clusterHint);

  const toSample = new Set<string>();
  for (const kf of KEY_FILES) {
    if (paths.includes(kf)) toSample.add(kf);
  }

  // Bonus ML-specific files
  if (isMLRepo) {
    for (const p of paths.filter((f) => f.endsWith(".ipynb") || f.endsWith(".py")).slice(0, 3)) {
      toSample.add(p);
    }
  }

  // Bonus web/API-specific files
  if (isWebRepo) {
    for (const p of paths.filter((f) => f.includes("route") || f.includes("api") || f.includes("server") || f.includes("deploy")).slice(0, 2)) {
      toSample.add(p);
    }
  }

  const sourceFiles = tree
    .filter((t) => {
      const ext = t.path.slice(t.path.lastIndexOf("."));
      return (
        SAMPLE_EXT.has(ext) &&
        !t.path.includes("node_modules") &&
        !t.path.includes("dist") &&
        !t.path.includes(".output") &&
        !t.path.includes("build") &&
        !t.path.includes(".next")
      );
    })
    .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
    .slice(0, compact ? 3 : 6)
    .map((t) => t.path);
  for (const p of sourceFiles) toSample.add(p);

  const samplePaths = Array.from(toSample).slice(0, compact ? 4 : 10);

  const fileResults = await Promise.all(
    samplePaths.map((p) => ghText(`/repos/${repo.full_name}/contents/${encodeURIComponent(p)}`, token)),
  );

  let sampledBytes = 0;
  const BUDGET = compact ? 1800 : 12000;
  const maxFileSlice = compact ? 600 : 2000;

  for (let i = 0; i < fileResults.length; i++) {
    if (sampledBytes >= BUDGET) break;
    const text = fileResults[i];
    if (!text) continue;
    const fname = samplePaths[i];

    if (fname === "package.json") {
      const deps = extractDepsFromPackageJson(text);
      if (deps.length) {
        parts.push(`DEPENDENCIES (package.json): ${deps.join(", ")}`);
        const snippet = text.slice(0, 300);
        parts.push(`--- FILE: ${fname} ---\n${snippet}`);
        sampledBytes += 300;
        continue;
      }
    }
    if (fname === "pyproject.toml") {
      const deps = extractDepsFromPyproject(text);
      if (deps.length) {
        parts.push(`DEPENDENCIES (pyproject.toml): ${deps.join(", ")}`);
        const snippet = text.slice(0, 300);
        parts.push(`--- FILE: ${fname} ---\n${snippet}`);
        sampledBytes += 300;
        continue;
      }
    }

    const snippet = text.slice(0, Math.min(maxFileSlice, BUDGET - sampledBytes));
    parts.push(`--- FILE: ${fname} ---\n${snippet}`);
    sampledBytes += snippet.length;
  }

  return parts.join("\n\n");
}

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

function maxInputTokensForProvider(provider: string): number {
  switch (provider) {
    case "github_models":
      return 4500;
    case "openai":
      return 12000;
    case "anthropic":
      return 150000;
    case "google":
      return 500000;
    case "custom":
      return 12000;
    default:
      return 60000;
  }
}

function chunkDigests(digests: string[], maxTokens: number): string[][] {
  const OVERHEAD_TOKENS = 1500;
  const budget = Math.max(maxTokens - OVERHEAD_TOKENS, 800);
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (let d of digests) {
    let t = estimateTokens(d);
    if (t > budget) {
      d = d.slice(0, budget * 4);
      t = estimateTokens(d);
    }
    if (current.length > 0 && currentTokens + t > budget) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(d);
    currentTokens += t;
  }
  if (current.length) chunks.push(current);
  return chunks.length ? chunks : [[]];
}

function computePortfolioStats(shortlist: Repo[]) {
  const langCounts = new Map<string, number>();
  for (const r of shortlist) {
    const lang = r.language || "Other";
    langCounts.set(lang, (langCounts.get(lang) || 0) + 1);
  }
  const total = shortlist.length || 1;
  const languages = Array.from(langCounts.entries())
    .map(([name, count]) => ({ name, count, pct: Math.round((count / total) * 1000) / 10 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const totalStars = shortlist.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);
  const mostActive = [...shortlist].sort((a, b) => new Date(b.pushed_at).getTime() - new Date(a.pushed_at).getTime())[0];
  const sixMonthsAgo = Date.now() - 1000 * 60 * 60 * 24 * 30 * 6;
  const dormant = shortlist.filter((r) => new Date(r.pushed_at).getTime() < sixMonthsAgo).map((r) => r.full_name);
  const avgSize = shortlist.reduce((sum, r) => sum + (r.size || 0), 0) / total;

  return {
    total_repos: shortlist.length,
    languages,
    total_stars: totalStars,
    most_active_repo: mostActive?.full_name,
    dormant_repos: dormant,
    average_repo_size_kb: Math.round(avgSize),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} exceeded ${Math.round(ms / 1000)}s timeout. Try reducing max repos or switching AI provider.`)),
        ms,
      ),
    ),
  ]);
}

interface FilterPrefs {
  filter_languages: string[] | null;
  filter_min_stars: number;
  filter_exclude_archived: boolean;
  filter_max_repos: number;
}

function applyFilters(repos: Repo[], prefs: FilterPrefs | null): Repo[] {
  let shortlist = repos.filter((r) => !r.fork);
  if (!prefs) return shortlist;

  if (prefs.filter_exclude_archived) {
    shortlist = shortlist.filter((r) => !r.archived);
  }
  if (prefs.filter_languages && prefs.filter_languages.length > 0) {
    shortlist = shortlist.filter((r) => r.language && prefs.filter_languages!.includes(r.language));
  }
  if (prefs.filter_min_stars > 0) {
    shortlist = shortlist.filter((r) => r.stargazers_count >= prefs.filter_min_stars);
  }
  return shortlist.slice(0, prefs.filter_max_repos || 200);
}

async function fetchAllRepos(token: string, maxRepos: number): Promise<Repo[]> {
  const allRepos: Repo[] = [];
  let page = 1;
  const perPage = 100;
  // Fetch enough pages to satisfy maxRepos, cap at 10 pages (1000 repos)
  const maxPages = Math.min(Math.ceil(maxRepos / perPage) + 1, 10);

  while (page <= maxPages) {
    const batch = await withTimeout(
      gh<Repo[]>(`/user/repos?per_page=${perPage}&page=${page}&affiliation=owner&sort=pushed`, token),
      20000,
      `GitHub repo fetch (page ${page})`,
    );
    if (!batch || batch.length === 0) break;
    allRepos.push(...batch);
    if (batch.length < perPage) break;
    page++;
  }
  return allRepos;
}

/**
 * Score a repo by "interestingness" for deep-digest prioritisation.
 * Higher = more worth a full GitHub API + AI digest.
 */
function scoreRepo(repo: Repo, clusterMap: Map<string, string>): number {
  let score = 0;

  // Recency — pushed within last year scores highest
  const daysSincePush = (Date.now() - new Date(repo.pushed_at).getTime()) / 86_400_000;
  score += Math.max(0, 100 - daysSincePush * 0.2); // up to 100 pts for today's push

  // Stars (diminishing returns)
  score += Math.min(50, repo.stargazers_count * 5);

  // Belongs to a recognised cluster → higher value
  if (clusterMap.has(repo.full_name)) score += 30;

  // Has meaningful description
  if (repo.description && repo.description.trim().length > 10) score += 15;

  // Has topics
  if (repo.topics && repo.topics.length > 0) score += 10;

  // Has a homepage (shipped something)
  if (repo.homepage) score += 20;

  // Size > 0 (not an empty placeholder)
  if (repo.size > 0) score += 10;

  // Penalise archived
  if (repo.archived) score -= 40;

  return score;
}

/** Compact metadata line for repos that won't get a full AI digest. */
function repoMetaLine(repo: Repo): string {
  const parts = [
    repo.full_name,
    repo.language ?? "?",
    `${repo.stargazers_count}★`,
    `pushed ${repo.pushed_at.slice(0, 10)}`,
  ];
  if (repo.description) parts.push(`"${repo.description.slice(0, 80)}"`);
  if (repo.topics?.length) parts.push(`[${repo.topics.slice(0, 4).join(", ")}]`);
  return parts.join(" | ");
}

const RecommendationSchema = z.object({
  recommendations: z.array(
    z.object({
      kind: z.enum(["finish", "combine", "repurpose"]),
      title: z.string(),
      repos: z.array(z.string()),
      pitch: z.string(),
      effort: z.number().int(),
      market_potential: z.number().int(),
      next_steps: z.array(z.string()),
      tech_stack: z.array(z.string()).nullish().transform((v) => v ?? []),
      marketing_tweet: z.string().nullish(),
      marketing_linkedin: z.string().nullish(),
      estimated_hours: z.number().int().nullish(),
    }),
  ),
  summary_md: z.string(),
  portfolio_stats: z
    .object({
      total_repos: z.number().int(),
      languages: z.array(z.object({ name: z.string(), count: z.number().int(), pct: z.number() })),
      total_stars: z.number().int(),
      most_active_repo: z.string().optional(),
      dormant_repos: z.array(z.string()).optional().default([]),
      average_repo_size_kb: z.number().optional(),
    })
    .default({ total_repos: 0, languages: [], total_stars: 0, dormant_repos: [] }),
});

/** The static fallback system prompt used when portfolio profiling is unavailable */
const FALLBACK_SYSTEM_PROMPT = `You are RepoFinisher's senior product architect. Your primary mission is to map each viable repository to production-ready completion.

DEFAULT DECISION: FINISH THE REPOSITORY INDEPENDENTLY.
- At least 95% of primary recommendations should be FINISH recommendations.
- Give each viable repo its own completion path rather than collapsing multiple repos into one idea.
- COMBINE or REPURPOSE is exceptional. Use it only when concrete code-level evidence shows that finishing the repo independently is clearly inferior, duplicative, or technically nonsensical. Never invent a combination just to create variety.
- A dormant repo is not automatically a combine/repurpose candidate; first determine how to finish it.

For every FINISH recommendation, build a real path to completion, not a generic checklist. Inspect the supplied evidence and identify the intended product, current completion blockers, missing core functionality, broken/stubbed flows, backend/data/auth/security gaps, UX gaps, testing/build issues, deployment readiness, observability, documentation, and rollback/operations needs that actually apply.

Before producing the final recommendation, internally draft the completion plan, challenge its assumptions, look for omissions and failure modes, then revise it. Do not expose private chain-of-thought. Return only the improved conclusion, concrete evidence, and executable completion steps.

Every next_steps array must function as an implementation-quality completion directive: reference actual files/features/APIs where evidence exists; order work by dependency; include acceptance criteria; require build/typecheck/lint/tests as appropriate; require deployment and smoke verification when the repo is deployable; and never call a repo complete while known blockers remain.

For every recommendation return:
- kind, title, repos, pitch
- effort (1-5), market_potential (1-5)
- next_steps: concrete completion sequence with acceptance criteria
- tech_stack
- marketing_tweet / marketing_linkedin only when useful
- estimated_hours

Also produce summary_md describing portfolio-level completion priorities.

Preserve coverage: return one primary recommendation for every viable repo represented by the detailed digests, up to 40 per synthesis. Prefer FINISH and independent completion. Generic advice is not acceptable.`;

const AI_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary_md: { type: "string" },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["finish", "combine", "repurpose"] },
          title: { type: "string" },
          repos: { type: "array", items: { type: "string" } },
          pitch: { type: "string" },
          effort: { type: "integer" },
          market_potential: { type: "integer" },
          next_steps: { type: "array", items: { type: "string" } },
          tech_stack: { type: "array", items: { type: "string" } },
          marketing_tweet: { type: ["string", "null"] },
          marketing_linkedin: { type: ["string", "null"] },
          estimated_hours: { type: ["integer", "null"] },
        },
        required: [
          "kind", "title", "repos", "pitch", "effort", "market_potential",
          "next_steps", "tech_stack", "marketing_tweet", "marketing_linkedin", "estimated_hours",
        ],
      },
    },
  },
  required: ["summary_md", "recommendations"],
};

// ─── Stage models by provider + tier ────────────────────────────────────────

interface StageModels {
  profilerModel: string;
  critiqueModel: string;
  synthesisModel: string;
  useThinking: boolean;
  thinkingBudget: number;
}

/**
 * Returns the models for each analysis stage.
 *
 * `exactModel` is the identifier resolved by `loadAiCredential` — the user's
 * saved model, or the platform default for the provider. docs/AI_PROVIDERS.md
 * makes it authoritative: RepoFinisher must run the model that was configured
 * rather than substituting one of its own. Without it, an OpenRouter account
 * fell through to the stage defaults below and was asked for `gpt-4o-mini`,
 * which is not an OpenRouter model identifier at all.
 */
export function getStageModels(provider: string, tier: string, exactModel?: string | null): StageModels {
  const stages = defaultStageModels(provider, tier);
  const pinned = exactModel?.trim();
  if (!pinned) return stages;
  return { ...stages, profilerModel: pinned, critiqueModel: pinned, synthesisModel: pinned };
}

/** Per-stage fallbacks used only when no exact model identifier is configured. */
function defaultStageModels(provider: string, tier: string): StageModels {
  const DEFAULT: Record<string, string> = {
    github_models: "gpt-4o-mini",
    openai: "gpt-4o",
    anthropic: "claude-sonnet-4-20250514",
    google: "gemini-3.7-flash",
    openrouter: "deepseek/deepseek-v4-flash-0731",
    custom: "gpt-4o",
  };
  const base = DEFAULT[provider] ?? "gemini-3.7-flash";

  if (tier === "fast") {
    return { profilerModel: base, critiqueModel: base, synthesisModel: base, useThinking: false, thinkingBudget: 0 };
  }

  if (tier === "deep") {
    switch (provider) {
      case "openai":
      case "custom":
        return { profilerModel: "o3", critiqueModel: "o3", synthesisModel: "o3", useThinking: false, thinkingBudget: 0 };
      case "anthropic":
        return {
          profilerModel: "claude-sonnet-4-20250514",
          critiqueModel: "claude-sonnet-4-20250514",
          synthesisModel: "claude-sonnet-4-20250514",
          useThinking: true,
          thinkingBudget: 10000,
        };
      case "google":
        return { profilerModel: "gemini-3.7-flash", critiqueModel: "gemini-3.7-flash", synthesisModel: "gemini-3.7-flash", useThinking: false, thinkingBudget: 0 };
      default: // openrouter and anything else: the provider's own default model
        return { profilerModel: base, critiqueModel: base, synthesisModel: base, useThinking: false, thinkingBudget: 0 };
    }
  }

  // balanced (default) — reasoning models for profiling/critique, best synthesis available
  switch (provider) {
    case "openai":
    case "custom":
      return { profilerModel: "o4-mini", critiqueModel: "o4-mini", synthesisModel: "o3-mini", useThinking: false, thinkingBudget: 0 };
    case "anthropic":
      return {
        profilerModel: "claude-3-5-haiku-20241022",
        critiqueModel: "claude-3-5-haiku-20241022",
        synthesisModel: "claude-sonnet-4-20250514",
        useThinking: false,
        thinkingBudget: 0,
      };
    case "google":
      return { profilerModel: "gemini-3.7-flash", critiqueModel: "gemini-3.7-flash", synthesisModel: "gemini-3.7-flash", useThinking: false, thinkingBudget: 0 };
    default: // openrouter/github_models — no dedicated reasoning tier, use the provider's own default
      return { profilerModel: base, critiqueModel: base, synthesisModel: base, useThinking: false, thinkingBudget: 0 };
  }
}

// ─── Stage 1: Portfolio profiler ────────────────────────────────────────────

interface PortfolioProfile {
  developer_profile: string;
  domain_clusters: DomainCluster[];
  custom_system_prompt: string;
  strategy_summary: string;
}

/**
 * Stage 1 — Portfolio profiler.
 * Runs a fast reasoning call over repo metadata (no full digests) to produce
 * a developer profile, domain clusters, and a custom analysis system prompt
 * tailored to this specific portfolio. Falls back to the default prompt on error.
 */
async function profilePortfolio(
  repos: Repo[],
  aiConfig: { provider: string; apiKey: string | null },
  stageModels: StageModels,
): Promise<PortfolioProfile> {
  const metaLines = repos
    .map(
      (r) =>
        `- ${r.full_name}: ${r.language ?? "?"}, ${r.stargazers_count}★, pushed ${r.pushed_at.slice(0, 10)}${r.topics?.length ? `, topics: ${r.topics.slice(0, 5).join(" ")}` : ""}${r.description ? `, desc: "${r.description.slice(0, 100)}"` : ""}`,
    )
    .join("\n");

  const systemPrompt = `You are an expert developer portfolio analyst. Analyze a developer's GitHub portfolio metadata and produce a strategic analysis profile that will be used to generate hyper-specific product recommendations.

## Reasoning & Planning Before Action (CRITICAL)
Before producing the JSON output, you MUST explicitly conduct step-by-step reasoning:
1. **Identify the Real Problem**: Determine what this developer's actual body of work reveals about their skills, coding patterns, and unrealized product opportunities — not just a restatement of surface metadata (stars, languages, topics).
2. **Consider Edge Cases, Risks & Trade-offs**: Watch for misleading signals — a dormant high-star repo vs. an active niche one, forks vs. original work, a mixed-language portfolio that looks scattered but actually reveals a consistent domain focus.
3. **Form an Execution Plan**: Decide the cluster boundaries and the direction of custom_system_prompt before writing any JSON, so the downstream analysis stage receives precise, domain-specific guidance instead of generic advice.

Output a JSON object with exactly these keys:

developer_profile (string): 2-3 sentences precisely characterizing this developer — primary domain, coding patterns inferred from repo names/topics/languages, career stage (hobbyist/indie hacker/professional), and key strengths.

domain_clusters (array): Group the repos into 2-6 meaningful clusters by theme. Each cluster: { "name": string, "repos": [full_names], "theme": string (1 sentence description) }.

custom_system_prompt (string): A specialized, domain-aware system prompt (200-350 words) for the main portfolio analysis AI. It MUST be completion-first: require independent FINISH recommendations for at least 95% of viable repos and allow COMBINE/REPURPOSE only as rare, evidence-backed exceptions. Replace generic advice with domain-specific completion direction. Examples of what to include:
  - For ML/AI repos: "Look for opportunities to wrap ML models as production APIs or browser demos. Prioritize repos with model weights or training pipelines as FINISH candidates."
  - For web devs: "Look for SaaS-worthy patterns — auth, billing, multi-tenancy. Finish each app independently by identifying its exact missing production capabilities; do not combine repos merely because their stacks are compatible."
  - For CLIs/devtools: "Target developer audiences. Evaluate marketability as paid OSS tools or hosted services."
  Tailor the completion rubric to the developer's stack. Treat COMBINE/REPURPOSE as exceptional alternatives that require strong code-level evidence.

strategy_summary (string): 1-2 sentences explaining the analysis approach chosen for this portfolio.

Respond ONLY with valid JSON. Do not wrap in markdown.`;

  const userContent = `GitHub portfolio (${repos.length} repos):\n${metaLines}`;

  try {
    const result = await callAI(
      {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        model: stageModels.profilerModel,
      },
      aiConfig,
    );
    // Strip markdown code fences if present
    const raw = result.content.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(raw) as PortfolioProfile;
    if (!parsed.developer_profile || !parsed.custom_system_prompt) throw new Error("Incomplete profile response");
    if (!Array.isArray(parsed.domain_clusters)) parsed.domain_clusters = [];
    return parsed;
  } catch (e) {
    console.warn("[analysis] Portfolio profiling failed, using default prompt:", e instanceof Error ? e.message : e);
    return {
      developer_profile: `Developer with ${repos.length} GitHub repositories across multiple domains.`,
      domain_clusters: [{ name: "All repos", repos: repos.map((r) => r.full_name), theme: "general" }],
      custom_system_prompt: FALLBACK_SYSTEM_PROMPT,
      strategy_summary: "Using standard analysis strategy (profiling unavailable).",
    };
  }
}

// ─── Stage 3: AI batch analysis ─────────────────────────────────────────────

async function callBatchedAI(
  digests: string[],
  systemPrompt: string,
  aiConfig: { provider: string; apiKey: string | null },
): Promise<z.infer<typeof RecommendationSchema>> {
  const user = `Here are the repo digests:\n\n${digests.join("\n\n=========\n\n")}`;

  const aiResult = await callAI(
    {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: user },
      ],
      responseFormat: { type: "json_schema", json_schema: { name: "recommendations", strict: true, schema: AI_JSON_SCHEMA } },
    },
    aiConfig,
  );
  const parsed = JSON.parse(aiResult.content || "{}");
  return RecommendationSchema.parse(parsed);
}

function isNonRetryableAIError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /API_KEY_INVALID|api key not valid|invalid api key|no api key|401|403|unauthorized|forbidden/i.test(message);
}

async function callBatchedAIWithRetry(
  batch: string[],
  systemPrompt: string,
  aiConfig: { provider: string; apiKey: string | null },
): Promise<z.infer<typeof RecommendationSchema>> {
  const maxAttempts = 2;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await callBatchedAI(batch, systemPrompt, aiConfig);
    } catch (e) {
      lastErr = e;
      if (isNonRetryableAIError(e)) throw e;
      if (attempt < maxAttempts) await sleep(2000 * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("AI batch failed");
}

function aiBatchConcurrency(provider: string): number {
  switch (provider) {
    case "github_models": return 2;
    case "openai":
    case "custom": return 4;
    default: return 5;
  }
}

async function runBatchedAI(
  digests: string[],
  systemPrompt: string,
  aiConfig: { provider: string; apiKey: string | null },
  onProgress?: ProgressFn,
): Promise<z.infer<typeof RecommendationSchema>> {
  const budget = maxInputTokensForProvider(aiConfig.provider);
  const batches = chunkDigests(digests, budget).filter((b) => b.length > 0);
  const concurrency = aiBatchConcurrency(aiConfig.provider);

  let completed = 0;
  let firstSummary = "";
  let failedBatches = 0;

  const results = await parallelMap(batches, concurrency, async (batch) => {
    const result = await callBatchedAIWithRetry(batch, systemPrompt, aiConfig);
    completed++;
    if (onProgress) {
      await onProgress(`AI batch ${completed}/${batches.length} complete (${batch.length} repos)`);
    }
    return result;
  });

  const allRecommendations: z.infer<typeof RecommendationSchema>["recommendations"] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      allRecommendations.push(...r.value.recommendations);
      if (!firstSummary) firstSummary = r.value.summary_md;
    } else {
      failedBatches++;
      console.error("[analysis] AI batch failed after retries", r.reason);
    }
  }

  if (allRecommendations.length === 0) {
    throw new Error(
      failedBatches > 0
        ? `All ${failedBatches} AI batch(es) failed. The AI provider may be rate-limited or unavailable — try again or switch provider.`
        : "AI analysis returned no recommendations.",
    );
  }

  if (failedBatches > 0 && onProgress) {
    await onProgress(`${failedBatches}/${batches.length} AI batches failed, continuing with partial results…`);
  }

  return RecommendationSchema.parse({
    recommendations: allRecommendations,
    summary_md: firstSummary || "Analysis complete.",
  });
}

// ─── Stage 4: Critique pass ──────────────────────────────────────────────────

interface AnalysisCritique {
  gaps: string[];
  too_generic: { title: string; reason: string }[];
  missed_synergies: string[];
  refinement_notes: string;
}

/**
 * Stage 4 — Self-critique pass.
 * Uses a reasoning model to read the draft recommendations and identify gaps,
 * generic items, and missed synergies before the final synthesis.
 */
async function critiqueResults(
  recommendations: z.infer<typeof RecommendationSchema>["recommendations"],
  repoIndex: string,
  aiConfig: { provider: string; apiKey: string | null },
  stageModels: StageModels,
): Promise<AnalysisCritique> {
  const recsText = recommendations
    .slice(0, 40)
    .map(
      (r, i) =>
        `${i + 1}. [${r.kind.toUpperCase()}] ${r.title}\n   repos: ${r.repos.join(", ")}\n   pitch: ${r.pitch}\n   effort: ${r.effort}/5, market: ${r.market_potential}/5\n   next_steps: ${r.next_steps.slice(0, 3).join("; ")}`,
    )
    .join("\n\n");

  const systemPrompt = `You are a ruthless quality reviewer of software product recommendations. Your job: find every weakness in these draft recommendations so the final synthesis can fix them.

## Reasoning & Planning Before Action (CRITICAL)
Before producing your critique, you MUST explicitly conduct step-by-step reasoning:
1. **Identify the Real Problem**: Determine which specific draft recommendations are weak, generic, or miss real signal already present in the repo digests — not surface-level nitpicks.
2. **Consider Edge Cases, Risks & Trade-offs**: Flag synergies that look plausible but aren't technically real. Don't let a recommendation slide just because it isn't obviously bad — "not wrong" is not the bar.
3. **Form an Execution Plan**: Structure refinement_notes as a prioritized, actionable punch list the synthesis step can execute directly — not a vague summary of impressions.

Produce JSON with:
- gaps (string[]): Important repos, patterns, or opportunity types that were missed or underweighted. Be specific — name the repos.
- too_generic (array of {title, reason}): Recommendations that are too generic — next_steps like "add tests" or "write documentation" without specifics, or pitches that don't reference actual code.
- missed_synergies (string[]): Exceptional alternatives only. Return at most one evidence-backed combine/repurpose case if independent completion is clearly inferior; otherwise return an empty array.
- refinement_notes (string): Direct, prescriptive guidance for the synthesis step (the AI that produces the final recommendations reads this). Tell it specifically what to change, add, remove, or sharpen. Be blunt.

A weak critique wastes the synthesis pass. Be specific, be harsh, be useful.
Respond ONLY with valid JSON.`;

  const userContent = `Portfolio repos:\n${repoIndex}\n\nDraft recommendations to critique:\n${recsText}`;

  try {
    const result = await callAI(
      {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        model: stageModels.critiqueModel,
      },
      aiConfig,
    );
    const raw = result.content.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(raw) as AnalysisCritique;
    if (!parsed.refinement_notes) throw new Error("Incomplete critique");
    if (!Array.isArray(parsed.gaps)) parsed.gaps = [];
    if (!Array.isArray(parsed.too_generic)) parsed.too_generic = [];
    if (!Array.isArray(parsed.missed_synergies)) parsed.missed_synergies = [];
    return parsed;
  } catch (e) {
    console.warn("[analysis] Critique pass failed, skipping:", e instanceof Error ? e.message : e);
    return {
      gaps: [],
      too_generic: [],
      missed_synergies: [],
      refinement_notes: "Keep the most specific and actionable recommendations. Remove anything generic.",
    };
  }
}

// ─── Stage 5: Synthesis with reasoning ──────────────────────────────────────

/**
 * Stage 5 — Synthesis with reasoning model (or extended thinking).
 * Takes draft recommendations + critique and produces the final polished output.
 * Uses the best available model for the configured provider.
 */
async function synthesizeWithReasoning(
  allRecommendations: z.infer<typeof RecommendationSchema>["recommendations"],
  critique: AnalysisCritique,
  repoIndex: string,
  aiConfig: { provider: string; apiKey: string | null },
  stageModels: StageModels,
): Promise<z.infer<typeof RecommendationSchema>> {
  if (allRecommendations.length === 0) {
    return RecommendationSchema.parse({ recommendations: [], summary_md: "Analysis complete." });
  }

  const recsText = allRecommendations
    .slice(0, 50)
    .map((r, i) => `${i + 1}. [${r.kind}] ${r.title} — repos: ${r.repos.join(", ")} — ${r.pitch}`)
    .join("\n");

  const critiqueText = [
    critique.gaps.length ? `Gaps identified: ${critique.gaps.join("; ")}` : "",
    critique.too_generic.length
      ? `Too generic (must be made specific): ${critique.too_generic.map((g) => `"${g.title}" (${g.reason})`).join("; ")}`
      : "",
    critique.missed_synergies.length ? `Missed synergies to add: ${critique.missed_synergies.join("; ")}` : "",
    `Synthesis guidance: ${critique.refinement_notes}`,
  ]
    .filter(Boolean)
    .join("\n");

  const systemPrompt = `You are a world-class product strategist performing the final synthesis of a developer portfolio analysis.

## Reasoning & Planning Before Action (CRITICAL)
Before producing the final JSON, you MUST explicitly conduct step-by-step reasoning:
1. **Identify the Real Problem**: Determine exactly which critique points require a rewrite, an addition, or a removal before touching any single recommendation.
2. **Consider Edge Cases, Risks & Trade-offs**: Don't over-correct into padding recommendations with unnecessary length — sharper and shorter beats generic and long.
3. **Form an Execution Plan**: Sequence the fixes — remove generic items first, then add missed synergies, then sharpen every pitch — before producing final JSON, so nothing gets missed or duplicated.

Apply the critique feedback strictly:
1. Remove or rewrite any recommendation flagged as too generic — every next_step must reference specific files, APIs, or features visible in the repo digests.
2. Preserve a separate FINISH path for each viable repo represented in the draft. Do not collapse independent repos into a combined recommendation.
3. Treat critique.missed_synergies as advisory only: use a COMBINE/REPURPOSE result only when the evidence is compelling, and keep at least 95% of final recommendations as FINISH.
4. Sharpen pitches to name a specific target user and value prop, and make next_steps an executable completion directive with acceptance criteria.
5. Produce a fresh summary_md (200 words) that reflects this specific developer's portfolio, not a generic template.
6. Preserve completion coverage for up to 40 viable repos and rank within that set by (market_potential * 2 - effort).

The final output must feel like it was written by someone who actually READ the code, not generic advice.

${stageModels.useThinking ? "Take full advantage of your extended thinking to reason deeply about each opportunity before producing the final JSON." : ""}

Respond with valid JSON matching the exact schema. No markdown wrapping.`;

  const userContent = `Portfolio repos:\n${repoIndex}\n\nDraft recommendations:\n${recsText}\n\nCritique and guidance:\n${critiqueText}\n\nProduce the final best recommendations.`;

  try {
    const result = await callAI(
      {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        model: stageModels.synthesisModel,
        thinkingBudgetTokens: stageModels.useThinking ? stageModels.thinkingBudget : undefined,
        // Note: extended thinking (Anthropic) is incompatible with json_schema response_format;
        // for other providers we enforce the schema client-side via Zod.
        ...(stageModels.useThinking
          ? {}
          : { responseFormat: { type: "json_schema" as const, json_schema: { name: "recommendations", strict: true, schema: AI_JSON_SCHEMA } } }),
      },
      aiConfig,
    );
    const raw = result.content.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(raw);
    return RecommendationSchema.parse(parsed);
  } catch (e) {
    console.warn("[analysis] Synthesis failed, using draft recommendations:", e instanceof Error ? e.message : e);
    return RecommendationSchema.parse({
      recommendations: allRecommendations,
      summary_md: "Analysis complete.",
    });
  }
}

// ─── Cross-batch synthesis (multi-batch portfolios only) ─────────────────────

async function synthesizeCrossBatch(
  allRecommendations: z.infer<typeof RecommendationSchema>["recommendations"],
  digests: string[],
  aiConfig: { provider: string; apiKey: string | null },
): Promise<z.infer<typeof RecommendationSchema>["recommendations"]> {
  const repoIndex = digests
    .map((d) => {
      const repoLine = d.split("\n")[0];
      const descLine = d.split("\n").find((l) => l.startsWith("DESC:"));
      const langLine = d.split("\n").find((l) => l.startsWith("LANG:"));
      return `${repoLine} ${descLine || ""} ${langLine || ""}`;
    })
    .join("\n");

  const existingRecs = allRecommendations
    .map((r, i) => `${i + 1}. [${r.kind}] ${r.title} — repos: ${r.repos.join(", ")} — ${r.pitch}`)
    .join("\n");

  const synthPrompt = `You are reviewing a developer's GitHub portfolio of ${digests.length} repos.
Here are all the repos (compact index):
${repoIndex}

Here are the recommendations already generated:
${existingRecs}

Now perform a COMPLETION COVERAGE pass. Find viable repos in the index that do not yet have their own primary FINISH recommendation and add up to 10 missing FINISH recommendations.
Do not generate COMBINE or REPURPOSE recommendations in this pass. Do not merge repos merely because they share a stack.
Each added recommendation must map that repository's path to production-ready completion using the evidence available.

Return JSON with the same schema as before (summary_md + recommendations array).
Only include NEW FINISH recommendations that improve repo coverage. If completion coverage is already adequate, return an empty recommendations array.`;

  try {
    const result = await callAI(
      {
        messages: [
          { role: "system", content: "You are a product strategist. Always respond with valid JSON." },
          { role: "user", content: synthPrompt },
        ],
        responseFormat: { type: "json_schema", json_schema: { name: "synthesis", strict: true, schema: AI_JSON_SCHEMA } },
      },
      aiConfig,
    );
    const parsed = JSON.parse(result.content || "{}");
    const validated = RecommendationSchema.parse(parsed);
    return validated.recommendations;
  } catch {
    console.warn("[analysis] Cross-batch synthesis failed, continuing with batch results");
    return [];
  }
}

// ─── Analysis context ────────────────────────────────────────────────────────

interface AnalysisContext {
  supabase: SupabaseClient;
  userId: string;
  token: string;
  prefs: {
    custom_ai_provider: string;
    custom_ai_model: string | null;
    custom_ai_key: string | null;
    filter_max_repos: number;
    filter_languages: string[] | null;
    filter_min_stars: number;
    filter_exclude_archived: boolean;
    analysis_tier: string;
  } | null;
  triggerType: string;
  onProgress: ProgressFn;
}

async function createAnalysisRow(ctx: AnalysisContext): Promise<string> {
  const { supabase, userId, prefs, triggerType } = ctx;
  const provider = prefs?.custom_ai_provider || "google";
  const tier = prefs?.analysis_tier || "balanced";
  const models = getStageModels(provider, tier, prefs?.custom_ai_model);
  const { data: analysis, error: aErr } = await supabase
    .from("analyses")
    .insert({
      user_id: userId,
      status: "running",
      trigger_type: triggerType,
      ai_provider: provider,
      ai_model: models.synthesisModel,
    })
    .select("id")
    .single();
  if (aErr || !analysis) throw new Error(aErr?.message ?? "Failed to create analysis");
  return analysis.id;
}

// ─── Main analysis job ───────────────────────────────────────────────────────

async function runAnalysisJob(ctx: AnalysisContext, analysisId: string): Promise<void> {
  const { supabase, userId, token, prefs } = ctx;
  const tier = prefs?.analysis_tier || "balanced";

  const reportProgress: ProgressFn = async (msg: string) => {
    console.log(`[analysis ${analysisId}] ${msg}`);
    await supabase.from("analyses").update({ error: msg, updated_at: new Date().toISOString() }).eq("id", analysisId);
  };

  // The Vercel function this job runs inside has a hard maxDuration ceiling
  // (see api/[...path].mjs). Large portfolios can genuinely exceed it: when
  // that happens Vercel silently kills the invocation mid-await with no
  // exception, leaving the row frozen at whatever progress message was last
  // written until the 10-minute staleness watchdog (GET /analysis/:id) marks
  // it failed. That produced a confusing "hung, then failed for no reason"
  // experience. This budget guard fails fast and clearly instead, well before
  // the platform ceiling, so the user gets an actionable message immediately.
  const jobStartedAt = Date.now();
  const SAFE_BUDGET_MS = 660_000; // 11 min — leaves ~90s margin under the 750s function ceiling
  const assertWithinBudget = (stage: string) => {
    const elapsed = Date.now() - jobStartedAt;
    if (elapsed > SAFE_BUDGET_MS) {
      throw new Error(
        `Analysis exceeded its safe execution budget before "${stage}" (${Math.round(elapsed / 1000)}s elapsed). ` +
          `This portfolio is too large for a single run — try the "Fast" analysis tier or lower "Max repos to analyze" in Settings.`,
      );
    }
  };

  try {
    const maxRepos = prefs?.filter_max_repos || 200;

    // ── Step 1: Fetch repos ──────────────────────────────────────────────────
    await reportProgress("Fetching repos from GitHub…");
    const repos = await fetchAllRepos(token, maxRepos);

    const shortlist = applyFilters(
      repos,
      prefs
        ? {
            filter_languages: prefs.filter_languages,
            filter_min_stars: prefs.filter_min_stars,
            filter_exclude_archived: prefs.filter_exclude_archived,
            filter_max_repos: maxRepos,
          }
        : null,
    );

    if (shortlist.length < 2) {
      throw new Error(
        `Need at least 2 active repos to analyze (found ${shortlist.length} after filters). Adjust your filters or push some code!`,
      );
    }

    const provider = prefs?.custom_ai_provider || "google";
    const aiKey = prefs?.custom_ai_key || null;
    const aiConfig = { provider, model: prefs?.custom_ai_model ?? null, apiKey: aiKey };
    const stageModels = getStageModels(provider, tier, prefs?.custom_ai_model);

    if (!aiKey) {
      throw new Error(`AI provider "${provider}" has no configured API key. Configure a valid server-side or BYOK credential before running analysis.`);
    }

    await reportProgress(`Validating ${provider} / ${stageModels.profilerModel}…`);
    await withTimeout(
      callAI(
        {
          messages: [
            { role: "system", content: "Reply with exactly: ready" },
            { role: "user", content: "AI provider preflight." },
          ],
          model: stageModels.profilerModel,
        },
        aiConfig,
      ),
      15000,
      "AI provider preflight",
    );

    // ── Step 2: Profile portfolio ────────────────────────────────────────────
    await reportProgress("Profiling your portfolio…");
    const profile = await withTimeout(
      profilePortfolio(shortlist, aiConfig, stageModels),
      30000,
      "Portfolio profiling",
    );

    // Persist profile early so users can see it if they check mid-analysis
    try {
      await supabase
        .from("analyses")
        .update({
          developer_profile: profile.developer_profile,
          strategy_summary: profile.strategy_summary,
        })
        .eq("id", analysisId);
    } catch {
      // Columns may not exist yet in older schema — store in portfolio_stats instead (handled below)
    }

    // ── Step 3: Context-aware digest generation ──────────────────────────────
    await reportProgress("Building analysis strategy…");
    const customSystemPrompt = profile.custom_system_prompt;

    // Build repo → cluster map for context-aware digest hints
    const repoClusterMap = new Map<string, string>();
    for (const cluster of profile.domain_clusters) {
      for (const repoName of cluster.repos) {
        repoClusterMap.set(repoName, `${cluster.name}: ${cluster.theme}`);
      }
    }

    // ── Two-tier digesting ───────────────────────────────────────────────────
    // Tier 1 (deep): full GitHub fetch + AI context — capped by tier
    // Tier 2 (metadata): compact one-liner — no per-repo API calls
    const deepDigestLimit = tier === "fast" ? 40 : tier === "deep" ? 100 : 75;
    const compactDigest = provider === "github_models";
    const digestConcurrency = provider === "github_models" ? 5 : 10;

    // Score and partition — profile clusters boost relevance scores
    const scored = shortlist
      .map((r) => ({ repo: r, score: scoreRepo(r, repoClusterMap) }))
      .sort((a, b) => b.score - a.score);

    const deepRepos = scored.slice(0, deepDigestLimit).map((s) => s.repo);
    const metaOnlyRepos = scored.slice(deepDigestLimit).map((s) => s.repo);

    const metaOnlyLabel =
      metaOnlyRepos.length > 0
        ? ` (${deepRepos.length} deep, ${metaOnlyRepos.length} metadata-only)`
        : "";

    await reportProgress(`Digesting ${shortlist.length} repos${metaOnlyLabel}…`);

    let digested = 0;
    const digestResults = await withTimeout(
      parallelMap(deepRepos, digestConcurrency, async (repo) => {
        const clusterHint = repoClusterMap.get(repo.full_name);
        const digest = await digestRepo(repo, token, compactDigest, clusterHint);
        digested++;
        if (digested % 5 === 0 || digested === deepRepos.length) {
          await reportProgress(`Digested ${digested}/${deepRepos.length} repos…`);
        }
        return digest;
      }),
      Math.max(30000, deepRepos.length * 2000 + 10000),
      "Repo digestion",
    );

    const digests: string[] = [];
    let failedDigests = 0;
    for (let i = 0; i < digestResults.length; i++) {
      const r = digestResults[i];
      if (r.status === "fulfilled") {
        digests.push(r.value);
      } else {
        failedDigests++;
        console.error("digest failed", deepRepos[i].full_name, r.reason);
      }
    }

    // Append compact metadata block for tier-2 repos so the AI sees the full portfolio
    if (metaOnlyRepos.length > 0) {
      const metaBlock = [
        `=== ADDITIONAL REPOS — metadata only (not deeply analyzed) ===`,
        `Map these to independent FINISH paths where the metadata supports it. Do not invent COMBINE or REPURPOSE ideas from metadata alone.`,
        ...metaOnlyRepos.map(repoMetaLine),
      ].join("\n");
      digests.push(metaBlock);
    }

    if (digests.length < 2) {
      throw new Error(`Only ${digests.length} repos could be digested (${failedDigests} failed). Check GitHub API rate limits.`);
    }

    if (failedDigests > 0) {
      await reportProgress(`${failedDigests} repos failed digestion, continuing with ${digests.length}…`);
    }

    // ── Step 4: AI batch analysis ────────────────────────────────────────────
    await reportProgress(`Running AI analysis on ${digests.length} repos…`);

    const budget = maxInputTokensForProvider(provider);
    const batches = chunkDigests(digests, budget).filter((b) => b.length > 0);
    const hasMultipleBatches = batches.length > 1;
    const batchConcurrency = aiBatchConcurrency(provider);

    let batchCompleted = 0;
    let firstSummary = "";
    let failedBatches = 0;

    const batchResults = await withTimeout(
      parallelMap(batches, batchConcurrency, async (batch) => {
        const result = await callBatchedAIWithRetry(batch, customSystemPrompt, aiConfig);
        batchCompleted++;
        await reportProgress(`AI batch ${batchCompleted}/${batches.length} complete (${batch.length} repos)`);
        return result;
      }),
      Math.max(120000, Math.ceil(digests.length / 10) * 45000 + 120000),
      "AI analysis",
    );

    const draftRecommendations: z.infer<typeof RecommendationSchema>["recommendations"] = [];
    for (let i = 0; i < batchResults.length; i++) {
      const r = batchResults[i];
      if (r.status === "fulfilled") {
        draftRecommendations.push(...r.value.recommendations);
        if (!firstSummary) firstSummary = r.value.summary_md;
      } else {
        failedBatches++;
        console.error("[analysis] AI batch failed after retries", r.reason);
      }
    }

    if (draftRecommendations.length === 0) {
      throw new Error(
        failedBatches > 0
          ? `All ${failedBatches} AI batch(es) failed. The AI provider may be rate-limited — try again or switch provider.`
          : "AI analysis returned no recommendations.",
      );
    }

    if (failedBatches > 0) {
      await reportProgress(`${failedBatches}/${batches.length} batches failed, continuing with partial results…`);
    }

    // Cross-batch completion-coverage pass for portfolios spanning multiple batches
    if (hasMultipleBatches && draftRecommendations.length > 0) {
      assertWithinBudget("cross-batch completion coverage");
      await reportProgress("Checking cross-batch completion coverage…");
      const crossBatchRecs = await withTimeout(
        synthesizeCrossBatch(draftRecommendations, digests, aiConfig),
        90000,
        "Cross-batch synthesis",
      ).catch((e) => {
        // synthesizeCrossBatch already swallows its own AI-call errors and
        // returns []; this catch only guards the timeout race itself so a
        // stalled provider can't hang the job indefinitely.
        console.warn("[analysis] Cross-batch synthesis timed out, continuing with batch results:", e);
        return [];
      });
      if (crossBatchRecs.length > 0) draftRecommendations.push(...crossBatchRecs);
    }

    // ── Step 5: Self-critique pass ───────────────────────────────────────────
    assertWithinBudget("self-critique");
    await reportProgress("Self-critiquing results…");
    const repoIndex = digests
      .map((d) => {
        const repoLine = d.split("\n")[0];
        const descLine = d.split("\n").find((l) => l.startsWith("DESC:"));
        const langLine = d.split("\n").find((l) => l.startsWith("LANG:"));
        return `${repoLine} ${descLine || ""} ${langLine || ""}`;
      })
      .join("\n");

    const critique = await withTimeout(
      critiqueResults(draftRecommendations, repoIndex, aiConfig, stageModels),
      60000,
      "Self-critique",
    );

    // Persist critique
    const critiqueMd = [
      critique.gaps.length ? `**Gaps identified:** ${critique.gaps.join("; ")}` : "",
      critique.too_generic.length ? `**Made specific:** ${critique.too_generic.map((g) => g.title).join(", ")}` : "",
      critique.missed_synergies.length ? `**Added synergies:** ${critique.missed_synergies.join("; ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await supabase.from("analyses").update({ critique_md: critiqueMd }).eq("id", analysisId);
    } catch {
      // Column may not exist in older schema
    }

    // ── Step 6: Final synthesis ──────────────────────────────────────────────
    assertWithinBudget("final synthesis");
    await reportProgress("Synthesizing final insights…");
    const finalResult = await withTimeout(
      synthesizeWithReasoning(draftRecommendations, critique, repoIndex, aiConfig, stageModels),
      120000,
      "Final synthesis",
    );

    finalResult.portfolio_stats = computePortfolioStats(shortlist);

    const ranked = [...finalResult.recommendations].sort(
      (a, b) => b.market_potential * 2 - b.effort - (a.market_potential * 2 - a.effort),
    );

    const rows = ranked.map((r, i) => ({
      analysis_id: analysisId,
      user_id: userId,
      kind: r.kind,
      title: r.title,
      repos: r.repos,
      pitch: r.pitch,
      effort: Math.max(1, Math.min(5, r.effort)),
      market_potential: Math.max(1, Math.min(5, r.market_potential)),
      next_steps: r.next_steps,
      tech_stack: r.tech_stack ?? [],
      marketing_tweet: r.marketing_tweet ?? null,
      marketing_linkedin: r.marketing_linkedin ?? null,
      estimated_hours: r.estimated_hours ?? null,
      rank: i,
    }));

    if (rows.length) {
      const { error: iErr } = await supabase.from("analysis_items").insert(rows);
      if (iErr) throw new Error(iErr.message);
    }

    // Store profile metadata in portfolio_stats for forward-compatibility
    // (in case the new text columns don't exist yet)
    const portfolioStats = {
      ...finalResult.portfolio_stats,
      _strategy: {
        developer_profile: profile.developer_profile,
        domain_clusters: profile.domain_clusters,
        strategy_summary: profile.strategy_summary,
        critique_summary: critiqueMd,
        analysis_tier: tier,
        profiler_model: stageModels.profilerModel,
        synthesis_model: stageModels.synthesisModel,
        generated_system_prompt: customSystemPrompt,
        deep_digest_count: deepRepos.length,
        metadata_only_count: metaOnlyRepos.length,
        total_repos_seen: shortlist.length,
      },
    };

    const updatePayload: Record<string, unknown> = {
      status: "complete",
      repo_count: shortlist.length,
      analyzed_repo_names: shortlist.map((r: Repo) => r.full_name),
      summary_md: finalResult.summary_md,
      portfolio_stats: portfolioStats,
      completed_at: new Date().toISOString(),
      error: null,
    };

    // Opportunistically write to new schema columns if they exist
    try {
      await supabase
        .from("analyses")
        .update({
          ...updatePayload,
          developer_profile: profile.developer_profile,
          generated_system_prompt: customSystemPrompt,
          critique_md: critiqueMd,
          strategy_summary: profile.strategy_summary,
        })
        .eq("id", analysisId);
    } catch {
      // New columns may not exist yet — fall back to base update without them
      await supabase.from("analyses").update(updatePayload).eq("id", analysisId);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Analysis failed";
    console.error(`[analysis ${analysisId}] failed:`, msg);
    captureException(e, {
      tags: { subsystem: "analysis", analysis_id: analysisId },
      extra: { message: msg },
    });
    await supabase.from("analyses").update({ status: "failed", error: msg, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", analysisId);
    await flushSentry();
  }
}

function startAnalysisJob(ctx: AnalysisContext, analysisId: string): void {
  const job = runAnalysisJob(ctx, analysisId).catch(async (e) => {
    console.error(`[analysis ${analysisId}] unexpected background error:`, e);
    const msg = e instanceof Error ? e.message : "Analysis worker stopped unexpectedly";
    captureException(e, {
      tags: { subsystem: "analysis-worker", analysis_id: analysisId },
      extra: { message: msg },
    });
    await ctx.supabase
      .from("analyses")
      .update({ status: "failed", error: msg, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", analysisId);
    await flushSentry();
  });

  runInBackground(job, "analysis-job");
}

async function getAnalysisContext(supabase: SupabaseClient, userId: string, triggerType: string): Promise<AnalysisContext> {
  const credential = requireGithubCredential(await loadGithubCredential(supabase, userId));

  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("custom_ai_provider, custom_ai_key, filter_max_repos, filter_languages, filter_min_stars, filter_exclude_archived, analysis_tier")
    .eq("user_id", userId)
    .maybeSingle();

  const noopProgress: ProgressFn = async () => {};
  const aiCredential = await loadAiCredential(supabase, userId, credential.token);
  const normalizedPrefs: AnalysisContext["prefs"] = {
    custom_ai_provider: aiCredential.provider,
    // loadAiCredential already resolved the user's saved model, falling back to
    // the platform default for the provider. Carrying it here keeps the analysis
    // stages on the configured model instead of a hardcoded per-provider guess.
    custom_ai_model: aiCredential.model,
    custom_ai_key: aiCredential.apiKey,
    filter_max_repos: prefs?.filter_max_repos ?? 200,
    filter_languages: prefs?.filter_languages ?? null,
    filter_min_stars: prefs?.filter_min_stars ?? 0,
    filter_exclude_archived: prefs?.filter_exclude_archived ?? true,
    analysis_tier: prefs?.analysis_tier ?? "balanced",
  };

  return {
    supabase,
    userId,
    token: credential.token,
    prefs: normalizedPrefs,
    triggerType,
    onProgress: noopProgress,
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.post(
  "/analysis/run",
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await getAnalysisContext(req.supabase!, req.userId!, "manual");
    const analysisId = await createAnalysisRow(ctx);
    startAnalysisJob(ctx, analysisId);
    res.json({ id: analysisId });
  }),
);

router.get(
  "/analysis",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { data, error } = await req.supabase!
      .from("analyses")
      .select("id, status, repo_count, created_at, error, trigger_type, ai_provider")
      .eq("user_id", req.userId!)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    res.json(data ?? []);
  }),
);

router.get(
  "/analysis/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { data: analysis, error } = await req.supabase!
      .from("analyses")
      .select("*")
      .eq("id", id)
      .eq("user_id", req.userId!)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!analysis) throw Object.assign(new Error("Analysis not found"), { status: 404 });

    if (
      analysis.status === "running" &&
      analysis.updated_at &&
      Date.now() - new Date(analysis.updated_at as string).getTime() > 10 * 60 * 1000
    ) {
      const staleMessage = "Analysis worker stopped reporting progress for more than 10 minutes. Rerun the analysis.";
      const now = new Date().toISOString();
      await req.supabase!
        .from("analyses")
        .update({ status: "failed", error: staleMessage, completed_at: now, updated_at: now })
        .eq("id", id)
        .eq("user_id", req.userId!);
      analysis.status = "failed";
      analysis.error = staleMessage;
      analysis.completed_at = now;
      analysis.updated_at = now;
    }

    const { data: items } = await req.supabase!
      .from("analysis_items")
      .select("*")
      .eq("analysis_id", id)
      .order("rank", { ascending: true });

    res.json({ analysis, items: items ?? [] });
  }),
);

router.delete(
  "/analysis/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const userId = req.userId!;

    const { error: itemsErr } = await req.supabase!.from("analysis_items").delete().eq("analysis_id", id).eq("user_id", userId);
    if (itemsErr) throw new Error(itemsErr.message);

    const { error: aErr } = await req.supabase!.from("analyses").delete().eq("id", id).eq("user_id", userId);
    if (aErr) throw new Error(aErr.message);

    res.json({ success: true });
  }),
);

router.post(
  "/analysis/:id/share",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { isPublic } = z.object({ isPublic: z.boolean() }).parse(req.body);
    const userId = req.userId!;

    let slug: string | null = null;
    if (isPublic) {
      slug = Array.from({ length: 10 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
    }

    const { data: updated, error } = await req.supabase!
      .from("analyses")
      .update({ is_public: isPublic, share_slug: isPublic ? slug : null, share_expires_at: null })
      .eq("id", id)
      .eq("user_id", userId)
      .select("id, is_public, share_slug")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!updated) throw Object.assign(new Error("Analysis not found"), { status: 404 });

    res.json({ isPublic: updated.is_public as boolean, slug: updated.share_slug as string | null });
  }),
);

router.post(
  "/analysis/:id/rerun",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const ctx = await getAnalysisContext(req.supabase!, req.userId!, "rerun");

    const { data: original, error: origErr } = await req.supabase!
      .from("analyses")
      .select("id")
      .eq("id", id)
      .eq("user_id", req.userId!)
      .maybeSingle();
    if (origErr) throw new Error(origErr.message);
    if (!original) throw Object.assign(new Error("Analysis not found"), { status: 404 });

    const analysisId = await createAnalysisRow(ctx);
    startAnalysisJob(ctx, analysisId);
    res.json({ id: analysisId });
  }),
);

router.post(
  "/analysis/:id/action-plan",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const userId = req.userId!;

    const { data: items, error: itemsErr } = await req.supabase!
      .from("analysis_items")
      .select("title, kind, repos, pitch, effort, market_potential, next_steps, tech_stack, rank")
      .eq("analysis_id", id)
      .eq("user_id", userId)
      .order("rank", { ascending: true });
    if (itemsErr) throw new Error(itemsErr.message);
    if (!items || items.length === 0) throw Object.assign(new Error("No recommendations found for this analysis."), { status: 400 });

    const githubCredential = await loadGithubCredential(req.supabase!, userId);
    const aiConfig = await loadAiCredential(req.supabase!, userId, githubCredential?.token ?? null);

    const recsText = items
      .map(
        (r, i) =>
          `${i + 1}. [${r.kind}] ${r.title} (effort: ${r.effort}/5, market: ${r.market_potential}/5)\n   Repos: ${(r.repos as string[]).join(", ")}\n   Pitch: ${r.pitch}\n   Next steps: ${(r.next_steps as string[]).join("; ")}`,
      )
      .join("\n\n");

    const prompt = `You are a product strategist. Given these repo recommendations, create a phased action plan.

Recommendations:
${recsText}

Return JSON with this exact shape:
{
  "total_weeks": number,
  "phases": [
    {
      "name": string,
      "duration_weeks": number,
      "items": [
        { "title": string, "recommendation_index": number, "why_now": string, "key_deliverable": string }
      ]
    }
  ],
  "quick_wins": [string],
  "moonshots": [string],
  "dependencies": [ { "from_title": string, "to_title": string, "reason": string } ]
}

Sequence phases from quick wins (low effort, high impact) to moonshots. Group related items. Be practical.`;

    const result = await callAI(
      {
        messages: [
          { role: "system", content: "You are a helpful product strategist assistant. Always respond with valid JSON." },
          { role: "user", content: prompt },
        ],
      },
      aiConfig,
    );

    res.json(JSON.parse(result.content || "{}"));
  }),
);

router.post(
  "/analysis/:id/merge-instructions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { itemRank } = z.object({ itemRank: z.number().int().min(0) }).parse(req.body);
    const userId = req.userId!;

    const { data: item, error: itemErr } = await req.supabase!
      .from("analysis_items")
      .select("title, repos, pitch, next_steps, tech_stack")
      .eq("analysis_id", id)
      .eq("user_id", userId)
      .eq("rank", itemRank)
      .maybeSingle();
    if (itemErr) throw new Error(itemErr.message);
    if (!item) throw Object.assign(new Error("Recommendation not found."), { status: 404 });

    const githubCredential = await loadGithubCredential(req.supabase!, userId);
    const aiConfig = await loadAiCredential(req.supabase!, userId, githubCredential?.token ?? null);

    const repos = (item.repos as string[]) || [];
    const techStack = (item.tech_stack as string[]) || [];

    const prompt = `You are a senior engineer. Generate step-by-step git merge instructions for combining these repos into one.

Repos to merge: ${repos.join(", ")}
Tech stack: ${techStack.join(", ") || "unknown"}
Pitch: ${item.pitch}
Next steps: ${((item.next_steps as string[]) || []).join("; ")}

Return JSON with this exact shape:
{
  "instructions": "step-by-step shell commands and explanation as a markdown string",
  "newRepoName": "suggested name for the merged repo",
  "newRepoUrl": "placeholder URL (e.g. https://github.com/user/new-repo)",
  "primaryRepo": "which repo should be the base/primary",
  "mergedRepos": ["list", "of", "all", "repos", "being", "merged"]
}

Include actual git commands (clone, remote add, merge --allow-unrelated-histories, etc). Be specific about conflict resolution strategy.`;

    const result = await callAI(
      {
        messages: [
          { role: "system", content: "You are a helpful senior engineer. Always respond with valid JSON." },
          { role: "user", content: prompt },
        ],
      },
      aiConfig,
    );

    res.json(JSON.parse(result.content || "{}"));
  }),
);

export default router;
