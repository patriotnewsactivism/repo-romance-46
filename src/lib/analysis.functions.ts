import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAI } from "@/lib/ai-provider";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";


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
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".rb",
  ".java",
  ".swift",
  ".kt",
  ".vue",
  ".svelte",
  ".css",
  ".sql",
]);

// ─── Concurrency-limited parallel runner ───────────────────────
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

// ─── Parse package.json / pyproject.toml for dependencies ──────
function extractDepsFromPackageJson(text: string): string[] {
  try {
    const pkg = JSON.parse(text);
    const deps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
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
      for (const m of matches.slice(0, 30)) {
        deps.push(m.replace(/["']/g, ""));
      }
    }
  }
  return deps;
}

// ─── Digest a single repo into a text summary for the AI ───────
async function digestRepo(
  repo: Repo,
  token: string,
  compact = false,
): Promise<string> {
  const parts: string[] = [];
  parts.push(`REPO: ${repo.full_name}`);
  if (repo.description) parts.push(`DESC: ${repo.description}`);
  parts.push(
    `LANG: ${repo.language ?? "?"} · stars: ${repo.stargazers_count} · forks: ${repo.forks_count ?? 0} · pushed: ${repo.pushed_at} · size: ${repo.size}KB`,
  );
  if (repo.topics?.length) parts.push(`TOPICS: ${repo.topics.join(", ")}`);
  if (repo.homepage) parts.push(`HOMEPAGE: ${repo.homepage}`);
  if (repo.license?.name) parts.push(`LICENSE: ${repo.license.name}`);

  // README
  const readmeChars = compact ? 200 : 3000;
  const readme = await ghText(`/repos/${repo.full_name}/readme`, token);
  if (readme) parts.push(`README:\n${readme.slice(0, readmeChars)}`);

  // File tree — handle truncated trees
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
    // Skip on error — try non-recursive as fallback
    try {
      const treeRes = await gh<{ tree: TreeEntry[] }>(
        `/repos/${repo.full_name}/git/trees/${repo.default_branch}`,
        token,
      );
      tree = treeRes.tree.filter((t) => t.type === "blob");
    } catch {
      // give up on tree
    }
  }

  const paths = tree.map((t) => t.path);
  const topFiles = compact ? 12 : 80;
  parts.push(
    `FILES (${paths.length} total, top ${Math.min(topFiles, paths.length)}):\n${paths.slice(0, topFiles).join("\n")}`,
  );

  // Detect key files to sample
  const toSample = new Set<string>();

  // Always include package.json / pyproject.toml for dependency detection
  for (const kf of KEY_FILES) {
    if (paths.includes(kf)) toSample.add(kf);
  }

  // Sample largest source files
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
    .slice(0, compact ? 1 : 6)
    .map((t) => t.path);
  for (const p of sourceFiles) toSample.add(p);

  const samplePaths = Array.from(toSample).slice(0, compact ? 2 : 10);

  // Parallel fetch of key files
  const fileResults = await Promise.all(
    samplePaths.map((p) => ghText(`/repos/${repo.full_name}/contents/${encodeURIComponent(p)}`, token)),
  );

  let sampledBytes = 0;
  const BUDGET = compact ? 400 : 12000;
  const maxFileSlice = compact ? 300 : 2000;

  for (let i = 0; i < fileResults.length; i++) {
    if (sampledBytes >= BUDGET) break;
    const text = fileResults[i];
    if (!text) continue;
    const fname = samplePaths[i];

    // Parse dependencies from package.json / pyproject.toml
    if (fname === "package.json") {
      const deps = extractDepsFromPackageJson(text);
      if (deps.length) {
        parts.push(`DEPENDENCIES (package.json): ${deps.join(", ")}`);
        // Still include a slice but smaller since we extracted deps
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

// ─── Token budgeting / chunking ────────────────────────────────

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

function maxInputTokensForProvider(provider: string): number {
  switch (provider) {
    case "github_models":
      return 4000; // GitHub Models free tier caps at 8k total — leave room for system prompt + output
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
  const mostActive = [...shortlist].sort(
    (a, b) => new Date(b.pushed_at).getTime() - new Date(a.pushed_at).getTime(),
  )[0];
  const sixMonthsAgo = Date.now() - 1000 * 60 * 60 * 24 * 30 * 6;
  const dormant = shortlist
    .filter((r) => new Date(r.pushed_at).getTime() < sixMonthsAgo)
    .map((r) => r.full_name);
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

// ─── Apply user filters to the repo shortlist ──────────────────
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
    shortlist = shortlist.filter(
      (r) => r.language && prefs.filter_languages!.includes(r.language),
    );
  }
  if (prefs.filter_min_stars > 0) {
    shortlist = shortlist.filter((r) => r.stargazers_count >= prefs.filter_min_stars);
  }
  return shortlist.slice(0, prefs.filter_max_repos || 50);
}

// ─── Fetch repos with pagination ───────────────────────────────
async function fetchAllRepos(token: string, maxRepos: number): Promise<Repo[]> {
  const allRepos: Repo[] = [];
  let page = 1;
  const perPage = 100;
  // Cap pages to avoid excessive API calls — 5 pages = 500 repos max
  const maxPages = Math.min(Math.ceil(maxRepos / perPage) + 1, 5);

  while (page <= maxPages) {
    const batch = await withTimeout(
      gh<Repo[]>(`/user/repos?per_page=${perPage}&page=${page}&affiliation=owner&sort=pushed`, token),
      20000,
      `GitHub repo fetch (page ${page})`,
    );
    if (!batch || batch.length === 0) break;
    allRepos.push(...batch);
    if (batch.length < perPage) break; // no more pages
    page++;
  }
  return allRepos;
}

// ─── Zod schema for AI recommendations ─────────────────────────
const RecommendationSchema = z.object({
  recommendations: z.array(
    z.object({
      kind: z.string().transform(v => v.toLowerCase() as "finish" | "combine" | "repurpose").pipe(z.enum(["finish", "combine", "repurpose"])),
      title: z.string(),
      repos: z.array(z.string()),
      pitch: z.string(),
      effort: z.number().int(),
      market_potential: z.number().int(),
      next_steps: z.array(z.string()),
      tech_stack: z
        .array(z.string())
        .nullish()
        .transform((v) => v ?? []),
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
    .default({
      total_repos: 0,
      languages: [],
      total_stars: 0,
      dormant_repos: [],
    }),
});

// ─── AI system prompt ──────────────────────────────────────────
const AI_SYSTEM_PROMPT = `You are a rigorous, skeptical product strategist evaluating a developer's GitHub portfolio. You are NOT a hype person — you are a discerning evaluator who only recommends repos with genuine potential.

## EVALUATION CRITERIA — apply these STRICTLY

Before recommending any repo, verify it meets these quality bars:

### MATURITY ASSESSMENT (evaluate each repo):
- SKELETON: <5 files, mostly boilerplate, no real logic → DO NOT recommend
- EARLY: 5-20 files, some logic but incomplete → Only FINISH if there's a clear path
- DEVELOPING: 20+ files, real functionality, some gaps → Good FINISH candidate
- MATURE: Complete codebase, tests, CI → Only REPURPOSE if market fit is strong
- ABANDONED: No push in 6+ months → Only recommend if code is still relevant

### FINISH criteria (MUST meet ALL):
1. The repo has actual executable code (not just config/README)
2. There is a clear, specific gap between current state and shippable
3. The gap is closeable in <40 hours of work
4. The finished product has an identifiable target user
5. You can name the SPECIFIC files that need work (not "improve the UI")

### COMBINE criteria (MUST meet ALL):
1. The repos share a compatible tech stack OR solve adjacent problems
2. The combination creates something NEITHER repo could do alone
3. You can describe the specific integration point (API contract, shared data model, etc.)
4. The combined product has a clearer market position than either repo individually
5. Do NOT combine repos just because they're in the same language — that's not synergy

### REPURPOSE criteria (MUST meet ALL):
1. The repo has real, working code that solves an internal problem
2. That code can be positioned for an EXTERNAL audience with minimal changes
3. You can name the specific target market and why they'd pay
4. The repurposing is plausible — not "turn a CLI tool into a SaaS platform" unless there's real evidence

## OUTPUT REQUIREMENTS

For each recommendation:
- kind, title (5-8 words, specific — not "Finish Your App" but "Add Auth & Deploy Quantum API")
- repos (full_name array — use the EXACT full_name from the digest, no guessing)
- pitch (2-3 sentences: WHO is the target user, WHAT value does it provide, WHY now)
- effort (1=hours, 5=months — be honest, most repos are 3-4)
- market_potential (1=niche hobby, 5=broad commercial — be conservative, most are 2-3)
- next_steps (3-5 concrete todos — each must reference a SPECIFIC file, function, or feature from the digest)
- tech_stack (array — only include technologies you can VERIFY from the digest: dependencies, file extensions, imports)
- marketing_tweet (punchy, 280 chars max, with relevant hashtags)
- marketing_linkedin (3-4 sentences: hook + value prop + CTA)
- estimated_hours (realistic, 1-500 — do not underestimate)

Also produce:
- summary_md (markdown, ~200 words) — assess portfolio maturity, note patterns, call out dead weight

Return ONLY 3-7 recommendations. Quality over quantity. If you can only find 3 genuine opportunities, return 3 — do NOT pad with weak suggestions.

Rank by (market_potential * 2 - effort) desc.

Every recommendation MUST reference specific files, functions, or features you actually saw in the digests. If you can't cite specific evidence, don't make the recommendation.

IMPORTANT: In your JSON output, use lowercase for the "kind" field: "finish", "combine", or "repurpose".`;

// JSON schema for structured output (OpenAI-compatible providers)
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

async function callBatchedAI(
  digests: string[],
  aiConfig: { provider: string; apiKey: string | null },
): Promise<z.infer<typeof RecommendationSchema>> {
  // Include a compact repo index at the top so the AI can see all repos at a glance
  const repoIndex = digests
    .map((d) => {
      const lines = d.split("\n");
      const repoLine = lines[0]; // REPO: owner/name
      const descLine = lines.find((l) => l.startsWith("DESC:"));
      const langLine = lines.find((l) => l.startsWith("LANG:"));
      const filesLine = d.match(/FILES \((\d+) total/);
      const fileCount = filesLine ? filesLine[1] : "?";
      return `${repoLine} | ${langLine || ""} | ${fileCount} files | ${descLine || ""}`;
    })
    .join("\n");

  const user = `REPO INDEX (${digests.length} repos):
${repoIndex}

FULL DIGESTS:

${digests.join("\n\n=========\n\n")}`;

  let aiResult;
  try {
    aiResult = await callAI(
      {
        messages: [
          { role: "system", content: AI_SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: "recommendations",
            strict: true,
            schema: AI_JSON_SCHEMA,
          },
        },
      },
      aiConfig,
    );
  } catch (e) {
    // If structured output fails, retry without responseFormat (some providers don't support it)
    console.warn("[analysis] Structured output failed, retrying without schema:", e);
    aiResult = await callAI(
      {
        messages: [
          { role: "system", content: AI_SYSTEM_PROMPT + "\n\nIMPORTANT: Return ONLY valid JSON, no markdown, no code fences." },
          { role: "user", content: user },
        ],
      },
      aiConfig,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(aiResult.content || "{}");
  } catch {
    // Try to extract JSON from markdown code fences
    const jsonMatch = aiResult.content?.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[1]);
    } else {
      throw new Error("AI returned non-JSON content — could not parse recommendations.");
    }
  }

  // Gemini sometimes returns a bare array instead of {recommendations: [...]}
  const normalized = Array.isArray(parsed) ? { recommendations: parsed, summary_md: "" } : parsed;
  const result = RecommendationSchema.parse(normalized);

  // Post-filter: remove weak recommendations that don't meet quality bars
  const validRepoNames = new Set(digests.map((d) => d.split("\n")[0].replace("REPO: ", "")));
  result.recommendations = result.recommendations.filter((rec) => {
    // Must reference at least one repo that actually exists in the digests
    const repoMatch = rec.repos.some((r) => validRepoNames.has(r) || validRepoNames.has(r.toLowerCase()));
    if (!repoMatch) {
      console.warn(`[analysis] Filtering out recommendation "${rec.title}" — references unknown repos: ${rec.repos.join(", ")}`);
      return false;
    }
    // Reject if pitch is too generic (< 40 chars)
    if (rec.pitch.length < 40) return false;
    // Reject if next_steps are all generic (no file names or specific features)
    const hasSpecificSteps = rec.next_steps.some((s) =>
      /\b(src\/|lib\/|app\/|api\/|\.ts|\.tsx|\.js|\.jsx|\.py|\.go|\.rs|component|route|endpoint|function|class|test|config|docker|ci|workflow)\b/i.test(s)
    );
    if (!hasSpecificSteps && rec.next_steps.length > 0) {
      console.warn(`[analysis] Filtering out recommendation "${rec.title}" — next_steps are too generic`);
      return false;
    }
    return true;
  });

  return result;
}


// ─── Cross-batch synthesis: find combine opportunities across batches ──
async function synthesizeCrossBatch(
  allRecommendations: z.infer<typeof RecommendationSchema>["recommendations"],
  digests: string[],
  aiConfig: { provider: string; apiKey: string | null },
): Promise<z.infer<typeof RecommendationSchema>["recommendations"]> {
  // Only run synthesis if there are existing combine recs or if we had multiple batches
  // Build a compact index of all repos for the AI to reference
  const repoIndex = digests
    .map((d) => {
      const repoLine = d.split("\n")[0]; // REPO: owner/name
      const descLine = d.split("\n").find((l) => l.startsWith("DESC:"));
      const langLine = d.split("\n").find((l) => l.startsWith("LANG:"));
      return `${repoLine} ${descLine || ""} ${langLine || ""}`;
    })
    .join("\n");

  const existingRecs = allRecommendations
    .map((r, i) => `${i + 1}. [${r.kind}] ${r.title} — repos: ${r.repos.join(", ")} — ${r.pitch}`)
    .join("\n");

  const synthPrompt = `You are a rigorous product strategist doing a SECOND PASS over a developer's GitHub portfolio.
You previously generated recommendations for batches of repos. Now look ACROSS batches for combination opportunities that were missed.

Here are all ${digests.length} repos (compact index):
${repoIndex}

Here are the recommendations already generated:
${existingRecs}

Find 0-3 ADDITIONAL "combine" recommendations where repos from DIFFERENT batches form a stronger product together.

STRICT CRITERIA — only include a recommendation if ALL are true:
1. The repos are from different batches (not already paired above)
2. The repos share compatible tech stacks or solve adjacent problems
3. The combination creates something NEITHER repo could do alone
4. You can describe the specific integration point
5. The target user and market are clear

Do NOT:
- Combine repos just because they're the same language
- Suggest vague "integrate these" without explaining HOW
- Include more than 3 recommendations
- Duplicate any existing recommendation

If you cannot find genuine cross-batch opportunities, return an EMPTY recommendations array. Quality over quantity.

Return JSON with: summary_md (string) + recommendations array (same schema as before).`;

  try {
    const result = await callAI(
      {
        messages: [
          { role: "system", content: "You are a product strategist. Always respond with valid JSON." },
          { role: "user", content: synthPrompt },
        ],
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: "synthesis",
            strict: true,
            schema: AI_JSON_SCHEMA,
          },
        },
      },
      aiConfig,
    );
    const parsed = JSON.parse(result.content || "{}");
    const normalized = Array.isArray(parsed) ? { recommendations: parsed, summary_md: "" } : parsed;
    const validated = RecommendationSchema.parse(normalized);
    return validated.recommendations;
  } catch {
    // Synthesis is best-effort — don't fail the whole analysis if it errors
    console.warn("[analysis] Cross-batch synthesis failed, continuing with batch results");
    return [];
  }
}

// ─── Batched AI runner with synthesis ──────────────────────────
async function runBatchedAI(
  digests: string[],
  aiConfig: { provider: string; apiKey: string | null },
  onProgress?: ProgressFn,
): Promise<z.infer<typeof RecommendationSchema>> {
  const budget = maxInputTokensForProvider(aiConfig.provider);
  const batches = chunkDigests(digests, budget);
  const hasMultipleBatches = batches.length > 1;

  const allRecommendations: z.infer<typeof RecommendationSchema>["recommendations"] = [];
  let summaryMd = "";

  for (let i = 0; i < batches.length; i++) {
    if (batches[i].length === 0) continue;
    if (onProgress) await onProgress(`AI batch ${i + 1}/${batches.length} (${batches[i].length} repos)`);
    const result = await callBatchedAI(batches[i], aiConfig);
    allRecommendations.push(...result.recommendations);
    if (i === 0) summaryMd = result.summary_md;
    // Inter-batch pacing — 4s for GitHub Models (balances rate limits vs timeout), 3s others
    if (i < batches.length - 1) {
      const delay = aiConfig.provider === "github_models" ? 4000 : 3000;
      await sleep(delay);
    }
  }

  // Cross-batch synthesis: find combine opportunities across batches
  if (hasMultipleBatches && allRecommendations.length > 0 && onProgress) {
    await onProgress("Synthesizing cross-batch opportunities…");
    const crossBatchRecs = await synthesizeCrossBatch(allRecommendations, digests, aiConfig);
    if (crossBatchRecs.length > 0) {
      allRecommendations.push(...crossBatchRecs);
    }
  }

  return RecommendationSchema.parse({
    recommendations: allRecommendations,
    summary_md: summaryMd || "Analysis complete.",
  });
}

// ─── Shared analysis core (used by runAnalysis + rerunAnalysis) ─
export interface AnalysisContext {
  supabase: SupabaseClient<Database>;
  userId: string;
  token: string;
  prefs: {
    custom_ai_provider: string;
    custom_ai_key: string | null;
    filter_max_repos: number;
    filter_languages: string[] | null;
    filter_min_stars: number;
    filter_exclude_archived: boolean;
  } | null;
  triggerType: string;
  onProgress: ProgressFn;
}

export async function executeAnalysis(ctx: AnalysisContext): Promise<{ id: string }> {
  const { supabase, userId, token, prefs, triggerType, onProgress } = ctx;

  // Resolve AI provider early — server key overrides github_models default
  const serverProvider = process.env.SERVER_AI_PROVIDER;
  const serverKey = process.env.SERVER_AI_KEY;
  const resolvedProvider =
    prefs?.custom_ai_key ? (prefs.custom_ai_provider || "openai")
    : serverProvider && serverKey ? serverProvider
    : prefs?.custom_ai_provider || "github_models";

  // Insert pending analysis
  const { data: analysis, error: aErr } = await supabase
    .from("analyses")
    .insert({
      user_id: userId,
      status: "running",
      trigger_type: triggerType,
      ai_provider: resolvedProvider,
      ai_model: resolvedProvider === "github_models" ? "gpt-4o-mini" : resolvedProvider === "google" ? "gemini-2.5-flash" : resolvedProvider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o",
    })
    .select("id")
    .single();
  if (aErr || !analysis) throw new Error(aErr?.message ?? "Failed to create analysis");
  const analysisId = analysis.id;

  // Wrap progress to also persist to DB
  const reportProgress: ProgressFn = async (msg: string) => {
    console.log(`[analysis ${analysisId}] ${msg}`);
    await supabase
      .from("analyses")
      .update({ error: msg })
      .eq("id", analysisId);
  };

  try {
    const maxRepos = prefs?.filter_max_repos || 50;

    await reportProgress("Fetching repos from GitHub…");
    const repos = await fetchAllRepos(token, maxRepos);

    // Apply user filters (language, stars, archived)
    const shortlist = applyFilters(repos, prefs
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

    await reportProgress(`Digesting ${shortlist.length} repos (parallel)…`);

    const provider = resolvedProvider;
    const compactDigest = provider === "github_models";

    // Scale concurrency: GitHub Models has tighter rate limits
    const concurrency = provider === "github_models" ? 5 : 8;

    let digested = 0;
    const digestResults = await withTimeout(
      parallelMap(shortlist, concurrency, async (repo) => {
        const digest = await digestRepo(repo, token, compactDigest);
        digested++;
        if (digested % 5 === 0 || digested === shortlist.length) {
          await reportProgress(`Digested ${digested}/${shortlist.length} repos…`);
        }
        return digest;
      }),
      // Scale timeout: 2s per repo + 10s baseline
      Math.max(30000, shortlist.length * 2000 + 10000),
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
        console.error("digest failed", shortlist[i].full_name, r.reason);
      }
    }


    if (digests.length < 2) {
      throw new Error(
        `Only ${digests.length} repos could be digested (${failedDigests} failed). Check GitHub API rate limits.`,
      );
    }

    if (failedDigests > 0) {
      await reportProgress(`${failedDigests} repos failed digestion, continuing with ${digests.length}…`);
    }

    // Resolve AI key
    let aiKey = prefs?.custom_ai_key || null;
    if (!aiKey && serverKey && serverProvider && provider === serverProvider) {
      aiKey = serverKey;
    }
    if (provider === "github_models" && !aiKey) {
      aiKey = token;
    }
    const aiConfig = { provider, apiKey: aiKey };

    await reportProgress(`Running AI analysis on ${digests.length} repos…`);

    const ai = await withTimeout(
      runBatchedAI(digests, aiConfig, reportProgress),
      // Scale timeout: GitHub Models free tier is rate-limited (15 RPM for gpt-4o-mini)
      // so needs generous timeout. 45s per batch + 120s baseline + 60s for synthesis.
      Math.max(180000, Math.ceil(digests.length / 3) * 45000 + 180000),
      "AI analysis",
    );
    ai.portfolio_stats = computePortfolioStats(shortlist);

    // Rank and persist
    const ranked = [...ai.recommendations].sort(
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

    await supabase
      .from("analyses")
      .update({
        status: "complete",
        repo_count: shortlist.length,
        analyzed_repo_names: shortlist.map((r: Repo) => r.full_name),
        summary_md: ai.summary_md,
        portfolio_stats: ai.portfolio_stats,
        completed_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", analysisId);

    return { id: analysisId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Analysis failed";
    await supabase.from("analyses").update({ status: "failed", error: msg }).eq("id", analysisId);
    throw new Error(msg);
  }
}

// ─── Helper: get GitHub connection + prefs for a user ───────────
async function getAnalysisContext(
  supabase: SupabaseClient<Database>,
  userId: string,
  triggerType: string,

): Promise<AnalysisContext> {
  const { data: conn } = await supabase
    .from("github_connections")
    .select("access_token, github_login")
    .eq("user_id", userId)
    .maybeSingle();
  if (!conn) throw new Error("Connect GitHub first.");

  const { data: prefs } = await supabase
    .from("user_preferences")
    .select(
      "custom_ai_provider, custom_ai_key, filter_max_repos, filter_languages, filter_min_stars, filter_exclude_archived",
    )
    .eq("user_id", userId)
    .maybeSingle();

  // Placeholder onProgress — replaced in executeAnalysis
  const noopProgress: ProgressFn = async () => {};

  return {
    supabase,
    userId,
    token: conn.access_token,
    prefs: prefs as AnalysisContext["prefs"],
    triggerType,
    onProgress: noopProgress,
  };
}

// ═══════════════════════════════════════════════════════════════
//  SERVER FUNCTIONS (exports)
// ═══════════════════════════════════════════════════════════════

// ─── runAnalysis ────────────────────────────────────────────────
export const runAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = await getAnalysisContext(context.supabase, context.userId, "manual");
    return executeAnalysis(ctx);
  });

// ─── listAnalyses ───────────────────────────────────────────────
export const listAnalyses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("analyses")
      .select("id, status, repo_count, created_at, error, trigger_type, ai_provider")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ─── getAnalysis ────────────────────────────────────────────────
export const getAnalysis = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: analysis, error } = await context.supabase
      .from("analyses")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!analysis) throw new Error("Analysis not found");

    const { data: items } = await context.supabase
      .from("analysis_items")
      .select("*")
      .eq("analysis_id", data.id)
      .order("rank", { ascending: true });

    return { analysis, items: items ?? [] };
  });

// ─── deleteAnalysis ─────────────────────────────────────────────
export const deleteAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    const { error: itemsErr } = await supabase
      .from("analysis_items")
      .delete()
      .eq("analysis_id", data.id)
      .eq("user_id", userId);
    if (itemsErr) throw new Error(itemsErr.message);

    const { error: aErr } = await supabase
      .from("analyses")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (aErr) throw new Error(aErr.message);

    return { success: true };
  });

// ─── toggleShare ────────────────────────────────────────────────
export const toggleShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { id: string; isPublic: boolean }) =>
      z.object({ id: z.string().uuid(), isPublic: z.boolean() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    let slug: string | null = null;

    if (data.isPublic) {
      slug = Array.from({ length: 10 }, () =>
        "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)],
      ).join("");
    }

    const { data: updated, error } = await supabase
      .from("analyses")
      .update({
        is_public: data.isPublic,
        share_slug: data.isPublic ? slug : null,
        share_expires_at: null,
      })
      .eq("id", data.id)
      .eq("user_id", userId)
      .select("id, is_public, share_slug")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!updated) throw new Error("Analysis not found");

    return {
      isPublic: updated.is_public as boolean,
      slug: updated.share_slug as string | null,
    };
  });

// ─── rerunAnalysis ──────────────────────────────────────────────
export const rerunAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { analysisId: string }) =>
      z.object({ analysisId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const ctx = await getAnalysisContext(context.supabase, context.userId, "rerun");

    // Verify the original analysis exists
    const { data: original, error: origErr } = await context.supabase
      .from("analyses")
      .select("id")
      .eq("id", data.analysisId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (origErr) throw new Error(origErr.message);
    if (!original) throw new Error("Analysis not found");

    return executeAnalysis(ctx);
  });

// ─── getPublicAnalysis ──────────────────────────────────────────
export const getPublicAnalysis = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => z.object({ slug: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey =
      process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Server is not configured for Supabase access.");
    }

    const analysisRes = await fetch(
      `${supabaseUrl}/rest/v1/analyses?select=*&share_slug=eq.${encodeURIComponent(
        data.slug,
      )}&is_public=eq.true`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      },
    );
    if (!analysisRes.ok) throw new Error("Failed to fetch analysis");
    const analyses = await analysisRes.json();
    if (!analyses || analyses.length === 0) {
      throw new Error("Analysis not found or no longer shared.");
    }
    const analysis = analyses[0];

    if (analysis.share_expires_at) {
      const expires = new Date(analysis.share_expires_at).getTime();
      if (Date.now() > expires) {
        throw new Error("This shared analysis has expired.");
      }
    }

    const itemsRes = await fetch(
      `${supabaseUrl}/rest/v1/analysis_items?select=*&analysis_id=eq.${encodeURIComponent(
        analysis.id,
      )}&order=rank.asc`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      },
    );
    if (!itemsRes.ok) throw new Error("Failed to fetch analysis items");
    const items = await itemsRes.json();

    return { analysis, items: items ?? [] };
  });

// ─── generateActionPlan ─────────────────────────────────────────
export const generateActionPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { analysisId: string }) =>
      z.object({ analysisId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    const { data: items, error: itemsErr } = await supabase
      .from("analysis_items")
      .select("title, kind, repos, pitch, effort, market_potential, next_steps, tech_stack, rank")
      .eq("analysis_id", data.analysisId)
      .eq("user_id", userId)
      .order("rank", { ascending: true });
    if (itemsErr) throw new Error(itemsErr.message);
    if (!items || items.length === 0) throw new Error("No recommendations found for this analysis.");

    const { data: prefs } = await supabase
      .from("user_preferences")
      .select("custom_ai_provider, custom_ai_key")
      .eq("user_id", userId)
      .maybeSingle();

    const srvProvider = process.env.SERVER_AI_PROVIDER;
    const srvKey = process.env.SERVER_AI_KEY;
    const provider =
      prefs?.custom_ai_key ? (prefs.custom_ai_provider || "openai")
      : srvProvider && srvKey ? srvProvider
      : prefs?.custom_ai_provider || "github_models";
    let aiKey = prefs?.custom_ai_key || null;
    if (!aiKey && srvKey && srvProvider && provider === srvProvider) {
      aiKey = srvKey;
    }
    if (provider === "github_models" && !aiKey) {
      const { data: conn } = await supabase
        .from("github_connections")
        .select("access_token")
        .eq("user_id", userId)
        .maybeSingle();
      aiKey = conn?.access_token || null;
    }
    const aiConfig = { provider, apiKey: aiKey };

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
        {
          "title": string,
          "recommendation_index": number (0-based),
          "why_now": string,
          "key_deliverable": string
        }
      ]
    }
  ],
  "quick_wins": [string],
  "moonshots": [string],
  "dependencies": [
    { "from_title": string, "to_title": string, "reason": string }
  ]
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

    return JSON.parse(result.content || "{}");
  });

// ─── generateMergeInstructions ──────────────────────────────────
export const generateMergeInstructions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { analysisId: string; itemRank: number }) =>
      z.object({ analysisId: z.string().uuid(), itemRank: z.number().int().min(0) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    const { data: item, error: itemErr } = await supabase
      .from("analysis_items")
      .select("title, repos, pitch, next_steps, tech_stack")
      .eq("analysis_id", data.analysisId)
      .eq("user_id", userId)
      .eq("rank", data.itemRank)
      .maybeSingle();
    if (itemErr) throw new Error(itemErr.message);
    if (!item) throw new Error("Recommendation not found.");

    const { data: prefs } = await supabase
      .from("user_preferences")
      .select("custom_ai_provider, custom_ai_key")
      .eq("user_id", userId)
      .maybeSingle();

    const srvP = process.env.SERVER_AI_PROVIDER;
    const srvK = process.env.SERVER_AI_KEY;
    const provider =
      prefs?.custom_ai_key ? (prefs.custom_ai_provider || "openai")
      : srvP && srvK ? srvP
      : prefs?.custom_ai_provider || "github_models";
    let aiKey = prefs?.custom_ai_key || null;
    if (!aiKey && srvK && srvP && provider === srvP) {
      aiKey = srvK;
    }
    if (provider === "github_models" && !aiKey) {
      const { data: conn } = await supabase
        .from("github_connections")
        .select("access_token")
        .eq("user_id", userId)
        .maybeSingle();
      aiKey = conn?.access_token || null;
    }
    const aiConfig = { provider, apiKey: aiKey };

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

    return JSON.parse(result.content || "{}");
  });
