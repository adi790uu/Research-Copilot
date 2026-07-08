import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ApiError, useApi } from "../lib/api";
import { statusLabel, statusTone, Status } from "../components/ui/Pill";
import type { PersonReport, Pitch, ReportContent, Source } from "../lib/types";

type Tab = "research" | "contact" | "pitch";

export default function ResearchDashboard() {
  const { briefId = "" } = useParams();
  const api = useApi();
  const [tab, setTab] = useState<Tab>("research");

  const briefQuery = useQuery({
    queryKey: ["brief", briefId],
    queryFn: () => api.briefs.get(briefId),
    enabled: Boolean(briefId),
  });
  const jobQuery = useQuery({
    queryKey: ["brief-job", briefId],
    queryFn: () => api.briefs.latestJob(briefId),
    enabled: Boolean(briefId),
    retry: false,
  });

  const brief = briefQuery.data;
  const job = jobQuery.data;
  const company = job?.company_report ?? null;
  const person = job?.person_report ?? null;
  const pitch = job?.pitch ?? null;

  return (
    <div className="mx-auto h-full max-w-6xl overflow-y-auto px-6 md:px-10 lg:px-14 pt-10 md:pt-14 pb-24">
      <Link to="/app/researches" className="btn-ghost">
        ← Researches
      </Link>

      {briefQuery.isLoading || jobQuery.isLoading ? (
        <SkeletonReport />
      ) : jobQuery.error ? (
        <Notice
          title="No report yet"
          body={
            jobQuery.error instanceof ApiError
              ? jobQuery.error.message
              : "This research has no report to show."
          }
        />
      ) : (
        <>
          <div className="mt-8 flex items-baseline justify-between gap-4 pb-3 hairline-b">
            <p className="eyebrow">Research</p>
            {brief ? (
              <Status tone={statusTone(brief.status)}>{statusLabel(brief.status)}</Status>
            ) : null}
          </div>

          <h1
            className="mt-8 font-display text-[2.2rem] leading-[1.04] text-ink md:text-[3rem]"
            style={{ fontVariationSettings: '"opsz" 144, "SOFT" 60' }}
          >
            {brief?.company_name ?? "Research"}
          </h1>

          <div className="mt-10 grid gap-x-14 gap-y-10 lg:grid-cols-[15rem_minmax(0,1fr)]">
            {/* Left rail: objective, view switch, export. */}
            <aside className="space-y-8 lg:sticky lg:top-8 lg:self-start">
              {brief?.objective ? (
                <div>
                  <SectionLabel>Your objective</SectionLabel>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                    {brief.objective}
                  </p>
                </div>
              ) : null}

              {person || pitch ? (
                <TabNav
                  tab={tab}
                  onChange={setTab}
                  hasContact={Boolean(person)}
                  hasPitch={Boolean(pitch)}
                />
              ) : null}

              {job ? (
                <DownloadPdfButton jobId={job.id} company={brief?.company_name} />
              ) : null}
            </aside>

            {/* Main content. */}
            <main className="min-w-0">
              {tab === "research" ? (
                company ? (
                  <div className="space-y-10">
                    {company.answer ? (
                      <div className="max-w-prose border-l-2 border-accent/50 pl-5">
                        <SectionLabel>The answer</SectionLabel>
                        <div className="mt-2.5">
                          <Prose lead>{company.answer}</Prose>
                        </div>
                      </div>
                    ) : null}
                    <ReportView report={company} />
                  </div>
                ) : (
                  <Notice
                    title="Report unavailable"
                    body="The research finished but its contents could not be read."
                  />
                )
              ) : tab === "contact" ? (
                person ? (
                  <PersonView person={person} />
                ) : (
                  <Notice
                    title="No contact"
                    body="This research had no named meeting contact."
                  />
                )
              ) : pitch ? (
                <PitchView pitch={pitch} />
              ) : (
                <Notice
                  title="No pitch"
                  body="Add your company context on the Your company page to generate a pitch on your next research."
                />
              )}
            </main>
          </div>
        </>
      )}
    </div>
  );
}

function TabNav({
  tab,
  onChange,
  hasContact,
  hasPitch,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  hasContact: boolean;
  hasPitch: boolean;
}) {
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "research", label: "Research" },
    ...(hasContact ? [{ id: "contact" as Tab, label: "Meeting contact" }] : []),
    ...(hasPitch ? [{ id: "pitch" as Tab, label: "Pitch" }] : []),
  ];
  return (
    <div>
      <SectionLabel>View</SectionLabel>
      <div className="mt-3 flex flex-col gap-1">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange(t.id)}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                active
                  ? "bg-ink/[0.06] text-ink"
                  : "text-ink-faint hover:bg-ink/[0.03] hover:text-ink-soft"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full transition-colors ${
                  active ? "bg-accent" : "bg-ink-faint/30"
                }`}
              />
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReportView({ report }: { report: ReportContent }) {
  const byId = useMemo(() => {
    const map = new Map<string, Source>();
    for (const s of report.sources) map.set(s.id, s);
    return map;
  }, [report.sources]);

  return (
    <div className="space-y-10">
      {report.summary ? (
        <section>
          <SectionLabel>Summary</SectionLabel>
          <Prose>{report.summary}</Prose>
        </section>
      ) : null}

      {report.sections.map((section, i) => {
        const cited = section.source_ids
          .map((id) => byId.get(id))
          .filter((s): s is Source => Boolean(s));
        return (
          <section key={i}>
            <h2 className="font-display text-[1.35rem] leading-tight text-ink">
              {section.heading}
            </h2>
            <div className="mt-3">
              <Prose>{section.content}</Prose>
            </div>
            {cited.length > 0 ? <CitedSources sources={cited} /> : null}
          </section>
        );
      })}

      {report.sources.length > 0 ? (
        <section>
          <SectionLabel>Sources</SectionLabel>
          <ol className="mt-3 space-y-2.5">
            {report.sources.map((s, i) => (
              <li key={s.id} className="flex gap-3 text-sm leading-relaxed">
                <span className="font-mono text-[0.6875rem] text-ink-faint pt-0.5">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <SourceLink source={s} />
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function PersonView({ person }: { person: PersonReport }) {
  const byId = useMemo(() => {
    const map = new Map<string, Source>();
    for (const s of person.sources) map.set(s.id, s);
    return map;
  }, [person.sources]);

  return (
    <section>
      <div className="flex items-center gap-3">
        <SectionLabel>Meeting contact</SectionLabel>
        <span
          className={`font-mono text-[0.5625rem] uppercase tracking-wider ${
            person.verified ? "text-good" : "text-ink-faint/70"
          }`}
        >
          {person.verified ? "verified" : "unverified"}
        </span>
      </div>

      {person.headline ? (
        <h2 className="mt-3 font-display text-[1.35rem] leading-tight text-ink">
          {person.headline}
        </h2>
      ) : null}

      {!person.verified ? (
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          We could not confidently verify this contact against the company, so no
          profile is shown. Nothing here is guessed.
        </p>
      ) : (
        <>
          {person.summary ? (
            <div className="mt-3">
              <Prose>{person.summary}</Prose>
            </div>
          ) : null}
          {person.sections.map((section, i) => {
            const cited = section.source_ids
              .map((id) => byId.get(id))
              .filter((s): s is Source => Boolean(s));
            return (
              <div key={i} className="mt-6">
                <h3 className="font-display text-lg text-ink">{section.heading}</h3>
                <div className="mt-2">
                  <Prose>{section.content}</Prose>
                </div>
                {cited.length > 0 ? <CitedSources sources={cited} /> : null}
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}

function PitchView({ pitch }: { pitch: Pitch }) {
  return (
    <div className="space-y-10">
      {pitch.headline ? (
        <div className="max-w-prose border-l-2 border-accent/50 pl-5">
          <SectionLabel>The angle</SectionLabel>
          <p
            className="mt-2.5 font-display text-[1.5rem] leading-snug text-ink"
            style={{ fontVariationSettings: '"opsz" 40, "SOFT" 40' }}
          >
            {pitch.headline}
          </p>
        </div>
      ) : null}

      {pitch.why_now ? (
        <section>
          <SectionLabel>Why now</SectionLabel>
          <div className="mt-2">
            <Prose>{pitch.why_now}</Prose>
          </div>
        </section>
      ) : null}

      {pitch.talking_points.length > 0 ? (
        <section>
          <SectionLabel>Talking points</SectionLabel>
          <ul className="mt-4 space-y-5">
            {pitch.talking_points.map((tp, i) => (
              <li key={i} className="flex gap-3">
                <span className="font-mono text-[0.6875rem] text-accent pt-1">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <p className="text-[0.9375rem] leading-relaxed text-ink">{tp.point}</p>
                  {tp.rationale ? (
                    <p className="mt-1 text-sm leading-relaxed text-ink-faint">{tp.rationale}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {pitch.opening_message ? (
        <section>
          <SectionLabel>Opening message</SectionLabel>
          <div className="mt-3 rounded-xl bg-ink/[0.03] px-5 py-4 ring-1 ring-rule/10">
            <Prose>{pitch.opening_message}</Prose>
          </div>
        </section>
      ) : null}

      {pitch.objections.length > 0 ? (
        <section>
          <SectionLabel>Objections</SectionLabel>
          <div className="mt-4 space-y-5">
            {pitch.objections.map((o, i) => (
              <div key={i}>
                <p className="text-[0.9375rem] font-medium leading-relaxed text-ink">
                  {o.objection}
                </p>
                <div className="mt-1.5 border-l-2 border-accent/30 pl-3">
                  <Prose>{o.response}</Prose>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function CitedSources({ sources }: { sources: Source[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
      {sources.map((s) => (
        <a
          key={s.id}
          href={s.url}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[0.6875rem] uppercase tracking-wider text-ink-faint transition-colors hover:text-accent"
          title={s.title}
        >
          {hostOf(s.url)} ↗
        </a>
      ))}
    </div>
  );
}

function SourceLink({ source }: { source: Source }) {
  return (
    <span className="min-w-0">
      <a
        href={source.url}
        target="_blank"
        rel="noreferrer"
        className="text-ink transition-colors hover:text-accent"
      >
        {source.title || hostOf(source.url)}
      </a>
      <span className="mt-0.5 block truncate font-mono text-[0.6875rem] text-ink-faint">
        {hostOf(source.url)}
      </span>
    </span>
  );
}

function DownloadPdfButton({ jobId, company }: { jobId: string; company?: string }) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await api.jobs.reportPdf(jobId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || `${company ?? "research"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Download failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={download} disabled={busy} className="btn-ghost">
        {busy ? "Preparing…" : "Download PDF ↓"}
      </button>
      {error ? <span className="font-mono text-[0.625rem] text-bad">{error}</span> : null}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint">
      {children}
    </p>
  );
}

/** Markdown body styled to match the editorial ink palette (no typography plugin). */
function Prose({ children, lead }: { children: string; lead?: boolean }) {
  return (
    <div
      className={`space-y-3 leading-relaxed ${
        lead ? "text-[1.0625rem] text-ink" : "text-[0.9375rem] text-ink-soft"
      }`}
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p>{children}</p>,
          strong: ({ children }) => <strong className="font-medium text-ink">{children}</strong>,
          ul: ({ children }) => <ul className="list-disc space-y-1.5 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1.5 pl-5">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          h1: ({ children }) => <h3 className="font-display text-lg text-ink">{children}</h3>,
          h2: ({ children }) => <h3 className="font-display text-lg text-ink">{children}</h3>,
          h3: ({ children }) => <h3 className="font-display text-base text-ink">{children}</h3>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-ink underline decoration-ink-faint/40 underline-offset-2 hover:text-accent"
            >
              {children}
            </a>
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-10 border-l-2 border-rule/30 pl-4">
      <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint">{title}</p>
      <p className="mt-2 text-sm text-ink-soft">{body}</p>
    </div>
  );
}

function SkeletonReport() {
  return (
    <div className="mt-10 animate-pulse space-y-6" aria-busy>
      <div className="h-9 w-64 rounded bg-ink/10" />
      <div className="h-4 w-full max-w-prose rounded bg-ink/5" />
      <div className="space-y-2">
        <div className="h-4 w-full rounded bg-ink/5" />
        <div className="h-4 w-5/6 rounded bg-ink/5" />
        <div className="h-4 w-4/6 rounded bg-ink/5" />
      </div>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
