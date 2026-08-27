import { describe, expect, it } from "vitest";
import { resolveAIRequestTimeoutMs, type AIRequest } from "./ai-provider";

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
