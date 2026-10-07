import { describe, expect, it } from "vitest";
import { ANALYSIS_BATCH_REQUEST_TIMEOUT_MS, acceptRecommendationPayload, aiBatchConcurrency, analysisBatchOutcome, analysisBatchTimeoutMs, analysisJobBudgetMs, describeAnalysisBatchFailure, getStageModels, profilingProviderTimeoutMs, profilingTimeoutMs, isActionPlanSchemaMissing, actionPlanStateCache } from "./analysis";
import { DEFAULT_REQUEST_TIMEOUT_MS, providerRequestError } from "../lib/ai-provider";

describe("getStageModels", () => {
  // Production regression: provider "openrouter" had no case here, so every
  // tier fell through to the github_models default and the analysis worker
  // logged `Validating openrouter / gpt-4o-mini…` — a model identifier
  // OpenRouter does not accept.
  it("never hands OpenRouter a bare OpenAI model identifier", () => {
    for (const tier of ["fast", "balanced", "deep"]) {
      const stages = getStageModels("openrouter", tier);
      for (const model of [stages.profilerModel, stages.critiqueModel, stages.synthesisModel]) {
        expect(model).toBe("nex-agi/nex-n2.5-mini:free");
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
    expect(getStageModels("google", "balanced", "   ").synthesisModel).toBe("gemini-3.8-flash");
    expect(getStageModels("google", "balanced", null).synthesisModel).toBe("gemini-3.8-flash");
    expect(getStageModels("google", "balanced", undefined).synthesisModel).toBe("gemini-3.8-flash");
  });

  it("uses the shared in-code provider defaults when nothing is configured", () => {
    expect(getStageModels("google", "balanced").synthesisModel).toBe("gemini-3.8-flash");
    expect(getStageModels("openai", "balanced").synthesisModel).toBe("gpt-4o");
    expect(getStageModels("openai", "deep").synthesisModel).toBe("gpt-4o");
    expect(getStageModels("anthropic", "balanced").synthesisModel).toBe("claude-sonnet-4-20250514");
    expect(getStageModels("github_models", "balanced").synthesisModel).toBe("gpt-4o");
  });

  it("preserves the deep-tier Anthropic thinking budget", () => {
    const stages = getStageModels("anthropic", "deep", "claude-sonnet-4-20250514");
    expect(stages.useThinking).toBe(true);
    expect(stages.thinkingBudget).toBe(10000);
  });
});

describe("profilingTimeoutMs", () => {
  it("gives large portfolios multi-minute provider time", () => {
    expect(profilingProviderTimeoutMs(50)).toBe(160000);
    expect(profilingProviderTimeoutMs(100)).toBe(200000);
    expect(profilingProviderTimeoutMs(230)).toBe(300000);
  });

  it("keeps the outer watchdog above the provider deadline", () => {
    for (const repoCount of [0, 1, 5, 50, 100, 230, 500]) {
      expect(profilingTimeoutMs(repoCount)).toBeGreaterThan(profilingProviderTimeoutMs(repoCount));
      expect(profilingTimeoutMs(repoCount)).toBeGreaterThan(DEFAULT_REQUEST_TIMEOUT_MS);
    }
  });

  it("caps profiling at five provider minutes plus watchdog margin", () => {
    expect(profilingProviderTimeoutMs(500)).toBe(300000);
    expect(profilingTimeoutMs(500)).toBe(345000);
  });
});


describe("OpenRouter portfolio batch runtime", () => {
  it("limits OpenRouter analysis concurrency to two heavy requests", () => {
    expect(aiBatchConcurrency("openrouter")).toBe(2);
  });

  it("gives each heavy analysis request seven minutes", () => {
    expect(ANALYSIS_BATCH_REQUEST_TIMEOUT_MS).toBe(420000);
  });

  it("budgets both retry attempts across all OpenRouter waves", () => {
    // Six batches at concurrency two means three waves. Each wave can consume
    // two seven-minute attempts plus retry/orchestration margin.
    expect(analysisBatchTimeoutMs(6, 2)).toBe(2685000);
  });

  it("caps the heavy batch stage at 75 minutes", () => {
    expect(analysisBatchTimeoutMs(100, 2)).toBe(4500000);
  });
});

describe("analysisJobBudgetMs", () => {
  it("scales from ordinary portfolios up to a 90 minute full-portfolio cap", () => {
    expect(analysisJobBudgetMs(50)).toBe(1900000);
    expect(analysisJobBudgetMs(100)).toBe(2900000);
    expect(analysisJobBudgetMs(230)).toBe(5400000);
    expect(analysisJobBudgetMs(1000)).toBe(5400000);
  });
});

describe("portfolio survey batch failures", () => {
  const apodexParameter = () =>
    providerRequestError(
      "openrouter",
      "apodex/apodex-1.1-mini:free",
      400,
      JSON.stringify({ error: { message: "reasoning.effort is not supported" } }),
    );

  it("does not describe an Apodex parameter rejection as a rate limit", () => {
    const message = describeAnalysisBatchFailure(6, Array.from({ length: 6 }, () => apodexParameter()));
    expect(message).toMatch(/All 6 AI batch\(es\) failed/);
    expect(message.toLowerCase()).not.toMatch(/rate-limit/);
    expect(message.toLowerCase()).toMatch(/rejected the request parameters/);
  });

  it("does not describe auth or unknown-model failures as rate limits", () => {
    const auth = providerRequestError(
      "openrouter",
      "apodex/apodex-1.1-mini:free",
      401,
      JSON.stringify({ error: { message: "Invalid API key provided" } }),
    );
    const unknown = providerRequestError(
      "openrouter",
      "apidex/apidex",
      400,
      JSON.stringify({ error: { message: "apidex/apidex is not a valid model ID" } }),
    );
    expect(describeAnalysisBatchFailure(6, [auth]).toLowerCase()).not.toMatch(/rate-limit/);
    expect(describeAnalysisBatchFailure(6, [auth]).toLowerCase()).toMatch(/credential/);
    expect(describeAnalysisBatchFailure(6, [unknown]).toLowerCase()).not.toMatch(/rate-limit/);
    expect(describeAnalysisBatchFailure(6, [unknown]).toLowerCase()).toMatch(/not recognized/);
  });

  it("describes an actual rate limit as a rate limit", () => {
    const limited = providerRequestError("openrouter", "apodex/apodex-1.1-mini:free", 429, "slow down");
    expect(describeAnalysisBatchFailure(2, [limited, limited]).toLowerCase()).toMatch(/rate-limited/);
  });

  it("keeps repository recommendations when one batch fails", () => {
    const accepted = acceptRecommendationPayload({
      summary: "One repo is ready to finish.",
      recommendations: [
        {
          kind: "FINISH",
          title: "Ship the API",
          repo: "owner/repo-romance",
          description: "The Express API is the product.",
          effort: "2.4",
          market_potential: 4.2,
          steps: "Add tests\nDeploy the API",
        },
      ],
    });
    expect(accepted).not.toBeNull();
    const outcome = analysisBatchOutcome([
      { status: "fulfilled", value: accepted! },
      { status: "rejected", reason: apodexParameter() },
    ]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.failedBatches).toBe(1);
    expect(outcome.recommendations).toHaveLength(1);
    expect(outcome.recommendations[0]).toMatchObject({
      kind: "finish",
      repos: ["owner/repo-romance"],
      effort: 2,
      market_potential: 4,
    });
    expect(outcome.recommendations[0]?.next_steps).toEqual(["Add tests", "Deploy the API"]);
  });

  it("fails the survey only when every batch failed, and says why", () => {
    const outcome = analysisBatchOutcome([
      { status: "rejected", reason: apodexParameter() },
      { status: "rejected", reason: new Error("Model response could not be parsed into the expected JSON") },
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message.toLowerCase()).not.toMatch(/rate-limit/);
    expect(outcome.message.toLowerCase()).toMatch(/rejected the request parameters/);
  });
});

describe("isActionPlanSchemaMissing", () => {
  it("detects PostgREST PGRST204 missing column error", () => {
    expect(
      isActionPlanSchemaMissing({
        code: "PGRST204",
        message: "Could not find the 'action_plan' column of 'analyses' in the schema cache",
      }),
    ).toBe(true);
  });

  it("detects PostgREST PGRST205 missing table/column error", () => {
    expect(isActionPlanSchemaMissing({ code: "PGRST205", message: "schema cache lookup failed" })).toBe(true);
  });

  it("detects PostgreSQL 42703 undefined_column error", () => {
    expect(
      isActionPlanSchemaMissing({
        code: "42703",
        message: 'column "action_plan" does not exist',
      }),
    ).toBe(true);
  });

  it("detects error message mentioning action_plan and schema cache or column", () => {
    expect(
      isActionPlanSchemaMissing({
        message: "Could not find the 'action_plan_status' column of 'analyses' in the schema cache",
      }),
    ).toBe(true);
  });

  it("does not false-positive on other unrelated errors", () => {
    expect(isActionPlanSchemaMissing(null)).toBe(false);
    expect(isActionPlanSchemaMissing(undefined)).toBe(false);
    expect(isActionPlanSchemaMissing(new Error("Connection reset by peer"))).toBe(false);
    expect(isActionPlanSchemaMissing({ code: "23505", message: "duplicate key value violates unique constraint" })).toBe(false);
    expect(isActionPlanSchemaMissing({ message: "Analysis not found" })).toBe(false);
  });
});

describe("actionPlanStateCache", () => {
  it("stores and retrieves state by key", () => {
    const key = "user-1:analysis-1";
    actionPlanStateCache.set(key, {
      status: "running",
      plan: null,
      error: null,
      updatedAt: new Date().toISOString(),
    });

    const cached = actionPlanStateCache.get(key);
    expect(cached?.status).toBe("running");
    expect(cached?.plan).toBeNull();

    actionPlanStateCache.set(key, {
      status: "completed",
      plan: { total_weeks: 4, phases: [] },
      error: null,
      updatedAt: new Date().toISOString(),
    });

    const updated = actionPlanStateCache.get(key);
    expect(updated?.status).toBe("completed");
    expect(updated?.plan?.total_weeks).toBe(4);

    actionPlanStateCache.delete(key);
  });
});

