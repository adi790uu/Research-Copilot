import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_BASE_URL: z.string().optional().default(""),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  TAVILY_API_KEY: z.string().min(1),
  TAVILY_SEARCH_DEPTH: z.enum(["basic", "advanced"]).default("advanced"),
});

export const env = envSchema.parse(process.env);

/** Orchestration limits — mirror research-copilot's workflow_* settings. */
export const LIMITS = {
  MAX_CONCURRENT_RESEARCH_UNITS: 5,
  MAX_RESEARCHER_ITERATIONS: 4,
  MAX_REACT_TOOL_CALLS: 8,
} as const;
