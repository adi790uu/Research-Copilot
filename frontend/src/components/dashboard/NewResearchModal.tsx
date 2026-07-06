import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { ApiError, useApi } from "../../lib/api";
import type { BriefPage } from "../../lib/types";

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

export function NewResearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.briefs.create({
        company_name: form.company_name.trim(),
        website: form.website.trim(),
        objective: form.objective.trim(),
        ...(form.contact_name.trim() ? { contact_name: form.contact_name.trim() } : {}),
        ...(form.contact_email.trim() ? { contact_email: form.contact_email.trim() } : {}),
      }),
    onSuccess: (brief) => {
      queryClient.setQueriesData<BriefPage>({ queryKey: ["briefs"] }, (prev) =>
        prev && {
          ...prev,
          total: prev.total + 1,
          items:
            prev.offset === 0 ? [brief, ...prev.items].slice(0, prev.limit) : prev.items,
        },
      );
      onClose();
      setForm(EMPTY);
      navigate("/app/researches");
    },
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => firstFieldRef.current?.focus(), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      setForm(EMPTY);
      create.reset();
    }
    // Reset only when the modal (re)opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const disabled =
    create.isPending ||
    form.company_name.trim().length === 0 ||
    form.website.trim().length === 0 ||
    form.objective.trim().length === 0;

  const errorMessage =
    create.error instanceof ApiError
      ? create.error.message
      : create.error
        ? "Something went wrong"
        : null;

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (disabled) return;
    create.mutate();
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
        onClick={onClose}
        className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
      />

      <form
        onSubmit={onSubmit}
        className="relative w-full max-w-lg rounded-2xl bg-bg-elev p-6 shadow-2xl shadow-black/30 stagger md:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">New research</p>
            <h2
              id="new-research-title"
              className="mt-1.5 font-display text-[1.5rem] leading-tight text-ink"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 60' }}
            >
              Brief the team.
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-faint transition-colors hover:bg-ink/[0.06] hover:text-ink"
          >
            <CloseIcon />
          </button>
        </div>

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

        {errorMessage ? (
          <p
            role="alert"
            className="mt-4 font-mono text-[0.625rem] uppercase tracking-eyebrow text-bad"
          >
            {errorMessage}
          </p>
        ) : null}

        <div className="mt-7 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={disabled} className="btn-primary">
            {create.isPending ? (
              <>Starting<span className="arrow">…</span></>
            ) : (
              <>Begin research<span className="arrow">→</span></>
            )}
          </button>
        </div>
      </form>
    </div>,
    document.body,
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

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
