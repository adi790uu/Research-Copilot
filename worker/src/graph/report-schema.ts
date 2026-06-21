import { z } from "zod";
import type { Source } from "@/db/schema";

// The 8 fixed report sections — must stay in sync with app/domain/report.py
// (ReportContent) so the JSON the worker writes deserializes on the Python side.
export const REPORT_SECTIONS = [
  "company_overview",
  "products_and_services",
  "target_customers",
  "business_signals",
  "risks_and_challenges",
  "discovery_questions",
  "outreach_strategy",
  "unknowns",
] as const;

export type ReportSectionName = (typeof REPORT_SECTIONS)[number];

const SECTION_BLURBS: Record<ReportSectionName, string> = {
  company_overview: "What the company does, founding, size, geography, leadership.",
  products_and_services: "Concrete offerings: products, plans, services, integrations.",
  target_customers: "Who they sell to: ICP, segments, named customers, case studies.",
  business_signals: "Funding, revenue, hiring, expansion, partnerships, press traction.",
  risks_and_challenges: "Competitive pressure, regulatory issues, churn risks, public criticisms.",
  discovery_questions: "Open questions a sales rep should ask to qualify or expand.",
  outreach_strategy: "Concrete angles, hooks, and channels for first-touch outreach.",
  unknowns: "Things we could not find evidence for; explicit gaps in the research.",
};

export function sectionCatalog(): string {
  return REPORT_SECTIONS.map((n) => `- ${n}: ${SECTION_BLURBS[n]}`).join("\n");
}

const sectionSchema = z.object({
  content: z.string(),
  source_ids: z.array(z.string()).default([]),
});

/** Pass-1 structured output: the 8 sections. `sources` is added by the node. */
export const reportContentSchema = z.object({
  company_overview: sectionSchema,
  products_and_services: sectionSchema,
  target_customers: sectionSchema,
  business_signals: sectionSchema,
  risks_and_challenges: sectionSchema,
  discovery_questions: sectionSchema,
  outreach_strategy: sectionSchema,
  unknowns: sectionSchema,
});

/** Pass-2 per-section review output. */
export const polishedSectionSchema = sectionSchema;

export type ReportSection = z.infer<typeof sectionSchema>;
export type ReportContent = z.infer<typeof reportContentSchema> & { sources: Source[] };
