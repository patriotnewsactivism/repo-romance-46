import { callAI, type AIProviderConfig } from "./ai-provider";

const PREFLIGHT_TIMEOUT_MS = 20_000;

type PublicHttpError = Error & {
  status?: number;
  code?: string;
  publicMessage?: string;
};

/** Turn a provider failure into a message a person can act on. */
export function describePreflightFailure(
  provider: string,
  model: string | null,
  error: unknown,
): string {
  const raw = error instanceof Error ? error.message : String(error);
  const label = model ? `${provider} / ${model}` : provider;
  if (
    /401|unauthor|missing authentication|invalid.*key|incorrect api key/i.test(
      raw,
    )
  ) {
    return `The ${provider} key was rejected (${label}). Re-save the key in Settings, or switch provider.`;
  }
  if (/402|insufficient|credit|billing|balance/i.test(raw)) {
    return `The ${provider} account has no credit for ${label}. Add credit or pick a free model.`;
  }
  if (
    /404|not found|no endpoints|model.*not.*(found|exist|available)|invalid model/i.test(
      raw,
    )
  ) {
    return `${provider} does not recognise the model "${model ?? "(default)"}". Check the exact name in Settings.`;
  }
  if (/429|rate.?limit|too many/i.test(raw)) {
    return `${label} is rate-limited right now. Retry shortly or choose another model.`;
  }
  if (/timed out|exceeded|abort/i.test(raw)) {
    return `${label} did not answer within ${PREFLIGHT_TIMEOUT_MS / 1000}s. Choose a faster model or retry.`;
  }
  return `${label} failed its readiness check: ${raw.slice(0, 200)}`;
}

/**
 * Cheap readiness call made BEFORE a long job starts, so a bad key, missing
 * credit or mistyped model fails in seconds with the real reason instead of
 * surfacing as a 60s/1830s timeout or "all batches failed" deep in the run.
 * Throws a 422 with a public message; resolves silently when the model answers.
 */
export async function assertAiReady(config: AIProviderConfig): Promise<void> {
  const provider = config.provider || "openrouter";
  if (!config.apiKey || !String(config.apiKey).trim()) {
    const message = `No usable ${provider} key is configured. Save one in Settings or switch provider.`;
    throw Object.assign(new Error(message), {
      status: 424,
      code: "AI_PROVIDER_UNCONFIGURED",
      publicMessage: message,
    }) as PublicHttpError;
  }

  try {
    const response = await Promise.race([
      callAI(
        {
          messages: [
            { role: "system", content: "Return exactly the word ready." },
            { role: "user", content: "Readiness check." },
          ],
        },
        config,
      ),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `readiness check timed out after ${PREFLIGHT_TIMEOUT_MS / 1000}s`,
              ),
            ),
          PREFLIGHT_TIMEOUT_MS,
        ),
      ),
    ]);
    if (!response.content.trim()) throw new Error("empty readiness response");
  } catch (error) {
    const message = describePreflightFailure(
      provider,
      config.model ?? null,
      error,
    );
    throw Object.assign(new Error(message), {
      status: 422,
      code: "AI_PREFLIGHT_FAILED",
      publicMessage: message,
    }) as PublicHttpError;
  }
}
