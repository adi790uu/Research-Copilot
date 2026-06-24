import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { useApi } from "../lib/api";
import type { ClarificationQuestion, ResearchPlan } from "../lib/types";
import {
  ArtifactPanel,
  type ArtifactFocus,
} from "../components/session/ArtifactPanel";
import { ChatPanel } from "../components/session/ChatPanel";
import {
  useWorkflowChat,
  type ChatTurn,
  type UserTurn,
} from "../hooks/useWorkflowChat";
import { useJob, useLatestJob } from "../hooks/useSessionStatus";
import { useReportChat } from "../hooks/useReportChat";
import { deriveResearchStatus } from "../lib/runStatus";

export default function SessionDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const api = useApi();

  const session = useQuery({
    queryKey: ["brief", id],
    queryFn: () => api.briefs.get(id),
    enabled: id.length > 0,
  });

  // Phase 1 SSE chat (clarify → brief → plan). Once SSE delivers
  // `plan_ready`, `chat.jobId` is populated and we flip into polling mode.
  const chat = useWorkflowChat(id);

  const [jobId, setJobId] = useState<string | null>(null);
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [focus, setFocus] = useState<ArtifactFocus>(null);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  // Persisted phase-1 transcript — fetched once so a reload can restore the
  // clarification card (and the user's prior answer) without a live stream.
  const phase1Messages = useQuery({
    queryKey: ["brief-messages", id],
    queryFn: () => api.briefs.listMessages(id, "workflow"),
    enabled: id.length > 0,
  });

  // Hydrate the chat from persisted messages + the brief's stored
  // clarification before deciding whether to re-open SSE.
  useEffect(() => {
    if (!session.data || !phase1Messages.data) return;
    chat.hydrate(phase1Messages.data, session.data.clarification_question);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.data, phase1Messages.data]);

  // On cold-load of an in-flight phase-1 session, subscribe to SSE so any
  // retained events replay. Skipped once hydration has seeded turns (the
  // clarification card is already restored, so re-streaming would duplicate
  // it). Still runs for `awaiting_plan_approval`, where hydration seeds
  // nothing and SSE replays the plan_ready card.
  useEffect(() => {
    if (!session.data) return;
    if (phase1Messages.isLoading) return;
    if (chat.turns.length > 0 || chat.streaming) return;
    if (
      session.data.status === "awaiting_clarification" ||
      session.data.status === "awaiting_plan_approval"
    ) {
      void chat.subscribe();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.data?.status, phase1Messages.isLoading]);

  // SSE handed us a job_id with `plan_ready` — promote it so `useJob` polls.
  useEffect(() => {
    if (chat.jobId && !jobId) setJobId(chat.jobId);
  }, [chat.jobId, jobId]);

  // Cold-load: pick up the existing job (if any) so polling resumes
  // without re-opening the SSE.
  const latestJobQuery = useLatestJob(id, !!session.data);
  useEffect(() => {
    if (latestJobQuery.data?.id && !jobId) {
      setJobId(latestJobQuery.data.id);
    }
  }, [latestJobQuery.data?.id, jobId]);

  const jobQuery = useJob(jobId);
  const job = jobQuery.data ?? latestJobQuery.data ?? null;

  // Progress artefacts — polled together while the job runs. `tasks` is the
  // per-angle dispatch log (running/done/failed), `researchers` the completed
  // results, `events` the worker's stage markers. All survive reloads.
  const pollWhileRunning = () => {
    const status = jobQuery.data?.status ?? latestJobQuery.data?.status;
    if (status === "completed" || status === "failed") return false;
    return 6000;
  };
  const researchersQuery = useQuery({
    queryKey: ["job-researchers", jobId],
    queryFn: () => api.jobs.researchers(jobId!),
    enabled: !!jobId,
    refetchInterval: pollWhileRunning,
  });
  const tasksQuery = useQuery({
    queryKey: ["job-tasks", jobId],
    queryFn: () => api.jobs.tasks(jobId!),
    enabled: !!jobId,
    refetchInterval: pollWhileRunning,
  });
  const eventsQuery = useQuery({
    queryKey: ["job-events", jobId],
    queryFn: () => api.jobs.events(jobId!),
    enabled: !!jobId,
    refetchInterval: pollWhileRunning,
  });
  const researchers = researchersQuery.data ?? [];

  const researchStatus = useMemo(
    () =>
      deriveResearchStatus({
        job,
        tasks: tasksQuery.data ?? [],
        researchers,
        events: eventsQuery.data ?? [],
      }),
    [job, tasksQuery.data, researchers, eventsQuery.data]
  );

  // Plan: prefer the live SSE-delivered plan; fall back to parsing
  // job.research_plan (the backend writes it at auto-spawn time). Makes
  // cold-load on a `running` / `completed` session show the plan without
  // re-opening SSE.
  const plan = useMemo<ResearchPlan | null>(() => {
    if (chat.plan) return chat.plan;
    const raw = job?.research_plan;
    if (!raw) return null;
    try {
      const obj = JSON.parse(raw) as ResearchPlan;
      if (obj && Array.isArray(obj.subtopics)) return obj;
    } catch {
      // bad JSON in the DB — fall through
    }
    return null;
  }, [chat.plan, job?.research_plan]);

  // (auto-open moved below — it now waits on `initialLoading` clearing)

  // Action handlers ------------------------------------------------------

  const handleAnswers = useCallback(
    (answers: string[], questions: ClarificationQuestion[]) => {
      const lines = questions.map((q, i) => ({
        question: q.question,
        answer: answers[i] ?? "",
      }));
      const optimistic: UserTurn = {
        role: "user",
        kind: "answers",
        lines,
        at: new Date().toISOString(),
      };
      const joined = lines
        .map((l) => `${l.question}\nClarification answer: ${l.answer}`)
        .join("\n\n");
      void chat.send(
        {
          kind: "answer",
          message: joined,
          clarification_question_answered: true,
          clarification_answers: lines,
        },
        optimistic
      );
    },
    [chat]
  );

  const handleOpenWorkspace = useCallback((target: ArtifactFocus) => {
    setArtifactOpen(true);
    setFocus(target);
  }, []);

  // Approve the plan: persists any edits, creates the phase-2 job + triggers
  // the worker, then flips into polling mode. Idempotent on the backend
  // (job_id key); the `approving` guard prevents double-fires from the UI.
  const handleApprovePlan = useCallback(async () => {
    if (approving || jobId) return;
    setApproving(true);
    setApproveError(null);
    try {
      const { job_id } = await api.briefs.approvePlan(id);
      setJobId(job_id);
      chat.markApproved();
    } catch (e) {
      setApproveError((e as Error).message ?? "Could not start research");
    } finally {
      setApproving(false);
    }
  }, [api, id, chat, approving, jobId]);

  // Follow-up chat over the finished brief. Enabled only when the job
  // has a final_report — the backend rejects POSTs otherwise.
  const reportReady = !!job?.final_report && job?.status === "completed";
  const reportChat = useReportChat(id, reportReady);

  // Cold-load skeleton gate. The chat surface should show a loader (not
  // a blank "Waiting for the agents…" line) until everything we'd
  // synthesise into the feed has had a chance to settle:
  //   1. Session row itself (so we know the company name + status).
  //   2. If the session has progressed past `pending`, the latest job
  //      lookup must finish — otherwise we briefly render a `pending`
  //      surface for a non-pending session.
  //   3. If the report is ready, the follow-up history fetch must finish
  //      so we don't flash an empty composer below an empty feed.
  const initialLoading =
    session.isLoading ||
    (!!session.data &&
      session.data.status !== "pending" &&
      latestJobQuery.isLoading) ||
    (reportReady && reportChat.loading);

  // Auto-open the artifact panel — but only once the cold-load skeleton
  // has cleared. Without this gate, the artifact would pop open the
  // instant `latestJob` resolved, while the chat side was still in its
  // loading state, producing a staggered/jarring reveal.
  useEffect(() => {
    if (initialLoading) return;
    // The plan lives in its own modal now — only open the artifact workspace
    // once research has actually started (sources / report incoming).
    if (chat.jobId || job) setArtifactOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.jobId, job, initialLoading]);
  const handleFollowupSend = useCallback(
    (text: string) => reportChat.send(text),
    [reportChat]
  );

  const phase = chat.phase;
  const canStart =
    !!session.data && phase === "idle" && session.data.status === "pending";

  // Auto-start the run as soon as the page loads on a pending session.
  // No human "Start research" click — we just kick the SSE off. Ref-guarded
  // so it fires exactly once per mount. The start turn carries the labeled
  // intro as its message; the backend persists it and seeds the graph.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (initialLoading) return;
    if (!canStart) return;
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    const b = session.data!;
    void chat.send({
      kind: "start",
      message: `Company Name: ${b.company_name}\nWebsite: ${b.website}\nObjective: ${b.objective}`,
    });
  }, [canStart, initialLoading, chat.send, session.data]);

  // Build the chat feed. Order:
  //   1. Intro user message — always synthesized from the session row so
  //      the user's original ask anchors the top of the feed (pending,
  //      in-flight, or completed).
  //   2. Live SSE turns from `useWorkflowChat` (node statuses,
  //      clarifications, plan_ready, failed cards).
  //   3. Cold-load synthesis for anything the live stream didn't deliver:
  //      - Three "completed" phase-1 node_status markers when we have a
  //        plan but no live node statuses (so the ticker can walk).
  //      - A plan_ready card when the plan exists but no SSE delivered it.
  //      - A report_ready document card the moment job.final_report lands.
  //      - A failed card if the job ended badly.
  const turns = useMemo<ChatTurn[]>(() => {
    const out: ChatTurn[] = [];
    const live = chat.turns;
    const sessRow = session.data;

    // Intro: render the user's original request from the persisted first
    // message (the messages table is the source of truth). Fall back to the
    // brief row before that message exists (the live pending state).
    const introMsg = phase1Messages.data?.find(
      (m) => m.role === "user" && !m.content.includes("Clarification answer:")
    );
    if (introMsg) {
      out.push({
        role: "user",
        kind: "intro",
        content: introMsg.content,
        at: introMsg.created_at,
      });
    } else if (sessRow) {
      out.push({
        role: "user",
        kind: "intro",
        content: `Company Name: ${sessRow.company_name}\nWebsite: ${sessRow.website}\nObjective: ${sessRow.objective}`,
        at: sessRow.created_at,
      });
    }

    out.push(...live);

    // Cold-load synthesis of phase-1 node statuses. If the session has
    // progressed past phase 1 (we have a plan or a job) but SSE didn't
    // replay any node_status events, fabricate three "completed" markers
    // so the run-activity ticker has steps to walk. The ticker then
    // derives phase-2 activity from `job` + `researchers` polling.
    const hasNodeStatus = out.some(
      (t) => t.role === "assistant" && t.kind === "node_status"
    );
    if (!hasNodeStatus && (plan || job)) {
      // Stagger the synthesized timestamps by 1ms each so sort-by-`at`
      // (anywhere) preserves the same order the SSE would have produced.
      const baseMs = sessRow ? Date.parse(sessRow.created_at) : 0;
      const nodes = [
        "clarify_with_user",
        "write_research_brief",
        "create_research_plan",
      ] as const;
      nodes.forEach((node, i) => {
        out.push({
          role: "assistant",
          kind: "node_status",
          node,
          phase: "completed",
          at: new Date(baseMs + i).toISOString(),
        });
      });
    }

    const hasPlanTurn = out.some(
      (t) => t.role === "assistant" && t.kind === "plan_ready"
    );
    if (!hasPlanTurn && plan) {
      out.push({
        role: "assistant",
        kind: "plan_ready",
        plan,
        acted: true,
        at: job?.created_at ?? sessRow?.created_at ?? new Date(0).toISOString(),
      });
    }

    const hasReportTurn = out.some(
      (t) => t.role === "assistant" && t.kind === "report_ready"
    );
    if (!hasReportTurn && job?.final_report) {
      out.push({
        role: "assistant",
        kind: "report_ready",
        title: deriveReportTitle(job.final_report, sessRow?.company_name ?? "Research brief"),
        jobId: job.id,
        at: job.updated_at ?? job.created_at,
      });
    }

    const hasFailedTurn = out.some(
      (t) => t.role === "assistant" && t.kind === "failed"
    );
    if (!hasFailedTurn && job?.status === "failed") {
      out.push({
        role: "assistant",
        kind: "failed",
        message: "Research run failed. Check the workspace for details.",
        at: job.updated_at ?? job.created_at,
      });
    }

    return out;
  }, [chat.turns, plan, job, session.data, phase1Messages.data]);

  if (!id) return null;

  return (
    // h-full inherits from DashboardLayout's bounded grid row. ChatPanel
    // and ArtifactPanel both use `grid grid-rows-[auto_…_1fr_auto]`
    // internally so their scroll regions are self-contained and the
    // composer/sticky bottoms never get pushed off-screen.
    <div
      className={`grid h-full min-h-0 overflow-hidden bg-bg ${
        artifactOpen
          ? "grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
          : "grid-cols-1"
      }`}
    >
      <ChatPanel
        companyName={session.data?.company_name ?? "Session"}
        turns={turns}
        phase={phase}
        streaming={chat.streaming}
        onAnswers={handleAnswers}
        onOpenReport={() => handleOpenWorkspace("report")}
        onApprovePlan={handleApprovePlan}
        approving={approving}
        approveError={approveError}
        error={chat.error}
        followupEnabled={reportReady}
        followupTurns={reportChat.turns}
        followupSending={reportChat.sending}
        followupError={reportChat.error}
        onFollowupSend={handleFollowupSend}
        initialLoading={initialLoading}
        status={researchStatus}
      />

      <ArtifactPanel
        sessionId={id}
        open={artifactOpen}
        onClose={() => setArtifactOpen(false)}
        focus={focus}
        onFocusHandled={() => setFocus(null)}
        job={job}
        status={researchStatus}
        title={session.data?.company_name ?? "Workspace"}
      />
    </div>
  );
}

/** Try to pull the first non-empty markdown heading off the report as a
 * human-friendly title. Falls back to a sensible default. */
function deriveReportTitle(rawJson: string, fallback: string): string {
  try {
    const parsed = JSON.parse(rawJson) as { company_overview?: { content?: string } };
    const opening = parsed?.company_overview?.content?.split("\n")[0]?.trim();
    if (opening && opening.length <= 140) return opening;
  } catch {
    // not structured JSON or no overview — fall through
  }
  return `${fallback} — research brief`;
}
