import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const thinkTool = tool(
  async ({ reflection }) => `Reflection recorded: ${reflection}`,
  {
    name: "think_tool",
    description: "Reflect on findings and plan next search queries.",
    schema: z.object({
      reflection: z.string().describe("Analysis of findings, gaps, and next steps."),
    }),
  },
);
