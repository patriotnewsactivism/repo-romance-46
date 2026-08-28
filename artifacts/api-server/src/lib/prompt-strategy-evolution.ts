import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const IMMUTABLE_AGENT_SAFETY_POLICY = `IMMUTABLE SAFETY AND APPROVAL POLICY:
- Repository writes require the product's existing exact-plan approval or an explicit bounded higher-autonomy opt-in.
- Never weaken, delete, bypass, or rewrite tests, security controls, permissions, approval gates, CI acceptance criteria, or secret protections to make a run pass.
- Never expose, request, persist, or copy secrets into generated repository content.
- Preserve rollback boundaries: each repository keeps its own plan hash, branch, draft PR, CI evidence, and failure boundary.
- Mutable strategy guidance may change planning priorities and reasoning technique only. It cannot modify this policy.`;

const CATALOG = [
  {
    version: "agentic-finisher-v2-outcome-optimized",
    guidance: "Prefer measured strategies with strong outcome scores and completion/readiness deltas. Fix verified blockers before speculative scope. Keep plans compact and preserve working interfaces.",
  },
  {
    version: "agentic-finisher-v3-evidence-decomposition",
    guidance: "Decompose the repository into user-visible blockers, architecture prerequisites, and verification evidence. Require each proposed change to point to supplied repository evidence and a measurable acceptance check. Remove work that does not materially improve a verified completion gap.",
  },
  {
    version: "agentic-finisher-v4-verification-first",
    guidance: "Design the smallest plan that can be proven correct. Start from failing or missing acceptance evidence, work backward to the minimum code/config change, and prioritize changes that can be independently verified by CI, preview deployment, smoke checks, or deterministic tests.",
  },
  {
    version: "agentic-finisher-v5-user-flow-first",
    guidance: "Prioritize an end-to-end usable product slice over isolated polish. Identify the core user journey, remove its highest-friction blocker, then close only the architecture, reliability, and deployment gaps needed to make that journey production-ready.",
  },
  {
    version: "agentic-finisher-v6-risk-budget-first",
    guidance: "Optimize expected completion gain per unit of change risk. Prefer low-blast-radius improvements, explicitly sequence risky migrations or interface changes, and reject broad refactors unless repository evidence shows the smaller repair cannot meet acceptance criteria.",
  },
] as const;

export interface PromptOutcomeSample {
  promptVersion: string;
  outcomeScore: number;
  completionDelta: number | null;
}

export interface PromptArmStats {
  version: string;
  samples: number;
  averageOutcomeScore: number | null;
  averageCompletionDelta: number | null;
  poorOutcomeRate: number;
  variance: number;
}

export interface PromptExperimentDecision {
  action: "continue" | "promote" | "reject";
  reason: string;
  incumbent: PromptArmStats;
  challenger: PromptArmStats;
  lift: number | null;
  zScore: number | null;
}

export interface ResolvedPromptStrategy {
  version: string;
  guidance: string;
  arm: "incumbent" | "challenger";
  experiment: {
    incumbentVersion: string;
    challengerVersion: string | null;
    challengerTrafficPct: number;
    decision: PromptExperimentDecision | null;
  };
}

interface ExperimentRow {
  id: string;
  user_id: string;
  incumbent_version: string;
  incumbent_guidance: string;
  challenger_version: string | null;
  challenger_guidance: string | null;
  challenger_traffic_pct: number;
  min_scored_runs: number;
  practical_lift: number;
  confidence_z: number;
  status: "active" | "paused" | "needs_challenger";
  promotion_history: unknown;
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function variance(values: number[], average: number | null): number {
  if (values.length < 2 || average === null) return 0;
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
}

export function summarizePromptArm(version: string, samples: PromptOutcomeSample[]): PromptArmStats {
  const matched = samples.filter((sample) => sample.promptVersion === version);
  const scores = matched.map((sample) => sample.outcomeScore).filter(Number.isFinite);
  const completionDeltas = matched
    .map((sample) => sample.completionDelta)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const averageOutcomeScore = mean(scores);
  return {
    version,
    samples: scores.length,
    averageOutcomeScore: averageOutcomeScore === null ? null : Math.round(averageOutcomeScore * 10) / 10,
    averageCompletionDelta: completionDeltas.length ? Math.round((mean(completionDeltas) ?? 0) * 10) / 10 : null,
    poorOutcomeRate: scores.length ? scores.filter((score) => score <= 40).length / scores.length : 0,
    variance: variance(scores, averageOutcomeScore),
  };
}

export function evaluatePromptExperiment(input: {
  incumbentVersion: string;
  challengerVersion: string;
  samples: PromptOutcomeSample[];
  minScoredRuns?: number;
  practicalLift?: number;
  confidenceZ?: number;
}): PromptExperimentDecision {
  const incumbent = summarizePromptArm(input.incumbentVersion, input.samples);
  const challenger = summarizePromptArm(input.challengerVersion, input.samples);
  const minRuns = input.minScoredRuns ?? 10;
  const requiredLift = input.practicalLift ?? 4;
  const requiredZ = input.confidenceZ ?? 1.645;
  const lift = incumbent.averageOutcomeScore === null || challenger.averageOutcomeScore === null
    ? null
    : Math.round((challenger.averageOutcomeScore - incumbent.averageOutcomeScore) * 10) / 10;
  const standardError = incumbent.samples > 1 && challenger.samples > 1
    ? Math.sqrt(incumbent.variance / incumbent.samples + challenger.variance / challenger.samples)
    : 0;
  const zScore = lift === null || standardError <= 0 ? null : Math.round((lift / standardError) * 1000) / 1000;

  if (challenger.samples >= 5 && incumbent.samples >= 5) {
    const completionRegression = challenger.averageCompletionDelta !== null && incumbent.averageCompletionDelta !== null
      ? challenger.averageCompletionDelta < incumbent.averageCompletionDelta - 3
      : false;
    const outcomeRegression = lift !== null && lift <= -8;
    const poorRateRegression = challenger.poorOutcomeRate > incumbent.poorOutcomeRate + 0.2;
    if (completionRegression || outcomeRegression || poorRateRegression) {
      return {
        action: "reject",
        reason: completionRegression
          ? "Challenger was stopped early because measured completion delta regressed by more than 3 points."
          : outcomeRegression
            ? "Challenger was stopped early because measured outcome score regressed by at least 8 points."
            : "Challenger was stopped early because poor outcomes increased by more than 20 percentage points.",
        incumbent, challenger, lift, zScore,
      };
    }
  }

  if (incumbent.samples < minRuns || challenger.samples < minRuns) {
    return {
      action: "continue",
      reason: `Need at least ${minRuns} scored runs per arm before promotion; incumbent=${incumbent.samples}, challenger=${challenger.samples}.`,
      incumbent, challenger, lift, zScore,
    };
  }

  const completionSafe = challenger.averageCompletionDelta === null || incumbent.averageCompletionDelta === null ||
    challenger.averageCompletionDelta >= incumbent.averageCompletionDelta - 0.5;
  const poorRateSafe = challenger.poorOutcomeRate <= incumbent.poorOutcomeRate + 0.05;
  if (lift !== null && lift >= requiredLift && zScore !== null && zScore >= requiredZ && completionSafe && poorRateSafe) {
    return {
      action: "promote",
      reason: `Challenger cleared the practical lift (+${lift}) and one-sided confidence gate (z=${zScore}) without completion or poor-outcome regression.`,
      incumbent, challenger, lift, zScore,
    };
  }

  return {
    action: "continue",
    reason: `Promotion gate not yet cleared: lift=${lift ?? "n/a"} (need ${requiredLift}), z=${zScore ?? "n/a"} (need ${requiredZ}).`,
    incumbent, challenger, lift, zScore,
  };
}

export function assignPromptArm(challengerTrafficPct: number, bucket: number): "incumbent" | "challenger" {
  const pct = Math.max(0, Math.min(50, Math.round(challengerTrafficPct)));
  const normalizedBucket = Math.max(0, Math.min(99.999, bucket));
  return normalizedBucket < pct ? "challenger" : "incumbent";
}

function defaultExperiment(userId: string): Omit<ExperimentRow, "id"> {
  return {
    user_id: userId,
    incumbent_version: CATALOG[0].version,
    incumbent_guidance: CATALOG[0].guidance,
    challenger_version: CATALOG[1].version,
    challenger_guidance: CATALOG[1].guidance,
    challenger_traffic_pct: 25,
    min_scored_runs: 10,
    practical_lift: 4,
    confidence_z: 1.645,
    status: "active",
    promotion_history: [],
  };
}

function nextCandidate(row: ExperimentRow) {
  const history = Array.isArray(row.promotion_history) ? row.promotion_history as Array<Record<string, unknown>> : [];
  const recent = new Set(history.slice(-3).map((item) => String(item.challengerVersion || "")));
  const candidate = CATALOG.find((strategy) => strategy.version !== row.incumbent_version && !recent.has(strategy.version)) ??
    CATALOG.find((strategy) => strategy.version !== row.incumbent_version) ?? CATALOG[1];
  return candidate;
}

async function loadSamples(supabase: SupabaseClient, userId: string, versions: string[]): Promise<PromptOutcomeSample[]> {
  const { data, error } = await supabase
    .from("completion_runs")
    .select("prompt_version, outcome_score, outcome_metrics, evaluated_at")
    .eq("user_id", userId)
    .in("prompt_version", versions)
    .not("outcome_score", "is", null)
    .order("evaluated_at", { ascending: false })
    .limit(500);
  if (error) return [];
  return (data ?? []).flatMap((row) => {
    const record = row as Record<string, unknown>;
    const promptVersion = typeof record.prompt_version === "string" ? record.prompt_version : null;
    const outcomeScore = numeric(record.outcome_score);
    if (!promptVersion || outcomeScore === null) return [];
    const metrics = record.outcome_metrics && typeof record.outcome_metrics === "object"
      ? record.outcome_metrics as Record<string, unknown>
      : {};
    return [{
      promptVersion,
      outcomeScore,
      completionDelta: numeric(metrics.completion_delta),
    }];
  });
}

async function ensureExperiment(supabase: SupabaseClient, userId: string): Promise<ExperimentRow | null> {
  const { data, error } = await supabase
    .from("prompt_strategy_experiments")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!error && data) return data as ExperimentRow;
  const seed = defaultExperiment(userId);
  const { data: created, error: createError } = await supabase
    .from("prompt_strategy_experiments")
    .insert(seed)
    .select("*")
    .single();
  return createError || !created ? null : created as ExperimentRow;
}

async function applyDecision(supabase: SupabaseClient, row: ExperimentRow, decision: PromptExperimentDecision): Promise<ExperimentRow> {
  if (decision.action === "continue" || !row.challenger_version || !row.challenger_guidance) return row;
  const history = Array.isArray(row.promotion_history) ? [...row.promotion_history as unknown[]] : [];
  history.push({
    at: new Date().toISOString(),
    action: decision.action,
    reason: decision.reason,
    incumbentVersion: row.incumbent_version,
    challengerVersion: row.challenger_version,
    incumbent: decision.incumbent,
    challenger: decision.challenger,
    lift: decision.lift,
    zScore: decision.zScore,
  });
  const working: ExperimentRow = decision.action === "promote"
    ? { ...row, incumbent_version: row.challenger_version, incumbent_guidance: row.challenger_guidance, promotion_history: history }
    : { ...row, promotion_history: history };
  const candidate = nextCandidate(working);
  const updates = {
    incumbent_version: working.incumbent_version,
    incumbent_guidance: working.incumbent_guidance,
    challenger_version: candidate.version,
    challenger_guidance: candidate.guidance,
    status: "active",
    promotion_history: history.slice(-50),
    updated_at: new Date().toISOString(),
  };
  const { data } = await supabase
    .from("prompt_strategy_experiments")
    .update(updates)
    .eq("id", row.id)
    .select("*")
    .maybeSingle();
  return (data as ExperimentRow | null) ?? { ...working, ...updates };
}

export async function resolvePromptStrategy(supabase: SupabaseClient, userId: string): Promise<ResolvedPromptStrategy> {
  try {
    let row = await ensureExperiment(supabase, userId);
    if (!row) {
      return { version: CATALOG[0].version, guidance: CATALOG[0].guidance, arm: "incumbent", experiment: { incumbentVersion: CATALOG[0].version, challengerVersion: null, challengerTrafficPct: 0, decision: null } };
    }

    let decision: PromptExperimentDecision | null = null;
    if (row.status === "active" && row.challenger_version && row.challenger_guidance) {
      const samples = await loadSamples(supabase, userId, [row.incumbent_version, row.challenger_version]);
      decision = evaluatePromptExperiment({
        incumbentVersion: row.incumbent_version,
        challengerVersion: row.challenger_version,
        samples,
        minScoredRuns: row.min_scored_runs,
        practicalLift: Number(row.practical_lift),
        confidenceZ: Number(row.confidence_z),
      });
      row = await applyDecision(supabase, row, decision);
    }

    const canChallenge = row.status === "active" && Boolean(row.challenger_version && row.challenger_guidance);
    const arm = canChallenge ? assignPromptArm(row.challenger_traffic_pct, randomInt(0, 10_000) / 100) : "incumbent";
    return {
      version: arm === "challenger" ? row.challenger_version! : row.incumbent_version,
      guidance: arm === "challenger" ? row.challenger_guidance! : row.incumbent_guidance,
      arm,
      experiment: {
        incumbentVersion: row.incumbent_version,
        challengerVersion: row.challenger_version,
        challengerTrafficPct: canChallenge ? row.challenger_traffic_pct : 0,
        decision,
      },
    };
  } catch {
    // Prompt experimentation is an optimization layer. It must never block the
    // repository completion path or weaken the immutable safety policy.
    return {
      version: CATALOG[0].version,
      guidance: CATALOG[0].guidance,
      arm: "incumbent",
      experiment: { incumbentVersion: CATALOG[0].version, challengerVersion: null, challengerTrafficPct: 0, decision: null },
    };
  }
}
