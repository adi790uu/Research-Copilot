import { ChatOpenAI } from "@langchain/openai";
import { env } from "@/config";

// GPT-5 / o-series reject a non-default temperature (400). Drop it for those.
const NO_TEMPERATURE_PREFIXES = ["gpt-5", "o1", "o3", "o4"];
const bareId = (model: string): string => model.split("/").pop() ?? model;
const acceptsTemperature = (model: string): boolean =>
  !NO_TEMPERATURE_PREFIXES.some((p) => bareId(model).startsWith(p));

/** Build a chat model on the configured OpenAI-compatible endpoint. */
export function createModel(
  { temperature = 0.2, maxTokens }: { temperature?: number; maxTokens?: number } = {},
): ChatOpenAI {
  const model = env.OPENAI_MODEL;
  const opts: ConstructorParameters<typeof ChatOpenAI>[0] = {
    model,
    apiKey: env.OPENAI_API_KEY,
  };
  if (acceptsTemperature(model)) opts.temperature = temperature;
  if (maxTokens) opts.maxTokens = maxTokens;
  if (env.OPENAI_BASE_URL) opts.configuration = { baseURL: env.OPENAI_BASE_URL };
  return new ChatOpenAI(opts);
}

/** Heuristic match for OpenAI "context length exceeded" style errors. */
export function isTokenLimitExceeded(error: unknown): boolean {
  const err = error as { message?: string; code?: string };
  if (err?.code === "context_length_exceeded") return true;
  const msg = (err?.message ?? String(error)).toLowerCase();
  return ["token", "context", "length", "maximum context", "reduce"].some((k) =>
    msg.includes(k),
  );
}
