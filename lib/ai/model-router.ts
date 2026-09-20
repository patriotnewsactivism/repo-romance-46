/**
 * Dynamic Model Router – selects AI models based on performance, cost, and preference.
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

const catalog: ModelCandidate[] = [
  { id: 'openrouter/auto', provider: 'openrouter', costPer1kTokens: 0.002, avgLatencyMs: 1200, reliabilityScore: 0.95, capabilities: ['analysis', 'planning', 'code-gen', 'repair', 'critique'] },
  { id: 'gemini-1.5-pro-latest', provider: 'google', costPer1kTokens: 0.0035, avgLatencyMs: 900, reliabilityScore: 0.97, capabilities: ['analysis', 'planning', 'code-gen', 'repair', 'critique'] },
  { id: 'openai/gpt-4o', provider: 'openai', costPer1kTokens: 0.005, avgLatencyMs: 800, reliabilityScore: 0.98, capabilities: ['analysis', 'planning', 'code-gen', 'repair', 'critique'] },
  { id: 'anthropic/claude-3-5-sonnet', provider: 'anthropic', costPer1kTokens: 0.003, avgLatencyMs: 1100, reliabilityScore: 0.96, capabilities: ['analysis', 'planning', 'code-gen', 'repair', 'critique'] },
];

export function selectModel(ctx: RoutingContext): ModelCandidate {
  // User override takes precedence
  if (ctx.userPreferredModel) {
    const preferred = catalog.find((m) => m.id === ctx.userPreferredModel);
    if (preferred) return preferred;
  }

  let candidates = catalog.filter((m) => m.capabilities.includes(ctx.taskType));

  if (ctx.requirePaid) {
    // Filter out known free-tier models
    candidates = candidates.filter((m) => !m.id.includes(':free') && !m.id.includes('flash'));
  }

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
  return process.env.OPENROUTER_MODEL || process.env.AI_MODEL || 'openrouter/auto';
}
