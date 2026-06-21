import type { BaseMessage } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { Source } from "@/db/schema";
import type { ReportContent } from "@/graph/report-schema";

// Mirror of app/workflow/state.py's override_reducer: an update tagged
// {type:"override"} replaces the channel; anything else is appended.
type Override<T> = { type: "override"; value: T[] };

function overrideReducer<T>(current: T[], update: T[] | Override<T>): T[] {
  if (!Array.isArray(update) && update?.type === "override") return update.value;
  return current.concat(update as T[]);
}

// Sources dedupe by URL (matches _dedup_sources). Stable Source ids (sha1 of
// URL) mean the same page from two researchers collapses to one entry.
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

/** Supervisor subgraph state. */
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

/** Individual researcher subgraph state. */
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

/** Top-level Graph 2 state. */
export const Graph2Annotation = Annotation.Root({
  companyName: Annotation<string>(lastValueString),
  website: Annotation<string>(lastValueString),
  objective: Annotation<string>(lastValueString),
  researchBrief: Annotation<string>(lastValueString),
  notes: notesChannel,
  rawNotes: notesChannel,
  sources: sourcesChannel,
  report: Annotation<ReportContent | null>({ reducer: (_, u) => u, default: () => null }),
});
export type Graph2State = typeof Graph2Annotation.State;
