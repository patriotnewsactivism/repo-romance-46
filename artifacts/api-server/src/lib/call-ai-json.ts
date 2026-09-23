/**
 * Structured LLM JSON with one bounded repair attempt.
 *
 * Free OpenRouter models often ignore `response_format: json_schema` and wrap
 * valid JSON in fences or a short preamble. Callers that used bare JSON.parse
 * stranded analysis, valuation, repair, and finish-until-target.
 */

import { z } from "zod";
import { callAI, type AIProviderConfig, type AIRequest } from "./ai-provider";
import { parseModelJsonWithRepair } from "./parse-model-json";

const REPAIR_USER =
  "Your previous response could not be parsed as JSON matching the required schema. Reply with ONLY the raw JSON object — no markdown code fences, no backticks, no prose before or after it.";

export function validateWithZod<T extends z.ZodTypeAny>(schema: T) {
  return (value: unknown): z.output<T> | null => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : null;
  };
}

export async function callAIJson<T>(
  request: AIRequest,
  config: AIProviderConfig,
  validate: (value: unknown) => T | null,
): Promise<T> {
  const result = await callAI(request, config);
  const parsed = await parseModelJsonWithRepair<T>(result.content || "", {
    validate,
    repair: async () => {
      const repairResult = await callAI(
        {
          ...request,
          messages: [
            ...request.messages,
            { role: "assistant", content: (result.content || "").slice(0, 4000) },
            { role: "user", content: REPAIR_USER },
          ],
          thinkingLevel: "low",
          ...(result.model ? { model: result.model } : {}),
        },
        config,
      );
      return repairResult.content || "";
    },
  });
  if (!parsed.ok) {
    throw new Error(
      `Model response could not be parsed into the expected JSON${parsed.repaired ? " after one repair attempt" : ""}: ${parsed.error}`,
    );
  }
  return parsed.value;
}
