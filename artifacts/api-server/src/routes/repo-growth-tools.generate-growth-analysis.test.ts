import { afterEach, describe, expect, it, vi } from "vitest";
import { generateGrowthAnalysis } from "./repo-growth-tools";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function chatCompletion(content: string) {
  return jsonResponse({ choices: [{ message: { content } }] });
}

function validGrowthPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    market_category: "Dev tooling",
    market_summary: "Live external competitor/pricing research is unavailable.",
    target_buyers: ["indie developers"],
    competitors: [],
    feature_suggestions: [1, 2, 3].map((n) => ({
      title: `Suggestion ${n}`,
      why_it_matters: "matters",
      implementation_summary: "summary",
      desirability_score: 50,
      confidence: "medium",
      value_lift_usd: { low: 100, high: 200 },
      monthly_revenue_scenario_usd: { low: 10, base: 20, high: 30 },
      assumptions: ["assumption"],
      competitor_gap: "no gap",
      acceptance_checks: ["check"],
      risks: [],
      evidence_urls: [],
    })),
    limitations: [],
    ...overrides,
  };
}

const aiCredential = { provider: "openrouter", apiKey: "test-key" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateGrowthAnalysis — fenced/malformed model JSON handling (Defect 3)", () => {
  it("uses the exact configured model and reasoning effort instead of silently falling back to the platform default", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(chatCompletion(JSON.stringify(validGrowthPayload())));

    await generateGrowthAnalysis("system", "user", {
      provider: "openrouter",
      apiKey: "test-key",
      model: "z-ai/glm-5.2:free",
      reasoningEffort: "high",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body.model).toBe("z-ai/glm-5.2:free");
    expect(body.reasoning).toEqual({ effort: "high" });
    expect(body.models).toBeUndefined();
  });

  it("parses a plain unfenced JSON growth analysis on the first attempt", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(chatCompletion(JSON.stringify(validGrowthPayload())));
    const result = await generateGrowthAnalysis("system", "user", aiCredential);
    expect(result.market_category).toBe("Dev tooling");
    expect(result.feature_suggestions).toHaveLength(3);
  });

  it("parses a ```json-fenced growth analysis the provider returned despite strict json_schema being requested", async () => {
    const fenced = "```json\n" + JSON.stringify(validGrowthPayload({ market_category: "Fenced category" })) + "\n```";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(chatCompletion(fenced));
    const result = await generateGrowthAnalysis("system", "user", aiCredential);
    expect(result.market_category).toBe("Fenced category");
  });

  it("makes exactly one bounded repair call when the first response is malformed, and the repaired analysis is used", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      // First attempt: truncated fence — this is the exact failure class
      // that used to throw "Unexpected token '`'" straight into a 500.
      .mockResolvedValueOnce(chatCompletion("```json\n{ \"market_category\": \"broken"))
      .mockResolvedValueOnce(chatCompletion(JSON.stringify(validGrowthPayload({ market_category: "Repaired category" }))));

    const result = await generateGrowthAnalysis("system", "user", aiCredential);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.market_category).toBe("Repaired category");
  });

  it("throws a sanitized 502 (never a raw SyntaxError/ZodError) if the repair attempt also fails", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(chatCompletion("```json\n{ still broken"))
      .mockResolvedValueOnce(chatCompletion("also not json, sorry"));

    await expect(generateGrowthAnalysis("system", "user", aiCredential)).rejects.toMatchObject({
      status: 502,
      code: "GROWTH_ANALYSIS_UNPARSEABLE",
    });
  });

  it("rejects a response that is valid JSON but doesn't satisfy the growth-analysis schema, and repairs it", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(chatCompletion(JSON.stringify({ wrongShape: true })))
      .mockResolvedValueOnce(chatCompletion(JSON.stringify(validGrowthPayload({ market_category: "Shape fixed" }))));

    const result = await generateGrowthAnalysis("system", "user", aiCredential);
    expect(result.market_category).toBe("Shape fixed");
  });
});
