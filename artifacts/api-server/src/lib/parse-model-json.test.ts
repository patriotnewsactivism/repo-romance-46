import { describe, expect, it, vi } from "vitest";
import {
  extractJsonCandidates,
  parseModelJsonLenient,
  parseModelJsonWithRepair,
  tryParseModelJson,
} from "./parse-model-json";

describe("tryParseModelJson", () => {
  it("parses plain JSON", () => {
    const result = tryParseModelJson('{"a":1,"b":"two"}');
    expect(result).toEqual({ ok: true, value: { a: 1, b: "two" } });
  });

  it("parses JSON wrapped in a ```json fence", () => {
    const raw = '```json\n{"a":1}\n```';
    const result = tryParseModelJson(raw);
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  it("parses JSON wrapped in a fence with no language tag", () => {
    const raw = '```\n{"a":1}\n```';
    const result = tryParseModelJson(raw);
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  it("strips a leading BOM and surrounding whitespace", () => {
    const raw = `\uFEFF   \n{"a":1}\n  `;
    const result = tryParseModelJson(raw);
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  it("extracts a JSON object surrounded by brief prose", () => {
    const raw = 'Sure, here is the plan you asked for:\n{"a":1}\nLet me know if you need changes.';
    const result = tryParseModelJson(raw);
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  it("extracts a JSON object from prose wrapped inside a fence", () => {
    const raw = '```json\nHere you go:\n{"a":1}\n```';
    const result = tryParseModelJson(raw);
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  it("handles nested braces and braces inside string values correctly", () => {
    const raw = '```json\n{"analysis":"uses a {placeholder} in text","changes":[{"path":"a"}]}\n```';
    const result = tryParseModelJson(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ analysis: "uses a {placeholder} in text", changes: [{ path: "a" }] });
    }
  });

  it("reports a failure (never throws) for genuinely non-JSON content", () => {
    const result = tryParseModelJson("I cannot help with that request.");
    expect(result.ok).toBe(false);
  });

  it("reports a failure for an empty string", () => {
    const result = tryParseModelJson("");
    expect(result.ok).toBe(false);
  });

  it("never uses eval or Function on the input", () => {
    // A string that would be dangerous if run through eval/Function, but is
    // not valid JSON, must fail safely rather than execute anything.
    const raw = "```js\n(() => { throw new Error('should never run'); })()\n```";
    const result = tryParseModelJson(raw);
    expect(result.ok).toBe(false);
  });
});

describe("extractJsonCandidates", () => {
  it("de-duplicates identical candidates", () => {
    const candidates = extractJsonCandidates('{"a":1}');
    expect(candidates).toEqual(['{"a":1}']);
  });

  it("orders the whole trimmed string before fence/brace-extracted fallbacks", () => {
    const raw = '```json\n{"a":1}\n```';
    const candidates = extractJsonCandidates(raw);
    expect(candidates[0]).toBe(raw);
    expect(candidates).toContain('{"a":1}');
  });
});

describe("parseModelJsonLenient", () => {
  it("returns the parsed value for fenced JSON", () => {
    expect(parseModelJsonLenient('```json\n{"summary":"ok"}\n```')).toEqual({ summary: "ok" });
  });

  it("falls back to {} on unparsable content, matching existing normalizeX({}) defaulting", () => {
    expect(parseModelJsonLenient("not json at all")).toEqual({});
  });

  it("falls back to {} on empty content", () => {
    expect(parseModelJsonLenient("")).toEqual({});
  });
});

interface Plan {
  analysis: string;
  changes: { path: string }[];
}

function validatePlan(value: unknown): Plan | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.analysis !== "string") return null;
  if (!Array.isArray(row.changes) || row.changes.length === 0) return null;
  return { analysis: row.analysis, changes: row.changes as { path: string }[] };
}

describe("parseModelJsonWithRepair", () => {
  it("returns ok on the first attempt when the plan is already valid, without calling repair", async () => {
    const repair = vi.fn();
    const result = await parseModelJsonWithRepair('```json\n{"analysis":"do x","changes":[{"path":"a.ts"}]}\n```', {
      validate: validatePlan,
      repair,
    });
    expect(result).toEqual({
      ok: true,
      value: { analysis: "do x", changes: [{ path: "a.ts" }] },
      repaired: false,
    });
    expect(repair).not.toHaveBeenCalled();
  });

  it("parses unfenced plain JSON on the first attempt too", async () => {
    const repair = vi.fn();
    const result = await parseModelJsonWithRepair('{"analysis":"do y","changes":[{"path":"b.ts"}]}', {
      validate: validatePlan,
      repair,
    });
    expect(result.ok).toBe(true);
    expect(repair).not.toHaveBeenCalled();
  });

  it("makes exactly one bounded repair attempt on malformed output, and advances past planning when the repair succeeds", async () => {
    const repair = vi.fn().mockResolvedValue('{"analysis":"repaired plan","changes":[{"path":"a.ts"}]}');
    const badRaw = "```json { unterminated fence with no closing";
    const result = await parseModelJsonWithRepair<Plan>(badRaw, {
      validate: validatePlan,
      repair,
    });
    expect(repair).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      value: { analysis: "repaired plan", changes: [{ path: "a.ts" }] },
      repaired: true,
    });
  });

  it("calls repair exactly once even when the repaired output is itself unparsable, and returns a sanitized structured failure instead of throwing", async () => {
    const repair = vi.fn().mockResolvedValue("still not json, sorry");
    const result = await parseModelJsonWithRepair<Plan>("not json either", {
      validate: validatePlan,
      repair,
    });
    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.repaired).toBe(true);
      expect(result.error).toContain("Repaired model response was still not valid JSON");
      // Never dumps unbounded raw content.
      expect(result.rawSample.length).toBeLessThanOrEqual(401);
    }
  });

  it("calls repair exactly once when the repaired output parses as JSON but still fails validation", async () => {
    const repair = vi.fn().mockResolvedValue('{"wrongShape": true}');
    const result = await parseModelJsonWithRepair<Plan>("bad", { validate: validatePlan, repair });
    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("did not satisfy the expected schema");
    }
  });

  it("returns a structured failure (never throws) if the repair call itself rejects", async () => {
    const repair = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const result = await parseModelJsonWithRepair<Plan>("bad", { validate: validatePlan, repair });
    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Model repair attempt itself failed");
      expect(result.error).toContain("provider unavailable");
    }
  });

  it("never uses eval/Function during repair parsing either", async () => {
    const repair = vi.fn().mockResolvedValue("```js\n(() => { throw new Error('boom'); })()\n```");
    const result = await parseModelJsonWithRepair<Plan>("bad", { validate: validatePlan, repair });
    expect(result.ok).toBe(false);
  });
});
