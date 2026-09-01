import { Router, type IRouter } from "express";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "../lib/async-handler";
import { callAI } from "../lib/ai-provider";
import { createAgenticPreview } from "../lib/agentic-preview";
import { loadAiCredential, loadGithubCredential, requireGithubCredential } from "../lib/credentials";
import {
  dedupeMarketSources,
  marketResearchConfigured,
  searchMarketWeb,
  type MarketResearchSource,
} from "../lib/tavily-market-research";

const router: IRouter = Router();
const repoPattern = /^[A-Za-z0-9.-]+\/[A-Za-z0-9._-]+$/;

const researchInput = z.object({
  repo: z.string().regex(repoPattern),
  analysisId: z.string().uuid().optional(),
  itemRank: z.number().int().nonnegative().optional(),
});

const previewInput = z.object({
  repo: z.string().regex(repoPattern),
  analysisId: z.string().uuid().optional(),
  itemRank: z.number().int().nonnegative().optional(),
  kind: z.enum(["feature", "documentation"]),
  title: z.string().min(1).max(180),
  goals: z.array(z.string().min(1).max(1000)).min(1).max(20),
  documentationTargets: z.array(z.enum(["README.md", "AGENTS.md", "PLAN.md", "ROADMAP.md", "docs"])).max(5).optional(),
});

const sourceSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  excerpt: z.string(),
  score: z.number().nullable(),
});

const competitorSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  pricing_summary: z.string().min(1),
  features: z.array(z.string().min(1)).max(12),
  positioning: z.string().min(1),
  evidence_urls: z.array(z.string().url()).min(1).max(6),
  confidence: z.enum(["low", "medium", "high"]),
});

const suggestionSchema = z.object({
  title: z.string().min(1),
  why_it_matters: z.string().min(1),
  implementation_summary: z.string().min(1),
  desirability_score: z.number().int().min(0).max(100),
  confidence: z.enum(["low", "medium", "high"]),
  value_lift_usd: z.object({ low: z.number().int().nonnegative(), high: z.number().int().nonnegative() }),
  monthly_revenue_scenario_usd: z.object({
    low: z.number().int().nonnegative(),
    base: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
  }),
  assumptions: z.array(z.string().min(1)).min(1).max(10),
  competitor_gap: z.string().min(1),
  acceptance_checks: z.array(z.string().min(1)).min(1).max(10),
  risks: z.array(z.string().min(1)).max(8),
  evidence_urls: z.array(z.string().url()).max(8),
});

const aiGrowthSchema = z.object({
  market_category: z.string().min(1),
  market_summary: z.string().min(1),
  target_buyers: z.array(z.string().min(1)).min(1).max(8),
  competitors: z.array(competitorSchema).max(8),
  feature_suggestions: z.array(suggestionSchema).min(3).max(10),
  limitations: z.array(z.string().min(1)).max(10),
});

type AiGrowth = z.infer<typeof aiGrowthSchema>;

function ghHeaders(token: string, accept = "application/vnd.github+json") {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "repo-finisher",
  };
}

async function ghJson<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, { headers: ghHeaders(token) });
  if (!response.ok) throw Object.assign(new Error(`GitHub ${path} returned ${response.status}`), { status: response.status });
  return response.json() as Promise<T>;
}

async function ghRaw(token: string, repo: string, path: string, ref: string) {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    { headers: ghHeaders(token, "application/vnd.github.raw") },
  );
  if (!response.ok) return null;
  const text = await response.text();
  return text.length <= 80_000 ? text : text.slice(0, 80_000);
}

async function analysisContext(supabase: SupabaseClient, analysisId?: string, itemRank?: number) {
  if (!analysisId || itemRank === undefined) return null;
  const { data } = await supabase
    .from("analysis_items")
    .select("title, pitch, kind, tech_stack, next_steps, effort, market_potential, estimated_hours")
    .eq("analysis_id", analysisId)
    .eq("rank", itemRank)
    .maybeSingle();
  return data ?? null;
}

function keywords(value: string) {
  return [...new Set(value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((word) => word.length >= 4))]
    .filter((word) => !["this", "that", "with", "from", "your", "software", "application", "platform", "github"].includes(word))
    .slice(0, 7)
    .join(" ");
}

function buildResearchQueries(repo: string, metadata: Record<string, unknown>, context: Record<string, unknown> | null) {
  const name = repo.split("/")[1];
  const title = typeof context?.title === "string" ? context.title : name;
  const pitch = typeof context?.pitch === "string" ? context.pitch : typeof metadata.description === "string" ? metadata.description : "";
  const terms = keywords(`${title} ${pitch}`) || name.replace(/[-_]/g, " ");
  return [
    `${terms} software competitors pricing features`,
    `${terms} SaaS alternatives pricing`,
    `${terms} product market competitors plans pricing`,
  ];
}

function sourcePacket(sources: MarketResearchSource[]) {
  return sources.map((source, index) => ({
    source_id: index + 1,
    title: source.title,
    url: source.url,
    excerpt: source.excerpt,
    score: source.score,
  }));
}

function growthJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      market_category: { type: "string" },
      market_summary: { type: "string" },
      target_buyers: { type: "array", items: { type: "string" } },
      competitors: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            url: { type: "string" },
            pricing_summary: { type: "string" },
            features: { type: "array", items: { type: "string" } },
            positioning: { type: "string" },
            evidence_urls: { type: "array", items: { type: "string" } },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
          },
          required: ["name", "url", "pricing_summary", "features", "positioning", "evidence_urls", "confidence"],
        },
      },
      feature_suggestions: {
        type: "array",
        minItems: 3,
        maxItems: 10,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            why_it_matters: { type: "string" },
            implementation_summary: { type: "string" },
            desirability_score: { type: "integer", minimum: 0, maximum: 100 },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
            value_lift_usd: {
              type: "object",
              additionalProperties: false,
              properties: { low: { type: "integer", minimum: 0 }, high: { type: "integer", minimum: 0 } },
              required: ["low", "high"],
            },
            monthly_revenue_scenario_usd: {
              type: "object",
              additionalProperties: false,
              properties: {
                low: { type: "integer", minimum: 0 },
                base: { type: "integer", minimum: 0 },
                high: { type: "integer", minimum: 0 },
              },
              required: ["low", "base", "high"],
            },
            assumptions: { type: "array", items: { type: "string" } },
            competitor_gap: { type: "string" },
            acceptance_checks: { type: "array", items: { type: "string" } },
            risks: { type: "array", items: { type: "string" } },
            evidence_urls: { type: "array", items: { type: "string" } },
          },
          required: [
            "title", "why_it_matters", "implementation_summary", "desirability_score", "confidence",
            "value_lift_usd", "monthly_revenue_scenario_usd", "assumptions", "competitor_gap",
            "acceptance_checks", "risks", "evidence_urls",
          ],
        },
      },
      limitations: { type: "array", items: { type: "string" } },
    },
    required: ["market_category", "market_summary", "target_buyers", "competitors", "feature_suggestions", "limitations"],
  };
}

function normalizeSourceBackedClaims(result: AiGrowth, sources: MarketResearchSource[]) {
  const allowed = new Set(sources.map((source) => source.url));
  const competitors = result.competitors.filter(
    (competitor) =>
      allowed.has(competitor.url) &&
      competitor.evidence_urls.length > 0 &&
      competitor.evidence_urls.every((url) => allowed.has(url)),
  );
  const featureSuggestions = result.feature_suggestions.map((suggestion) => {
    const evidenceUrls = suggestion.evidence_urls.filter((url) => allowed.has(url));
    return {
      ...suggestion,
      competitor_gap: evidenceUrls.length > 0
        ? suggestion.competitor_gap
        : "No source-backed competitor gap is established for this suggestion; treat it as a repository-evidence product hypothesis.",
      evidence_urls: evidenceUrls,
      value_lift_usd: {
        low: Math.min(suggestion.value_lift_usd.low, suggestion.value_lift_usd.high),
        high: Math.max(suggestion.value_lift_usd.low, suggestion.value_lift_usd.high),
      },
      monthly_revenue_scenario_usd: {
        low: Math.min(suggestion.monthly_revenue_scenario_usd.low, suggestion.monthly_revenue_scenario_usd.base, suggestion.monthly_revenue_scenario_usd.high),
        base: suggestion.monthly_revenue_scenario_usd.base,
        high: Math.max(suggestion.monthly_revenue_scenario_usd.low, suggestion.monthly_revenue_scenario_usd.base, suggestion.monthly_revenue_scenario_usd.high),
      },
    };
  });
  return { ...result, competitors, feature_suggestions: featureSuggestions };
}

export function isDocumentationPath(path: string) {
  const normalized = path.replace(/^\.\//, "");
  return /^(README(?:\.(?:md|markdown|rst|txt))?|AGENTS\.md|PLAN(?:\.[^/]+)?\.md|ROADMAP(?:\.[^/]+)?\.md|CONTRIBUTING\.md|SECURITY\.md|CHANGELOG(?:\.(?:md|markdown|rst|txt))?|docs\/.*\.md)$/i.test(normalized);
}

router.post(
  "/repo-growth-tools/research",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = researchInput.parse(req.body);
    const github = requireGithubCredential(await loadGithubCredential(req.supabase!, req.userId!));
    const metadata = await ghJson<Record<string, unknown>>(github.token, `/repos/${input.repo}`);
    const defaultBranch = typeof metadata.default_branch === "string" ? metadata.default_branch : "main";
    const context = await analysisContext(req.supabase!, input.analysisId, input.itemRank) as Record<string, unknown> | null;
    const [readme, packageJson, aiCredential] = await Promise.all([
      ghRaw(github.token, input.repo, "README.md", defaultBranch),
      ghRaw(github.token, input.repo, "package.json", defaultBranch),
      loadAiCredential(req.supabase!, req.userId!, github.token),
    ]);
    if (!aiCredential.apiKey) {
      throw Object.assign(new Error(`No usable ${aiCredential.provider} credential is configured for growth analysis.`), { status: 400 });
    }

    const queries = buildResearchQueries(input.repo, metadata, context);
    let researchError: string | null = null;
    let sources: MarketResearchSource[] = [];
    if (marketResearchConfigured()) {
      const searched = await Promise.allSettled(queries.map((query) => searchMarketWeb(query, 7)));
      sources = dedupeMarketSources(
        searched.filter((entry): entry is PromiseFulfilledResult<MarketResearchSource[]> => entry.status === "fulfilled").map((entry) => entry.value),
      );
      const failures = searched.filter((entry) => entry.status === "rejected") as PromiseRejectedResult[];
      if (failures.length > 0) researchError = failures.map((entry) => entry.reason instanceof Error ? entry.reason.message : String(entry.reason)).join("; ").slice(0, 500);
    }

    const live = sources.length > 0;
    const system = `You are RepoFinisher's evidence-disciplined product growth analyst.

Your first duty is accuracy. Distinguish repository facts, externally verified market facts, and planning scenarios.

MARKET EVIDENCE RULES:
- The supplied source packet is the ONLY authority for named competitors, their features, their pricing, plan limits, or positioning.
- Never invent a competitor, URL, customer price, feature, market share, TAM, revenue, customer count, or traction claim.
- A competitor may appear only when at least one supplied source URL directly supports the claim. The competitor URL and every evidence_urls entry must be exact URLs present in the supplied source packet.
- If pricing is not clearly supported, say "Pricing not verified in supplied sources" rather than estimating it.
- If no external sources are supplied, competitors MUST be an empty array and the market summary must clearly say live competitor/pricing research is unavailable.

FEATURE SUGGESTION RULES:
- Suggest only coherent features that fit the repository evidence and can be implemented without weakening existing behavior, tests, security, authentication, permissions, data integrity, or deployment.
- Prefer features that close a source-backed competitor gap or improve a concrete user workflow.
- Give objective acceptance checks and material risks.
- value_lift_usd is an incremental software/IP planning range, not an appraisal or guaranteed sale value.
- monthly_revenue_scenario_usd is a MARKETING SCENARIO, not observed revenue and not a forecast. It must be supported by explicit assumptions such as customer count x monthly price. Keep low/base/high ordered and conservative when evidence is thin.
- Never use a revenue multiple unless actual verified revenue was supplied; none is implied here.

Return strict JSON only.`;

    const user = JSON.stringify({
      repository: {
        repo: input.repo,
        description: metadata.description ?? null,
        language: metadata.language ?? null,
        topics: metadata.topics ?? [],
        stars: metadata.stargazers_count ?? 0,
        forks: metadata.forks_count ?? 0,
        open_issues: metadata.open_issues_count ?? 0,
        homepage: metadata.homepage ?? null,
        default_branch: defaultBranch,
        readme_excerpt: readme?.slice(0, 18_000) ?? null,
        package_json: packageJson?.slice(0, 12_000) ?? null,
      },
      analysis_context: context,
      live_research_configured: marketResearchConfigured(),
      live_research_queries: queries,
      live_research_sources: sourcePacket(sources),
      live_research_error: researchError,
    });

    const response = await callAI(
      {
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        responseFormat: { type: "json_schema", json_schema: { name: "repo_growth_analysis", strict: true, schema: growthJsonSchema() } },
        thinkingLevel: "high",
        timeoutMs: 90_000,
      },
      { provider: aiCredential.provider, apiKey: aiCredential.apiKey },
    );
    const parsed = normalizeSourceBackedClaims(aiGrowthSchema.parse(JSON.parse(response.content || "{}")), sources);
    if (!live) {
      parsed.competitors = [];
      parsed.market_summary = "Live external competitor/pricing research is unavailable. The feature suggestions below are repository-evidence product hypotheses with explicit planning assumptions, not verified market claims.";
      parsed.feature_suggestions = parsed.feature_suggestions.map((suggestion) => ({
        ...suggestion,
        competitor_gap: "No source-backed competitor gap is available; this suggestion is based on repository evidence and product reasoning only.",
        evidence_urls: [],
      }));
    }

    res.json({
      research_status: live ? "live" : "unavailable",
      research_provider: live ? "tavily" : null,
      researched_at: new Date().toISOString(),
      queries,
      sources: sources.map((source) => sourceSchema.parse(source)),
      ...parsed,
      limitations: [
        ...(live ? [] : ["Live external competitor/pricing research is unavailable; no competitor pricing claims are shown."]),
        ...(researchError ? [`Some research queries failed: ${researchError}`] : []),
        ...parsed.limitations,
        "Revenue figures are explicit planning scenarios, not observed revenue or forecasts.",
        "Value-lift figures are planning estimates and require implementation plus market validation.",
      ],
    });
  }),
);

router.post(
  "/repo-growth-tools/preview",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = previewInput.parse(req.body);
    const docTargets = input.documentationTargets?.length ? input.documentationTargets.join(", ") : "README.md, AGENTS.md, PLAN/ROADMAP files, and docs/*.md where evidence requires updates";
    const safetyGoals = input.kind === "documentation"
      ? [
          `DOCUMENTATION-ONLY RECONCILIATION. Allowed targets: ${docTargets}. Inspect current implemented source, tests, workflows, migrations, and deployment configuration before changing documentation.`,
          "Do not describe planned, mocked, partially implemented, or unverified behavior as complete. Clearly distinguish current behavior, configuration requirements, known limitations, and future work.",
          "Do not change application source, tests, workflows, lockfiles, migrations, generated code, secrets, or runtime configuration in this documentation-only run.",
        ]
      : [
          "FEATURE-IMPROVEMENT RUN. Implement the smallest coherent version of the selected feature against current repository evidence. Preserve existing behavior unless an evidence-backed change is required.",
          "Add or update tests/acceptance coverage for the feature where the repository supports testing. Do not weaken tests, security, permissions, auth, data integrity, CI, or deployment controls to make the change pass.",
          "Update relevant documentation in the same plan when the implemented user-facing or operational behavior changes.",
        ];

    const preview = await createAgenticPreview(req.supabase!, req.userId!, {
      repo: input.repo,
      analysisId: input.analysisId,
      itemRank: input.itemRank,
      boundedAutonomyAcknowledged: true,
      nextSteps: [...safetyGoals, `Selected objective: ${input.title}`, ...input.goals],
    });

    if (input.kind === "documentation") {
      const unsafe = preview.changes.filter((change: { path: string; status: string }) => !isDocumentationPath(change.path) || change.status === "deleted");
      if (unsafe.length > 0) {
        const now = new Date().toISOString();
        await req.supabase!
          .from("completion_runs")
          .update({ status: "cancelled", error: `Documentation-only guard rejected non-document changes: ${unsafe.map((change: { path: string }) => change.path).join(", ")}`, updated_at: now })
          .eq("id", preview.runId)
          .eq("user_id", req.userId!);
        throw Object.assign(new Error("Documentation-only guard rejected the generated plan because it attempted to modify non-documentation files. No repository write occurred."), { status: 409 });
      }
    }

    res.status(201).json({ ...preview, objectiveKind: input.kind, objectiveTitle: input.title, reviewRequired: true });
  }),
);

export default router;
