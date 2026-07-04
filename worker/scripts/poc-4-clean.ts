// PROVE #4: boilerplate stripping + near-empty drop removes login-wall / nav junk
// and the sub-200-char stubs that pollute researcher context.
//   node scripts/poc-4-clean.ts "Stripe" "stripe.com"

import { COMPANY, stats, tavilySearch, writeJson } from "./_shared.ts";

const NEAR_EMPTY = 200;

// Known chrome seen in the POC output across LinkedIn / Reddit / X.
const BOILERPLATE = [
  /log ?in\s*sign ?up/gi,
  /skip to main content/gi,
  /open menu open navigation/gi,
  /people also viewed[\s\S]*?(?=\n#|\n##|$)/gi,
  /report this profile/gi,
  /sign up for reddit\s*log in\s*log in to reddit/gi,
  /don'?t miss.*$/gim,
  /\[\]\(\s*to reddit home[\s\S]*?\)/gi,
];

function clean(s: string | null): string {
  let out = s ?? "";
  for (const re of BOILERPLATE) out = out.replace(re, " ");
  return out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

async function main() {
  const per = await Promise.all(
    [`${COMPANY}`, `${COMPANY} review experience`].map((q) =>
      tavilySearch(q, { includeDomains: ["linkedin.com", "reddit.com", "x.com", "twitter.com"], maxResults: 6 }),
    ),
  );
  const seen = new Set<string>();
  const hits = per.flat().filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true)));

  const rows = hits.map((h) => {
    const cleaned = clean(h.content);
    return { url: h.url, type: h.derivedType, before: h.contentChars, after: cleaned.length, cleaned };
  });

  const beforeChars = rows.map((r) => r.before);
  const afterChars = rows.map((r) => r.after);
  const droppedNearEmpty = rows.filter((r) => r.after < NEAR_EMPTY);
  const totalBefore = beforeChars.reduce((a, b) => a + b, 0);
  const totalAfter = afterChars.reduce((a, b) => a + b, 0);

  console.log(`\nPer-result chars (before -> after cleaning):`);
  for (const r of rows) {
    const flag = r.after < NEAR_EMPTY ? "  DROP(near-empty)" : "";
    console.log(`  ${String(r.before).padStart(6)} -> ${String(r.after).padStart(6)}  [${r.type}] ${r.url.slice(0, 52)}${flag}`);
  }
  console.log(`\ntotal chars: ${totalBefore} -> ${totalAfter}  (${Math.round((1 - totalAfter / totalBefore) * 100)}% removed as boilerplate)`);
  console.log(`near-empty results dropped: ${droppedNearEmpty.length}/${rows.length}`);
  console.log(`before stats:`, stats(beforeChars));
  console.log(`after  stats:`, stats(afterChars.filter((c) => c >= NEAR_EMPTY)), "(kept only)");

  const out = writeJson("poc-4-clean.json", {
    meta: { company: COMPANY, generatedAt: new Date().toISOString(), nearEmptyThreshold: NEAR_EMPTY },
    totals: { beforeChars: totalBefore, afterChars: totalAfter, pctRemoved: Math.round((1 - totalAfter / totalBefore) * 100), droppedNearEmpty: droppedNearEmpty.length },
    rows,
  });
  console.log(`\nWrote ${out}`);
}

main().catch((e) => (console.error(e), process.exit(1)));
