import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { ApiError, useApi } from "../../lib/api";

interface FormState {
  company_name: string;
  website: string;
  objective: string;
}

const EMPTY: FormState = { company_name: "", website: "", objective: "" };

export function SessionForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const api = useApi();
  const [form, setForm] = useState<FormState>(EMPTY);

  const create = useMutation({
    mutationFn: () => api.sessions.create(form),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      navigate(`/app/sessions/${session.id}`);
    },
  });

  const errorMessage =
    create.error instanceof ApiError
      ? create.error.message
      : create.error
        ? "Something went wrong"
        : null;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const disabled =
    create.isPending ||
    form.company_name.trim().length === 0 ||
    form.website.trim().length === 0 ||
    form.objective.trim().length === 0;

  return (
    <form onSubmit={onSubmit} className="space-y-9">
      <Field label="Company" htmlFor="company_name">
        <input
          id="company_name"
          name="company_name"
          value={form.company_name}
          onChange={(e) => set("company_name", e.target.value)}
          placeholder="e.g. Stripe"
          autoComplete="off"
          maxLength={200}
          required
          className="input"
        />
      </Field>

      <Field label="Website" htmlFor="website">
        <input
          id="website"
          name="website"
          type="url"
          value={form.website}
          onChange={(e) => set("website", e.target.value)}
          placeholder="https://stripe.com"
          autoComplete="off"
          required
          className="input"
        />
      </Field>

      <Field
        label="Objective"
        htmlFor="objective"
        hint={
          <>
            What do you want to leave the meeting <em className="not-italic font-display italic text-ink-soft">knowing?</em>
          </>
        }
      >
        <textarea
          id="objective"
          name="objective"
          value={form.objective}
          onChange={(e) => set("objective", e.target.value)}
          placeholder="Evaluate as a partner for our developer-experience product"
          rows={3}
          maxLength={2000}
          required
          className="input resize-y min-h-[5.5rem]"
        />
      </Field>

      {errorMessage && (
        <div
          role="alert"
          className="font-mono text-xs uppercase tracking-wider text-bad border-l-2 border-bad/60 pl-3 py-1"
        >
          {errorMessage}
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <p className="font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-faint">
          {create.isPending ? "Filing the brief" : "Ready when you are"}
        </p>
        <button type="submit" disabled={disabled} className="btn-primary">
          {create.isPending ? (
            <>
              Submitting<span className="arrow">…</span>
            </>
          ) : (
            <>
              Begin research<span className="arrow">→</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={htmlFor} className="field-label">
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-xs text-ink-faint italic font-display leading-relaxed"
          style={{ fontVariationSettings: '"opsz" 14, "SOFT" 100' }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
