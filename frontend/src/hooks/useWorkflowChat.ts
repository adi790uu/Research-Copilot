import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useApi } from "../lib/api";
import type {
  ChatTurnPayload,
  ClarificationQuestion,
  ResearchPlan,
  WorkflowEvent,
  WorkflowNode,
} from "../lib/types";

// ─── Public turn types ──────────────────────────────────────────────────────

export type AssistantTurn =
  | {
      role: "assistant";
      kind: "node_status";
      node: WorkflowNode;
      phase: "running" | "completed" | "failed";
      at: string;
      error?: string;
    }
  | {
      role: "assistant";
      kind: "clarification";
      questions: ClarificationQuestion[];
      answered: boolean;
      at: string;
    }
  | {
      role: "assistant";
      kind: "plan_ready";
      plan: ResearchPlan;
      acted: boolean;
      at: string;
    }
  | {
      // Synthesized client-side (not from SSE) once the polled job's
      // final_report lands. Renders as a clickable "Document" card in
      // the chat; clicking opens the artifact panel scrolled to the
      // report block.
      role: "assistant";
      kind: "report_ready";
      title: string;
      jobId: string;
      at: string;
    }
  | { role: "assistant"; kind: "failed"; message: string; at: string };

export type UserTurn =
  | { role: "user"; kind: "intro"; content: string; at: string }
  | {
      role: "user";
      kind: "answers";
      lines: { question: string; answer: string }[];
      at: string;
    }
  | { role: "user"; kind: "approval"; content: string; at: string };

export type ChatTurn = AssistantTurn | UserTurn;

export type RunPhase =
  | "idle"
  | "running"
  | "awaiting_clarification"
  | "awaiting_plan_approval"
  | "completed"
  | "failed";

export interface WorkflowChatState {
  turns: ChatTurn[];
  phase: RunPhase;
  plan: ResearchPlan | null;
  clarification: ClarificationQuestion[] | null;
  /** Set once the SSE delivers `plan_ready` — that's our cue to stop
   * watching SSE and start polling /jobs/{jobId}. Stays set for the
   * lifetime of the session view. */
  jobId: string | null;
  streaming: boolean;
  error: string | null;
}

export const NODES: WorkflowNode[] = [
  "clarify_with_user",
  "write_research_brief",
  "create_research_plan",
];

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Drives the phase-1 SSE chat against `POST /sessions/{id}/chat`.
 *
 * Each `send()` POSTs the user turn and reads the SSE response body to
 * completion. Events become assistant turns in `turns`. The stream closes
 * naturally when the graph pauses (clarification, plan ready) or fails.
 *
 * Phase 2 (research + final report) is NOT covered here — the caller polls
 * `useLatestJob` / `useJob` once the plan is approved.
 */
export function useWorkflowChat(sessionId: string): WorkflowChatState & {
  send: (payload: ChatTurnPayload, optimistic?: UserTurn) => Promise<void>;
  subscribe: () => Promise<void>;
  /** Called once `POST /plan/approve` succeeds: flips into the running
   * phase and marks the plan card as acted so it stops offering approval. */
  markApproved: () => void;
  reset: () => void;
} {
  const api = useApi();
  const [state, setState] = useState<WorkflowChatState>(initial);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setState(initial());
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [sessionId]);

  const handleEvent = useCallback((ev: WorkflowEvent) => {
    setState((s) => reduce(s, ev));
  }, []);

  const stream = useCallback(
    async (payload: ChatTurnPayload, optimistic?: UserTurn) => {
      if (!sessionId) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setState((s) => {
        // Submitting clarification answers: collapse the question card
        // immediately (mark the most recent unanswered clarification turn
        // as answered) and optimistically flip the phase to "running" so
        // the footer doesn't briefly land on "awaiting_clarification"
        // after the user has already moved on. The next SSE event will
        // confirm the real phase.
        const isAnswer = payload.kind === "answer";
        let turns = isAnswer ? markClarificationAnswered(s.turns) : s.turns;
        if (optimistic) turns = [...turns, optimistic];
        return {
          ...s,
          streaming: true,
          error: null,
          phase: isAnswer ? "running" : s.phase,
          turns,
        };
      });

      try {
        const res = await api.sessions.chat(sessionId, payload, ctrl.signal);
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const body = await res.json();
            detail = body?.error?.message ?? detail;
          } catch {
            /* ignore */
          }
          throw new Error(detail);
        }
        if (!res.body) throw new Error("Streaming not supported by this browser");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) !== -1) {
            const block = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const event = parseSseBlock(block);
            if (event) handleEvent(event);
          }
        }
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
        setState((s) => ({ ...s, error: (e as Error).message ?? "stream failed" }));
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
        setState((s) => ({ ...s, streaming: false }));
      }
    },
    [api, sessionId, handleEvent]
  );

  const subscribe = useCallback(() => stream({ kind: "subscribe" }), [stream]);

  const markApproved = useCallback(() => {
    setState((s) => ({
      ...s,
      phase: "running",
      turns: s.turns.map((t) =>
        t.role === "assistant" && t.kind === "plan_ready"
          ? { ...t, acted: true }
          : t
      ),
    }));
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(initial());
  }, []);

  // Stabilize the returned object so consumers using `chat` in deps don't
  // re-evaluate on every render. Identity only changes when state or one
  // of the callbacks actually changes.
  return useMemo(
    () => ({ ...state, send: stream, subscribe, markApproved, reset }),
    [state, stream, subscribe, markApproved, reset]
  );
}

// ─── Reducer ────────────────────────────────────────────────────────────────

function initial(): WorkflowChatState {
  return {
    turns: [],
    phase: "idle",
    plan: null,
    clarification: null,
    jobId: null,
    streaming: false,
    error: null,
  };
}

function reduce(s: WorkflowChatState, ev: WorkflowEvent): WorkflowChatState {
  switch (ev.type) {
    case "run_started":
      return { ...s, phase: "running", error: null };
    case "node_started":
      return { ...s, turns: appendNodeStatus(s.turns, ev.node, "running", ev.at) };
    case "node_completed":
      return { ...s, turns: updateNodeStatus(s.turns, ev.node, "completed") };
    case "node_failed":
      return { ...s, turns: updateNodeStatus(s.turns, ev.node, "failed", ev.message) };
    case "clarification_requested":
      return {
        ...s,
        phase: "awaiting_clarification",
        clarification: ev.questions,
        turns: [
          ...s.turns,
          {
            role: "assistant",
            kind: "clarification",
            questions: ev.questions,
            answered: false,
            at: ev.at,
          },
        ],
      };
    case "plan_ready":
      // Graph 1 is done; the plan pauses for the user to review + approve.
      // No job exists yet — `acted: false` keeps the card actionable until
      // approval. (Legacy auto-spawn runs may still carry a job_id.)
      return {
        ...s,
        phase: "awaiting_plan_approval",
        plan: ev.plan,
        jobId: ev.job_id ?? null,
        turns: [
          ...s.turns,
          {
            role: "assistant",
            kind: "plan_ready",
            plan: ev.plan,
            acted: !!ev.job_id,
            at: ev.at,
          },
        ],
      };
    case "run_failed":
      return {
        ...s,
        phase: "failed",
        error: ev.message,
        turns: [
          ...s.turns,
          { role: "assistant", kind: "failed", message: ev.message, at: ev.at },
        ],
      };
    default:
      return s;
  }
}

function markClarificationAnswered(turns: ChatTurn[]): ChatTurn[] {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.role === "assistant" && t.kind === "clarification" && !t.answered) {
      const next: ChatTurn = { ...t, answered: true };
      return [...turns.slice(0, i), next, ...turns.slice(i + 1)];
    }
  }
  return turns;
}

function appendNodeStatus(
  turns: ChatTurn[],
  node: WorkflowNode,
  phase: "running" | "completed" | "failed",
  at: string
): ChatTurn[] {
  const last = turns[turns.length - 1];
  if (
    last &&
    last.role === "assistant" &&
    last.kind === "node_status" &&
    last.node === node
  ) {
    return [...turns.slice(0, -1), { ...last, phase }];
  }
  return [...turns, { role: "assistant", kind: "node_status", node, phase, at }];
}

function updateNodeStatus(
  turns: ChatTurn[],
  node: WorkflowNode,
  phase: "running" | "completed" | "failed",
  error?: string
): ChatTurn[] {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.role === "assistant" && t.kind === "node_status" && t.node === node) {
      const replaced: ChatTurn = { ...t, phase, ...(error ? { error } : {}) };
      return [...turns.slice(0, i), replaced, ...turns.slice(i + 1)];
    }
  }
  return [
    ...turns,
    {
      role: "assistant",
      kind: "node_status",
      node,
      phase,
      at: new Date().toISOString(),
      ...(error ? { error } : {}),
    },
  ];
}

// ─── SSE parsing ────────────────────────────────────────────────────────────

function parseSseBlock(block: string): WorkflowEvent | null {
  if (!block || block.startsWith(":")) return null;
  let event = "";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!event || !data) return null;
  try {
    return JSON.parse(data) as WorkflowEvent;
  } catch {
    return null;
  }
}
