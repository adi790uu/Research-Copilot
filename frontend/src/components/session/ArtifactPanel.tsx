import { useEffect, useRef, useState } from "react";

import { ApiError, useApi } from "../../lib/api";
import type { Report, Source } from "../../lib/types";
import type { StreamState } from "../../hooks/useWorkflowStream";
import { ReportSkeleton, ReportView } from "./ReportView";
import { WorkflowProgress } from "./WorkflowProgress";

export type ArtifactTab = "plan" | "sources" | "report";

interface Props {
  sessionId: string;
  open: boolean;
  onClose: () => void;
  activeTab: ArtifactTab;
  onTabChange: (tab: ArtifactTab) => void;

  stream: StreamState;
  onStart: () => void;
  starting: boolean;
  startDisabled: boolean;

  report: Report | null;
  reportLoading: boolean;
  reportError: unknown;
  onRetryReport?: () => void;
}

const TABS: { id: ArtifactTab; label: string }[] = [
  { id: "plan", label: "Plan" },
  { id: "sources", label: "Sources" },
  { id: "report", label: "Report" },
];

export function ArtifactPanel({
  sessionId,
  open,
  onClose,
  activeTab,
  onTabChange,
  stream,
  onStart,
  starting,
  startDisabled,
  report,
  reportLoading,
  reportError,
  onRetryReport,
}: Props) {
  // Focus the panel when it opens so screen readers / Esc target the right
  // surface.
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const reportCount = report?.content.sources.length ?? 0;

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      aria-label="Brief artifacts"
      className="flex flex-col h-full bg-bg-elev/50 outline-none"
    >
      <header className="px-5 sm:px-6 py-4 flex items-center justify-between gap-4 rule-b">
        <div className="min-w-0">
          <p className="eyebrow">Brief</p>
          <p className="mt-1 font-display italic text-lg text-ink leading-tight"
            style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
          >
            Artifacts
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close artifact panel"
          className="text-ink-faint hover:text-ink transition-colors p-1.5 -mr-1.5"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            aria-hidden
          >
            <path d="M4 4l10 10M14 4L4 14" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <nav role="tablist" aria-label="Artifact tabs" className="px-5 sm:px-6 pt-3 flex gap-1 rule-b">
        {TABS.map((t) => {
          const active = t.id === activeTab;
          const count = t.id === "sources" ? reportCount : null;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              type="button"
              onClick={() => onTabChange(t.id)}
              className={`relative px-3 py-2 -mb-px font-mono text-[0.6875rem] uppercase tracking-wider transition-colors
                ${active
                  ? "text-ink"
                  : "text-ink-faint hover:text-ink-soft"}`}
            >
              <span className="inline-flex items-baseline gap-1.5">
                {t.label}
                {count != null && (
                  <span className="text-[0.6rem] text-ink-faint/70 tabular-nums">
                    {String(count).padStart(2, "0")}
                  </span>
                )}
              </span>
              {active && (
                <span
                  aria-hidden
                  className="absolute left-2 right-2 bottom-0 h-px bg-ink"
                />
              )}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 overflow-y-auto">
        {activeTab === "plan" && (
          <div className="p-5 sm:p-6">
            <WorkflowProgress
              stream={stream}
              onStart={onStart}
              starting={starting}
              startDisabled={startDisabled}
            />
          </div>
        )}

        {activeTab === "sources" && (
          <div className="p-5 sm:p-6">
            <SourcesList sources={report?.content.sources ?? []} loading={reportLoading} />
          </div>
        )}

        {activeTab === "report" && (
          <div>
            {report && (
              <ExportToolbar sessionId={sessionId} />
            )}
            <div className="p-5 sm:p-6 pt-4">
              {report ? (
                <ReportView report={report} />
              ) : reportError ? (
                <div className="border-l-2 border-bad/60 pl-4 py-2">
                  <p className="font-mono text-xs uppercase tracking-wider text-bad mb-1">
                    Briefing failed to load
                  </p>
                  <p className="text-sm text-ink-soft">
                    {(reportError as Error)?.message ?? "Unknown error"}
                  </p>
                  {onRetryReport && (
                    <button onClick={onRetryReport} className="btn-ghost mt-3">
                      Try again →
                    </button>
                  )}
                </div>
              ) : reportLoading || stream.phase === "running" ? (
                <ReportSkeleton />
              ) : (
                <NotReadyHint />
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function SourcesList({ sources, loading }: { sources: Source[]; loading: boolean }) {
  if (loading && sources.length === 0) {
    return (
      <ul className="space-y-3 animate-pulse" aria-busy>
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="space-y-2">
            <div className="h-3 w-2/3 bg-ink/10 rounded-sm" />
            <div className="h-2 w-1/2 bg-ink/5 rounded-sm" />
          </li>
        ))}
      </ul>
    );
  }

  if (sources.length === 0) {
    return (
      <p className="text-sm text-ink-soft italic leading-relaxed">
        Sources will appear here once the briefing is assembled.
      </p>
    );
  }

  return (
    <ol className="space-y-px">
      {sources.map((s, idx) => (
        <li key={s.id} className="rule-b last:border-b-0">
          <a
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="group block py-3 px-2 -mx-2 rounded-sm hover:bg-bg/40 transition-colors"
          >
            <div className="flex items-baseline gap-3">
              <span className="font-mono tabular-nums text-[0.6875rem] text-ink-faint/70 mt-0.5 shrink-0">
                {String(idx + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink leading-snug">
                  {s.title || s.url}
                </p>
                <p className="mt-1 font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint truncate">
                  {prettyHost(s.url)}
                </p>
                {s.snippet && (
                  <p className="mt-2 text-xs text-ink-soft leading-relaxed line-clamp-2">
                    {s.snippet}
                  </p>
                )}
              </div>
              <span
                aria-hidden
                className="text-ink-faint group-hover:text-ink transition-colors mt-0.5 shrink-0"
              >
                ↗
              </span>
            </div>
          </a>
        </li>
      ))}
    </ol>
  );
}

function ExportToolbar({ sessionId }: { sessionId: string }) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onExport = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await api.sessions.reportPdf(sessionId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Defer revoke so Safari has time to start the download.
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : (err as Error)?.message ?? "Export failed"
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-5 sm:px-6 pt-4 pb-2 flex items-center justify-between gap-3 border-b border-rule/8">
      <p className="font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint">
        Nine sections · ready for sharing
      </p>
      <button
        type="button"
        onClick={onExport}
        disabled={busy}
        className="inline-flex items-center gap-2 px-3 py-1.5 border border-ink/15 hover:border-ink/40 disabled:opacity-50 disabled:cursor-not-allowed font-mono text-[0.6875rem] uppercase tracking-wider text-ink transition-colors rounded-sm"
        aria-label="Export brief as PDF"
        title="Download as PDF"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 13 13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6.5 1.5v7.5" />
          <path d="M3 6l3.5 3.5L10 6" />
          <path d="M1.75 11.5h9.5" />
        </svg>
        {busy ? "Exporting…" : "Export PDF"}
      </button>
      {error && (
        <p className="absolute mt-9 right-5 font-mono text-[0.625rem] uppercase tracking-wider text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

function NotReadyHint() {
  return (
    <div className="border-l-2 border-rule/15 pl-4 py-2">
      <p className="font-mono text-[0.6875rem] uppercase tracking-wider text-ink-faint mb-1">
        Not yet
      </p>
      <p className="text-sm text-ink-soft leading-relaxed">
        Start the research from the Plan tab. The briefing assembles here once
        the workflow completes.
      </p>
    </div>
  );
}

function prettyHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
