import { tool } from "@langchain/core/tools";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { z } from "zod";
import { renderSourceBlock } from "@/graph/sources";
import { tavilyExtract, tavilySearch } from "@/tools/tavily";

type Configurable = {
  personName?: string;
  personLinkedinUrl?: string;
  companyName?: string;
  website?: string;
};

function configValue(config: LangGraphRunnableConfig, key: keyof Configurable): string {
  return (config.configurable as Configurable | undefined)?.[key] ?? "";
}

function host(url: string): string {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    return "";
  }
}

const LINKEDIN_PROFILE_RE = /linkedin\.com\/in\/[^/?#\s"'<>]+/i;
function isLinkedinProfile(url: string): boolean {
  return LINKEDIN_PROFILE_RE.test(url);
}

function mentionsCompany(text: string, companyName: string, domain: string): boolean {
  const t = text.toLowerCase();
  return (domain !== "" && t.includes(domain)) || (companyName !== "" && t.includes(companyName.toLowerCase()));
}

/**
 * Person-level enrichment. If a LinkedIn URL was already verified upstream
 * (People Data Labs resolved it against the meeting contact's email/name +
 * company), that URL is trusted directly — no name-collision risk, since PDL
 * already disambiguated it. Otherwise this falls back to an anchored search
 * with a hard confidence gate: a candidate is only surfaced if the extracted
 * profile itself mentions the target company. Common names collide constantly
 * (see worker/scripts/poc-8-person.ts) — a namesake must never be reported as
 * this person.
 */
export const personSearch = tool(
  async ({ queries }, config: LangGraphRunnableConfig) => {
    const personName = configValue(config, "personName");
    if (!personName) return "Error: person_search is not configured (missing person name).";
    const companyName = configValue(config, "companyName");
    const website = configValue(config, "website");
    const domain = host(website);
    const verifiedUrl = configValue(config, "personLinkedinUrl");

    if (verifiedUrl) {
      const [page] = await tavilyExtract([verifiedUrl]).catch(() => []);
      if (page?.content) {
        return renderSourceBlock({
          url: verifiedUrl,
          title: page.title ?? personName,
          type: "linkedin",
          body: page.content,
        });
      }
      // Verified URL failed to extract — fall through to the search path below
      // rather than reporting nothing.
    }

    const anchored = queries.map((q) => `${personName} ${companyName} ${q.trim()}`).filter((q) => q.trim());
    const liHits = await Promise.all(
      anchored.map((q) => tavilySearch(q, { includeDomains: ["linkedin.com"], maxResults: 5 }).catch(() => [])),
    );
    const candidates = liHits
      .flat()
      .filter((h) => isLinkedinProfile(h.url))
      .sort((a, b) => b.score - a.score);

    for (const candidate of candidates.slice(0, 3)) {
      const [page] = await tavilyExtract([candidate.url]).catch(() => []);
      if (!page?.content) continue;
      if (!mentionsCompany(page.content, companyName, domain)) continue; // confidence gate
      return renderSourceBlock({
        url: candidate.url,
        title: page.title ?? personName,
        type: "linkedin",
        body: page.content,
      });
    }

    // No LinkedIn candidate passed the company-mention gate. Fall back to
    // general web mentions (interviews, articles, press) with the same gate,
    // so a same-named public figure elsewhere is never attributed here.
    const webHits = await Promise.all(
      anchored.map((q) => tavilySearch(q, { maxResults: 5, includeRawContent: "markdown" }).catch(() => [])),
    );
    const webBlocks: string[] = [];
    const seen = new Set<string>();
    for (const r of webHits.flat().sort((a, b) => b.score - a.score)) {
      if (isLinkedinProfile(r.url) || seen.has(r.url)) continue;
      const body = r.content ?? r.snippet;
      if (!mentionsCompany(`${r.title} ${body}`, companyName, domain)) continue;
      seen.add(r.url);
      webBlocks.push(renderSourceBlock({ url: r.url, title: r.title, type: "web", body }));
      if (webBlocks.length >= 3) break;
    }

    if (webBlocks.length > 0) return webBlocks.join("");

    return (
      `Could not confidently verify ${personName}'s identity against ${companyName || "the target company"}. ` +
      "Public search only returned unrelated namesakes or no results. Report this explicitly as " +
      "unverified rather than attributing any bio, title, or background to this person."
    );
  },
  {
    name: "person_search",
    description:
      "Research the specific named meeting contact (not the company in general): their role, background, and public activity. Every result is checked against the target company before being reported — an unrelated namesake is never returned as a match.",
    schema: z.object({
      queries: z.array(z.string()).describe("1-3 short angles about this person, e.g. 'background', 'recent posts', 'role and responsibilities'. The person's name and company are prepended automatically."),
    }),
  },
);
