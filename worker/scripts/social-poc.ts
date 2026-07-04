// POC: domain-scoped Tavily "social search" — see exactly what LinkedIn /
// Reddit / X return so we can judge fidelity before wiring a real tool.
//
// Run (Node 24+, from worker/):
//   node scripts/social-poc.ts "Company Name" "https://company.com"
//   node scripts/social-poc.ts "Stripe"            # website optional
//
// Reads TAVILY_API_KEY from worker/.env. Writes structured output to
// scripts/output/social-poc-<slug>.json.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// Load worker/.env so TAVILY_API_KEY is available.
try {
  process.loadEnvFile(join(HERE, "..", ".env"));
} catch {
  /* fall back to ambient env */
}

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const SEARCH_DEPTH = (process.env.TAVILY_SEARCH_DEPTH ?? "advanced") as "basic" | "advanced";
if (!TAVILY_API_KEY) {
  console.error("Missing TAVILY_API_KEY (set it in worker/.env).");
  process.exit(1);
}

const company = process.argv[2] ?? "Stripe";
const website = process.argv[3] ?? "";

// ---- Tavily client (mirrors src/tools/tavily.ts, trimmed to search) --------

type RawHit = { url: string; title?: string; content?: string; raw_content?: string };
type Result = {
  url: string;
  host: string;
  derivedType: string;
  title: string;
  snippet: string;
  contentChars: number;
  content: string | null;
};

function host(url: string): string {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    return "";
  }
}

// The per-platform source type the real tool would stamp onto each SOURCE block.
function derivedType(url: string): string {
  const h = host(url);
  if (h.includes("linkedin")) return "linkedin";
  if (h.includes("reddit")) return "reddit";
  if (h.includes("x.com") || h.includes("twitter")) return "twitter";
  return "social";
}

async function tavilySearch(query: string, includeDomains: string[]): Promise<Result[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TAVILY_API_KEY}`,
    },
    body: JSON.stringify({
      query,
      max_results: 5,
      search_depth: SEARCH_DEPTH,
      topic: "general",
      include_raw_content: "markdown",
      include_domains: includeDomains,
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { results?: RawHit[] };
  return (data.results ?? []).map((r) => {
    const content = r.raw_content ?? r.content ?? null;
    return {
      url: r.url,
      host: host(r.url),
      derivedType: derivedType(r.url),
      title: r.title ?? r.url,
      snippet: (r.content ?? "").slice(0, 400),
      contentChars: content?.length ?? 0,
      content,
    };
  });
}

// ---- Probes: one platform block per social domain --------------------------

type Probe = { platform: string; domains: string[]; queries: string[] };

// Queries are anchored with the company name, exactly like the real tool would.
const probes: Probe[] = [
  {
    platform: "linkedin",
    domains: ["linkedin.com"],
    queries: [`${company}`, `${company} headquarters employees industry`, `${company} leadership team`],
  },
  {
    platform: "reddit",
    domains: ["reddit.com"],
    queries: [`${company} review`, `${company} experience opinion`],
  },
  {
    platform: "twitter",
    domains: ["x.com", "twitter.com"],
    queries: [`${company}`, `${company} announcement launch`],
  },
];

type Run = { platform: string; domains: string[]; query: string; resultCount: number; results: Result[]; error?: string };

async function main() {
  const runs: Run[] = [];

  for (const probe of probes) {
    const settled = await Promise.all(
      probe.queries.map(async (query): Promise<Run> => {
        try {
          const results = await tavilySearch(query, probe.domains);
          return { platform: probe.platform, domains: probe.domains, query, resultCount: results.length, results };
        } catch (err) {
          return {
            platform: probe.platform,
            domains: probe.domains,
            query,
            resultCount: 0,
            results: [],
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    runs.push(...settled);
    console.log(`[${probe.platform}] ${settled.reduce((n, r) => n + r.resultCount, 0)} results across ${probe.queries.length} queries`);
  }

  // ---- Summary: what did each platform actually yield? ----
  const byPlatform: Record<string, { queries: number; results: number; uniqueUrls: number; withContent: number; avgContentChars: number }> = {};
  const byDerivedType: Record<string, number> = {};

  for (const probe of probes) {
    const platRuns = runs.filter((r) => r.platform === probe.platform);
    const all = platRuns.flatMap((r) => r.results);
    const uniq = new Set(all.map((r) => r.url));
    const withContent = all.filter((r) => (r.content?.trim().length ?? 0) > 0);
    const avg = withContent.length ? Math.round(withContent.reduce((n, r) => n + r.contentChars, 0) / withContent.length) : 0;
    byPlatform[probe.platform] = {
      queries: platRuns.length,
      results: all.length,
      uniqueUrls: uniq.size,
      withContent: withContent.length,
      avgContentChars: avg,
    };
    for (const r of all) byDerivedType[r.derivedType] = (byDerivedType[r.derivedType] ?? 0) + 1;
  }

  const output = {
    meta: {
      company,
      website,
      generatedAt: new Date().toISOString(),
      searchDepth: SEARCH_DEPTH,
      note: "Domain-scoped Tavily search POC. content = raw_content (markdown) returned by Tavily.",
    },
    summary: { byPlatform, byDerivedType },
    runs,
  };

  const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const outDir = join(HERE, "output");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `social-poc-${slug}.json`);
  writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log("\nSummary by platform:");
  console.table(byPlatform);
  console.log(`\nWrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
