export const OPENROUTER_MODELS = [
  "deepseek/deepseek-v4-flash-0731",
  "deepseek/deepseek-v4-pro-0813",
  "google/gemini-3.7-flash",
  "openai/gpt-5.6-luna",
] as const;

export type OpenRouterModel = (typeof OPENROUTER_MODELS)[number];

export const DEFAULT_OPENROUTER_MODEL: OpenRouterModel = "deepseek/deepseek-v4-flash-0731";

export function isSupportedOpenRouterModel(value: unknown): value is OpenRouterModel {
  return typeof value === "string" && (OPENROUTER_MODELS as readonly string[]).includes(value);
}
