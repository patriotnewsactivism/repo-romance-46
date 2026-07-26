import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAI, type AIProviderConfig } from "@/lib/ai-provider";
import {
  calibrateValuationRange,
  costReplacementBounds,
  diversificationScore,
  estimateCommitCountFromResponse,
  portfolioRecommendation,
} from "@/lib/scoring";

// ── Types ──────────────────────────────────────────────────────────────────

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
  calibration_note?: string;
  cost_replacement_mid?: number;
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
  disclaimer: string;
}

// ── GitHub helpers ─────────────────────────────────────────────────────────

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "repo-finisher",
  };
}

async function fetchRepoMetrics(token: string, repo: string) {
  const headers = ghHeaders(token);

  const repoRes = await fetch(`https://api.github.com/repos/${repo}`, { headers });
  if (!repoRes.ok) throw new Error(`Repo not found: ${repo}`);
  const repoData = await repoRes.json();

  let fileCount = 0;
  let hasTests = false;
  let hasCI = false;
  const hasLicense = !!repoData.license;
  let hasReadme = false;

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

  let languages: Record<string, number> = {};
  try {
    const langRes = await fetch(`https://api.github.com/repos/${repo}/languages`, { headers });
    if (langRes.ok) languages = await langRes.json();
  } catch {
    /* ignore */
  }

  // Commit activity: use per_page=1 + Link last page when possible, else sample 100
  let commitCount = 0;
  try {
    const commitRes = await fetch(
      `https://api.github.com/repos/${repo}/commits?per_page=100&sha=${encodeURIComponent(repoData.default_branch || "")}`,
      { headers },
    );
    if (commitRes.ok) {
      const commits = await commitRes.json();
      const len = Array.isArray(commits) ? commits.length : 0;
      commitCount = estimateCommitCountFromResponse(len, commitRes.headers.get("link"));
      // If only one page of results, exact count is len
      if (!commitRes.headers.get("link")) commitCount = len;
    }
  } catch {
    /* ignore */
  }

  const openIssues = repoData.open_issues_count || 0;
  const stars = repoData.stargazers_count || 0;
  const forks = repoData.forks_count || 0;
  const watchers = repoData.watchers_count || 0;
  const topics = repoData.topics || [];

  const createdAt = new Date(repoData.created_at);
  const ageDays = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));

  const pushedAt = new Date(repoData.pushed_at);
  const daysSincePush = Math.floor((Date.now() - pushedAt.getTime()) / (1000 * 60 * 60 * 24));

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

// ── AI Valuation Generation ────────────────────────────────────────────────

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
    completion_pct?: number | null;
    item_valuation?: { low_usd?: number; mid_usd?: number; high_usd?: number } | null;
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

When a cost-replacement floor is provided, do not value below ~50% of that floor without strong justification (abandoned/broken code).
When a prior item-level valuation exists, stay within 3x of that mid unless traction clearly differs.

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

  const bounds = costReplacementBounds({
    estimatedHours: analysisItem?.estimated_hours,
    completionPct: analysisItem?.completion_pct,
    marketPotential: analysisItem?.market_potential,
    stars: metrics.stars,
  });

  const metricsText = `Repo: ${repo}
Description: ${metrics.description || "none"}
Stars: ${metrics.stars} | Forks: ${metrics.forks} | Watchers: ${metrics.watchers}
Open Issues: ${metrics.openIssues}
Language: ${metrics.language || "unknown"}
Topics: ${metrics.topics.join(", ") || "none"}
Files: ${metrics.fileCount} | Commits (approx): ${metrics.commitCount}
Code Quality: CI=${metrics.hasCI}, Tests=${metrics.hasTests}, License=${metrics.hasLicense}, README=${metrics.hasReadme}, Homepage=${metrics.hasHomepage ? metrics.homepage : "none"}
Repo Age: ${metrics.ageDays} days | Last Push: ${metrics.daysSincePush} days ago
Size: ${metrics.sizeKb}KB
Archived: ${metrics.isArchived} | Fork: ${metrics.isFork}
Deterministic cost-replacement guide: floor=$${bounds.floor}, mid=$${bounds.midpoint}, ceiling=$${bounds.ceiling}`;

  const analysisText = analysisItem
    ? `
Analysis Context:
- Type: ${analysisItem.kind}
- Title: ${analysisItem.title}
- Pitch: ${analysisItem.pitch}
- Effort to finish: ${analysisItem.effort}/5
- Market potential: ${analysisItem.market_potential}/5
- Estimated hours to complete: ${analysisItem.estimated_hours || "unknown"}
- Structural completion %: ${analysisItem.completion_pct ?? "unknown"}
- Tech stack: ${analysisItem.tech_stack.join(", ")}
- Next steps: ${analysisItem.next_steps.join("; ")}
- Prior item valuation (USD): ${
        analysisItem.item_valuation
          ? `${analysisItem.item_valuation.low_usd ?? "?"}-${analysisItem.item_valuation.high_usd ?? "?"} (mid ${analysisItem.item_valuation.mid_usd ?? "?"})`
          : "none"
      }`
    : "";

  const body = {
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

  const parsed = JSON.parse(aiResult.content || "{}") as Omit<Valuation, "repo">;
  const confidence = (["low", "medium", "high"].includes(parsed.confidence)
    ? parsed.confidence
    : "medium") as "low" | "medium" | "high";

  const calibrated = calibrateValuationRange(
    Number(parsed.estimated_value_low) || 0,
    Number(parsed.estimated_value_high) || 0,
    bounds,
    confidence,
  );

  // Soft-archive penalty
  let low = calibrated.low;
  let high = calibrated.high;
  if (metrics.isArchived) {
    low = Math.round(low * 0.4);
    high = Math.round(high * 0.4);
  }
  if (metrics.daysSincePush > 365) {
    low = Math.round(low * 0.75);
    high = Math.round(high * 0.75);
  }

  return {
    ...parsed,
    repo,
    currency: parsed.currency || "USD",
    confidence,
    estimated_value_low: low,
    estimated_value_high: Math.max(high, low),
    valuation_method: parsed.valuation_method || "mixed",
    factors: Array.isArray(parsed.factors) ? parsed.factors : [],
    revenue_potential: parsed.revenue_potential || {
      model: "unknown",
      monthly_revenue_low: 0,
      monthly_revenue_high: 0,
      timeline: "unknown",
    },
    comparables: Array.isArray(parsed.comparables) ? parsed.comparables : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks : [],
    upsides: Array.isArray(parsed.upsides) ? parsed.upsides : [],
    summary: parsed.summary || `Valuation for ${repo}`,
    calibration_note: calibrated.method_note,
    cost_replacement_mid: bounds.midpoint,
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (e) {
        results[i] = { status: "rejected", reason: e };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () => worker()),
  );
  return results;
}

// ── Server Functions ───────────────────────────────────────────────────────

export const valuePortfolio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { analysisId: string }) =>
    z.object({ analysisId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }) => {
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

    const { data: conn } = await context.supabase
      .from("github_connections")
      .select("github_login, access_token")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!conn) throw new Error("Connect GitHub first.");

    const { data: prefs } = await context.supabase
      .from("user_preferences")
      .select("custom_ai_provider, custom_ai_key")
      .eq("user_id", context.userId)
      .maybeSingle();

    const serverProvider = process.env.SERVER_AI_PROVIDER;
    const serverKey = process.env.SERVER_AI_KEY;
    const resolvedProvider = prefs?.custom_ai_key
      ? prefs.custom_ai_provider || "openai"
      : serverProvider && serverKey
        ? serverProvider
        : prefs?.custom_ai_provider || "github_models";
    const resolvedKey = prefs?.custom_ai_key
      ? prefs.custom_ai_key
      : serverProvider && serverKey
        ? serverKey
        : resolvedProvider === "github_models"
          ? conn.access_token
          : null;

    // Prefer finish/repurpose; fall back to any repo if only combines exist
    const valueableRepos = new Set<string>();
    for (const item of items) {
      const kind = (item as Record<string, unknown>).kind as string;
      if (kind === "finish" || kind === "repurpose") {
        const repos = (item as Record<string, unknown>).repos as string[];
        repos?.forEach((r) => valueableRepos.add(r));
      }
    }
    if (valueableRepos.size === 0) {
      for (const item of items) {
        const repos = (item as Record<string, unknown>).repos as string[];
        repos?.forEach((r) => valueableRepos.add(r));
      }
    }

    if (valueableRepos.size === 0) {
      throw new Error("No repos found on recommendations to value.");
    }

    // Load any prior deep-analysis completion % from repo_learnings
    const completionByRepo = new Map<string, number>();
    try {
      const sb = context.supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (c: string, v: string) => {
              in: (c: string, v: string[]) => Promise<{ data: unknown }>;
            };
          };
        };
      };
      const { data: learnings } = await sb
        .from("repo_learnings")
        .select("repo, last_analysis")
        .eq("user_id", context.userId)
        .in("repo", [...valueableRepos]);
      for (const row of (learnings as { repo: string; last_analysis: { completion?: { percentage?: number } } }[] | null) ?? []) {
        const pct = row.last_analysis?.completion?.percentage;
        if (typeof pct === "number") completionByRepo.set(row.repo, pct);
      }
    } catch {
      /* optional table */
    }

    const valFallbacks: AIProviderConfig[] = [];
    if (serverProvider && serverKey && serverProvider !== resolvedProvider) {
      valFallbacks.push({ provider: serverProvider, apiKey: serverKey });
    }
    if (resolvedProvider !== "github_models" && conn.access_token) {
      valFallbacks.push({ provider: "github_models", apiKey: conn.access_token });
    }

    const repoList = [...valueableRepos];
    const settled = await mapPool(repoList, 3, async (repo) => {
      const metrics = await fetchRepoMetrics(conn.access_token, repo);

      const matchingItem = items.find((it) => {
        const r = (it as Record<string, unknown>).repos as string[];
        return Array.isArray(r) && r.includes(repo);
      });

      const rawVal = matchingItem
        ? ((matchingItem as Record<string, unknown>).valuation as {
            low_usd?: number;
            mid_usd?: number;
            high_usd?: number;
          } | null)
        : null;

      const analysisContext = matchingItem
        ? {
            kind: (matchingItem as Record<string, unknown>).kind as string,
            title: (matchingItem as Record<string, unknown>).title as string,
            pitch: (matchingItem as Record<string, unknown>).pitch as string,
            effort: (matchingItem as Record<string, unknown>).effort as number,
            market_potential: (matchingItem as Record<string, unknown>).market_potential as number,
            tech_stack: ((matchingItem as Record<string, unknown>).tech_stack as string[]) || [],
            estimated_hours: (matchingItem as Record<string, unknown>).estimated_hours as
              | number
              | null,
            next_steps: ((matchingItem as Record<string, unknown>).next_steps as string[]) || [],
            completion_pct: completionByRepo.get(repo) ?? null,
            item_valuation: rawVal,
          }
        : null;

      return generateValuation(
        repo,
        metrics,
        analysisContext,
        resolvedProvider,
        resolvedKey,
        valFallbacks,
      );
    });

    const valuations: Valuation[] = [];
    const errors: string[] = [];
    settled.forEach((result, i) => {
      if (result.status === "fulfilled") valuations.push(result.value);
      else {
        const msg =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        errors.push(`${repoList[i]}: ${msg}`);
      }
    });

    if (valuations.length === 0) {
      throw new Error(`All valuations failed: ${errors.join("; ")}`);
    }

    const totalLow = valuations.reduce((sum, v) => sum + (v.estimated_value_low || 0), 0);
    const totalHigh = valuations.reduce((sum, v) => sum + (v.estimated_value_high || 0), 0);

    valuations.sort((a, b) => b.estimated_value_high - a.estimated_value_high);

    const topPicksResult = valuations.slice(0, 3).map((v) => ({
      repo: v.repo || "unknown",
      reason: v.summary,
    }));

    const confCounts = { low: 0, medium: 0, high: 0 };
    for (const v of valuations) confCounts[v.confidence]++;
    const avgConfidence =
      confCounts.high >= confCounts.medium && confCounts.high >= confCounts.low
        ? "high"
        : confCounts.low > confCounts.medium
          ? "low"
          : "medium";

    const kinds = items.map((it) => (it as Record<string, unknown>).kind as string);

    const result: PortfolioValuation = {
      total_estimated_value_low: totalLow,
      total_estimated_value_high: totalHigh,
      currency: "USD",
      repo_valuations: valuations,
      portfolio_summary: `${valuations.length} repos valued${errors.length ? ` (${errors.length} failed)` : ""}. Portfolio estimated at $${totalLow.toLocaleString()} - $${totalHigh.toLocaleString()} USD based on blended AI + cost-replacement methodology.`,
      top_picks: topPicksResult,
      diversification_score: diversificationScore(
        valuations.map((v) => v.revenue_potential?.model || "unknown"),
        kinds,
      ),
      recommendation: portfolioRecommendation(totalHigh, avgConfidence),
      disclaimer:
        "AI-assisted estimate for planning only — not a formal appraisal, offer, or tax valuation.",
    };

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
