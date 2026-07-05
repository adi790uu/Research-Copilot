import { HumanMessage } from "@langchain/core/messages";
import { logger } from "@trigger.dev/sdk/v3";
import type { Source } from "@/db/schema";
import {
  type ReportContent,
  type ReportDraft,
  reportContentSchema,
} from "@/graph/report-schema";
import { citedIds } from "@/graph/sources";
import type { Graph2State } from "@/graph/state";
import { createModel, isTokenLimitExceeded } from "@/llm/models";
import { finalReportPrompt, reviewReportPrompt, todayStr } from "@/prompts";

const MAX_DRAFT_ATTEMPTS = 3;
const REVIEW_FINDINGS_CHARS = 24_000;
const MIN_REVIEW_RETENTION = 0.6;

function sourcesBlock(sources: Source[]): string {
  if (sources.length === 0) return "(no sources collected)";
  return sources.map((s) => `[${s.id}] ${s.title} — ${s.url}`).join("\n");
}

function reconcileDraft(draft: ReportDraft, valid: Set<string>): ReportDraft {
  return {
    summary: draft.summary,
    sections: draft.sections.map((s) => {
      const inline = citedIds(s.content).filter((id) => valid.has(id));
      const declared = s.source_ids.filter((id) => valid.has(id));
      return {
        heading: s.heading,
        content: s.content,
        source_ids: [...new Set([...inline, ...declared])],
      };
    }),
  };
}

function groundingCoverage(draft: ReportDraft): { coverage: number; cited: number; total: number } {
  const sentences = [draft.summary, ...draft.sections.map((s) => s.content)]
    .flatMap((t) => t.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length > 40);
  if (sentences.length === 0) return { coverage: 1, cited: 0, total: 0 };
  const cited = sentences.filter((s) => /\[src_[0-9a-f]+\]/.test(s)).length;
  return { coverage: cited / sentences.length, cited, total: sentences.length };
}

const totalLen = (d: ReportDraft): number =>
  d.summary.length + d.sections.reduce((n, s) => n + s.content.length, 0);

type DraftResult =
  | { draft: ReportDraft; findingsText: string }
  | { draft: null; findingsText: string; error: string };

async function draftReport(
  state: Graph2State,
  sources: Source[],
  findings: string,
  date: string,
): Promise<DraftResult> {
  const writer = createModel({ temperature: 0.3 })
    .withStructuredOutput(reportContentSchema)
    .withRetry({ stopAfterAttempt: 2 });

  let findingsText = findings;
  for (let attempt = 0; attempt <= MAX_DRAFT_ATTEMPTS; attempt++) {
    const prompt = finalReportPrompt({
      companyName: state.companyName,
      website: state.website,
      researchBrief: state.researchBrief,
      personName: state.personName,
      findings: findingsText,
      sourcesBlock: sourcesBlock(sources),
      date,
    });
    try {
      const draft = (await writer.invoke([new HumanMessage(prompt)])) as ReportDraft;
      return { draft, findingsText };
    } catch (err) {
      if (!isTokenLimitExceeded(err) || attempt >= MAX_DRAFT_ATTEMPTS) {
        return { draft: null, findingsText, error: String(err) };
      }
      findingsText =
        findingsText.slice(0, Math.floor(findingsText.length * 0.7)) || findingsText.slice(0, 5000);
    }
  }
  return { draft: null, findingsText, error: "draft attempts exhausted" };
}

async function reviewReport(
  state: Graph2State,
  draft: ReportDraft,
  findingsText: string,
  validIds: Set<string>,
  date: string,
): Promise<ReportDraft> {
  const reviewer = createModel({ temperature: 0.2 })
    .withStructuredOutput(reportContentSchema)
    .withRetry({ stopAfterAttempt: 2 });

  try {
    const prompt = reviewReportPrompt({
      companyName: state.companyName,
      personName: state.personName,
      draft: JSON.stringify(draft),
      findings: findingsText.slice(0, REVIEW_FINDINGS_CHARS),
      validSourceIds: [...validIds].sort().join(", ") || "(none)",
      date,
    });
    const reviewed = reconcileDraft(
      (await reviewer.invoke([new HumanMessage(prompt)])) as ReportDraft,
      validIds,
    );
    if (reviewed.sections.length > 0 && totalLen(reviewed) >= totalLen(draft) * MIN_REVIEW_RETENTION) {
      return reviewed;
    }
  } catch {}
  return draft;
}

export async function finalReportNode(state: Graph2State): Promise<Partial<Graph2State>> {
  const date = todayStr();
  const sources = state.sources;
  const validIds = new Set(sources.map((s) => s.id));
  const findings = state.notes.length ? state.notes.join("\n\n") : "(no findings)";

  const drafted = await draftReport(state, sources, findings, date);
  if (drafted.draft === null) {
    return { report: fallbackReport(drafted.findingsText, sources, drafted.error) };
  }
  if (drafted.draft.sections.length === 0) {
    return { report: fallbackReport(drafted.findingsText, sources, "empty draft") };
  }

  let final = reconcileDraft(drafted.draft, validIds);
  logger.info("report_grounding_draft", groundingCoverage(final));

  final = await reviewReport(state, final, drafted.findingsText, validIds, date);
  logger.info("report_grounding_final", groundingCoverage(final));

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
