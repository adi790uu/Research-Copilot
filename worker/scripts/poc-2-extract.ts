// PROVE #2: search->extract two-stage gives fuller, more consistent content than
// search-only (which caused the 141-char vs 45k-char inconsistency).
//   node scripts/poc-2-extract.ts "Stripe" "stripe.com"

import { COMPANY, stats, tavilyExtract, tavilySearch, writeJson } from "./_shared.ts";

const NEAR_EMPTY = 200; // chars

async function main() {
  // Stage 1: discover via search (with raw content, as the current tool does).
  const per = await Promise.all(
    [`${COMPANY} review`, `${COMPANY} experience`].map((q) => tavilySearch(q, { includeDomains: ["reddit.com"], maxResults: 6 })),
  );
  const seen = new Set<string>();
  const hits = per.flat().filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true)));

  // Stage 2: extract the same URLs.
  const extracted = await tavilyExtract(hits.map((h) => h.url));
  const byUrl = new Map(extracted.map((e) => [e.url, e.contentChars]));

  const searchChars = hits.map((h) => h.contentChars);
  const extractChars = hits.map((h) => byUrl.get(h.url) ?? 0);

  const rows = hits.map((h) => ({
    url: h.url,
    searchChars: h.contentChars,
    extractChars: byUrl.get(h.url) ?? 0,
    delta: (byUrl.get(h.url) ?? 0) - h.contentChars,
  }));

  console.log(`\nPer-URL content chars (search vs extract):`);
  for (const r of rows) console.log(`  search ${String(r.searchChars).padStart(6)}  ->  extract ${String(r.extractChars).padStart(6)}  (${r.delta >= 0 ? "+" : ""}${r.delta})  ${r.url.slice(0, 60)}`);

  const nearEmpty = (arr: number[]) => arr.filter((c) => c < NEAR_EMPTY).length;
  console.log(`\nSEARCH-ONLY  length stats:`, stats(searchChars), `| near-empty(<${NEAR_EMPTY}): ${nearEmpty(searchChars)}/${hits.length}`);
  console.log(`SEARCH+EXTRACT length stats:`, stats(extractChars), `| near-empty(<${NEAR_EMPTY}): ${nearEmpty(extractChars)}/${hits.length}`);

  const out = writeJson("poc-2-extract.json", {
    meta: { company: COMPANY, generatedAt: new Date().toISOString(), nearEmptyThreshold: NEAR_EMPTY },
    searchOnly: { stats: stats(searchChars), nearEmpty: nearEmpty(searchChars) },
    searchPlusExtract: { stats: stats(extractChars), nearEmpty: nearEmpty(extractChars) },
    rows,
  });
  console.log(`\nWrote ${out}`);
}

main().catch((e) => (console.error(e), process.exit(1)));
