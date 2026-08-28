import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPENROUTER_MODEL,
  isSupportedOpenRouterModel,
  OPENROUTER_MODELS,
} from "./openrouter-models";

describe("OpenRouter model policy", () => {
  it("defaults to the ultra-low-cost DeepSeek V4 Flash model", () => {
    expect(DEFAULT_OPENROUTER_MODEL).toBe("deepseek/deepseek-v4-flash-0731");
  });

  it("allows only the curated reasoning models exposed in Settings", () => {
    expect(OPENROUTER_MODELS).toContain("deepseek/deepseek-v4-pro-0813");
    expect(OPENROUTER_MODELS).toContain("google/gemini-3.7-flash");
    expect(OPENROUTER_MODELS).toContain("openai/gpt-5.6-luna");
    expect(isSupportedOpenRouterModel("openai/gpt-5.6-luna")).toBe(true);
    expect(isSupportedOpenRouterModel("openrouter/auto")).toBe(false);
  });
});
