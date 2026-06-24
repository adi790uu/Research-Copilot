import { useEffect, useRef, useState } from "react";

import { useApi } from "../../lib/api";
import type { ResearchAngle, ResearchStatus } from "../../lib/runStatus";
import type { ResearchJob, Source } from "../../lib/types";
import { ReportView } from "./ReportView";

/**
 * Vertical timeline workspace. No tabs — every artifact stacks in run order:
 *
 *   ● Researching N angles    → expand → each angle's status, summary + sources
 *   ● Gathered N sources      → expand → top-domains breakdown
 *   ● Writing the report…     → live pulse
 *   ● Research report is ready → expand → ReportView + PDF
 *
 * The plan is shown inline in the chat; the workspace holds the live research
 * progress and the final report. `focus` scrolls to the report block when the
 * chat report card is clicked.
 */

export type ArtifactFocus = "report" | null;

interface Props {
  sessionId: string;
  open: boolean;
  onClose: () => void;
  focus: ArtifactFocus;
  onFocusHandled: () => void;

  job: ResearchJob | null;
  status: ResearchStatus;
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
  status,
  title,
}: Props) {
  if (!open) return null;

  const { stage, angles, sources } = status;
  const researching = stage === "researching";

  return (
    <aside
      className="panel-reveal grid h-full min-h-0 border-l border-rule/15 bg-bg-elev/30"
      style={{ gridTemplateRows: "auto minmax(0, 1fr)" }}
    >
      <header className="flex items-center justify-between border-b border-rule/15 px-6 py-4">
        <h2 className="truncate font-serif text-base text-ink" title={title}>
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
          {angles.length > 0 && (
            <TimelineStep
              id="angles"
              tone={researching ? "active" : "done"}
              label={`${researching ? "Researching" : "Researched"} ${
                angles.length
              } ${angles.length === 1 ? "angle" : "angles"}`}
              focus={null}
              onFocusHandled={onFocusHandled}
              defaultOpen={researching}
            >
              <AnglesBlock angles={angles} />
            </TimelineStep>
          )}

          {sources.length > 0 && (
            <TimelineStep
              id="sources"
              tone="done"
              label={`Gathered ${sources.length} ${
                sources.length === 1 ? "source" : "sources"
              }`}
              focus={null}
              onFocusHandled={onFocusHandled}
              defaultOpen={false}
            >
              <SourcesBlock sources={sources} showList={angles.length === 0} />
            </TimelineStep>
          )}

          {stage === "researching" && angles.length === 0 && (
            <LivePulse label="Scoping the research angles…" />
          )}

          {stage === "writing_report" && (
            <LivePulse label="Writing the report…" />
          )}

          {stage === "failed" && (
            <TimelineStep
              id="failed"
              tone="bad"
              label="Research failed"
              focus={null}
              onFocusHandled={onFocusHandled}
              defaultOpen={true}
            >
              <p className="text-sm text-ink-soft">
                The research run ended early. Start a new brief to try again.
              </p>
            </TimelineStep>
          )}

          {stage === "done" && job && (
            <TimelineStep
              id="report"
              tone="done"
              label="Research report is ready"
              focus={focus}
              onFocusHandled={onFocusHandled}
              defaultOpen={false}
            >
              <ReportBlock job={job} sessionId={sessionId} />
            </TimelineStep>
          )}
        </ol>
      </div>
    </aside>
  );
}

function LivePulse({ label }: { label: string }) {
  return (
    <li className="flex items-center gap-3 px-1 py-2">
      <span className="h-2 w-2 animate-pulse-dot rounded-full bg-info" />
      <span className="text-sm text-ink-soft">{label}</span>
    </li>
  );
}

// ─── Timeline primitives ────────────────────────────────────────────────────

function TimelineStep({
  id,
  tone,
  label,
  focus,
  onFocusHandled,
  defaultOpen,
  children,
}: {
  id: string;
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

  return (
    <li ref={rootRef} className="scroll-mt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 rounded-sm px-1 py-1.5 text-left transition-colors hover:bg-rule/5"
      >
        <StepDot tone={tone} />
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

function StepDot({ tone }: { tone: "active" | "done" | "bad" }) {
  const color =
    tone === "active" ? "bg-info" : tone === "bad" ? "bg-bad" : "bg-ink-faint";
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${color} ${
        tone === "active" ? "animate-pulse-dot" : ""
      }`}
      aria-hidden="true"
    />
  );
}

// ─── Research angles (the per-investigation breakdown) ─────────────────────

function AnglesBlock({ angles }: { angles: ResearchAngle[] }) {
  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-ink-faint">
        Each angle is a focused investigation the agents ran in parallel.
      </p>
      <div className="space-y-2">
        {angles.map((angle, i) => (
          <AngleRow
            key={`${angle.topic}-${i}`}
            angle={angle}
            defaultOpen={angles.length === 1}
          />
        ))}
      </div>
    </div>
  );
}

function AngleRow({
  angle,
  defaultOpen,
}: {
  angle: ResearchAngle;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const meta =
    angle.state === "running"
      ? "researching…"
      : angle.state === "failed"
      ? "no results"
      : `${angle.sources.length} ${
          angle.sources.length === 1 ? "source" : "sources"
        }`;

  return (
    <section className="overflow-hidden rounded-sm border border-rule/15 bg-bg-elev/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-rule/5"
      >
        <span className="flex min-w-0 items-center gap-3">
          <AngleStatusIcon state={angle.state} />
          <span className="truncate text-sm text-ink" title={angle.topic}>
            {angle.topic}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-faint">
            {meta}
          </span>
          <Chevron open={open} />
        </span>
      </button>
      {open && (
        <div className="border-t border-rule/10 px-2 py-1.5">
          {angle.summary ? (
            <p className="px-2 pb-2 pt-1 text-xs leading-relaxed text-ink-faint">
              {angle.summary.length > 280
                ? `${angle.summary.slice(0, 277)}…`
                : angle.summary}
            </p>
          ) : null}
          {angle.sources.length === 0 ? (
            <p className="px-2 py-3 text-sm italic text-ink-faint">
              {angle.state === "running"
                ? "Gathering sources for this angle…"
                : "No sources captured for this angle."}
            </p>
          ) : (
            <ol>
              {angle.sources.map((s, i) => (
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

function AngleStatusIcon({ state }: { state: ResearchAngle["state"] }) {
  if (state === "running") {
    return (
      <span
        className="block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-info border-r-transparent"
        aria-hidden="true"
      />
    );
  }
  if (state === "failed") {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-bad" aria-hidden="true" />;
  }
  return <CheckIcon />;
}

// ─── Sources block (aggregate top-domains view) ────────────────────────────

function SourcesBlock({
  sources,
  showList,
}: {
  sources: Source[];
  showList: boolean;
}) {
  return (
    <div className="space-y-5">
      <DomainSummary sources={sources} totalCount={sources.length} />
      {showList && (
        <ol className="overflow-hidden rounded-sm border border-rule/15 bg-bg-elev/30">
          {sources.map((s, i) => (
            <li key={s.id ?? s.url ?? i}>
              <SourceRow source={s} />
            </li>
          ))}
        </ol>
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

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5 shrink-0 text-accent"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
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
