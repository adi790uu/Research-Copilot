// PROVE #1: Tavily's relevance `score` + domain anchoring kill wrong-company bleed.
// Compares name-only vs name+domain anchoring, and shows what a score threshold drops.
//   node scripts/poc-1-score.ts "Stripe" "stripe.com"

import { COMPANY, WEBSITE, type SearchHit, tavilySearch, writeJson } from "./_shared.ts";

const THRESHOLD = 0.5;
const DOMAINS = ["linkedin.com"];

async function gather(queries: string[]): Promise<SearchHit[]> {
  const per = await Promise.all(queries.map((q) => tavilySearch(q, { includeDomains: DOMAINS, maxResults: 6 })));
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const hits of per) for (const h of hits) if (!seen.has(h.url)) (seen.add(h.url), out.push(h));
  return out;
}

// Does a hit plausibly refer to the target company (not a namesake)?
function looksOnTarget(h: SearchHit): boolean {
  const t = `${h.title} ${h.snippet}`.toLowerCase();
  const slug = WEBSITE.split(".")[0];
  // exact-ish company page slug, or content references the real domain
  return h.url.toLowerCase().includes(`/company/${slug}`) || t.includes(WEBSITE.toLowerCase());
}

async function main() {
  const nameOnly = await gather([`${COMPANY}`, `${COMPANY} headquarters employees`, `${COMPANY} leadership`]);
  const withDomain = await gather([`${COMPANY} ${WEBSITE}`, `${COMPANY} ${WEBSITE} employees`, `${COMPANY} official company page`]);

  const summarize = (hits: SearchHit[], label: string) => {
    const kept = hits.filter((h) => h.score >= THRESHOLD);
    const dropped = hits.filter((h) => h.score < THRESHOLD);
    const offTarget = hits.filter((h) => !looksOnTarget(h));
    console.log(`\n=== ${label} ===  (${hits.length} unique hits)`);
    console.log(`  score>=${THRESHOLD}: kept ${kept.length}, dropped ${dropped.length}`);
    console.log(`  flagged off-target (namesake): ${offTarget.length}`);
    console.log("  hits by score:");
    for (const h of [...hits].sort((a, b) => b.score - a.score)) {
      const flags = [h.score < THRESHOLD ? "LOWSCORE" : "", looksOnTarget(h) ? "" : "OFFTARGET"].filter(Boolean).join(",");
      console.log(`    ${h.score.toFixed(3)}  ${h.title.slice(0, 60).padEnd(60)} ${flags}`);
    }
    return { label, total: hits.length, kept: kept.length, dropped: dropped.length, offTarget: offTarget.length };
  };

  const a = summarize(nameOnly, "NAME-ONLY anchoring");
  const b = summarize(withDomain, "NAME+DOMAIN anchoring");

  const out = writeJson("poc-1-score.json", {
    meta: { company: COMPANY, website: WEBSITE, threshold: THRESHOLD, generatedAt: new Date().toISOString() },
    comparison: [a, b],
    nameOnly,
    withDomain,
  });
  console.log(`\nWrote ${out}`);
}

main().catch((e) => (console.error(e), process.exit(1)));
