// Centralized AI provider routing — handles GitHub Models, OpenAI, Anthropic, Google.
// Ported as-is from the original TanStack Start backend.

export interface AIProviderConfig {
  provider: string; // "github_models" | "openai" | "anthropic" | "google" | "custom"
  apiKey: string | null; // user's custom key
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
  model?: string; // override model
}

export interface AIResponse {
  content: string;
}

// Default models per provider
const DEFAULT_MODELS: Record<string, string> = {
  github_models: "gpt-4o-mini", // gpt-4o-mini has 15 RPM vs gpt-4o's 5 RPM on free tier
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  google: "gemini-2.5-flash",
  custom: "gpt-4o",
};

// Rate-limit retry config — GitHub Models free tier is very aggressive (5 RPM
// for gpt-4o, 15 RPM for gpt-4o-mini). We retry with exponential backoff.
const MAX_RETRIES = 4;
const INITIAL_BACKOFF_MS = 5000; // 5s — must be >= the provider's rate window

async function fetchWithRetry(url: string, options: RequestInit, provider: string): Promise<Response> {
  let lastError = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, options);

    if (res.status !== 429) return res;

    const retryAfter = res.headers.get("Retry-After");
    let waitMs: number;
    if (retryAfter) {
      waitMs = parseInt(retryAfter, 10) * 1000 + 500;
    } else {
      waitMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
    }

    if (attempt < MAX_RETRIES) {
      console.warn(
        `[ai-provider] ${provider} rate limited (429), retry ${attempt + 1}/${MAX_RETRIES} after ${waitMs}ms`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    } else {
      lastError = `Rate limit hit after ${MAX_RETRIES + 1} attempts. Last response: ${(await res.text()).slice(0, 200)}`;
    }
  }
  throw new Error(
    `AI rate limit exhausted for ${provider}. ${lastError}. Try again in a minute, or switch to a provider with higher limits (OpenAI, Anthropic, Google).`,
  );
}

const PROVIDER_ENDPOINTS: Record<string, string> = {
  github_models: "https://models.inference.ai.azure.com/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
  google: "https://generativelanguage.googleapis.com/v1beta/models",
  custom: "https://api.openai.com/v1/chat/completions",
};

export async function callAI(request: AIRequest, config: AIProviderConfig): Promise<AIResponse> {
  const provider = config.provider || "openai";
  const model = request.model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.openai;

  if (provider === "anthropic" && config.apiKey) {
    const systemMsg = request.messages.find((m) => m.role === "system")?.content || "";
    const userMessages = request.messages.filter((m) => m.role !== "system");

    const body: Record<string, unknown> = {
      model,
      max_tokens: 4096,
      system: systemMsg,
      messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
    };

    const res = await fetchWithRetry(
      PROVIDER_ENDPOINTS.anthropic,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      },
      "anthropic",
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as { content: { text: string }[] };
    return { content: json.content?.[0]?.text || "" };
  }

  if (provider === "google" && config.apiKey) {
    const systemMsg = request.messages.find((m) => m.role === "system")?.content || "";
    const userMsg = request.messages.find((m) => m.role === "user")?.content || "";

    const body: Record<string, unknown> = {
      system_instruction: { parts: [{ text: systemMsg }] },
      contents: [{ role: "user", parts: [{ text: userMsg }] }],
      generationConfig: {
        responseMimeType: "application/json",
      },
    };

    const url = `${PROVIDER_ENDPOINTS.google}/${model}:generateContent?key=${config.apiKey}`;

    const res = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      "google",
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google AI error ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as { candidates: { content: { parts: { text: string }[] } }[] };
    return { content: json.candidates?.[0]?.content?.parts?.[0]?.text || "" };
  }

  if (
    (provider === "github_models" || provider === "openai" || provider === "custom") &&
    config.apiKey
  ) {
    const body: Record<string, unknown> = {
      model,
      messages: request.messages,
    };

    if (request.responseFormat) {
      body.response_format = request.responseFormat;
    }

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
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AI error ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as { choices: { message: { content: string } }[] };
    return { content: json.choices?.[0]?.message?.content || "" };
  }

  throw new Error(
    `No AI provider available. You selected "${provider}" but no API key is saved. Go to Settings and enter your API key.`,
  );
}
