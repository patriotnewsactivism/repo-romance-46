export const OPENROUTER_REASONING_EFFORTS = [
  "max",
  "xhigh",
  "high",
  "medium",
  "low",
  "minimal",
  "none",
] as const;

export type OpenRouterReasoningEffort = (typeof OPENROUTER_REASONING_EFFORTS)[number];

export const OPENROUTER_MODEL_SORTS = [
  "intelligence-high-to-low",
  "pricing-low-to-high",
  "context-high-to-low",
  "most-popular",
  "newest",
] as const;

export type OpenRouterModelSort = (typeof OPENROUTER_MODEL_SORTS)[number];

interface RawOpenRouterReasoning {
  supported_efforts?: string[] | null;
  default_effort?: string | null;
  default_enabled?: boolean;
  supports_max_tokens?: boolean;
  mandatory?: boolean;
}
interface RawOpenRouterModel {
  id?: string;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: {
    prompt?: string | number | null;
    completion?: string | number | null;
  };
  supported_parameters?: string[];
  reasoning?: RawOpenRouterReasoning | null;
}

export interface SelectableOpenRouterModel {
  id: string;
  name: string;
  description: string | null;
  provider: string;
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  contextLength: number;
  supportsReasoning: boolean;
  supportedEfforts: OpenRouterReasoningEffort[] | null;
  defaultEffort: OpenRouterReasoningEffort | null;
  defaultReasoningEnabled: boolean;
  reasoningMandatory: boolean;
  supportsReasoningMaxTokens: boolean;
  supportsTools: boolean;
  isFree: boolean;
  catalogRank: number;
}
const PRICE_PER_MILLION = 1_000_000;
const REASONING_EFFORT_SET = new Set<string>(OPENROUTER_REASONING_EFFORTS);

function pricePerMillion(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed * PRICE_PER_MILLION;
}

export function normalizeOpenRouterReasoningEffort(
  value: string | null | undefined,
): OpenRouterReasoningEffort | null {
  const normalized = String(value || "").trim().toLowerCase();
  return REASONING_EFFORT_SET.has(normalized) ? (normalized as OpenRouterReasoningEffort) : null;
}

function supportedEfforts(reasoning: RawOpenRouterReasoning | null | undefined): OpenRouterReasoningEffort[] | null {
  if (!reasoning || reasoning.supported_efforts === null || reasoning.supported_efforts === undefined) return null;
  const values = reasoning.supported_efforts
    .map((effort) => normalizeOpenRouterReasoningEffort(effort))
    .filter((effort): effort is OpenRouterReasoningEffort => Boolean(effort));
  return values.length > 0 ? values : null;
}

export function normalizeOpenRouterModel(raw: RawOpenRouterModel, catalogRank = 0): SelectableOpenRouterModel | null {
  const id = String(raw.id || "").trim();
  if (!id) return null;
  const inputPricePerMillion = pricePerMillion(raw.pricing?.prompt);
  const outputPricePerMillion = pricePerMillion(raw.pricing?.completion);
  const parameters = new Set(raw.supported_parameters ?? []);
  const reasoning = raw.reasoning ?? null;
  const supportsReasoning = Boolean(reasoning) || parameters.has("reasoning");
  const efforts = supportsReasoning ? supportedEfforts(reasoning) : [];

  return {
    id,
    name: String(raw.name || id),
    description: raw.description ? String(raw.description) : null,
    provider: id.split("/")[0] || "unknown",
    inputPricePerMillion,
    outputPricePerMillion,
    contextLength: Number.isFinite(raw.context_length) ? Math.max(0, Number(raw.context_length)) : 0,
    supportsReasoning,
    supportedEfforts: supportsReasoning ? efforts : [],
    defaultEffort: normalizeOpenRouterReasoningEffort(reasoning?.default_effort),
    defaultReasoningEnabled: Boolean(reasoning?.default_enabled),
    reasoningMandatory: Boolean(reasoning?.mandatory),
    supportsReasoningMaxTokens: Boolean(reasoning?.supports_max_tokens),
    supportsTools: parameters.has("tools"),
    isFree: inputPricePerMillion === 0 && outputPricePerMillion === 0,
    catalogRank,
  };
}

function catalogUrl(path: string, sort: OpenRouterModelSort): URL {
  const url = new URL(`https://openrouter.ai${path}`);
  url.searchParams.set("output_modalities", "text");
  url.searchParams.set("sort", sort);
  return url;
}
async function fetchCatalog(url: URL, apiKey: string): Promise<Response> {
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "HTTP-Referer": "https://portfolio.donmatthews.live",
      "X-OpenRouter-Title": "RepoFinisher",
    },
    cache: "no-store",
  });
}

export async function fetchOpenRouterModels(
  rawApiKey: string,
  sort: OpenRouterModelSort = "intelligence-high-to-low",
): Promise<{ models: SelectableOpenRouterModel[]; source: "user" | "catalog" }> {
  const apiKey = rawApiKey.trim();
  if (!apiKey) throw new Error("OpenRouter API key is required for live model discovery.");

  let source: "user" | "catalog" = "user";
  let response = await fetchCatalog(catalogUrl("/api/v1/models/user", sort), apiKey);

  if (response.status === 404 || response.status === 405) {
    source = "catalog";
    response = await fetchCatalog(catalogUrl("/api/v1/models", sort), apiKey);
  }

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw Object.assign(new Error(`OpenRouter model discovery failed (${response.status}): ${detail}`), {
      status: response.status === 401 || response.status === 403 ? 401 : 502,
    });
  }

  const payload = (await response.json()) as { data?: RawOpenRouterModel[] };
  if (!Array.isArray(payload.data)) throw new Error("OpenRouter returned an invalid model catalog.");

  const models = payload.data
    .map((model, index) => normalizeOpenRouterModel(model, index))
    .filter((model): model is SelectableOpenRouterModel => Boolean(model));

  return { models, source };
}
