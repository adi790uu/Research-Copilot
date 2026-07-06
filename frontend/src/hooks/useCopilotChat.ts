import { useCallback, useEffect, useRef, useState } from "react";

import { copilotStore } from "../lib/copilotStore";
import type { CopilotMessage, EditProposal } from "../lib/types";

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

interface Options {
  /** The conversation to open, from the `?c=` URL param. `null` = fresh chat. */
  conversationId: string | null;
  /** Push a newly-created conversation id back to the URL. */
  onActiveChange: (id: string | null) => void;
}

/**
 * Drives one Copilot conversation. The active conversation is URL-driven
 * (`conversationId`); the list of conversations lives in the Chats route.
 * Backed by `copilotStore` until the backend lands.
 */
export function useCopilotChat(titleFor: (briefId: string) => string, opts: Options) {
  const { conversationId, onActiveChange } = opts;
  const [state, setState] = useState<State>(EMPTY);
  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = state.activeId;

  useEffect(() => {
    let cancelled = false;
    abortRef.current?.abort();

    if (!conversationId) {
      setState({ ...EMPTY });
      return;
    }
    if (conversationId === activeRef.current) return;

    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      const convos = await copilotStore.listConversations();
      const convo = convos.find((c) => c.id === conversationId);
      const messages = await copilotStore.listMessages(conversationId);
      if (cancelled) return;
      setState({
        activeId: conversationId,
        activeTitle: convo?.title ?? "New chat",
        selectedBriefIds: convo?.selected_brief_ids ?? [],
        messages,
        loading: false,
        sending: false,
        error: null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const toggleResearch = useCallback((briefId: string) => {
    setState((s) => {
      const next = s.selectedBriefIds.includes(briefId)
        ? s.selectedBriefIds.filter((id) => id !== briefId)
        : [...s.selectedBriefIds, briefId];
      if (s.activeId) void copilotStore.setSelectedResearches(s.activeId, next);
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
      if (!convId) {
        const convo = await copilotStore.createConversation(state.selectedBriefIds);
        convId = convo.id;
        setState((s) => ({ ...s, activeId: convo.id }));
        onActiveChange(convo.id);
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

      const titles = state.selectedBriefIds.map(titleFor);
      try {
        const finalMsg = await copilotStore.sendMessage(convId, trimmed, titles, {
          signal: ctrl.signal,
          onToken: (chunk) => patchAssistant((t) => ({ ...t, content: t.content + chunk })),
          onProposals: (proposals) => patchAssistant((t) => ({ ...t, proposals })),
        });
        patchAssistant((t) => ({
          ...t,
          id: finalMsg.id,
          streaming: false,
          proposals: finalMsg.proposals,
        }));
        const convo = (await copilotStore.listConversations()).find((c) => c.id === convId);
        setState((s) => ({ ...s, sending: false, activeTitle: convo?.title ?? s.activeTitle }));
      } catch (e) {
        const msg = (e as Error).message ?? "Send failed";
        patchAssistant((t) => ({ ...t, streaming: false, content: t.content || `[error] ${msg}` }));
        setState((s) => ({ ...s, sending: false, error: msg }));
      }
    },
    [state.activeId, state.selectedBriefIds, state.sending, titleFor, onActiveChange],
  );

  const resolveProposal = useCallback(
    async (messageId: string, proposalId: string, status: "applied" | "discarded") => {
      const activeId = activeRef.current;
      if (!activeId) return;
      await copilotStore.resolveProposal(activeId, messageId, proposalId, status);
      setState((s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id !== messageId
            ? m
            : {
                ...m,
                proposals: m.proposals?.map((p: EditProposal) =>
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
