export type TaskType = "analysis" | "planning" | "code-gen" | "repair" | "critique";
export type ModelProvider = "openrouter" | "google" | "openai" | "anthropic";

export interface ModelCandidate {
  id: string;
  provider: string;
  costPer1kTokens: number;
  avgLatencyMs: number;
  reliabilityScore: number;
  capabilities: string[];
  isPaid: boolean;
  isReliable: boolean;
  paid?: boolean;
  reliable?: boolean;
}

export interface RoutingContext {
  taskType: TaskType;
  maxCostUsd?: number;
  preferSpeed?: boolean;
  userPreferredModel?: string;
  requirePaid?: boolean;
}

export interface RoutingDecision {
  model: ModelCandidate;
  reason: "user-preferred" | "ranked";
  score: number;
}

export const DEFAULT_PRODUCTION_MODEL = "openrouter/auto";
const ESTIMATED_TOKENS_PER_REQUEST = 10_000;
const TASK_TYPES: readonly TaskType[] = ["analysis", "planning", "code-gen", "repair", "critique"];

export const MODEL_CATALOG: readonly ModelCandidate[] = [
  {
    id: "openrouter/auto",
    provider: "openrouter",
    costPer1kTokens: 0.002,
    avgLatencyMs: 1200,
    reliabilityScore: 0.95,
    capabilities: [...TASK_TYPES],
    isPaid: true,
    isReliable: true,
    paid: true,
    reliable: true,
  },
  {
    id: "minimax/minimax-m3:free",
    provider: "openrouter",
    costPer1kTokens: 0,
    avgLatencyMs: 1400,
    reliabilityScore: 0.82,
    capabilities: [...TASK_TYPES],
    isPaid: false,
    isReliable: false,
    paid: false,
    reliable: false,
  },
  {
    id: "gemini-1.5-pro-latest",
    provider: "google",
    costPer1kTokens: 0.0035,
    avgLatencyMs: 900,
    reliabilityScore: 0.97,
    capabilities: [...TASK_TYPES],
    isPaid: true,
    isReliable: true,
    paid: true,
    reliable: true,
  },
  {
    id: "openai/gpt-4o",
    provider: "openai",
    costPer1kTokens: 0.005,
    avgLatencyMs: 800,
    reliabilityScore: 0.98,
    capabilities: [...TASK_TYPES],
    isPaid: true,
    isReliable: true,
    paid: true,
    reliable: true,
  },
  {
    id: "anthropic/claude-3-5-sonnet",
    provider: "anthropic",
    costPer1kTokens: 0.003,
    avgLatencyMs: 1100,
    reliabilityScore: 0.96,
    capabilities: [...TASK_TYPES],
    isPaid: true,
    isReliable: true,
    paid: true,
    reliable: true,
  },
];

export const MODEL_CANDIDATES = MODEL_CATALOG;
export const catalog = MODEL_CATALOG;

function estimatedCostUsd(candidate: ModelCandidate): number {
  return candidate.costPer1kTokens * (ESTIMATED_TOKENS_PER_REQUEST / 1000);
}

function rankingScore(candidate: ModelCandidate, candidates: readonly ModelCandidate[], preferSpeed: boolean): number {
  const latencies = candidates.map((item) => item.avgLatencyMs);
  const costs = candidates.map((item) => item.costPer1kTokens);
  const minLatency = Math.min(...latencies);
  const maxLatency = Math.max(...latencies);
  const minCost = Math.min(...costs);
  const maxCost = Math.max(...costs);
  const speed = maxLatency === minLatency ? 1 : 1 - (candidate.avgLatencyMs - minLatency) / (maxLatency - minLatency);
  const economy = maxCost === minCost ? 1 : 1 - (candidate.costPer1kTokens - minCost) / (maxCost - minCost);
  const preference = preferSpeed ? speed : economy;
  return Math.round((candidate.reliabilityScore * 0.8 + preference * 0.2) * 1_000_000) / 1_000_000;
}

export function selectModel(ctx: RoutingContext): ModelCandidate {
  if (!ctx || typeof ctx !== "object" || Array.isArray(ctx)) throw new Error("Routing context is required");
  if (!TASK_TYPES.includes(ctx.taskType)) throw new Error(`Unsupported taskType: ${String(ctx.taskType)}`);
  if (ctx.maxCostUsd !== undefined && (!Number.isFinite(ctx.maxCostUsd) || ctx.maxCostUsd < 0)) {
    throw new Error("Invalid maxCostUsd: expected a finite non-negative number");
  }
  if (ctx.requirePaid !== undefined && typeof ctx.requirePaid !== "boolean") {
    throw new Error("Invalid requirePaid: expected a boolean");
  }

  const preferredId = typeof ctx.userPreferredModel === "string" ? ctx.userPreferredModel.trim() : "";
  const preferred = preferredId ? MODEL_CATALOG.find((candidate) => candidate.id === preferredId) : undefined;
  if (preferredId && !preferred) {
    throw new Error(`No configured model matches userPreferredModel ${JSON.stringify(preferredId)}`);
  }

  let candidates = preferred ? [preferred] : [...MODEL_CATALOG];
  candidates = candidates.filter((candidate) => candidate.capabilities.includes(ctx.taskType));
  if (ctx.requirePaid) candidates = candidates.filter((candidate) => candidate.isPaid);
  if (ctx.maxCostUsd !== undefined) {
    candidates = candidates.filter((candidate) => estimatedCostUsd(candidate) <= ctx.maxCostUsd!);
  }

  if (candidates.length === 0) {
    const constraints = [
      `taskType=${ctx.taskType}`,
      ctx.requirePaid ? "requirePaid=true" : "",
      ctx.maxCostUsd !== undefined ? `maxCostUsd=${ctx.maxCostUsd}` : "",
    ].filter(Boolean).join(", ");
    throw new Error(`No configured model satisfies ${constraints}`);
  }

  if (preferred) return preferred;
  const ranked = candidates
    .map((candidate, originalIndex) => ({
      candidate,
      originalIndex,
      score: rankingScore(candidate, candidates, ctx.preferSpeed === true),
    }))
    .sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex);
  return ranked[0]!.candidate;
}

export function getDefaultProductionModel(env: NodeJS.ProcessEnv = process.env): string {
  const openRouterModel = env.OPENROUTER_MODEL?.trim();
  if (openRouterModel) return openRouterModel;
  const commonModel = env.AI_MODEL?.trim();
  if (commonModel) return commonModel;
  return DEFAULT_PRODUCTION_MODEL;
}
