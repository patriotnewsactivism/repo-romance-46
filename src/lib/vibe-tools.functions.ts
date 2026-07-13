// Vibe tools: market/valuation, launch spec generator, multi-repo combiner, iterative auto-finish.
// All four operate on a single analysis_item and persist results back to that row.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAI, resolveAIConfig } from "@/lib/ai-provider";
import type { Json } from "@/integrations/supabase/types";
import { logLearningEntry } from "@/lib/learning-log.functions";

const ASJSON = "as unknown as Json";
type Ctx = { supabase: unknown; userId: string };

// ─── shared helpers ────────────────────────────────────────────

async function loadItem(
  supabase: {
    from: (t: string) => {
      select: (c: string) => {
        eq: (
          col: string,
          v: string | number,
        ) => {
          eq: (
            col: string,
            v: string | number,
          ) => { maybeSingle: () => Promise<{ data: unknown }> };
        };
      };
    };
  },
  analysisId: string,
  itemRank: number,
) {
  const { data } = await supabase
    .from("analysis_items")
    .select(
      "id, kind, title, pitch, repos, next_steps, tech_stack, effort, market_potential, estimated_hours",
    )
    .eq("analysis_id", analysisId)
    .eq("rank", itemRank)
    .maybeSingle();
  if (!data) throw new Error("Item not found");
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

async function updateItem(supabase: unknown, itemId: string, patch: Record<string, unknown>) {
  const s = supabase as {
    from: (t: string) => {
      update: (p: Record<string, unknown>) => {
        eq: (col: string, v: string) => Promise<unknown>;
      };
    };
  };
  await s.from("analysis_items").update(patch).eq("id", itemId);
}

async function loadGhToken(supabase: unknown, userId: string): Promise<string> {
  const s = supabase as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, v: string) => { maybeSingle: () => Promise<{ data: unknown }> };
      };
    };
  };
  const { data } = await s
    .from("github_connections")
    .select("access_token, github_login")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new Error("Connect GitHub first.");
  return (data as { access_token: string }).access_token;
}

// ─── 1. MARKET & VALUATION ────────────────────────────────────

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
        },
        required: ["name", "url", "differentiator"],
      },
    },
    monetization: { type: "array", items: { type: "string" } },
    demand_score: { type: "integer" }, // 0-100
    ship_readiness_score: { type: "integer" }, // 0-100
    risks: { type: "array", items: { type: "string" } },
    verdict: { type: "string", enum: ["ship_now", "finish_first", "combine_first", "shelve"] },
    valuation: {
      type: "object",
      additionalProperties: false,
      properties: {
        low_usd: { type: "integer" },
        mid_usd: { type: "integer" },
        high_usd: { type: "integer" },
        reasoning: { type: "string" },
      },
      required: ["low_usd", "mid_usd", "high_usd", "reasoning"],
    },
  },
  required: [
    "tam_summary",
    "target_users",
    "competitors",
    "monetization",
    "demand_score",
    "ship_readiness_score",
    "risks",
    "verdict",
    "valuation",
  ],
};

export const assessMarketAndValue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { analysisId: string; itemRank: number }) =>
    z.object({ analysisId: z.string().uuid(), itemRank: z.number().int() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const item = await loadItem(context.supabase as never, data.analysisId, data.itemRank);
    const aiConfig = await resolveAIConfig(context.supabase, context.userId);

    const sys = `You are a market analyst and startup valuator. Given a software project idea derived from GitHub repos, produce:
- a realistic TAM summary (1-2 sentences)
- target users (3-5 concrete personas)
- 3-5 direct competitors with URL + one-line differentiator
- 2-4 monetization paths ranked by fit
- demand_score 0-100 (real current market pull)
- ship_readiness_score 0-100 (how close to launchable)
- top risks (3-5 items)
- verdict (ship_now | finish_first | combine_first | shelve)
- USD valuation range as an indie/bootstrapped micro-SaaS acquisition target (low/mid/high) with reasoning
Be blunt and specific. No fluff.`;

    const usr = `Project: ${item.title}
Pitch: ${item.pitch}
Kind: ${item.kind}
Source repos: ${item.repos.join(", ")}
Tech stack: ${item.tech_stack.join(", ") || "unknown"}
Effort remaining (0-10): ${item.effort}
Estimated hours: ${item.estimated_hours ?? "unknown"}
Existing next steps: ${item.next_steps.slice(0, 5).join(" | ")}`;

    const resp = await callAI(
      {
        messages: [
          { role: "system", content: sys },
          { role: "user", content: usr },
        ],
        responseFormat: {
          type: "json_schema",
          json_schema: { name: "market_and_value", strict: true, schema: marketSchema },
        },
      },
      aiConfig,
    );

    const parsed = JSON.parse(resp.content || "{}");
    const { valuation, ...market } = parsed;

    await updateItem(context.supabase, item.id, {
      market_analysis: market as Json,
      valuation: valuation as Json,
    });

    return { market, valuation };
  });

// ─── 2. VIBE SPEC (PRD + Lovable prompt + landing copy) ───────

const vibeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    product_name: { type: "string" },
    tagline: { type: "string" },
    prd_md: { type: "string" }, // full markdown PRD
    lovable_prompt: { type: "string" }, // paste-into-Lovable prompt
    landing_hero: { type: "string" },
    landing_subhead: { type: "string" },
    landing_bullets: { type: "array", items: { type: "string" } },
    cta: { type: "string" },
    launch_checklist: { type: "array", items: { type: "string" } },
  },
  required: [
    "product_name",
    "tagline",
    "prd_md",
    "lovable_prompt",
    "landing_hero",
    "landing_subhead",
    "landing_bullets",
    "cta",
    "launch_checklist",
  ],
};

export const generateVibeSpec = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { analysisId: string; itemRank: number }) =>
    z.object({ analysisId: z.string().uuid(), itemRank: z.number().int() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const item = await loadItem(context.supabase as never, data.analysisId, data.itemRank);
    const aiConfig = await resolveAIConfig(context.supabase, context.userId);

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
        responseFormat: {
          type: "json_schema",
          json_schema: { name: "vibe_spec", strict: true, schema: vibeSchema },
        },
      },
      aiConfig,
    );

    const spec = JSON.parse(resp.content || "{}");
    await updateItem(context.supabase, item.id, { vibe_spec: spec as Json });
    return spec;
  });

// ─── 3. COMBINE REPOS (create combined repo + link issues) ────

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

export const combineRepos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { analysisId: string; itemRank: number }) =>
    z.object({ analysisId: z.string().uuid(), itemRank: z.number().int() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const item = await loadItem(context.supabase as never, data.analysisId, data.itemRank);
    if (item.repos.length < 2) throw new Error("Need at least 2 repos to combine.");

    const token = await loadGhToken(context.supabase, context.userId);
    const aiConfig = await resolveAIConfig(context.supabase, context.userId);

    // AI plan for the combined repo
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
      required: [
        "repo_name",
        "description",
        "readme_md",
        "structure",
        "integration_plan_md",
        "first_pr_title",
      ],
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
        responseFormat: {
          type: "json_schema",
          json_schema: { name: "combine_plan", strict: true, schema: planSchema },
        },
      },
      aiConfig,
    );

    const plan = JSON.parse(planResp.content || "{}") as {
      repo_name: string;
      description: string;
      readme_md: string;
      structure: { path: string; purpose: string }[];
      integration_plan_md: string;
      first_pr_title: string;
    };

    // Get owner login
    const meRes = await gh(token, "/user");
    if (!meRes.ok) throw new Error("GitHub /user failed");
    const me = (await meRes.json()) as { login: string };

    // Create new repo (with auto-init so we can write files immediately)
    const repoName = plan.repo_name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .slice(0, 60);
    const createRes = await gh(token, "/user/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: repoName,
        description: plan.description.slice(0, 350),
        private: false,
        auto_init: true,
      }),
    });
    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Create repo failed: ${createRes.status} ${err.slice(0, 200)}`);
    }
    const newRepo = (await createRes.json()) as {
      full_name: string;
      html_url: string;
      default_branch: string;
    };

    // Write README + INTEGRATION_PLAN.md + structure placeholders
    async function putFile(path: string, content: string, message: string) {
      const res = await gh(token, `/repos/${newRepo.full_name}/contents/${path}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          content: Buffer.from(content).toString("base64"),
          branch: newRepo.default_branch,
        }),
      });
      return res.ok;
    }

    const headerLinks = item.repos.map((r) => `- [${r}](https://github.com/${r})`).join("\n");
    const readme = `# ${item.title}\n\n${plan.description}\n\n## Combines\n${headerLinks}\n\n---\n\n${plan.readme_md}`;
    await putFile("README.md", readme, "docs: combined README");
    await putFile("INTEGRATION_PLAN.md", plan.integration_plan_md, "docs: integration plan");

    // Scaffold structure with placeholder READMEs
    for (const node of plan.structure.slice(0, 20)) {
      const safePath = node.path.replace(/^\/+/, "").replace(/\.\./g, "");
      if (!safePath) continue;
      await putFile(
        `${safePath}/README.md`,
        `# ${safePath}\n\n${node.purpose}\n`,
        `scaffold: ${safePath}`,
      );
    }

    // Open a tracking issue on each source repo
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

    await updateItem(context.supabase, item.id, { combine_result: result as unknown as Json });
    return result;
  });

// ─── 4. ITERATIVE FINISH (multi-pass RepoFinisher) ────────────

export const iterativeFinish = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { analysisId: string; itemRank: number; repo: string; passes?: number }) =>
    z
      .object({
        analysisId: z.string().uuid(),
        itemRank: z.number().int(),
        repo: z.string(),
        passes: z.number().int().min(1).max(4).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { finishRepo } = await import("@/lib/repo-finisher.functions");
    const passes = data.passes ?? 3;
    const passPlans = [
      [
        "Add or overhaul README.md with install/usage/API",
        "Add MIT LICENSE if missing",
        "Add .github/workflows/ci.yml with lint + build",
      ],
      [
        "Add unit tests for core exports",
        "Add example usage in examples/ folder",
        "Wire test job into CI",
      ],
      [
        "Fix obvious bugs and complete stub functions",
        "Add error handling around external calls",
        "Add TypeScript types where missing",
      ],
      [
        "Add contributing guide and issue templates",
        "Polish docs, add badges and screenshots",
        "Prep a v0.1.0 release notes draft",
      ],
    ];

    const history: {
      pass: number;
      pr_url?: string;
      pr_number?: number;
      files_changed?: number;
      summary?: string;
      error?: string;
    }[] = [];

    for (let p = 0; p < passes; p++) {
      try {
        const res = (await finishRepo({
          data: {
            repo: data.repo,
            nextSteps: passPlans[p],
            analysisId: data.analysisId,
            itemRank: data.itemRank,
          },
        })) as { pr_url: string; pr_number: number; files_changed: number; summary: string };
        history.push({
          pass: p + 1,
          pr_url: res.pr_url,
          pr_number: res.pr_number,
          files_changed: res.files_changed,
          summary: res.summary,
        });
      } catch (e) {
        history.push({
          pass: p + 1,
          error: e instanceof Error ? e.message : "unknown",
        });
        break; // stop on failure
      }
    }

    const item = await loadItem(context.supabase as never, data.analysisId, data.itemRank);
    await updateItem(context.supabase, item.id, {
      finish_history: history as unknown as Json,
      iteration_count: history.filter((h) => h.pr_url).length,
    });

    // Log learning entries for each pass
    for (const h of history) {
      await logLearningEntry(context.supabase, context.userId, data.repo, {
        action: `iterative-finish-pass-${h.pass}`,
        outcome: h.error ? "failure" : "success",
        duration_ms: 0,
        details: h.error || h.summary || `Pass ${h.pass} completed`,
        files_affected: [],
        error_message: h.error,
        fix_pattern: `iterative-finish-pass-${h.pass}`,
        timestamp: new Date().toISOString(),
      });
    }

    return { history, passes_completed: history.filter((h) => h.pr_url).length };
  });

// keep tsc happy re: unused
void ASJSON;
void ({} as Ctx);
