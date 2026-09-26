/**
 * Single source of truth for in-code provider defaults.
 *
 * A user-saved model always wins. These IDs are only used when Settings left
 * the model blank. OpenRouter's default is the free agent-pool sentinel —
 * `callAI` may fail over within OPENROUTER_AGENT_CHAIN only for this slug.
 */
export const DEFAULT_AI_MODELS = {
  google: "gemini-3.8-flash",
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  openrouter: "nex-agi/nex-n2.5-mini:free",
  qwen: "qwen-plus",
} as const;

export const OPENROUTER_FREE_AGENT_POOL_MODEL = DEFAULT_AI_MODELS.openrouter;

export type SupportedAiProvider = keyof typeof DEFAULT_AI_MODELS;

/**
 * Model IDs are application configuration, not secrets. A user-selected model
 * always wins before this function is consulted; these are only safe in-code
 * defaults when the user leaves the model selection blank.
 */
export function defaultAiModel(provider: string): string | null {
  return DEFAULT_AI_MODELS[provider as SupportedAiProvider] ?? null;
}
