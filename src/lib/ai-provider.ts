// Centralized AI provider routing — handles Lovable, GitHub Models, and custom OpenAI keys

export interface AIProviderConfig {
  provider: string; // "lovable" | "github_models" | "custom"
  apiKey: string | null; // user's custom key (for github_models or custom)
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

/**
 * Get the user's AI provider config from Supabase preferences.
 * Falls back to Lovable if no preference is set.
 */
export async function getAIProviderConfig(
  supabase: {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => { maybeSingle: () => Promise<{ data: unknown }> };
      };
    };
  },
  userId: string,
): Promise<AIProviderConfig> {
  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("custom_ai_provider, custom_ai_key")
    .eq("user_id", userId)
    .maybeSingle();

  return {
    provider: prefs?.custom_ai_provider || "lovable",
    apiKey: prefs?.custom_ai_key || null,
  };
}

/**
 * Call the AI provider based on the user's configuration.
 * Routes to:
 * - Lovable gateway (default, no user key needed)
 * - GitHub Models (user provides GitHub token as key)
 * - Custom OpenAI-compatible endpoint (user provides API key)
 */
export async function callAI(request: AIRequest, config: AIProviderConfig): Promise<AIResponse> {
  let apiUrl: string;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let model = request.model || "google/gemini-3-flash-preview";

  if (config.provider === "github_models" && config.apiKey) {
    apiUrl = "https://models.inference.ai.azure.com/chat/completions";
    headers["Authorization"] = `Bearer ${config.apiKey}`;
    model = request.model || "gpt-4o";
  } else if (config.provider === "custom" && config.apiKey) {
    apiUrl = "https://api.openai.com/v1/chat/completions";
    headers["Authorization"] = `Bearer ${config.apiKey}`;
    model = request.model || "gpt-4o";
  } else {
    // Default: Lovable gateway
    const lovableKey = process.env.LOVABLE_API_KEY;
    if (!lovableKey) {
      throw new Error(
        "No AI provider configured. Set an API key in Settings (GitHub Models is free) or set LOVABLE_API_KEY on the server.",
      );
    }
    apiUrl = "https://ai.gateway.lovable.dev/v1/chat/completions";
    headers["Lovable-API-Key"] = lovableKey;
    model = request.model || "google/gemini-3-flash-preview";
  }

  const body: Record<string, unknown> = {
    model,
    messages: request.messages,
  };

  if (request.responseFormat) {
    body.response_format = request.responseFormat;
  }

  const res = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) {
      throw new Error("AI rate limit hit — try again in a minute.");
    }
    throw new Error(`AI error ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? "";

  return { content };
}
