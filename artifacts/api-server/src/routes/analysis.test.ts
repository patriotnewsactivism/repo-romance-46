import { describe, expect, it } from "vitest";
import { getStageModels, profilingTimeoutMs } from "./analysis";
import { DEFAULT_REQUEST_TIMEOUT_MS } from "../lib/ai-provider";

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

describe("profilingTimeoutMs", () => {
  // Production regression: "Portfolio profiling" used a flat 30_000ms outer
  // timeout, which is *less* than DEFAULT_REQUEST_TIMEOUT_MS (45_000ms) —
  // the single-attempt budget callAI itself gives this exact call (see
  // ai-provider.test.ts's "uses the normal request timeout for other AI
  // stages" case, which asserts 45000 for the portfolio-profiler prompt).
  // The outer race fired before the inner call could ever use the time it
  // was actually given, so every run failed with "Portfolio profiling
  // exceeded 30s timeout..." once the call legitimately took over 30s —
  // which larger portfolios and slower (e.g. Deep-tier) models made routine.
  it("always allows more time than the inner AI request timeout", () => {
    for (const repoCount of [0, 1, 5, 50, 98, 500]) {
      expect(profilingTimeoutMs(repoCount)).toBeGreaterThan(DEFAULT_REQUEST_TIMEOUT_MS);
    }
  });

  it("grows with portfolio size", () => {
    expect(profilingTimeoutMs(500)).toBeGreaterThan(profilingTimeoutMs(50));
    expect(profilingTimeoutMs(50)).toBeGreaterThan(profilingTimeoutMs(5));
  });

  it("matches the exact budget for a 98-repo portfolio (the reported production case)", () => {
    // DEFAULT_REQUEST_TIMEOUT_MS (45_000) + 98 * 500 = 94_000ms — comfortably
    // above the old flat 30_000ms ceiling that always failed for this user.
    expect(profilingTimeoutMs(98)).toBe(94000);
  });

  it("never drops below the floor for small portfolios", () => {
    expect(profilingTimeoutMs(0)).toBe(DEFAULT_REQUEST_TIMEOUT_MS + 15000);
    expect(profilingTimeoutMs(2)).toBe(DEFAULT_REQUEST_TIMEOUT_MS + 15000);
  });
});
