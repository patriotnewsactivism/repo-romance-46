// Centralized AI provider routing — handles Google Gemini, OpenAI, Anthropic, and legacy/custom providers.

export interface AIProviderConfig {
  provider: string; // "google" | "openai" | "anthropic" | "custom" | legacy "github_models"
  apiKey: string | null;
}

export interface AIRequest {
  messages: { role: string; content: string }[];
  responseFormat?: {
    type: "json_schema";
    json_schema: {
      name: string;
      strict: boolean;
      schema: Record<string, unknown>;
    };
  };
  model?: string;
  thinkingBudgetTokens?: number;
  thinkingLevel?: "low" | "medium" | "high";
  /** Optional hard network timeout for a single provider attempt. */
  timeoutMs?: number;
}

export interface AIResponse {
  content: string;
  thinkingContent?: string;
}

// Gemini 3.7 Flash is the platform default: production-stable, 1M context,
// structured outputs, tunable thinking, and strong coding/agent performance.
const DEFAULT_MODELS: Record<string, string> = {
  google: "gemini-3.7-flash",
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  custom: "gpt-4o",
  // Kept only so old saved preferences fail gracefully until migrated.
  github_models: "gpt-4o-mini",
};

const MAX_RETRIES = 4;
const INITIAL_BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 10000;
const DEFAULT_REQUEST_TIMEOUT_MS = 45000;
const FINAL_SYNTHESIS_TIMEOUT_MS = 8000;

/**
 * Portfolio analysis already has a high-quality draft before its final polish
 * pass. That last pass must never be allowed to strand the whole analysis.
 * If it cannot answer quickly, analysis.ts falls back to the validated draft.
 */
export function resolveAIRequestTimeoutMs(request: AIRequest): number {
  if (request.timeoutMs !== undefined) {
    const requested = Number(request.timeoutMs);
    if (Number.isFinite(requested)) return Math.max(1000, Math.min(120000, Math.round(requested)));
  }

  const systemText = request.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");

  if (/final synthesis of a developer portfolio analysis/i.test(systemText)) {
    return FINAL_SYNTHESIS_TIMEOUT_MS;
  }

  return DEFAULT_REQUEST_TIMEOUT_MS;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  provider: string,
  timeoutMs: number,
): Promise<Response> {
  let lastError = "";
  const singleAttemptOnly = timeoutMs <= FINAL_SYNTHESIS_TIMEOUT_MS;
  const maxRetries = singleAttemptOnly ? 0 : MAX_RETRIES;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;

    try {
      res = await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `${provider} request exceeded ${Math.round(timeoutMs / 1000)}s and was cancelled to keep the analysis worker responsive.`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (res.status !== 429 && res.status < 500) return res;
    if (res.status >= 500 && attempt === maxRetries) return res;

    const retryAfter = res.headers.get("Retry-After");
    let waitMs: number;
    if (retryAfter) {
      const parsedSeconds = Number.parseInt(retryAfter, 10);
      waitMs = Number.isFinite(parsedSeconds) ? parsedSeconds * 1000 + 500 : INITIAL_BACKOFF_MS;
    } else {
      waitMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
    }
    waitMs = Math.min(waitMs, MAX_BACKOFF_MS);

    if (attempt < maxRetries) {
      console.warn(
        `[ai-provider] ${provider} transient failure (${res.status}), retry ${attempt + 1}/${maxRetries} after ${waitMs}ms`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    } else {
      lastError = `Provider remained unavailable after ${maxRetries + 1} attempts. Last response: ${(await res.text()).slice(0, 200)}`;
    }
  }
  throw new Error(`AI provider retry budget exhausted for ${provider}. ${lastError}`);
}

const PROVIDER_ENDPOINTS: Record<string, string> = {
  github_models: "https://models.inference.ai.azure.com/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
  google: "https://generativelanguage.googleapis.com/v1beta/models",
  custom: "https://api.openai.com/v1/chat/completions",
};

export async function callAI(request: AIRequest, config: AIProviderConfig): Promise<AIResponse> {
  // Never silently fall back to OpenAI. Gemini is the explicit platform default.
  const provider = config.provider || "google";
  const model = request.model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.google;
  const requestTimeoutMs = resolveAIRequestTimeoutMs(request);

  if (provider === "anthropic" && config.apiKey) {
    const systemMsg = request.messages.find((m) => m.role === "system")?.content || "";
    const userMessages = request.messages.filter((m) => m.role !== "system");
    const useThinking = !!request.thinkingBudgetTokens && request.thinkingBudgetTokens > 0;
    const thinkingBudget = request.thinkingBudgetTokens ?? 0;

    const body: Record<string, unknown> = {
      model,
      max_tokens: useThinking ? thinkingBudget + 4096 : 4096,
      system: systemMsg,
      messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
    };

    if (useThinking) {
      body.thinking = { type: "enabled", budget_tokens: thinkingBudget };
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    };
    if (useThinking) headers["anthropic-beta"] = "interleaved-thinking-2025-05-14";

    const res = await fetchWithRetry(
      PROVIDER_ENDPOINTS.anthropic,
      { method: "POST", headers, body: JSON.stringify(body) },
      "anthropic",
      requestTimeoutMs,
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      content: Array<{ type: string; text?: string; thinking?: string }>;
    };
    const textBlock = json.content?.find((b) => b.type === "text");
    const thinkingBlock = json.content?.find((b) => b.type === "thinking");
    return {
      content: textBlock?.text || json.content?.[0]?.text || "",
      thinkingContent: thinkingBlock?.thinking,
    };
  }

  if (provider === "google" && config.apiKey) {
    const systemMsg = request.messages.find((m) => m.role === "system")?.content || "";
    const contents = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const generationConfig: Record<string, unknown> = {
      // Structured-output calls can become very slow when Gemini spends a large
      // thinking budget on JSON that is already constrained by a schema. Keep
      // those calls on low thinking unless the caller explicitly asks for more.
      thinkingConfig: {
        thinkingLevel: request.thinkingLevel || (request.responseFormat ? "low" : "medium"),
      },
    };
    if (request.responseFormat?.json_schema?.schema) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseJsonSchema = request.responseFormat.json_schema.schema;
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig,
    };
    if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg }] };

    const url = `${PROVIDER_ENDPOINTS.google}/${model}:generateContent`;
    const res = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": config.apiKey,
        },
        body: JSON.stringify(body),
      },
      "google",
      requestTimeoutMs,
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google Gemini API error ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const content = json.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("") || "";
    return { content };
  }

  if (
    (provider === "github_models" || provider === "openai" || provider === "custom") &&
    config.apiKey
  ) {
    const body: Record<string, unknown> = {
      model,
      messages: request.messages,
    };
    if (request.responseFormat) body.response_format = request.responseFormat;

    const res = await fetchWithRetry(
      PROVIDER_ENDPOINTS[provider],
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      provider,
      requestTimeoutMs,
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AI error ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return { content: json.choices?.[0]?.message?.content || "" };
  }

  if (provider === "github_models") {
    throw new Error(
      "GitHub Models is no longer a supported platform default. Switch the provider to Google Gemini.",
    );
  }

  throw new Error(
    `No usable credential is configured for "${provider}". For Google, configure GEMINI_API_KEY/GOOGLE_API_KEY on the API server or save a Google BYOK key in Settings.`,
  );
}
