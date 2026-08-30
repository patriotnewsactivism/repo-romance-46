import { afterEach, describe, expect, it, vi } from "vitest";
import { callAI, resolveAIRequestTimeoutMs, sanitizeGeminiResponseSchema, type AIRequest } from "./ai-provider";

function request(system: string, extra: Partial<AIRequest> = {}): AIRequest {
  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: "test" },
    ],
    ...extra,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveAIRequestTimeoutMs", () => {
  it("keeps the portfolio final-synthesis pass short so validated draft results can be used instead of hanging", () => {
    expect(
      resolveAIRequestTimeoutMs(
        request("You are a world-class product strategist performing the final synthesis of a developer portfolio analysis."),
      ),
    ).toBe(8000);
  });

  it("uses the normal request timeout for other AI stages", () => {
    expect(resolveAIRequestTimeoutMs(request("You are the portfolio profiler."))).toBe(45000);
  });

  it("honors an explicit bounded timeout", () => {
    expect(resolveAIRequestTimeoutMs(request("custom", { timeoutMs: 12000 }))).toBe(12000);
    expect(resolveAIRequestTimeoutMs(request("custom", { timeoutMs: 10 }))).toBe(1000);
    expect(resolveAIRequestTimeoutMs(request("custom", { timeoutMs: 999999 }))).toBe(120000);
  });
});

describe("OpenRouter routing", () => {
  it("uses the saved provider model and OpenRouter bearer endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ready" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await callAI(
      request("provider test", { timeoutMs: 1000 }),
      { provider: "openrouter", model: "example/vendor-model", apiKey: "test-api-key" },
    );

    expect(result.content).toBe("ready");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-api-key");
    expect(headers.get("x-title")).toBe("RepoFinisher");
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("example/vendor-model");
  });

  it("lets an explicit request model override the saved model", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await callAI(
      request("override", { model: "request/model", timeoutMs: 1000 }),
      { provider: "openrouter", model: "saved/model", apiKey: "test-api-key" },
    );

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("request/model");
  });
});

describe("credential normalization", () => {
  // Production regression: a blank-but-present OpenRouter credential was sent as
  // `Authorization: Bearer `, and OpenRouter answered
  // `401 {"error":{"message":"Missing Authentication header","code":401}}`.
  // That surfaced in the UI as a provider integration failure rather than the
  // real problem, which was that no usable key was configured.
  it.each([" ", "   ", "\t", "\n", ""])(
    "treats a blank credential (%j) as no credential instead of sending an empty bearer",
    async (blank) => {
      const fetchMock = vi.spyOn(globalThis, "fetch");

      await expect(
        callAI(request("blank credential", { timeoutMs: 1000 }), {
          provider: "openrouter",
          model: "example/vendor-model",
          apiKey: blank,
        }),
      ).rejects.toThrow(/No usable credential is configured for "openrouter"/);

      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("does not reach any provider with a blank key, whichever provider is selected", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    for (const provider of ["google", "openai", "anthropic", "openrouter", "custom"]) {
      await expect(
        callAI(request("blank credential", { timeoutMs: 1000 }), { provider, model: "m", apiKey: " " }),
      ).rejects.toThrow(/No usable credential is configured/);
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("trims surrounding whitespace so a key stored with stray padding still authenticates", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ready" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await callAI(request("padded credential", { timeoutMs: 1000 }), {
      provider: "openrouter",
      model: "example/vendor-model",
      apiKey: "  test-api-key\t",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-api-key");
  });

  it("trims the key for header-authenticated providers too", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: "text", text: "ready" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await callAI(request("padded credential", { timeoutMs: 1000 }), {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      apiKey: " test-api-key ",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get("x-api-key")).toBe("test-api-key");
  });
});

describe("Google structured-output compatibility", () => {
  it("removes redundant numeric min/max constraints recursively without weakening array limits", () => {
    expect(
      sanitizeGeminiResponseSchema({
        type: "object",
        properties: {
          confidence: { type: "number", minimum: 0, maximum: 100 },
          findings: {
            type: "array",
            maxItems: 16,
            items: {
              type: "object",
              properties: {
                score: { type: "number", minimum: 0, maximum: 100 },
              },
            },
          },
        },
      }),
    ).toEqual({
      type: "object",
      properties: {
        confidence: { type: "number" },
        findings: {
          type: "array",
          maxItems: 16,
          items: {
            type: "object",
            properties: {
              score: { type: "number" },
            },
          },
        },
      },
    });
  });

  it("sends the resolved Gemini model and sanitized schema on the wire", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"confidence":50}' }] } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await callAI(
      request("structured", {
        timeoutMs: 1000,
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: "confidence_test",
            strict: true,
            schema: {
              type: "object",
              properties: { confidence: { type: "number", minimum: 0, maximum: 100 } },
              required: ["confidence"],
            },
          },
        },
      }),
      { provider: "google", model: "gemini-3.7-flash", apiKey: "test-gemini-key" },
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent");
    const body = JSON.parse(String(init?.body));
    expect(body.generationConfig.responseJsonSchema.properties.confidence).toEqual({ type: "number" });
  });

  it("attributes upstream failures to the provider and resolved model while exposing only a safe public message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "schema rejected" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    const error = await callAI(
      request("bad structured request", { timeoutMs: 1000 }),
      { provider: "google", model: "gemini-3.7-flash", apiKey: "test-gemini-key" },
    ).catch((caught) => caught as Error & { status?: number; code?: string; publicMessage?: string });

    expect(error.message).toMatch(/Google Gemini API error 400 for model "gemini-3\.7-flash"/);
    expect(error.status).toBe(502);
    expect(error.code).toBe("AI_PROVIDER_ERROR");
    expect(error.publicMessage).toMatch(/gemini-3\.7-flash/);
    expect(error.publicMessage).not.toMatch(/schema rejected/);
  });
});
