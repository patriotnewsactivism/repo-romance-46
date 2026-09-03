import { describe, expect, it } from "vitest";
import { getStageModels } from "./analysis";

describe("getStageModels", () => {
  // Production regression: provider "openrouter" had no case here, so every
  // tier fell through to the github_models default and the analysis worker
  // logged `Validating openrouter / gpt-4o-mini…` — a model identifier
  // OpenRouter does not accept.
  it("never hands OpenRouter a bare OpenAI model identifier", () => {
    for (const tier of ["fast", "balanced", "deep"]) {
      const stages = getStageModels("openrouter", tier);
      for (const model of [stages.profilerModel, stages.critiqueModel, stages.synthesisModel]) {
        expect(model).toBe("minimax/minimax-m3:free");
        expect(model).toContain("/");
      }
    }
  });

  it("runs the configured exact model on every stage", () => {
    const stages = getStageModels("openrouter", "balanced", "openai/gpt-5.6-luna");
    expect(stages.profilerModel).toBe("openai/gpt-5.6-luna");
    expect(stages.critiqueModel).toBe("openai/gpt-5.6-luna");
    expect(stages.synthesisModel).toBe("openai/gpt-5.6-luna");
  });

  it("honors the configured model for every provider and tier", () => {
    for (const provider of ["google", "openai", "anthropic", "openrouter"]) {
      for (const tier of ["fast", "balanced", "deep"]) {
        expect(getStageModels(provider, tier, "vendor/pinned-model").synthesisModel).toBe("vendor/pinned-model");
      }
    }
  });

  it("ignores a blank configured model and falls back to the provider default", () => {
    expect(getStageModels("google", "balanced", "   ").synthesisModel).toBe("gemini-3.7-flash");
    expect(getStageModels("google", "balanced", null).synthesisModel).toBe("gemini-3.7-flash");
    expect(getStageModels("google", "balanced", undefined).synthesisModel).toBe("gemini-3.7-flash");
  });

  it("keeps the existing per-provider stage defaults when nothing is configured", () => {
    expect(getStageModels("google", "balanced").synthesisModel).toBe("gemini-3.7-flash");
    expect(getStageModels("openai", "balanced").synthesisModel).toBe("o3-mini");
    expect(getStageModels("openai", "deep").synthesisModel).toBe("o3");
    expect(getStageModels("anthropic", "balanced").synthesisModel).toBe("claude-sonnet-4-20250514");
    expect(getStageModels("github_models", "balanced").synthesisModel).toBe("gpt-4o-mini");
  });

  it("preserves the deep-tier Anthropic thinking budget", () => {
    const stages = getStageModels("anthropic", "deep", "claude-sonnet-4-20250514");
    expect(stages.useThinking).toBe(true);
    expect(stages.thinkingBudget).toBe(10000);
  });
});
