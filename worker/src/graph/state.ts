import type { BaseMessage } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { CompanyContext, Source } from "@/db/schema";
import type { PersonReport, Pitch, ReportContent } from "@/graph/report-schema";

type Override<T> = { type: "override"; value: T[] };

function overrideReducer<T>(current: T[], update: T[] | Override<T>): T[] {
  if (!Array.isArray(update) && update?.type === "override") return update.value;
  return current.concat(update as T[]);
}

function dedupSources(current: Source[], update: Source[] | Override<Source>): Source[] {
  const isOverride = !Array.isArray(update) && update?.type === "override";
  const base = isOverride ? [] : current;
  const incoming = isOverride ? (update as Override<Source>).value : (update as Source[]);
  const seen = new Map(base.map((s) => [s.url, s]));
  for (const s of incoming) if (!seen.has(s.url)) seen.set(s.url, s);
  return [...seen.values()];
}

const notesChannel = Annotation<string[], string[] | Override<string>>({
  reducer: overrideReducer,
  default: () => [],
});

const sourcesChannel = Annotation<Source[], Source[] | Override<Source>>({
  reducer: dedupSources,
  default: () => [],
});

const lastValueString = { reducer: (_: string, u: string) => u, default: () => "" };

export const SupervisorAnnotation = Annotation.Root({
  supervisorMessages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  companyName: Annotation<string>(lastValueString),
  website: Annotation<string>(lastValueString),
  researchBrief: Annotation<string>(lastValueString),
  notes: notesChannel,
  rawNotes: notesChannel,
  sources: sourcesChannel,
  researchIterations: Annotation<number>({ reducer: (_, u) => u, default: () => 0 }),
});
export type SupervisorState = typeof SupervisorAnnotation.State;

export const ResearcherAnnotation = Annotation.Root({
  researcherMessages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  researchTopic: Annotation<string>(lastValueString),
  toolsToUse: Annotation<string>({ reducer: (_, u) => u, default: () => "both" }),
  companyName: Annotation<string>(lastValueString),
  website: Annotation<string>(lastValueString),
  toolCallIterations: Annotation<number>({ reducer: (_, u) => u, default: () => 0 }),
  compressedResearch: Annotation<string>(lastValueString),
  rawNotes: Annotation<string[]>({ reducer: (_, u) => u, default: () => [] }),
  sources: sourcesChannel,
});
export type ResearcherState = typeof ResearcherAnnotation.State;

export const Graph2Annotation = Annotation.Root({
  companyName: Annotation<string>(lastValueString),
  website: Annotation<string>(lastValueString),
  objective: Annotation<string>(lastValueString),
  researchBrief: Annotation<string>(lastValueString),
  personName: Annotation<string>(lastValueString),
  personLinkedinUrl: Annotation<string>(lastValueString),
  personTitle: Annotation<string>(lastValueString),
  // Seller's own profile; drives whether a pitch is produced.
  companyContext: Annotation<CompanyContext | null>({ reducer: (_, u) => u, default: () => null }),

  // Company research (factual) — its own notes/sources so it stays separate
  // from the person research running in parallel.
  companyNotes: notesChannel,
  companySources: sourcesChannel,
  // Person research on the named meeting contact.
  personNotes: notesChannel,
  personSources: sourcesChannel,

  // Artifacts.
  companyReport: Annotation<ReportContent | null>({ reducer: (_, u) => u, default: () => null }),
  personReport: Annotation<PersonReport | null>({ reducer: (_, u) => u, default: () => null }),
  pitch: Annotation<Pitch | null>({ reducer: (_, u) => u, default: () => null }),
});
export type Graph2State = typeof Graph2Annotation.State;
