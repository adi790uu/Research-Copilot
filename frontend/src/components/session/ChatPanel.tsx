import { useEffect, useMemo, useRef, useState } from "react";

import { useChatStream } from "../../hooks/useChatStream";
import type { RunPhase, StreamState } from "../../hooks/useWorkflowStream";
import type {
  ChatWithMessages,
  ClarificationQuestion,
  Report,
  Source,
  WorkflowNode,
} from "../../lib/types";
import { formatRelative } from "../../lib/format";
import { SourceCitation } from "./SourceCitation";

const PROMPTS = [
  "What should I lead with?",
  "What signals matter most right now?",
  "Who else should be on the email?",
];

const RUNNING_NODE_LABEL: Record<WorkflowNode, string> = {
  clarify_with_user: "Checking the objective",
  write_research_brief: "Structuring the brief",
  create_research_plan: "Building the research plan",
  research_supervisor: "Researching across sources",
  final_report_generation: "Writing the brief",
};

interface Props {
  chat: ChatWithMessages | null;
  companyName: string;
  sources: Source[];
  report: Report | null;
  stream: StreamState;
  /** Effective phase = max(session.status, stream.phase). Treats a completed
   * session as completed even when the event bus replay is empty (revisit
   * after backend restart). */
  phase: RunPhase;
  onStart: () => void;
  starting: boolean;
  canStart: boolean;
  onOpenReport: () => void;

  // Plan-approval (interrupt_after=create_research_plan).
  onApprovePlan: () => void;
  approvingPlan: boolean;
  approvePlanError?: string | null;
  onOpenPlan: () => void;

  // Clarification (clarify_with_user terminated graph for user input).
  onSubmitClarifications: (answers: string[]) => void;
  submittingClarifications: boolean;
  clarificationError?: string | null;
}

export function ChatPanel({
  chat,
  companyName,
  sources,
  report,
  stream,
  phase,
  onStart,
  starting,
  canStart,
  onOpenReport,
  onApprovePlan,
  approvingPlan,
  approvePlanError,
  onOpenPlan,
  onSubmitClarifications,
  submittingClarifications,
  clarificationError,
}: Props) {
  const { messages, streaming, error, sendMessage } = useChatStream(
    chat?.id ?? null,
    chat?.messages ?? []
  );
  const [draft, setDraft] = useState("");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const sourceById = useMemo(() => {
    const m: Record<string, { source: Source; index: number }> = {};
    sources.forEach((s, i) => {
      m[s.id] = { source: s, index: i + 1 };
    });
    return m;
  }, [sources]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, phase]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const composerDisabled =
    streaming || phase !== "completed" || chat == null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (composerDisabled) return;
    const content = draft;
    setDraft("");
    await sendMessage(content);
  };

  const handleSuggest = async (prompt: string) => {
    if (composerDisabled) return;
    setDraft("");
    await sendMessage(prompt);
  };

  return (
    <div className="flex flex-col h-full">
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-3xl px-5 sm:px-8 py-8 space-y-7">
          <StatusBlock
            companyName={companyName}
            phase={phase}
            stream={stream}
            report={report}
            starting={starting}
            canStart={canStart}
            onStart={onStart}
            onOpenReport={onOpenReport}
            onApprovePlan={onApprovePlan}
            approvingPlan={approvingPlan}
            approvePlanError={approvePlanError}
            onOpenPlan={onOpenPlan}
            onSubmitClarifications={onSubmitClarifications}
            submittingClarifications={submittingClarifications}
            clarificationError={clarificationError}
          />

          {messages.length > 0 && (
            <div className="space-y-6">
              {messages.map((m) => (
                <MessageRow
                  key={m.id}
                  role={m.role}
                  content={m.content}
                  streaming={m.streaming === true && m.role === "assistant"}
                  sourceById={sourceById}
                />
              ))}
            </div>
          )}

          {phase === "completed" && messages.length === 0 && (
            <SuggestionList onPick={handleSuggest} disabled={composerDisabled} />
          )}

          {error && (
            <p className="font-mono text-[0.6875rem] uppercase tracking-wider text-bad">
              {error}
            </p>
          )}
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-rule/10 bg-bg/60 backdrop-blur"
      >
        <div className="mx-auto w-full max-w-3xl px-5 sm:px-8 py-4">
        <div className="flex items-end gap-3">
          <label htmlFor="chat-input" className="sr-only">
            Ask the briefing
          </label>
          <textarea
            id="chat-input"
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!composerDisabled && draft.trim()) {
                  void handleSubmit(e as unknown as React.FormEvent);
                }
              }
            }}
            placeholder={composerPlaceholder(phase)}
            className="input flex-1 resize-none py-2"
            style={{ maxHeight: "8rem" }}
            disabled={composerDisabled}
          />
          <button
            type="submit"
            className="btn-primary"
            disabled={composerDisabled || !draft.trim()}
            aria-label="Send message"
          >
            <span className="hidden sm:inline">
              {streaming ? "Streaming…" : "Send"}
            </span>
            <span aria-hidden className="arrow">→</span>
          </button>
        </div>
        <p className="mt-2 font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint/70">
          <kbd className="not-italic">↵</kbd> to send ·{" "}
          <kbd className="not-italic">⇧ ↵</kbd> for newline
        </p>
        </div>
      </form>
    </div>
  );
}

function composerPlaceholder(phase: RunPhase): string {
  switch (phase) {
    case "idle":
      return "Start the research above to begin the conversation.";
    case "running":
      return "Researching… you can chat once the brief is ready.";
    case "awaiting_clarification":
      return "Answer the clarifying questions above to continue.";
    case "awaiting_plan_approval":
      return "Approve the plan above to dispatch the researchers.";
    case "failed":
      return "Run halted. Restart the research to chat.";
    case "completed":
      return "Ask the brief — sources, signals, talking points…";
  }
}

// ---------------------------------------------------------------------------
// Top of the chat: status block. Adapts to workflow phase.
// ---------------------------------------------------------------------------

interface StatusBlockProps {
  companyName: string;
  phase: RunPhase;
  stream: StreamState;
  report: Report | null;
  starting: boolean;
  canStart: boolean;
  onStart: () => void;
  onOpenReport: () => void;
  onApprovePlan: () => void;
  approvingPlan: boolean;
  approvePlanError?: string | null;
  onOpenPlan: () => void;
  onSubmitClarifications: (answers: string[]) => void;
  submittingClarifications: boolean;
  clarificationError?: string | null;
}

function StatusBlock({
  companyName,
  phase,
  stream,
  report,
  starting,
  canStart,
  onStart,
  onOpenReport,
  onApprovePlan,
  approvingPlan,
  approvePlanError,
  onOpenPlan,
  onSubmitClarifications,
  submittingClarifications,
  clarificationError,
}: StatusBlockProps) {
  if (phase === "idle") {
    return (
      <IntroCard label="Ready to begin">
        <h2
          className="font-display italic text-[1.6rem] sm:text-[1.85rem] text-ink leading-tight"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
        >
          A briefing on {companyName}, in a few minutes.
        </h2>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-prose">
          A LangGraph workflow plans, researches, synthesises, and reviews — then
          the chat opens. Everything that follows is grounded in the briefing.
        </p>
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={onStart}
            disabled={!canStart || starting}
            className="btn-primary"
          >
            {starting ? "Dispatching…" : "Start research"}
            <span aria-hidden className="arrow">→</span>
          </button>
          <span className="font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint">
            ~2 min · 6 nodes
          </span>
        </div>
      </IntroCard>
    );
  }

  if (phase === "running") {
    return <RunningCard stream={stream} />;
  }

  if (phase === "awaiting_clarification" && stream.clarification) {
    return (
      <ClarificationCard
        questions={stream.clarification}
        submitting={submittingClarifications}
        error={clarificationError ?? null}
        onSubmit={onSubmitClarifications}
      />
    );
  }

  if (phase === "awaiting_plan_approval" && stream.plan) {
    return (
      <PlanApprovalCard
        userMessage={stream.plan.user_message}
        subtopicCount={stream.plan.subtopics.length}
        approving={approvingPlan}
        error={approvePlanError ?? null}
        onApprove={onApprovePlan}
        onOpenPlan={onOpenPlan}
      />
    );
  }

  if (phase === "failed") {
    return (
      <IntroCard label="Run halted" tone="bad">
        <h2
          className="font-display italic text-2xl text-ink leading-tight"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
        >
          The research couldn't complete.
        </h2>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-prose">
          {stream.error ?? "An unexpected error stopped the workflow."}
        </p>
        <div className="mt-5">
          <button
            type="button"
            onClick={onStart}
            disabled={!canStart || starting}
            className="btn-primary"
          >
            {starting ? "Retrying…" : "Retry research"}
            <span aria-hidden className="arrow">→</span>
          </button>
        </div>
      </IntroCard>
    );
  }

  // completed
  return (
    <div className="flex flex-col gap-2.5">
      <span className="eyebrow">Assistant</span>
      <p className="text-[0.95rem] text-ink leading-relaxed max-w-prose">
        I've completed your research on{" "}
        <span className="text-ink">{companyName}</span>. Feel free to ask
        follow-up questions or request changes.
      </p>
      <CompletionCard
        companyName={companyName}
        createdAt={report?.created_at}
        onOpen={onOpenReport}
      />
    </div>
  );
}

function IntroCard({
  label,
  tone,
  children,
}: {
  label: string;
  tone?: "bad";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-sm border ${
        tone === "bad"
          ? "border-bad/30 bg-bad/5"
          : "border-rule/10 bg-bg-elev/40"
      } px-6 sm:px-8 py-7`}
    >
      <p className="eyebrow">{label}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function RunningCard({ stream }: { stream: StreamState }) {
  // Find the active or most recently completed node label.
  const activeNode = findActiveNode(stream);
  const label = activeNode ? RUNNING_NODE_LABEL[activeNode] : "Dispatching the workflow";
  return (
    <div className="relative overflow-hidden rounded-sm border border-rule/10 bg-bg-elev/40 px-6 sm:px-8 py-6">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="h-2 w-2 rounded-full bg-info animate-pulse-dot"
        />
        <p className="eyebrow text-info">Researching</p>
      </div>
      <p
        className="mt-3 font-display italic text-xl sm:text-2xl text-ink leading-tight"
        style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
      >
        {label}…
      </p>
      <p className="mt-2 text-sm text-ink-soft">
        Watch the live progress in the Plan tab on the right.
      </p>
    </div>
  );
}

function findActiveNode(stream: StreamState): WorkflowNode | null {
  const NODES: WorkflowNode[] = [
    "clarify_with_user",
    "write_research_brief",
    "create_research_plan",
    "research_supervisor",
    "final_report_generation",
  ];
  // Prefer currently running; else last completed.
  const running = NODES.find((n) => stream.nodes[n]?.phase === "running");
  if (running) return running;
  for (let i = NODES.length - 1; i >= 0; i--) {
    if (stream.nodes[NODES[i]]?.phase === "completed") return NODES[i];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Clarification + plan-approval cards.
// ---------------------------------------------------------------------------

function ClarificationCard({
  questions,
  submitting,
  error,
  onSubmit,
}: {
  questions: ClarificationQuestion[];
  submitting: boolean;
  error: string | null;
  onSubmit: (answers: string[]) => void;
}) {
  const [answers, setAnswers] = useState<string[]>(() =>
    questions.map(() => "")
  );

  const setAt = (i: number, v: string) =>
    setAnswers((cur) => {
      const next = cur.slice();
      next[i] = v;
      return next;
    });

  const canSubmit =
    !submitting && answers.every((a) => a.trim().length > 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(answers.map((a) => a.trim()));
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="relative overflow-hidden rounded-sm border border-warn/30 bg-warn/5 px-6 sm:px-8 py-6"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="h-2 w-2 rounded-full bg-warn animate-pulse-dot"
        />
        <p className="eyebrow text-warn">Quick clarification</p>
      </div>
      <p
        className="mt-3 font-display italic text-xl text-ink leading-tight"
        style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
      >
        Help me aim the research.
      </p>

      <ol className="mt-5 space-y-5">
        {questions.map((q, i) => (
          <li key={i} className="space-y-2">
            <p className="text-sm text-ink leading-relaxed">
              <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-ink-faint mr-2">
                Q{i + 1}
              </span>
              {q.question}
            </p>
            {q.suggested_answers.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {q.suggested_answers.map((s) => {
                  const active = answers[i] === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setAt(i, s)}
                      disabled={submitting}
                      className={`px-3 py-1.5 rounded-full text-xs transition-colors border ${
                        active
                          ? "bg-ink text-bg border-ink"
                          : "border-ink/15 hover:border-ink/40 text-ink-soft"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            )}
            <input
              type="text"
              value={answers[i] ?? ""}
              onChange={(e) => setAt(i, e.target.value)}
              placeholder="Or type your own answer…"
              disabled={submitting}
              className="input w-full mt-1"
            />
          </li>
        ))}
      </ol>

      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint">
          Submitting kicks the research off.
        </p>
        <button
          type="submit"
          className="btn-primary"
          disabled={!canSubmit}
        >
          {submitting ? "Submitting…" : "Continue"}
          <span aria-hidden className="arrow">→</span>
        </button>
      </div>

      {error && (
        <p className="mt-3 font-mono text-[0.6875rem] uppercase tracking-wider text-bad">
          {error}
        </p>
      )}
    </form>
  );
}

function PlanApprovalCard({
  userMessage,
  subtopicCount,
  approving,
  error,
  onApprove,
  onOpenPlan,
}: {
  userMessage: string;
  subtopicCount: number;
  approving: boolean;
  error: string | null;
  onApprove: () => void;
  onOpenPlan: () => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-sm border border-warn/30 bg-warn/5 px-6 sm:px-8 py-6">
      <div className="flex items-center gap-3">
        <span aria-hidden className="h-2 w-2 rounded-full bg-warn" />
        <p className="eyebrow text-warn">Plan ready · approval needed</p>
      </div>
      <p
        className="mt-3 font-display italic text-xl text-ink leading-tight"
        style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
      >
        {userMessage}
      </p>
      <p className="mt-2 text-sm text-ink-soft">
        {subtopicCount} subtopic{subtopicCount === 1 ? "" : "s"} queued.
        Review the full plan on the right before dispatching.
      </p>
      <div className="mt-5 flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={onApprove}
          disabled={approving}
          className="btn-primary"
        >
          {approving ? "Dispatching…" : "Approve & run"}
          <span aria-hidden className="arrow">→</span>
        </button>
        <button
          type="button"
          onClick={onOpenPlan}
          className="btn-ghost text-xs"
        >
          Review plan →
        </button>
      </div>
      {error && (
        <p className="mt-3 font-mono text-[0.6875rem] uppercase tracking-wider text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

function CompletionCard({
  companyName,
  createdAt,
  onOpen,
}: {
  companyName: string;
  createdAt?: string;
  onOpen: () => void;
}) {
  return (
    <div className="mt-2 relative overflow-hidden rounded-lg bg-surface/70 hover:bg-surface transition-colors">
      <button
        type="button"
        onClick={onOpen}
        className="w-full grid grid-cols-[auto_1fr_auto] items-center gap-4 px-5 py-4 text-left"
      >
        <span
          aria-hidden
          className="h-9 w-9 rounded-md bg-bg-elev/70 flex items-center justify-center text-accent"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M3.5 2h6l3 3v9a.5.5 0 0 1-.5.5h-8.5a.5.5 0 0 1-.5-.5V2.5a.5.5 0 0 1 .5-.5z" strokeLinejoin="round" />
            <path d="M9.5 2v3.5h3M5 8h6M5 10.5h6M5 13h4" strokeLinecap="round" />
          </svg>
        </span>
        <span className="min-w-0">
          <span className="block text-sm text-ink leading-snug">
            Brief — {companyName}
          </span>
          <span className="block mt-0.5 font-mono text-[0.6875rem] uppercase tracking-wider text-ink-faint">
            {createdAt ? formatRelative(createdAt) : "Ready"} · Nine sections
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[0.6875rem] uppercase tracking-wider text-ink-soft">
          Open
          <span aria-hidden>→</span>
        </span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Messages + citations
// ---------------------------------------------------------------------------

interface MessageRowProps {
  role: "user" | "assistant";
  content: string;
  streaming: boolean;
  sourceById: Record<string, { source: Source; index: number }>;
}

function MessageRow({ role, content, streaming, sourceById }: MessageRowProps) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[82%] bg-surface px-4 py-2.5 rounded-2xl rounded-br-md shadow-[0_1px_0_rgb(0_0_0_/_0.15)]">
          <p className="text-[0.9375rem] text-ink whitespace-pre-wrap leading-relaxed">
            {content}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="eyebrow">Assistant</span>
      <div className="text-[0.9375rem] text-ink leading-relaxed whitespace-pre-wrap max-w-prose">
        <RenderWithCitations text={content} sourceById={sourceById} />
        {streaming && <StreamingCursor />}
      </div>
    </div>
  );
}

const CITATION_RE = /\[([a-zA-Z0-9_-]+(?:\s*,\s*[a-zA-Z0-9_-]+)*)\]/g;

function RenderWithCitations({
  text,
  sourceById,
}: {
  text: string;
  sourceById: Record<string, { source: Source; index: number }>;
}) {
  if (!text) return null;
  const out: React.ReactNode[] = [];
  let lastIdx = 0;
  let key = 0;

  for (const match of text.matchAll(CITATION_RE)) {
    const ids = match[1].split(/\s*,\s*/);
    const known = ids.map((id) => sourceById[id]).filter(Boolean);
    if (known.length === 0) continue;

    const start = match.index ?? 0;
    if (start > lastIdx) out.push(text.slice(lastIdx, start));
    known.forEach(({ source, index }, i) => {
      out.push(
        <SourceCitation key={`c-${key++}`} source={source} index={index} />
      );
      if (i < known.length - 1) out.push(" ");
    });
    lastIdx = start + match[0].length;
  }
  if (lastIdx < text.length) out.push(text.slice(lastIdx));
  return <>{out}</>;
}

function StreamingCursor() {
  return (
    <span
      aria-hidden
      className="inline-block w-[0.4em] h-[1em] align-text-bottom ml-1 bg-ink/70"
      style={{ animation: "cursor-blink 1s steps(1) infinite" }}
    />
  );
}

function SuggestionList({
  onPick,
  disabled,
}: {
  onPick: (q: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="pt-1">
      <p className="font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint mb-3">
        Try asking
      </p>
      <div className="flex flex-wrap gap-2">
        {PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            disabled={disabled}
            onClick={() => onPick(p)}
            className="btn-ghost text-xs disabled:opacity-50"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
