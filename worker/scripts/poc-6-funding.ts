// POC #6: how well does Tavily surface FUNDING facts? Compare a broad web
// news/finance search vs. domain-scoping to funding sources (Crunchbase etc.),
// and preview the links + descriptions we get back.
//   node scripts/poc-6-funding.ts "Stripe" "stripe.com"

import { COMPANY, type SearchHit, tavilySearch, writeJson } from "./_shared.ts";

const FUNDING_DOMAINS = ["crunchbase.com", "techcrunch.com", "pitchbook.com", "sec.gov", "bloomberg.com", "reuters.com"];
const QUERIES = ["funding round investors valuation", "raised Series total funding", "acquisition merger investment"];

async function gather(opts: { includeDomains?: string[] }): Promise<SearchHit[]> {
  const per = await Promise.all(
    QUERIES.map((q) =>
      tavilySearch(`${COMPANY} ${q}`, { topic: "news", days: 3650, maxResults: 6, rawContent: false, includeDomains: opts.includeDomains }),
    ),
  );
  const seen = new Set<string>();
  return per
    .flat()
    .filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true)))
    .sort((a, b) => b.score - a.score);
}

function preview(label: string, hits: SearchHit[]) {
  console.log(`\n=========== ${label} — ${hits.length} unique links ===========`);
  for (const h of hits) {
    console.log(`\n• [${h.score.toFixed(3)}] ${h.title}`);
    console.log(`  ${h.url}`);
    console.log(`  ${h.snippet.replace(/\s+/g, " ").slice(0, 200)}`);
  }
}

async function main() {
  const broad = await gather({});
  const scoped = await gather({ includeDomains: FUNDING_DOMAINS });

  preview("A) BROAD web news/finance", broad);
  preview("B) DOMAIN-SCOPED to funding sources", scoped);

  const byHost = (hits: SearchHit[]) => {
    const m: Record<string, number> = {};
    for (const h of hits) m[h.host] = (m[h.host] ?? 0) + 1;
    return m;
  };
  console.log(`\n--- host distribution ---`);
  console.log("broad :", byHost(broad));
  console.log("scoped:", byHost(scoped));

  const out = writeJson("poc-6-funding.json", {
    meta: { company: COMPANY, generatedAt: new Date().toISOString(), queries: QUERIES, fundingDomains: FUNDING_DOMAINS },
    broad: broad.map(({ score, host, title, url, snippet }) => ({ score, host, title, url, snippet })),
    scoped: scoped.map(({ score, host, title, url, snippet }) => ({ score, host, title, url, snippet })),
    hostDistribution: { broad: byHost(broad), scoped: byHost(scoped) },
  });
  console.log(`\nWrote ${out}`);
}

main().catch((e) => (console.error(e), process.exit(1)));
