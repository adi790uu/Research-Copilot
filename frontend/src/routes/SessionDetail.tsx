import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ApiError, useApi } from "../lib/api";
import { formatLongDate, formatTime, shortId } from "../lib/format";
import type { Session } from "../lib/types";
import { Status, statusTone } from "../components/ui/Pill";
import { SectionHeading } from "../components/ui/SectionHeading";
import { ReportSkeleton, ReportView } from "../components/session/ReportView";
import { WorkflowProgress } from "../components/session/WorkflowProgress";
import { useWorkflowStream } from "../hooks/useWorkflowStream";

export default function SessionDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const api = useApi();
  const queryClient = useQueryClient();

  const session = useQuery({
    queryKey: ["session", id],
    queryFn: () => api.sessions.get(id),
    enabled: id.length > 0,
  });

  // Stream as long as the session exists. The hook is cheap when idle and
  // automatically replays history on reconnect.
  const [streamEnabled, setStreamEnabled] = useState(false);
  useEffect(() => {
    if (!session.data) return;
    if (session.data.status === "running" || session.data.status === "completed") {
      setStreamEnabled(true);
    }
  }, [session.data]);

  const stream = useWorkflowStream(id, streamEnabled);

  const startRun = useMutation({
    mutationFn: () => api.sessions.run(id),
    onSuccess: () => {
      setStreamEnabled(true);
      queryClient.invalidateQueries({ queryKey: ["session", id] });
    },
  });

  // Refetch session + load report once the stream terminates.
  useEffect(() => {
    if (stream.phase === "completed" || stream.phase === "failed") {
      queryClient.invalidateQueries({ queryKey: ["session", id] });
    }
  }, [stream.phase, queryClient, id]);

  const reportEnabled =
    (session.data?.status === "completed") || stream.phase === "completed";

  const report = useQuery({
    queryKey: ["session-report", id],
    queryFn: () => api.sessions.report(id),
    enabled: reportEnabled && id.length > 0,
  });

  return (
    <div className="mx-auto max-w-2xl px-6 md:px-10 pt-12 md:pt-16 pb-24 stagger">
      <div>
        <Link
          to="/app"
          className="inline-flex items-center gap-1.5 font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-faint hover:text-ink transition-colors"
        >
          <span aria-hidden>←</span> Back to archive
        </Link>
      </div>

      {session.isLoading && <SkeletonHeader />}
      {session.error && <ErrorCard error={session.error} />}
      {session.data && <SessionHero session={session.data} />}

      <section className="mt-20">
        <SectionHeading number="01" label="Workflow" meta="LangGraph" />
        <div className="mt-6">
          <WorkflowProgress
            stream={stream}
            onStart={() => startRun.mutate()}
            starting={startRun.isPending}
            startDisabled={!session.data}
          />
          {startRun.isError && (
            <p className="mt-3 text-xs text-bad font-mono uppercase tracking-wider">
              {(startRun.error as ApiError | Error).message}
            </p>
          )}
        </div>
      </section>

      <section className="mt-16">
        <SectionHeading number="02" label="Briefing" meta="Nine sections" />
        <div className="mt-6">
          {report.data ? (
            <ReportView report={report.data} />
          ) : stream.phase === "running" || report.isLoading ? (
            <ReportSkeleton />
          ) : (
            <BriefingPlaceholder />
          )}
        </div>
      </section>

      <section className="mt-16">
        <SectionHeading number="03" label="Follow-up" meta="Grounded chat" />
        <div className="mt-6">
          <ChatPlaceholder />
        </div>
      </section>
    </div>
  );
}

function SessionHero({ session }: { session: Session }) {
  return (
    <header className="mt-10 space-y-6">
      <p className="eyebrow">
        Brief — {shortId(session.id, 6)}
      </p>

      <h1
        className="font-display text-display-lg text-ink"
        style={{ fontVariationSettings: '"opsz" 144, "SOFT" 60, "WONK" 0' }}
      >
        {session.company_name}
      </h1>

      <p
        className="font-display italic text-xl text-ink-soft leading-snug max-w-prose"
        style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100' }}
      >
        {session.objective}
      </p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-faint">
        <a
          href={session.website}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:text-ink transition-colors"
        >
          {prettyHost(session.website)}
          <span aria-hidden className="text-ink-faint">↗</span>
        </a>
        <span className="text-rule/30">·</span>
        <span>
          Initiated{" "}
          <time className="font-mono tabular-nums" dateTime={session.created_at}>
            {formatLongDate(session.created_at)}, {formatTime(session.created_at)}
          </time>
        </span>
        <span className="text-rule/30">·</span>
        <Status
          tone={statusTone(session.status)}
          pulse={session.status === "running"}
        >
          {session.status}
        </Status>
      </div>

      <div className="rule-t pt-1" aria-hidden />
    </header>
  );
}

function prettyHost(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + (u.pathname === "/" ? "" : u.pathname.replace(/\/$/, ""));
  } catch {
    return url;
  }
}

function SkeletonHeader() {
  return (
    <div className="mt-10 space-y-5 animate-pulse" aria-busy>
      <div className="h-3 w-32 bg-ink/10 rounded-sm" />
      <div className="h-10 w-2/3 bg-ink/15 rounded-sm" />
      <div className="h-5 w-4/5 bg-ink/10 rounded-sm" />
      <div className="h-3 w-1/2 bg-ink/5 rounded-sm" />
    </div>
  );
}

function ErrorCard({ error }: { error: unknown }) {
  const message = error instanceof ApiError ? error.message : "Failed to load";
  return (
    <div className="mt-10 border-l-2 border-bad/60 pl-4 py-2">
      <p className="font-mono text-xs uppercase tracking-wider text-bad mb-1">
        Could not load brief
      </p>
      <p className="text-sm text-ink-soft">{message}</p>
    </div>
  );
}

function Placeholder({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div className="relative overflow-hidden border border-rule/8 bg-bg-elev/40 px-7 py-8 rounded-sm">
      <div className="absolute inset-0 pointer-events-none opacity-30"
        style={{
          backgroundImage:
            "linear-gradient(135deg, transparent 49%, rgb(var(--rule) / 0.06) 49%, rgb(var(--rule) / 0.06) 51%, transparent 51%)",
          backgroundSize: "8px 8px",
        }}
        aria-hidden
      />
      <div className="relative">
        <p className="eyebrow">{eyebrow}</p>
        <h3
          className="mt-3 font-display text-2xl text-ink italic"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
        >
          {title}
        </h3>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-prose">
          {body}
        </p>
      </div>
    </div>
  );
}

function BriefingPlaceholder() {
  return (
    <Placeholder
      eyebrow="Pending compilation"
      title="The briefing will compose itself."
      body="Nine sections, each grounded in a source: company overview, products & services, target customers, business signals, risks & challenges, discovery questions, outreach strategy, unknowns, sources."
    />
  );
}

function ChatPlaceholder() {
  return (
    <Placeholder
      eyebrow="Conversation closed"
      title="Ask the brief anything."
      body="Once the report is ready, the follow-up chat opens. Ask what to lead with, what to avoid, who to copy on the email — answers grounded in the report and its sources."
    />
  );
}
