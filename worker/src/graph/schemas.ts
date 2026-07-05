import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const conductResearch = tool(async () => "", {
  name: "ConductResearch",
  description:
    "Delegate one research task to a sub-agent. Provide standalone instructions naming the company and the angle.",
  schema: z.object({
    research_topic: z
      .string()
      .describe("Detailed, standalone research instructions. Name the company and what good output looks like."),
    tools_to_use: z
      .enum(["company_site", "web", "social", "person", "both"])
      .describe(
        "company_site (the company's own site) | web (external news/funding/reviews) | social (LinkedIn/X profiles + Reddit discussion & sentiment) | person (the named meeting contact specifically — only when one is named in the mandate) | both (company_site + web + social).",
      ),
  }),
});

export const researchComplete = tool(async () => "", {
  name: "ResearchComplete",
  description: "Signal that coverage is sufficient to write the final report.",
  schema: z.object({}),
});
