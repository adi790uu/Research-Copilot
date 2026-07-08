import { z } from "zod";
import type { Source } from "@/db/schema";

const sectionSchema = z.object({
  heading: z.string().describe("Short section title, e.g. 'Products & pricing'."),
  content: z.string(),
  source_ids: z.array(z.string()).default([]),
});

export const reportContentSchema = z.object({
  answer: z
    .string()
    .default("")
    .describe(
      "A direct, punchy answer (2-4 sentences) to the user's stated objective — the single most important payoff of the brief. Grounded and cited like everything else.",
    ),
  summary: z.string().default("").describe("Executive summary of the whole brief."),
  sections: z.array(sectionSchema).min(1).describe("Sections chosen to best satisfy the research goal."),
});

export type ReportSection = z.infer<typeof sectionSchema>;
export type ReportDraft = z.infer<typeof reportContentSchema>;
export type ReportContent = ReportDraft & { sources: Source[] };

// --- Person report ------------------------------------------------------
// The named meeting contact. Identity is gated upstream (person_search only
// surfaces a profile it can tie to the target company), so `verified` reflects
// whether the findings actually pinned this person down.
export const personReportSchema = z.object({
  verified: z
    .boolean()
    .default(false)
    .describe(
      "True ONLY if <findings> confidently tie a profile to this named person at the target company. If the findings say the person could not be verified, set false.",
    ),
  headline: z
    .string()
    .default("")
    .describe("One line: who they are and their role, e.g. 'VP of Sales at Acme, ex-Stripe'."),
  summary: z
    .string()
    .default("")
    .describe("Short grounded summary of the person — background and likely priorities. Empty if unverified."),
  sections: z
    .array(sectionSchema)
    .default([])
    .describe("Optional deeper sections (background, recent activity, priorities). Empty if unverified."),
});

export type PersonReportDraft = z.infer<typeof personReportSchema>;
export type PersonReport = PersonReportDraft & { sources: Source[] };

// --- Pitch --------------------------------------------------------------
// Built from the company + person research and the seller's own company
// context. Generated only when the seller has provided company context.
const talkingPointSchema = z.object({
  point: z.string().describe("A specific, tailored talking point for this account."),
  rationale: z
    .string()
    .default("")
    .describe("Why it lands — the research signal or the person's priority it maps to."),
});

const objectionSchema = z.object({
  objection: z.string().describe("A likely objection this buyer raises."),
  response: z.string().describe("A grounded, specific response using the seller's differentiators/proof."),
});

export const pitchSchema = z.object({
  headline: z
    .string()
    .describe("One-sentence hook tailored to this account — the angle to open with."),
  why_now: z
    .string()
    .default("")
    .describe("The timing/trigger from the research that makes this relevant now."),
  talking_points: z
    .array(talkingPointSchema)
    .default([])
    .describe("3-5 tailored points mapping the seller's value to this prospect's situation."),
  opening_message: z
    .string()
    .default("")
    .describe("A ready-to-send outreach opener (a few sentences), specific to this account."),
  objections: z
    .array(objectionSchema)
    .default([])
    .describe("Anticipated objections and grounded responses."),
});

export type Pitch = z.infer<typeof pitchSchema>;
