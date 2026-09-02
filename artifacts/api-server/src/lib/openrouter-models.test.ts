import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchOpenRouterModels,
  normalizeOpenRouterModel,
  normalizeOpenRouterReasoningEffort,
} from "./openrouter-models";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OpenRouter model normalization", () => {
  it("preserves exact slugs, pricing, reasoning metadata, tools, and context", () => {
    const model = normalizeOpenRouterModel({
      id: "vendor/reasoner",
      name: "Reasoner",
      context_length: 1_000_000,
      pricing: { prompt: "0.00000015", completion: "0.00000047" },
      supported_parameters: ["reasoning", "tools"],
      reasoning: {
        supported_efforts: ["high", "xhigh"],
        default_effort: "high",
        supports_max_tokens: true,
      },
    }, 3);
    expect(model).toMatchObject({
      id: "vendor/reasoner",
      provider: "vendor",
      inputPricePerMillion: 0.15,
      outputPricePerMillion: 0.47,
      contextLength: 1_000_000,
      supportsReasoning: true,
      supportedEfforts: ["high", "xhigh"],
      defaultEffort: "high",
      supportsReasoningMaxTokens: true,
      supportsTools: true,
      isFree: false,
      catalogRank: 3,
    });
  });

  it("does not mislabel unknown pricing as free", () => {
    const model = normalizeOpenRouterModel({ id: "vendor/unknown", pricing: {} });
    expect(model?.inputPricePerMillion).toBeNull();
    expect(model?.outputPricePerMillion).toBeNull();
    expect(model?.isFree).toBe(false);
  });

  it("rejects unsupported saved reasoning effort values", () => {
    expect(normalizeOpenRouterReasoningEffort("xhigh")).toBe("xhigh");
    expect(normalizeOpenRouterReasoningEffort(" turbo ")).toBeNull();
  });
});
describe("OpenRouter live model discovery", () => {
  it("uses the user-specific catalog with text modality, server-side sort, and bearer auth", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        data: [{ id: "vendor/free-reasoner", pricing: { prompt: "0", completion: "0" }, supported_parameters: ["reasoning"] }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
    );

    const result = await fetchOpenRouterModels(" test-key ", "pricing-low-to-high");

    expect(result.source).toBe("user");
    expect(result.models[0]).toMatchObject({ id: "vendor/free-reasoner", isFree: true });
    const [requestUrl, init] = fetchMock.mock.calls[0];
    const url = new URL(String(requestUrl));
    expect(url.pathname).toBe("/api/v1/models/user");
    expect(url.searchParams.get("output_modalities")).toBe("text");
    expect(url.searchParams.get("sort")).toBe("pricing-low-to-high");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
  });

  it("falls back to the public catalog only when the user-catalog endpoint is unavailable", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "vendor/model", pricing: { prompt: "0", completion: "0" } }] }), { status: 200 }));

    const result = await fetchOpenRouterModels("test-key");
    expect(result.source).toBe("catalog");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchMock.mock.calls[1][0])).pathname).toBe("/api/v1/models");
  });
});
