// Centralized AI provider routing — handles Lovable, GitHub Models, OpenAI, Anthropic, Google

export interface AIProviderConfig {
  provider: string; // "lovable" | "github_models" | "openai" | "anthropic" | "google" | "custom"
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
  lovable: "google/gemini-3-flash-preview",
  github_models: "gpt-4o",
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  google: "gemini-2.5-flash",
  custom: "gpt-4o",
};

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
export async function callAI(request: AIRequest, config: AIProviderConfig): Promise<AIResponse> {
  const provider = config.provider || "lovable";
  const model = request.model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.lovable;

  // ─── Anthropic (different API format) ─────────────────────
  if (provider === "anthropic" && config.apiKey) {
    const systemMsg = request.messages.find((m) => m.role === "system")?.content || "";
    const userMessages = request.messages.filter((m) => m.role !== "system");

    const body: Record<string, unknown> = {
      model,
      max_tokens: 4096,
      system: systemMsg,
      messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
    };

    const res = await fetch(PROVIDER_ENDPOINTS.anthropic, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) throw new Error("AI rate limit hit — try again in a minute.");
      throw new Error(`Anthropic API error ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as { content: { text: string }[] };
    return { content: json.content?.[0]?.text || "" };
  }

  // ─── Google Gemini (different API format) ─────────────────
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

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) throw new Error("AI rate limit hit — try again in a minute.");
      throw new Error(`Google AI error ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as { candidates: { content: { parts: { text: string }[] } }[] };
    return { content: json.candidates?.[0]?.content?.parts?.[0]?.text || "" };
  }

  // ─── OpenAI-compatible (GitHub Models, OpenAI, custom) ────
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

    const res = await fetch(PROVIDER_ENDPOINTS[provider], {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) throw new Error("AI rate limit hit — try again in a minute.");
      throw new Error(`AI error ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as { choices: { message: { content: string } }[] };
    return { content: json.choices?.[0]?.message?.content || "" };
  }

  // ─── Fallback: Lovable gateway ────────────────────────────
  const lovableKey = process.env.LOVABLE_API_KEY;
  if (!lovableKey) {
    throw new Error(
      `No AI provider available. You selected "${provider}" but no API key is saved. Go to Settings and enter your API key, or set LOVABLE_API_KEY on the server.`,
    );
  }

  const body: Record<string, unknown> = {
    model: DEFAULT_MODELS.lovable,
    messages: request.messages,
  };

  if (request.responseFormat) {
    body.response_format = request.responseFormat;
  }

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": lovableKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("AI rate limit hit — try again in a minute.");
    if (res.status === 402)
      throw new Error("Lovable AI credits exhausted. Add a custom API key in Settings.");
    throw new Error(`AI error ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  return { content: json.choices?.[0]?.message?.content || "" };
}
