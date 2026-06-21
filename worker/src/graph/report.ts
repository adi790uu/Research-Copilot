import { HumanMessage } from "@langchain/core/messages";
import type { Source } from "@/db/schema";
import {
  REPORT_SECTIONS,
  type ReportContent,
  type ReportSection,
  type ReportSectionName,
  polishedSectionSchema,
  reportContentSchema,
  sectionCatalog,
} from "@/graph/report-schema";
import type { Graph2State } from "@/graph/state";
import { createModel, isTokenLimitExceeded } from "@/llm/models";
import { finalReportPrompt, reviewAndStitchPrompt, todayStr } from "@/prompts";

// Ported from app/workflow/nodes/final_report.py.
// Pass 1: structured ReportContent (8 sections). Pass 2: per-section review.

function sourcesBlock(sources: Source[]): string {
  if (sources.length === 0) return "(no sources collected)";
  return sources.map((s) => `[${s.id}] ${s.title} — ${s.url}`).join("\n");
}

function filterSourceIds(section: ReportSection, valid: Set<string>): ReportSection {
  return { content: section.content, source_ids: section.source_ids.filter((id) => valid.has(id)) };
}

export async function finalReportNode(state: Graph2State): Promise<Partial<Graph2State>> {
  const date = todayStr();
  const sources = state.sources;
  const validIds = new Set(sources.map((s) => s.id));
  const findings = state.notes.length ? state.notes.join("\n\n") : "(no findings)";

  // --- Pass 1: structured draft of all 8 sections (shrink findings on overflow) ---
  const writer = createModel({ temperature: 0.2 })
    .withStructuredOutput(reportContentSchema)
    .withRetry({ stopAfterAttempt: 2 });

  let findingsText = findings;
  let draft: Record<ReportSectionName, ReportSection> | null = null;
  for (let attempt = 0; attempt <= 3; attempt++) {
    const prompt = finalReportPrompt({
      companyName: state.companyName,
      website: state.website,
      researchBrief: state.researchBrief,
      findings: findingsText,
      sourcesBlock: sourcesBlock(sources),
      sectionCatalog: sectionCatalog(),
      date,
    });
    try {
      draft = (await writer.invoke([new HumanMessage(prompt)])) as Record<ReportSectionName, ReportSection>;
      break;
    } catch (err) {
      if (!isTokenLimitExceeded(err) || attempt >= 3) {
        return { report: fallbackReport(findingsText, sources, String(err)) };
      }
      findingsText = findingsText.slice(0, Math.floor(findingsText.length * 0.7)) || findingsText.slice(0, 5000);
    }
  }
  if (!draft) return { report: fallbackReport(findingsText, sources, "empty draft") };

  // Drop hallucinated source IDs.
  const filtered = {} as Record<ReportSectionName, ReportSection>;
  for (const name of REPORT_SECTIONS) filtered[name] = filterSourceIds(draft[name], validIds);

  // --- Pass 2: per-section review/polish (keep draft on failure) ---
  const reviewer = createModel({ temperature: 0.2 })
    .withStructuredOutput(polishedSectionSchema)
    .withRetry({ stopAfterAttempt: 2 });

  const polished = await Promise.all(
    REPORT_SECTIONS.map(async (name): Promise<[ReportSectionName, ReportSection]> => {
      const section = filtered[name];
      if (!section.content.trim()) return [name, section];
      const prompt = reviewAndStitchPrompt({
        companyName: state.companyName,
        section: name,
        draftContent: section.content,
        findings: findingsText.slice(0, 6000),
        validSourceIds: [...validIds].sort().join(", ") || "(none)",
        date,
      });
      try {
        const res = (await reviewer.invoke([new HumanMessage(prompt)])) as ReportSection;
        return [name, filterSourceIds(res, validIds)];
      } catch {
        return [name, section];
      }
    }),
  );

  const report = {
    ...(Object.fromEntries(polished) as Record<ReportSectionName, ReportSection>),
    sources,
  } as ReportContent;
  return { report };
}

function fallbackReport(findingsText: string, sources: Source[], error: string): ReportContent {
  const placeholder: ReportSection = {
    content: `Report generation failed to produce structured output. Underlying error: ${error.slice(0, 200)}`,
    source_ids: [],
  };
  const sections = {} as Record<ReportSectionName, ReportSection>;
  for (const name of REPORT_SECTIONS) sections[name] = placeholder;
  sections.company_overview = {
    content: `Findings collected but final synthesis failed. Raw notes preview:\n\n${findingsText.slice(0, 1500)}`,
    source_ids: [],
  };
  sections.unknowns = {
    content: "Final report generation failed; see other sections for raw notes.",
    source_ids: [],
  };
  return { ...sections, sources };
}
