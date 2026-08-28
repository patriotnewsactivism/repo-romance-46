import { Router, type IRouter } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { requireAuth } from "../middlewares/auth";
import { loadGithubCredential, requireGithubCredential } from "../lib/credentials";
import { reasonAboutRepositoryPlan } from "../lib/reasoning-orchestrator";
import { recordOperationalMemory } from "../lib/learning-memory";

const router: IRouter = Router();

interface GitHubEvent {
  id: string;
  type: string;
  created_at?: string;
  actor?: { login?: string };
  payload?: Record<string, unknown>;
}

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "repo-finisher-continuous",
  };
}

async function ghEvents(token: string, repo: string): Promise<GitHubEvent[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/events?per_page=50`, { headers: ghHeaders(token), signal: controller.signal });
    if (!response.ok) throw new Error(`GitHub events returned ${response.status} for ${repo}`);
    return await response.json() as GitHubEvent[];
  } finally {
    clearTimeout(timer);
  }
}

function normalizeEventType(type: string) {
  const map: Record<string, string> = {
    PushEvent: "push",
    PullRequestEvent: "pull_request",
    ReleaseEvent: "release",
    CreateEvent: "create",
    DeleteEvent: "delete",
    IssuesEvent: "issues",
    IssueCommentEvent: "issue_comment",
    PullRequestReviewEvent: "pull_request_review",
  };
  return map[type] ?? type.replace(/Event$/, "").replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`).replace(/^_/, "");
}

function eventSummary(repo: string, event: GitHubEvent) {
  const type = normalizeEventType(event.type);
  const payload = event.payload ?? {};
  if (type === "push") {
    const commits = Array.isArray(payload.commits) ? payload.commits.length : 0;
    return `${repo} received a push with ${commits} commit${commits === 1 ? "" : "s"}. Re-evaluate completion/readiness and verify that the change did not regress core product behavior.`;
  }
  if (type === "pull_request") {
    const action = String(payload.action || "changed");
    return `${repo} pull request ${action}. Re-check integration risk, CI evidence, and whether the repository's completion plan should change.`;
  }
  if (type === "release") return `${repo} published or changed a release. Re-score production readiness, deployment evidence, and commercial readiness.`;
  return `${repo} GitHub event '${type}' occurred. Determine whether it materially changes completion, reliability, security, or product value.`;
}

async function enqueueNewEvents(
  supabase: Parameters<typeof reasonAboutRepositoryPlan>[0],
  userId: string,
  repo: string,
  events: GitHubEvent[],
  allowed: string[],
  lastEventId: string | null,
) {
  const selected: GitHubEvent[] = [];
  for (const event of events) {
    if (event.id === lastEventId) break;
    const type = normalizeEventType(event.type);
    if (allowed.length && !allowed.includes(type) && !allowed.includes(event.type)) continue;
    selected.push(event);
  }
  selected.reverse();
  let inserted = 0;
  for (const event of selected.slice(-50)) {
    const type = normalizeEventType(event.type);
    const { error } = await supabase.from("repo_event_queue").insert({
      user_id: userId,
      repo,
      event_type: type,
      external_id: event.id,
      dedupe_key: `${repo}:${event.id}`,
      payload: {
        githubType: event.type,
        createdAt: event.created_at ?? null,
        actor: event.actor?.login ?? null,
        payload: event.payload ?? {},
      },
      status: "queued",
      available_at: new Date().toISOString(),
    });
    if (!error || error.code === "23505") inserted += error ? 0 : 1;
  }
  return { inserted, newestEventId: events[0]?.id ?? lastEventId };
}

async function processQueuedRecommendations(
  supabase: Parameters<typeof reasonAboutRepositoryPlan>[0],
  userId: string,
  maxEvents = 3,
) {
  const { data: queued, error } = await supabase
    .from("repo_event_queue")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "queued")
    .lte("available_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(maxEvents);
  if (error) throw new Error(`Failed to load continuous repository work: ${error.message}`);

  const processed: Array<{ id: string; repo: string; status: string; recommendation?: unknown; error?: string }> = [];
  for (const row of queued ?? []) {
    const record = row as Record<string, unknown>;
    const id = String(record.id);
    const repo = String(record.repo);
    const eventType = String(record.event_type);
    const { data: claimed } = await supabase
      .from("repo_event_queue")
      .update({ status: "processing", attempts: Number(record.attempts || 0) + 1, processing_started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    try {
      const summary = eventSummary(repo, {
        id: String(record.external_id || id),
        type: eventType,
        payload: (record.payload as Record<string, unknown> | null)?.payload as Record<string, unknown> | undefined,
      });
      const reasoning = await reasonAboutRepositoryPlan(supabase, userId, {
        repo,
        requestedNextSteps: [summary],
        mode: "replan",
      });
      const now = new Date().toISOString();
      await supabase
        .from("repo_event_queue")
        .update({ status: "completed", processed_at: now, error: null, updated_at: now, payload: { ...(record.payload as Record<string, unknown> ?? {}), recommendation: { summary: reasoning.summary, nextSteps: reasoning.nextSteps, confidence: reasoning.confidence, traceId: reasoning.traceId } } })
        .eq("id", id)
        .eq("user_id", userId);
      await recordOperationalMemory(supabase, userId, {
        repo,
        category: "planning",
        memoryKey: `continuous:${eventType}`,
        observation: `Continuous Repository Mode observed ${eventType} and re-reasoned the repository state.`,
        recommendation: reasoning.nextSteps[0] || reasoning.summary,
        outcome: "observation",
        confidence: reasoning.confidence,
        evidence: [{ eventId: record.external_id ?? id, reasoningTraceId: reasoning.traceId, at: now }],
      });
      processed.push({ id, repo, status: "completed", recommendation: { summary: reasoning.summary, nextSteps: reasoning.nextSteps, confidence: reasoning.confidence } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await supabase
        .from("repo_event_queue")
        .update({ status: "failed", error: message, processed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", userId);
      processed.push({ id, repo, status: "failed", error: message });
    }
  }
  return processed;
}

router.put(
  "/repo-finisher/continuous/watch",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = z.object({
      repo: z.string().regex(/^[A-Za-z0-9.-]+\/[A-Za-z0-9._-]+$/),
      enabled: z.boolean().default(true),
      eventTypes: z.array(z.string().min(1).max(80)).max(20).default(["push", "pull_request", "release"]),
      autoAnalyze: z.boolean().default(true),
      autoFinishMode: z.enum(["off", "recommend", "bounded"]).default("recommend"),
      riskThreshold: z.number().int().min(0).max(100).default(35),
      maxEstimatedCostUsd: z.number().positive().optional(),
      minRescoreIntervalMinutes: z.number().int().min(5).max(10080).default(30),
      boundedAutonomyAcknowledged: z.boolean().default(false),
    }).parse(req.body);
    if (input.autoFinishMode === "bounded" && !input.boundedAutonomyAcknowledged) {
      throw Object.assign(new Error("Continuous bounded finishing requires an explicit autonomy acknowledgement. Automatic merging remains disabled."), { status: 400 });
    }
    const now = new Date().toISOString();
    const values = {
      user_id: req.userId!,
      repo: input.repo,
      enabled: input.enabled,
      event_types: input.eventTypes,
      auto_analyze: input.autoAnalyze,
      auto_finish_mode: input.autoFinishMode,
      risk_threshold: input.riskThreshold,
      max_estimated_cost_usd: input.maxEstimatedCostUsd ?? null,
      min_rescore_interval_minutes: input.minRescoreIntervalMinutes,
      bounded_autonomy_acknowledged_at: input.autoFinishMode === "bounded" ? now : null,
      updated_at: now,
    };
    const { data, error } = await req.supabase!
      .from("repo_watch_settings")
      .upsert(values, { onConflict: "user_id,repo" })
      .select("*")
      .single();
    if (error) throw new Error(`Failed to save continuous repository settings: ${error.message}`);
    res.json(data);
  }),
);

router.get(
  "/repo-finisher/continuous/watch",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { data, error } = await req.supabase!
      .from("repo_watch_settings")
      .select("*")
      .eq("user_id", req.userId!)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(`Failed to load continuous repository settings: ${error.message}`);
    res.json(data ?? []);
  }),
);

router.post(
  "/repo-finisher/continuous/sync",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = z.object({ repo: z.string().optional(), process: z.boolean().default(true), maxProcessedEvents: z.number().int().min(0).max(10).default(3) }).parse(req.body ?? {});
    let query = req.supabase!
      .from("repo_watch_settings")
      .select("*")
      .eq("user_id", req.userId!)
      .eq("enabled", true);
    if (body.repo) query = query.eq("repo", body.repo);
    const { data: watches, error } = await query.limit(100);
    if (error) throw new Error(`Failed to load continuous repository watches: ${error.message}`);
    const github = requireGithubCredential(await loadGithubCredential(req.supabase!, req.userId!));
    const synced: Array<{ repo: string; inserted: number; error?: string }> = [];
    for (const watch of watches ?? []) {
      const record = watch as Record<string, unknown>;
      const repo = String(record.repo);
      try {
        const events = await ghEvents(github.token, repo);
        const result = await enqueueNewEvents(
          req.supabase!,
          req.userId!,
          repo,
          events,
          Array.isArray(record.event_types) ? record.event_types.map(String) : [],
          record.last_event_id ? String(record.last_event_id) : null,
        );
        const now = new Date().toISOString();
        await req.supabase!
          .from("repo_watch_settings")
          .update({ last_event_id: result.newestEventId, last_event_at: events[0]?.created_at ?? record.last_event_at ?? null, last_sync_at: now, updated_at: now })
          .eq("id", String(record.id))
          .eq("user_id", req.userId!);
        synced.push({ repo, inserted: result.inserted });
      } catch (err) {
        synced.push({ repo, inserted: 0, error: err instanceof Error ? err.message : String(err) });
      }
    }
    const processed = body.process && body.maxProcessedEvents > 0
      ? await processQueuedRecommendations(req.supabase!, req.userId!, body.maxProcessedEvents)
      : [];
    res.json({ watches: synced, processed, syncedAt: new Date().toISOString() });
  }),
);

router.get(
  "/repo-finisher/continuous/events",
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = z.object({ repo: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    let request = req.supabase!
      .from("repo_event_queue")
      .select("*")
      .eq("user_id", req.userId!)
      .order("created_at", { ascending: false })
      .limit(query.limit);
    if (query.repo) request = request.eq("repo", query.repo);
    const { data, error } = await request;
    if (error) throw new Error(`Failed to load continuous repository events: ${error.message}`);
    res.json(data ?? []);
  }),
);

export default router;
