import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callAIJson, validateWithZod } from "./call-ai-json";

const schema = z.object({
  analysis: z.string(),
  changes: z.array(z.object({ path: z.string() })),
});

function chatCompletion(content: string, model?: string) {
  return new Response(JSON.stringify({ model, choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("callAIJson", () => {
  it("parses fenced JSON without a second round trip", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      chatCompletion('```json\n{"analysis":"ok","changes":[{"path":"a.ts"}]}\n```'),
    );

    const value = await callAIJson(
      { messages: [{ role: "user", content: "plan" }], timeoutMs: 1000 },
      { provider: "openrouter", model: "vendor/pinned", apiKey: "test-key" },
      validateWithZod(schema),
    );

    expect(value.analysis).toBe("ok");
    expect(value.changes[0].path).toBe("a.ts");
  });

  it("makes one repair call and pins the served model", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(chatCompletion("```json\n{ broken", "vendor/served"))
      .mockResolvedValueOnce(chatCompletion(JSON.stringify({ analysis: "fixed", changes: [{ path: "b.ts" }] })));

    const value = await callAIJson(
      { messages: [{ role: "user", content: "plan" }], timeoutMs: 1000 },
      { provider: "openrouter", model: "vendor/pinned", apiKey: "test-key" },
      validateWithZod(schema),
    );

    expect(value.analysis).toBe("fixed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const repairBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(repairBody.model).toBe("vendor/served");
  });

  it("passes the saved model on the first request so Settings controls finishing", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      chatCompletion(JSON.stringify({ analysis: "saved", changes: [] })),
    );

    await callAIJson(
      { messages: [{ role: "user", content: "plan" }], timeoutMs: 1000 },
      { provider: "openrouter", model: "openai/gpt-5.6-sol", apiKey: "test-key" },
      validateWithZod(schema),
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.model).toBe("openai/gpt-5.6-sol");
    expect(body.models).toBeUndefined();
  });
});
