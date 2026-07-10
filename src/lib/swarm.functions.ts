// Swarm: plan + execute an entire analysis worth of recommendations in parallel.
// Careful defaults — fragile / high-impact items get "gentle" additive-only PRs.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAI } from "@/lib/ai-provider";
import type { Json } from "@/integrations/supabase/types";

type Action = "iterative_finish" | "gentle_finish" | "combine" | "vibe_spec" | "skip";

interface PlanItem {
  item_rank: number;
  item_id: string;
  kind: string;
  title: string;
  repos: string[];
  impact: number; // 0-100
  fragility: number; // 0-100
  action: Action;
  reason: string;
}

interface ResultItem {
  item_rank: number;
  action: Action;
  status: "ok" | "error" | "skipped";
  message: string;
  pr_urls?: string[];
  combined_url?: string;
  duration_ms: number;
}

async function loadPrefs(supabase: unknown, userId: string) {
  const s = supabase as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, v: string) => { maybeSingle: () => Promise<{ data: unknown }> };
      };
    };
  };
  const { data } = await s
    .from("user_preferences")
    .select("custom_ai_provider, custom_ai_key")
    .eq("user_id", userId)
    .maybeSingle();
  return (data ?? null) as {
    custom_ai_provider: string | null;
    custom_ai_key: string | null;
  } | null;
}

// ─── PLAN ───────────────────────────────────────────────────────

export const planSwarm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (d: {
      analysisId: string;
      concurrency?: number;
      autonomyMode?: "dry_run" | "safe_auto" | "full_gentle";
    }) =>
      z
        .object({
          analysisId: z.string().uuid(),
          concurrency: z.number().int().min(1).max(8).optional(),
          autonomyMode: z.enum(["dry_run", "safe_auto", "full_gentle"]).optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (
            c: string,
            v: string,
          ) => {
            order: (
              c: string,
              o: { ascending: boolean },
            ) => Promise<{ data: unknown; error: unknown }>;
          };
        };
        insert: (v: Record<string, unknown>) => {
          select: (c: string) => { single: () => Promise<{ data: unknown; error: unknown }> };
        };
      };
    };

    const { data: itemsRaw, error } = await supabase
      .from("analysis_items")
      .select("id, rank, kind, title, repos, pitch, effort, market_potential, next_steps")
      .eq("analysis_id", data.analysisId)
      .order("rank", { ascending: true });
    if (error) throw new Error(`Load items failed: ${JSON.stringify(error)}`);

    const items = (itemsRaw as Array<{
      id: string;
      rank: number;
      kind: string;
      title: string;
      repos: string[];
      pitch: string;
      effort: number;
      market_potential: number;
      next_steps: string[];
    }>) || [];

    if (items.length === 0) throw new Error("Analysis has no recommendations to swarm.");

    const prefs = await loadPrefs(context.supabase, context.userId);

    const triageSchema = {
      type: "object",
      additionalProperties: false,
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              item_rank: { type: "integer" },
              impact: { type: "integer" },
              fragility: { type: "integer" },
              action: {
                type: "string",
                enum: ["iterative_finish", "gentle_finish", "combine", "vibe_spec", "skip"],
              },
              reason: { type: "string" },
            },
            required: ["item_rank", "impact", "fragility", "action", "reason"],
          },
        },
        summary: { type: "string" },
      },
      required: ["items", "summary"],
    };

    const sys = `You are a careful engineering lead triaging a repo portfolio for a "swarm" auto-execution run.
For each recommendation, score:
- impact (0-100): market_potential × how obvious the win is
- fragility (0-100): risk that automated PRs would break something already close to shipping. High effort remaining = LOW fragility (lots of room to work). Low effort remaining on a polished repo = HIGH fragility.

Then choose ONE action, obeying these strict rules:
- kind="combine" with 2+ repos → "combine" (unless impact < 40, then "skip")
- kind="repurpose" → "vibe_spec" (never touches code)
- kind="finish" AND fragility >= 60 AND impact >= 60 → "gentle_finish" (additive-only: README, LICENSE, CI, .env.example — NEVER src/)
- kind="finish" AND fragility < 60 AND impact >= 50 → "iterative_finish" (3 full passes)
- kind="finish" AND impact >= 70 (any fragility) → at minimum "gentle_finish"
- impact < 40 → "skip"
- Anything else → "skip"

Write a 2-3 sentence summary explaining the overall plan (how many of each action, what the big bets are).
Be blunt. Prefer to skip weak items rather than waste PRs.`;

    const usr = items
      .map(
        (it) =>
          `#${it.rank} [${it.kind}] ${it.title}
repos: ${it.repos.join(", ") || "(none)"}
effort_remaining: ${it.effort}/5  market_potential: ${it.market_potential}/5
pitch: ${it.pitch.slice(0, 200)}
next_steps: ${(it.next_steps || []).slice(0, 3).join(" | ")}`,
      )
      .join("\n\n");

    const resp = await callAI(
      {
        messages: [
          { role: "system", content: sys },
          { role: "user", content: usr },
        ],
        responseFormat: {
          type: "json_schema",
          json_schema: { name: "swarm_plan", strict: true, schema: triageSchema },
        },
      },
      { provider: prefs?.custom_ai_provider || "openai", apiKey: prefs?.custom_ai_key || null },
    );

    const parsed = JSON.parse(resp.content || "{}") as {
      items: Array<{
        item_rank: number;
        impact: number;
        fragility: number;
        action: Action;
        reason: string;
      }>;
      summary: string;
    };

    const plan: PlanItem[] = parsed.items
      .map((p) => {
        const src = items.find((i) => i.rank === p.item_rank);
        if (!src) return null;
        return {
          item_rank: p.item_rank,
          item_id: src.id,
          kind: src.kind,
          title: src.title,
          repos: src.repos || [],
          impact: p.impact,
          fragility: p.fragility,
          action: p.action,
          reason: p.reason,
        };
      })
      .filter((x): x is PlanItem => x !== null);

    const { data: inserted, error: insErr } = await supabase
      .from("swarm_runs")
      .insert({
        analysis_id: data.analysisId,
        user_id: context.userId,
        status: "planned",
        autonomy_mode: data.autonomyMode ?? "dry_run",
        concurrency: data.concurrency ?? 5,
        plan: plan as unknown as Json,
        summary: parsed.summary,
      })
      .select("id")
      .single();
    if (insErr) throw new Error(`Save swarm failed: ${JSON.stringify(insErr)}`);

    return {
      swarmRunId: (inserted as { id: string }).id,
      plan,
      summary: parsed.summary,
    };
  });

// ─── EXECUTE ────────────────────────────────────────────────────

async function runOne(
  args: {
    item: PlanItem;
    analysisId: string;
  },
): Promise<ResultItem> {
  const started = Date.now();
  const { item, analysisId } = args;
  try {
    if (item.action === "skip") {
      return {
        item_rank: item.item_rank,
        action: "skip",
        status: "skipped",
        message: item.reason,
        duration_ms: Date.now() - started,
      };
    }

    if (item.action === "vibe_spec") {
      const { generateVibeSpec } = await import("@/lib/vibe-tools.functions");
      await generateVibeSpec({ data: { analysisId, itemRank: item.item_rank } });
      return {
        item_rank: item.item_rank,
        action: "vibe_spec",
        status: "ok",
        message: "Vibe spec + Lovable prompt generated",
        duration_ms: Date.now() - started,
      };
    }

    if (item.action === "combine") {
      const { combineRepos } = await import("@/lib/vibe-tools.functions");
      const res = (await combineRepos({
        data: { analysisId, itemRank: item.item_rank },
      })) as { combined_repo: string; combined_url: string };
      return {
        item_rank: item.item_rank,
        action: "combine",
        status: "ok",
        message: `Created ${res.combined_repo}`,
        combined_url: res.combined_url,
        duration_ms: Date.now() - started,
      };
    }

    if (item.action === "gentle_finish") {
      const { finishRepo } = await import("@/lib/repo-finisher.functions");
      const repo = item.repos[0];
      if (!repo) throw new Error("No repo");
      const gentleSteps = [
        "Add or overhaul README.md with install/usage — do NOT touch any file under src/, lib/, app/, or pages/",
        "Add MIT LICENSE if missing",
        "Add .github/workflows/ci.yml with lint + build only",
        "Add .env.example if the repo uses env vars",
        "Add CONTRIBUTING.md and .github/ISSUE_TEMPLATE if missing",
        "STRICT: only create/modify docs, CI, license, .env.example. NEVER edit source code.",
      ];
      const res = (await finishRepo({
        data: {
          repo,
          nextSteps: gentleSteps,
          analysisId,
          itemRank: item.item_rank,
        },
      })) as { pr_url: string; pr_number: number; files_changed: number };
      return {
        item_rank: item.item_rank,
        action: "gentle_finish",
        status: "ok",
        message: `Gentle PR #${res.pr_number} · ${res.files_changed} additive files`,
        pr_urls: [res.pr_url],
        duration_ms: Date.now() - started,
      };
    }

    if (item.action === "iterative_finish") {
      const { iterativeFinish } = await import("@/lib/vibe-tools.functions");
      const repo = item.repos[0];
      if (!repo) throw new Error("No repo");
      const res = (await iterativeFinish({
        data: { analysisId, itemRank: item.item_rank, repo, passes: 3 },
      })) as {
        history: Array<{ pr_url?: string; pr_number?: number }>;
        passes_completed: number;
      };
      const prs = res.history.filter((h) => h.pr_url).map((h) => h.pr_url!) as string[];
      return {
        item_rank: item.item_rank,
        action: "iterative_finish",
        status: "ok",
        message: `${res.passes_completed}/3 passes shipped`,
        pr_urls: prs,
        duration_ms: Date.now() - started,
      };
    }

    return {
      item_rank: item.item_rank,
      action: item.action,
      status: "error",
      message: "Unknown action",
      duration_ms: Date.now() - started,
    };
  } catch (e) {
    return {
      item_rank: item.item_rank,
      action: item.action,
      status: "error",
      message: e instanceof Error ? e.message.slice(0, 300) : "unknown error",
      duration_ms: Date.now() - started,
    };
  }
}

async function parallelMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export const executeSwarm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { swarmRunId: string }) =>
    z.object({ swarmRunId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (
            c: string,
            v: string,
          ) => {
            eq: (
              c: string,
              v: string,
            ) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> };
          };
        };
        update: (v: Record<string, unknown>) => {
          eq: (c: string, v: string) => Promise<{ error: unknown }>;
        };
      };
    };

    const { data: run, error } = await supabase
      .from("swarm_runs")
      .select("id, analysis_id, plan, concurrency, status")
      .eq("id", data.swarmRunId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error || !run) throw new Error("Swarm run not found");

    const r = run as {
      id: string;
      analysis_id: string;
      plan: PlanItem[];
      concurrency: number;
      status: string;
    };
    if (r.status === "running") throw new Error("Swarm already running");

    await supabase
      .from("swarm_runs")
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("id", r.id);

    const actionable = r.plan.filter((p) => p.action !== "skip");
    const skipped = r.plan.filter((p) => p.action === "skip");

    const executed = await parallelMap(actionable, r.concurrency, (item) =>
      runOne({ item, analysisId: r.analysis_id }),
    );

    const results: ResultItem[] = [
      ...executed,
      ...skipped.map((s) => ({
        item_rank: s.item_rank,
        action: s.action,
        status: "skipped" as const,
        message: s.reason,
        duration_ms: 0,
      })),
    ].sort((a, b) => a.item_rank - b.item_rank);

    const ok = results.filter((x) => x.status === "ok").length;
    const errored = results.filter((x) => x.status === "error").length;
    const finalStatus = errored > 0 && ok === 0 ? "failed" : "complete";

    await supabase
      .from("swarm_runs")
      .update({
        status: finalStatus,
        results: results as unknown as Json,
        updated_at: new Date().toISOString(),
      })
      .eq("id", r.id);

    return { swarmRunId: r.id, results, ok, errored, skipped: skipped.length };
  });

// ─── GET (for polling / re-open) ───────────────────────────────

export const getSwarmRun = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { swarmRunId: string }) =>
    z.object({ swarmRunId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (
            c: string,
            v: string,
          ) => {
            eq: (
              c: string,
              v: string,
            ) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> };
          };
        };
      };
    };
    const { data: run, error } = await supabase
      .from("swarm_runs")
      .select("id, status, autonomy_mode, concurrency, plan, results, summary, created_at, updated_at")
      .eq("id", data.swarmRunId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error || !run) throw new Error("Swarm run not found");
    return run;
  });
