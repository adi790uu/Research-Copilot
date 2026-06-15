import type { WorkflowNode } from "../../lib/types";
import { NODES, type NodeState, type StreamState } from "../../hooks/useWorkflowStream";

const NODE_LABELS: Record<WorkflowNode, string> = {
  clarify_with_user: "Clarify",
  write_research_brief: "Brief",
  create_research_plan: "Plan",
  research_supervisor: "Research",
  final_report_generation: "Report",
};

const NODE_BLURB: Record<WorkflowNode, string> = {
  clarify_with_user:
    "Checking if the objective needs follow-up before research begins.",
  write_research_brief:
    "Structuring the goal, key entities, and source strategy.",
  create_research_plan:
    "Mapping subtopics to the eight report sections.",
  research_supervisor:
    "Dispatching parallel researchers across company-site and external sources.",
  final_report_generation:
    "Drafting all eight sections and polishing them section-by-section.",
};

export function WorkflowProgress({
  stream,
  onStart,
  starting,
  startDisabled,
}: {
  stream: StreamState;
  onStart: () => void;
  starting: boolean;
  startDisabled: boolean;
}) {
  const hasStarted = stream.phase !== "idle";

  return (
    <div className="relative overflow-hidden border border-rule/8 bg-bg-elev/40 rounded-sm">
      <Header
        phase={stream.phase}
        onStart={onStart}
        starting={starting}
        startDisabled={startDisabled}
      />

      <ol className="divide-y divide-rule/8">
        {NODES.map((node, idx) => (
          <NodeRow
            key={node}
            ordinal={idx + 1}
            label={NODE_LABELS[node]}
            blurb={NODE_BLURB[node]}
            state={stream.nodes[node]}
          />
        ))}
      </ol>

      {hasStarted && stream.phase === "failed" && stream.error && (
        <div className="border-t border-bad/30 bg-bad/5 px-7 py-4">
          <p className="font-mono text-xs uppercase tracking-wider text-bad mb-1">
            Run failed
          </p>
          <p className="text-sm text-ink-soft">{stream.error}</p>
        </div>
      )}
    </div>
  );
}

function Header({
  phase,
  onStart,
  starting,
  startDisabled,
}: {
  phase: StreamState["phase"];
  onStart: () => void;
  starting: boolean;
  startDisabled: boolean;
}) {
  const cta =
    phase === "idle"
      ? "Run research"
      : phase === "running"
      ? "Running…"
      : phase === "completed"
      ? "Re-run"
      : "Retry";

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6 px-5 sm:px-7 py-5 rule-b">
      <div className="space-y-1">
        <p className="eyebrow">Orchestration</p>
        <p className="text-sm text-ink-soft">
          {phase === "idle" && "Dispatch the workflow to begin researching."}
          {phase === "running" && "Streaming nodes from LangGraph…"}
          {phase === "completed" && "Brief assembled. Re-run to refresh."}
          {phase === "failed" && "Run halted. Try again to recover."}
        </p>
      </div>
      <button
        type="button"
        onClick={onStart}
        disabled={starting || phase === "running" || startDisabled}
        className="inline-flex items-center gap-2 px-4 py-2 border border-ink/20 hover:border-ink/40 disabled:opacity-40 disabled:cursor-not-allowed font-mono text-xs uppercase tracking-wider text-ink transition-colors self-start sm:self-auto"
      >
        {phase === "running" && (
          <span
            className="h-1.5 w-1.5 rounded-full bg-info animate-pulse-dot"
            aria-hidden
          />
        )}
        {cta}
      </button>
    </div>
  );
}

function NodeRow({
  ordinal,
  label,
  blurb,
  state,
}: {
  ordinal: number;
  label: string;
  blurb: string;
  state: NodeState;
}) {
  return (
    <li className="flex items-start gap-4 sm:gap-6 px-5 sm:px-7 py-4">
      <span className="font-mono tabular-nums text-xs text-ink-faint/70 mt-0.5">
        {String(ordinal).padStart(2, "0")}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline flex-wrap gap-x-3 gap-y-1">
          <span className="text-sm text-ink">{label}</span>
          <Phase state={state} />
          <span className="font-mono tabular-nums text-[0.6875rem] text-ink-faint/70 whitespace-nowrap sm:hidden">
            {state.durationMs != null ? formatMs(state.durationMs) : ""}
            {state.attempt > 1 ? ` · try ${state.attempt}` : ""}
          </span>
        </div>
        <p className="text-xs text-ink-faint mt-0.5">{blurb}</p>
      </div>
      <span className="hidden sm:inline font-mono tabular-nums text-[0.6875rem] text-ink-faint/70 mt-0.5 whitespace-nowrap">
        {state.durationMs != null ? formatMs(state.durationMs) : ""}
        {state.attempt > 1 ? ` · try ${state.attempt}` : ""}
      </span>
    </li>
  );
}

function Phase({ state }: { state: NodeState }) {
  switch (state.phase) {
    case "idle":
      return (
        <span className="inline-flex items-center gap-1.5 text-[0.6875rem] font-mono uppercase tracking-wider text-ink-faint/60">
          <span className="h-[5px] w-[5px] rounded-full bg-ink-faint/40" />
          queued
        </span>
      );
    case "running":
      return (
        <span className="inline-flex items-center gap-1.5 text-[0.6875rem] font-mono uppercase tracking-wider text-info">
          <span className="h-[5px] w-[5px] rounded-full bg-info animate-pulse-dot" />
          running
        </span>
      );
    case "completed":
      return (
        <span className="inline-flex items-center gap-1.5 text-[0.6875rem] font-mono uppercase tracking-wider text-good">
          <span className="h-[5px] w-[5px] rounded-full bg-good" />
          done
        </span>
      );
    case "failed":
      return (
        <span
          className="inline-flex items-center gap-1.5 text-[0.6875rem] font-mono uppercase tracking-wider text-bad"
          title={state.error ?? undefined}
        >
          <span className="h-[5px] w-[5px] rounded-full bg-bad" />
          failed
        </span>
      );
  }
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
