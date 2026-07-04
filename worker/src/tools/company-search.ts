import { createHash } from "node:crypto";
import { tool } from "@langchain/core/tools";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { z } from "zod";
import { renderSourceBlock } from "@/graph/sources";
import { resolveDescriptor, resolveProfiles } from "@/tools/entity-resolve";
import { type SearchResult, tavilyExtract, tavilyMap, tavilySearch } from "@/tools/tavily";

const MAX_TOTAL_OUTPUT_CHARS = 30_000;
const COMPANY_SITE_CATEGORIES = ["About", "Pricing", "Documentation", "Blogs", "Careers", "Media"];
const MIN_CONTENT_CHARS_KEEP = 200;
const MIN_SCORE = 0.2;
const SOCIAL_DOMAINS = ["linkedin.com", "reddit.com", "x.com", "twitter.com"];

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

function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    let p = u.pathname.replace(/\/+$/, "");
    const companyPath = p.match(/^(\/company\/[^/]+)/i);
    if (companyPath) p = companyPath[1];
    return `${u.hostname.replace(/^www\./, "")}${p}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

function contentHash(body: string): string {
  return createHash("sha1").update(body.trim().slice(0, 2000)).digest("hex").slice(0, 16);
}

function createDeduper() {
  const urls = new Set<string>();
  const hashes = new Set<string>();
  return {
    seenUrl: (url: string): boolean => urls.has(canonicalUrl(url)),
    accept: (url: string, body: string): boolean => {
      const trimmed = (body ?? "").trim();
      if (trimmed.length < MIN_CONTENT_CHARS_KEEP) return false;
      const canonical = canonicalUrl(url);
      if (urls.has(canonical)) return false;
      const hash = contentHash(trimmed);
      if (hashes.has(hash)) return false;
      urls.add(canonical);
      hashes.add(hash);
      return true;
    },
  };
}

function coalesce(blocks: string[]): string {
  const out: string[] = [];
  let total = 0;
  for (const block of blocks) {
    if (total + block.length > MAX_TOTAL_OUTPUT_CHARS) {
      out.push("\n[... output truncated at character cap]\n");
      break;
    }
    out.push(block);
    total += block.length;
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

function rankByScore(results: SearchResult[]): SearchResult[] {
  return results.filter((r) => r.score >= MIN_SCORE).sort((a, b) => b.score - a.score);
}

function socialType(url: string): string {
  const h = host(url);
  if (h.includes("linkedin")) return "linkedin";
  if (h.includes("reddit")) return "reddit";
  if (h.includes("x.com") || h.includes("twitter")) return "twitter";
  return "social";
}

const descriptorCache = new Map<string, Promise<string>>();

function getDescriptor(website: string): Promise<string> {
  if (!website) return Promise.resolve("");
  const key = host(website) || website;
  let descriptor = descriptorCache.get(key);
  if (!descriptor) {
    descriptor = resolveDescriptor(website).catch(() => "");
    descriptorCache.set(key, descriptor);
  }
  return descriptor;
}

function isOnTarget(text: string, companyName: string, hostName: string): boolean {
  const t = text.toLowerCase();
  return (hostName !== "" && t.includes(hostName)) || t.includes(companyName.toLowerCase());
}

export const companySiteSearch = tool(
  async ({ queries }, config: LangGraphRunnableConfig) => {
    const website = configValue(config, "website");
    if (!website) return "Error: company_site_search is not configured (missing website).";

    const domain = host(website);
    const dedup = createDeduper();
    const blocks: string[] = [];

    const perQuery = await Promise.all(
      queries.map((q) =>
        safeSearch(q, {
          maxResults: 4,
          includeDomains: domain ? [domain] : undefined,
          includeRawContent: "markdown",
        }),
      ),
    );
    for (const r of rankByScore(perQuery.flat())) {
      const body = r.content ?? r.snippet;
      if (!dedup.accept(r.url, body)) continue;
      blocks.push(renderSourceBlock({ url: r.url, title: r.title, type: "company_site", body }));
    }

    const mapped = await tavilyMap(website, { categories: COMPANY_SITE_CATEGORIES }).catch(() => []);
    const targets = [website, ...mapped.map((m) => m.url).filter((u) => !dedup.seenUrl(u)).slice(0, 8)];
    const pages = await tavilyExtract(targets).catch(() => []);
    for (const p of pages) {
      if (!p.content || !dedup.accept(p.url, p.content)) continue;
      blocks.push(renderSourceBlock({ url: p.url, title: p.title ?? p.url, type: "company_site", body: p.content }));
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

export const socialSearch = tool(
  async ({ queries }, config: LangGraphRunnableConfig) => {
    const companyName = configValue(config, "companyName");
    if (!companyName) return "Error: social_search is not configured (missing company name).";
    const website = configValue(config, "website");

    const dedup = createDeduper();
    const blocks: string[] = [];

    const verified = await resolveProfiles(website, companyName).catch(() => ({ linkedin: null, twitter: null }));
    const verifiedUrls = [verified.linkedin, verified.twitter].filter((u): u is string => !!u);
    if (verifiedUrls.length) {
      const pages = await tavilyExtract(verifiedUrls).catch(() => []);
      for (const p of pages) {
        if (!p.content || !dedup.accept(p.url, p.content)) continue;
        blocks.push(renderSourceBlock({ url: p.url, title: p.title ?? p.url, type: socialType(p.url), body: p.content }));
      }
    }

    const anchored = queries.map((q) => `${companyName} ${q.trim()}`).filter((q) => q.trim());
    const perQuery = await Promise.all(
      anchored.map((q) => safeSearch(q, { maxResults: 5, includeDomains: SOCIAL_DOMAINS, includeRawContent: "markdown" })),
    );
    for (const r of rankByScore(perQuery.flat())) {
      const body = r.content ?? r.snippet;
      if (!dedup.accept(r.url, body)) continue;
      blocks.push(renderSourceBlock({ url: r.url, title: r.title, type: socialType(r.url), body }));
    }

    return blocks.length ? coalesce(blocks) : "No social presence or public discussion found for this company.";
  },
  {
    name: "social_search",
    description:
      "Find the company's social presence and public sentiment: its verified LinkedIn and X (Twitter) profiles plus Reddit and other public discussion. The company name is prepended to every query automatically — provide sentiment/discussion angles WITHOUT the company name (e.g. 'customer reviews', 'employee experience', 'product complaints'). Returns nothing when the company has little social footprint (common for smaller businesses).",
    schema: z.object({
      queries: z.array(z.string()).describe("Sentiment/discussion angles WITHOUT the company name."),
    }),
  },
);

export const webCompanySearch = tool(
  async ({ queries, topic }, config: LangGraphRunnableConfig) => {
    const companyName = configValue(config, "companyName");
    if (!companyName) return "Error: web_company_search is not configured (missing company name).";
    const website = configValue(config, "website");

    const descriptor = await getDescriptor(website);
    const hostName = host(website);
    const prefix = descriptor ? `${companyName} ${descriptor}` : companyName;

    const anchored = queries.map((q) => `${prefix} ${q.trim()}`).filter((q) => q.trim());
    if (anchored.length === 0) return "Error: no queries provided.";

    const perQuery = await Promise.all(
      anchored.map((q) => safeSearch(q, { maxResults: 4, topic, includeRawContent: "markdown" })),
    );
    const dedup = createDeduper();
    const blocks: string[] = [];
    for (const r of rankByScore(perQuery.flat())) {
      const body = r.content ?? r.snippet;
      if (!isOnTarget(`${r.title} ${body}`, companyName, hostName)) continue;
      if (!dedup.accept(r.url, body)) continue;
      blocks.push(renderSourceBlock({ url: r.url, title: r.title, type: "web", body }));
    }

    return blocks.length ? coalesce(blocks) : "No relevant external coverage found for this company.";
  },
  {
    name: "web_company_search",
    description:
      "Search the web for external coverage of the target company (news, funding, hiring, reviews, partnerships). The company name and a short descriptor of what it does are prepended to every query automatically — do not include them; just give the angle (e.g. 'Series A funding investors', 'recent product launch').",
    schema: z.object({
      queries: z.array(z.string()).describe("Search angles WITHOUT the company name."),
      topic: z.enum(["general", "news", "finance"]).default("general"),
    }),
  },
);
