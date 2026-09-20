import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRODUCTION_MODEL,
  MODEL_CATALOG,
  getDefaultProductionModel,
  selectModel,
} from "./model-router";

describe("model router catalog", () => {
  it("contains reliable candidates from all required providers", () => {
    const providers = new Set(MODEL_CATALOG.map((candidate) => candidate.provider));
    expect(providers).toEqual(new Set(["openrouter", "google", "openai", "anthropic"]));
    expect(MODEL_CATALOG.every((candidate) => candidate.capabilities.length > 0)).toBe(true);
    expect(MODEL_CATALOG.some((candidate) => candidate.isPaid && candidate.isReliable)).toBe(true);
  });
});

describe("selectModel", () => {
  it("returns a reliable paid model by default", () => {
    const model = selectModel({ taskType: "analysis" });
    expect(model.isPaid).toBe(true);
    expect(model.isReliable).toBe(true);
    expect(model.capabilities).toContain("analysis");
  });

  it("honors an exact configured user preference", () => {
    expect(selectModel({ taskType: "repair", userPreferredModel: "openai/gpt-4o" }).id).toBe("openai/gpt-4o");
  });

  it("rejects an unconfigured user preference instead of silently substituting", () => {
    expect(() => selectModel({ taskType: "analysis", userPreferredModel: "missing/model" })).toThrow(
      /userPreferredModel/,
    );
  });

  it("enforces paid-model requirements", () => {
    const model = selectModel({ taskType: "critique", requirePaid: true });
    expect(model.isPaid).toBe(true);
    expect(() => selectModel({ taskType: "critique", userPreferredModel: "minimax/minimax-m3:free", requirePaid: true })).toThrow(
      /No configured model/,
    );
  });

  it("enforces the cost boundary", () => {
    expect(selectModel({ taskType: "planning", requirePaid: true, maxCostUsd: 0.02 }).id).toBe("openrouter/auto");
    expect(() => selectModel({ taskType: "planning", requirePaid: true, maxCostUsd: 0.001 })).toThrow(
      /maxCostUsd/,
    );
  });

  it("uses speed preference when requested", () => {
    expect(selectModel({ taskType: "analysis", preferSpeed: true }).id).toBe("openai/gpt-4o");
  });

  it("rejects unsupported tasks and invalid budgets", () => {
    expect(() => selectModel({ taskType: "unsupported" as never })).toThrow(/taskType/);
    expect(() => selectModel({ taskType: "analysis", maxCostUsd: -1 })).toThrow(/maxCostUsd/);
  });
});

describe("getDefaultProductionModel", () => {
  it("prefers OPENROUTER_MODEL, then AI_MODEL, then a reliable default", () => {
    expect(getDefaultProductionModel({ OPENROUTER_MODEL: "openrouter/preferred", AI_MODEL: "common" })).toBe(
      "openrouter/preferred",
    );
    expect(getDefaultProductionModel({ OPENROUTER_MODEL: " ", AI_MODEL: "common" })).toBe("common");
    expect(getDefaultProductionModel({})).toBe(DEFAULT_PRODUCTION_MODEL);
  });
});
