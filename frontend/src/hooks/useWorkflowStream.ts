import { useAuth } from "@clerk/clerk-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useApi } from "../lib/api";
import type {
  NodeFailedEvent,
  ReportReadyEvent,
  RunFailedEvent,
  WorkflowEvent,
  WorkflowNode,
} from "../lib/types";

export const NODES: WorkflowNode[] = [
  "planner",
  "researcher",
  "extractor",
  "synthesizer",
  "quality_gate",
  "assembler",
];

export type NodePhase = "idle" | "running" | "completed" | "failed";

export interface NodeState {
  phase: NodePhase;
  attempt: number;
  durationMs?: number;
  error?: string;
}

export type RunPhase = "idle" | "running" | "completed" | "failed";

export interface StreamState {
  phase: RunPhase;
  nodes: Record<WorkflowNode, NodeState>;
  reportId: string | null;
  error: string | null;
  events: WorkflowEvent[];
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
      // Wipe per-node state for a fresh run.
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

      es.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data) as WorkflowEvent;
          setState((s) => reduce(s, parsed));
        } catch {
          // ignore parse errors — keep the stream alive
        }
      };
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

  // Auto-close once the run is in a terminal state.
  useEffect(() => {
    if (state.phase === "completed" || state.phase === "failed") {
      esRef.current?.close();
      esRef.current = null;
    }
  }, [state.phase]);

  return useMemo(() => state, [state]);
}
