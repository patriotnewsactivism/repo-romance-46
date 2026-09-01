const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

export interface MarketResearchSource {
  title: string;
  url: string;
  excerpt: string;
  score: number | null;
}

interface TavilyResult {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  score?: unknown;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

function clampExcerpt(value: unknown, max = 2400) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function safeUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function marketResearchConfigured() {
  return Boolean(process.env.TAVILY_API_KEY?.trim());
}

export async function searchMarketWeb(query: string, maxResults = 6): Promise<MarketResearchSource[]> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        topic: "general",
        search_depth: process.env.TAVILY_SEARCH_DEPTH || "advanced",
        max_results: Math.max(3, Math.min(10, maxResults)),
        include_answer: false,
        include_raw_content: false,
        chunks_per_source: 3,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`Live market research failed (${response.status}): ${detail}`);
    }

    const payload = (await response.json()) as TavilyResponse;
    return (payload.results ?? [])
      .map((row) => {
        const url = safeUrl(row.url);
        if (!url) return null;
        const parsedScore = typeof row.score === "number" && Number.isFinite(row.score) ? row.score : null;
        return {
          title: typeof row.title === "string" && row.title.trim() ? row.title.trim() : url,
          url,
          excerpt: clampExcerpt(row.content),
          score: parsedScore,
        } satisfies MarketResearchSource;
      })
      .filter((row): row is MarketResearchSource => row !== null);
  } finally {
    clearTimeout(timeout);
  }
}

export function dedupeMarketSources(groups: MarketResearchSource[][], max = 24) {
  const seen = new Set<string>();
  const output: MarketResearchSource[] = [];
  for (const source of groups.flat()) {
    const key = source.url.replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(source);
    if (output.length >= max) break;
  }
  return output;
}
