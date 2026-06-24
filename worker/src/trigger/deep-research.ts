import { logger, schemaTask } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { getBrief, updateJobResult, updateJobStatus } from "@/db/jobs";
import { graph2 } from "@/graph";

const payloadSchema = z.object({
  jobId: z.string(),
  briefId: z.string(),
  userId: z.string(),
  researchPlan: z.string().min(1),
});

const subtopicSchema = z.object({
  title: z.string(),
  description: z.string().default(""),
  tools: z.string().default("both"),
  priority: z.string().default("breadth"),
});
const planSchema = z.object({
  strategy_summary: z.string().default(""),
  subtopics: z.array(subtopicSchema).default([]),
});

/** Turn the approved plan + objective into the brief the supervisor consumes. */
function renderBrief(researchPlan: string, objective: string): string {
  const parsed = planSchema.safeParse(JSON.parse(researchPlan) as unknown);
  if (!parsed.success)
    return `Objective: ${objective}\n\nPlan:\n${researchPlan}`;
  const { strategy_summary, subtopics } = parsed.data;
  const lines = subtopics.map(
    (s, i) =>
      `${i + 1}. ${s.title} [${s.tools}, ${s.priority}]: ${s.description}`,
  );
  return [
    `Objective: ${objective}`,
    strategy_summary ? `\nStrategy: ${strategy_summary}` : "",
    subtopics.length ? `\nSubtopics to research:\n${lines.join("\n")}` : "",
  ].join("\n");
}

export const deepResearch = schemaTask({
  id: "deep-research",
  schema: payloadSchema,
  maxDuration: 1800,
  run: async (payload) => {
    const { jobId, briefId, userId, researchPlan } = payload;
    logger.info("Starting deep research", { jobId, briefId });

    await updateJobStatus(jobId, "running");
    try {
      const brief = await getBrief(briefId);
      if (!brief) throw new Error(`Brief ${briefId} not found`);

      const researchBrief = renderBrief(researchPlan, brief.objective);
      const result = await graph2.invoke(
        {
          companyName: brief.companyName,
          website: brief.website,
          objective: brief.objective,
          researchBrief,
        },
        {
          configurable: {
            jobId,
            briefId,
            userId,
            companyName: brief.companyName,
            website: brief.website,
          },
        },
      );

      if (!result.report) throw new Error("Graph produced no report");
      // final_report stores the JSON-encoded ReportContent; sources mirror it.
      await updateJobResult(
        jobId,
        JSON.stringify(result.report),
        result.report.sources,
      );
      logger.info("Deep research complete", {
        jobId,
        sources: result.report.sources.length,
      });

      return { jobId, sources: result.report.sources.length };
    } catch (err) {
      await updateJobStatus(jobId, "failed");
      throw err;
    }
  },
});
