import { describe, expect, it } from "vitest";
import { normalizeAiProvider } from "./credentials";

describe("normalizeAiProvider", () => {
  it("keeps supported providers including OpenRouter", () => {
    expect(normalizeAiProvider("openrouter")).toBe("openrouter");
    expect(normalizeAiProvider("OPENAI")).toBe("openai");
    expect(normalizeAiProvider("anthropic")).toBe("anthropic");
    expect(normalizeAiProvider("google")).toBe("google");
  });

  it("moves historical providers to the configured fallback", () => {
    expect(normalizeAiProvider("github_models", "openrouter")).toBe("openrouter");
    expect(normalizeAiProvider("lovable", "google")).toBe("google");
  });

  it("does not permit arbitrary unsupported provider names", () => {
    expect(normalizeAiProvider("made-up-provider", "google")).toBe("google");
  });
});
