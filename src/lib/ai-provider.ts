// Centralized AI provider routing â handles GitHub Models, OpenAI, Anthropic, Google

const VALID_PROVIDERS = ["github_models", "openai", "anthropic", "google", "custom"];

/**
 * Resolve the best available AI config from user prefs â server env â GitHub OAuth token.
 * Call this from any server function before invoking callAI().
 */
export async function resolveAIConfig(
  supabase: unknown,
  userId: string,
): Promise<AIProviderConfig> {
  // 1. Load user preferences
  const s = supabase as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, v: string) => { maybeSingle: () => Promise<{ data: unknown }> };
      };
    };
  };
  const { data: prefs } = await s
    .from("user_preferences")
    .select("custom_ai_provider, custom_ai_key")
    .eq("user_id", userId)
    .maybeSingle();
  const p = prefs as { custom_ai_provider: string | null; custom_ai_key: string | null } | null;

  if (p?.custom_ai_key) {
    let provider = p.custom_ai_provider || "openai";
    if (!VALID_PROVIDERS.includes(provider)) provider = "openai";
    return { provider, apiKey: p.custom_ai_key };
  }

  // 2. Server-level env vars
  const serverProvider = typeof process !== "undefined" ? process.env?.SERVER_AI_PROVIDER : undefined;
  const serverKey = typeof process !== "undefined" ? process.env?.SERVER_AI_KEY : undefined;
  if (serverProvider && serverKey) {
    return { provider: serverProvider, apiKey: serverKey };
  }

  // 3. Fall back to GitHub Models using the user's GitHub OAuth token
  const { data: conn } = await s
    .from("github_connections")
    .select("access_token")
    .eq("user_id", userId)
    .maybeSingle();
  const ghToken = (conn as { access_token: string } | null)?.access_token;
  if (ghToken) {
    return { provider: "github_models", apiKey: ghToken };
  }

  // 4. Last resort â will error in callAI() with a helpful message
  return { provider: p?.custom_ai_provider || "openai", apiKey: null };
}

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

// Rate-limit retry config â GitHub Models free tier is very aggressive (5 RPM
// for gpt-4o, 15 RPM for gpt-4o-mini). We retry with exponential backoff.
const MAX_RETRIES = 4;
const INITIAL_BACKOFF_MS = 5000; // 5s â must be >= the provider's rate window

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  provider: string,
): Promise<Response> {
  let lastError = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, options);

    if (res.status !== 429) return res;

    // Rate limited â parse Retry-After header if present, otherwise back off
    const retryAfter = res.headers.get("Retry-After");
    let waitMs: number;
    if (retryAfter) {
      waitMs = parseInt(retryAfter, 10) * 1000 + 500; // pad by 500ms
    } else {
      waitMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt); // 5s, 10s, 20s, 40s
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

// API endpoints per provider
const PROVIDER_ENDPOINTS: Record<string, string> = {
  github_models: "https://models.inference.ai.azure.com/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
  google: "https://generativelanguage.googleapis.com/v1beta/models",
  custom: "https://api.openai.com/v1/chat/completions",
};

/**
 * Call the AI provider based on the user's configuration.
 * Routes to the appropriate endpoint based on provider setting.
 */
export async function callAI(
  request: AIRequest,
  config: AIProviderConfig,
  fallbacks?: AIProviderConfig[],
): Promise<AIResponse> {
  const provider = config.provider || "openai";
  const model = request.model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.openai;

  try {

  // âââ Anthropic (different API format) âââââââââââââââââââââ
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

  // âââ Google Gemini (different API format) âââââââââââââââââ
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

  // âââ OpenAI-compatible (GitHub Models, OpenAI, custom) ââââ
  if (
    (provider === "github_models" || provider === "openai" || provider === "custom") &&
    config.apiKey
  ) {
    // Set max_tokens per provider â github_models (gpt-4o-mini) has an 8000
    // total token cap, so we keep output small to leave room for input.
    const maxTokens: Record<string, number> = {
      github_models: 3000, // 3000 output + ~4000 input = under 8000 total
      openai: 4096,
      custom: 4096,
    };

    const body: Record<string, unknown> = {
      model,
      messages: request.messages,
      max_tokens: maxTokens[provider] ?? 4096,
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

  // No matching provider with a valid key â try fallbacks before giving up
  if (fallbacks && fallbacks.length > 0) {
    console.warn(`[ai-provider] No key for ${provider}, trying fallback providers...`);
    return callAIWithFallback(request, fallbacks);
  }
  throw new Error(
    `No AI provider available. You selected "${provider}" but no API key is saved. Go to Settings and enter your API key.`,
  );

  } catch (err) {
    // If the primary provider fails (rate limit, quota, API error), try fallbacks
    if (fallbacks && fallbacks.length > 0) {
      const msg = (err as Error).message;
      console.warn(
        `[ai-provider] ${provider} failed: ${msg.slice(0, 150)}. Trying fallback providers...`,
      );
      return callAIWithFallback(request, fallbacks);
    }
    throw err;
  }
}


// âââ Multi-provider fallback âââââââââââââââââââââââââââââââââ
// If the primary provider fails after all retries, try fallback configs.
// This makes the app resilient to any single provider's quota limits.

export async function callAIWithFallback(
  request: AIRequest,
  configs: AIProviderConfig[],
): Promise<AIResponse> {
  let lastError: Error | null = null;
  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    if (!config.apiKey && config.provider !== "github_models") {
      // No key for this provider â skip it
      continue;
    }
    try {
      if (i > 0) {
        console.warn(
          `[ai-provider] Primary provider failed, falling back to ${config.provider}`,
        );
      }
      return await callAI(request, config);
    } catch (err) {
      lastError = err as Error;
      const msg = (err as Error).message;
      // Only fall back on rate limit / quota errors, not on malformed requests
      if (
        msg.includes("rate limit") ||
        msg.includes("quota") ||
        msg.includes("429") ||
        msg.includes("exceeded") ||
        msg.includes("413") ||
        msg.includes("tokens_limit") ||
        msg.includes("too large")
      ) {
        console.warn(
          `[ai-provider] ${config.provider} failed: ${msg.slice(0, 100)}, trying next provider...`,
        );
        continue;
      }
      // For other errors (bad key, network, etc.), throw immediately
      throw err;
    }
  }
  throw lastError || new Error("All AI providers exhausted");
}
