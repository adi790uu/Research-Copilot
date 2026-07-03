import { z } from "zod";
import type { Source } from "@/db/schema";

// The report is dynamically structured: the writer chooses the sections that
// best satisfy the research goal instead of filling a fixed template. Must stay
// in sync with app/domain/report.py (ReportContent) so the JSON the worker
// writes deserializes on the Python side.

const sectionSchema = z.object({
  heading: z.string().describe("Short section title, e.g. 'Products & pricing'."),
  content: z.string(),
  source_ids: z.array(z.string()).default([]),
});

export const reportContentSchema = z.object({
  summary: z.string().default("").describe("Executive summary of the whole brief."),
  sections: z.array(sectionSchema).min(1).describe("Sections chosen to best satisfy the research goal."),
});

export type ReportSection = z.infer<typeof sectionSchema>;
export type ReportDraft = z.infer<typeof reportContentSchema>;
export type ReportContent = ReportDraft & { sources: Source[] };
