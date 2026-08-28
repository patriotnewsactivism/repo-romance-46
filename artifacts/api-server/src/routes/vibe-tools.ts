import { Router, type IRouter } from "express";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "../lib/async-handler";
import { loadAiCredential, loadGithubCredential, requireGithubCredential } from "../lib/credentials";
import { callAI } from "../lib/ai-provider";

const router: IRouter = Router();

async function loadItem(supabase: SupabaseClient, analysisId: string, itemRank: number) {
  const { data } = await supabase
    .from("analysis_items")
    .select("id, kind, title, pitch, repos, next_steps, tech_stack, effort, market_potential, estimated_hours")
    .eq("analysis_id", analysisId)
    .eq("rank", itemRank)
    .maybeSingle();
  if (!data) throw Object.assign(new Error("Item not found"), { status: 404 });
  return data as {
    id: string;
    kind: string;
    title: string;
    pitch: string;
    repos: string[];
    next_steps: string[];
    tech_stack: string[];
    effort: number;
    market_potential: number;
    estimated_hours: number | null;
  };
}

/** Sealed-aware provider/key resolution; see `lib/credentials`. */
async function loadPrefs(supabase: SupabaseClient, userId: string) {
  const credential = await loadGithubCredential(supabase, userId);
  const ai = await loadAiCredential(supabase, userId, credential?.token ?? null);
  return { custom_ai_provider: ai.provider, custom_ai_key: ai.apiKey };
}

async function updateItem(supabase: SupabaseClient, itemId: string, patch: Record<string, unknown>) {
  await supabase.from("analysis_items").update(patch).eq("id", itemId);
}

async function loadGhToken(supabase: SupabaseClient, userId: string): Promise<string> {
  return requireGithubCredential(await loadGithubCredential(supabase, userId)).token;
}

async function gh(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "repo-finisher",
      ...(init?.headers || {}),
    },
  });
}

interface RepositoryEvidence {
  repo: string;
  description: string | null;
  stars: number;
  forks: number;
  open_issues: number;
  topics: string[];
  created_at: string;
  pushed_at: string;
  size_kb: number;
  archived: boolean;
  is_fork: boolean;
  homepage: string | null;
  license: string | null;
  default_branch: string;
  file_count: number | null;
  tree_truncated: boolean | null;
  has_readme: boolean | null;
  has_tests: boolean | null;
  has_ci: boolean | null;
  has_deployment_config: boolean | null;
  has_migrations: boolean | null;
}

async function loadRepositoryEvidence(token: string, repo: string): Promise<RepositoryEvidence> {
  const metadataResponse = await gh(token, `/repos/${repo}`);
  if (!metadataResponse.ok) throw new Error(`GitHub metadata unavailable for ${repo} (${metadataResponse.status})`);
  const metadata = (await metadataResponse.json()) as Record<string, unknown>;
  const defaultBranch = typeof metadata.default_branch === "string" ? metadata.default_branch : "main";

  let paths: string[] | null = null;
  let treeTruncated: boolean | null = null;
  const treeResponse = await gh(token, `/repos/${repo}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`);
  if (treeResponse.ok) {
    const tree = (await treeResponse.json()) as {
      truncated?: boolean;
      tree?: Array<{ path?: string; type?: string }>;
    };
    treeTruncated = Boolean(tree.truncated);
    paths = (tree.tree ?? [])
      .filter((entry) => entry.type === "blob" && typeof entry.path === "string")
      .map((entry) => entry.path as string);
  }

  const has = (pattern: RegExp): boolean | null => (paths ? paths.some((path) => pattern.test(path)) : null);
  const license = metadata.license as { spdx_id?: unknown } | null | undefined;

  return {
    repo,
    description: typeof metadata.description === "string" ? metadata.description : null,
    stars: Number(metadata.stargazers_count) || 0,
    forks: Number(metadata.forks_count) || 0,
    open_issues: Number(metadata.open_issues_count) || 0,
    topics: Array.isArray(metadata.topics) ? metadata.topics.filter((topic): topic is string => typeof topic === "string").slice(0, 20) : [],
    created_at: typeof metadata.created_at === "string" ? metadata.created_at : "unknown",
    pushed_at: typeof metadata.pushed_at === "string" ? metadata.pushed_at : "unknown",
    size_kb: Number(metadata.size) || 0,
    archived: Boolean(metadata.archived),
    is_fork: Boolean(metadata.fork),
    homepage: typeof metadata.homepage === "string" && metadata.homepage ? metadata.homepage : null,
    license: license && typeof license.spdx_id === "string" ? license.spdx_id : null,
    default_branch: defaultBranch,
    file_count: paths?.length ?? null,
    tree_truncated: treeTruncated,
    has_readme: has(/(^|\/)readme(?:\.|$)/i),
    has_tests: has(/(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/i),
    has_ci: has(/^\.github\/workflows\//),
    has_deployment_config: has(/(^|\/)(vercel\.json|netlify\.toml|render\.yaml|firebase\.json|Dockerfile|fly\.toml)$/i),
    has_migrations: has(/(^|\/)(migrations?|supabase\/migrations)(\/|$)/i),
  };
}

const idInput = z.object({ analysisId: z.string().uuid(), itemRank: z.number().int() });

const evidenceStrengths = ["assumption", "weak", "moderate", "strong"] as const;
const valuationConfidence = ["low", "medium", "high"] as const;

const marketResultSchema = z
  .object({
    tam_summary: z.string().min(1),
    target_users: z.array(z.string().min(1)).min(1).max(8),
    competitors: z.array(
      z.object({
        name: z.string().min(1),
        url: z.string(),
        differentiator: z.string().min(1),
        evidence_basis: z.string().min(1),
      }),
    ).max(8),
    monetization: z.array(z.string().min(1)).min(1).max(8),
    demand_score: z.number().int().min(0).max(100),
    ship_readiness_score: z.number().int().min(0).max(100),
    risks: z.array(z.string().min(1)).min(1).max(8),
    verdict: z.enum(["ship_now", "finish_first", "combine_first", "shelve"]),
    need_assessment: z.object({
      score: z.number().int().min(0).max(100),
      problem: z.string().min(1),
      urgency: z.enum(["low", "medium", "high", "critical"]),
      evidence_confidence: z.enum(valuationConfidence),
      supporting_evidence: z.array(
        z.object({ claim: z.string().min(1), source: z.string().min(1), strength: z.enum(evidenceStrengths) }),
      ).max(12),
      counter_evidence: z.array(z.string().min(1)).max(8),
      validation_experiments: z.array(
        z.object({ experiment: z.string().min(1), success_metric: z.string().min(1), effort: z.enum(["hours", "days", "weeks"]) }),
      ).min(1).max(6),
      decision: z.enum(["build_now", "validate_first", "deprioritize"]),
    }),
    next_best_actions: z.array(
      z.object({
        title: z.string().min(1),
        why: z.string().min(1),
        impact: z.enum(["low", "medium", "high"]),
        effort: z.enum(["hours", "days", "weeks"]),
        acceptance_check: z.string().min(1),
      }),
    ).min(1).max(6),
    valuation: z.object({
      low_usd: z.number().int().nonnegative(),
      mid_usd: z.number().int().nonnegative(),
      high_usd: z.number().int().nonnegative(),
      reasoning: z.string().min(1),
      basis: z.enum(["replacement_cost", "revenue_multiple", "market_comparables", "scenario_only"]),
      confidence: z.enum(valuationConfidence),
      evidence: z.array(z.string().min(1)).max(12),
      missing_information: z.array(z.string().min(1)).max(12),
      potential_low_usd: z.number().int().nonnegative(),
      potential_mid_usd: z.number().int().nonnegative(),
      potential_high_usd: z.number().int().nonnegative(),
      potential_assumptions: z.array(z.string().min(1)).min(1).max(12),
      what_changes_value: z.array(z.string().min(1)).min(1).max(12),
    }),
  })
  .superRefine((value, ctx) => {
    const current = value.valuation;
    if (!(current.low_usd <= current.mid_usd && current.mid_usd <= current.high_usd)) {
      ctx.addIssue({ code: "custom", path: ["valuation"], message: "Current valuation range must be ordered low to high" });
    }
    if (!(current.potential_low_usd <= current.potential_mid_usd && current.potential_mid_usd <= current.potential_high_usd)) {
      ctx.addIssue({ code: "custom", path: ["valuation"], message: "Potential valuation range must be ordered low to high" });
    }
  });

const marketSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    tam_summary: { type: "string" },
    target_users: { type: "array", items: { type: "string" } },
    competitors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          url: { type: "string" },
          differentiator: { type: "string" },
          evidence_basis: { type: "string" },
        },
        required: ["name", "url", "differentiator", "evidence_basis"],
      },
    },
    monetization: { type: "array", items: { type: "string" } },
    demand_score: { type: "integer" },
    ship_readiness_score: { type: "integer" },
    risks: { type: "array", items: { type: "string" } },
    verdict: { type: "string", enum: ["ship_now", "finish_first", "combine_first", "shelve"] },
    need_assessment: {
      type: "object",
      additionalProperties: false,
      properties: {
        score: { type: "integer", minimum: 0, maximum: 100 },
        problem: { type: "string" },
        urgency: { type: "string", enum: ["low", "medium", "high", "critical"] },
        evidence_confidence: { type: "string", enum: ["low", "medium", "high"] },
        supporting_evidence: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              claim: { type: "string" },
              source: { type: "string" },
              strength: { type: "string", enum: ["assumption", "weak", "moderate", "strong"] },
            },
            required: ["claim", "source", "strength"],
          },
        },
        counter_evidence: { type: "array", items: { type: "string" } },
        validation_experiments: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              experiment: { type: "string" },
              success_metric: { type: "string" },
              effort: { type: "string", enum: ["hours", "days", "weeks"] },
            },
            required: ["experiment", "success_metric", "effort"],
          },
        },
        decision: { type: "string", enum: ["build_now", "validate_first", "deprioritize"] },
      },
      required: [
        "score", "problem", "urgency", "evidence_confidence", "supporting_evidence",
        "counter_evidence", "validation_experiments", "decision",
      ],
    },
    next_best_actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          why: { type: "string" },
          impact: { type: "string", enum: ["low", "medium", "high"] },
          effort: { type: "string", enum: ["hours", "days", "weeks"] },
          acceptance_check: { type: "string" },
        },
        required: ["title", "why", "impact", "effort", "acceptance_check"],
      },
    },
    valuation: {
      type: "object",
      additionalProperties: false,
      properties: {
        low_usd: { type: "integer" },
        mid_usd: { type: "integer" },
        high_usd: { type: "integer" },
        reasoning: { type: "string" },
        basis: { type: "string", enum: ["replacement_cost", "revenue_multiple", "market_comparables", "scenario_only"] },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        evidence: { type: "array", items: { type: "string" } },
        missing_information: { type: "array", items: { type: "string" } },
        potential_low_usd: { type: "integer" },
        potential_mid_usd: { type: "integer" },
        potential_high_usd: { type: "integer" },
        potential_assumptions: { type: "array", items: { type: "string" } },
        what_changes_value: { type: "array", items: { type: "string" } },
      },
      required: [
        "low_usd", "mid_usd", "high_usd", "reasoning", "basis", "confidence", "evidence",
        "missing_information", "potential_low_usd", "potential_mid_usd", "potential_high_usd",
        "potential_assumptions", "what_changes_value",
      ],
    },
  },
  required: [
    "tam_summary", "target_users", "competitors", "monetization",
    "demand_score", "ship_readiness_score", "risks", "verdict", "need_assessment", "next_best_actions", "valuation",
  ],
};

router.post(
  "/vibe-tools/market-value",
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = idInput.parse(req.body);
    const item = await loadItem(req.supabase!, data.analysisId, data.itemRank);
    const prefs = await loadPrefs(req.supabase!, req.userId!);
    const githubToken = await loadGhToken(req.supabase!, req.userId!);
    const evidenceResults = await Promise.allSettled(
      item.repos.slice(0, 5).map((repo) => loadRepositoryEvidence(githubToken, repo)),
    );
    const repositoryEvidence = evidenceResults
      .filter((result): result is PromiseFulfilledResult<RepositoryEvidence> => result.status === "fulfilled")
      .map((result) => result.value);
    const unavailableRepositories = evidenceResults
      .map((result, index) => (result.status === "rejected" ? item.repos[index] : null))
      .filter((repo): repo is string => Boolean(repo));

    const sys = `You are an evidence-disciplined product strategist, market analyst, and software valuator.

Separate facts, inferences, and assumptions. You do not have live web research in this request. Repository metadata is evidence about the asset, not proof of market demand. Never invent revenue, customers, traffic, search volume, acquisition comparables, competitor facts, or verified URLs. A competitor URL may be empty when it cannot be supported; explain the evidence basis either way.

Produce:
- a TAM framing that is explicitly labeled as a directional hypothesis when external sources are absent
- 3-5 concrete target-user personas and 2-4 monetization paths ranked by fit
- direct competitors or substitute workflows, each with an evidence_basis
- demand_score 0-100 and ship_readiness_score 0-100, calibrated to the supplied evidence
- need_assessment: the exact user problem, urgency, 0-100 need score, evidence confidence, supporting and counter-evidence, cheap validation experiments with measurable pass/fail thresholds, and a build/validate/deprioritize decision
- 3-6 next_best_actions ordered by impact, with effort and an objective acceptance check
- risks and a verdict (ship_now | finish_first | combine_first | shelve)
- CURRENT valuation low/mid/high based only on what exists today; use replacement cost when no traction or revenue evidence exists
- POTENTIAL valuation low/mid/high as a separate scenario, with explicit assumptions required to reach it
- valuation basis, confidence, evidence, missing information, and the facts that would materially change value

Ranges must be ordered low <= mid <= high and non-negative. Most unfinished, pre-revenue side projects have modest current value. Be blunt, specific, and conservative.`;

    const usr = `Project: ${item.title}
Pitch: ${item.pitch}
Kind: ${item.kind}
Source repos: ${item.repos.join(", ")}
Tech stack: ${item.tech_stack.join(", ") || "unknown"}
Effort remaining (0-10): ${item.effort}
Estimated hours: ${item.estimated_hours ?? "unknown"}
Existing next steps: ${item.next_steps.slice(0, 5).join(" | ")}`;

    const evidencePacket = `Repository evidence (GitHub API, current at assessment time):
${JSON.stringify(repositoryEvidence, null, 2)}
Repositories whose evidence was unavailable: ${unavailableRepositories.join(", ") || "none"}

Treat missing evidence as missing. Do not convert it into a positive claim.`;

    const resp = await callAI(
      {
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `${usr}\n\n${evidencePacket}` },
        ],
        responseFormat: { type: "json_schema", json_schema: { name: "market_and_value", strict: true, schema: marketSchema } },
      },
      { provider: prefs?.custom_ai_provider || "openai", apiKey: prefs?.custom_ai_key || null },
    );

    const parsed = marketResultSchema.parse(JSON.parse(resp.content || "{}"));
    const { valuation, ...market } = parsed;

    await updateItem(req.supabase!, item.id, { market_analysis: market, valuation });

    res.json({ market, valuation });
  }),
);

const vibeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    product_name: { type: "string" },
    tagline: { type: "string" },
    prd_md: { type: "string" },
    lovable_prompt: { type: "string" },
    landing_hero: { type: "string" },
    landing_subhead: { type: "string" },
    landing_bullets: { type: "array", items: { type: "string" } },
    cta: { type: "string" },
    launch_checklist: { type: "array", items: { type: "string" } },
  },
  required: [
    "product_name", "tagline", "prd_md", "lovable_prompt",
    "landing_hero", "landing_subhead", "landing_bullets", "cta", "launch_checklist",
  ],
};

router.post(
  "/vibe-tools/vibe-spec",
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = idInput.parse(req.body);
    const item = await loadItem(req.supabase!, data.analysisId, data.itemRank);
    const prefs = await loadPrefs(req.supabase!, req.userId!);

    const sys = `You are a product engineer and copywriter. Turn a GitHub-derived project idea into a ready-to-ship spec:
- product_name: short, memorable
- tagline: one line
- prd_md: complete PRD in markdown (Problem, Users, Core features, Non-goals, Success metrics, Tech stack, MVP scope)
- lovable_prompt: a single self-contained prompt (300-600 words) that someone can paste into Lovable.dev to scaffold the whole product in one shot
- landing_hero / landing_subhead / landing_bullets (4) / cta
- launch_checklist: 8-12 concrete, ordered items from "code done" to "first paying user"`;

    const usr = `Project: ${item.title}
Pitch: ${item.pitch}
Source repos: ${item.repos.join(", ")}
Tech stack: ${item.tech_stack.join(", ") || "flexible"}
Kind: ${item.kind}
Existing next steps: ${item.next_steps.join(" | ")}`;

    const resp = await callAI(
      {
        messages: [
          { role: "system", content: sys },
          { role: "user", content: usr },
        ],
        responseFormat: { type: "json_schema", json_schema: { name: "vibe_spec", strict: true, schema: vibeSchema } },
      },
      { provider: prefs?.custom_ai_provider || "openai", apiKey: prefs?.custom_ai_key || null },
    );

    const spec = JSON.parse(resp.content || "{}");
    await updateItem(req.supabase!, item.id, { vibe_spec: spec });
    res.json(spec);
  }),
);

router.post(
  "/vibe-tools/combine",
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = idInput.parse(req.body);
    const item = await loadItem(req.supabase!, data.analysisId, data.itemRank);
    if (item.repos.length < 2) throw Object.assign(new Error("Need at least 2 repos to combine."), { status: 400 });

    const token = await loadGhToken(req.supabase!, req.userId!);
    const prefs = await loadPrefs(req.supabase!, req.userId!);

    const planSchema = {
      type: "object",
      additionalProperties: false,
      properties: {
        repo_name: { type: "string" },
        description: { type: "string" },
        readme_md: { type: "string" },
        structure: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: { path: { type: "string" }, purpose: { type: "string" } },
            required: ["path", "purpose"],
          },
        },
        integration_plan_md: { type: "string" },
        first_pr_title: { type: "string" },
      },
      required: ["repo_name", "description", "readme_md", "structure", "integration_plan_md", "first_pr_title"],
    };

    const planResp = await callAI(
      {
        messages: [
          {
            role: "system",
            content:
              "You design a new monorepo that combines multiple existing GitHub repos into one shippable product. Choose a short kebab-case repo_name (<40 chars), write a rich README, propose a folder structure that maps source repos into subpackages, and write an integration plan.",
          },
          {
            role: "user",
            content: `Combined product: ${item.title}\nPitch: ${item.pitch}\nSource repos: ${item.repos.join(", ")}\nTech stack: ${item.tech_stack.join(", ") || "flexible"}`,
          },
        ],
        responseFormat: { type: "json_schema", json_schema: { name: "combine_plan", strict: true, schema: planSchema } },
      },
      { provider: prefs?.custom_ai_provider || "openai", apiKey: prefs?.custom_ai_key || null },
    );

    const plan = JSON.parse(planResp.content || "{}") as {
      repo_name: string;
      description: string;
      readme_md: string;
      structure: { path: string; purpose: string }[];
      integration_plan_md: string;
      first_pr_title: string;
    };

    const meRes = await gh(token, "/user");
    if (!meRes.ok) throw new Error("GitHub /user failed");

    const repoName = plan.repo_name.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 60);
    const createRes = await gh(token, "/user/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: repoName, description: plan.description.slice(0, 350), private: false, auto_init: true }),
    });
    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Create repo failed: ${createRes.status} ${err.slice(0, 200)}`);
    }
    const newRepo = (await createRes.json()) as { full_name: string; html_url: string; default_branch: string };

    async function putFile(path: string, content: string, message: string) {
      const r = await gh(token, `/repos/${newRepo.full_name}/contents/${path}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, content: Buffer.from(content).toString("base64"), branch: newRepo.default_branch }),
      });
      return r.ok;
    }

    const headerLinks = item.repos.map((r) => `- [${r}](https://github.com/${r})`).join("\n");
    const readme = `# ${item.title}\n\n${plan.description}\n\n## Combines\n${headerLinks}\n\n---\n\n${plan.readme_md}`;
    await putFile("README.md", readme, "docs: combined README");
    await putFile("INTEGRATION_PLAN.md", plan.integration_plan_md, "docs: integration plan");

    for (const node of plan.structure.slice(0, 20)) {
      const safePath = node.path.replace(/^\/+/, "").replace(/\.\./g, "");
      if (!safePath) continue;
      await putFile(`${safePath}/README.md`, `# ${safePath}\n\n${node.purpose}\n`, `scaffold: ${safePath}`);
    }

    const issueLinks: { repo: string; url: string }[] = [];
    for (const srcRepo of item.repos) {
      const iRes = await gh(token, `/repos/${srcRepo}/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Combining into ${newRepo.full_name}`,
          body: `This repo is being merged into a combined product: **${item.title}**.\n\nCombined repo: ${newRepo.html_url}\n\n${plan.integration_plan_md.slice(0, 1500)}`,
        }),
      });
      if (iRes.ok) {
        const j = (await iRes.json()) as { html_url: string };
        issueLinks.push({ repo: srcRepo, url: j.html_url });
      }
    }

    const result = {
      combined_repo: newRepo.full_name,
      combined_url: newRepo.html_url,
      source_issues: issueLinks,
      structure: plan.structure,
      integration_plan_md: plan.integration_plan_md,
    };

    await updateItem(req.supabase!, item.id, { combine_result: result });
    res.json(result);
  }),
);

/**
 * Milestone breakdown for "finish this repository".
 *
 * This replaces `/vibe-tools/iterative-finish`, which ran up to four
 * unreviewed AI passes in a loop, each one committing to the user's repository
 * and opening a PR. Nothing here writes: it returns the milestone plan so the
 * user can approve milestones one at a time, then drive each through
 * `/repo-finisher/plan` → `/repo-finisher/execute`, where every file path is
 * approved explicitly before anything is committed.
 */
const MILESTONE_PLAN: { title: string; goals: string[] }[] = [
  {
    title: "Milestone 1 — make the project legible",
    goals: [
      "Add or overhaul README.md with install/usage/API",
      "Add MIT LICENSE if missing",
      "Add .github/workflows/ci.yml with lint + build",
    ],
  },
  {
    title: "Milestone 2 — prove it works",
    goals: ["Add unit tests for core exports", "Add example usage in examples/", "Wire the test job into CI"],
  },
  {
    title: "Milestone 3 — finish the implementation",
    goals: [
      "Fix obvious bugs and complete stub functions",
      "Add error handling around external calls",
      "Add TypeScript types where missing",
    ],
  },
  {
    title: "Milestone 4 — prepare for release",
    goals: [
      "Add a contributing guide and issue templates",
      "Polish docs, add badges and screenshots",
      "Draft v0.1.0 release notes",
    ],
  },
];

router.post(
  "/vibe-tools/milestone-plan",
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = z
      .object({
        analysisId: z.string().uuid(),
        itemRank: z.number().int(),
        repo: z.string(),
        milestones: z.number().int().min(1).max(4).optional(),
      })
      .parse(req.body);

    const count = data.milestones ?? 3;
    const milestones = MILESTONE_PLAN.slice(0, count).map((milestone, index) => ({
      order: index + 1,
      title: milestone.title,
      goals: milestone.goals,
    }));

    const item = await loadItem(req.supabase!, data.analysisId, data.itemRank);
    await updateItem(req.supabase!, item.id, { milestone_plan: milestones });

    res.json({
      repo: data.repo,
      milestones,
      next_step:
        "Approve a milestone, then POST its goals to /repo-finisher/plan and approve the individual file paths before executing.",
    });
  }),
);

export default router;
