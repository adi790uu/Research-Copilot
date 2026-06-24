import { bigserial, index, json, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Tables owned by the Python service's migrations. Mirrored here for typed
// reads/writes only — never generate/push migrations from this file.

export type SourceType = "company_site" | "web";

export type Source = {
  id: string;
  url: string;
  title: string;
  snippet?: string | null;
  section?: string | null;
  type?: SourceType | null;
};

// Read-only: the worker pulls company context from the brief row.
export const briefs = pgTable("briefs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  companyName: text("company_name").notNull(),
  website: text("website").notNull(),
  objective: text("objective").notNull(),
  status: text("status").notNull(),
});

export const researchJobs = pgTable("research_jobs", {
  id: text("id").primaryKey(),
  briefId: text("brief_id").notNull(),
  userId: text("user_id").notNull(),
  status: text("status").notNull().default("pending"),
  researchPlan: text("research_plan"),
  // final_report holds the JSON-encoded ReportContent (8 sections + sources).
  finalReport: text("final_report"),
  sources: json("sources").$type<Source[]>(),
  reportPdfKey: text("report_pdf_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const researchJobEvents = pgTable(
  "research_job_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => researchJobs.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    data: json("data").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_research_job_events_job_id").on(t.jobId)],
);

export const researchJobResearchers = pgTable(
  "research_job_researchers",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => researchJobs.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    summary: text("summary"),
    sources: json("sources").$type<Source[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_research_job_researchers_job_id").on(t.jobId)],
);

export const researchTasks = pgTable(
  "research_tasks",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => researchJobs.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    status: text("status").notNull().default("running"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_research_tasks_job_id").on(t.jobId, t.createdAt)],
);
