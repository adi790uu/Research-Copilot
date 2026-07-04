// PROVE #5 (the gate): resolve the company's CANONICAL social URLs from its own
// website, then compare "extract the verified page" vs "trust a name search".
// This is the fix for namesake bleed (Stripe Partners). Also exercises the SMB
// fallback: no links on site -> we'd drop back to filtered name-search.
//   node scripts/poc-5-entity-resolution.ts "Stripe" "stripe.com"

import { COMPANY, WEBSITE, host, tavilyExtract, tavilySearch, writeJson } from "./_shared.ts";

type Platform = "linkedin" | "twitter" | "reddit";

function platformOf(url: string): Platform | null {
  const h = host(url);
  if (h.includes("linkedin")) return "linkedin";
  if (h.includes("x.com") || h.includes("twitter")) return "twitter";
  if (h.includes("reddit")) return "reddit";
  return null;
}

// Share/intent widgets, not profiles — reject these.
const JUNK = /\/(share|sharer|shareArticle|intent|home|search|hashtag|login|signup)\b/i;
const RESERVED_X = new Set(["intent", "share", "home", "search", "i", "hashtag", "login", "explore"]);

function isProfile(url: string, p: Platform): boolean {
  if (JUNK.test(url)) return false;
  try {
    const u = new URL(url);
    const seg = u.pathname.replace(/^\/+/, "").split("/");
    if (p === "linkedin") return /^(company|school|in)$/.test(seg[0]) && !!seg[1];
    if (p === "twitter") return !!seg[0] && !RESERVED_X.has(seg[0].toLowerCase());
    if (p === "reddit") return /^(r|user|u)$/.test(seg[0]) && !!seg[1];
    return false;
  } catch {
    return false;
  }
}

function normalizeSite(w: string): string {
  return /^https?:\/\//i.test(w) ? w : `https://${w}`;
}

async function fetchHomepage(url: string): Promise<{ html: string; status: number } | { error: string }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (research-copilot POC)" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    return { html: await res.text(), status: res.status };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// Pull social hrefs out of raw HTML.
function discoverSocials(html: string): Record<Platform, string[]> {
  const found: Record<Platform, Set<string>> = { linkedin: new Set(), twitter: new Set(), reddit: new Set() };
  const re = /https?:\/\/(?:[a-z0-9-]+\.)*(?:linkedin\.com|twitter\.com|x\.com|reddit\.com)\/[^\s"'<>\\)]+/gi;
  for (const raw of html.match(re) ?? []) {
    const url = raw.replace(/[.,);]+$/, "");
    const p = platformOf(url);
    if (p && isProfile(url, p)) found[p].add(url);
  }
  return { linkedin: [...found.linkedin], twitter: [...found.twitter], reddit: [...found.reddit] };
}

const linkedinSlug = (url: string): string | null => url.match(/linkedin\.com\/company\/([^/?#]+)/i)?.[1]?.toLowerCase() ?? null;

async function main() {
  const siteUrl = normalizeSite(WEBSITE);
  const page = await fetchHomepage(siteUrl);
  const homepage = "error" in page
    ? { url: siteUrl, fetched: false, error: page.error }
    : { url: siteUrl, fetched: true, status: page.status, htmlChars: page.html.length };

  const socials = "error" in page ? { linkedin: [], twitter: [], reddit: [] } : discoverSocials(page.html);
  // A company's identity is its /company/ page — /in/ profiles are employees (noise for identity).
  const companyLinks = socials.linkedin.filter((u) => /linkedin\.com\/company\//i.test(u));
  const personLinks = socials.linkedin.filter((u) => /linkedin\.com\/in\//i.test(u));
  console.log(`\nHomepage: ${homepage.fetched ? `ok (${(homepage as any).htmlChars} chars)` : `FAILED: ${(homepage as any).error}`}`);
  console.log(`Discovered on site: ${companyLinks.length} company page(s), ${personLinks.length} employee profile(s), ${socials.twitter.length} X, ${socials.reddit.length} reddit`);
  console.log(`  company links: ${companyLinks.length ? companyLinks.join(", ") : "(none)"}`);

  // ---- NAME-SEARCH PATH: what a blind name query returns (needed for fallback + comparison) ----
  const nameHits = await tavilySearch(`${COMPANY}`, { includeDomains: ["linkedin.com"], maxResults: 8 });
  const companyHits = nameHits.filter((h) => /linkedin\.com\/company\//i.test(h.url)).sort((a, b) => b.score - a.score);

  // ---- RESOLVE: prefer a /company/ link from the site; else fall back to top-scored name-search company hit ----
  let source: "site" | "search-fallback" | "none" = "none";
  let resolvedUrl: string | null = null;
  if (companyLinks[0]) {
    source = "site";
    resolvedUrl = companyLinks[0];
  } else if (companyHits[0]) {
    source = "search-fallback";
    resolvedUrl = companyHits[0].url;
  }

  const resolvedSlug = resolvedUrl ? linkedinSlug(resolvedUrl) : null;
  const namesakes = resolvedSlug ? companyHits.filter((h) => linkedinSlug(h.url) && linkedinSlug(h.url) !== resolvedSlug) : [];

  let verified: { url: string; extractedChars: number; snippet: string } | null = null;
  if (resolvedUrl) {
    const [ex] = await tavilyExtract([resolvedUrl]);
    verified = { url: resolvedUrl, extractedChars: ex?.contentChars ?? 0, snippet: (ex?.content ?? "").replace(/\s+/g, " ").slice(0, 300) };
  }

  console.log(`\n--- RESOLVED company page (via ${source}) ---`);
  console.log(verified ? `  ${verified.url}  (${verified.extractedChars} chars)  "${verified.snippet.slice(0, 90)}..."` : `  UNRESOLVED -> would fall back to filtered name-search`);
  console.log(`\n--- NAME-SEARCH company hits (what blind search would trust) ---`);
  for (const h of companyHits) {
    const slug = linkedinSlug(h.url);
    const tag = slug === resolvedSlug ? "<= TARGET" : "<= NAMESAKE";
    console.log(`  ${h.score.toFixed(3)}  ${h.url.slice(0, 55).padEnd(55)} ${tag}`);
  }
  console.log(`\nresolved via: ${source}   namesakes present in name-search: ${namesakes.length}`);

  const out = writeJson("poc-5-entity-resolution.json", {
    meta: { company: COMPANY, website: WEBSITE, generatedAt: new Date().toISOString() },
    homepage,
    discovered: { companyLinks, personLinks, twitter: socials.twitter, reddit: socials.reddit },
    resolved: { source, verified },
    nameSearch: { companyHits, namesakeCount: namesakes.length },
  });
  console.log(`\nWrote ${out}`);
}

main().catch((e) => (console.error(e), process.exit(1)));
