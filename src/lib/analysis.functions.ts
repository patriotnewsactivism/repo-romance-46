import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
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

const SAMPLE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".rb", ".java", ".swift", ".kt"]);

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
    }),
  ),
  summary_md: z.string(),
});

async function callLovableAI(digests: string[]): Promise<z.infer<typeof RecommendationSchema>> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

  const system = `You are an expert product strategist reviewing a developer's GitHub portfolio.
For each repo digest, identify:
- FINISH: repos that are close to shippable — describe exactly what's missing.
- COMBINE: 2+ repos that together form a stronger product than any alone. List their full names.
- REPURPOSE: repos whose code could be rebranded/positioned as a marketable tool.

For every recommendation give: kind, title (5-8 words), repos (full_name array), pitch (2-3 sentence "market as X"), effort (1=hours, 5=months), market_potential (1=niche, 5=broad), next_steps (3-5 concrete todos).
Also produce a short summary_md (markdown, ~200 words) covering the portfolio.
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
                },
                required: ["kind", "title", "repos", "pitch", "effort", "market_potential", "next_steps"],
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
    if (res.status === 402) throw new Error("Lovable AI credits exhausted. Add credits in workspace billing.");
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

    // Insert pending analysis
    const { data: analysis, error: aErr } = await supabase
      .from("analyses")
      .insert({ user_id: userId, status: "running" })
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
        .slice(0, 25);

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
          summary_md: ai.summary_md,
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
