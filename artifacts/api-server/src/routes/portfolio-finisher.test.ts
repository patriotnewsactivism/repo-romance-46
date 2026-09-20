import { describe, expect, it } from "vitest";
import { isSystemicProviderError } from "./portfolio-finisher";

describe("isSystemicProviderError", () => {
  it("detects OpenRouter 402 insufficient credits errors", () => {
    const err = new Error(
      'OpenRouter API error 402 for model "openai/gpt-oss-120b": Insufficient credits. Add more using https://openrouter.ai/settings/credits',
    );
    expect(isSystemicProviderError(err)).toBe(true);
  });

  it("detects error objects with AI_PROVIDER_PAYMENT_REQUIRED code", () => {
    const err = Object.assign(new Error("Credits exhausted"), { code: "AI_PROVIDER_PAYMENT_REQUIRED", status: 402 });
    expect(isSystemicProviderError(err)).toBe(true);
  });

  it("detects 401 unauthorized errors", () => {
    const err = Object.assign(new Error("Invalid API key"), { code: "AI_PROVIDER_UNAUTHORIZED", status: 401 });
    expect(isSystemicProviderError(err)).toBe(true);
  });

  it("detects AI_PROVIDER_UNCONFIGURED errors", () => {
    const err = Object.assign(new Error("No credentials configured"), { code: "AI_PROVIDER_UNCONFIGURED", status: 424 });
    expect(isSystemicProviderError(err)).toBe(true);
  });

  it("detects raw error text containing insufficient credits or openrouter_credits", () => {
    expect(isSystemicProviderError("Error: openrouter_credits limit reached")).toBe(true);
    expect(isSystemicProviderError("Insufficient credits. Add more using https://openrouter.ai/settings/credits")).toBe(true);
  });

  it("does not trigger on normal non-systemic repo errors", () => {
    expect(isSystemicProviderError(null)).toBe(false);
    expect(isSystemicProviderError(undefined)).toBe(false);
    expect(isSystemicProviderError(new Error("Git tree was truncated: repo too large"))).toBe(false);
    expect(isSystemicProviderError(new Error("Merge conflict on package.json"))).toBe(false);
    expect(isSystemicProviderError(new Error("npm test failed with exit code 1"))).toBe(false);
    expect(isSystemicProviderError(new Error("Network timeout after 45000ms"))).toBe(false);
  });
});
