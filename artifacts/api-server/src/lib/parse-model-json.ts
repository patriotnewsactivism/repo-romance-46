/**
 * Shared, strictly-validated parser for structured LLM JSON output.
 *
 * Root cause this exists to fix: several call sites asked providers for
 * `response_format: json_schema` but not every provider in the fallback
 * chain (in particular free/best-effort OpenRouter models) actually honors
 * that request — they can still wrap valid JSON in a ```json fence, add a
 * short prose preamble, or include a stray BOM/whitespace. A bare
 * `JSON.parse(result.content)` then throws `Unexpected token '\`'` and, for
 * callers with no try/catch, permanently strands whatever stateful process
 * was waiting on the result.
 *
 * This module never uses eval/Function — extraction is pure string slicing
 * plus `JSON.parse`, and repair is a normal follow-up model call.
 */

export interface ParseModelJsonSuccess<T> {
  ok: true;
  value: T;
  repaired: boolean;
}

export interface ParseModelJsonFailure {
  ok: false;
  error: string;
  rawSample: string;
  repaired: boolean;
}

export type ParseModelJsonResult<T> = ParseModelJsonSuccess<T> | ParseModelJsonFailure;

const FENCE_RE = /```(?:[a-zA-Z0-9_-]*\n)?([\s\S]*?)```/;

function stripBom(text: string): string {
  return text.length > 0 && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function extractBraceBalanced(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === "\\") {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Produces ordered candidate substrings to attempt `JSON.parse` against,
 * from most-likely-correct (the whole trimmed response, for the common
 * well-formatted case) to most-permissive (a brace-balanced object pulled
 * out of a fence or out of surrounding prose).
 */
export function extractJsonCandidates(raw: string): string[] {
  const cleaned = stripBom(String(raw ?? "")).trim();
  const candidates: string[] = [];
  if (cleaned) candidates.push(cleaned);

  const fenceMatch = cleaned.match(FENCE_RE);
  const fenceInner = fenceMatch?.[1]?.trim();
  if (fenceInner) candidates.push(fenceInner);

  const wholeBraceBalanced = extractBraceBalanced(cleaned);
  if (wholeBraceBalanced) candidates.push(wholeBraceBalanced);

  if (fenceInner) {
    const fenceBraceBalanced = extractBraceBalanced(fenceInner);
    if (fenceBraceBalanced) candidates.push(fenceBraceBalanced);
  }

  return Array.from(new Set(candidates));
}

/**
 * Best-effort parse of model output that may be plain JSON, fenced JSON
 * (with or without a language tag), or JSON with brief surrounding prose.
 * Never throws.
 */
export function tryParseModelJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const candidates = extractJsonCandidates(raw);
  let lastError = "No JSON content found in model response.";
  for (const candidate of candidates) {
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { ok: false, error: lastError };
}

function sample(text: string, max = 400): string {
  const value = String(text ?? "");
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * Lenient variant for call sites that already tolerate a missing/partial
 * object via their own field-by-field normalizer (e.g. reasoning
 * orchestrator's evidence/critic/specialist/planner results, which already
 * default every field when given `{}`). Never throws; falls back to `{}` so
 * existing `normalizeX({})` defaulting behavior is unchanged — this only
 * makes the *parsing* fence/prose-tolerant, it doesn't add repair/retry
 * semantics for call sites that don't need them.
 */
export function parseModelJsonLenient(raw: string): unknown {
  const result = tryParseModelJson(raw);
  return result.ok ? result.value : {};
}

/**
 * Parses model output into a validated `T`. If parsing or validation fails,
 * makes exactly one bounded repair attempt via `repair()` (expected to
 * re-prompt the same model/provider for pure, schema-conformant JSON) and
 * retries parsing+validation once against its result. Never throws — always
 * returns a result object so callers can persist a sanitized, bounded
 * structured error instead of crashing a stateful process.
 */
export async function parseModelJsonWithRepair<T>(
  raw: string,
  options: {
    validate: (value: unknown) => T | null;
    repair: () => Promise<string>;
  },
): Promise<ParseModelJsonResult<T>> {
  const first = tryParseModelJson(raw);
  if (first.ok) {
    const validated = options.validate(first.value);
    if (validated !== null) return { ok: true, value: validated, repaired: false };
  }

  let repairedRaw: string;
  try {
    repairedRaw = await options.repair();
  } catch (error) {
    return {
      ok: false,
      error: `Model repair attempt itself failed: ${error instanceof Error ? error.message : String(error)}`,
      rawSample: sample(raw),
      repaired: true,
    };
  }

  const second = tryParseModelJson(repairedRaw);
  if (second.ok) {
    const validated = options.validate(second.value);
    if (validated !== null) return { ok: true, value: validated, repaired: true };
    return {
      ok: false,
      error: "Repaired model response parsed as JSON but did not satisfy the expected schema.",
      rawSample: sample(repairedRaw),
      repaired: true,
    };
  }
  return {
    ok: false,
    error: `Repaired model response was still not valid JSON: ${second.error}`,
    rawSample: sample(repairedRaw),
    repaired: true,
  };
}
