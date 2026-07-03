import { HumanMessage } from "@langchain/core/messages";
import type { Source } from "@/db/schema";
import {
  type ReportContent,
  type ReportDraft,
  reportContentSchema,
} from "@/graph/report-schema";
import type { Graph2State } from "@/graph/state";
import { createModel, isTokenLimitExceeded } from "@/llm/models";
import { finalReportPrompt, reviewReportPrompt, todayStr } from "@/prompts";

// Two passes over a dynamically-structured report:
//   1. draft summary + sections (writer picks the sections)
//   2. one whole-report review to tighten prose and firm up grounding
// Hallucinated source IDs are dropped after each pass.

function sourcesBlock(sources: Source[]): string {
  if (sources.length === 0) return "(no sources collected)";
  return sources.map((s) => `[${s.id}] ${s.title} — ${s.url}`).join("\n");
}

function filterDraft(draft: ReportDraft, valid: Set<string>): ReportDraft {
  return {
    summary: draft.summary,
    sections: draft.sections.map((s) => ({
      heading: s.heading,
      content: s.content,
      source_ids: s.source_ids.filter((id) => valid.has(id)),
    })),
  };
}

const totalLen = (d: ReportDraft): number =>
  d.summary.length + d.sections.reduce((n, s) => n + s.content.length, 0);

export async function finalReportNode(state: Graph2State): Promise<Partial<Graph2State>> {
  const date = todayStr();
  const sources = state.sources;
  const validIds = new Set(sources.map((s) => s.id));
  const findings = state.notes.length ? state.notes.join("\n\n") : "(no findings)";

  // --- Pass 1: draft the report (shrink findings on overflow) ---
  const writer = createModel({ temperature: 0.3 })
    .withStructuredOutput(reportContentSchema)
    .withRetry({ stopAfterAttempt: 2 });

  let findingsText = findings;
  let draft: ReportDraft | null = null;
  for (let attempt = 0; attempt <= 3; attempt++) {
    const prompt = finalReportPrompt({
      companyName: state.companyName,
      website: state.website,
      researchBrief: state.researchBrief,
      findings: findingsText,
      sourcesBlock: sourcesBlock(sources),
      date,
    });
    try {
      draft = (await writer.invoke([new HumanMessage(prompt)])) as ReportDraft;
      break;
    } catch (err) {
      if (!isTokenLimitExceeded(err) || attempt >= 3) {
        return { report: fallbackReport(findingsText, sources, String(err)) };
      }
      findingsText =
        findingsText.slice(0, Math.floor(findingsText.length * 0.7)) || findingsText.slice(0, 5000);
    }
  }
  if (!draft || draft.sections.length === 0) {
    return { report: fallbackReport(findingsText, sources, "empty draft") };
  }
  draft = filterDraft(draft, validIds);

  // --- Pass 2: one whole-report review; keep the draft on failure/collapse ---
  const reviewer = createModel({ temperature: 0.2 })
    .withStructuredOutput(reportContentSchema)
    .withRetry({ stopAfterAttempt: 2 });

  let final = draft;
  try {
    const prompt = reviewReportPrompt({
      companyName: state.companyName,
      draft: JSON.stringify(draft),
      findings: findingsText.slice(0, 24000),
      validSourceIds: [...validIds].sort().join(", ") || "(none)",
      date,
    });
    const reviewed = filterDraft(
      (await reviewer.invoke([new HumanMessage(prompt)])) as ReportDraft,
      validIds,
    );
    // Reject a review that dropped the report's substance.
    if (reviewed.sections.length > 0 && totalLen(reviewed) >= totalLen(draft) * 0.6) {
      final = reviewed;
    }
  } catch {
    // keep draft
  }

  return { report: { ...final, sources } };
}

function fallbackReport(findingsText: string, sources: Source[], error: string): ReportContent {
  return {
    summary: `Final synthesis failed. Underlying error: ${error.slice(0, 200)}`,
    sections: [
      {
        heading: "Raw findings",
        content: `Findings were collected but the structured report could not be generated. Raw notes preview:\n\n${findingsText.slice(0, 1500)}`,
        source_ids: [],
      },
    ],
    sources,
  };
}
