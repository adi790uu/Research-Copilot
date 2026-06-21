import { tool } from "@langchain/core/tools";
import { z } from "zod";

// Supervisor delegation tools. Bodies are unused — they exist as schemas to
// bind to the supervisor model; dispatch is handled in supervisorTools.

export const conductResearch = tool(async () => "", {
  name: "ConductResearch",
  description:
    "Delegate one research task to a sub-agent. Provide standalone instructions naming the company and the angle.",
  schema: z.object({
    research_topic: z
      .string()
      .describe("Detailed, standalone research instructions. Name the company and what good output looks like."),
    tools_to_use: z.enum(["company_site", "web", "both"]).describe("company_site | web | both."),
  }),
});

export const researchComplete = tool(async () => "", {
  name: "ResearchComplete",
  description: "Signal that coverage is sufficient to write the final report.",
  schema: z.object({}),
});
