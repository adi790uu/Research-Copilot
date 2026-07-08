import { HumanMessage } from "@langchain/core/messages";
import { logger } from "@trigger.dev/sdk/v3";
import type { CompanyContext, Source } from "@/db/schema";
import {
  type PersonReport,
  type PersonReportDraft,
  personReportSchema,
  type Pitch,
  pitchSchema,
  type ReportContent,
  type ReportDraft,
  reportContentSchema,
} from "@/graph/report-schema";
import { citedIds } from "@/graph/sources";
import type { Graph2State } from "@/graph/state";
import { createModel, isTokenLimitExceeded } from "@/llm/models";
import {
  finalReportPrompt,
  personReportPrompt,
  pitchPrompt,
  reviewReportPrompt,
  todayStr,
} from "@/prompts";

const MAX_DRAFT_ATTEMPTS = 3;
const REVIEW_FINDINGS_CHARS = 24_000;
const MIN_REVIEW_RETENTION = 0.6;

function sourcesBlock(sources: Source[]): string {
  if (sources.length === 0) return "(no sources collected)";
  return sources.map((s) => `[${s.id}] ${s.title} — ${s.url}`).join("\n");
}

function reconcileDraft(draft: ReportDraft, valid: Set<string>): ReportDraft {
  return {
    answer: draft.answer,
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

function reconcilePersonDraft(draft: PersonReportDraft, valid: Set<string>): PersonReportDraft {
  return {
    verified: draft.verified,
    headline: draft.headline,
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
  const sentences = [draft.answer, draft.summary, ...draft.sections.map((s) => s.content)]
    .flatMap((t) => t.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length > 40);
  if (sentences.length === 0) return { coverage: 1, cited: 0, total: 0 };
  const cited = sentences.filter((s) => /\[src_[0-9a-f]+\]/.test(s)).length;
  return { coverage: cited / sentences.length, cited, total: sentences.length };
}

const totalLen = (d: ReportDraft): number =>
  d.answer.length + d.summary.length + d.sections.reduce((n, s) => n + s.content.length, 0);

// --- Company report -----------------------------------------------------

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
      objective: state.objective,
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
      objective: state.objective,
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

export async function companyReportNode(state: Graph2State): Promise<Partial<Graph2State>> {
  const date = todayStr();
  const sources = state.companySources;
  const validIds = new Set(sources.map((s) => s.id));
  const findings = state.companyNotes.length ? state.companyNotes.join("\n\n") : "(no findings)";

  const drafted = await draftReport(state, sources, findings, date);
  if (drafted.draft === null) {
    return { companyReport: fallbackReport(drafted.findingsText, sources, drafted.error) };
  }
  if (drafted.draft.sections.length === 0) {
    return { companyReport: fallbackReport(drafted.findingsText, sources, "empty draft") };
  }

  let final = reconcileDraft(drafted.draft, validIds);
  logger.info("company_report_grounding_draft", groundingCoverage(final));

  final = await reviewReport(state, final, drafted.findingsText, validIds, date);
  logger.info("company_report_grounding_final", groundingCoverage(final));

  return { companyReport: { ...final, sources } };
}

function fallbackReport(findingsText: string, sources: Source[], error: string): ReportContent {
  return {
    answer: "",
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

// --- Person report ------------------------------------------------------

export async function personReportNode(state: Graph2State): Promise<Partial<Graph2State>> {
  if (!state.personName) return { personReport: null };

  const sources = state.personSources;
  const validIds = new Set(sources.map((s) => s.id));
  const findings = state.personNotes.length ? state.personNotes.join("\n\n") : "(no findings)";

  const writer = createModel({ temperature: 0.2 })
    .withStructuredOutput(personReportSchema)
    .withRetry({ stopAfterAttempt: 2 });

  try {
    const prompt = personReportPrompt({
      personName: state.personName,
      personTitle: state.personTitle,
      companyName: state.companyName,
      findings,
      sourcesBlock: sourcesBlock(sources),
      date: todayStr(),
    });
    const draft = (await writer.invoke([new HumanMessage(prompt)])) as PersonReportDraft;
    const reconciled = reconcilePersonDraft(draft, validIds);
    logger.info("person_report", { verified: reconciled.verified, sources: sources.length });
    return { personReport: { ...reconciled, sources } };
  } catch (err) {
    logger.error("person_report_failed", { error: String(err) });
    return {
      personReport: {
        verified: false,
        headline: `Could not build a profile for ${state.personName}.`,
        summary: "",
        sections: [],
        sources,
      },
    };
  }
}

// --- Pitch --------------------------------------------------------------

function companyContextIsEmpty(ctx: CompanyContext): boolean {
  return !Object.values(ctx).some((v) => (v ?? "").trim().length > 0);
}

function renderSellerContext(ctx: CompanyContext): string {
  const rows: Array<[string, string | undefined]> = [
    ["What they sell", ctx.what_you_sell],
    ["Value propositions", ctx.value_props],
    ["Ideal customer", ctx.icp],
    ["Differentiators", ctx.differentiators],
    ["Proof points", ctx.proof_points],
    ["Notes", ctx.notes],
  ];
  return rows
    .filter(([, v]) => (v ?? "").trim().length > 0)
    .map(([k, v]) => `${k}: ${(v ?? "").trim()}`)
    .join("\n");
}

function renderCompanyReport(r: ReportContent): string {
  const parts = [r.answer, r.summary, ...r.sections.map((s) => `## ${s.heading}\n${s.content}`)];
  return parts.filter((p) => p.trim().length > 0).join("\n\n");
}

function renderPersonReport(r: PersonReport | null): string {
  if (!r || !r.verified) return "No verified meeting contact.";
  const parts = [r.headline, r.summary, ...r.sections.map((s) => `## ${s.heading}\n${s.content}`)];
  return parts.filter((p) => p.trim().length > 0).join("\n\n");
}

export async function pitchNode(state: Graph2State): Promise<Partial<Graph2State>> {
  const ctx = state.companyContext;
  if (!ctx || companyContextIsEmpty(ctx)) {
    logger.info("pitch_skipped", { reason: "no seller company context" });
    return { pitch: null };
  }
  if (!state.companyReport) {
    logger.info("pitch_skipped", { reason: "no company report" });
    return { pitch: null };
  }

  const model = createModel({ temperature: 0.4 })
    .withStructuredOutput(pitchSchema)
    .withRetry({ stopAfterAttempt: 2 });

  try {
    const prompt = pitchPrompt({
      companyName: state.companyName,
      objective: state.objective,
      personName: state.personName || undefined,
      sellerContext: renderSellerContext(ctx),
      companyReport: renderCompanyReport(state.companyReport),
      personReport: renderPersonReport(state.personReport),
      date: todayStr(),
    });
    const pitch = (await model.invoke([new HumanMessage(prompt)])) as Pitch;
    logger.info("pitch_generated", { points: pitch.talking_points.length });
    return { pitch };
  } catch (err) {
    logger.error("pitch_generation_failed", { error: String(err) });
    return { pitch: null };
  }
}
