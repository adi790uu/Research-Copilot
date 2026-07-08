import { index, json, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export type SourceType = "company_site" | "web" | "linkedin" | "twitter" | "reddit" | "social";

export type Source = {
  id: string;
  url: string;
  title: string;
  snippet?: string | null;
  section?: string | null;
  type?: SourceType | null;
};

export type ContactResolution = {
  status: "resolved" | "unresolved" | "skipped";
  source?: string | null;
  likelihood?: number | null;
  name?: string | null;
  title?: string | null;
  company?: string | null;
  company_website?: string | null;
  linkedin_url?: string | null;
  location?: string | null;
};

// The seller's own company profile, reused across researches to build the
// pitch. Mirrors the backend `CompanyContext`. A pitch is generated only when
// at least one field is filled in.
export type CompanyContext = {
  what_you_sell?: string;
  value_props?: string;
  icp?: string;
  differentiators?: string;
  proof_points?: string;
  notes?: string;
};

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  companyContext: json("company_context").$type<CompanyContext>(),
});

export const briefs = pgTable("briefs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  companyName: text("company_name").notNull(),
  website: text("website").notNull(),
  objective: text("objective").notNull(),
  status: text("status").notNull(),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactResolution: json("contact_resolution").$type<ContactResolution>(),
});

export const researchJobs = pgTable("research_jobs", {
  id: text("id").primaryKey(),
  briefId: text("brief_id").notNull(),
  userId: text("user_id").notNull(),
  status: text("status").notNull().default("pending"),
  researchPlan: text("research_plan"),
  // Company research (factual). Carries the research summary + sources.
  companyReport: text("company_report"),
  // Person research on the named meeting contact (null when there's no contact).
  personReport: text("person_report"),
  // Sales pitch built from company + person research and the seller's context.
  // Null when the seller has no company context.
  pitch: text("pitch"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
