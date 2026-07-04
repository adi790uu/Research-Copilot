import { createHash } from "node:crypto";
import type { Source, SourceType } from "@/db/schema";

const CITATION_TYPES: readonly SourceType[] = [
  "company_site",
  "web",
  "linkedin",
  "twitter",
  "reddit",
  "social",
];

const MAX_BODY_CHARS = 3000;
const SOURCE_BLOCK_RE = /--- SOURCE (src_[0-9a-f]+): (.+?) ---\nURL: (\S+)\nType: (\w+)\n/g;
const CITATION_RE = /\[(src_[0-9a-f]+)\]/g;

export function sourceId(url: string): string {
  return `src_${createHash("sha1").update(url).digest("hex").slice(0, 8)}`;
}

export function normalizeSourceType(raw: string): SourceType | null {
  const type = raw.trim().toLowerCase() as SourceType;
  return CITATION_TYPES.includes(type) ? type : null;
}

export function renderSourceBlock(s: {
  url: string;
  title: string;
  type: string;
  body: string;
}): string {
  const id = sourceId(s.url);
  const title = s.title?.trim() || s.url;
  let body = (s.body ?? "").trim();
  if (body.length > MAX_BODY_CHARS) body = `${body.slice(0, MAX_BODY_CHARS)}\n[... truncated]`;
  return `--- SOURCE ${id}: ${title} ---\nURL: ${s.url}\nType: ${s.type}\n\nCONTENT:\n${body}\n\n${"-".repeat(80)}\n`;
}

export function parseSourceBlocks(text: string): Source[] {
  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const [, id, title, url, type] of text.matchAll(SOURCE_BLOCK_RE)) {
    if (seen.has(id)) continue;
    seen.add(id);
    sources.push({ id, url: url.trim(), title: title.trim(), type: normalizeSourceType(type) });
  }
  return sources;
}

export function citedIds(text: string): string[] {
  return [...new Set([...text.matchAll(CITATION_RE)].map((m) => m[1]))];
}
