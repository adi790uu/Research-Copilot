import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  briefs,
  type CompanyContext,
  type ContactResolution,
  researchJobs,
  researchTasks,
  users,
} from "@/db/schema";

export type BriefContext = {
  companyName: string;
  website: string;
  objective: string;
  userId: string;
  contactName: string | null;
  contactEmail: string | null;
  contactResolution: ContactResolution | null;
  // The brief owner's own company profile, used to build the pitch.
  companyContext: CompanyContext | null;
};

export async function getBrief(briefId: string): Promise<BriefContext | null> {
  const [row] = await db
    .select({
      companyName: briefs.companyName,
      website: briefs.website,
      objective: briefs.objective,
      userId: briefs.userId,
      contactName: briefs.contactName,
      contactEmail: briefs.contactEmail,
      contactResolution: briefs.contactResolution,
      companyContext: users.companyContext,
    })
    .from(briefs)
    .leftJoin(users, eq(users.id, briefs.userId))
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

// Keep the brief's status in step with its latest job so the Researches list
// reflects completion/failure without loading the job.
export async function updateBriefStatus(briefId: string, status: string): Promise<void> {
  await db.update(briefs).set({ status }).where(eq(briefs.id, briefId));
}

export async function updateJobResult(
  jobId: string,
  artifacts: {
    companyReport: string;
    personReport: string | null;
    pitch: string | null;
  },
): Promise<void> {
  await db
    .update(researchJobs)
    .set({
      status: "completed",
      companyReport: artifacts.companyReport,
      personReport: artifacts.personReport,
      pitch: artifacts.pitch,
      updatedAt: sql`now()`,
    })
    .where(eq(researchJobs.id, jobId));
}

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
