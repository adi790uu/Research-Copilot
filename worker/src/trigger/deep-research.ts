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

const planSchema = z.object({
  research_goal: z.string().default(""),
  guidance: z.string().default(""),
  coverage_angles: z.array(z.string()).default([]),
});

function renderBrief(researchPlan: string, objective: string): string {
  const parsed = planSchema.safeParse(JSON.parse(researchPlan) as unknown);
  if (!parsed.success)
    return `Objective: ${objective}\n\nPlan:\n${researchPlan}`;
  const { research_goal, guidance, coverage_angles } = parsed.data;
  const angles = coverage_angles.map((a, i) => `${i + 1}. ${a}`);
  return [
    `Objective: ${objective}`,
    research_goal ? `\nResearch goal: ${research_goal}` : "",
    guidance ? `\nGuidance: ${guidance}` : "",
    coverage_angles.length ? `\nCoverage angles (seeds to decompose):\n${angles.join("\n")}` : "",
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
      const resolution = brief.contactResolution;
      const personName = resolution?.status === "resolved" ? resolution.name ?? brief.contactName ?? "" : brief.contactName ?? "";
      const personLinkedinUrl = resolution?.status === "resolved" ? resolution.linkedin_url ?? "" : "";
      const personTitle = resolution?.status === "resolved" ? resolution.title ?? "" : "";

      const result = await graph2.invoke(
        {
          companyName: brief.companyName,
          website: brief.website,
          objective: brief.objective,
          researchBrief,
          personName,
          personLinkedinUrl,
          personTitle,
        },
        {
          configurable: {
            jobId,
            briefId,
            userId,
            companyName: brief.companyName,
            website: brief.website,
            personName,
            personLinkedinUrl,
          },
        },
      );

      if (!result.report) throw new Error("Graph produced no report");
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
