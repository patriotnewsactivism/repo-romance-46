import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertAiReady, describePreflightFailure } from "./ai-preflight";
import * as provider from "./ai-provider";
import { isVendorSlashModel, loadAiCredential } from "./credentials";

describe("isVendorSlashModel", () => {
  it("recognises OpenRouter vendor/model slugs", () => {
    expect(isVendorSlashModel("qwen/qwen3.8-max-prime")).toBe(true);
    expect(isVendorSlashModel("z-ai/glm-5.3-flashx")).toBe(true);
    expect(isVendorSlashModel("openai/gpt-oss-20b:free")).toBe(true);
  });
  it("rejects bare names and blanks", () => {
    expect(isVendorSlashModel("gpt-5")).toBe(false);
    expect(isVendorSlashModel("qwen-plus")).toBe(false);
    expect(isVendorSlashModel("")).toBe(false);
    expect(isVendorSlashModel(null)).toBe(false);
    expect(isVendorSlashModel("/leading")).toBe(false);
  });
});

describe("describePreflightFailure", () => {
  it("names a rejected key", () => {
    const msg = describePreflightFailure(
      "openrouter",
      "qwen/x",
      new Error("OpenRouter API error 401: Missing Authentication header"),
    );
    expect(msg).toMatch(/key was rejected/);
  });
  it("names a missing model", () => {
    expect(
      describePreflightFailure(
        "openrouter",
        "bad/model",
        new Error("404 No endpoints found"),
      ),
    ).toMatch(/does not recognise the model "bad\/model"/);
  });
  it("names rate limits and credit", () => {
    expect(
      describePreflightFailure(
        "openrouter",
        "a/b",
        new Error("429 rate limit"),
      ),
    ).toMatch(/rate-limited/);
    expect(
      describePreflightFailure(
        "openrouter",
        "a/b",
        new Error("402 insufficient credits"),
      ),
    ).toMatch(/no credit/);
  });
});

describe("assertAiReady", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fails fast with a clear 424 when there is no key, without calling the provider", async () => {
    const spy = vi.spyOn(provider, "callAI");
    await expect(
      assertAiReady({ provider: "openrouter", model: "a/b", apiKey: null }),
    ).rejects.toMatchObject({ status: 424 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("resolves when the model answers", async () => {
    vi.spyOn(provider, "callAI").mockResolvedValue({
      content: "ready",
      model: "a/b",
    } as never);
    await expect(
      assertAiReady({ provider: "openrouter", model: "a/b", apiKey: "k" }),
    ).resolves.toBeUndefined();
  });

  it("turns a provider 401 into a 422 with an actionable message", async () => {
    vi.spyOn(provider, "callAI").mockRejectedValue(
      new Error("OpenRouter API error 401: Missing Authentication header"),
    );
    await expect(
      assertAiReady({ provider: "openrouter", model: "a/b", apiKey: "k" }),
    ).rejects.toMatchObject({
      status: 422,
      code: "AI_PREFLIGHT_FAILED",
      publicMessage: expect.stringMatching(/key was rejected/),
    });
  });
});

/** Minimal fake Supabase: user_preferences row + no stored provider secrets. */
function fakeSupabase(prefs: Record<string, unknown>) {
  const chain = (table: string) => {
    const api: Record<string, unknown> = {};
    api.select = () => api;
    api.eq = () => api;
    api.maybeSingle = async () => ({
      data: table === "user_preferences" ? prefs : null,
      error: null,
    });
    return api;
  };
  return { from: (t: string) => chain(t) } as never;
}

describe("loadAiCredential slash-model routing", () => {
  const keys = [
    "OPENROUTER_API_KEY",
    "OPENROUTER_FREE_API_KEY",
    "OPENROUTER_API_KEY_2",
    "QWEN_API_KEY",
    "DASHSCOPE_API_KEY",
    "AI_PROVIDER",
  ];
  const saved = new Map<string, string | undefined>();
  beforeEach(() => {
    for (const k of keys) {
      saved.set(k, process.env[k]);
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of keys) {
      const v = saved.get(k);
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("reroutes a vendor/model slug to OpenRouter when the saved provider has no key", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    const cred = await loadAiCredential(
      fakeSupabase({
        custom_ai_provider: "qwen",
        custom_ai_model: "qwen/qwen3.8-max-prime",
      }),
      "user-1",
    );
    expect(cred.provider).toBe("openrouter");
    expect(cred.model).toBe("qwen/qwen3.8-max-prime");
    expect(cred.apiKey).toBe("or-key");
  });

  it("does not reroute a bare model name", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    const cred = await loadAiCredential(
      fakeSupabase({
        custom_ai_provider: "qwen",
        custom_ai_model: "qwen-plus",
      }),
      "user-1",
    );
    expect(cred.provider).toBe("qwen");
    expect(cred.apiKey).toBeNull();
  });

  it("keeps the saved provider when it has its own key", async () => {
    process.env.QWEN_API_KEY = "q-key";
    process.env.OPENROUTER_API_KEY = "or-key";
    const cred = await loadAiCredential(
      fakeSupabase({ custom_ai_provider: "qwen", custom_ai_model: "qwen/x" }),
      "user-1",
    );
    expect(cred.provider).toBe("qwen");
    expect(cred.apiKey).toBe("q-key");
  });
});

describe("assertAiReady free-model retry", () => {
  afterEach(() => vi.restoreAllMocks());
  const free = { provider: "openrouter", apiKey: "k", model: "nvidia/x:free" } as never;
  const paid = { provider: "openrouter", apiKey: "k", model: "z-ai/paid" } as never;

  it("recovers when a free model stalls once then answers", async () => {
    const spy = vi
      .spyOn(provider, "callAI")
      .mockRejectedValueOnce(new Error("OpenRouter request exceeded 45s"))
      .mockResolvedValueOnce({ content: "ready" } as never);
    await expect(assertAiReady(free)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("does not retry a paid model on a transient failure", async () => {
    const spy = vi.spyOn(provider, "callAI").mockRejectedValue(new Error("429 rate limit"));
    await expect(assertAiReady(paid)).rejects.toMatchObject({ status: 422 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("never retries a rejected key, even on a free model", async () => {
    const spy = vi.spyOn(provider, "callAI").mockRejectedValue(new Error("401 Missing Authentication header"));
    await expect(assertAiReady(free)).rejects.toMatchObject({ status: 422, publicMessage: expect.stringMatching(/key was rejected/) });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("fails with a clear message after both free attempts stall", async () => {
    const spy = vi.spyOn(provider, "callAI").mockRejectedValue(new Error("OpenRouter request exceeded 45s"));
    await expect(assertAiReady(free)).rejects.toMatchObject({ status: 422 });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
