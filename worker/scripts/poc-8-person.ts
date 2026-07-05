// POC: person-level enrichment from name + email — derive the company domain
// from the email, cross-check the company's own team/about pages for a direct
// mention, resolve a LinkedIn profile (anchored on the domain/company to fight
// namesake bleed, same idea as poc-5's company resolution), and pull general
// web mentions.
//   npx tsx scripts/poc-8-person.ts "Aditya Agarwal" "aditya.agarwal@stepsai.ca"

import { host, tavilyExtract, tavilySearch, writeJson } from "./_shared.ts";

const name = process.argv[2] ?? "Aditya Agarwal";
const email = process.argv[3] ?? "aditya.agarwal@stepsai.ca";
const domain = email.split("@")[1]?.toLowerCase().trim() ?? "";
const companyGuess = domain.split(".")[0] ?? "";

// Try https first (most sites), then http — some domains (registrar/URL-forwarding
// setups, common for a secondary TLD like a .ca alongside a primary .co/.com) only
// answer on 80 and 302 to the real site. `redirect: "follow"` then lands on the
// canonical host, which we report back so downstream steps use the real domain.
async function fetchHomepage(
  domain: string,
): Promise<{ html: string; status: number; finalUrl: string } | { error: string }> {
  for (const scheme of ["https", "http"]) {
    try {
      const res = await fetch(`${scheme}://${domain}`, {
        headers: { "User-Agent": "Mozilla/5.0 (research-copilot POC)" },
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
      });
      return { html: await res.text(), status: res.status, finalUrl: res.url };
    } catch {
      // try the next scheme
    }
  }
  return { error: `both https and http failed for ${domain}` };
}

function findTeamLinks(html: string, base: string): string[] {
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
  const keywords = /(team|about|people|leadership|founders?|who-we-are)/i;
  const abs = hrefs
    .filter((h) => keywords.test(h))
    .map((h) => {
      try {
        return new URL(h, base).toString();
      } catch {
        return null;
      }
    })
    .filter((u): u is string => !!u);
  return [...new Set(abs)].slice(0, 5);
}

function mentionsName(text: string, personName: string): boolean {
  const parts = personName.toLowerCase().split(/\s+/).filter(Boolean);
  const t = text.toLowerCase();
  return parts.every((p) => t.includes(p));
}

const LINKEDIN_PROFILE_RE = /linkedin\.com\/in\/[^/?#\s"'<>]+/i;
function isLinkedinProfile(url: string): boolean {
  return LINKEDIN_PROFILE_RE.test(url);
}

async function main() {
  console.log(`\nPerson: ${name}\nEmail: ${email}\nDomain (derived): ${domain}\n`);

  // 1. Company homepage — find team/about pages and check for a direct mention.
  const home = await fetchHomepage(domain);
  const homepage =
    "error" in home
      ? { url: `https://${domain}`, fetched: false, error: home.error }
      : { url: home.finalUrl, fetched: true, status: home.status, htmlChars: home.html.length };
  const canonicalDomain = "error" in home ? domain : host(home.finalUrl);

  const teamLinks = "error" in home ? [] : findTeamLinks(home.html, home.finalUrl);
  const homepageMentionsName = "error" in home ? false : mentionsName(home.html, name);

  console.log(
    `Homepage: ${homepage.fetched ? `ok via ${homepage.url} (${(homepage as { htmlChars: number }).htmlChars} chars)` : `FAILED: ${(homepage as { error: string }).error}`}`,
  );
  if (canonicalDomain !== domain) console.log(`Canonical domain differs from email domain: ${domain} -> ${canonicalDomain}`);
  console.log(`Team/about links found: ${teamLinks.length ? teamLinks.join(", ") : "(none)"}`);
  console.log(`Name mentioned on homepage: ${homepageMentionsName}`);

  let teamPages: { url: string; mentionsName: boolean; contentChars: number }[] = [];
  if (teamLinks.length) {
    const extracted = await tavilyExtract(teamLinks);
    teamPages = extracted.map((p) => ({
      url: p.url,
      mentionsName: mentionsName(p.content, name),
      contentChars: p.contentChars,
    }));
    console.log(`\nTeam/about page extraction:`);
    for (const p of teamPages) {
      console.log(`  ${p.mentionsName ? "MATCH" : "no match"}  ${p.url}  (${p.contentChars} chars)`);
    }
  }

  // 2. LinkedIn resolution — anchor every query with the domain/company name.
  const anchorDomains = [...new Set([domain, canonicalDomain])];
  const liQueries = [
    ...anchorDomains.map((d) => `"${name}" ${d}`),
    `"${name}" ${companyGuess}`,
    `${name} linkedin ${companyGuess}`,
  ];
  const liHitsRaw = await Promise.all(
    liQueries.map((q) => tavilySearch(q, { includeDomains: ["linkedin.com"], maxResults: 5 })),
  );
  const liHits = liHitsRaw.flat().filter((h) => isLinkedinProfile(h.url));
  const liSeen = new Set<string>();
  const liUnique = liHits
    .filter((h) => (liSeen.has(h.url) ? false : (liSeen.add(h.url), true)))
    .sort((a, b) => b.score - a.score);

  console.log(`\nLinkedIn candidates (${liUnique.length} unique /in/ profiles):`);
  for (const h of liUnique) console.log(`  ${h.score.toFixed(3)}  ${h.url}`);

  // A candidate is only trustworthy if the extracted profile itself mentions the
  // company — a namesake with no company link must never be surfaced as a match.
  // Common names collide constantly (see poc-8-person.json for this run: several
  // unrelated, more "findable" people with the same name outrank the real target).
  let resolvedProfile: { url: string; contentChars: number; snippet: string; confident: boolean } | null = null;
  if (liUnique[0]) {
    const [ex] = await tavilyExtract([liUnique[0].url]);
    const content = ex?.content ?? "";
    const confident = anchorDomains.some((d) => content.toLowerCase().includes(d)) || mentionsName(content, companyGuess);
    resolvedProfile = {
      url: liUnique[0].url,
      contentChars: ex?.contentChars ?? 0,
      snippet: content.replace(/\s+/g, " ").slice(0, 400),
      confident,
    };
    console.log(`\nTop candidate extracted: ${resolvedProfile.contentChars} chars — confident match: ${confident}`);
    console.log(`  "${resolvedProfile.snippet.slice(0, 200)}..."`);
    if (!confident) {
      console.log(`  WARNING: profile does not mention ${companyGuess} or ${anchorDomains.join("/")} — treat as UNRESOLVED, do not surface as this person.`);
    }
  }

  // 3. General web mentions — interviews, articles, GitHub, X, press.
  const webQueries = [`"${name}" ${companyGuess}`, ...anchorDomains.map((d) => `"${name}" ${d}`)];
  const webHitsRaw = await Promise.all(webQueries.map((q) => tavilySearch(q, { maxResults: 6 })));
  const webHits = webHitsRaw.flat().filter((h) => !isLinkedinProfile(h.url));
  const webSeen = new Set<string>();
  const webUnique = webHits
    .filter((h) => (webSeen.has(h.url) ? false : (webSeen.add(h.url), true)))
    .sort((a, b) => b.score - a.score);

  console.log(`\nWeb mentions (${webUnique.length} unique, non-LinkedIn):`);
  for (const h of webUnique.slice(0, 10)) {
    console.log(`  ${h.score.toFixed(3)}  ${host(h.url).padEnd(24)}  ${h.title}`);
  }

  const out = writeJson("poc-8-person.json", {
    meta: { name, email, domain, canonicalDomain, companyGuess, generatedAt: new Date().toISOString() },
    homepage,
    teamLinks,
    teamPages,
    linkedin: { candidates: liUnique, resolved: resolvedProfile },
    webMentions: webUnique,
  });
  console.log(`\nWrote ${out}`);
}

main().catch((e) => (console.error(e), process.exit(1)));
