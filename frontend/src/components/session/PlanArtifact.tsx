import type { ResearchPlan, ResearchSubtopic } from "../../lib/types";

const SECTION_LABEL: Record<ResearchSubtopic["section"], string> = {
  company_overview: "Company overview",
  products_and_services: "Products & services",
  target_customers: "Target customers",
  business_signals: "Business signals",
  risks_and_challenges: "Risks & challenges",
  discovery_questions: "Discovery questions",
  outreach_strategy: "Outreach strategy",
  unknowns: "Unknowns",
};

const TOOL_LABEL: Record<ResearchSubtopic["tools"], string> = {
  company_site: "Company site",
  web: "Web",
  both: "Site + Web",
};

interface Props {
  plan: ResearchPlan;
  awaitingApproval: boolean;
  approving: boolean;
  onApprove: () => void;
  approveError?: string | null;
}

export function PlanArtifact({
  plan,
  awaitingApproval,
  approving,
  onApprove,
  approveError,
}: Props) {
  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <p className="eyebrow">Research plan</p>
        <p
          className="font-display italic text-lg text-ink leading-snug"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
        >
          {plan.user_message}
        </p>
        {plan.strategy_summary && (
          <p className="text-sm text-ink-soft leading-relaxed">
            {plan.strategy_summary}
          </p>
        )}
      </header>

      <ol className="divide-y divide-rule/8 border border-rule/10 bg-bg-elev/40 rounded-sm">
        {plan.subtopics.map((st, idx) => (
          <li key={`${st.section}-${idx}`} className="px-5 py-4">
            <div className="flex items-baseline gap-3">
              <span className="font-mono tabular-nums text-[0.6875rem] text-ink-faint/70 mt-0.5 shrink-0">
                {String(idx + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline flex-wrap gap-x-3 gap-y-1">
                  <span className="text-sm text-ink leading-snug">
                    {st.title}
                  </span>
                  <span className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint/80">
                    {SECTION_LABEL[st.section]} · {TOOL_LABEL[st.tools]} · {st.priority}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-soft leading-relaxed">
                  {st.description}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {awaitingApproval && (
        <div className="flex items-center justify-between gap-3 border-t border-rule/8 pt-4">
          <p className="text-xs text-ink-soft">
            Approve to dispatch the researchers. The supervisor will fan out
            parallel agents according to this plan.
          </p>
          <button
            type="button"
            onClick={onApprove}
            disabled={approving}
            className="btn-primary"
          >
            {approving ? "Dispatching…" : "Approve plan"}
            <span aria-hidden className="arrow">→</span>
          </button>
        </div>
      )}

      {approveError && (
        <p className="font-mono text-[0.6875rem] uppercase tracking-wider text-bad">
          {approveError}
        </p>
      )}
    </div>
  );
}
