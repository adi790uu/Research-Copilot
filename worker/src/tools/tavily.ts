import { env } from "@/config";

// Minimal Tavily REST client (search / extract / map) — mirrors the subset of
// app/providers/search/tavily.py the research tools use. No SDK dependency.

const BASE = "https://api.tavily.com";

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.TAVILY_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Tavily ${path} ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export type SearchResult = {
  url: string;
  title: string;
  snippet: string;
  content: string | null;
};

type RawSearchHit = { url: string; title?: string; content?: string; raw_content?: string };

export async function tavilySearch(
  query: string,
  opts: {
    maxResults?: number;
    topic?: "general" | "news" | "finance";
    includeDomains?: string[];
    includeRawContent?: boolean | "markdown" | "text";
  } = {},
): Promise<SearchResult[]> {
  const body: Record<string, unknown> = {
    query,
    max_results: opts.maxResults ?? 4,
    search_depth: env.TAVILY_SEARCH_DEPTH,
    topic: opts.topic ?? "general",
    include_raw_content: opts.includeRawContent ?? false,
  };
  if (opts.includeDomains?.length) body.include_domains = opts.includeDomains;
  const data = await post<{ results?: RawSearchHit[] }>("/search", body);
  return (data.results ?? []).map((r) => ({
    url: r.url,
    title: r.title ?? r.url,
    snippet: (r.content ?? "").slice(0, 400),
    content: r.raw_content ?? r.content ?? null,
  }));
}

export type ExtractedPage = { url: string; content: string; title: string | null };

export async function tavilyExtract(urls: string[]): Promise<ExtractedPage[]> {
  if (urls.length === 0) return [];
  const data = await post<{ results?: { url: string; raw_content?: string; title?: string }[] }>(
    "/extract",
    { urls, extract_depth: "advanced", format: "markdown" },
  );
  return (data.results ?? []).map((r) => ({
    url: r.url,
    content: r.raw_content ?? "",
    title: r.title ?? null,
  }));
}

export type MappedUrl = { url: string; title: string | null };

export async function tavilyMap(
  url: string,
  opts: { maxDepth?: number; limit?: number; categories?: string[] } = {},
): Promise<MappedUrl[]> {
  const body: Record<string, unknown> = {
    url,
    max_depth: opts.maxDepth ?? 2,
    limit: opts.limit ?? 20,
  };
  if (opts.categories?.length) body.categories = opts.categories;
  const data = await post<{ results?: (string | { url: string; title?: string })[] }>("/map", body);
  return (data.results ?? []).map((r) =>
    typeof r === "string" ? { url: r, title: null } : { url: r.url, title: r.title ?? null },
  );
}
