import type {
  ResearchJob,
  ResearchJobEvent,
  ResearcherResult,
  ResearchTask,
  Source,
} from "./types";

/**
 * Phase-2 research status, derived purely from polled state so it's identical
 * whether the run is live or restored after a reload. Both the chat thinking
 * bubble and the artifact panel render from this single source of truth.
 */

export type ResearchStage =
  | "idle"
  | "researching"
  | "writing_report"
  | "done"
  | "failed";

export type AngleState = "running" | "done" | "failed";

/** One investigation the supervisor dispatched: a research task merged with
 * its result (sources + summary) once the researcher reports back. */
export interface ResearchAngle {
  topic: string;
  state: AngleState;
  summary: string | null;
  sources: Source[];
}

export interface ResearchStatus {
  stage: ResearchStage;
  angles: ResearchAngle[];
  anglesDone: number;
  anglesTotal: number;
  sources: Source[];
}

interface Input {
  job: ResearchJob | null;
  tasks: ResearchTask[];
  researchers: ResearcherResult[];
  events: ResearchJobEvent[];
}

export function deriveResearchStatus({
  job,
  tasks,
  researchers,
  events,
}: Input): ResearchStatus {
  const angles = mergeAngles(tasks, researchers);
  const sources = researchers.length
    ? researchers.flatMap((r) => r.sources ?? [])
    : job?.sources ?? [];

  return {
    stage: deriveStage(job, tasks, events),
    angles,
    anglesDone: angles.filter((a) => a.state !== "running").length,
    anglesTotal: angles.length,
    sources,
  };
}

function deriveStage(
  job: ResearchJob | null,
  tasks: ResearchTask[],
  events: ResearchJobEvent[]
): ResearchStage {
  if (!job) return "idle";
  if (job.status === "failed") return "failed";
  if (job.status === "completed" || job.final_report) return "done";

  // The worker marks report writing explicitly; if those events haven't landed
  // (older worker build) fall back to "all dispatched angles finished".
  const reportStarted =
    events.some((e) => e.event_type === "report_started") ||
    (tasks.length > 0 && tasks.every((t) => t.status !== "running"));
  return reportStarted ? "writing_report" : "researching";
}

/** The task list is the authoritative set of angles (it carries status); each
 * is enriched with its researcher result when available. Before any task rows
 * exist we fall back to completed researcher rows so reloads still show work. */
function mergeAngles(
  tasks: ResearchTask[],
  researchers: ResearcherResult[]
): ResearchAngle[] {
  if (tasks.length === 0) {
    return researchers.map((r) => ({
      topic: r.topic,
      state: "done",
      summary: r.summary || null,
      sources: r.sources ?? [],
    }));
  }

  const unclaimed = [...researchers];
  return tasks.map((t) => {
    const i = unclaimed.findIndex(
      (r) => r.topic === t.description || r.topic === t.title
    );
    const result = i >= 0 ? unclaimed.splice(i, 1)[0] : null;
    return {
      topic: t.description || t.title,
      state: t.status === "completed" ? "done" : t.status,
      summary: result?.summary || null,
      sources: result?.sources ?? [],
    };
  });
}
