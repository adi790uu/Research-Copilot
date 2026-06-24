import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import type { ReportChatTurn } from "../../hooks/useReportChat";
import { type ChatTurn, type RunPhase } from "../../hooks/useWorkflowChat";
import type { ResearchStatus } from "../../lib/runStatus";
import type {
  ClarificationQuestion,
  ResearchPlan,
  WorkflowNode,
} from "../../lib/types";
import { ClarificationCard } from "./ClarificationCard";

interface Props {
  companyName: string;
  turns: ChatTurn[];
  phase: RunPhase;
  streaming: boolean;
  onAnswers: (answers: string[], questions: ClarificationQuestion[]) => void;
  /** Click handler for the inline report Document card. Opens artifact
   * panel scrolled to the report block. */
  onOpenReport: () => void;
  /** Approve the plan inline → create + trigger the phase-2 job. */
  onApprovePlan: () => void;
  /** True while the approve request is in flight. */
  approving: boolean;
  /** Error from a failed approve attempt. */
  approveError: string | null;
  error: string | null;

  // ─── Follow-up chat (post-report) ─────────────────────────────────────
  /** True once the report is ready — gates the composer + history. */
  followupEnabled: boolean;
  /** Persisted + streaming follow-up turns. */
  followupTurns: ReportChatTurn[];
  followupSending: boolean;
  followupError: string | null;
  onFollowupSend: (text: string) => Promise<void> | void;

  /** Cold-load skeleton gate. True until session + job + (when
   * applicable) follow-up history have all resolved. */
  initialLoading: boolean;

  /** Derived phase-2 status — drives the thinking bubble so it keeps
   * narrating live work (researching, writing the report) after the
   * phase-1 SSE closes, and stays accurate across reloads. */
  status: ResearchStatus;
}

export function ChatPanel({
  companyName,
  turns,
  phase,
  streaming,
  onAnswers,
  onOpenReport,
  onApprovePlan,
  approving,
  approveError,
  error,
  followupEnabled,
  followupTurns,
  followupSending,
  followupError,
  onFollowupSend,
  initialLoading,
  status,
}: Props) {
  // Conversation feed: drop node_status turns (they only feed the thinking
  // caption) and all clarification turns (the question is pinned in the footer
  // above the input box; the user's answers turn carries the Q&A in the feed).
  const visibleTurns = turns.filter(
    (t) =>
      !(t.role === "assistant" && t.kind === "node_status") &&
      !(t.role === "assistant" && t.kind === "clarification")
  );

  // The clarification the footer is currently asking — the latest unanswered
  // one. Pinned directly above the input box.
  const pendingClarification = findLast(
    turns,
    (t) => t.role === "assistant" && t.kind === "clarification" && !t.answered
  ) as Extract<ChatTurn, { kind: "clarification" }> | undefined;

  // Is the agent actively working right now? That's our cue to render the
  // "thinking" reply bubble. We suppress it whenever the conversation is
  // waiting on the user (clarification / plan approval) or already settled
  // (report ready / failed) — those states own the bottom of the feed.
  const researchActive =
    status.stage === "researching" || status.stage === "writing_report";
  const awaitingClarification =
    phase === "awaiting_clarification" &&
    turns.some(
      (t) => t.role === "assistant" && t.kind === "clarification" && !t.answered
    );
  const awaitingApproval = phase === "awaiting_plan_approval";

  const showThinking =
    status.stage !== "done" &&
    status.stage !== "failed" &&
    !awaitingClarification &&
    !awaitingApproval &&
    (streaming || phase === "running" || researchActive);

  const activity = deriveActivity(turns, status);

  // Auto-scroll to the newest message so the to-and-fro stays in view.
  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [visibleTurns.length, showThinking, activity.label, followupTurns.length]);

  const composerDisabled = !followupEnabled;

  return (
    // Grid rows: header / scrollable feed / footer. The footer is always
    // present — it pins the clarification card (when asked) directly above an
    // input box that's visible from the start and enabled once the report is
    // ready for follow-up.
    <section
      className="relative grid h-full min-h-0 bg-bg"
      style={{ gridTemplateRows: "auto minmax(0, 1fr) auto" }}
    >
      <header className="px-8 pt-7 pb-5">
        <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint">
          Research session
        </p>
        <h2 className="mt-1.5 font-serif text-3xl tracking-tight text-ink">
          {companyName}
        </h2>
      </header>

      <div className="overflow-y-auto px-8 pt-6 pb-8">
        {initialLoading ? (
          <FeedSkeleton />
        ) : visibleTurns.length === 0 && !showThinking ? (
          // Brief gap between auto-start and the first SSE event — stay quiet.
          null
        ) : (
          <ol className="panel-reveal space-y-4">
            {visibleTurns.map((turn, i) => (
              <TurnView
                key={i}
                turn={turn}
                onOpenReport={onOpenReport}
                onApprovePlan={onApprovePlan}
                approving={approving}
                approveError={approveError}
              />
            ))}
            {showThinking ? (
              <ThinkingBubble label={activity.label} detail={activity.detail} />
            ) : null}
            {followupTurns.map((t) => (
              <FollowupTurnView key={t.id} turn={t} />
            ))}
            <div ref={bottomRef} />
          </ol>
        )}
      </div>

      {/* Footer — always present. The clarification card (when the agent is
          asking) is pinned directly above the input box. The input box shows
          from the start, disabled until the report unlocks follow-up chat. */}
      <footer className="bg-bg">
        {pendingClarification ? (
          <div className="px-6 pt-4">
            <div className="mx-auto w-full max-w-[40rem]">
              <ClarificationCard
                questions={pendingClarification.questions}
                submitting={streaming}
                error={error}
                onSubmit={(answers) =>
                  onAnswers(answers, pendingClarification.questions)
                }
              />
            </div>
          </div>
        ) : null}

        <FollowupComposer
          sending={followupSending}
          error={
            followupEnabled
              ? followupError
              : pendingClarification
                ? null // the clarification card surfaces the error instead
                : error
          }
          onSend={onFollowupSend}
          disabled={composerDisabled}
          placeholder={
            followupEnabled
              ? "Ask a follow-up about the report…"
              : disabledComposerHint(phase, !!pendingClarification)
          }
        />
      </footer>
    </section>
  );
}

/** Placeholder for the always-visible composer while it's disabled (before the
 * report unlocks follow-up). */
function disabledComposerHint(phase: RunPhase, awaitingClarification: boolean): string {
  if (awaitingClarification) return "Answer the question above to continue.";
  if (phase === "awaiting_plan_approval")
    return "Approve the plan to start research.";
  if (phase === "failed") return "Run failed — start a new brief.";
  return "Researching… chat unlocks when the brief is ready.";
}

function findLast<T>(arr: T[], pred: (x: T) => boolean): T | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return arr[i];
  }
  return undefined;
}

/**
 * Split a plan narrative like "I'll do X by (1) … , (2) … , and (3) … . Each
 * angle will …" into an intro, numbered steps, and a trailing outro sentence.
 * Returns null when the text isn't in that shape so the caller falls back to a
 * plain paragraph.
 */
function parsePlan(
  text: string
): { intro: string; steps: string[]; outro: string } | null {
  if (!text || !/\(\s*1\s*\)/.test(text)) return null;

  const parts = text.split(/\(\s*\d+\s*\)\s*/); // [intro, seg1, seg2, …]
  const intro = parts[0]?.trim().replace(/[:,]?\s*$/, "") ?? "";
  const rawSteps = parts.slice(1).map((s) => s.trim()).filter(Boolean);
  if (rawSteps.length === 0) return null;

  // The last step often carries a trailing summary sentence ("Each angle …").
  // Peel it off so it reads as an outro rather than part of step N.
  let outro = "";
  const last = rawSteps[rawSteps.length - 1];
  const splitLast = last.match(/^(.*?[.;])\s+([A-Z].*)$/s);
  if (splitLast) {
    rawSteps[rawSteps.length - 1] = splitLast[1];
    outro = splitLast[2];
  }

  const steps = rawSteps.map((s) =>
    s.replace(/^(?:and\s+)?,?\s*/i, "").replace(/[,;]\s*$/, "").trim()
  );

  return { intro, steps, outro };
}

// ─── Thinking bubble ────────────────────────────────────────────────────────

/** Left-aligned assistant "reply" while the agent works. An animated typing
 * indicator plus a live caption of the current activity. */
function ThinkingBubble({ label, detail }: { label: string; detail?: string }) {
  return (
    <li className="panel-reveal">
      <div className="inline-flex max-w-[78%] items-center gap-3 rounded-[20px] rounded-bl-[6px] bg-ink/[0.04] px-4 py-3">
        <TypingDots />
        <span className="text-sm leading-relaxed text-ink-soft">
          {label}
          {detail ? <span className="text-ink-faint"> · {detail}</span> : null}
        </span>
      </div>
    </li>
  );
}

function TypingDots() {
  return (
    <span className="flex shrink-0 items-center gap-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="block h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot"
          style={{ animationDelay: `${i * 0.25}s` }}
        />
      ))}
    </span>
  );
}

function FeedSkeleton() {
  // Editorial loader: a single warm filament being drawn beneath a soft
  // accent halo. Captions cross-fade through what's loading. Quiet,
  // intentional — no fake bubble placeholders.
  return (
    <div
      className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-8"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="relative grid place-items-center">
        {/* Halo */}
        <div
          aria-hidden
          className="absolute h-40 w-40 rounded-full blur-2xl"
          style={{
            background:
              "radial-gradient(circle, rgb(var(--accent) / 0.35), transparent 70%)",
            animation: "halo-breathe 3.2s ease-in-out infinite",
          }}
        />
        {/* Filament — a single warm thread drawn across an etched track */}
        <div className="relative h-px w-44 overflow-hidden rounded-full bg-ink/8">
          <div
            aria-hidden
            className="absolute inset-y-0 h-px w-1/2"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgb(var(--accent)) 50%, transparent)",
              animation: "filament-draw 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite",
            }}
          />
        </div>
      </div>

      <div className="flex flex-col items-center gap-2 text-center">
        <p className="font-serif text-xl tracking-tight text-ink">
          Assembling your session
        </p>
        <CyclingCaption />
      </div>
    </div>
  );
}

function CyclingCaption() {
  // Stacked captions cross-fade via a single keyframe with offset
  // animation-delay. No JS timer — pure CSS so it stays cheap and works
  // when the tab is backgrounded.
  const captions = [
    "Reading the brief",
    "Catching up on the researchers",
    "Stacking the sources",
    "Setting the type",
  ];
  const duration = captions.length * 3.2; // seconds per cycle
  return (
    <div className="relative flex h-4 w-[22rem] items-center justify-center">
      {captions.map((c, i) => (
        <span
          key={c}
          className="absolute inset-0 flex items-center justify-center whitespace-nowrap text-center font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-faint opacity-0"
          style={{
            animation: `caption-rotate ${duration}s linear infinite both`,
            animationDelay: `${(i * duration) / captions.length}s`,
          }}
        >
          {c}
          <span className="ml-1 text-accent">·</span>
        </span>
      ))}
    </div>
  );
}

function TurnView({
  turn,
  onOpenReport,
  onApprovePlan,
  approving,
  approveError,
}: {
  turn: ChatTurn;
  onOpenReport: () => void;
  onApprovePlan: () => void;
  approving: boolean;
  approveError: string | null;
}) {
  if (turn.role === "user") {
    if (turn.kind === "answers") {
      return (
        <li className="flex justify-end">
          <div className="max-w-[78%] rounded-[20px] rounded-br-[6px] bg-accent/15 px-4 py-2.5 text-ink">
            <ul className="space-y-1.5 text-sm leading-relaxed">
              {turn.lines.map((l, i) => (
                <li key={i}>
                  <span className="text-ink/70">{l.question}</span>
                  <br />
                  <span>{l.answer}</span>
                </li>
              ))}
            </ul>
          </div>
        </li>
      );
    }
    return (
      <li className="flex justify-end">
        <p className="max-w-[78%] whitespace-pre-wrap rounded-[20px] rounded-br-[6px] bg-accent/15 px-4 py-2.5 text-sm leading-relaxed text-ink">
          {turn.content}
        </p>
      </li>
    );
  }
  switch (turn.kind) {
    case "node_status":
      // Folded into the thinking bubble's caption; never rendered inline.
      return null;
    case "clarification":
      // Pinned in the footer above the input box, not in the feed.
      return null;
    case "plan_ready":
      return (
        <PlanCard
          plan={turn.plan}
          acted={turn.acted}
          approving={approving}
          approveError={approveError}
          onApprove={onApprovePlan}
        />
      );
    case "report_ready":
      // Document-style card: clicking opens the artifact panel scrolled
      // to the report block.
      return (
        <li>
          <button
            type="button"
            onClick={onOpenReport}
            className="group flex w-full max-w-[78%] items-center gap-3 rounded-[20px] rounded-bl-[6px] bg-ink/[0.04] px-4 py-3 text-left transition-colors hover:bg-ink/[0.08]"
          >
            <DocIcon />
            <span className="min-w-0 flex-1">
              <span
                className="block truncate font-serif text-base text-ink"
                title={turn.title}
              >
                {turn.title}
              </span>
              <span className="block font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-faint">
                Document · brief
              </span>
            </span>
            <span className="font-mono text-[0.6875rem] uppercase tracking-eyebrow text-accent opacity-60 transition-opacity group-hover:opacity-100">
              Open ↗
            </span>
          </button>
        </li>
      );
    case "failed":
      return (
        <li>
          <div className="max-w-[78%] rounded-[20px] rounded-bl-[6px] bg-bad/10 px-4 py-3">
            <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-bad">
              Run failed
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
              {turn.message}
            </p>
          </div>
        </li>
      );
    default:
      return null;
  }
}

// ─── Plan card ──────────────────────────────────────────────────────────────

/** The plan, set as a typeset brief: a warm panel marked with an accent spine,
 * the whole plan voiced in Fraunces (distinct from the sans chat) — a serif
 * lead, a hanging-indexed list of angles, and a soft accent approve. */
function PlanCard({
  plan,
  acted,
  approving,
  approveError,
  onApprove,
}: {
  plan: ResearchPlan;
  acted: boolean;
  approving: boolean;
  approveError: string | null;
  onApprove: () => void;
}) {
  const parsed = parsePlan(plan.user_message || plan.strategy_summary);
  const steps = parsed?.steps ?? [];
  // The plan speaks in Newsreader — a calm editorial text serif, distinct from
  // the Fraunces display + Geist sans used everywhere else.
  const planFont = '"Newsreader", Georgia, serif';

  return (
    <li className="panel-reveal">
      <div
        className="relative w-full max-w-[37rem] rounded-[20px] bg-bg-elev"
        style={{ boxShadow: "0 26px 70px -34px rgba(0,0,0,0.85)" }}
      >
        <div className="px-9 pt-8 pb-7">
          {/* Eyebrow */}
          <div className="flex items-baseline justify-between gap-4">
            <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-accent">
              Research plan
            </p>
            {steps.length > 0 ? (
              <span className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint">
                {String(steps.length).padStart(2, "0")} steps
              </span>
            ) : null}
          </div>

          {/* Lead — Newsreader, confident editorial hook */}
          {parsed?.intro ? (
            <p
              className="mt-4 max-w-[31rem] text-[1.4rem] leading-[1.4] text-ink"
              style={{
                fontFamily: planFont,
                fontVariationSettings: '"opsz" 72, "wght" 440',
              }}
            >
              {parsed.intro}
            </p>
          ) : null}

          {/* Steps — right-aligned figures, generous rhythm */}
          {steps.length > 0 ? (
            <ol className="mt-7 space-y-4">
              {steps.map((step, i) => (
                <li key={i} className="flex gap-5">
                  <span
                    className="w-6 shrink-0 select-none pt-px text-right text-[0.92rem] leading-[1.85] text-accent/90 tabular-nums"
                    style={{
                      fontFamily: planFont,
                      fontVariationSettings: '"opsz" 24, "wght" 560',
                    }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <p
                    className="flex-1 text-[1.05rem] leading-[1.8] text-ink-soft"
                    style={{
                      fontFamily: planFont,
                      fontVariationSettings: '"opsz" 18, "wght" 400',
                    }}
                  >
                    {step}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p
              className="mt-4 whitespace-pre-wrap text-[1.05rem] leading-[1.8] text-ink-soft"
              style={{
                fontFamily: planFont,
                fontVariationSettings: '"opsz" 18, "wght" 400',
              }}
            >
              {plan.user_message || plan.strategy_summary || "No plan details."}
            </p>
          )}

          {/* Outro */}
          {parsed?.outro ? (
            <p
              className="mt-6 text-[0.98rem] leading-relaxed text-ink-faint"
              style={{
                fontFamily: planFont,
                fontStyle: "italic",
                fontVariationSettings: '"opsz" 36, "wght" 400',
              }}
            >
              {parsed.outro}
            </p>
          ) : null}

          {/* Commit */}
          <div className="mt-8 flex items-center gap-4">
            {acted ? (
              <p className="flex items-center gap-2 font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint">
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent/80"
                />
                Researchers dispatched
              </p>
            ) : (
              <button
                type="button"
                onClick={onApprove}
                disabled={approving}
                className="group/approve inline-flex items-center gap-2.5 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-bg transition-all duration-300 hover:brightness-105 disabled:opacity-45"
                style={{ boxShadow: "0 12px 30px -12px rgb(var(--accent) / 0.6)" }}
              >
                {approving ? "Dispatching…" : "Approve & start research"}
                <span
                  aria-hidden
                  className="transition-transform duration-300 group-hover/approve:translate-x-1"
                >
                  →
                </span>
              </button>
            )}
            {approveError ? (
              <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-bad">
                {approveError}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

// ─── Activity caption (phase-1 SSE node steps + phase-2 status) ─────────────

type NodeStatusTurn = Extract<ChatTurn, { kind: "node_status" }>;

const PHASE1_STEPS: { node: WorkflowNode; label: string }[] = [
  { node: "clarify_with_user", label: "Checking the objective" },
  { node: "write_research_brief", label: "Structuring the brief" },
  { node: "create_research_plan", label: "Designing the research plan" },
];

/** The single line the thinking bubble narrates. Phase-1 reads the live (or
 * failed) node step; once phase 1 is past, the phase-2 status takes over. */
function deriveActivity(
  turns: ChatTurn[],
  status: ResearchStatus
): { label: string; detail?: string } {
  const latest = latestNodePhase(turns);
  for (const { node, label } of PHASE1_STEPS) {
    const st = latest.get(node);
    if (st === "failed") return { label, detail: "needs another pass" };
    if (st === "running") return { label };
  }

  if (status.stage === "researching") {
    if (status.anglesTotal > 0) {
      return {
        label: `Researching ${status.anglesTotal} ${
          status.anglesTotal === 1 ? "angle" : "angles"
        }`,
        detail: `${status.anglesDone} of ${status.anglesTotal} done`,
      };
    }
    return { label: "Researching", detail: "scoping the angles" };
  }
  if (status.stage === "writing_report") return { label: "Writing the report" };
  return { label: "Thinking" };
}

/** Latest phase per phase-1 node. */
function latestNodePhase(turns: ChatTurn[]): Map<WorkflowNode, string> {
  const latest = new Map<WorkflowNode, string>();
  for (const t of turns) {
    if (t.role === "assistant" && t.kind === "node_status") {
      latest.set((t as NodeStatusTurn).node, (t as NodeStatusTurn).phase);
    }
  }
  return latest;
}

function FollowupTurnView({ turn }: { turn: ReportChatTurn }) {
  if (turn.role === "user") {
    return (
      <li className="flex justify-end">
        <p className="max-w-[78%] whitespace-pre-wrap rounded-[20px] rounded-br-[6px] bg-accent/15 px-4 py-2.5 text-sm leading-relaxed text-ink">
          {turn.content}
        </p>
      </li>
    );
  }
  // assistant
  return (
    <li>
      <div className="max-w-[78%] rounded-[20px] rounded-bl-[6px] bg-ink/[0.04] px-4 py-2.5">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
          {turn.content || (turn.streaming ? "Thinking…" : "")}
          {turn.streaming && turn.content ? (
            <span className="ml-1 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse-dot bg-accent align-middle" />
          ) : null}
        </p>
      </div>
    </li>
  );
}

function FollowupComposer({
  sending,
  error,
  onSend,
  disabled = false,
  placeholder = "Ask a follow-up about the report…",
}: {
  sending: boolean;
  error: string | null;
  onSend: (text: string) => Promise<void> | void;
  /** When true the composer is inert (run still in progress). */
  disabled?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || sending || disabled) return;
    void onSend(text);
    setDraft("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const canSend = !!draft.trim() && !sending && !disabled;

  return (
    <form onSubmit={submit} className="shrink-0 px-6 pt-3 pb-5">
      <div className="mx-auto w-full max-w-[40rem]">
        <div
          className={`group/composer rounded-2xl bg-bg-elev px-4 pt-3 pb-2 transition-colors focus-within:bg-bg-elev/90 ${
            disabled ? "opacity-60" : ""
          }`}
        >
          <textarea
            rows={1}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
            }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            disabled={sending || disabled}
            className="block w-full resize-none bg-transparent text-[0.95rem] leading-relaxed text-ink placeholder:text-ink-faint/70 focus:outline-none disabled:cursor-not-allowed"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint">
              {disabled ? "" : "Grounded in the brief"}
            </p>
            <button
              type="submit"
              disabled={!canSend}
              className="group/send inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-faint transition-colors enabled:hover:text-accent disabled:opacity-50"
            >
              {sending ? (
                <>
                  <span className="block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-r-transparent" />
                  Sending
                </>
              ) : (
                <>
                  Send
                  <span
                    aria-hidden
                    className="inline-block transition-transform group-hover/send:translate-x-0.5"
                  >
                    →
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
        {error ? (
          <p className="mt-2 px-1 font-mono text-[0.625rem] uppercase tracking-eyebrow text-bad">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function DocIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={32}
      height={32}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-8 w-8 shrink-0 text-accent"
      aria-hidden="true"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </svg>
  );
}
