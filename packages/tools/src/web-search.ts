// packages/tools/src/web-search.ts

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export interface WebSearchOptions {
  maxResults?: number;
  searchDepth?: "basic" | "advanced";
}

/**
 * Web search via Tavily API.
 * Returns null if TAVILY_API_KEY is not set — Research Agent works without it.
 */
export async function webSearch(
  query: string,
  apiKey: string | undefined,
  options: WebSearchOptions = {}
): Promise<SearchResult[] | null> {
  if (!apiKey) {
    console.log("[web-search] No TAVILY_API_KEY — skipping web search");
    return null;
  }

  const { maxResults = 5, searchDepth = "advanced" } = options;

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        search_depth: searchDepth,
        include_answer: false,
      }),
    });

    if (!res.ok) {
      console.error("[web-search] Tavily error:", res.status);
      return null;
    }

    const data = await res.json();
    return (data.results || []).map((r: Record<string, string>) => ({
      title: r.title,
      url: r.url,
      content: r.content,
    }));
  } catch (error) {
    console.error("[web-search] Error:", error);
    return null;
  }
}

/**
 * Formats search results into a string for agent context
 */
export function formatSearchResults(results: SearchResult[]): string {
  return results
    .map(
      (r, i) =>
        `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content.slice(0, 500)}`
    )
    .join("\n\n");
}

/**
 * Builds a research query from intake form data
 */
export function buildResearchQuery(
  projectName: string,
  competitors: string,
  blockchain: string
): string {
  return `${projectName} competitors: ${competitors} blockchain ${blockchain} DeFi protocol 2025 2026`;
}
