import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_deep_research_local",
  runtime: "node",
  logLevel: "info",
  // Deep research is long-running (parallel researchers + multi-pass report).
  maxDuration: 1800,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 30000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["./src/trigger"],
});
