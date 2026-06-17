import { useCallback, useState } from "react";

import type { ClarificationQuestion } from "../../lib/types";

interface Props {
  questions: ClarificationQuestion[];
  submitting: boolean;
  error: string | null;
  onSubmit: (answers: string[]) => void;
}

/**
 * Claude-style clarification flow ported from research-assistant-ui.
 *
 * One question visible at a time; numbered chips that auto-advance on click.
 * "Something else" reveals a free-text input. On the last question, choosing
 * any answer auto-submits if the rest are filled in; otherwise the explicit
 * Submit appears in the footer. Prev/next chevrons let the user revisit.
 */
export function ClarificationCard({
  questions,
  submitting,
  error,
  onSubmit,
}: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [customInput, setCustomInput] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);

  const total = questions.length;
  const isLast = currentIndex === total - 1;
  const currentQuestion = questions[currentIndex];

  // Map the {question: answer} record onto the positional list the backend
  // expects ({"answers": string[]}). Missing answers come through as "".
  const submit = useCallback(
    (filled: Record<string, string>) => {
      onSubmit(questions.map((q) => filled[q.question]?.trim() ?? ""));
    },
    [onSubmit, questions]
  );

  const selectAnswer = useCallback(
    (question: string, answer: string) => {
      const next = { ...answers, [question]: answer };
      setAnswers(next);
      setShowCustomInput(false);
      setCustomInput("");
      if (!isLast) {
        setCurrentIndex((i) => i + 1);
        return;
      }
      // Last question — submit if every question has an answer.
      const allDone = questions.every((q) => next[q.question]?.trim());
      if (allDone) submit(next);
    },
    [answers, isLast, questions, submit]
  );

  const handleCustomConfirm = useCallback(() => {
    const trimmed = customInput.trim();
    if (!trimmed || !currentQuestion) return;
    selectAnswer(currentQuestion.question, trimmed);
  }, [customInput, currentQuestion, selectAnswer]);

  const handleSkip = useCallback(() => {
    if (!isLast) setCurrentIndex((i) => i + 1);
  }, [isLast]);

  const allAnswered = questions.every((q) => answers[q.question]?.trim());

  if (!currentQuestion) return null;
  const currentAnswer = answers[currentQuestion.question];
  const canSubmit = isLast && allAnswered;

  return (
    <div className="mx-auto w-full max-w-[40rem] rounded-2xl bg-accent/[0.06] px-5 py-4">
      {/* Top row — eyebrow + step counter */}
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-accent">
          Quick clarification
        </p>
        <div className="flex items-center gap-1.5">
          <NavChevron
            dir="left"
            disabled={currentIndex === 0}
            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
          />
          <span className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint tabular-nums">
            {String(currentIndex + 1).padStart(2, "0")}
            <span className="mx-1 text-ink-faint/50">/</span>
            {String(total).padStart(2, "0")}
          </span>
          <NavChevron
            dir="right"
            disabled={isLast}
            onClick={() => setCurrentIndex((i) => Math.min(total - 1, i + 1))}
          />
        </div>
      </div>

      {/* Question */}
      <p className="mt-2.5 font-serif text-[1.0625rem] leading-snug text-ink">
        {currentQuestion.question}
      </p>

      {/* Suggested answer chips — wrap naturally. */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {currentQuestion.suggested_answers.map((answer) => {
          const isSelected = currentAnswer === answer;
          return (
            <button
              key={answer}
              type="button"
              onClick={() => selectAnswer(currentQuestion.question, answer)}
              disabled={submitting}
              className={`rounded-full px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ${
                isSelected
                  ? "bg-accent text-bg"
                  : "bg-bg-elev/60 text-ink-soft hover:bg-bg-elev hover:text-ink"
              }`}
            >
              {answer}
            </button>
          );
        })}

        {/* "Something else" — either a chip or an inline expander. */}
        {showCustomInput ? (
          <div className="mt-1 flex w-full items-center gap-2 rounded-full bg-bg-elev px-3 py-1">
            <PencilIcon className="text-ink-faint" />
            <input
              autoFocus
              type="text"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCustomConfirm();
                } else if (e.key === "Escape") {
                  setShowCustomInput(false);
                  setCustomInput("");
                }
              }}
              placeholder="Type your answer…"
              disabled={submitting}
              className="flex-1 bg-transparent py-1 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
            />
            <button
              type="button"
              onClick={handleCustomConfirm}
              disabled={!customInput.trim() || submitting}
              className="rounded-full px-2 py-0.5 font-mono text-[0.625rem] uppercase tracking-eyebrow text-accent transition-opacity hover:opacity-80 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setShowCustomInput(true);
              setAnswers((prev) => {
                const next = { ...prev };
                delete next[currentQuestion.question];
                return next;
              });
            }}
            disabled={submitting}
            className="flex items-center gap-1.5 rounded-full bg-bg-elev/40 px-3 py-1.5 text-sm text-ink-faint transition-colors hover:bg-bg-elev/80 hover:text-ink-soft disabled:opacity-50"
          >
            <PencilIcon className="text-ink-faint" />
            <span>
              {currentAnswer &&
              !currentQuestion.suggested_answers.includes(currentAnswer)
                ? currentAnswer
                : "Something else"}
            </span>
          </button>
        )}
      </div>

      {/* Action row — only a single trailing action, no chrome on the left. */}
      <div className="mt-3 flex items-center justify-end gap-3">
        {error ? (
          <p className="mr-auto font-mono text-[0.625rem] uppercase tracking-eyebrow text-bad">
            {error}
          </p>
        ) : null}
        {canSubmit ? (
          <button
            type="button"
            onClick={() => submit(answers)}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-sm text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? (
              <>
                <span className="block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-r-transparent" />
                Sending
              </>
            ) : (
              <>
                Send answers
                <span aria-hidden>→</span>
              </>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSkip}
            disabled={isLast || submitting}
            className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint transition-colors hover:text-ink-soft disabled:opacity-30"
          >
            Skip →
          </button>
        )}
      </div>
    </div>
  );
}

function NavChevron({
  dir,
  disabled,
  onClick,
}: {
  dir: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "left" ? "Previous question" : "Next question"}
      className="grid h-5 w-5 place-items-center rounded text-ink-faint transition-colors enabled:hover:bg-ink/[0.05] enabled:hover:text-ink disabled:opacity-30"
    >
      <ChevronIcon dir={dir} />
    </button>
  );
}

// ─── icons ─────────────────────────────────────────────────────────────────

function ChevronIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {dir === "left" ? (
        <path d="M9 11L5 7l4-4" />
      ) : (
        <path d="M5 3l4 4-4 4" />
      )}
    </svg>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M8.5 1.5l2 2-7 7H1.5v-2l7-7z" />
    </svg>
  );
}
