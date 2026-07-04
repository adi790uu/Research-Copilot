// PROVE #3: content-hash + canonical-URL dedup collapses the identical blobs
// that URL-only dedup (the current tools) lets through.
//   node scripts/poc-3-dedup.ts "Stripe" "stripe.com"

import { createHash } from "node:crypto";
import { COMPANY, type SearchHit, tavilySearch, writeJson } from "./_shared.ts";

// Strip LinkedIn company sub-paths (/jobs, /life, /about ...) to the base entity.
function canonical(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    let p = u.pathname.replace(/\/+$/, "");
    const m = p.match(/^(\/company\/[^/]+)/i);
    if (m) p = m[1];
    return `${u.hostname.replace(/^www\./, "")}${p}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

const contentHash = (s: string | null) => createHash("sha1").update((s ?? "").trim().slice(0, 2000)).digest("hex").slice(0, 12);

async function main() {
  const per = await Promise.all(
    [`${COMPANY}`, `${COMPANY} jobs`, `${COMPANY} life culture`].map((q) => tavilySearch(q, { includeDomains: ["linkedin.com"], maxResults: 6 })),
  );
  const raw = per.flat();

  const byUrl = new Set<string>();
  const byCanon = new Set<string>();
  const byContent = new Set<string>();
  const keptUrl: SearchHit[] = [];
  const keptAll: SearchHit[] = [];
  const contentGroups = new Map<string, string[]>();

  for (const h of raw) {
    if (!byUrl.has(h.url)) (byUrl.add(h.url), keptUrl.push(h)); // current behaviour
    const ch = contentHash(h.content);
    contentGroups.set(ch, [...(contentGroups.get(ch) ?? []), h.url]);
    const canon = canonical(h.url);
    const dupe = byCanon.has(canon) || byContent.has(ch);
    if (!dupe) {
      byCanon.add(canon);
      byContent.add(ch);
      keptAll.push(h);
    }
  }

  const collisions = [...contentGroups.entries()].filter(([, urls]) => urls.length > 1);

  console.log(`\nraw results:            ${raw.length}`);
  console.log(`unique by URL (current): ${keptUrl.length}`);
  console.log(`unique by canonical+content (proposed): ${keptAll.length}`);
  console.log(`\nidentical-content groups (same content, different URLs):`);
  for (const [h, urls] of collisions) {
    console.log(`  hash ${h}  x${urls.length}`);
    for (const u of urls) console.log(`      ${u}`);
  }

  const out = writeJson("poc-3-dedup.json", {
    meta: { company: COMPANY, generatedAt: new Date().toISOString() },
    counts: { raw: raw.length, uniqueByUrl: keptUrl.length, uniqueByCanonAndContent: keptAll.length },
    identicalContentGroups: collisions.map(([hash, urls]) => ({ hash, count: urls.length, urls })),
  });
  console.log(`\nWrote ${out}`);
}

main().catch((e) => (console.error(e), process.exit(1)));
