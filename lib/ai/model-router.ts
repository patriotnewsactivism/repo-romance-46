/**
 * Compatibility shim.
 *
 * The authoritative model catalog and task routing now live in
 * `artifacts/api-server/src/lib/ai-model-catalog.ts`, which the API, the
 * Settings picker, and the analysis pipeline all read. This module used to hold
 * a second, stale catalog (Gemini 1.5 / GPT-4o) that disagreed with the rest of
 * the app. It is kept only so older imports keep compiling, and it now delegates
 * its ranking to the same tiers the product uses.
 */

export interface ModelCandidate {
  id: string;
  provider: string;
  costPer1kTokens: number;
  avgLatencyMs: number;
  reliabilityScore: number; // 0-1
  capabilities: string[];
}

export interface RoutingContext {
  taskType: 'analysis' | 'planning' | 'code-gen' | 'repair' | 'critique';
  maxCostUsd?: number;
  preferSpeed?: boolean;
  userPreferredModel?: string;
  requirePaid?: boolean;
}

/** Mirrors the reviewed catalog's frontier/balanced/fast ordering. */
const catalog: ModelCandidate[] = [
  { id: 'openai/gpt-5.6-sol', provider: 'openrouter', costPer1kTokens: 0.005, avgLatencyMs: 1100, reliabilityScore: 0.96, capabilities: ['analysis', 'planning', 'code-gen', 'repair', 'critique'] },
  { id: 'openai/gpt-5.6-terra', provider: 'openrouter', costPer1kTokens: 0.001, avgLatencyMs: 950, reliabilityScore: 0.96, capabilities: ['analysis', 'planning', 'code-gen', 'repair', 'critique'] },
  { id: 'gemini-3.8-flash', provider: 'google', costPer1kTokens: 0.0008, avgLatencyMs: 700, reliabilityScore: 0.97, capabilities: ['analysis', 'planning', 'code-gen', 'repair', 'critique'] },
  { id: 'gpt-5.6-terra', provider: 'openai', costPer1kTokens: 0.001, avgLatencyMs: 850, reliabilityScore: 0.98, capabilities: ['analysis', 'planning', 'code-gen', 'repair', 'critique'] },
  { id: 'claude-sonnet-4-20250514', provider: 'anthropic', costPer1kTokens: 0.003, avgLatencyMs: 1000, reliabilityScore: 0.96, capabilities: ['analysis', 'planning', 'code-gen', 'repair', 'critique'] },
  { id: 'qwen-plus', provider: 'qwen', costPer1kTokens: 0.0004, avgLatencyMs: 900, reliabilityScore: 0.94, capabilities: ['analysis', 'planning', 'code-gen', 'repair', 'critique'] },
];

export function selectModel(ctx: RoutingContext): ModelCandidate {
  // User override takes precedence
  if (ctx.userPreferredModel) {
    const preferred = catalog.find((m) => m.id === ctx.userPreferredModel);
    if (preferred) return preferred;
  }

  let candidates = catalog.filter((m) => m.capabilities.includes(ctx.taskType));

  if (ctx.maxCostUsd) {
    candidates = candidates.filter((m) => m.costPer1kTokens * 10 <= ctx.maxCostUsd!); // rough estimate
  }

  // Score: reliability * 0.5 + (speed or cost preference)
  candidates.sort((a, b) => {
    const scoreA = a.reliabilityScore * 0.6 + (ctx.preferSpeed ? (2000 - a.avgLatencyMs) / 2000 : 1 - a.costPer1kTokens) * 0.4;
    const scoreB = b.reliabilityScore * 0.6 + (ctx.preferSpeed ? (2000 - b.avgLatencyMs) / 2000 : 1 - b.costPer1kTokens) * 0.4;
    return scoreB - scoreA;
  });

  return candidates[0] || catalog[0];
}

export function getDefaultProductionModel(): string {
  return process.env.OPENROUTER_MODEL || process.env.AI_MODEL || 'openai/gpt-5.6-terra';
}
