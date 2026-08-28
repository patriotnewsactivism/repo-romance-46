import type { SupabaseClient } from "@supabase/supabase-js";

export type MemoryScope = "repo" | "cross_repo" | "portfolio";
export type MemoryCategory =
  | "planning"
  | "ci_repair"
  | "deployment"
  | "security"
  | "product_flow"
  | "database"
  | "valuation"
  | "architecture"
  | "tooling"
  | "failure_mode";

export interface OperationalMemory {
  id?: string;
  repo: string;
  scope: MemoryScope;
  category: MemoryCategory;
  memoryKey: string;
  observation: string;
  recommendation: string;
  confidence: number;
  samples: number;
  successes: number;
  failures: number;
  averageOutcomeScore: number | null;
  averageCompletionDelta: number | null;
  averageReadinessDelta: number | null;
  evidence: unknown[];
  lastOutcome: string | null;
  lastSeenAt: string;
}

export interface MemoryObservationInput {
  repo: string;
  scope?: MemoryScope;
  category: MemoryCategory;
  memoryKey: string;
  observation: string;
  recommendation: string;
  outcome?: "success" | "failure" | "partial" | "observation";
  outcomeScore?: number | null;
  completionDelta?: number | null;
  readinessDelta?: number | null;
  confidence?: number;
  evidence?: unknown[];
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function rowToMemory(row: Record<string, unknown>): OperationalMemory {
  return {
    id: String(row.id || ""),
    repo: String(row.repo || "*"),
    scope: String(row.scope || "repo") as MemoryScope,
    category: String(row.category || "planning") as MemoryCategory,
    memoryKey: String(row.memory_key || ""),
    observation: String(row.observation || ""),
    recommendation: String(row.recommendation || ""),
    confidence: Number(row.confidence || 0),
    samples: Number(row.samples || 0),
    successes: Number(row.successes || 0),
    failures: Number(row.failures || 0),
    averageOutcomeScore: finite(row.average_outcome_score),
    averageCompletionDelta: finite(row.average_completion_delta),
    averageReadinessDelta: finite(row.average_readiness_delta),
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    lastOutcome: row.last_outcome ? String(row.last_outcome) : null,
    lastSeenAt: String(row.last_seen_at || row.updated_at || new Date().toISOString()),
  };
}

function weightedAverage(previousAverage: number | null, previousSamples: number, next: number | null) {
  if (next === null) return previousAverage;
  if (previousAverage === null || previousSamples <= 0) return next;
  return (previousAverage * previousSamples + next) / (previousSamples + 1);
}

function confidenceFromEvidence(input: {
  samples: number;
  successes: number;
  failures: number;
  averageOutcomeScore: number | null;
  explicit?: number;
}) {
  if (input.explicit !== undefined) return clamp(input.explicit, 0, 100);
  const sampleStrength = Math.min(30, Math.log2(input.samples + 1) * 8);
  const successRate = input.successes / Math.max(1, input.successes + input.failures);
  const outcome = input.averageOutcomeScore === null ? 50 : input.averageOutcomeScore;
  return Math.round(clamp(sampleStrength + successRate * 35 + outcome * 0.35, 5, 99) * 100) / 100;
}

export async function loadOperationalMemory(
  supabase: SupabaseClient,
  userId: string,
  repo: string,
  categories?: MemoryCategory[],
  limit = 30,
): Promise<OperationalMemory[]> {
  let query = supabase
    .from("learning_memories")
    .select("*")
    .eq("user_id", userId)
    .in("repo", [repo, "*"])
    .order("confidence", { ascending: false })
    .order("last_seen_at", { ascending: false })
    .limit(Math.max(1, Math.min(100, limit)));
  if (categories?.length) query = query.in("category", categories);
  const { data, error } = await query;
  if (error) return [];
  return (data ?? []).map((row) => rowToMemory(row as Record<string, unknown>));
}

export function memoryGuidance(memories: OperationalMemory[], limit = 12): string[] {
  return memories
    .filter((memory) => memory.confidence >= 45)
    .sort((a, b) => b.confidence - a.confidence || b.samples - a.samples)
    .slice(0, Math.max(1, Math.min(25, limit)))
    .map((memory) => {
      const evidence = memory.averageOutcomeScore === null
        ? `${memory.samples} observed sample${memory.samples === 1 ? "" : "s"}`
        : `${memory.samples} sample${memory.samples === 1 ? "" : "s"}, avg outcome ${Math.round(memory.averageOutcomeScore * 10) / 10}/100`;
      return `[${memory.category}; ${Math.round(memory.confidence)}% confidence; ${evidence}] ${memory.recommendation}`;
    });
}

export async function recordOperationalMemory(
  supabase: SupabaseClient,
  userId: string,
  input: MemoryObservationInput,
): Promise<void> {
  const repo = input.scope === "cross_repo" ? "*" : input.repo;
  const scope = input.scope ?? "repo";
  const key = input.memoryKey.trim().toLowerCase().slice(0, 220);
  if (!key) return;

  const { data: existing, error } = await supabase
    .from("learning_memories")
    .select("*")
    .eq("user_id", userId)
    .eq("repo", repo)
    .eq("scope", scope)
    .eq("category", input.category)
    .eq("memory_key", key)
    .maybeSingle();
  if (error) return;

  const current = existing ? rowToMemory(existing as Record<string, unknown>) : null;
  const previousSamples = current?.samples ?? 0;
  const samples = previousSamples + 1;
  const successes = (current?.successes ?? 0) + (input.outcome === "success" ? 1 : 0);
  const failures = (current?.failures ?? 0) + (input.outcome === "failure" ? 1 : 0);
  const averageOutcomeScore = weightedAverage(current?.averageOutcomeScore ?? null, previousSamples, finite(input.outcomeScore));
  const averageCompletionDelta = weightedAverage(current?.averageCompletionDelta ?? null, previousSamples, finite(input.completionDelta));
  const averageReadinessDelta = weightedAverage(current?.averageReadinessDelta ?? null, previousSamples, finite(input.readinessDelta));
  const confidence = confidenceFromEvidence({
    samples,
    successes,
    failures,
    averageOutcomeScore,
    explicit: input.confidence,
  });
  const priorEvidence = current?.evidence ?? [];
  const evidence = [...priorEvidence, ...(input.evidence ?? [])].slice(-30);
  const now = new Date().toISOString();
  const values = {
    observation: input.observation.slice(0, 4000),
    recommendation: input.recommendation.slice(0, 4000),
    confidence,
    samples,
    successes,
    failures,
    average_outcome_score: averageOutcomeScore,
    average_completion_delta: averageCompletionDelta,
    average_readiness_delta: averageReadinessDelta,
    evidence,
    last_outcome: input.outcome ?? "observation",
    last_seen_at: now,
    updated_at: now,
  };

  if (current?.id) {
    await supabase.from("learning_memories").update(values).eq("id", current.id).eq("user_id", userId);
  } else {
    await supabase.from("learning_memories").insert({
      user_id: userId,
      repo,
      scope,
      category: input.category,
      memory_key: key,
      ...values,
    });
  }
}

export async function recordRunOutcomeMemories(
  supabase: SupabaseClient,
  userId: string,
  input: {
    repo: string;
    promptVersion: string;
    status: "succeeded" | "failed" | "stale";
    outcomeScore: number;
    completionDelta: number | null;
    readinessDelta: number | null;
    error?: string | null;
    filesAffected?: string[];
  },
) {
  const successful = input.status === "succeeded" && input.outcomeScore >= 60;
  const observation = successful
    ? `Prompt strategy ${input.promptVersion} produced a measured successful completion run.`
    : `Prompt strategy ${input.promptVersion} produced a weak or failed completion run${input.error ? `: ${input.error}` : "."}`;
  const recommendation = successful
    ? `Prefer ${input.promptVersion} when repository evidence resembles this run; preserve the validation path that produced the measured gain.`
    : `Do not repeat ${input.promptVersion} unchanged for similar evidence. Re-diagnose root cause, reduce unsupported scope, and require a different verification path.`;

  await Promise.all([
    recordOperationalMemory(supabase, userId, {
      repo: input.repo,
      category: successful ? "planning" : "failure_mode",
      memoryKey: `prompt:${input.promptVersion}`,
      observation,
      recommendation,
      outcome: input.status === "succeeded" ? "success" : input.status === "failed" ? "failure" : "partial",
      outcomeScore: input.outcomeScore,
      completionDelta: input.completionDelta,
      readinessDelta: input.readinessDelta,
      evidence: [{ files: input.filesAffected ?? [], error: input.error ?? null, at: new Date().toISOString() }],
    }),
    recordOperationalMemory(supabase, userId, {
      repo: input.repo,
      scope: "cross_repo",
      category: successful ? "planning" : "failure_mode",
      memoryKey: `prompt:${input.promptVersion}`,
      observation,
      recommendation,
      outcome: input.status === "succeeded" ? "success" : input.status === "failed" ? "failure" : "partial",
      outcomeScore: input.outcomeScore,
      completionDelta: input.completionDelta,
      readinessDelta: input.readinessDelta,
      evidence: [{ repo: input.repo, error: input.error ?? null, at: new Date().toISOString() }],
    }),
  ]);
}
