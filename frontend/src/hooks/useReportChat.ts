import { useCallback, useEffect, useRef, useState } from "react";

import { useApi } from "../lib/api";
import type { FollowupMessage, FollowupRole } from "../lib/types";

/** A turn in the follow-up chat. Same shape as the persisted row, with
 * an optional `streaming` flag while the assistant reply is in flight. */
export interface ReportChatTurn {
  id: string;
  role: FollowupRole;
  content: string;
  created_at: string;
  streaming?: boolean;
}

interface State {
  turns: ReportChatTurn[];
  loading: boolean;
  sending: boolean;
  error: string | null;
}

/**
 * Drives the post-report follow-up chat for a session.
 *
 * - On mount (when `enabled`), loads history via `GET /messages`.
 * - `send(text)` POSTs to `/messages` and reads the SSE token stream,
 *   appending to a streaming assistant turn that finalizes on `done`.
 *
 * Disabled until the research job hits `completed` — callers gate on
 * `job.status === "completed"`.
 */
export function useReportChat(sessionId: string, enabled: boolean) {
  const api = useApi();
  const [state, setState] = useState<State>({
    turns: [],
    loading: false,
    sending: false,
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  // Reset whenever the session or enabled flag changes.
  useEffect(() => {
    setState({ turns: [], loading: false, sending: false, error: null });
    abortRef.current?.abort();
    abortRef.current = null;
  }, [sessionId, enabled]);

  // Initial history load.
  useEffect(() => {
    if (!enabled || !sessionId) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    api.briefs
      .listMessages(sessionId, "followup")
      .then((rows: FollowupMessage[]) => {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          loading: false,
          turns: rows.map((r) => ({ ...r })),
        }));
      })
      .catch((e) => {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: (e as Error).message ?? "Failed to load history",
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [api, sessionId, enabled]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !enabled || !sessionId) return;

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const now = new Date().toISOString();
      const userTurn: ReportChatTurn = {
        id: `local-user-${now}`,
        role: "user",
        content: trimmed,
        created_at: now,
      };
      const assistantTurn: ReportChatTurn = {
        id: `local-assistant-${now}`,
        role: "assistant",
        content: "",
        created_at: now,
        streaming: true,
      };

      setState((s) => ({
        ...s,
        sending: true,
        error: null,
        turns: [...s.turns, userTurn, assistantTurn],
      }));

      const finalize = (patch?: Partial<ReportChatTurn>) =>
        setState((s) => {
          const turns = s.turns.slice();
          for (let i = turns.length - 1; i >= 0; i--) {
            if (turns[i].id === assistantTurn.id) {
              turns[i] = {
                ...turns[i],
                ...(patch ?? {}),
                streaming: false,
              };
              break;
            }
          }
          return { ...s, sending: false, turns };
        });

      const appendChunk = (chunk: string) =>
        setState((s) => {
          const turns = s.turns.slice();
          for (let i = turns.length - 1; i >= 0; i--) {
            if (turns[i].id === assistantTurn.id) {
              turns[i] = {
                ...turns[i],
                content: turns[i].content + chunk,
              };
              break;
            }
          }
          return { ...s, turns };
        });

      try {
        const res = await api.briefs.postMessage(
          sessionId,
          trimmed,
          ctrl.signal
        );
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const body = await res.json();
            detail = body?.error?.message ?? detail;
          } catch {
            /* ignore */
          }
          finalize({ content: `[error] ${detail}` });
          setState((s) => ({ ...s, error: detail }));
          return;
        }
        if (!res.body) {
          finalize({ content: "[error] streaming unsupported" });
          return;
        }

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
            const parsed = parseSseBlock(block);
            if (!parsed) continue;
            if (parsed.event === "token") appendChunk(parsed.data);
            else if (parsed.event === "error") {
              setState((s) => ({ ...s, error: parsed.data }));
              appendChunk(`\n\n[error] ${parsed.data}`);
            } else if (parsed.event === "done") {
              break;
            }
          }
        }
        finalize();
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") {
          finalize();
          return;
        }
        const msg = (e as Error).message ?? "stream failed";
        setState((s) => ({ ...s, error: msg }));
        finalize({ content: `[error] ${msg}` });
      }
    },
    [api, sessionId, enabled]
  );

  return { ...state, send };
}

function parseSseBlock(block: string): { event: string; data: string } | null {
  if (!block || block.startsWith(":")) return null;
  let event = "";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).startsWith(" ") ? line.slice(6) : line.slice(5));
    }
  }
  if (!event) return null;
  return { event, data: dataLines.join("\n") };
}
