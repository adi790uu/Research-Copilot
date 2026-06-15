import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useParams } from "react-router-dom";

import { ApiError, useApi } from "../lib/api";
import { shortId } from "../lib/format";
import type { Chat, ChatWithMessages } from "../lib/types";
import { Status, statusLabel, statusTone } from "../components/ui/Pill";
import { ArtifactPanel, type ArtifactTab } from "../components/session/ArtifactPanel";
import { ChatPanel } from "../components/session/ChatPanel";
import { useWorkflowStream, type RunPhase } from "../hooks/useWorkflowStream";

export default function SessionDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const api = useApi();
  const queryClient = useQueryClient();

  const session = useQuery({
    queryKey: ["session", id],
    queryFn: () => api.sessions.get(id),
    enabled: id.length > 0,
  });

  const [streamEnabled, setStreamEnabled] = useState(false);
  useEffect(() => {
    if (!session.data) return;
    const live = (
      [
        "running",
        "completed",
        "awaiting_clarification",
        "awaiting_plan_approval",
      ] as const
    ).includes(session.data.status as never);
    if (live) setStreamEnabled(true);
  }, [session.data]);

  const stream = useWorkflowStream(id, streamEnabled);

  const startRun = useMutation({
    mutationFn: () => api.sessions.run(id),
    onSuccess: () => {
      setStreamEnabled(true);
      setArtifactTab("plan");
      setArtifactOpen(true);
      queryClient.invalidateQueries({ queryKey: ["session", id] });
    },
  });

  const submitClarifications = useMutation({
    mutationFn: (answers: string[]) =>
      api.sessions.submitClarifications(id, answers),
    onSuccess: () => {
      setStreamEnabled(true);
      queryClient.invalidateQueries({ queryKey: ["session", id] });
    },
  });

  const approvePlan = useMutation({
    mutationFn: () => api.sessions.approvePlan(id),
    onSuccess: () => {
      setStreamEnabled(true);
      queryClient.invalidateQueries({ queryKey: ["session", id] });
    },
  });

  useEffect(() => {
    if (stream.phase === "completed" || stream.phase === "failed") {
      queryClient.invalidateQueries({ queryKey: ["session", id] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    }
  }, [stream.phase, queryClient, id]);

  const reportEnabled =
    session.data?.status === "completed" || stream.phase === "completed";

  const report = useQuery({
    queryKey: ["session-report", id],
    queryFn: () => api.sessions.report(id),
    enabled: reportEnabled && id.length > 0,
  });

  const sessionChat = useQuery({
    queryKey: ["session-chat", id],
    enabled: reportEnabled && id.length > 0,
    queryFn: async (): Promise<ChatWithMessages> => {
      const list = await api.chats.list();
      const existing: Chat | undefined = list.find((c) => c.session_id === id);
      const chat =
        existing ??
        (await api.chats.create({
          title: `Follow-up — ${session.data?.company_name ?? "briefing"}`,
          session_id: id,
        }));
      return api.chats.get(chat.id);
    },
  });

  // Effective phase = max(session.status, stream.phase). Treats the session
  // as completed/failed even when the SSE event bus has no replay (revisit
  // after backend restart or after channel wipe).
  const phase: RunPhase = derivePhase(session.data?.status, stream.phase);

  // Artifact panel state — open/closed, active tab, and resizable width.
  const [artifactOpen, setArtifactOpen] = useState(true);
  const [artifactTab, setArtifactTab] = useState<ArtifactTab>("plan");
  const [artifactWidth, setArtifactWidth] = useState<number>(readArtifactWidth);
  useEffect(() => {
    window.localStorage.setItem("rc:artifact-width", String(artifactWidth));
  }, [artifactWidth]);

  const dragStartRef = useRef<{ x: number; w: number } | null>(null);
  const beginResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStartRef.current = { x: e.clientX, w: artifactWidth };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: MouseEvent) => {
        const start = dragStartRef.current;
        if (!start) return;
        // Dragging the handle leftward grows the panel.
        const next = start.w + (start.x - ev.clientX);
        setArtifactWidth(clampWidth(next));
      };
      const onUp = () => {
        dragStartRef.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [artifactWidth]
  );

  // Switch the panel's active tab when the report becomes available so the
  // user doesn't have to manually flip from Plan → Report.
  useEffect(() => {
    if (phase === "completed" && artifactTab === "plan") {
      setArtifactTab("report");
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  if (session.isLoading) {
    return <WorkspaceSkeleton />;
  }

  if (session.error || !session.data) {
    return (
      <div className="px-6 md:px-10 py-12">
        <div className="border-l-2 border-bad/60 pl-4 py-2 max-w-lg">
          <p className="font-mono text-xs uppercase tracking-wider text-bad mb-1">
            Could not load brief
          </p>
          <p className="text-sm text-ink-soft">
            {(session.error as ApiError | Error)?.message ?? "Brief not found"}
          </p>
          <button
            onClick={() => session.refetch()}
            disabled={session.isFetching}
            className="btn-ghost mt-3 disabled:opacity-50"
          >
            {session.isFetching ? "Retrying…" : "Try again →"}
          </button>
        </div>
      </div>
    );
  }

  const s = session.data;

  const gridStyle: CSSProperties = {
    "--artifact-w": `${artifactWidth}px`,
  } as CSSProperties;

  return (
    <div
      style={gridStyle}
      className={`h-screen md:h-[100dvh] grid grid-rows-[auto_1fr] grid-cols-1 ${
        artifactOpen
          ? "lg:grid-cols-[minmax(0,1fr)_var(--artifact-w)]"
          : "lg:grid-cols-[minmax(0,1fr)_0px]"
      }`}
    >
      {/* Session hero (spans both columns) */}
      <header className="col-span-full rule-b bg-bg/70 backdrop-blur sticky top-0 z-10">
        <div className="px-5 sm:px-8 md:px-10 py-4 flex items-center justify-between gap-4 min-w-0">
          <div className="min-w-0 flex items-baseline gap-3 flex-wrap">
            <p className="eyebrow">№ {shortId(s.id, 6)}</p>
            <h1
              className="font-display text-lg sm:text-xl text-ink truncate"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 60' }}
            >
              {s.company_name}
            </h1>
            <span className="text-rule/30 hidden sm:inline">·</span>
            <span
              className="hidden sm:inline font-display italic text-base text-ink-soft truncate max-w-[28rem]"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100' }}
              title={s.objective}
            >
              {s.objective}
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Status
              tone={statusTone(s.status)}
              pulse={s.status === "running"}
            >
              {statusLabel(s.status)}
            </Status>
            {!artifactOpen && (
              <button
                type="button"
                onClick={() => setArtifactOpen(true)}
                className="btn-ghost text-xs"
              >
                Show artifacts →
              </button>
            )}
          </div>
        </div>
        {startRun.isError && (
          <p className="px-5 sm:px-8 md:px-10 pb-3 -mt-1 text-xs text-bad font-mono uppercase tracking-wider">
            {(startRun.error as ApiError | Error).message}
          </p>
        )}
      </header>

      {/* Center: chat */}
      <section className="min-w-0 min-h-0 flex flex-col">
        <ChatPanel
          chat={sessionChat.data ?? null}
          companyName={s.company_name}
          sources={report.data?.content.sources ?? []}
          report={report.data ?? null}
          stream={stream}
          phase={phase}
          starting={startRun.isPending}
          canStart={phase !== "running"}
          onStart={() => startRun.mutate()}
          onOpenReport={() => {
            setArtifactTab("report");
            setArtifactOpen(true);
          }}
          onApprovePlan={() => approvePlan.mutate()}
          approvingPlan={approvePlan.isPending}
          approvePlanError={
            approvePlan.error
              ? (approvePlan.error as ApiError | Error).message
              : null
          }
          onOpenPlan={() => {
            setArtifactTab("plan");
            setArtifactOpen(true);
          }}
          onSubmitClarifications={(answers) =>
            submitClarifications.mutate(answers)
          }
          submittingClarifications={submitClarifications.isPending}
          clarificationError={
            submitClarifications.error
              ? (submitClarifications.error as ApiError | Error).message
              : null
          }
        />
      </section>

      {/* Right: artifact panel (resizable). The drag handle is a thin column
          on the left edge of the section. */}
      <section
        className={`min-h-0 hidden lg:flex relative ${
          artifactOpen ? "" : "lg:overflow-hidden"
        }`}
      >
        {artifactOpen && (
          <button
            type="button"
            aria-label="Resize artifact panel"
            onMouseDown={beginResize}
            onDoubleClick={() => setArtifactWidth(DEFAULT_ARTIFACT_W)}
            className="absolute left-0 top-0 bottom-0 w-1.5 -ml-px cursor-col-resize z-20 group"
          >
            <span className="block h-full w-px mx-auto bg-transparent group-hover:bg-accent/60 group-active:bg-accent transition-colors" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <ArtifactPanel
            sessionId={id}
            open={artifactOpen}
            onClose={() => setArtifactOpen(false)}
            activeTab={artifactTab}
            onTabChange={setArtifactTab}
            stream={stream}
            onStart={() => startRun.mutate()}
            starting={startRun.isPending}
            startDisabled={phase === "running"}
            onApprovePlan={() => approvePlan.mutate()}
            approvingPlan={approvePlan.isPending}
            approvePlanError={
              approvePlan.error
                ? (approvePlan.error as ApiError | Error).message
                : null
            }
            report={report.data ?? null}
            reportLoading={report.isLoading || report.isFetching}
            reportError={reportEnabled ? report.error : null}
            onRetryReport={() => report.refetch()}
          />
        </div>
      </section>

      {/* Mobile artifact drawer */}
      {artifactOpen && (
        <div className="lg:hidden fixed inset-0 z-30 bg-bg">
          <div className="h-full flex flex-col">
            <ArtifactPanel
              sessionId={id}
              open
              onClose={() => setArtifactOpen(false)}
              activeTab={artifactTab}
              onTabChange={setArtifactTab}
              stream={stream}
              onStart={() => startRun.mutate()}
              starting={startRun.isPending}
              startDisabled={phase === "running"}
              onApprovePlan={() => approvePlan.mutate()}
              approvingPlan={approvePlan.isPending}
              approvePlanError={
                approvePlan.error
                  ? (approvePlan.error as ApiError | Error).message
                  : null
              }
              report={report.data ?? null}
              reportLoading={report.isLoading || report.isFetching}
              reportError={reportEnabled ? report.error : null}
              onRetryReport={() => report.refetch()}
            />
          </div>
        </div>
      )}
    </div>
  );
}

const DEFAULT_ARTIFACT_W = 448;

function readArtifactWidth(): number {
  if (typeof window === "undefined") return DEFAULT_ARTIFACT_W;
  const stored = Number(window.localStorage.getItem("rc:artifact-width"));
  if (!Number.isFinite(stored) || stored <= 0) return DEFAULT_ARTIFACT_W;
  return clampWidth(stored);
}

function clampWidth(w: number): number {
  const min = 352;
  const max =
    typeof window === "undefined"
      ? 900
      : Math.max(min, Math.floor(window.innerWidth * 0.7));
  return Math.max(min, Math.min(max, Math.round(w)));
}

function derivePhase(
  status: import("../lib/types").SessionStatus | undefined,
  streamPhase: RunPhase
): RunPhase {
  // Terminal session states win — they're the persisted truth.
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";

  // Live SSE phase beats stored status while a run is in flight, except we
  // still fall back to the stored awaiting_* status when SSE is idle (e.g. a
  // revisit after backend restart with no event replay).
  if (streamPhase !== "idle") return streamPhase;
  if (status === "running") return "running";
  if (status === "awaiting_clarification") return "awaiting_clarification";
  if (status === "awaiting_plan_approval") return "awaiting_plan_approval";
  return "idle";
}

function WorkspaceSkeleton() {
  return (
    <div className="h-screen flex flex-col">
      <div className="rule-b px-8 py-4 animate-pulse" aria-busy>
        <div className="h-3 w-24 bg-ink/10 rounded-sm mb-2" />
        <div className="h-5 w-1/3 bg-ink/15 rounded-sm" />
      </div>
      <div className="flex-1 grid lg:grid-cols-[1fr_28rem]">
        <div className="p-10 space-y-4 animate-pulse" aria-busy>
          <div className="h-3 w-32 bg-ink/10 rounded-sm" />
          <div className="h-8 w-3/4 bg-ink/15 rounded-sm" />
          <div className="h-4 w-5/6 bg-ink/10 rounded-sm" />
          <div className="h-4 w-4/6 bg-ink/10 rounded-sm" />
        </div>
        <div className="hidden lg:block bg-bg-elev/40 border-l border-rule/8 p-6 space-y-3 animate-pulse" aria-busy>
          <div className="h-3 w-20 bg-ink/10 rounded-sm" />
          <div className="h-4 w-1/2 bg-ink/15 rounded-sm" />
          <div className="h-3 w-2/3 bg-ink/10 rounded-sm mt-6" />
          <div className="h-3 w-2/3 bg-ink/10 rounded-sm" />
        </div>
      </div>
    </div>
  );
}

