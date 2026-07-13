// Activity Feed — centralized event log for all system actions.
// Every operation (analysis, finish, step, CI check, learning) is logged here
// to give the user a single timeline of everything happening across their repos.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

// ─── Types ─────────────────────────────────────────────────────

export type EventKind =
  | "analysis_started"
  | "analysis_completed"
  | "deep_analysis"
  | "finish_pr_created"
  | "finish_pr_merged"
  | "step_completed"
  | "step_failed"
  | "ci_passed"
  | "ci_failed"
  | "sequence_started"
  | "sequence_completed"
  | "sequence_stopped"
  | "autonomous_decision"
  | "autonomous_job"
  | "learning_logged"
  | "pattern_detected"
  | "scope_violation"
  | "safety_rail_triggered"
  | "swarm_started"
  | "swarm_completed"
  | "dependency_alert";

export type EventStatus = "info" | "success" | "warning" | "error";

export interface ActivityEvent {
  id: string;
  user_id: string;
  kind: EventKind;
  repo: string | null;
  title: string;
  detail: string | null;
  status: EventStatus;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ─── Logging helper (used by other modules) ────────────────────

/**
 * Log an activity event. Call from any module to record actions in the feed.
 * Uses the raw supabase client so it works from both server functions and cron.
 */
export async function logActivity(
  supabase: unknown,
  userId: string,
  event: {
    kind: EventKind;
    repo?: string | null;
    title: string;
    detail?: string | null;
    status?: EventStatus;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const sb = supabase as {
      from: (t: string) => {
        insert: (v: Record<string, unknown>) => Promise<unknown>;
      };
    };
    await sb.from("activity_events").insert({
      user_id: userId,
      kind: event.kind,
      repo: event.repo ?? null,
      title: event.title,
      detail: event.detail ?? null,
      status: event.status ?? "info",
      metadata: (event.metadata ?? {}) as Json,
    });
  } catch {
    // Activity logging should never break the parent operation
    console.error("[activity-feed] Failed to log event:", event.title);
  }
}

// ─── Server functions ──────────────────────────────────────────

/**
 * Get the activity feed for the current user.
 * Supports filtering by repo and pagination.
 */
export const getActivityFeed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(
    (d: { repo?: string; limit?: number; offset?: number; kinds?: string[] }) =>
      z
        .object({
          repo: z.string().optional(),
          limit: z.number().int().min(1).max(100).optional(),
          offset: z.number().int().min(0).optional(),
          kinds: z.array(z.string()).optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    let query = context.supabase
      .from("activity_events")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 30)
      .range(data.offset ?? 0, (data.offset ?? 0) + (data.limit ?? 30) - 1);

    if (data.repo) {
      query = query.eq("repo", data.repo);
    }

    if (data.kinds && data.kinds.length > 0) {
      query = query.in("kind", data.kinds);
    }

    const { data: events, error } = await query;
    if (error) throw new Error(`Failed to load activity feed: ${error.message}`);

    return { events: (events ?? []) as ActivityEvent[] };
  });

/**
 * Get activity stats — summary counts by kind and status.
 */
export const getActivityStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Get counts from last 24 hours
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: events } = await context.supabase
      .from("activity_events")
      .select("kind, status")
      .eq("user_id", context.userId)
      .gte("created_at", since);

    const all = (events ?? []) as { kind: string; status: string }[];

    const byStatus = {
      success: all.filter((e) => e.status === "success").length,
      warning: all.filter((e) => e.status === "warning").length,
      error: all.filter((e) => e.status === "error").length,
      info: all.filter((e) => e.status === "info").length,
    };

    const byKind: Record<string, number> = {};
    for (const e of all) {
      byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    }

    return {
      last24h: all.length,
      byStatus,
      byKind,
    };
  });
