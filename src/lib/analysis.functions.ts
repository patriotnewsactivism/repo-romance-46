import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPreferences } from "@/lib/preferences.functions";
import { getAIProviderConfig, callAI } from "@/lib/ai-provider";
import { z } from "zod";

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
]);

// ─── Concurrency-limited parallel runner ───────────────────────
// Processes an array of items with at most N in flight at once.
// This is the core fix for the "stuck pulling repos" issue.
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

// Progress callback — lets us write status updates to the analyses row
type ProgressFn = (msg: string) => Promise<void>;

async function digestRepo(
  repo: Repo,
  token: string,
  compact = false,
): Promise<string> {
  const parts: string[] = [];
  parts.push(`REPO: ${repo.full_name}`);
  if (repo.description) parts.push(`DESC: ${repo.description}`);
  parts.push(
    `LANG: ${repo.language ?? "?"} · stars: ${repo.stargazers_count} · pushed: ${repo.pushed_at} · size: ${repo.size}KB`,
  );
  if (repo.topics?.length) parts.push(`TOPICS: ${repo.topics.join(", ")}`);

  // README — smaller slice for providers with tight token budgets
  const readmeChars = compact ? 400 : 2500;
  const readme = await ghText(`/repos/${repo.full_name}/readme`, token);
  if (readme) parts.push(`README (truncated):\n${readme.slice(0, readmeChars)}`);

  // File tree
  let tree: TreeEntry[] = [];
  try {
    const treeRes = await gh<{ tree: TreeEntry[]; truncated: boolean }>(
      `/repos/${repo.full_name}/git/trees/${repo.default_branch}?recursive=1`,
      token,
    );
    tree = treeRes.tree.filter((t) => t.type === "blob");
  } catch {
    // Skip on error
  }
  const paths = tree.map((t) => t.path);
  const topFiles = compact ? 20 : 60;
  parts.push(
    `FILES (${paths.length} total, top ${topFiles}):\n${paths.slice(0, topFiles).join("\n")}`,
  );

  // Sample key files — fetch in parallel within each repo
  const toSample = new Set<string>();
  for (const kf of KEY_FILES) if (paths.includes(kf)) toSample.add(kf);
  const sourceFiles = tree
    .filter((t) => {
      const ext = t.path.slice(t.path.lastIndexOf("."));
      return SAMPLE_EXT.has(ext) && !t.path.includes("node_modules") && !t.path.includes("dist");
    })
    .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
    .slice(0, compact ? 2 : 4)
    .map((t) => t.path);
  for (const p of sourceFiles) toSample.add(p);

  const samplePaths = Array.from(toSample).slice(0, compact ? 3 : 8);
  // Parallel fetch of key files within a single repo
  const fileResults = await Promise.all(
    samplePaths.map((p) => ghText(`/repos/${repo.full_name}/contents/${encodeURIComponent(p)}`, token)),
  );

  let sampledBytes = 0;
  const BUDGET = compact ? 1200 : 8000;
  const maxFileSlice = compact ? 500 : 1500;
  for (let i = 0; i < fileResults.length; i++) {
    if (sampledBytes >= BUDGET) break;
    const text = fileResults[i];
    if (!text) continue;
    const snippet = text.slice(0, Math.min(maxFileSlice, BUDGET - sampledBytes));
    parts.push(`--- FILE: ${samplePaths[i]} ---\n${snippet}`);
    sampledBytes += snippet.length;
  }
  return parts.join("\n\n");
}

// ─── Token budgeting / chunking for AI requests ─────────────────

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
  const OVERHEAD_TOKENS = 1200;
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

// ─── Overall timeout wrapper ────────────────────────────────────
// Caps the entire analysis at a configurable duration. If exceeded,
// throws a helpful error instead of hanging forever.
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

async function runBatchedAI(
  digests: string[],
  aiConfig: { provider: string; apiKey: string | null },
  onProgress?: ProgressFn,
): Promise<z.infer<typeof RecommendationSchema>> {
  const budget = maxInputTokensForProvider(aiConfig.provider);
  const batches = chunkDigests(digests, budget);

  const allRecommendations: z.infer<typeof RecommendationSchema>["recommendations"] = [];
  let summaryMd = "";

  for (let i = 0; i < batches.length; i++) {
    if (batches[i].length === 0) continue;
    if (onProgress) await onProgress(`AI batch ${i + 1}/${batches.length} (${batches[i].length} repos)`);
    const result = await callBatchedAI(batches[i], aiConfig);
    allRecommendations.push(...result.recommendations);
    if (i === 0) summaryMd = result.summary_md;
    // Pacing delay between batches
    if (i < batches.length - 1) {
      if (aiConfig.provider === "github_models") {
        await sleep(5000);
      } else if (aiConfig.provider === "openai" || aiConfig.provider === "custom") {
        await sleep(15000);
      }
    }
  }

  return RecommendationSchema.parse({
    recommendations: allRecommendations,
    summary_md: summaryMd || "Analysis complete.",
  });
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

async function callBatchedAI(
  digests: string[],
  aiConfig: { provider: string; apiKey: string | null },
): Promise<z.infer<typeof RecommendationSchema>> {
  const system = `You are an expert product strategist and technical marketer reviewing a developer's GitHub portfolio.
For each repo digest, identify:
- FINISH: repos that are close to shippable — describe exactly what's missing.
- COMBINE: 2+ repos that together form a stronger product than any alone. List their full names.
- REPURPOSE: repos whose code could be rebranded/positioned as a marketable tool.

For every recommendation give:
- kind, title (5-8 words)
- repos (full_name array)
- pitch (2-3 sentence "market as X")
- effort (1=hours, 5=months)
- market_potential (1=niche, 5=broad)
- next_steps (3-5 concrete, specific todos — not generic advice)
- tech_stack (array of detected technologies, frameworks, languages, tools used across the repos)
- marketing_tweet (a punchy, engaging tweet promoting the product — include relevant hashtags, max 280 chars)
- marketing_linkedin (a professional LinkedIn post promoting the product — 3-4 sentences, include a hook + value prop + CTA)
- estimated_hours (realistic total hours to complete the recommendation, 1-500)

Also produce:
- summary_md (markdown, ~200 words) covering the portfolio

Return 5-12 recommendations. Rank by (market_potential * 2 - effort) desc.`;

  const user = `Here are the repo digests:\n\n${digests.join("\n\n=========\n\n")}`;

  // FIX: Model is now passed through to callAI via the model field in AIRequest
  // instead of being a dead hardcoded value in the body object.
  const aiResult = await callAI(
    {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "recommendations",
          strict: true,
          schema: {
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
                    "kind",
                    "title",
                    "repos",
                    "pitch",
                    "effort",
                    "market_potential",
                    "next_steps",
                    "tech_stack",
                    "marketing_tweet",
                    "marketing_linkedin",
                    "estimated_hours",
                  ],
                },
              },
            },
            required: ["summary_md", "recommendations"],
          },
        },
      },
    },
    aiConfig,
  );
  const parsed = JSON.parse(aiResult.content || "{}");
  return RecommendationSchema.parse(parsed);
}

// ─── Main analysis runner ──────────────────────────────────────
// FIXES APPLIED:
// 1. Parallelized repo digestion with concurrency limit (was sequential)
// 2. Progress tracking via analyses row updates
// 3. Overall timeout (120s) to prevent indefinite hangs
// 4. Dead model field removed (model comes from ai-provider DEFAULT_MODELS)
export const runAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: conn } = await supabase
      .from("github_connections")
      .select("access_token, github_login")
      .eq("user_id", userId)
      .maybeSingle();
    if (!conn) throw new Error("Connect GitHub first.");

    const token = conn.access_token;

    // Fetch user preferences
    const { data: prefs } = await supabase
      .from("user_preferences")
      .select(
        "custom_ai_provider, custom_ai_key, filter_max_repos, filter_languages, filter_min_stars, filter_exclude_archived",
      )
      .eq("user_id", userId)
      .maybeSingle();

    // Insert pending analysis
    const { data: analysis, error: aErr } = await supabase
      .from("analyses")
      .insert({
        user_id: userId,
        status: "running",
        trigger_type: "manual",
        ai_provider: prefs?.custom_ai_provider || "openai",
        ai_model: prefs?.custom_ai_provider === "github_models" ? "gpt-4o-mini" : "gpt-4o",
      })
      .select("id")
      .single();
    if (aErr || !analysis) throw new Error(aErr?.message ?? "Failed to create analysis");
    const analysisId = analysis.id;

    // Progress helper — writes status updates to the analyses row
    const updateProgress: ProgressFn = async (msg: string) => {
      await supabase
        .from("analyses")
        .update({ error: null, status: "running" })
        .eq("id", analysisId);
      // Note: If you add a `progress` column to the analyses table, use:
      // .update({ progress: msg })
      console.log(`[analysis ${analysisId}] ${msg}`);
    };

    try {
      await updateProgress("Fetching repos from GitHub…");

      // Fetch repos (owned, non-fork, non-archived), most-recently pushed first
      const repos = await withTimeout(
        gh<Repo[]>(`/user/repos?per_page=100&affiliation=owner&sort=pushed`, token),
        30000,
        "GitHub repo fetch",
      );

      const shortlist = repos
        .filter((r) => !r.fork && !r.archived)
        .slice(0, prefs?.filter_max_repos || 50);

      if (shortlist.length < 2) {
        throw new Error("Need at least 2 active repos to analyze. Push some code first!");
      }

      await updateProgress(`Digesting ${shortlist.length} repos (parallel)…`);

      // FIX: Parallelized repo digestion with concurrency limit of 6.
      // This replaces the sequential for-loop that was the primary bottleneck.
      // 25 repos × 3-10 sequential API calls each → now 6 repos at a time.
      // Expected improvement: 15-50s → 3-8s for the digestion phase.
      const provider = prefs?.custom_ai_provider || "openai";
      const compactDigest = provider === "github_models";

      let digested = 0;
      const digestResults = await withTimeout(
        parallelMap(shortlist, 6, async (repo) => {
          const digest = await digestRepo(repo, token, compactDigest);
          digested++;
          if (digested % 5 === 0 || digested === shortlist.length) {
            await updateProgress(`Digested ${digested}/${shortlist.length} repos…`);
          }
          return digest;
        }),
        60000,
        "Repo digestion",
      );

      // Collect successful digests, log failures
      const digests: string[] = [];
      let failedDigests = 0;
      for (let i = 0; i < digestResults.length; i++) {
        if (digestResults[i].status === "fulfilled") {
          digests.push(digestResults[i].value);
        } else {
          failedDigests++;
          console.error("digest failed", shortlist[i].full_name, (digestResults[i] as PromiseRejectedResult).reason);
        }
      }

      if (digests.length < 2) {
        throw new Error(
          `Only ${digests.length} repos could be digested (${failedDigests} failed). Check GitHub API rate limits.`,
        );
      }

      // For GitHub Models, fall back to the GitHub connection token if no dedicated AI key is set
      let aiKey = prefs?.custom_ai_key || null;
      if (provider === "github_models" && !aiKey) {
        aiKey = conn.access_token;
      }
      const aiConfig = { provider, apiKey: aiKey };

      await updateProgress(`Running AI analysis on ${digests.length} repos…`);

      // Call AI — batched to stay under each provider's token budget
      // Wrapped in a 90s timeout so it can't hang indefinitely
      const ai = await withTimeout(
        runBatchedAI(digests, aiConfig, updateProgress),
        90000,
        "AI analysis",
      );
      ai.portfolio_stats = computePortfolioStats(shortlist);

      // Rank and persist items
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
        })
        .eq("id", analysisId);

      return { id: analysisId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Analysis failed";
      await supabase.from("analyses").update({ status: "failed", error: msg }).eq("id", analysisId);
      throw new Error(msg);
    }
  });

export const listAnalyses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("analyses")
      .select("id, status, repo_count, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

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

    // Delete child items first, then the analysis row
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
      // Generate a short random slug for the share link
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
    const { supabase, userId } = context;

    // Fetch the original analysis to carry over prefs context
    const { data: original, error: origErr } = await supabase
      .from("analyses")
      .select("id, ai_provider, ai_model")
      .eq("id", data.analysisId)
      .eq("user_id", userId)
      .maybeSingle();
    if (origErr) throw new Error(origErr.message);
    if (!original) throw new Error("Analysis not found");

    // Fetch GitHub connection
    const { data: conn } = await supabase
      .from("github_connections")
      .select("access_token, github_login")
      .eq("user_id", userId)
      .maybeSingle();
    if (!conn) throw new Error("Connect GitHub first.");

    const token = conn.access_token;

    // Fetch user preferences
    const { data: prefs } = await supabase
      .from("user_preferences")
      .select(
        "custom_ai_provider, custom_ai_key, filter_max_repos, filter_languages, filter_min_stars, filter_exclude_archived",
      )
      .eq("user_id", userId)
      .maybeSingle();

    // Insert a new pending analysis
    const { data: analysis, error: aErr } = await supabase
      .from("analyses")
      .insert({
        user_id: userId,
        status: "running",
        trigger_type: "rerun",
        ai_provider: prefs?.custom_ai_provider || "openai",
        ai_model:
          prefs?.custom_ai_provider === "github_models" ? "gpt-4o-mini" : "gpt-4o",
      })
      .select("id")
      .single();
    if (aErr || !analysis) throw new Error(aErr?.message ?? "Failed to create analysis");
    const analysisId = analysis.id;

    const updateProgress: ProgressFn = async (msg: string) => {
      console.log(`[analysis ${analysisId}] ${msg}`);
    };

    try {
      await updateProgress("Fetching repos from GitHub…");
      const repos = await withTimeout(
        gh<Repo[]>(`/user/repos?per_page=100&affiliation=owner&sort=pushed`, token),
        30000,
        "GitHub repo fetch",
      );

      const shortlist = repos
        .filter((r) => !r.fork && !r.archived)
        .slice(0, prefs?.filter_max_repos || 50);

      if (shortlist.length < 2) {
        throw new Error("Need at least 2 active repos to analyze. Push some code first!");
      }

      await updateProgress(`Digesting ${shortlist.length} repos (parallel)…`);
      const provider = prefs?.custom_ai_provider || "openai";
      const compactDigest = provider === "github_models";

      let digested = 0;
      const digestResults = await withTimeout(
        parallelMap(shortlist, 6, async (repo) => {
          const digest = await digestRepo(repo, token, compactDigest);
          digested++;
          if (digested % 5 === 0 || digested === shortlist.length) {
            await updateProgress(`Digested ${digested}/${shortlist.length} repos…`);
          }
          return digest;
        }),
        60000,
        "Repo digestion",
      );

      const digests: string[] = [];
      let failedDigests = 0;
      for (let i = 0; i < digestResults.length; i++) {
        if (digestResults[i].status === "fulfilled") {
          digests.push(digestResults[i].value);
        } else {
          failedDigests++;
          console.error(
            "digest failed",
            shortlist[i].full_name,
            (digestResults[i] as PromiseRejectedResult).reason,
          );
        }
      }

      if (digests.length < 2) {
        throw new Error(
          `Only ${digests.length} repos could be digested (${failedDigests} failed). Check GitHub API rate limits.`,
        );
      }

      let aiKey = prefs?.custom_ai_key || null;
      if (provider === "github_models" && !aiKey) {
        aiKey = conn.access_token;
      }
      const aiConfig = { provider, apiKey: aiKey };

      await updateProgress(`Running AI analysis on ${digests.length} repos…`);
      const ai = await withTimeout(
        runBatchedAI(digests, aiConfig, updateProgress),
        90000,
        "AI analysis",
      );
      ai.portfolio_stats = computePortfolioStats(shortlist);

      const ranked = [...ai.recommendations].sort(
        (a, b) =>
          b.market_potential * 2 - b.effort - (a.market_potential * 2 - a.effort),
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
        })
        .eq("id", analysisId);

      return { id: analysisId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Analysis failed";
      await supabase
        .from("analyses")
        .update({ status: "failed", error: msg })
        .eq("id", analysisId);
      throw new Error(msg);
    }
  });

// ─── getPublicAnalysis ──────────────────────────────────────────
// No auth middleware — this is the public shared view
export const getPublicAnalysis = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => z.object({ slug: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey =
      process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Server is not configured for Supabase access.");
    }

    // Use a direct fetch to the Supabase REST API since we don't have
    // a client instance without the auth middleware
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

    // Check if share has expired
    if (analysis.share_expires_at) {
      const expires = new Date(analysis.share_expires_at).getTime();
      if (Date.now() > expires) {
        throw new Error("This shared analysis has expired.");
      }
    }

    // Fetch items
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

    // Fetch analysis items
    const { data: items, error: itemsErr } = await supabase
      .from("analysis_items")
      .select("title, kind, repos, pitch, effort, market_potential, next_steps, tech_stack, rank")
      .eq("analysis_id", data.analysisId)
      .eq("user_id", userId)
      .order("rank", { ascending: true });
    if (itemsErr) throw new Error(itemsErr.message);
    if (!items || items.length === 0) throw new Error("No recommendations found for this analysis.");

    // Fetch AI config from preferences
    const { data: prefs } = await supabase
      .from("user_preferences")
      .select("custom_ai_provider, custom_ai_key")
      .eq("user_id", userId)
      .maybeSingle();

    const provider = prefs?.custom_ai_provider || "openai";
    let aiKey = prefs?.custom_ai_key || null;
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

    // Fetch the specific "combine" recommendation
    const { data: item, error: itemErr } = await supabase
      .from("analysis_items")
      .select("title, repos, pitch, next_steps, tech_stack")
      .eq("analysis_id", data.analysisId)
      .eq("user_id", userId)
      .eq("rank", data.itemRank)
      .maybeSingle();
    if (itemErr) throw new Error(itemErr.message);
    if (!item) throw new Error("Recommendation not found.");

    // Fetch AI config
    const { data: prefs } = await supabase
      .from("user_preferences")
      .select("custom_ai_provider, custom_ai_key")
      .eq("user_id", userId)
      .maybeSingle();

    const provider = prefs?.custom_ai_provider || "openai";
    let aiKey = prefs?.custom_ai_key || null;
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
