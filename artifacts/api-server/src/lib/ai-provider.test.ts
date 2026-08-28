import { afterEach, describe, expect, it, vi } from "vitest";
import { callAI, resolveAIRequestTimeoutMs, type AIRequest } from "./ai-provider";

function request(system: string, extra: Partial<AIRequest> = {}): AIRequest {
  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: "test" },
    ],
    ...extra,
  };
}

describe("resolveAIRequestTimeoutMs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("routes an allowlisted model through OpenRouter's OpenAI-compatible endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "ready" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await callAI(
      {
        messages: [{ role: "user", content: "Provider readiness check." }],
        thinkingLevel: "high",
      },
      {
        provider: "openrouter",
        apiKey: "test-openrouter-key",
        model: "google/gemini-3.7-flash",
      },
    );

    expect(response.content).toBe("ready");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-openrouter-key",
      "X-OpenRouter-Title": "RepoFinisher",
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "google/gemini-3.7-flash",
      reasoning: { effort: "high" },
    });
  });
});
