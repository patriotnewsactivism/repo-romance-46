/**
 * Model catalog and task routing.
 *
 * Before this module, model choice was scattered: `ai-model-config.ts` held five
 * in-code defaults, the Settings page held its own copy of the same list, and
 * `lib/ai/model-router.ts` held a third, stale catalog (Gemini 1.5 / GPT-4o).
 * They disagreed, so "the model the app uses" depended on which file answered.
 *
 * This is the single source of truth. Provider defaults, the Settings picker,
 * and per-task routing all read from `AI_MODEL_CATALOG`.
 *
 * Model IDs are application configuration, never secrets.
 */

export type AiProviderId = "google" | "openai" | "anthropic" | "openrouter" | "qwen";

export type AiModelTier = "frontier" | "balanced" | "fast" | "free";

export interface AiModelSpec {
  /** Exact provider model slug. */
  id: string;
  provider: AiProviderId;
  label: string;
  tier: AiModelTier;
  /** Advertised context window in tokens. */
  contextTokens: number;
  /** Whether the provider enforces a strict JSON schema response format. */
  supportsJsonSchema: boolean;
  /** Whether the provider accepts a reasoning/thinking effort control. */
  supportsReasoningEffort: boolean;
  /** USD per million input tokens, when published. */
  inputPerMTok: number | null;
  /** USD per million output tokens, when published. */
  outputPerMTok: number | null;
  /** What this model is genuinely best at inside RepoFinisher. */
  strengths: string[];
  notes?: string;
}

export const AI_CATALOG_VERSION = "ai-catalog-2026-11";

export const AI_PROVIDER_LABELS: Record<AiProviderId, string> = {
  google: "Google Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
  qwen: "Qwen (Alibaba Model Studio)",
};

/**
 * The reviewed catalog. Ordered best-first inside each provider so the first
 * entry is a defensible default and the rest are explicit alternatives a user
 * can pick in Settings.
 */
export const AI_MODEL_CATALOG: readonly AiModelSpec[] = [
  // ---------------------------------------------------------------- Google
  {
    id: "gemini-3.7-pro",
    provider: "google",
    label: "Gemini 3.7 Pro",
    tier: "frontier",
    contextTokens: 2_000_000,
    supportsJsonSchema: true,
    supportsReasoningEffort: true,
    inputPerMTok: 1.25,
    outputPerMTok: 10,
    strengths: ["long_context_review", "valuation", "repo_grading", "market_research"],
  },
  {
    id: "gemini-3.8-flash",
    provider: "google",
    label: "Gemini 3.8 Flash",
    tier: "balanced",
    contextTokens: 1_000_000,
    supportsJsonSchema: true,
    supportsReasoningEffort: true,
    inputPerMTok: 0.3,
    outputPerMTok: 2.5,
    strengths: ["repo_grading", "long_context_review", "fast_classify", "suggestion_generation"],
  },
  {
    id: "gemini-3.7-flash",
    provider: "google",
    label: "Gemini 3.7 Flash",
    tier: "fast",
    contextTokens: 1_000_000,
    supportsJsonSchema: true,
    supportsReasoningEffort: true,
    inputPerMTok: 0.1,
    outputPerMTok: 0.4,
    strengths: ["fast_classify", "long_context_review"],
  },

  // ---------------------------------------------------------------- OpenAI
  {
    id: "gpt-5.6-sol",
    provider: "openai",
    label: "GPT-5.6 Sol",
    tier: "frontier",
    contextTokens: 400_000,
    supportsJsonSchema: true,
    supportsReasoningEffort: true,
    inputPerMTok: 2.5,
    outputPerMTok: 20,
    strengths: ["builder_prompt", "code_planning", "valuation", "repo_grading"],
  },
  {
    id: "gpt-5.6-terra",
    provider: "openai",
    label: "GPT-5.6 Terra",
    tier: "balanced",
    contextTokens: 400_000,
    supportsJsonSchema: true,
    supportsReasoningEffort: true,
    inputPerMTok: 0.6,
    outputPerMTok: 5,
    strengths: ["repo_grading", "builder_prompt", "suggestion_generation", "code_planning"],
  },
  {
    id: "gpt-5.6-luna",
    provider: "openai",
    label: "GPT-5.6 Luna",
    tier: "fast",
    contextTokens: 200_000,
    supportsJsonSchema: true,
    supportsReasoningEffort: false,
    inputPerMTok: 0.15,
    outputPerMTok: 0.6,
    strengths: ["fast_classify", "suggestion_generation"],
  },

  // ------------------------------------------------------------- Anthropic
  {
    id: "claude-opus-4.1",
    provider: "anthropic",
    label: "Claude Opus 4.1",
    tier: "frontier",
    contextTokens: 200_000,
    supportsJsonSchema: false,
    supportsReasoningEffort: true,
    inputPerMTok: 15,
    outputPerMTok: 75,
    strengths: ["code_planning", "builder_prompt", "long_context_review", "valuation"],
    notes: "Premium review model. Used for finality prompt authoring and hard architectural calls, not bulk scoring.",
  },
  {
    id: "claude-sonnet-4-20250514",
    provider: "anthropic",
    label: "Claude Sonnet 4",
    tier: "balanced",
    contextTokens: 200_000,
    supportsJsonSchema: false,
    supportsReasoningEffort: true,
    inputPerMTok: 3,
    outputPerMTok: 15,
    strengths: ["builder_prompt", "code_planning", "repo_grading"],
  },

  // ------------------------------------------------------------- OpenRouter
  {
    id: "nex-agi/nex-n2.5-mini:free",
    provider: "openrouter",
    label: "Free agent pool",
    tier: "free",
    contextTokens: 200_000,
    supportsJsonSchema: false,
    supportsReasoningEffort: true,
    inputPerMTok: 0,
    outputPerMTok: 0,
    strengths: ["fast_classify", "suggestion_generation"],
    notes: "Pool sentinel: OpenRouter may serve any model in OPENROUTER_AGENT_CHAIN. Never pin it for a paid-quality task.",
  },
  {
    id: "openai/gpt-5.6-sol",
    provider: "openrouter",
    label: "GPT-5.6 Sol (OpenRouter)",
    tier: "frontier",
    contextTokens: 400_000,
    supportsJsonSchema: true,
    supportsReasoningEffort: true,
    inputPerMTok: 2.5,
    outputPerMTok: 20,
    strengths: ["builder_prompt", "code_planning", "valuation"],
  },
  {
    id: "google/gemini-3.7-pro",
    provider: "openrouter",
    label: "Gemini 3.7 Pro (OpenRouter)",
    tier: "frontier",
    contextTokens: 2_000_000,
    supportsJsonSchema: true,
    supportsReasoningEffort: true,
    inputPerMTok: 1.25,
    outputPerMTok: 10,
    strengths: ["long_context_review", "valuation", "repo_grading"],
  },
  {
    id: "anthropic/claude-opus-4.1",
    provider: "openrouter",
    label: "Claude Opus 4.1 (OpenRouter)",
    tier: "frontier",
    contextTokens: 200_000,
    supportsJsonSchema: false,
    supportsReasoningEffort: true,
    inputPerMTok: 15,
    outputPerMTok: 75,
    strengths: ["code_planning", "builder_prompt", "long_context_review"],
  },
  {
    id: "deepseek/deepseek-v4-flash-0731",
    provider: "openrouter",
    label: "DeepSeek V4 Flash",
    tier: "balanced",
    contextTokens: 200_000,
    supportsJsonSchema: true,
    supportsReasoningEffort: true,
    inputPerMTok: 0.28,
    outputPerMTok: 1.1,
    strengths: ["repo_grading", "suggestion_generation", "code_planning"],
  },
  {
    id: "x-ai/grok-4.6",
    provider: "openrouter",
    label: "Grok 4.6",
    tier: "frontier",
    contextTokens: 500_000,
    supportsJsonSchema: true,
    supportsReasoningEffort: true,
    inputPerMTok: 3,
    outputPerMTok: 15,
    strengths: ["market_research", "valuation", "long_context_review"],
  },
  {
    id: "openrouter/auto",
    provider: "openrouter",
    label: "OpenRouter Auto",
    tier: "balanced",
    contextTokens: 200_000,
    supportsJsonSchema: false,
    supportsReasoningEffort: false,
    inputPerMTok: null,
    outputPerMTok: null,
    strengths: ["fast_classify"],
    notes: "Provider-managed routing. Useful as an escape hatch, never as a graded default.",
  },

  // ------------------------------------------------------------------ Qwen
  {
    id: "qwen-max",
    provider: "qwen",
    label: "Qwen Max",
    tier: "frontier",
    contextTokens: 262_000,
    supportsJsonSchema: true,
    supportsReasoningEffort: false,
    inputPerMTok: 1.2,
    outputPerMTok: 6,
    strengths: ["repo_grading", "builder_prompt", "code_planning"],
  },
  {
    id: "qwen-plus",
    provider: "qwen",
    label: "Qwen Plus",
    tier: "balanced",
    contextTokens: 131_000,
    supportsJsonSchema: true,
    supportsReasoningEffort: false,
    inputPerMTok: 0.4,
    outputPerMTok: 1.2,
    strengths: ["repo_grading", "suggestion_generation", "fast_classify"],
  },
  {
    id: "qwen-turbo",
    provider: "qwen",
    label: "Qwen Turbo",
    tier: "fast",
    contextTokens: 131_000,
    supportsJsonSchema: true,
    supportsReasoningEffort: false,
    inputPerMTok: 0.05,
    outputPerMTok: 0.2,
    strengths: ["fast_classify"],
  },
];

/** The reviewed default model per provider. First entry wins in the catalog. */
export const CATALOG_DEFAULT_MODELS: Record<AiProviderId, string> = {
  google: "gemini-3.8-flash",
  openai: "gpt-5.6-terra",
  anthropic: "claude-sonnet-4-20250514",
  openrouter: "nex-agi/nex-n2.5-mini:free",
  qwen: "qwen-plus",
};

export type AiTaskKind =
  | "repo_grading"
  | "valuation"
  | "builder_prompt"
  | "suggestion_generation"
  | "market_research"
  | "code_planning"
  | "long_context_review"
  | "fast_classify";

export interface AiTaskProfile {
  kind: AiTaskKind;
  label: string;
  /** The task needs a strict structured payload back. */
  requiresJson: boolean;
  /** Preferred tiers, best-first. */
  preferredTiers: AiModelTier[];
  /** Hard ceiling on output price, USD per million tokens. `null` = no ceiling. */
  maxOutputPerMTok: number | null;
  /** Minimum context window needed to do the task honestly. */
  minContextTokens: number;
  /** Why this routing exists, shown in operator docs and Settings. */
  rationale: string;
}

/**
 * Task routing is the part that makes the models a *system* rather than a
 * setting. Grading and valuation need structured, defensible output; prompt
 * authoring needs the strongest reasoning model available; classification
 * should never burn a frontier model.
 */
export const AI_TASK_PROFILES: Record<AiTaskKind, AiTaskProfile> = {
  repo_grading: {
    kind: "repo_grading",
    label: "Repository grading",
    requiresJson: true,
    preferredTiers: ["balanced", "frontier", "fast"],
    maxOutputPerMTok: 12,
    minContextTokens: 128_000,
    rationale: "Structured, repeatable scoring. A balanced model with strict JSON support is cheaper and steadier than a frontier model.",
  },
  valuation: {
    kind: "valuation",
    label: "Fair-market valuation",
    requiresJson: true,
    preferredTiers: ["frontier", "balanced"],
    maxOutputPerMTok: 25,
    minContextTokens: 200_000,
    rationale: "Valuation is a judgment task where a wrong multiple is expensive. Pay for reasoning and long context.",
  },
  builder_prompt: {
    kind: "builder_prompt",
    label: "Builder-AI finality prompt",
    requiresJson: false,
    preferredTiers: ["frontier", "balanced"],
    maxOutputPerMTok: 80,
    minContextTokens: 200_000,
    rationale: "The prompt is the product. This is the one task that justifies a premium model every time.",
  },
  suggestion_generation: {
    kind: "suggestion_generation",
    label: "Improvement suggestions",
    requiresJson: true,
    preferredTiers: ["balanced", "fast", "frontier"],
    maxOutputPerMTok: 8,
    minContextTokens: 128_000,
    rationale: "High-volume list generation. Balanced models produce plenty of specific, actionable items at a fraction of frontier cost.",
  },
  market_research: {
    kind: "market_research",
    label: "Market and demand research",
    requiresJson: true,
    preferredTiers: ["frontier", "balanced"],
    maxOutputPerMTok: 25,
    minContextTokens: 200_000,
    rationale: "Demand claims must be evidence-backed. Use the strongest reasoning model available for research synthesis.",
  },
  code_planning: {
    kind: "code_planning",
    label: "Implementation planning",
    requiresJson: true,
    preferredTiers: ["frontier", "balanced"],
    maxOutputPerMTok: 40,
    minContextTokens: 200_000,
    rationale: "Plans become branches and PRs. Planning errors are the most expensive kind to repair.",
  },
  long_context_review: {
    kind: "long_context_review",
    label: "Whole-repository review",
    requiresJson: false,
    preferredTiers: ["frontier", "balanced"],
    maxOutputPerMTok: 25,
    minContextTokens: 200_000,
    rationale: "Whole-tree review needs a large window more than it needs raw price efficiency.",
  },
  fast_classify: {
    kind: "fast_classify",
    label: "Fast classification",
    requiresJson: true,
    preferredTiers: ["fast", "free", "balanced"],
    maxOutputPerMTok: 3,
    minContextTokens: 32_000,
    rationale: "Routing, tagging, and short judgments should stay cheap and quick.",
  },
};

const TIER_WEIGHT: Record<AiModelTier, number> = {
  frontier: 40,
  balanced: 30,
  fast: 15,
  free: 5,
};

export function catalogModel(id: string | null | undefined): AiModelSpec | null {
  const slug = typeof id === "string" ? id.trim() : "";
  if (!slug) return null;
  return AI_MODEL_CATALOG.find((model) => model.id === slug) ?? null;
}

export function modelsForProvider(provider: AiProviderId): AiModelSpec[] {
  return AI_MODEL_CATALOG.filter((model) => model.provider === provider);
}

export interface ModelSelectionOptions {
  /** Restrict to one provider (a user's BYOK provider). */
  provider?: string | null;
  /** A user-pinned model always wins when it is in the catalog. */
  preferredModel?: string | null;
  /** Exclude free-tier sentinels, e.g. when a paid-quality answer is required. */
  excludeFree?: boolean;
  /** Maximum number of candidates to return. */
  limit?: number;
}

function isProvider(value: string): value is AiProviderId {
  return value in AI_PROVIDER_LABELS;
}

/**
 * Rank catalog models for a task.
 *
 * Order of authority: an explicit user-pinned catalog model, then tier
 * preference, then task-strength match, then price headroom, then context.
 */
export function selectModelCandidates(
  task: AiTaskKind,
  options: ModelSelectionOptions = {},
): AiModelSpec[] {
  const profile = AI_TASK_PROFILES[task];
  const limit = Math.max(1, Math.min(12, options.limit ?? 4));

  const provider = options.provider && isProvider(options.provider) ? options.provider : null;
  const pinned = catalogModel(options.preferredModel);

  const eligible = AI_MODEL_CATALOG.filter((model) => {
    if (provider && model.provider !== provider) return false;
    if (profile.requiresJson && !model.supportsJsonSchema) return false;
    if (options.excludeFree && model.tier === "free") return false;
    if (model.contextTokens < profile.minContextTokens) return false;
    if (profile.maxOutputPerMTok !== null && model.outputPerMTok !== null && model.outputPerMTok > profile.maxOutputPerMTok) {
      return false;
    }
    return true;
  });

  const ranked = eligible
    .map((model) => {
      const tierIndex = profile.preferredTiers.indexOf(model.tier);
      const tierScore = tierIndex === -1 ? 0 : (profile.preferredTiers.length - tierIndex) * 20;
      const strengthScore = model.strengths.includes(task) ? 35 : 0;
      const contextScore = Math.min(10, Math.log10(model.contextTokens / profile.minContextTokens) * 10);
      const priceScore =
        model.outputPerMTok === null
          ? 5
          : Math.max(0, 15 - model.outputPerMTok / Math.max(1, profile.maxOutputPerMTok ?? 100) * 15);
      return {
        model,
        score: TIER_WEIGHT[model.tier] + tierScore + strengthScore + contextScore + priceScore,
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.model);

  const ordered = pinned ? [pinned, ...ranked.filter((model) => model.id !== pinned.id)] : ranked;
  return ordered.slice(0, limit);
}

/** The single best model for a task, or the provider default when nothing fits. */
export function selectModelForTask(task: AiTaskKind, options: ModelSelectionOptions = {}): string {
  const [first] = selectModelCandidates(task, { ...options, limit: 1 });
  if (first) return first.id;
  const provider = options.provider && isProvider(options.provider) ? options.provider : null;
  return (provider ? CATALOG_DEFAULT_MODELS[provider] : null) ?? CATALOG_DEFAULT_MODELS.openai;
}

/**
 * Safe, credential-free description of the routing for Settings and operator
 * diagnostics. It never includes keys.
 */
export function describeTaskRouting() {
  return (Object.keys(AI_TASK_PROFILES) as AiTaskKind[]).map((task) => {
    const profile = AI_TASK_PROFILES[task];
    return {
      task,
      label: profile.label,
      requiresJson: profile.requiresJson,
      preferredTiers: profile.preferredTiers,
      rationale: profile.rationale,
      defaultCandidates: selectModelCandidates(task, { limit: 3 }).map((model) => ({
        id: model.id,
        provider: model.provider,
        label: model.label,
        tier: model.tier,
      })),
    };
  });
}
