import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  briefs,
  researchJobEvents,
  researchJobResearchers,
  researchJobs,
  researchTasks,
  type Source,
} from "@/db/schema";

// Mirrors app/services/job_store.py. The Python approve endpoint creates the
// job row before triggering the worker; the worker reads brief context and
// writes progress/results back to the same tables.

export type BriefContext = {
  companyName: string;
  website: string;
  objective: string;
  userId: string;
};

export async function getBrief(briefId: string): Promise<BriefContext | null> {
  const [row] = await db
    .select({
      companyName: briefs.companyName,
      website: briefs.website,
      objective: briefs.objective,
      userId: briefs.userId,
    })
    .from(briefs)
    .where(eq(briefs.id, briefId))
    .limit(1);
  return row ?? null;
}

export async function updateJobStatus(jobId: string, status: string): Promise<void> {
  await db
    .update(researchJobs)
    .set({ status, updatedAt: sql`now()` })
    .where(eq(researchJobs.id, jobId));
}

/** `finalReport` is the JSON-encoded ReportContent. */
export async function updateJobResult(
  jobId: string,
  finalReport: string,
  sources: Source[],
): Promise<void> {
  await db
    .update(researchJobs)
    .set({ status: "completed", finalReport, sources, updatedAt: sql`now()` })
    .where(eq(researchJobs.id, jobId));
}

/** Append a stage marker to the job's event log (e.g. research/report start),
 * so the UI can show an accurate, reload-safe status without inferring it. */
export async function appendJobEvent(
  jobId: string,
  eventType: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  await db
    .insert(researchJobEvents)
    .values({ jobId, eventType, data, createdAt: sql`now()` });
}

export async function appendResearcherResult(
  jobId: string,
  topic: string,
  summary: string,
  sources: Source[],
): Promise<void> {
  // These tables set timestamps app-side (SQLAlchemy default=_utcnow), so there
  // is no DB default — we must supply created_at/updated_at explicitly.
  await db
    .insert(researchJobResearchers)
    .values({ jobId, topic, summary, sources, createdAt: sql`now()` });
}

/** One row per ConductResearch dispatch; returns the generated task id. */
export async function createTask(jobId: string, researchTopic: string): Promise<string> {
  const id = randomUUID();
  await db.insert(researchTasks).values({
    id,
    jobId,
    title: researchTopic.slice(0, 200),
    description: researchTopic,
    status: "running",
    createdAt: sql`now()`,
    updatedAt: sql`now()`,
  });
  return id;
}

export async function completeTask(taskId: string): Promise<void> {
  await db
    .update(researchTasks)
    .set({ status: "completed", updatedAt: sql`now()` })
    .where(eq(researchTasks.id, taskId));
}

export async function failTask(taskId: string): Promise<void> {
  await db
    .update(researchTasks)
    .set({ status: "failed", updatedAt: sql`now()` })
    .where(eq(researchTasks.id, taskId));
}
