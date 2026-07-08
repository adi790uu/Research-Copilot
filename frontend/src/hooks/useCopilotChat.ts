import { useCallback, useEffect, useRef, useState } from "react";

import { useApi } from "../lib/api";
import { readSSE } from "../lib/sse";
import type { CopilotMessage } from "../lib/types";

export type CopilotTurn = CopilotMessage & { streaming?: boolean };

interface State {
  activeId: string | null;
  activeTitle: string;
  selectedBriefIds: string[];
  messages: CopilotTurn[];
  loading: boolean;
  sending: boolean;
  error: string | null;
}

const EMPTY: State = {
  activeId: null,
  activeTitle: "New chat",
  selectedBriefIds: [],
  messages: [],
  loading: false,
  sending: false,
  error: null,
};

const TITLE_MAX = 60;

function titleFrom(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX)}…` : clean || "New chat";
}

const newId = (): string =>
  crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

interface Options {
  /** The conversation to open, from the `?c=` URL param. `null` = fresh chat. */
  conversationId: string | null;
  /** Push a newly-created conversation id back to the URL. */
  onActiveChange: (id: string | null) => void;
}

/**
 * Drives one Copilot conversation, backed by the `/copilot` API. The active
 * conversation is URL-driven (`conversationId`); the chat id is generated
 * client-side on the first send and created server-side with that first turn.
 */
export function useCopilotChat(_titleFor: (briefId: string) => string, opts: Options) {
  const { conversationId, onActiveChange } = opts;
  const api = useApi();
  // Deep-linked to an existing chat (?c=…)? Start in loading so the thread shows
  // the skeleton from the first paint instead of flashing the empty state before
  // the fetch effect runs.
  const [state, setState] = useState<State>(() =>
    conversationId ? { ...EMPTY, loading: true } : EMPTY,
  );
  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = state.activeId;

  useEffect(() => {
    if (!conversationId) {
      abortRef.current?.abort();
      setState({ ...EMPTY });
      return;
    }
    // Already the active thread — e.g. we just created it locally and the URL is
    // only now catching up. Don't refetch, and crucially don't abort: the send
    // that created this chat is still streaming its reply.
    if (conversationId === activeRef.current) return;

    // Switching to a different conversation: cancel any in-flight stream/load.
    abortRef.current?.abort();
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      try {
        const chat = await api.copilot.chat(conversationId);
        if (cancelled) return;
        setState({
          activeId: chat.id,
          activeTitle: chat.title,
          // Research selection isn't persisted; the user re-picks per session.
          selectedBriefIds: [],
          messages: chat.messages,
          loading: false,
          sending: false,
          error: null,
        });
      } catch {
        if (cancelled) return;
        // Unknown / not-yet-persisted id: treat as a fresh thread on this id.
        setState({ ...EMPTY });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, api]);

  const toggleResearch = useCallback((briefId: string) => {
    setState((s) => {
      const next = s.selectedBriefIds.includes(briefId)
        ? s.selectedBriefIds.filter((id) => id !== briefId)
        : [...s.selectedBriefIds, briefId];
      return { ...s, selectedBriefIds: next };
    });
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || state.sending) return;

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      let convId = state.activeId;
      const isFirstTurn = !convId;
      if (!convId) {
        convId = newId();
        setState((s) => ({ ...s, activeId: convId }));
        onActiveChange(convId);
      }

      const stamp = new Date().toISOString();
      const userTurn: CopilotTurn = {
        id: `local-user-${stamp}`,
        role: "user",
        content: trimmed,
        created_at: stamp,
      };
      const assistantTurn: CopilotTurn = {
        id: `local-assistant-${stamp}`,
        role: "assistant",
        content: "",
        created_at: stamp,
        streaming: true,
      };
      setState((s) => ({
        ...s,
        sending: true,
        error: null,
        activeTitle: isFirstTurn ? titleFrom(trimmed) : s.activeTitle,
        messages: [...s.messages, userTurn, assistantTurn],
      }));

      const patchAssistant = (patch: (t: CopilotTurn) => CopilotTurn) =>
        setState((s) => {
          const messages = s.messages.slice();
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].id === assistantTurn.id) {
              messages[i] = patch(messages[i]);
              break;
            }
          }
          return { ...s, messages };
        });

      try {
        const res = await api.copilot.send(
          { chat_id: convId, research_ids: state.selectedBriefIds, message: trimmed },
          ctrl.signal,
        );
        let errored: string | null = null;
        await readSSE(res, {
          onToken: (chunk) => patchAssistant((t) => ({ ...t, content: t.content + chunk })),
          onError: (msg) => {
            errored = msg;
          },
        });
        patchAssistant((t) => ({
          ...t,
          streaming: false,
          content: t.content || (errored ? `[error] ${errored}` : ""),
        }));
        setState((s) => ({ ...s, sending: false, error: errored }));
      } catch (e) {
        if (ctrl.signal.aborted) {
          setState((s) => ({ ...s, sending: false }));
          return;
        }
        const msg = (e as Error).message ?? "Send failed";
        patchAssistant((t) => ({ ...t, streaming: false, content: t.content || `[error] ${msg}` }));
        setState((s) => ({ ...s, sending: false, error: msg }));
      }
    },
    [state.activeId, state.selectedBriefIds, state.sending, onActiveChange, api],
  );

  // Edit proposals are not produced by the backend yet; kept as a no-op so the
  // thread UI's handler stays wired for when they land.
  const resolveProposal = useCallback(
    async (messageId: string, proposalId: string, status: "applied" | "discarded") => {
      setState((s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id !== messageId
            ? m
            : {
                ...m,
                proposals: m.proposals?.map((p) =>
                  p.id === proposalId ? { ...p, status } : p,
                ),
              },
        ),
      }));
    },
    [],
  );

  return { ...state, toggleResearch, send, resolveProposal };
}
