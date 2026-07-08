import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, useApi } from "../lib/api";
import type { CompanyContext } from "../lib/types";

const EMPTY: CompanyContext = {
  what_you_sell: "",
  value_props: "",
  icp: "",
  differentiators: "",
  proof_points: "",
  notes: "",
};

type FieldKey = keyof CompanyContext;

interface FieldDef {
  key: FieldKey;
  group: string;
  nav: string;
  label: string;
  hint: string;
  placeholder: string;
  rows: number; // 0 → single-line input
  optional?: boolean;
}

const FIELDS: FieldDef[] = [
  {
    key: "what_you_sell",
    group: "Offering",
    nav: "The product",
    label: "What you sell",
    hint: "One line. Your product or service.",
    placeholder: "An AI research copilot for B2B sales teams",
    rows: 0,
  },
  {
    key: "value_props",
    group: "Offering",
    nav: "Value props",
    label: "Value propositions",
    hint: "The benefits you lead with.",
    placeholder:
      "Cut meeting prep, walk in with a tailored angle, never miss a buying signal.",
    rows: 3,
  },
  {
    key: "icp",
    group: "Offering",
    nav: "Who you sell to",
    label: "Who you sell to",
    hint: "Your ideal customer profile.",
    placeholder: "Revenue and sales-ops leaders at Series B to D SaaS companies.",
    rows: 2,
  },
  {
    key: "differentiators",
    group: "Positioning",
    nav: "Differentiators",
    label: "Differentiators",
    hint: "Why you, versus the alternatives.",
    placeholder: "Grounded, cited research; a pitch built per account, not generic.",
    rows: 2,
  },
  {
    key: "proof_points",
    group: "Positioning",
    nav: "Proof",
    label: "Proof points",
    hint: "Metrics, customers, case studies.",
    placeholder: "Used by 40+ teams; cuts prep from 2 hours to 5 minutes.",
    rows: 2,
  },
  {
    key: "notes",
    group: "Positioning",
    nav: "Anything else",
    label: "Anything else",
    hint: "Boilerplate or notes to pitch from.",
    placeholder: "Optional.",
    rows: 4,
    optional: true,
  },
];

const REQUIRED = FIELDS.filter((f) => !f.optional).map((f) => f.key);
const GROUPS = FIELDS.reduce<string[]>((acc, f) => {
  if (!acc.includes(f.group)) acc.push(f.group);
  return acc;
}, []);

export default function CompanyProfile() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CompanyContext>(EMPTY);
  const [saved, setSaved] = useState(false);
  const [active, setActive] = useState<FieldKey>(FIELDS[0].key);
  const [site, setSite] = useState("");

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const inputRefs = useRef<
    Record<string, HTMLInputElement | HTMLTextAreaElement | null>
  >({});

  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => api.me.get() });

  useEffect(() => {
    if (meQuery.data?.company_context) {
      setForm({ ...EMPTY, ...meQuery.data.company_context });
    }
  }, [meQuery.data]);

  const save = useMutation({
    mutationFn: () => api.me.updateCompanyContext(form),
    onSuccess: (user) => {
      queryClient.setQueryData(["me"], user);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    },
  });

  function set<K extends keyof CompanyContext>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  // Autofill: scrape the seller's site and fill blanks. Site-derived values
  // win where present; manually-entered fields are kept where the site was silent.
  const autofill = useMutation({
    mutationFn: () => api.me.draftCompanyContext(site),
    onSuccess: (draft) => {
      setForm((prev) => {
        const next = { ...prev };
        for (const f of FIELDS) {
          const v = (draft[f.key] ?? "").trim();
          if (v) next[f.key] = v;
        }
        return next;
      });
      setSaved(false);
    },
  });

  const autofillError =
    autofill.error instanceof ApiError
      ? autofill.error.message
      : autofill.error
        ? "Could not read that site"
        : null;

  // Scroll-spy: track which field is under the reading line as you scroll.
  useEffect(() => {
    if (meQuery.isLoading) return;
    const root = scrollRef.current;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const key = e.target.getAttribute("data-field");
          if (!key) continue;
          if (e.isIntersecting) visible.add(key);
          else visible.delete(key);
        }
        const first = FIELDS.find((f) => visible.has(f.key));
        if (first) setActive(first.key);
      },
      { root, rootMargin: "-20% 0px -68% 0px", threshold: 0 }
    );
    for (const f of FIELDS) {
      const el = sectionRefs.current[f.key];
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [meQuery.isLoading]);

  function jumpTo(key: FieldKey) {
    const el = sectionRefs.current[key];
    const input = inputRefs.current[key];
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    input?.focus({ preventScroll: true });
    setActive(key);
  }

  const doneCount = useMemo(
    () => REQUIRED.filter((k) => form[k].trim().length > 0).length,
    [form]
  );

  const error =
    save.error instanceof ApiError
      ? save.error.message
      : save.error
        ? "Could not save"
        : null;

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto px-6 md:px-10 lg:px-14 pt-10 md:pt-12 pb-28"
    >
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="flex items-baseline justify-between gap-6 pb-3 hairline-b">
          <p className="eyebrow">Your company</p>
          <div className="flex items-center gap-4">
            {saved ? (
              <span className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-good">
                Saved
              </span>
            ) : null}
            <button
              type="submit"
              form="company-context-form"
              disabled={save.isPending || meQuery.isLoading}
              className="btn-primary"
            >
              {save.isPending ? (
                <>
                  Saving<span className="arrow">…</span>
                </>
              ) : (
                <>
                  Save<span className="arrow">→</span>
                </>
              )}
            </button>
          </div>
        </div>

        <h1
          className="mt-8 font-display text-[2rem] leading-[1.02] text-ink md:text-[2.6rem]"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 60' }}
        >
          What you're selling.
        </h1>
        <p className="mt-4 max-w-xl text-[0.9375rem] leading-relaxed text-ink-soft">
          Set this once. We reuse it on every research to build the pitch around what
          you offer. Leave it blank to get research only, no pitch.
        </p>

        {/* Autofill: draft the profile from the seller's own website. */}
        <div className="mt-8 rounded-2xl bg-ink/[0.03] px-5 py-4 ring-1 ring-rule/10">
          <div className="flex items-center gap-2">
            <span className="h-[5px] w-[5px] rounded-full bg-accent" />
            <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint">
              Autofill from your website
            </p>
          </div>
          <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-soft">
            Paste your site and we'll read it into a draft. Review and tweak before saving.
          </p>
          <form
            className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center"
            onSubmit={(e) => {
              e.preventDefault();
              if (site.trim() && !autofill.isPending) autofill.mutate();
            }}
          >
            <input
              value={site}
              onChange={(e) => setSite(e.target.value)}
              placeholder="yourcompany.com"
              inputMode="url"
              autoComplete="url"
              className={`${inputClass} sm:flex-1`}
            />
            <button
              type="submit"
              disabled={autofill.isPending || site.trim().length === 0}
              className="btn-primary shrink-0 disabled:opacity-40"
            >
              {autofill.isPending ? (
                <>
                  Reading<span className="arrow">…</span>
                </>
              ) : (
                <>
                  Autofill<span className="arrow">→</span>
                </>
              )}
            </button>
          </form>
          {autofill.isPending ? (
            <p className="mt-2 font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint/70">
              Scraping the site and drafting your profile
            </p>
          ) : autofillError ? (
            <p className="mt-2 font-mono text-[0.625rem] uppercase tracking-eyebrow text-bad">
              {autofillError}
            </p>
          ) : autofill.isSuccess ? (
            <p className="mt-2 font-mono text-[0.625rem] uppercase tracking-eyebrow text-good">
              Drafted — review below, then save
            </p>
          ) : null}
        </div>

        {/* Completion navigator: horizontal jump strip + scroll-spy. */}
        <nav className="mt-10">
          <SectionNav
            form={form}
            active={active}
            done={doneCount}
            total={REQUIRED.length}
            onJump={jumpTo}
            loading={meQuery.isLoading}
          />
        </nav>

        <div className="mt-10 max-w-2xl">
          {meQuery.isLoading ? (
            <FormSkeleton />
          ) : (
            <form
              id="company-context-form"
              className="min-w-0 space-y-12"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
            >
              {GROUPS.map((group, gi) => (
                <section key={group}>
                  <p className="mb-6 flex items-baseline gap-2 font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint">
                    <span className="text-ink-faint/50">
                      {String(gi + 1).padStart(2, "0")}
                    </span>
                    {group}
                  </p>
                  <div className="space-y-7">
                    {FIELDS.filter((f) => f.group === group).map((f) => (
                      <div
                        key={f.key}
                        data-field={f.key}
                        ref={(el) => {
                          sectionRefs.current[f.key] = el;
                        }}
                        className="scroll-mt-4"
                      >
                        <label className="block">
                          <span className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
                            {f.label}
                            {f.optional ? (
                              <span className="font-mono text-[0.5625rem] uppercase tracking-wider text-ink-faint/60">
                                optional
                              </span>
                            ) : null}
                          </span>
                          {f.rows === 0 ? (
                            <input
                              ref={(el) => {
                                inputRefs.current[f.key] = el;
                              }}
                              value={form[f.key]}
                              onChange={(e) => set(f.key, e.target.value)}
                              onFocus={() => setActive(f.key)}
                              placeholder={f.placeholder}
                              maxLength={300}
                              className={inputClass}
                            />
                          ) : (
                            <textarea
                              ref={(el) => {
                                inputRefs.current[f.key] = el;
                              }}
                              value={form[f.key]}
                              onChange={(e) => set(f.key, e.target.value)}
                              onFocus={() => setActive(f.key)}
                              placeholder={f.placeholder}
                              rows={f.rows}
                              className={`${inputClass} resize-none leading-relaxed`}
                            />
                          )}
                          <span className="mt-1.5 block text-xs text-ink-faint/75">
                            {f.hint}
                          </span>
                        </label>
                      </div>
                    ))}
                  </div>
                </section>
              ))}

              {error ? (
                <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-bad">
                  {error}
                </p>
              ) : null}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionNav({
  form,
  active,
  done,
  total,
  onJump,
  loading,
}: {
  form: CompanyContext;
  active: FieldKey;
  done: number;
  total: number;
  onJump: (key: FieldKey) => void;
  loading: boolean;
}) {
  const complete = done === total;
  return (
    <div className="py-4 hairline-b">
      {/* Meta row: label + segmented progress meter. */}
      <div className="flex items-baseline justify-between gap-4">
        <span className="eyebrow">Your profile</span>
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1" aria-hidden>
            {Array.from({ length: total }).map((_, i) => (
              <span
                key={i}
                className={`h-[3px] w-4 rounded-full transition-colors duration-500 ${
                  !loading && i < done
                    ? complete
                      ? "bg-good"
                      : "bg-accent"
                    : "bg-ink/[0.12]"
                }`}
              />
            ))}
          </div>
          <span
            className={`font-mono text-[0.6875rem] tabular-nums tracking-wide ${
              complete ? "text-good" : "text-ink-soft"
            }`}
          >
            {loading ? "…" : complete ? "Complete" : `${done} / ${total}`}
          </span>
        </div>
      </div>

      {/* Numbered editorial index — click to jump, active slides an accent rule. */}
      <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-3">
        {FIELDS.map((f, i) => {
          const filled = form[f.key].trim().length > 0;
          const isActive = active === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => onJump(f.key)}
              className="group flex items-baseline gap-2 text-left"
            >
              <span
                className={`font-mono text-[0.625rem] tabular-nums transition-colors duration-300 ${
                  filled ? "text-accent" : "text-ink-faint/45"
                }`}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                className={`relative text-[0.8125rem] leading-none transition-colors duration-200 ${
                  isActive
                    ? "text-ink"
                    : filled
                      ? "text-ink-soft group-hover:text-ink"
                      : "text-ink-faint group-hover:text-ink-soft"
                }`}
              >
                {f.nav}
                <span
                  className={`absolute -bottom-1.5 left-0 h-px bg-accent transition-all duration-300 ease-out ${
                    isActive ? "w-full opacity-100" : "w-0 opacity-0"
                  }`}
                />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg bg-ink/[0.04] px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint/50 focus:outline-none focus:ring-1 focus:ring-accent/40";

function FormSkeleton() {
  return (
    <div className="min-w-0 animate-pulse space-y-6" aria-busy>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="space-y-2">
          <div className="h-3.5 w-32 rounded bg-ink/10" />
          <div className="h-10 w-full rounded-lg bg-ink/5" />
        </div>
      ))}
    </div>
  );
}
