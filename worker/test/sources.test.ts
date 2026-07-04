import assert from "node:assert/strict";
import { test } from "node:test";
import {
  citedIds,
  normalizeSourceType,
  parseSourceBlocks,
  renderSourceBlock,
  sourceId,
} from "../src/graph/sources.ts";

test("sourceId is deterministic and well-formed", () => {
  const id = sourceId("https://acme.com/about");
  assert.match(id, /^src_[0-9a-f]{8}$/);
  assert.equal(id, sourceId("https://acme.com/about")); // stable across calls
  assert.notEqual(id, sourceId("https://acme.com/pricing")); // url-sensitive
});

test("normalizeSourceType accepts known types (case/space-insensitive), rejects others", () => {
  assert.equal(normalizeSourceType("company_site"), "company_site");
  assert.equal(normalizeSourceType("LinkedIn"), "linkedin");
  assert.equal(normalizeSourceType("  web "), "web");
  assert.equal(normalizeSourceType("reddit"), "reddit");
  assert.equal(normalizeSourceType("mystery"), null);
});

test("renderSourceBlock -> parseSourceBlocks round-trips id, url, title, type", () => {
  const url = "https://acme.com/about";
  const block = renderSourceBlock({ url, title: "Acme — About", type: "company_site", body: "hello ".repeat(20) });

  // Header carries the stable citation id (not a positional index).
  assert.ok(block.startsWith(`--- SOURCE ${sourceId(url)}: Acme — About ---`));

  const [parsed] = parseSourceBlocks(block);
  assert.equal(parsed.id, sourceId(url));
  assert.equal(parsed.url, url);
  assert.equal(parsed.title, "Acme — About");
  assert.equal(parsed.type, "company_site");
});

test("parseSourceBlocks dedups by id and maps unknown types to null", () => {
  const url = "https://acme.com";
  const first = renderSourceBlock({ url, title: "A", type: "web", body: "x".repeat(50) });
  const dupe = renderSourceBlock({ url, title: "A (again)", type: "web", body: "y".repeat(50) });
  const other = renderSourceBlock({ url: "https://other.com", title: "O", type: "mystery", body: "z".repeat(50) });

  const parsed = parseSourceBlocks(first + dupe + other);
  assert.equal(parsed.length, 2); // same id collapses to one
  assert.equal(parsed.find((s) => s.url === "https://other.com")?.type, null);
});

test("renderSourceBlock truncates over-long bodies", () => {
  const block = renderSourceBlock({ url: "https://a.com", title: "T", type: "web", body: "a".repeat(5000) });
  assert.ok(block.includes("[... truncated]"));
});

test("citedIds returns distinct citation ids and ignores non-citations", () => {
  const text = "Foo [src_ab12cd34] bar [src_ef567890] baz [src_ab12cd34]. Not [srcx] nor [1] nor [src_ZZZZ].";
  assert.deepEqual(citedIds(text), ["src_ab12cd34", "src_ef567890"]);
});

test("end-to-end: the id a tool stamps is the id findings cite is the id we reconcile", () => {
  // 1. A tool renders SOURCE blocks for two pages.
  const urls = ["https://acme.com/pricing", "https://news.com/acme-raises"];
  const toolOutput = urls
    .map((url, i) => renderSourceBlock({ url, title: `Page ${i}`, type: "web", body: "content ".repeat(40) }))
    .join("\n");

  // 2. The researcher parses them back into typed sources.
  const sources = parseSourceBlocks(toolOutput);
  const validIds = new Set(sources.map((s) => s.id));

  // 3. A downstream writer cites those exact ids inline.
  const [idA, idB] = sources.map((s) => s.id);
  const sectionContent = `Acme charges per seat [${idA}]. It raised a Series A [${idB}]. Vague claim with no support.`;

  // 4. Reconciliation keeps only cited-and-valid ids (mirrors report.ts).
  const reconciled = citedIds(sectionContent).filter((id) => validIds.has(id));

  assert.deepEqual(reconciled.sort(), [idA, idB].sort());
  assert.equal(citedIds(sectionContent).every((id) => validIds.has(id)), true); // no invented ids
});
