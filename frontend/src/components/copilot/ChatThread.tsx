import { useEffect, useRef } from "react";

import type { EditProposal } from "../../lib/types";
import type { CopilotTurn } from "../../hooks/useCopilotChat";

export function ChatThread({
  messages,
  firstName,
  selectedCount,
  onResolveProposal,
}: {
  messages: CopilotTurn[];
  firstName: string | null;
  selectedCount: number;
  onResolveProposal: (
    messageId: string,
    proposalId: string,
    status: "applied" | "discarded",
  ) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (messages.length === 0) {
    return <EmptyState firstName={firstName} selectedCount={selectedCount} />;
  }

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-8">
        {messages.map((m) => (
          <Turn key={m.id} turn={m} onResolveProposal={onResolveProposal} />
        ))}
      </div>
    </div>
  );
}

function Turn({
  turn,
  onResolveProposal,
}: {
  turn: CopilotTurn;
  onResolveProposal: (
    messageId: string,
    proposalId: string,
    status: "applied" | "discarded",
  ) => void;
}) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-ink/[0.06] px-4 py-2.5 text-[0.9375rem] leading-relaxed text-ink">
          {turn.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[0.9375rem] leading-relaxed text-ink-soft whitespace-pre-wrap">
        {turn.content}
        {turn.streaming ? <Caret /> : null}
      </div>
      {turn.proposals?.map((p) => (
        <ProposalCard
          key={p.id}
          proposal={p}
          onResolve={(status) => onResolveProposal(turn.id, p.id, status)}
        />
      ))}
    </div>
  );
}

function ProposalCard({
  proposal,
  onResolve,
}: {
  proposal: EditProposal;
  onResolve: (status: "applied" | "discarded") => void;
}) {
  const pending = proposal.status === "pending";
  return (
    <div className="rounded-xl border border-rule/12 bg-bg-elev/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">
          Proposed edit · {proposal.kind === "add" ? "new section" : "revise section"}
        </p>
        <span className="font-mono text-[0.5625rem] uppercase tracking-wider text-ink-faint/80">
          {proposal.research_title}
        </span>
      </div>

      <p className="mt-2 text-sm font-medium text-ink">{proposal.heading}</p>

      {proposal.kind === "replace" && proposal.before ? (
        <p className="mt-2 rounded-lg bg-bad/[0.06] px-3 py-2 text-xs leading-relaxed text-ink-faint line-through">
          {proposal.before}
        </p>
      ) : null}
      <p className="mt-2 rounded-lg bg-good/[0.07] px-3 py-2 text-sm leading-relaxed text-ink-soft">
        {proposal.after}
      </p>

      {pending ? (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onResolve("applied")}
            className="btn-primary !py-1.5 !text-xs"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => onResolve("discarded")}
            className="btn-ghost !py-1.5 !text-xs"
          >
            Discard
          </button>
        </div>
      ) : (
        <p
          className={`mt-3 font-mono text-[0.625rem] uppercase tracking-eyebrow ${
            proposal.status === "applied" ? "text-good" : "text-ink-faint"
          }`}
        >
          {proposal.status === "applied" ? "✓ Applied to report" : "Discarded"}
        </p>
      )}
    </div>
  );
}

function EmptyState({
  firstName,
  selectedCount,
}: {
  firstName: string | null;
  selectedCount: number;
}) {
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto px-6">
      <div className="w-full max-w-lg py-16 text-center">
        <h1
          className="font-display text-[2rem] leading-[1.1] text-ink md:text-[2.5rem]"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 60' }}
        >
          {firstName ? (
            <>
              Where to,{" "}
              <em
                className="italic text-accent"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
              >
                {firstName}
              </em>
              ?
            </>
          ) : (
            <>
              What do you want to{" "}
              <em
                className="italic text-accent"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
              >
                know
              </em>
              ?
            </>
          )}
        </h1>
        <p className="mt-4 text-sm text-ink-faint leading-relaxed">
          {selectedCount > 0
            ? `Ask across your ${selectedCount} selected ${selectedCount === 1 ? "research" : "researches"}, or ask to update one.`
            : "Pick one or more researches on the left, then ask a question or request an update."}
        </p>
      </div>
    </div>
  );
}

function Caret() {
  return (
    <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.15em] animate-pulse bg-accent align-baseline" />
  );
}
