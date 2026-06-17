import { useState, type FormEvent, type KeyboardEvent } from "react";

import type { ReportChatTurn } from "../../hooks/useReportChat";
import { type ChatTurn, type RunPhase } from "../../hooks/useWorkflowChat";
import type {
  ClarificationQuestion,
  ResearchJob,
  ResearcherResult,
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
  /** Click handler for the inline plan_ready card. Opens artifact panel
   * scrolled to the plan block. */
  onOpenPlan: () => void;
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

  /** Phase-2 state — fed to the run status ticker so it can keep
   * showing live activity after SSE closes (researchers running, writing
   * the brief, etc.) instead of freezing on "phase one complete". */
  job: ResearchJob | null;
  researchers: ResearcherResult[];
}

export function ChatPanel({
  companyName,
  turns,
  phase,
  streaming,
  onAnswers,
  onOpenReport,
  onOpenPlan,
  error,
  followupEnabled,
  followupTurns,
  followupSending,
  followupError,
  onFollowupSend,
  initialLoading,
  job,
  researchers,
}: Props) {
  // Pull the most recent unanswered clarification so the sticky widget can
  // render it. The feed filter below suppresses any inline clarification
  // turns so questions only ever appear in one place.
  const lastClarification = findLast(turns, (t) =>
    t.role === "assistant" && t.kind === "clarification" && !t.answered
  ) as
    | ({ role: "assistant"; kind: "clarification" } & {
        questions: ClarificationQuestion[];
      })
    | undefined;

  // Decide what the bottom slot renders. Always render *something* so the
  // input area is never empty — that's what makes the page feel like a
  // proper chat. Priority:
  //   1. Clarification widget when the LLM asks a question.
  //   2. Follow-up composer once the report is ready.
  //   3. Passive "waiting" composer otherwise — shows the user where
  //      input would go and what state the run is in.
  const showClarification =
    phase === "awaiting_clarification" && !!lastClarification;
  const showFollowup = followupEnabled && !showClarification;

  return (
    // Grid rows: header / feed (fr). Composer is absolutely positioned
    // over the bottom of the feed so messages can scroll the full height
    // of the panel. The feed has bottom padding equal to the composer's
    // footprint so the last message scrolls fully into view.
    <section
      className="relative grid h-full min-h-0 bg-bg"
      style={{ gridTemplateRows: "auto minmax(0, 1fr)" }}
    >
      <header className="px-8 pt-7 pb-5">
        <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint">
          Research session
        </p>
        <h2 className="mt-1.5 font-serif text-3xl tracking-tight text-ink">
          {companyName}
        </h2>
      </header>

      <div className="overflow-y-auto px-8 pt-6 pb-40">
        {initialLoading ? (
          <FeedSkeleton />
        ) : turns.length === 0 ? (
          // Brief gap between auto-start and the first SSE event lands
          // here — render nothing so the page stays quiet rather than
          // flashing a placeholder. The node-status ticker will appear
          // as soon as `run_started` arrives.
          null
        ) : (
          <ol className="panel-reveal space-y-4">
            {groupNodeStatuses(
              turns.filter(
                (t) =>
                  !(t.role === "assistant" && t.kind === "clarification")
              )
            ).map((block, i) =>
              block.kind === "node_group" ? (
                <NodeStatusCard
                  key={i}
                  steps={block.steps}
                  job={job}
                  researchers={researchers}
                />
              ) : (
                <TurnView
                  key={i}
                  turn={block.turn}
                  onOpenReport={onOpenReport}
                  onOpenPlan={onOpenPlan}
                />
              )
            )}
            {followupTurns.map((t) => (
              <FollowupTurnView key={t.id} turn={t} />
            ))}
          </ol>
        )}
      </div>

      {/* Footer slot — floats above the feed so messages can scroll
          edge-to-edge. A soft top fade masks the scroll-into transition.
          The footer itself sits on top with a high z-index. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
        {/* Top fade — messages scroll under this and dissolve into the
            page background. pointer-events-none so it can't intercept. */}
        <div
          aria-hidden
          className="h-12 bg-gradient-to-t from-bg to-transparent"
        />
        <div className="pointer-events-auto bg-bg">
          {showClarification && lastClarification ? (
            <div className="px-6 pt-3 pb-5">
              <ClarificationCard
                questions={lastClarification.questions}
                submitting={streaming}
                error={error}
                onSubmit={(answers) =>
                  onAnswers(answers, lastClarification.questions)
                }
              />
            </div>
          ) : showFollowup ? (
            <FollowupComposer
              sending={followupSending}
              error={followupError}
              onSend={onFollowupSend}
            />
          ) : (
            <PassiveComposer phase={phase} />
          )}
          {error && phase !== "failed" && !showClarification ? (
            <div className="px-8 pb-3">
              <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-bad">
                {error}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
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

function PassiveComposer({ phase }: { phase: RunPhase }) {
  let hint = "Follow-up chat unlocks once the report is ready.";
  if (phase === "running")
    hint = "Agents are running — follow-up unlocks once the report is ready.";
  else if (phase === "failed") hint = "Run failed. Start a new brief to try again.";

  return (
    <div className="shrink-0 px-6 pt-2 pb-5">
      <div className="mx-auto w-full max-w-[36rem]">
        <div className="rounded-2xl bg-bg-elev px-4 pt-3 pb-2 opacity-70">
          <textarea
            rows={1}
            disabled
            placeholder={hint}
            className="block w-full resize-none bg-transparent text-[0.95rem] leading-relaxed text-ink-faint placeholder:text-ink-faint focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint">
              {hint}
            </p>
            <span
              aria-hidden
              className="font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-faint/70"
            >
              Send →
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TurnView({
  turn,
  onOpenReport,
  onOpenPlan,
}: {
  turn: ChatTurn;
  onOpenReport: () => void;
  onOpenPlan: () => void;
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
      // Rendered in the grouped NodeStatusCard above; never reached.
      return null;
    case "clarification":
      // Should be unreachable — filtered out at the feed level. Render
      // nothing rather than a stale card.
      return null;
    case "plan_ready":
      return (
        <li>
          <button
            type="button"
            onClick={onOpenPlan}
            className="group block w-full max-w-[78%] rounded-[20px] rounded-bl-[6px] bg-ink/[0.04] px-4 py-3 text-left transition-colors hover:bg-ink/[0.07]"
          >
            <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-accent">
              Plan ready
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink">
              Researchers are dispatched. Tap to open the plan in the workspace.
            </p>
          </button>
        </li>
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

function findLast<T>(arr: T[], pred: (x: T) => boolean): T | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return arr[i];
  }
  return undefined;
}

// ─── Node-status grouping ──────────────────────────────────────────────────

type NodeStatusTurn = Extract<ChatTurn, { kind: "node_status" }>;

type FeedBlock =
  | { kind: "node_group"; steps: NodeStatusTurn[] }
  | { kind: "turn"; turn: ChatTurn };

/** Fold consecutive node_status turns into one group so the feed shows a
 * single "Working" card instead of N free-floating bullet rows. */
function groupNodeStatuses(turns: ChatTurn[]): FeedBlock[] {
  const out: FeedBlock[] = [];
  let bucket: NodeStatusTurn[] = [];
  const flush = () => {
    if (bucket.length) {
      out.push({ kind: "node_group", steps: bucket });
      bucket = [];
    }
  };
  for (const t of turns) {
    if (t.role === "assistant" && t.kind === "node_status") {
      bucket.push(t);
    } else {
      flush();
      out.push({ kind: "turn", turn: t });
    }
  }
  flush();
  return out;
}

/** The five "phases" the run walks through. Phase 1 events arrive from
 * SSE; phase 2 is derived from polled job + researcher state. */
const RUN_PHASES: { id: number; label: string }[] = [
  { id: 1, label: "Checking the objective" },
  { id: 2, label: "Structuring the brief" },
  { id: 3, label: "Building the research plan" },
  { id: 4, label: "Researching" },
  { id: 5, label: "Writing the brief" },
];

type StepState = "done" | "live" | "pending" | "failed";

/** Five-dot progression strip + current-activity label. Gives the user a
 * visual sense of how far the run has come without showing every event
 * inline. Single line, compact, stays alive across phase 1 and 2. */
function NodeStatusCard({
  steps,
  job,
  researchers,
}: {
  steps: NodeStatusTurn[];
  job: ResearchJob | null;
  researchers: ResearcherResult[];
}) {
  // Defensively pick the latest phase per node, keeping arrival order.
  const ordered: NodeStatusTurn[] = [];
  const seen = new Map<string, number>();
  for (const s of steps) {
    const idx = seen.get(s.node);
    if (idx === undefined) {
      seen.set(s.node, ordered.length);
      ordered.push(s);
    } else {
      ordered[idx] = s;
    }
  }

  if (ordered.length === 0) return null;

  const states = computePhaseStates(ordered, job, researchers);
  const current =
    states.find((s) => s.state === "failed") ??
    states.find((s) => s.state === "live");
  if (!current) return null; // run is fully done — let the Document card carry the moment

  const isFailed = current.state === "failed";

  return (
    <li className="panel-reveal max-w-[80%]">
      <div
        className={`flex items-center gap-3.5 rounded-full bg-bg-elev/55 px-4 py-1.5 ${
          isFailed ? "ring-1 ring-bad/40" : ""
        }`}
      >
        {/* Five-dot progress strip */}
        <div
          className="flex shrink-0 items-center gap-1.5"
          role="progressbar"
          aria-valuenow={current.phase}
          aria-valuemin={1}
          aria-valuemax={RUN_PHASES.length}
        >
          {states.map((s, i) => (
            <PhaseDot key={i} state={s.state} />
          ))}
        </div>

        {/* Divider */}
        <span aria-hidden className="h-3 w-px shrink-0 bg-rule/15" />

        {/* Current activity label */}
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className={isFailed ? "text-bad" : "text-ink"}>
            {current.label}
          </span>
          {current.sublabel ? (
            <span className="ml-1.5 text-ink-faint">· {current.sublabel}</span>
          ) : null}
        </span>
      </div>

      {/* Inline error message for hard failures. */}
      {current.error ? (
        <p className="mt-1.5 px-4 text-xs leading-relaxed text-ink-faint">
          {current.error}
        </p>
      ) : null}
    </li>
  );
}

/** Render one dot in the progress strip. */
function PhaseDot({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span
        aria-hidden
        className="block h-1.5 w-1.5 rounded-full bg-accent/70"
      />
    );
  }
  if (state === "live") {
    return (
      <span aria-hidden className="relative grid h-1.5 w-1.5 place-items-center">
        <span className="absolute inset-[-3px] rounded-full bg-accent/25 animate-pulse-dot" />
        <span className="absolute inset-0 rounded-full bg-accent" />
      </span>
    );
  }
  if (state === "failed") {
    return <span aria-hidden className="block h-1.5 w-1.5 rounded-full bg-bad" />;
  }
  return (
    <span
      aria-hidden
      className="block h-1.5 w-1.5 rounded-full border border-ink-faint/30"
    />
  );
}

/** Derive the state of each of the 5 phases. Phase 1-3 read directly
 * from SSE node_status turns; phase 4-5 are derived from the polled job
 * + researcher rows (the SSE has long since closed by then). */
function computePhaseStates(
  ordered: NodeStatusTurn[],
  job: ResearchJob | null,
  researchers: ResearcherResult[]
): {
  phase: number;
  label: string;
  state: StepState;
  sublabel?: string;
  error?: string;
}[] {
  const NODE_TO_PHASE: Partial<Record<WorkflowNode, number>> = {
    clarify_with_user: 1,
    write_research_brief: 2,
    create_research_plan: 3,
  };

  const stepState: Record<number, StepState> = {
    1: "pending",
    2: "pending",
    3: "pending",
    4: "pending",
    5: "pending",
  };
  let errorBy: Partial<Record<number, string>> = {};

  // Phase 1 — read directly off SSE events.
  for (const s of ordered) {
    const p = NODE_TO_PHASE[s.node];
    if (p === undefined) continue;
    stepState[p] =
      s.phase === "completed" ? "done" : s.phase === "failed" ? "failed" : "live";
    if (s.phase === "failed" && s.error) errorBy[p] = s.error;
  }

  // Phase 1-3 fully done? Once they are, derive phase 4 + 5 from job/researchers.
  const phase1to3Done = [1, 2, 3].every((p) => stepState[p] === "done");

  if (phase1to3Done) {
    if (job?.status === "failed") {
      // Phase 2 failed at research/writing — mark phase 4 as the failed step.
      stepState[4] = "failed";
    } else if (job?.final_report || job?.status === "completed") {
      stepState[4] = "done";
      stepState[5] = "done";
    } else {
      // Job still running (or not yet fetched — backend auto-spawned it).
      // No reliable signal for "researchers done, now writing the brief",
      // so phase 4 stays live until the job is completed; phase 5 then
      // flips together with phase 4 as the Document card takes over.
      stepState[4] = "live";
    }
  }

  return RUN_PHASES.map(({ id, label }) => {
    let sublabel: string | undefined;
    if (id === 4 && stepState[4] === "live" && researchers.length > 0) {
      sublabel = `${researchers.length} ${
        researchers.length === 1 ? "agent" : "agents"
      } reported back`;
    }
    return {
      phase: id,
      label,
      state: stepState[id],
      sublabel,
      error: errorBy[id],
    };
  });
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
}: {
  sending: boolean;
  error: string | null;
  onSend: (text: string) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState("");

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
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

  const canSend = !!draft.trim() && !sending;

  return (
    <form onSubmit={submit} className="shrink-0 px-6 pt-2 pb-5">
      <div className="mx-auto w-full max-w-[36rem]">
        <div className="group/composer rounded-2xl bg-bg-elev px-4 pt-3 pb-2 transition-colors focus-within:bg-bg-elev/90">
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
            placeholder="Ask a follow-up about the report…"
            disabled={sending}
            className="block w-full resize-none bg-transparent text-[0.95rem] leading-relaxed text-ink placeholder:text-ink-faint/70 focus:outline-none disabled:opacity-50"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint">
              Grounded in the brief
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
