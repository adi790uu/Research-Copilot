import { useEffect, useRef, useState } from "react";

import { useApi } from "../../lib/api";
import type {
  ResearchJob,
  ResearcherResult,
  Source,
} from "../../lib/types";
import type { RunPhase } from "../../hooks/useWorkflowChat";
import { ReportView } from "./ReportView";

/**
 * Vertical timeline workspace. No tabs — every artifact stacks in run order:
 *
 *   ● Gathered N sources              → expand → top-domains + per-subquery list
 *   ● Researched: <subquery>          → expand → that researcher's sources + summary
 *   ● Research report is ready        → expand → ReportView + PDF
 *
 * The plan is shown inline in the chat; the workspace holds only the sources
 * and the final report. `focus` scrolls to the report block when the chat
 * report card is clicked.
 */

export type ArtifactFocus = "report" | null;

interface Props {
  sessionId: string;
  open: boolean;
  onClose: () => void;
  focus: ArtifactFocus;
  onFocusHandled: () => void;

  job: ResearchJob | null;
  researchers: ResearcherResult[];
  phase: RunPhase;
  /** Title to show in the header — usually the session's company name. */
  title: string;
}

export function ArtifactPanel({
  sessionId,
  open,
  onClose,
  focus,
  onFocusHandled,
  job,
  researchers,
  phase,
  title,
}: Props) {
  if (!open) return null;

  const sourcesAll: Source[] = researchers.length
    ? researchers.flatMap((r) => r.sources ?? [])
    : job?.sources ?? [];
  const totalSources = sourcesAll.length;
  const reportReady = !!job?.final_report;
  const jobFailed = job?.status === "failed";

  return (
    <aside
      className="panel-reveal grid h-full min-h-0 border-l border-rule/15 bg-bg-elev/30"
      style={{ gridTemplateRows: "auto minmax(0, 1fr)" }}
    >
      <header className="flex items-center justify-between border-b border-rule/15 px-6 py-4">
        <h2
          className="truncate font-serif text-base text-ink"
          title={title}
        >
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-xs text-ink-faint hover:text-ink"
          aria-label="Close workspace"
        >
          ✕
        </button>
      </header>

      <div className="overflow-y-auto px-6 py-6">
        <ol className="space-y-4">
          {(totalSources > 0 || researchers.length > 0) && (
            <TimelineStep
              id="sources"
              icon="●"
              tone={reportReady || jobFailed ? "done" : "active"}
              label={
                totalSources > 0
                  ? `Gathered ${totalSources} ${
                      totalSources === 1 ? "source" : "sources"
                    }`
                  : "Gathering sources…"
              }
              focus={null}
              onFocusHandled={onFocusHandled}
              defaultOpen={false}
            >
              <SourcesBlock sources={sourcesAll} researchers={researchers} />
            </TimelineStep>
          )}

          {jobFailed && (
            <TimelineStep
              id="failed"
              icon="●"
              tone="bad"
              label="Research failed"
              focus={null}
              onFocusHandled={onFocusHandled}
              defaultOpen={true}
            >
              <p className="text-sm text-ink-soft">
                The background job ended with status <code>failed</code>.
                Check the backend logs for the cause.
              </p>
            </TimelineStep>
          )}

          {reportReady && job && (
            <TimelineStep
              id="report"
              icon="●"
              tone="done"
              label="Research report is ready"
              focus={focus}
              onFocusHandled={onFocusHandled}
              defaultOpen={false}
            >
              <ReportBlock job={job} sessionId={sessionId} />
            </TimelineStep>
          )}

          {/* Live pulse when the run is in flight and no terminal step is
              showing yet. Helps the user see something is happening even
              before sources start landing. */}
          {!reportReady &&
            !jobFailed &&
            (phase === "running" || phase === "awaiting_clarification") && (
              <li className="flex items-center gap-3 px-1 py-2">
                <span className="h-2 w-2 animate-pulse-dot rounded-full bg-info" />
                <span className="text-sm text-ink-soft">
                  {researchers.length > 0
                    ? "Researchers running…"
                    : phase === "awaiting_clarification"
                    ? "Waiting on your answers…"
                    : "Working…"}
                </span>
              </li>
            )}
        </ol>
      </div>
    </aside>
  );
}

// ─── Timeline primitives ────────────────────────────────────────────────────

function TimelineStep({
  id,
  icon,
  tone,
  label,
  focus,
  onFocusHandled,
  defaultOpen,
  children,
}: {
  id: string;
  icon: string;
  tone: "active" | "done" | "bad";
  label: string;
  focus: ArtifactFocus;
  onFocusHandled: () => void;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const rootRef = useRef<HTMLLIElement | null>(null);

  // External focus: scroll into view + expand when the parent asks.
  useEffect(() => {
    if (focus && focus === id) {
      setOpen(true);
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      onFocusHandled();
    }
  }, [focus, id, onFocusHandled]);

  const dotColor =
    tone === "active"
      ? "text-info"
      : tone === "bad"
      ? "text-bad"
      : "text-ink-faint";

  return (
    <li ref={rootRef} className="scroll-mt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 rounded-sm px-1 py-1.5 text-left transition-colors hover:bg-rule/5"
      >
        <span className={`text-base leading-none ${dotColor}`}>{icon}</span>
        <span className="flex-1 text-sm text-ink">{label}</span>
        <span
          className={`font-mono text-[0.6875rem] text-ink-faint transition-transform ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>
      {open && <div className="ml-6 mt-3">{children}</div>}
    </li>
  );
}

// ─── Sources block (top-domains + collapsible subquery groups) ─────────────

function SourcesBlock({
  sources,
  researchers,
}: {
  sources: Source[];
  researchers: ResearcherResult[];
}) {
  if (sources.length === 0 && researchers.length === 0) {
    return (
      <p className="text-sm italic text-ink-faint">
        Sources will appear here as researchers complete.
      </p>
    );
  }

  const hasSubqueries = researchers.length > 0;

  return (
    <div className="space-y-5">
      <DomainSummary sources={sources} totalCount={sources.length} />
      {hasSubqueries ? (
        <div className="space-y-2">
          {researchers.map((r, i) => (
            <SubqueryGroup
              key={`${r.created_at}-${i}`}
              topic={r.topic}
              summary={r.summary}
              sources={r.sources ?? []}
              defaultOpen={i === 0 && researchers.length === 1}
            />
          ))}
        </div>
      ) : (
        <SubqueryGroup
          topic="All sources"
          summary={null}
          sources={sources}
          defaultOpen
        />
      )}
    </div>
  );
}

function DomainSummary({
  sources,
  totalCount,
}: {
  sources: Source[];
  totalCount: number;
}) {
  const counts = new Map<string, number>();
  for (const s of sources) {
    const host = prettyHost(s.url);
    if (!host) continue;
    counts.set(host, (counts.get(host) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, 4);
  const otherCount = ranked.slice(4).reduce((sum, [, n]) => sum + n, 0);
  const maxCount = top[0]?.[1] ?? 1;

  return (
    <section className="rounded-sm border border-rule/15 bg-bg-elev/40 px-4 py-3">
      <header className="mb-3 flex items-center justify-between">
        <p className="font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-faint">
          Top domains
        </p>
        <p className="font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-faint">
          {totalCount} {totalCount === 1 ? "source" : "sources"}
        </p>
      </header>
      <ol className="space-y-2.5">
        {top.map(([host, count]) => (
          <li key={host} className="flex items-center gap-3">
            <Favicon host={host} />
            <span
              className="min-w-0 max-w-[12rem] flex-shrink-0 truncate text-sm text-ink"
              title={host}
            >
              {host}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-rule/15">
              <div
                className="h-full rounded-full bg-accent/70"
                style={{
                  width: `${Math.max(8, (count / maxCount) * 100)}%`,
                }}
              />
            </div>
            <span className="font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-faint">
              {count} {count === 1 ? "source" : "sources"}
            </span>
          </li>
        ))}
      </ol>
      {otherCount > 0 && (
        <p className="mt-3 font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-faint">
          + {otherCount} other {otherCount === 1 ? "source" : "sources"}
        </p>
      )}
    </section>
  );
}

function SubqueryGroup({
  topic,
  summary,
  sources,
  defaultOpen,
}: {
  topic: string;
  summary: string | null;
  sources: Source[];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="overflow-hidden rounded-sm border border-rule/15 bg-bg-elev/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-rule/5"
      >
        <span className="flex min-w-0 items-center gap-3">
          <GlobeIcon />
          <span className="truncate text-sm text-ink" title={topic}>
            {topic}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-faint">
            {sources.length} {sources.length === 1 ? "result" : "results"}
          </span>
          <Chevron open={open} />
        </span>
      </button>
      {open && (
        <div className="border-t border-rule/10 px-2 py-1.5">
          {summary ? (
            <p className="px-2 pb-2 pt-1 text-xs leading-relaxed text-ink-faint">
              {summary.length > 280 ? `${summary.slice(0, 277)}…` : summary}
            </p>
          ) : null}
          {sources.length === 0 ? (
            <p className="px-2 py-3 text-sm italic text-ink-faint">
              No sources captured for this subquery.
            </p>
          ) : (
            <ol>
              {sources.map((s, i) => (
                <li key={s.id ?? s.url ?? i}>
                  <SourceRow source={s} />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}

function SourceRow({ source }: { source: Source }) {
  const host = prettyHost(source.url);
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-sm px-2 py-2 transition-colors hover:bg-rule/5"
    >
      <Favicon host={host} />
      <span
        className="min-w-0 flex-1 truncate text-sm text-ink"
        title={source.title || source.url}
      >
        {source.title || source.url}
      </span>
      <span
        className="hidden shrink-0 truncate font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-faint sm:inline-block sm:max-w-[12rem]"
        title={host}
      >
        {host}
      </span>
    </a>
  );
}

// ─── Report block ───────────────────────────────────────────────────────────

function ReportBlock({
  job,
  sessionId,
}: {
  job: ResearchJob;
  sessionId: string;
}) {
  const api = useApi();
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setError(null);
    setDownloading(true);
    try {
      const { blob, filename } = await api.jobs.reportPdf(job.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message ?? "PDF download failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={download}
          disabled={downloading || !job.final_report}
          className="btn-primary"
        >
          {downloading ? "Preparing PDF…" : "Download PDF"}
          <span className="arrow">↓</span>
        </button>
        {error ? (
          <p className="font-mono text-xs uppercase tracking-wider text-bad">
            {error}
          </p>
        ) : null}
        <p className="ml-auto font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-faint">
          Session {sessionId.slice(0, 8)}
        </p>
      </div>
      <ReportView job={job} />
    </div>
  );
}

// ─── Tiny shared bits ───────────────────────────────────────────────────────

function Favicon({ host }: { host: string }) {
  const src = host
    ? `https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(host)}`
    : undefined;
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-rule/10 bg-bg">
      {src ? (
        <img
          src={src}
          alt=""
          width={16}
          height={16}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-4 w-4 object-contain"
        />
      ) : (
        <GlobeIcon />
      )}
    </span>
  );
}

function GlobeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 text-ink-faint"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a13 13 0 0 1 0 18" />
      <path d="M12 3a13 13 0 0 0 0 18" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={12}
      height={12}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-3 w-3 text-ink-faint transition-transform ${
        open ? "rotate-180" : ""
      }`}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function prettyHost(url: string): string {
  try {
    const u = new URL(url);
    const h = u.hostname;
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    return "";
  }
}
