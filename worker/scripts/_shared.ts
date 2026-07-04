// Shared Tavily helpers for the improvement POCs. Node 24+ runs .ts natively;
// import with explicit .ts extension.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

try {
  process.loadEnvFile(join(HERE, "..", ".env"));
} catch {
  /* ambient env */
}

export const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
export const SEARCH_DEPTH = (process.env.TAVILY_SEARCH_DEPTH ?? "advanced") as "basic" | "advanced";
if (!TAVILY_API_KEY) {
  console.error("Missing TAVILY_API_KEY (set it in worker/.env).");
  process.exit(1);
}

export type SearchHit = {
  url: string;
  host: string;
  derivedType: string;
  title: string;
  score: number; // Tavily relevance 0..1 — the field the current tools throw away
  snippet: string;
  contentChars: number;
  content: string | null;
};

export function host(url: string): string {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    return "";
  }
}

export function derivedType(url: string): string {
  const h = host(url);
  if (h.includes("linkedin")) return "linkedin";
  if (h.includes("reddit")) return "reddit";
  if (h.includes("x.com") || h.includes("twitter")) return "twitter";
  return "social";
}

type RawHit = { url: string; title?: string; content?: string; raw_content?: string; score?: number };

export async function tavilySearch(
  query: string,
  opts: { includeDomains?: string[]; topic?: "general" | "news" | "finance"; days?: number; maxResults?: number; rawContent?: boolean } = {},
): Promise<SearchHit[]> {
  const body: Record<string, unknown> = {
    query,
    max_results: opts.maxResults ?? 5,
    search_depth: SEARCH_DEPTH,
    topic: opts.topic ?? "general",
    include_raw_content: opts.rawContent === false ? false : "markdown",
  };
  if (opts.includeDomains?.length) body.include_domains = opts.includeDomains;
  if (opts.days) body.days = opts.days;

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TAVILY_API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Tavily search ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { results?: RawHit[] };
  return (data.results ?? []).map((r) => {
    const content = r.raw_content ?? r.content ?? null;
    return {
      url: r.url,
      host: host(r.url),
      derivedType: derivedType(r.url),
      title: r.title ?? r.url,
      score: r.score ?? 0,
      snippet: (r.content ?? "").slice(0, 300),
      contentChars: content?.length ?? 0,
      content,
    };
  });
}

export type Extracted = { url: string; contentChars: number; content: string };

export async function tavilyExtract(urls: string[]): Promise<Extracted[]> {
  if (urls.length === 0) return [];
  const res = await fetch("https://api.tavily.com/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TAVILY_API_KEY}` },
    body: JSON.stringify({ urls, extract_depth: "advanced", format: "markdown" }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`Tavily extract ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { results?: { url: string; raw_content?: string }[] };
  return (data.results ?? []).map((r) => ({ url: r.url, content: r.raw_content ?? "", contentChars: (r.raw_content ?? "").length }));
}

export function writeJson(name: string, data: unknown): string {
  const outDir = join(HERE, "output");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, name);
  writeFileSync(outPath, JSON.stringify(data, null, 2));
  return outPath;
}

export function stats(nums: number[]): { n: number; min: number; max: number; median: number; mean: number } {
  if (nums.length === 0) return { n: 0, min: 0, max: 0, median: 0, mean: 0 };
  const s = [...nums].sort((a, b) => a - b);
  const median = s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
  return { n: s.length, min: s[0], max: s[s.length - 1], median, mean: Math.round(s.reduce((a, b) => a + b, 0) / s.length) };
}

export const COMPANY = process.argv[2] ?? "Stripe";
export const WEBSITE = process.argv[3] ?? "stripe.com";
