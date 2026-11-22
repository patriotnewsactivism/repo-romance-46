/**
 * Single source of truth for in-code provider defaults.
 *
 * A user-saved model always wins. These IDs are only used when Settings left
 * the model blank. OpenRouter's default is the free agent-pool sentinel —
 * `callAI` may fail over within OPENROUTER_AGENT_CHAIN only for this slug.
 *
 * The reviewed catalog lives in `ai-model-catalog.ts`; this module keeps the
 * shape existing callers depend on while removing the drift that used to exist
 * between the API defaults, the Settings picker, and the model router.
 */
import { CATALOG_DEFAULT_MODELS, type AiProviderId } from "./ai-model-catalog";

export const DEFAULT_AI_MODELS = {
  google: CATALOG_DEFAULT_MODELS.google,
  openai: CATALOG_DEFAULT_MODELS.openai,
  anthropic: CATALOG_DEFAULT_MODELS.anthropic,
  // Kept as a literal so the OpenRouter pool sentinel in `ai-provider.ts`
  // cannot silently diverge from the catalog default.
  openrouter: "nex-agi/nex-n2.5-mini:free",
  qwen: CATALOG_DEFAULT_MODELS.qwen,
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

/** Provider default from the reviewed catalog, including providers with no pool. */
export function catalogDefaultAiModel(provider: string): string | null {
  if (provider in CATALOG_DEFAULT_MODELS) {
    return CATALOG_DEFAULT_MODELS[provider as AiProviderId];
  }
  return defaultAiModel(provider);
}
