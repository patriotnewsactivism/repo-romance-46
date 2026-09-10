export const DEFAULT_AI_MODELS = {
  google: "gemini-3.8-flash",
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  openrouter: "nex-agi/nex-n2.5-mini:free",
} as const;

export type SupportedAiProvider = keyof typeof DEFAULT_AI_MODELS;

/**
 * Model IDs are application configuration, not secrets. A user-selected model
 * always wins before this function is consulted; these are only safe in-code
 * defaults when the user leaves the model selection blank.
 */
export function defaultAiModel(provider: string): string | null {
  return DEFAULT_AI_MODELS[provider as SupportedAiProvider] ?? null;
}
