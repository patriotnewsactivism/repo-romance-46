import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeAiProvider, platformAiKey, platformAiProvider, platformAiStatus } from "./credentials";

const AI_ENV_KEYS = [
  "AI_PROVIDER",
  "OPENROUTER_API_KEY",
  "OPENROUTER_FREE_API_KEY",
  "OPENROUTER_API_KEY_2",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
] as const;

const originalAiEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of AI_ENV_KEYS) {
    originalAiEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of AI_ENV_KEYS) {
    const original = originalAiEnv.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  originalAiEnv.clear();
});

describe("normalizeAiProvider", () => {
  it("keeps supported providers including OpenRouter", () => {
    expect(normalizeAiProvider("openrouter")).toBe("openrouter");
    expect(normalizeAiProvider("OPENAI")).toBe("openai");
    expect(normalizeAiProvider("anthropic")).toBe("anthropic");
    expect(normalizeAiProvider("google")).toBe("google");
  });

  it("defaults missing provider state to OpenRouter", () => {
    expect(normalizeAiProvider(undefined)).toBe("openrouter");
    expect(normalizeAiProvider(null)).toBe("openrouter");
  });

  it("moves historical providers to the configured fallback", () => {
    expect(normalizeAiProvider("github_models", "openrouter")).toBe("openrouter");
    expect(normalizeAiProvider("lovable", "google")).toBe("google");
  });

  it("does not permit arbitrary unsupported provider names", () => {
    expect(normalizeAiProvider("made-up-provider", "google")).toBe("google");
  });
});

describe("platformAiProvider", () => {
  it("prefers OpenRouter when its platform credential is available", () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.GEMINI_API_KEY = "test-gemini-key";
    expect(platformAiProvider()).toBe("openrouter");
  });

  it("honors an explicitly configured provider when it has a usable key", () => {
    process.env.AI_PROVIDER = "google";
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    expect(platformAiProvider()).toBe("google");
  });

  it("fails over from an unusable configured provider to an available key", () => {
    process.env.AI_PROVIDER = "google";
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    expect(platformAiProvider()).toBe("openrouter");
  });

  it("uses OpenRouter as the BYOK-oriented default when no platform key exists", () => {
    expect(platformAiProvider()).toBe("openrouter");
  });
});

describe("blank platform credentials", () => {
  // A Render env var that exists but holds only whitespace used to read as a
  // configured credential all the way to the provider call.
  it("does not treat a whitespace-only key as a configured platform credential", () => {
    process.env.OPENROUTER_API_KEY = "   ";
    expect(platformAiKey("openrouter")).toBeNull();
    expect(platformAiStatus().providers.openrouter.platformConfigured).toBe(false);
  });

  it("fails over to a provider that has a real key rather than selecting the blank one", () => {
    process.env.AI_PROVIDER = "openrouter";
    process.env.OPENROUTER_API_KEY = " ";
    process.env.GEMINI_API_KEY = "test-gemini-key";
    expect(platformAiProvider()).toBe("google");
  });

  it("trims a padded key so it is usable instead of silently failing to authenticate", () => {
    process.env.OPENROUTER_API_KEY = "  test-openrouter-key\n";
    expect(platformAiKey("openrouter")).toBe("test-openrouter-key");
  });

  it("prefers the free-tier key labels over the legacy OPENROUTER_API_KEY", () => {
    process.env.OPENROUTER_API_KEY = "legacy-key";
    expect(platformAiKey("openrouter")).toBe("legacy-key");

    process.env.OPENROUTER_API_KEY_2 = "backup-key";
    expect(platformAiKey("openrouter")).toBe("backup-key");

    process.env.OPENROUTER_FREE_API_KEY = "free-key";
    expect(platformAiKey("openrouter")).toBe("free-key");
  });

  it("normalizes blank values for every platform provider", () => {
    process.env.GEMINI_API_KEY = " ";
    process.env.GOOGLE_API_KEY = "\t";
    process.env.OPENAI_API_KEY = "  ";
    process.env.ANTHROPIC_API_KEY = "\n";
    expect(platformAiKey("google")).toBeNull();
    expect(platformAiKey("openai")).toBeNull();
    expect(platformAiKey("anthropic")).toBeNull();
  });
});
