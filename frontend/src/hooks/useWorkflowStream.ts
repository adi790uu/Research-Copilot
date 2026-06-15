import { useAuth } from "@clerk/clerk-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useApi } from "../lib/api";
import type {
  ClarificationQuestion,
  ClarificationRequestedEvent,
  NodeFailedEvent,
  PlanReadyEvent,
  ReportReadyEvent,
  ResearchPlan,
  RunFailedEvent,
  WorkflowEvent,
  WorkflowNode,
} from "../lib/types";

export const NODES: WorkflowNode[] = [
  "clarify_with_user",
  "write_research_brief",
  "create_research_plan",
  "research_supervisor",
  "final_report_generation",
];

export type NodePhase = "idle" | "running" | "completed" | "failed";

export interface NodeState {
  phase: NodePhase;
  attempt: number;
  durationMs?: number;
  error?: string;
}

export type RunPhase =
  | "idle"
  | "running"
  | "awaiting_clarification"
  | "awaiting_plan_approval"
  | "completed"
  | "failed";

export interface StreamState {
  phase: RunPhase;
  nodes: Record<WorkflowNode, NodeState>;
  reportId: string | null;
  error: string | null;
  events: WorkflowEvent[];
  clarification: ClarificationQuestion[] | null;
  plan: ResearchPlan | null;
}

const INITIAL_NODES: Record<WorkflowNode, NodeState> = Object.fromEntries(
  NODES.map((n) => [n, { phase: "idle", attempt: 0 } satisfies NodeState])
) as Record<WorkflowNode, NodeState>;

function initialState(): StreamState {
  return {
    phase: "idle",
    nodes: { ...INITIAL_NODES },
    reportId: null,
    error: null,
    events: [],
    clarification: null,
    plan: null,
  };
}

function reduce(state: StreamState, ev: WorkflowEvent): StreamState {
  const next: StreamState = {
    ...state,
    nodes: { ...state.nodes },
    events: [...state.events, ev],
  };

  switch (ev.type) {
    case "run_started":
      next.phase = "running";
      next.error = null;
      next.reportId = null;
      next.clarification = null;
      // `plan` survives the re-run so the UI can keep showing the prior plan
      // until a fresh `plan_ready` arrives — this avoids a flicker on resume.
      for (const n of NODES) next.nodes[n] = { phase: "idle", attempt: 0 };
      break;
    case "node_started":
      next.nodes[ev.node] = {
        phase: "running",
        attempt: ev.attempt,
      };
      break;
    case "node_completed":
      next.nodes[ev.node] = {
        phase: "completed",
        attempt: ev.attempt,
        durationMs: ev.duration_ms,
      };
      break;
    case "node_failed":
      next.nodes[ev.node] = {
        phase: "failed",
        attempt: ev.attempt,
        error: (ev as NodeFailedEvent).message,
      };
      break;
    case "clarification_requested":
      next.phase = "awaiting_clarification";
      next.clarification = (ev as ClarificationRequestedEvent).questions;
      break;
    case "plan_ready":
      next.phase = "awaiting_plan_approval";
      next.plan = (ev as PlanReadyEvent).plan;
      break;
    case "report_ready":
      next.phase = "completed";
      next.reportId = (ev as ReportReadyEvent).report_id;
      break;
    case "run_failed":
      next.phase = "failed";
      next.error = (ev as RunFailedEvent).message;
      break;
  }
  return next;
}

/**
 * Subscribes to /sessions/{id}/stream and reduces incoming events into a
 * UI-friendly state shape. Reconnects to the same session id replay history.
 *
 * `enabled=false` keeps the hook quiet (no EventSource opened). Flip it true
 * once the user has started a run or whenever the session is in flight.
 */
export function useWorkflowStream(sessionId: string, enabled: boolean): StreamState {
  const api = useApi();
  const { getToken } = useAuth();
  const [state, setState] = useState<StreamState>(() => initialState());
  const esRef = useRef<EventSource | null>(null);

  // Reset state when the session id changes so a navigation to a new session
  // doesn't carry over stale nodes.
  useEffect(() => {
    setState(initialState());
  }, [sessionId]);

  useEffect(() => {
    if (!enabled || !sessionId) return;
    let cancelled = false;
    let es: EventSource | null = null;

    (async () => {
      const token = await getToken();
      if (!token || cancelled) return;
      const url = api.sessions.streamUrl(sessionId, token);
      es = new EventSource(url);
      esRef.current = es;

      // Per the EventSource spec, a message with `event: <name>` is dispatched
      // as a typed event — `onmessage` only fires for default (unnamed)
      // messages. Our backend emits `event: <type>` for every event, so we
      // register one listener per type. They all share the same reducer.
      const handler = (evt: MessageEvent) => {
        try {
          const parsed = JSON.parse(evt.data) as WorkflowEvent;
          setState((s) => reduce(s, parsed));
        } catch {
          // ignore parse errors — keep the stream alive
        }
      };
      const EVENT_TYPES: WorkflowEvent["type"][] = [
        "run_started",
        "node_started",
        "node_completed",
        "node_failed",
        "clarification_requested",
        "plan_ready",
        "report_ready",
        "run_failed",
      ];
      for (const t of EVENT_TYPES) {
        es.addEventListener(t, handler as EventListener);
      }
      // Defensive: also handle the default channel in case the backend ever
      // omits the `event:` line.
      es.onmessage = handler;
      es.onerror = () => {
        // EventSource auto-reconnects. We don't surface transient errors,
        // but if the server closed cleanly after a terminal event, close out.
        if (es && es.readyState === EventSource.CLOSED) {
          esRef.current = null;
        }
      };
    })();

    return () => {
      cancelled = true;
      if (es) es.close();
      esRef.current = null;
    };
  }, [enabled, sessionId, api, getToken]);

  // Auto-close once the run is in a terminal state. The two awaiting_* phases
  // are NOT terminal — they wait for a user action and then a new run replays
  // events, but `clarification_requested` is treated as terminal by the bus
  // so the server side closes the stream anyway.
  useEffect(() => {
    if (state.phase === "completed" || state.phase === "failed") {
      esRef.current?.close();
      esRef.current = null;
    }
  }, [state.phase]);

  return useMemo(() => state, [state]);
}
