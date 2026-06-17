import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { ApiError, useApi } from "../../lib/api";

interface FormState {
  company_name: string;
  website: string;
  objective: string;
}

const EMPTY: FormState = { company_name: "", website: "", objective: "" };

/**
 * The brief composer reads as a single typeset sentence with inline
 * editable fields. Visitors *write* their brief instead of filling out
 * a form — every word on the page belongs to the actual request.
 */
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
    if (disabled) return;
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

  const filled =
    [form.company_name, form.website, form.objective].filter(
      (v) => v.trim().length > 0
    ).length;

  return (
    <form onSubmit={onSubmit} className="space-y-10">
      {/* Brief header — small typeset slip, anchors the composition. */}
      <div className="flex items-baseline justify-between gap-6 text-ink-faint">
        <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow">
          Brief · No. 01
        </p>
        <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow">
          {filled}/3 lines filled
        </p>
      </div>

      {/* The sentence. Wraps naturally. Each input is auto-sized to its
          contents using `field-sizing: content` (chrome/edge) with a
          width measurement fallback for safari/firefox. */}
      <div
        className="font-serif text-[1.0625rem] leading-[1.7] text-ink-soft md:text-[1.125rem]"
        style={{ fontVariationSettings: '"opsz" 32, "SOFT" 40' }}
      >
        <p>
          <span>Run a deep research on </span>
          <InlineField
            id="company_name"
            label="Company"
            value={form.company_name}
            onChange={(v) => set("company_name", v)}
            placeholder="company name"
            maxLength={200}
            minWidth={9}
          />
          <span>, found at </span>
          <InlineField
            id="website"
            label="Website"
            type="url"
            value={form.website}
            onChange={(v) => set("website", v)}
            placeholder="https://…"
            minWidth={10}
            mono
          />
          <span>, so we can</span>
        </p>

        <ObjectiveField
          value={form.objective}
          onChange={(v) => set("objective", v)}
        />
      </div>

      {/* Sign-off bar — a horizontal rule the user is "signing" beneath. */}
      <div className="pt-6">
        <div className="relative">
          <div
            aria-hidden
            className="h-px w-full bg-gradient-to-r from-transparent via-rule/25 to-transparent"
          />
          <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-1">
              <p
                className="font-display italic text-base text-ink-soft"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100' }}
              >
                {create.isPending
                  ? "Filing the brief…"
                  : disabled
                    ? "Three lines, then we're off."
                    : "When you're ready."}
              </p>
              {errorMessage ? (
                <p
                  role="alert"
                  className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-bad"
                >
                  {errorMessage}
                </p>
              ) : null}
            </div>
            <button
              type="submit"
              disabled={disabled}
              className="btn-primary"
            >
              {create.isPending ? (
                <>Sending<span className="arrow">…</span></>
              ) : (
                <>Begin research<span className="arrow">→</span></>
              )}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

// ─── Inline editable fields ───────────────────────────────────────────────

function InlineField({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  maxLength,
  minWidth = 8,
  mono = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  maxLength?: number;
  minWidth?: number;
  mono?: boolean;
}) {
  const ref = useRef<HTMLInputElement | null>(null);

  // field-sizing: content auto-shrinks to fit on Chromium. For safari +
  // firefox we mirror the value into a hidden span and copy its width.
  const sizerRef = useRef<HTMLSpanElement | null>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  useEffect(() => {
    if (!sizerRef.current) return;
    const w = sizerRef.current.offsetWidth;
    if (w > 0) setMeasured(w);
  }, [value, placeholder]);

  return (
    <span className="relative inline-flex items-baseline align-baseline">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {/* Hidden mirror — measures the would-be width of the typed
          text (or placeholder, when empty) so the input can match. */}
      <span
        ref={sizerRef}
        aria-hidden
        className={`pointer-events-none invisible absolute whitespace-pre ${
          mono ? "font-mono text-[0.95em]" : "font-serif"
        }`}
        style={{
          fontVariationSettings: '"opsz" 32, "SOFT" 40',
        }}
      >
        {value || placeholder}
      </span>
      <input
        ref={ref}
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        required
        className={`peer relative inline-block min-w-0 border-b border-rule/25 bg-transparent pb-0.5 text-ink transition-colors placeholder:text-ink-faint/60 focus:border-accent ${
          mono
            ? "font-mono text-[0.95em] tracking-tight"
            : "font-serif"
        }`}
        style={
          {
            width: measured
              ? `${Math.max(measured + 4, minWidth * 8)}px`
              : `${minWidth}ch`,
            fontVariationSettings: '"opsz" 32, "SOFT" 40',
            // Chromium-only native auto-sizing. Other engines fall
            // back to the JS-measured width above.
            fieldSizing: "content",
          } as React.CSSProperties
        }
      />
    </span>
  );
}

function ObjectiveField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <div className="mt-3">
      <label htmlFor="objective" className="sr-only">
        Objective
      </label>
      <div className="relative">
        <textarea
          id="objective"
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="…walk into the meeting knowing exactly where they stand."
          rows={2}
          maxLength={2000}
          required
          className="block w-full resize-none border-b border-rule/25 bg-transparent pb-2 font-serif text-ink leading-[1.55] transition-colors placeholder:text-ink-faint/60 focus:border-accent"
          style={{
            fontVariationSettings: '"opsz" 32, "SOFT" 40',
          }}
        />
      </div>
      <p
        className="mt-3 max-w-prose font-display italic text-sm text-ink-faint leading-relaxed"
        style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100' }}
      >
        Be specific. The brief is what every researcher will work from.
      </p>
    </div>
  );
}
