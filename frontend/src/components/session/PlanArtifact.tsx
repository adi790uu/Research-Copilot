import type { ResearchPlan } from "../../lib/types";

interface Props {
  plan: ResearchPlan;
}

/**
 * Read-only view of the research plan. We only show the headline message
 * and the strategy summary — the per-subtopic list isn't a faithful map
 * of what actually gets researched (the supervisor LLM reinterprets the
 * plan into ConductResearch calls), so we hide it to avoid the mismatch
 * between displayed subtopics and the per-researcher rows in Sources.
 */
export function PlanArtifact({ plan }: Props) {
  return (
    <section className="space-y-2">
      <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint">
        Research plan
      </p>
      {plan.user_message ? (
        <p className="text-sm leading-relaxed text-ink-soft">
          {plan.user_message}
        </p>
      ) : null}
    </section>
  );
}
