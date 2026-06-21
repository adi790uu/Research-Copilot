import { tool } from "@langchain/core/tools";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { z } from "zod";
import { type SearchResult, tavilyExtract, tavilyMap, tavilySearch } from "@/tools/tavily";

// Ported from app/workflow/tools/research.py. Two Tavily-backed tools anchored
// to a target company. Both emit "--- SOURCE N: ... ---" blocks with a Type
// line so compressResearch's regex can extract typed Source records.

const MAX_CONTENT_CHARS = 3000;
const MAX_TOTAL_OUTPUT_CHARS = 30_000;
const COMPANY_SITE_CATEGORIES = ["About", "Pricing", "Documentation", "Blogs", "Careers", "Media"];

type Configurable = { companyName?: string; website?: string };

function configValue(config: LangGraphRunnableConfig, key: keyof Configurable): string {
  return (config.configurable as Configurable | undefined)?.[key] ?? "";
}

function host(url: string): string {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    return "";
  }
}

function sourceBlock(idx: number, title: string, url: string, type: string, body: string): string {
  let b = (body ?? "").trim();
  if (b.length > MAX_CONTENT_CHARS) b = `${b.slice(0, MAX_CONTENT_CHARS)}\n[... truncated]`;
  return `--- SOURCE ${idx}: ${title || url} ---\nURL: ${url}\nType: ${type}\n\nCONTENT:\n${b}\n\n${"-".repeat(80)}\n`;
}

function coalesce(blocks: string[]): string {
  const out: string[] = [];
  let total = 0;
  for (const b of blocks) {
    if (total + b.length > MAX_TOTAL_OUTPUT_CHARS) {
      out.push("\n[... output truncated at character cap]\n");
      break;
    }
    out.push(b);
    total += b.length;
  }
  return out.join("") || "No results.";
}

async function safeSearch(query: string, opts: Parameters<typeof tavilySearch>[1]): Promise<SearchResult[]> {
  try {
    return await tavilySearch(query, opts);
  } catch {
    return [];
  }
}

export const companySiteSearch = tool(
  async ({ queries }, config: LangGraphRunnableConfig) => {
    const website = configValue(config, "website");
    if (!website) return "Error: company_site_search is not configured (missing website).";

    const domain = host(website);
    const seen = new Set<string>();
    const blocks: string[] = [];
    let idx = 1;

    const perQuery = await Promise.all(
      queries.map((q) =>
        safeSearch(q, {
          maxResults: 4,
          includeDomains: domain ? [domain] : undefined,
          includeRawContent: "markdown",
        }),
      ),
    );
    for (const results of perQuery) {
      for (const r of results) {
        if (seen.has(r.url)) continue;
        seen.add(r.url);
        blocks.push(sourceBlock(idx++, r.title, r.url, "company_site", r.content ?? r.snippet));
      }
    }

    // One supplemental map+extract of the company site.
    const mapped = await tavilyMap(website, { categories: COMPANY_SITE_CATEGORIES }).catch(() => []);
    const targets = [website, ...mapped.map((m) => m.url).filter((u) => !seen.has(u)).slice(0, 8)];
    const pages = await tavilyExtract(targets).catch(() => []);
    for (const p of pages) {
      if (seen.has(p.url) || !p.content) continue;
      seen.add(p.url);
      blocks.push(sourceBlock(idx++, p.title ?? p.url, p.url, "company_site", p.content));
    }

    return coalesce(blocks);
  },
  {
    name: "company_site_search",
    description:
      "Scrape and search the target company's own website (about, products, pricing, blog). Provide 1-3 short queries.",
    schema: z.object({
      queries: z.array(z.string()).describe("1-3 short queries about the company's own pages."),
    }),
  },
);

export const webCompanySearch = tool(
  async ({ queries, topic }, config: LangGraphRunnableConfig) => {
    const companyName = configValue(config, "companyName");
    if (!companyName) return "Error: web_company_search is not configured (missing company name).";

    // The company name is prepended automatically — the model must not include it.
    const anchored = queries.map((q) => `${companyName} ${q.trim()}`).filter((q) => q.trim());
    if (anchored.length === 0) return "Error: no queries provided.";

    const perQuery = await Promise.all(
      anchored.map((q) => safeSearch(q, { maxResults: 4, topic, includeRawContent: "markdown" })),
    );
    const seen = new Set<string>();
    const blocks: string[] = [];
    let idx = 1;
    for (const results of perQuery) {
      for (const r of results) {
        if (seen.has(r.url)) continue;
        seen.add(r.url);
        blocks.push(sourceBlock(idx++, r.title, r.url, "web", r.content ?? r.snippet));
      }
    }
    return coalesce(blocks);
  },
  {
    name: "web_company_search",
    description:
      "Search the web for external coverage of the target company (news, funding, hiring, reviews, partnerships). The company name is prepended to every query automatically — do not include it yourself.",
    schema: z.object({
      queries: z.array(z.string()).describe("Search queries WITHOUT the company name."),
      topic: z.enum(["general", "news", "finance"]).default("general"),
    }),
  },
);
