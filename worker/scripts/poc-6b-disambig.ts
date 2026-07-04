// POC #6b: does anchoring funding queries with the DOMAIN recover obscure /
// generic-named companies that bare-name search drowns in noise (Steps AI, Equal)?
// Compares 3 query strategies and flags which links actually reference the brand/domain.
//   node scripts/poc-6b-disambig.ts "Equal" "equal.in"

import { COMPANY, WEBSITE, type SearchHit, tavilySearch, writeJson } from "./_shared.ts";

const HOST = WEBSITE.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
const BRAND = HOST.split(".")[0]; // "equal" from equal.in
const QUERIES = ["funding round investors", "raised Series", "secures funding valuation"];

// On-target if the link references the exact domain, or the brand adjacent to a funding word.
function onTarget(h: SearchHit): boolean {
  const t = `${h.title} ${h.snippet}`.toLowerCase();
  if (t.includes(HOST.toLowerCase())) return true; // strongest signal: mentions equal.in
  const brandNearFunding = new RegExp(`\\b${BRAND}\\b[^.]{0,60}(raise|funding|series|valuation|million|led by)`, "i");
  return brandNearFunding.test(t);
}

async function strategy(label: string, build: (q: string) => string): Promise<{ label: string; hits: SearchHit[]; onTarget: SearchHit[] }> {
  const per = await Promise.all(QUERIES.map((q) => tavilySearch(build(q), { topic: "news", days: 3650, maxResults: 6, rawContent: false })));
  const seen = new Set<string>();
  const hits = per.flat().filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true))).sort((a, b) => b.score - a.score);
  return { label, hits, onTarget: hits.filter(onTarget) };
}

async function main() {
  const strategies = [
    await strategy("A) bare name", (q) => `${COMPANY} ${q}`),
    await strategy("B) name + domain", (q) => `${COMPANY} ${HOST} ${q}`),
    await strategy("C) name + brand keyword", (q) => `"${COMPANY}" ${BRAND} ${q}`),
  ];

  for (const s of strategies) {
    console.log(`\n=========== ${s.label} — ${s.hits.length} links, ${s.onTarget.length} on-target ===========`);
    for (const h of s.hits.slice(0, 8)) {
      console.log(`  ${onTarget(h) ? "✓" : " "} [${h.score.toFixed(3)}] ${h.title.slice(0, 72)}`);
      console.log(`       ${h.url}`);
    }
    if (s.onTarget.length) {
      console.log(`  --- ON-TARGET ---`);
      for (const h of s.onTarget) console.log(`  ✓ ${h.url}\n      ${h.snippet.replace(/\s+/g, " ").slice(0, 180)}`);
    }
  }

  const out = writeJson("poc-6b-disambig.json", {
    meta: { company: COMPANY, website: WEBSITE, host: HOST, brand: BRAND, generatedAt: new Date().toISOString() },
    strategies: strategies.map((s) => ({ label: s.label, total: s.hits.length, onTargetCount: s.onTarget.length, onTarget: s.onTarget, hits: s.hits })),
  });
  console.log(`\nWrote ${out}`);
}

main().catch((e) => (console.error(e), process.exit(1)));
