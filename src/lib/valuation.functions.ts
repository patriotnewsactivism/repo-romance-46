import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAI, type AIProviderConfig } from "@/lib/ai-provider";

// ─── Types ─────────────────────────────────────────────────────

interface Valuation {
  repo: string;
  estimated_value_low: number;
  estimated_value_high: number;
  currency: string;
  valuation_method: string;
  confidence: "low" | "medium" | "high";
  factors: {
    label: string;
    score: number;
    weight: number;
    detail: string;
  }[];
  revenue_potential: {
    model: string;
    monthly_revenue_low: number;
    monthly_revenue_high: number;
    timeline: string;
  };
  comparables: {
    name: string;
    outcome: string;
    multiple: string;
    relevance: string;
  }[];
  risks: string[];
  upsides: string[];
  summary: string;
}

interface PortfolioValuation {
  total_estimated_value_low: number;
  total_estimated_value_high: number;
  currency: string;
  repo_valuations: Valuation[];
  portfolio_summary: string;
  top_picks: { repo: string; reason: string }[];
  diversification_score: number;
  recommendation: string;
}

// ─── GitHub helpers ────────────────────────────────────────────

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "repo-finisher",
  };
}

async function fetchRepoMetrics(token: string, repo: string) {
  const headers = ghHeaders(token);

  // Repo metadata
  const repoRes = await fetch(`https://api.github.com/repos/${repo}`, { headers });
  if (!repoRes.ok) throw new Error(`Repo not found: ${repo}`);
  const repoData = await repoRes.json();

  // Get tree for file count + language detection
  let fileCount = 0;
  let hasTests = false;
  let hasCI = false;
  const hasLicense = !!repoData.license;
  let hasReadme = !!repoData.description;

  try {
    const treeRes = await fetch(
      `https://api.github.com/repos/${repo}/git/trees/${repoData.default_branch}?recursive=1`,
      { headers },
    );
    if (treeRes.ok) {
      const tree = await treeRes.json();
      fileCount = tree.tree?.filter((t: { type: string }) => t.type === "blob").length || 0;
      hasTests =
        tree.tree?.some((t: { path: string }) =>
          /test|spec|__tests__|\.test\.|\.spec\./i.test(t.path),
        ) || false;
      hasCI =
        tree.tree?.some((t: { path: string }) => t.path.startsWith(".github/workflows/")) || false;
      hasReadme = tree.tree?.some((t: { path: string }) => /^readme/i.test(t.path)) || false;
    }
  } catch {
    /* ignore */
  }

  // Get languages
  let languages: Record<string, number> = {};
  try {
    const langRes = await fetch(`https://api.github.com/repos/${repo}/languages`, { headers });
    if (langRes.ok) languages = await langRes.json();
  } catch {
    /* ignore */
  }

  // Get commits (activity metric)
  let commitCount = 0;
  try {
    const commitRes = await fetch(`https://api.github.com/repos/${repo}/commits?per_page=100`, {
      headers,
    });
    if (commitRes.ok) {
      const commits = await commitRes.json();
      commitCount = Array.isArray(commits) ? commits.length : 0;
    }
  } catch {
    /* ignore */
  }

  // Get open issues + PRs
  const openIssues = repoData.open_issues_count || 0;
  const stars = repoData.stargazers_count || 0;
  const forks = repoData.forks_count || 0;
  const watchers = repoData.watchers_count || 0;
  const topics = repoData.topics || [];

  // Calculate age in days
  const createdAt = new Date(repoData.created_at);
  const ageDays = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));

  // Last push
  const pushedAt = new Date(repoData.pushed_at);
  const daysSincePush = Math.floor((Date.now() - pushedAt.getTime()) / (1000 * 60 * 60 * 24));

  // Size in KB
  const sizeKb = repoData.size || 0;

  return {
    full_name: repo,
    description: repoData.description,
    stars,
    forks,
    watchers,
    openIssues,
    topics,
    language: repoData.language,
    languages,
    fileCount,
    commitCount,
    hasTests,
    hasCI,
    hasLicense,
    hasReadme,
    hasHomepage: !!repoData.homepage,
    homepage: repoData.homepage,
    ageDays,
    daysSincePush,
    sizeKb,
    isArchived: repoData.archived,
    isFork: repoData.fork,
    defaultBranch: repoData.default_branch,
  };
}

// ─── AI Valuation Generation ───────────────────────────────────

async function generateValuation(
  repo: string,
  metrics: Awaited<ReturnType<typeof fetchRepoMetrics>>,
  analysisItem: {
    kind: string;
    title: string;
    pitch: string;
    effort: number;
    market_potential: number;
    tech_stack: string[];
    estimated_hours: number | null;
    next_steps: string[];
  } | null,
  aiProvider: string,
  aiKey: string | null,
  aiFallbacks?: AIProviderConfig[],
): Promise<Valuation> {
  const system = `You are a technology investment analyst and M&A advisor specializing in codebase and software project valuations.
You value software projects the way a VC or acquirer would — based on:
- Code quality & completeness (tests, CI, documentation, code coverage)
- Market potential & addressable market
- Traction signals (stars, forks, commits, activity recency)
- Tech stack modernity & demand
- Revenue potential (SaaS, licensing, marketplace, consulting)
- Comparable acquisitions and exits in the space
- Unique IP / algorithmic moats
- Development cost savings (what would it cost to build from scratch?)

Be realistic — not everything is worth millions. Most side projects are worth $0-$50k.
Strong revenue-ready SaaS with traction: $50k-$2M.
Exceptional projects with proven revenue: $500k-$10M+.

Return a JSON valuation with:
- estimated_value_low / estimated_value_high (USD, realistic range)
- valuation_method (which approach dominated: cost-replacement, market-comparable, revenue-multiple, or IP-value)
- confidence (how confident you are in the estimate)
- factors: scored 0-10 with weights, each with a detail explanation
- revenue_potential: best monetization model with monthly revenue range and timeline to first dollar
- comparables: 2-3 real comparable acquisitions/exits/products in the space
- risks: 3-5 specific risks that could devalue it
- upsides: 3-5 specific things that could increase value
- summary: 2-3 sentence executive summary of the valuation`;

  const metricsText = `Repo: ${repo}
Description: ${metrics.description || "none"}
Stars: ${metrics.stars} | Forks: ${metrics.forks} | Watchers: ${metrics.watchers}
Open Issues: ${metrics.openIssues}
Language: ${metrics.language || "unknown"}
Topics: ${metrics.topics.join(", ") || "none"}
Files: ${metrics.fileCount} | Commits: ${metrics.commitCount}
Code Quality: CI=${metrics.hasCI}, Tests=${metrics.hasTests}, License=${metrics.hasLicense}, README=${metrics.hasReadme}, Homepage=${metrics.hasHomepage ? metrics.homepage : "none"}
Repo Age: ${metrics.ageDays} days | Last Push: ${metrics.daysSincePush} days ago
Size: ${metrics.sizeKb}KB`;

  const analysisText = analysisItem
    ? `
Analysis Context:
- Type: ${analysisItem.kind}
- Title: ${analysisItem.title}
- Pitch: ${analysisItem.pitch}
- Effort to finish: ${analysisItem.effort}/5
- Market potential: ${analysisItem.market_potential}/5
- Estimated hours to complete: ${analysisItem.estimated_hours || "unknown"}
- Tech stack: ${analysisItem.tech_stack.join(", ")}
- Next steps: ${analysisItem.next_steps.join("; ")}`
    : "";

  const body = {
    model: "google/gemini-3-flash-preview",
    messages: [
      { role: "system", content: system },
      { role: "user", content: `${metricsText}${analysisText}\n\nProvide a realistic valuation.` },
    ],
    response_format: {
      type: "json_schema" as const,
      json_schema: {
        name: "valuation",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            estimated_value_low: { type: "integer" },
            estimated_value_high: { type: "integer" },
            currency: { type: "string" },
            valuation_method: { type: "string" },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
            factors: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  label: { type: "string" },
                  score: { type: "number" },
                  weight: { type: "number" },
                  detail: { type: "string" },
                },
                required: ["label", "score", "weight", "detail"],
              },
            },
            revenue_potential: {
              type: "object",
              additionalProperties: false,
              properties: {
                model: { type: "string" },
                monthly_revenue_low: { type: "integer" },
                monthly_revenue_high: { type: "integer" },
                timeline: { type: "string" },
              },
              required: ["model", "monthly_revenue_low", "monthly_revenue_high", "timeline"],
            },
            comparables: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string" },
                  outcome: { type: "string" },
                  multiple: { type: "string" },
                  relevance: { type: "string" },
                },
                required: ["name", "outcome", "multiple", "relevance"],
              },
            },
            risks: { type: "array", items: { type: "string" } },
            upsides: { type: "array", items: { type: "string" } },
            summary: { type: "string" },
          },
          required: [
            "estimated_value_low",
            "estimated_value_high",
            "currency",
            "valuation_method",
            "confidence",
            "factors",
            "revenue_potential",
            "comparables",
            "risks",
            "upsides",
            "summary",
          ],
        },
      },
    },
  };

  const aiResult = await callAI(
    {
      messages: body.messages,
      responseFormat: body.response_format,
    },
    { provider: aiProvider, apiKey: aiKey },
    aiFallbacks,
  );
  return JSON.parse(aiResult.content || "{}") as Valuation;
}

// ─── Server Functions ──────────────────────────────────────────

export const valuePortfolio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { analysisId: string }) =>
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
    if (!items?.length) throw new Error("No recommendations to value");

    // Get GitHub connection
    const { data: conn } = await context.supabase
      .from("github_connections")
      .select("github_login, access_token")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!conn) throw new Error("Connect GitHub first.");

    // Get AI provider prefs
    const { data: prefs } = await context.supabase
      .from("user_preferences")
      .select("custom_ai_provider, custom_ai_key")
      .eq("user_id", context.userId)
      .maybeSingle();

    // Resolve AI provider — server key overrides github_models default
    const serverProvider = process.env.SERVER_AI_PROVIDER;
    const serverKey = process.env.SERVER_AI_KEY;
    const resolvedProvider =
      prefs?.custom_ai_key ? (prefs.custom_ai_provider || "openai")
      : serverProvider && serverKey ? serverProvider
      : prefs?.custom_ai_provider || "github_models";
    const resolvedKey =
      prefs?.custom_ai_key ? prefs.custom_ai_key
      : serverProvider && serverKey ? serverKey
      : resolvedProvider === "github_models" ? conn.access_token
      : null;

    // Collect unique repos from all recommendations (dedupe)
    const allRepos = new Set<string>();
    for (const item of items) {
      const repos = (item as Record<string, unknown>).repos as string[];
      repos.forEach((r) => allRepos.add(r));
    }

    // Only value repos from "finish" and "repurpose" recommendations
    // (combine recommendations create new repos, not existing ones to value)
    const valueableRepos = new Set<string>();
    for (const item of items) {
      const kind = (item as Record<string, unknown>).kind as string;
      if (kind === "finish" || kind === "repurpose") {
        const repos = (item as Record<string, unknown>).repos as string[];
        repos.forEach((r) => valueableRepos.add(r));
      }
    }

    if (valueableRepos.size === 0) {
      throw new Error("No individual repos to value — only combine recommendations found.");
    }

    // Fetch metrics + generate valuation for each repo
    const valuations: Valuation[] = [];
    const errors: string[] = [];

    for (const repo of valueableRepos) {
      try {
        const metrics = await fetchRepoMetrics(conn.access_token, repo);

        // Find the matching analysis item for context
        const matchingItem = items.find((it) => {
          const r = (it as Record<string, unknown>).repos as string[];
          return r.includes(repo);
        });

        const analysisContext = matchingItem
          ? {
              kind: (matchingItem as Record<string, unknown>).kind as string,
              title: (matchingItem as Record<string, unknown>).title as string,
              pitch: (matchingItem as Record<string, unknown>).pitch as string,
              effort: (matchingItem as Record<string, unknown>).effort as number,
              market_potential: (matchingItem as Record<string, unknown>)
                .market_potential as number,
              tech_stack: ((matchingItem as Record<string, unknown>).tech_stack as string[]) || [],
              estimated_hours: (matchingItem as Record<string, unknown>).estimated_hours as
                number | null,
              next_steps: ((matchingItem as Record<string, unknown>).next_steps as string[]) || [],
            }
          : null;

        // Build fallback chain: primary → server → github_models (always free via GitHub token)
        const valFallbacks: AIProviderConfig[] = [];
        if (serverProvider && serverKey && serverProvider !== resolvedProvider) {
          valFallbacks.push({ provider: serverProvider, apiKey: serverKey });
        }
        if (resolvedProvider !== "github_models" && conn.access_token) {
          valFallbacks.push({ provider: "github_models", apiKey: conn.access_token });
        }

        const valuation = await generateValuation(
          repo,
          metrics,
          analysisContext,
          resolvedProvider,
          resolvedKey,
          valFallbacks,
        );

        valuations.push(valuation);
      } catch (e) {
        errors.push(`${repo}: ${(e as Error).message}`);
      }
    }

    if (valuations.length === 0) {
      throw new Error(`All valuations failed: ${errors.join("; ")}`);
    }

    // Calculate portfolio totals
    const totalLow = valuations.reduce((sum, v) => sum + v.estimated_value_low, 0);
    const totalHigh = valuations.reduce((sum, v) => sum + v.estimated_value_high, 0);

    // Sort by value descending
    valuations.sort((a, b) => b.estimated_value_high - a.estimated_value_high);

    // Top picks
    const topPicks = valuations.slice(0, 3).map((v) => ({
      repo: valuations.find((val) => val === v)?.summary.slice(0, 0) || "",
      reason: v.summary,
    }));

    // Build top picks properly
    const topPicksResult = valuations.slice(0, 3).map((v, i) => ({
      repo: `Pick #${i + 1}`,
      reason: v.summary,
    }));

    const result: PortfolioValuation = {
      total_estimated_value_low: totalLow,
      total_estimated_value_high: totalHigh,
      currency: "USD",
      repo_valuations: valuations,
      portfolio_summary: `${valuations.length} repos valued. Portfolio estimated at $${totalLow.toLocaleString()} - $${totalHigh.toLocaleString()} USD based on ${valuations[0]?.valuation_method || "mixed methodology"}.`,
      top_picks: topPicksResult,
      diversification_score: Math.min(
        10,
        Math.round(
          (new Set(valuations.flatMap((v) => v.revenue_potential.model)).size / valuations.length) *
            10,
        ),
      ),
      recommendation:
        totalHigh > 500000
          ? "Strong portfolio — consider doubling down on top picks and seeking acquisition interest."
          : totalHigh > 100000
            ? "Promising portfolio — focus on finishing highest-value repos and monetizing."
            : "Early-stage portfolio — most value is in development cost savings. Focus on finishing and launching.",
    };

    // Save valuation to the analysis record
    await context.supabase
      .from("analyses")
      .update({ valuation: result as unknown as import("@/integrations/supabase/types").Json })
      .eq("id", data.analysisId);

    return result;
  });

export const getValuation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { analysisId: string }) =>
    z.object({ analysisId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { data: analysis } = await context.supabase
      .from("analyses")
      .select("valuation")
      .eq("id", data.analysisId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!analysis) throw new Error("Analysis not found");
    return (analysis as Record<string, unknown>).valuation || null;
  });
