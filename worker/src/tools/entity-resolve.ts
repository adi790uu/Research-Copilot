import { tavilySearch } from "@/tools/tavily";

export type VerifiedProfiles = {
  linkedin: string | null;
  twitter: string | null;
};

type Platform = "linkedin" | "twitter";

const JUNK = /\/(share|sharer|shareArticle|intent|home|search|hashtag|login|signup)\b/i;
const RESERVED_X = new Set(["intent", "share", "home", "search", "i", "hashtag", "login", "explore"]);
const PROFILE_RE = /https?:\/\/(?:[a-z0-9-]+\.)*(?:linkedin\.com|twitter\.com|x\.com)\/[^\s"'<>\\)]+/gi;

function host(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isProfile(url: string, platform: Platform): boolean {
  if (JUNK.test(url)) return false;
  try {
    const seg = new URL(url).pathname.replace(/^\/+/, "").split("/");
    if (platform === "linkedin") return seg[0]?.toLowerCase() === "company" && !!seg[1];
    if (platform === "twitter") return !!seg[0] && !RESERVED_X.has(seg[0].toLowerCase());
    return false;
  } catch {
    return false;
  }
}

function normalizeSite(website: string): string {
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

async function fetchHomepage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (research-copilot)" },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

function discover(html: string): { linkedin: string[]; twitter: string[] } {
  const linkedin = new Set<string>();
  const twitter = new Set<string>();
  for (const raw of html.match(PROFILE_RE) ?? []) {
    const url = raw.replace(/[.,);]+$/, "");
    const h = host(url);
    if (h.includes("linkedin") && isProfile(url, "linkedin")) linkedin.add(url);
    else if ((h.includes("x.com") || h.includes("twitter")) && isProfile(url, "twitter")) twitter.add(url);
  }
  return { linkedin: [...linkedin], twitter: [...twitter] };
}

async function searchFallback(companyName: string, domains: string[], platform: Platform): Promise<string | null> {
  const hits = await tavilySearch(companyName, { includeDomains: domains, maxResults: 6 }).catch(() => []);
  const profiles = hits.filter((h) => isProfile(h.url, platform)).sort((a, b) => b.score - a.score);
  return profiles[0]?.url ?? null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&amp;|&#38;/gi, "&")
    .replace(/&nbsp;/gi, " ");
}

export async function resolveDescriptor(website: string): Promise<string> {
  const html = website ? await fetchHomepage(normalizeSite(website)) : null;
  if (!html) return "";
  const raw =
    html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ??
    "";
  return decodeEntities(raw)
    .replace(/\s+/g, " ")
    .split(/[.|•·—–\-:]/)[0]
    .trim()
    .split(/\s+/)
    .slice(0, 12)
    .join(" ");
}

export async function resolveProfiles(website: string, companyName: string): Promise<VerifiedProfiles> {
  const html = website ? await fetchHomepage(normalizeSite(website)) : null;
  const found = html ? discover(html) : { linkedin: [], twitter: [] };
  const linkedin = found.linkedin[0] ?? (await searchFallback(companyName, ["linkedin.com"], "linkedin"));
  const twitter = found.twitter[0] ?? (await searchFallback(companyName, ["x.com", "twitter.com"], "twitter"));
  return { linkedin, twitter };
}
