import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPreferences } from "@/lib/preferences.functions";
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

async function digestRepo(repo: Repo, token: string): Promise<string> {
  const parts: string[] = [];
  parts.push(`REPO: ${repo.full_name}`);
  if (repo.description) parts.push(`DESC: ${repo.description}`);
  parts.push(
    `LANG: ${repo.language ?? "?"} · stars: ${repo.stargazers_count} · pushed: ${repo.pushed_at} · size: ${repo.size}KB`,
  );
  if (repo.topics?.length) parts.push(`TOPICS: ${repo.topics.join(", ")}`);

  // README
  const readme = await ghText(`/repos/${repo.full_name}/readme`, token);
  if (readme) parts.push(`README (truncated):\n${readme.slice(0, 2500)}`);

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
  parts.push(`FILES (${paths.length} total, top 60):\n${paths.slice(0, 60).join("\n")}`);

  // Sample key files
  const toSample = new Set<string>();
  for (const kf of KEY_FILES) if (paths.includes(kf)) toSample.add(kf);
  // Plus a couple of largest source files
  const sourceFiles = tree
    .filter((t) => {
      const ext = t.path.slice(t.path.lastIndexOf("."));
      return SAMPLE_EXT.has(ext) && !t.path.includes("node_modules") && !t.path.includes("dist");
    })
    .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
    .slice(0, 4)
    .map((t) => t.path);
  for (const p of sourceFiles) toSample.add(p);

  let sampledBytes = 0;
  const BUDGET = 8000;
  for (const p of Array.from(toSample).slice(0, 8)) {
    if (sampledBytes >= BUDGET) break;
    const text = await ghText(`/repos/${repo.full_name}/contents/${encodeURIComponent(p)}`, token);
    if (!text) continue;
    const snippet = text.slice(0, Math.min(1500, BUDGET - sampledBytes));
    parts.push(`--- FILE: ${p} ---\n${snippet}`);
    sampledBytes += snippet.length;
  }
  return parts.join("\n\n");
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
      tech_stack: z.array(z.string()).optional().default([]),
      marketing_tweet: z.string().optional(),
      marketing_linkedin: z.string().optional(),
      estimated_hours: z.number().int().optional(),
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
    .optional(),
});

async function callLovableAI(digests: string[]): Promise<z.infer<typeof RecommendationSchema>> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

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
- portfolio_stats object with: total_repos, languages (array of {name, count, pct} — top 5 languages), total_stars, most_active_repo (full_name of most recently pushed), dormant_repos (array of repos not pushed in 6+ months), average_repo_size_kb

Return 5-12 recommendations. Rank by (market_potential * 2 - effort) desc.`;

  const user = `Here are the repo digests:\n\n${digests.join("\n\n=========\n\n")}`;

  const body = {
    model: "google/gemini-3-flash-preview",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "recommendations",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            summary_md: { type: "string" },
            portfolio_stats: {
              type: "object",
              additionalProperties: false,
              properties: {
                total_repos: { type: "integer" },
                total_stars: { type: "integer" },
                most_active_repo: { type: "string" },
                dormant_repos: { type: "array", items: { type: "string" } },
                average_repo_size_kb: { type: "number" },
                languages: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      name: { type: "string" },
                      count: { type: "integer" },
                      pct: { type: "number" },
                    },
                    required: ["name", "count", "pct"],
                  },
                },
              },
              required: ["total_repos", "languages", "total_stars"],
            },
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
                  marketing_tweet: { type: "string" },
                  marketing_linkedin: { type: "string" },
                  estimated_hours: { type: "integer" },
                },
                required: [
                  "kind",
                  "title",
                  "repos",
                  "pitch",
                  "effort",
                  "market_potential",
                  "next_steps",
                ],
              },
            },
          },
          required: ["summary_md", "recommendations"],
        },
      },
    },
  };

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("AI rate limit hit — please try again in a minute.");
    if (res.status === 402)
      throw new Error("Lovable AI credits exhausted. Add credits in workspace billing.");
    throw new Error(`AI error ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content);
  return RecommendationSchema.parse(parsed);
}

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
        ai_provider: prefs?.custom_ai_provider || "lovable",
        ai_model: prefs?.custom_ai_provider === "github_models" ? "openai/gpt-4o" : "gpt-4o",
      })
      .select("id")
      .single();
    if (aErr || !analysis) throw new Error(aErr?.message ?? "Failed to create analysis");
    const analysisId = analysis.id;

    try {
      // Fetch repos (owned, non-fork, non-archived), most-recently pushed first
      const repos = await gh<Repo[]>(
        `/user/repos?per_page=100&affiliation=owner&sort=pushed`,
        token,
      );
      const shortlist = repos
        .filter((r) => !r.fork && !r.archived)
        .slice(0, prefs?.filter_max_repos || 50);

      if (shortlist.length < 2) {
        throw new Error("Need at least 2 active repos to analyze. Push some code first!");
      }

      // Digest each
      const digests: string[] = [];
      for (const repo of shortlist) {
        try {
          digests.push(await digestRepo(repo, token));
        } catch (e) {
          console.error("digest failed", repo.full_name, e);
        }
      }

      // Call AI
      const ai = await callLovableAI(digests);

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
          portfolio_stats: ai.portfolio_stats ?? {},
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

// Generate a random share slug
function generateSlug(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let slug = "";
  for (let i = 0; i < 10; i++) slug += chars[Math.floor(Math.random() * chars.length)];
  return slug;
}

export const toggleShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; isPublic: boolean }) =>
    z.object({ id: z.string().uuid(), isPublic: z.boolean() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    if (data.isPublic) {
      // Generate slug if not already shared
      const slug = generateSlug();
      const { error } = await context.supabase
        .from("analyses")
        .update({ is_public: true, share_slug: slug })
        .eq("id", data.id)
        .eq("user_id", context.userId);
      if (error) throw new Error(error.message);
      return { isPublic: true, slug };
    } else {
      const { error } = await context.supabase
        .from("analyses")
        .update({ is_public: false, share_slug: null })
        .eq("id", data.id)
        .eq("user_id", context.userId);
      if (error) throw new Error(error.message);
      return { isPublic: false, slug: null };
    }
  });

export const getPublicAnalysis = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => z.object({ slug: z.string() }).parse(d))
  .handler(async ({ data }) => {
    type JsonVal = string | number | boolean | null | JsonVal[] | { [k: string]: JsonVal };
    type JsonObj = { [k: string]: JsonVal };
    // Use anon client — RLS allows reading public analyses
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("Server misconfigured");

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/analyses?select=*&share_slug=eq.${data.slug}&is_public=eq.true&status=eq.complete`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    );
    const analyses = (await res.json()) as Array<Record<string, unknown>>;
    if (!analyses.length) throw new Error("Analysis not found or not shared");
    const analysis = analyses[0];

    const itemsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/analysis_items?select=*&analysis_id=eq.${analysis.id}&order=rank.asc`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    );
    const items = (await itemsRes.json()) as Array<Record<string, unknown>>;

    return { analysis: analysis as JsonObj, items: items as JsonObj[] };
  });

export const generateActionPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { analysisId: string }) =>
    z.object({ analysisId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    // Fetch the analysis + items
    const { data: analysis } = await context.supabase
      .from("analyses")
      .select("*")
      .eq("id", data.analysisId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!analysis) throw new Error("Analysis not found");

    const { data: items } = await context.supabase
      .from("analysis_items")
      .select("*")
      .eq("analysis_id", data.analysisId)
      .order("rank", { ascending: true });
    if (!items?.length) throw new Error("No recommendations to plan");

    // Build context for AI
    const itemSummaries = items
      .map((it, i) => {
        const r = it as Record<string, unknown>;
        return `${i + 1}. [${r.kind}] ${r.title} — repos: ${(r.repos as string[]).join(", ")} — effort: ${r.effort}/5 — market: ${r.market_potential}/5 — est: ${r.estimated_hours ?? "?"}h`;
      })
      .join("\n");

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

    const system = `You are a technical product manager creating a sequenced action plan from a portfolio analysis.
Given a set of recommendations (finish/combine/repurpose), create a realistic execution roadmap.
Return a JSON object with:
- phases: array of { name, duration_weeks, items: [{ title, recommendation_index, why_now, key_deliverable }] }
- total_weeks: estimated total
- quick_wins: array of recommendation titles that can be done in <1 week
- moonshots: array of recommendation titles that are highest reward
- dependencies: array of { from_title, to_title, reason }`;

    const user = `Recommendations:\n${itemSummaries}\n\nCreate a phased action plan. Group quick wins first, then medium effort, then moonshots. Max 4 phases.`;

    const body = {
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "action_plan",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              total_weeks: { type: "integer" },
              phases: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    name: { type: "string" },
                    duration_weeks: { type: "integer" },
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          title: { type: "string" },
                          recommendation_index: { type: "integer" },
                          why_now: { type: "string" },
                          key_deliverable: { type: "string" },
                        },
                        required: ["title", "recommendation_index", "why_now", "key_deliverable"],
                      },
                    },
                  },
                  required: ["name", "duration_weeks", "items"],
                },
              },
              quick_wins: { type: "array", items: { type: "string" } },
              moonshots: { type: "array", items: { type: "string" } },
              dependencies: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    from_title: { type: "string" },
                    to_title: { type: "string" },
                    reason: { type: "string" },
                  },
                  required: ["from_title", "to_title", "reason"],
                },
              },
            },
            required: ["total_weeks", "phases", "quick_wins", "moonshots", "dependencies"],
          },
        },
      },
    };

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) throw new Error("AI rate limit hit — try again in a minute.");
      throw new Error(`AI error ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as { choices: { message: { content: string } }[] };
    const plan = JSON.parse(json.choices?.[0]?.message?.content ?? "{}");
    return plan;
  });

export const generateMergeInstructions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { analysisId: string; itemRank: number }) =>
    z.object({ analysisId: z.string().uuid(), itemRank: z.number().int() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    // Fetch the specific recommendation
    const { data: item } = await context.supabase
      .from("analysis_items")
      .select("*")
      .eq("analysis_id", data.analysisId)
      .eq("user_id", context.userId)
      .eq("rank", data.itemRank)
      .maybeSingle();
    if (!item) throw new Error("Recommendation not found");
    if ((item as Record<string, unknown>).kind !== "combine")
      throw new Error("Merge instructions only available for combine recommendations");

    const repos = (item as Record<string, unknown>).repos as string[];
    if (repos.length < 2) throw new Error("Need at least 2 repos to generate merge instructions");

    // Fetch the user's GitHub login
    const { data: conn } = await context.supabase
      .from("github_connections")
      .select("github_login, access_token")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!conn) throw new Error("GitHub not connected");

    const token = conn.access_token;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "repo-finisher",
    };

    // Fetch repo metadata for each repo
    const repoInfo: {
      name: string;
      default_branch: string;
      language: string | null;
      description: string | null;
    }[] = [];
    for (const r of repos) {
      try {
        const res = await fetch(`https://api.github.com/repos/${r}`, { headers });
        if (res.ok) {
          const json = (await res.json()) as {
            default_branch: string;
            language: string | null;
            description: string | null;
          };
          repoInfo.push({
            name: r,
            default_branch: json.default_branch,
            language: json.language,
            description: json.description,
          });
        }
      } catch {
        /* skip */
      }
    }

    if (repoInfo.length < 2) throw new Error("Could not fetch enough repo metadata");

    // Generate merge instructions
    const primaryRepo = repoInfo[0];
    const otherRepos = repoInfo.slice(1);
    const newRepoName = ((item as Record<string, unknown>).title as string)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const fullName = `${conn.github_login}/${newRepoName}`;

    const steps: string[] = [];
    steps.push(`# Merge plan: ${(item as Record<string, unknown>).title}`);
    steps.push(``);
    steps.push(`## 1. Create the new combined repo`);
    steps.push(`# Create a new repo on GitHub`);
    steps.push(
      `gh repo create ${fullName} --public --description "${(item as Record<string, unknown>).pitch}"`,
    );
    steps.push(`git clone https://github.com/${fullName}.git`);
    steps.push(`cd ${newRepoName}`);
    steps.push(``);
    steps.push(`## 2. Set up the primary repo as base`);
    steps.push(`# Pull in the primary repo (${primaryRepo.name})`);
    steps.push(`git remote add primary https://github.com/${primaryRepo.name}.git`);
    steps.push(`git fetch primary`);
    steps.push(
      `git merge primary/${primaryRepo.default_branch} --allow-unrelated-histories -m "Merge ${primaryRepo.name} as base"`,
    );
    steps.push(``);

    for (let i = 0; i < otherRepos.length; i++) {
      const r = otherRepos[i];
      const subdir = r.name
        .split("/")
        .pop()!
        .replace(/[^a-zA-Z0-9-]/g, "-")
        .toLowerCase();
      steps.push(`## ${3 + i}. Merge in ${r.name}`);
      steps.push(`# Add as remote and merge into a subdirectory`);
      steps.push(`git remote add repo${i + 2} https://github.com/${r.name}.git`);
      steps.push(`git fetch repo${i + 2}`);
      steps.push(`# Move files into a subdirectory to avoid conflicts`);
      steps.push(`git read-tree --prefix=${subdir}/ repo${i + 2}/${r.default_branch}`);
      steps.push(`git commit -m "Merge ${r.name} into /${subdir}"`);
      steps.push(``);
    }

    steps.push(`## ${3 + otherRepos.length}. Clean up remotes`);
    steps.push(`git remote remove primary`);
    for (let i = 0; i < otherRepos.length; i++) {
      steps.push(`git remote remove repo${i + 2}`);
    }
    steps.push(``);
    steps.push(`## ${4 + otherRepos.length}. Push and create initial PR`);
    steps.push(`git push -u origin main`);
    steps.push(``);
    steps.push(`## Next steps from AI analysis:`);
    for (const step of (item as Record<string, unknown>).next_steps as string[]) {
      steps.push(`- [ ] ${step}`);
    }

    return {
      instructions: steps.join("\n"),
      newRepoName,
      newRepoUrl: `https://github.com/${fullName}`,
      primaryRepo: primaryRepo.name,
      mergedRepos: otherRepos.map((r) => r.name),
    };
  });

export const rerunAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { analysisId: string }) =>
    z.object({ analysisId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    // Verify ownership
    const { data: existing } = await context.supabase
      .from("analyses")
      .select("id")
      .eq("id", data.analysisId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!existing) throw new Error("Analysis not found");

    // Create a new analysis (same flow as runAnalysis but we know they're connected)
    const { data: conn } = await context.supabase
      .from("github_connections")
      .select("access_token, github_login")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!conn) throw new Error("Connect GitHub first.");
    const token = conn.access_token;

    // Fetch user preferences
    const { data: rerunPrefs } = await context.supabase
      .from("user_preferences")
      .select(
        "custom_ai_provider, custom_ai_key, filter_max_repos, filter_languages, filter_min_stars, filter_exclude_archived",
      )
      .eq("user_id", context.userId)
      .maybeSingle();

    const { data: analysis, error: aErr } = await context.supabase
      .from("analyses")
      .insert({
        user_id: context.userId,
        status: "running",
        trigger_type: "rerun",
        ai_provider: rerunPrefs?.custom_ai_provider || "lovable",
        ai_model: rerunPrefs?.custom_ai_provider === "github_models" ? "openai/gpt-4o" : "gpt-4o",
      })
      .select("id")
      .single();
    if (aErr || !analysis) throw new Error(aErr?.message ?? "Failed to create analysis");
    const analysisId = analysis.id;

    try {
      const repos = await gh<Repo[]>(
        `/user/repos?per_page=100&affiliation=owner&sort=pushed`,
        token,
      );
      const shortlist = repos
        .filter((r) => !r.fork && !r.archived)
        .slice(0, rerunPrefs?.filter_max_repos || 50);
      if (shortlist.length < 2) throw new Error("Need at least 2 active repos to analyze.");

      const digests: string[] = [];
      for (const repo of shortlist) {
        try {
          digests.push(await digestRepo(repo, token));
        } catch (e) {
          console.error("digest failed", repo.full_name, e);
        }
      }

      const ai = await callLovableAI(digests);
      const ranked = [...ai.recommendations].sort(
        (a, b) => b.market_potential * 2 - b.effort - (a.market_potential * 2 - a.effort),
      );

      const rows = ranked.map((r, i) => ({
        analysis_id: analysisId,
        user_id: context.userId,
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
        const { error: iErr } = await context.supabase.from("analysis_items").insert(rows);
        if (iErr) throw new Error(iErr.message);
      }

      await context.supabase
        .from("analyses")
        .update({
          status: "complete",
          repo_count: shortlist.length,
          analyzed_repo_names: shortlist.map((r: Repo) => r.full_name),
          summary_md: ai.summary_md,
          portfolio_stats: ai.portfolio_stats ?? {},
          completed_at: new Date().toISOString(),
        })
        .eq("id", analysisId);

      return { id: analysisId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Analysis failed";
      await context.supabase
        .from("analyses")
        .update({ status: "failed", error: msg })
        .eq("id", analysisId);
      throw new Error(msg);
    }
  });

export const deleteAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("analyses")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
