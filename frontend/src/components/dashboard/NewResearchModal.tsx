import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { useResearchWizard } from "../../hooks/useResearchWizard";
import type {
  Brief,
  ClarificationAnswer,
  ClarificationQuestion,
  ResearchPlan,
} from "../../lib/types";

interface FormState {
  company_name: string;
  website: string;
  objective: string;
  contact_name: string;
  contact_email: string;
}

const EMPTY: FormState = {
  company_name: "",
  website: "",
  objective: "",
  contact_name: "",
  contact_email: "",
};

export function NewResearchModal({
  open,
  onClose,
  resumeBrief,
}: {
  open: boolean;
  onClose: () => void;
  /** When set, reopen this paused brief at its clarify/plan step instead of a
   * fresh form. */
  resumeBrief?: Brief | null;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const wizard = useResearchWizard();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [starting, setStarting] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => firstFieldRef.current?.focus(), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open) {
      setForm(EMPTY);
      setStarting(false);
      if (resumeBrief) wizard.resume(resumeBrief);
      else wizard.reset();
    }
    // Reset / resume only when the modal (re)opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  function handleClose() {
    // A brief may already exist (created when phase-1 started); refresh the
    // archive so it shows up under Researches.
    if (wizard.briefId) queryClient.invalidateQueries({ queryKey: ["briefs"] });
    wizard.reset();
    onClose();
  }

  async function handleStart() {
    if (starting) return;
    setStarting(true);
    try {
      await wizard.approve();
      queryClient.invalidateQueries({ queryKey: ["briefs"] });
      wizard.reset();
      onClose();
      navigate("/app/researches");
    } catch {
      // Leave the modal on the plan step so the user can retry.
      setStarting(false);
    }
  }

  const disabled =
    form.company_name.trim().length === 0 ||
    form.website.trim().length === 0 ||
    form.objective.trim().length === 0;

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (disabled) return;
    wizard.start({
      company_name: form.company_name.trim(),
      website: form.website.trim(),
      objective: form.objective.trim(),
      ...(form.contact_name.trim() ? { contact_name: form.contact_name.trim() } : {}),
      ...(form.contact_email.trim() ? { contact_email: form.contact_email.trim() } : {}),
    });
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-research-title"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={handleClose}
        className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
      />

      <div className="relative w-full max-w-lg rounded-2xl bg-bg-elev p-6 shadow-2xl shadow-black/30 stagger md:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">New research</p>
            <h2
              id="new-research-title"
              className="mt-1.5 font-display text-[1.5rem] leading-tight text-ink"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 60' }}
            >
              {stepTitle(wizard.step)}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-faint transition-colors hover:bg-ink/[0.06] hover:text-ink"
          >
            <CloseIcon />
          </button>
        </div>

        {wizard.step === "form" ? (
          <form onSubmit={onSubmit}>
            <div className="mt-6 space-y-4">
              <Field label="Company name" required>
                <input
                  ref={firstFieldRef}
                  value={form.company_name}
                  onChange={(e) => set("company_name", e.target.value)}
                  placeholder="e.g. Stripe"
                  maxLength={200}
                  className={inputClass}
                />
              </Field>

              <Field label="Website" required>
                <input
                  type="url"
                  value={form.website}
                  onChange={(e) => set("website", e.target.value)}
                  placeholder="https://…"
                  className={`${inputClass} font-mono text-[0.8125rem]`}
                />
              </Field>

              <Field label="Objective" required hint="What should the research deliver?">
                <textarea
                  value={form.objective}
                  onChange={(e) => set("objective", e.target.value)}
                  placeholder="Walk into the meeting knowing exactly where they stand."
                  rows={3}
                  maxLength={2000}
                  className={`${inputClass} resize-none leading-relaxed`}
                />
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Meeting contact" optional>
                  <input
                    value={form.contact_name}
                    onChange={(e) => set("contact_name", e.target.value)}
                    placeholder="Their name"
                    maxLength={200}
                    className={inputClass}
                  />
                </Field>
                <Field label="Contact email" optional>
                  <input
                    type="email"
                    value={form.contact_email}
                    onChange={(e) => set("contact_email", e.target.value)}
                    placeholder="name@company.com"
                    className={`${inputClass} font-mono text-[0.8125rem]`}
                  />
                </Field>
              </div>
            </div>

            <div className="mt-7 flex items-center justify-end gap-3">
              <button type="button" onClick={handleClose} className="btn-ghost">
                Cancel
              </button>
              <button type="submit" disabled={disabled} className="btn-primary">
                Begin research<span className="arrow">→</span>
              </button>
            </div>
          </form>
        ) : wizard.step === "running" ? (
          <RunningStep />
        ) : wizard.step === "clarify" ? (
          <ClarifyStep questions={wizard.questions} onSubmit={wizard.submitAnswers} />
        ) : wizard.step === "plan" && wizard.plan ? (
          <PlanStep
            plan={wizard.plan}
            onCancel={handleClose}
            onStart={handleStart}
            starting={starting}
          />
        ) : (
          <ErrorStep
            message={wizard.error ?? "Something went wrong"}
            onRetry={() =>
              wizard.start({
                company_name: form.company_name.trim(),
                website: form.website.trim(),
                objective: form.objective.trim(),
                ...(form.contact_name.trim() ? { contact_name: form.contact_name.trim() } : {}),
                ...(form.contact_email.trim() ? { contact_email: form.contact_email.trim() } : {}),
              })
            }
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

function stepTitle(step: string): string {
  switch (step) {
    case "clarify":
      return "A few quick questions.";
    case "plan":
      return "Here's the plan.";
    case "running":
      return "Working on it.";
    case "error":
      return "That didn't work.";
    default:
      return "Brief the team.";
  }
}

function RunningStep() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <Spinner />
      <p className="text-sm text-ink-soft">Thinking through your brief…</p>
    </div>
  );
}

function ClarifyStep({
  questions,
  onSubmit,
}: {
  questions: ClarificationQuestion[];
  onSubmit: (answers: ClarificationAnswer[]) => void;
}) {
  // Per-question: the picked chip and any free-text override. The free text wins
  // when present, so a user can start from a suggestion and refine it.
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});

  const answerFor = (i: number) => (custom[i]?.trim() ? custom[i].trim() : (picked[i] ?? ""));
  const complete = questions.every((_, i) => answerFor(i).length > 0);

  function submit() {
    if (!complete) return;
    onSubmit(questions.map((q, i) => ({ question: q.question, answer: answerFor(i) })));
  }

  return (
    <div>
      <div className="mt-6 max-h-[55vh] space-y-6 overflow-y-auto pr-1">
        {questions.map((q, i) => (
          <div key={i}>
            <p className="text-sm font-medium leading-snug text-ink">{q.question}</p>
            {q.suggested_answers.length > 0 ? (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {q.suggested_answers.map((sa) => {
                  const active = (custom[i]?.trim() ? "" : picked[i]) === sa;
                  return (
                    <button
                      key={sa}
                      type="button"
                      onClick={() => {
                        setPicked((p) => ({ ...p, [i]: sa }));
                        setCustom((c) => ({ ...c, [i]: "" }));
                      }}
                      className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                        active
                          ? "bg-accent/15 text-accent ring-1 ring-accent/40"
                          : "bg-ink/[0.04] text-ink-soft hover:bg-ink/[0.08]"
                      }`}
                    >
                      {sa}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <input
              value={custom[i] ?? ""}
              onChange={(e) => setCustom((c) => ({ ...c, [i]: e.target.value }))}
              placeholder="Or type your own…"
              className="mt-2.5 w-full rounded-lg bg-ink/[0.04] px-3 py-2 text-sm text-ink placeholder:text-ink-faint/55 focus:outline-none"
            />
          </div>
        ))}
      </div>

      <div className="mt-7 flex items-center justify-end gap-3">
        <button type="button" onClick={submit} disabled={!complete} className="btn-primary">
          Continue<span className="arrow">→</span>
        </button>
      </div>
    </div>
  );
}

function PlanStep({
  plan,
  onCancel,
  onStart,
  starting,
}: {
  plan: ResearchPlan;
  onCancel: () => void;
  onStart: () => void;
  starting: boolean;
}) {
  return (
    <div>
      <div className="mt-6 max-h-[55vh] space-y-6 overflow-y-auto pr-1">
        <PlanBlock label="Goal">
          <p className="text-[0.9375rem] leading-relaxed text-ink">{plan.research_goal}</p>
        </PlanBlock>
        {plan.coverage_angles.length > 0 ? (
          <PlanBlock label="Coverage">
            <ul className="space-y-2.5">
              {plan.coverage_angles.map((angle, i) => (
                <li
                  key={i}
                  className="flex gap-3 text-[0.9375rem] leading-relaxed text-ink-soft"
                >
                  <span className="mt-[0.5rem] h-1 w-1 shrink-0 rounded-full bg-accent/60" />
                  <span>{angle}</span>
                </li>
              ))}
            </ul>
          </PlanBlock>
        ) : null}
      </div>

      <div className="mt-7 flex items-center justify-end gap-3">
        <button type="button" onClick={onCancel} disabled={starting} className="btn-ghost">
          Cancel
        </button>
        <button type="button" onClick={onStart} disabled={starting} className="btn-primary">
          {starting ? (
            <>Starting<span className="arrow">…</span></>
          ) : (
            <>Start research<span className="arrow">→</span></>
          )}
        </button>
      </div>
    </div>
  );
}

function PlanBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function ErrorStep({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-6">
      <div className="border-l-2 border-bad/60 pl-4">
        <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-bad">
          Research could not start
        </p>
        <p className="mt-2 text-sm text-ink-soft">{message}</p>
      </div>
      <div className="mt-7 flex items-center justify-end">
        <button type="button" onClick={onRetry} className="btn-primary">
          Try again<span className="arrow">→</span>
        </button>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg bg-ink/[0.04] px-3 py-2 text-sm text-ink placeholder:text-ink-faint/55 focus:outline-none focus:ring-1 focus:ring-accent/40";

function Field({
  label,
  required,
  optional,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-2">
        <span className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-soft">
          {label}
        </span>
        {optional ? (
          <span className="font-mono text-[0.5625rem] uppercase tracking-wider text-ink-faint/70">
            optional
          </span>
        ) : null}
        {required ? <span className="text-accent">*</span> : null}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-ink-faint/80">{hint}</span> : null}
    </label>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" width={22} height={22} fill="none" className="animate-spin text-accent" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={2} opacity={0.25} />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
