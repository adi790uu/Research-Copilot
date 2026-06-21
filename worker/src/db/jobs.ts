import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  researchJobResearchers,
  researchJobs,
  researchTasks,
  sessions,
  type Source,
} from "@/db/schema";

// Mirrors app/services/job_store.py. The Python approve endpoint creates the
// job row before triggering the worker; the worker reads session context and
// writes progress/results back to the same tables.

export type SessionContext = {
  companyName: string;
  website: string;
  objective: string;
  userId: string;
};

export async function getSession(sessionId: string): Promise<SessionContext | null> {
  const [row] = await db
    .select({
      companyName: sessions.companyName,
      website: sessions.website,
      objective: sessions.objective,
      userId: sessions.userId,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
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
