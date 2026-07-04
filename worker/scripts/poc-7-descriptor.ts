// Validate the shipped fix: homepage descriptor -> query anchoring -> relevance
// guard. Mirrors the logic now in entity-resolve.ts + company-search.ts.
//   node scripts/poc-7-descriptor.ts "Equal" "equal.in"

import { COMPANY, WEBSITE, type SearchHit, tavilySearch, writeJson } from "./_shared.ts";

function normalizeSite(w: string): string {
  return /^https?:\/\//i.test(w) ? w : `https://${w}`;
}
function hostOf(w: string): string {
  return w.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

async function resolveDescriptor(website: string): Promise<string> {
  let html: string | null = null;
  try {
    const res = await fetch(normalizeSite(website), { headers: { "User-Agent": "Mozilla/5.0 (research-copilot)" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    html = res.ok ? await res.text() : null;
  } catch {
    html = null;
  }
  if (!html) return "";
  const raw =
    html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ??
    "";
  const decoded = raw.replace(/&#x27;|&#39;/gi, "'").replace(/&quot;|&#34;/gi, '"').replace(/&amp;|&#38;/gi, "&").replace(/&nbsp;/gi, " ");
  return decoded.replace(/\s+/g, " ").split(/[.|•·—–\-:]/)[0].trim().split(/\s+/).slice(0, 12).join(" ");
}

function isOnTarget(text: string, name: string, hostName: string): boolean {
  const t = text.toLowerCase();
  return (hostName !== "" && t.includes(hostName)) || t.includes(name.toLowerCase());
}

async function main() {
  const descriptor = await resolveDescriptor(WEBSITE);
  const hostName = hostOf(WEBSITE);
  const prefix = descriptor ? `${COMPANY} ${descriptor}` : COMPANY;

  console.log(`\ncompany:    ${COMPANY}`);
  console.log(`descriptor: "${descriptor}"`);
  console.log(`query prefix: "${prefix}"`);

  const queries = ["funding round investors valuation", "raised Series"];
  const per = await Promise.all(queries.map((q) => tavilySearch(`${prefix} ${q}`, { topic: "news", days: 3650, maxResults: 6, rawContent: false })));
  const seen = new Set<string>();
  const hits = per.flat().filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true))).sort((a, b) => b.score - a.score);

  const kept: SearchHit[] = [];
  const dropped: SearchHit[] = [];
  for (const h of hits) (isOnTarget(`${h.title} ${h.snippet}`, COMPANY, hostName) ? kept : dropped).push(h);

  console.log(`\n=== KEPT (on-target): ${kept.length} ===`);
  for (const h of kept) console.log(`  [${h.score.toFixed(3)}] ${h.title.slice(0, 75)}\n       ${h.url}`);
  console.log(`\n=== DROPPED (guard): ${dropped.length} ===`);
  for (const h of dropped.slice(0, 8)) console.log(`  [${h.score.toFixed(3)}] ${h.title.slice(0, 75)}`);

  const out = writeJson(`poc-7-descriptor-${COMPANY.toLowerCase().replace(/\W+/g, "-")}.json`, {
    meta: { company: COMPANY, website: WEBSITE, descriptor, generatedAt: new Date().toISOString() },
    kept,
    dropped,
  });
  console.log(`\nWrote ${out}`);
}

main().catch((e) => (console.error(e), process.exit(1)));
