import { afterEach, describe, expect, it, vi } from "vitest";
import { generateFinishPlan } from "./repo-finisher-engine";

const repoData = {
  description: "test repo",
  language: "TypeScript",
  default_branch: "main",
  topics: [],
  stars: 0,
  open_issues: 0,
  has_ci: true,
  has_tests: true,
  has_license: true,
  has_readme: true,
  has_homepage: false,
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function chatCompletion(content: string) {
  return jsonResponse({ choices: [{ message: { content } }] });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateFinishPlan — fenced/malformed model JSON handling", () => {
  it("parses a plain unfenced JSON plan on the first attempt", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      chatCompletion(JSON.stringify({ analysis: "fix it", changes: [{ path: "a.ts", status: "modified", content: "x", description: "d" }] })),
    );
    const plan = await generateFinishPlan("owner/repo", repoData, [], ["do the thing"], "openrouter", "test-key");
    expect(plan).toEqual({
      analysis: "fix it",
      changes: [{ path: "a.ts", status: "modified", content: "x", description: "d" }],
    });
  });

  it("parses a ```json-fenced plan the provider returned despite strict json_schema being requested", async () => {
    const fenced = '```json\n{"analysis":"fenced fix","changes":[{"path":"b.ts","status":"created","content":"y","description":"d2"}]}\n```';
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(chatCompletion(fenced));
    const plan = await generateFinishPlan("owner/repo", repoData, [], ["do the thing"], "openrouter", "test-key");
    expect(plan.analysis).toBe("fenced fix");
    expect(plan.changes).toHaveLength(1);
  });

  it("makes exactly one bounded repair call when the first response is malformed, and the repaired plan advances past planning", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      // First attempt: a broken/truncated fence — this is the exact failure
      // class that used to throw "Unexpected token '`'" and crash the caller.
      .mockResolvedValueOnce(chatCompletion("```json\n{ \"analysis\": \"broken"))
      // Repair attempt: provider returns pure JSON as instructed.
      .mockResolvedValueOnce(
        chatCompletion(JSON.stringify({ analysis: "repaired", changes: [{ path: "c.ts", status: "modified", content: "z", description: "d3" }] })),
      );

    const plan = await generateFinishPlan("owner/repo", repoData, [], ["do the thing"], "openrouter", "test-key");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(plan.analysis).toBe("repaired");
    expect(plan.changes[0].path).toBe("c.ts");
  });

  it("throws a sanitized, bounded error (never a raw SyntaxError) if the repair attempt also fails, so callers can persist a clean stop_reason instead of crashing", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(chatCompletion("```json\n{ still broken"))
      .mockResolvedValueOnce(chatCompletion("also not json, sorry"));

    await expect(
      generateFinishPlan("owner/repo", repoData, [], ["do the thing"], "openrouter", "test-key"),
    ).rejects.toThrow(/could not be parsed into a valid finish plan after one repair attempt/);
  });

  it("rejects a plan that doesn't satisfy the finish-plan schema even though it is valid JSON, and repairs it", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(chatCompletion(JSON.stringify({ wrongShape: true })))
      .mockResolvedValueOnce(
        chatCompletion(JSON.stringify({ analysis: "shape fixed", changes: [{ path: "d.ts", status: "deleted", content: "", description: "d4" }] })),
      );

    const plan = await generateFinishPlan("owner/repo", repoData, [], ["do the thing"], "openrouter", "test-key");
    expect(plan.analysis).toBe("shape fixed");
  });
});
