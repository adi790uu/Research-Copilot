import { useCallback, useEffect, useRef, useState } from "react";

import { copilotStore } from "../lib/copilotStore";
import type {
  CopilotConversation,
  CopilotMessage,
  EditProposal,
} from "../lib/types";

export type CopilotTurn = CopilotMessage & { streaming?: boolean };

interface State {
  conversations: CopilotConversation[];
  activeId: string | null;
  selectedBriefIds: string[];
  messages: CopilotTurn[];
  loadingMessages: boolean;
  sending: boolean;
  error: string | null;
}

const EMPTY: State = {
  conversations: [],
  activeId: null,
  selectedBriefIds: [],
  messages: [],
  loadingMessages: false,
  sending: false,
  error: null,
};

/**
 * Drives the Copilot: persistent conversations, the research selection that
 * scopes each one, streaming replies, and edit proposals. Backed by
 * `copilotStore` (a local seam) until the backend lands.
 *
 * `titleFor(briefId)` maps a research id to a display title for proposal cards.
 */
export function useCopilotChat(titleFor: (briefId: string) => string) {
  const [state, setState] = useState<State>(EMPTY);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    copilotStore.listConversations().then(async (conversations) => {
      if (cancelled) return;
      const active = conversations[0] ?? null;
      const messages = active ? await copilotStore.listMessages(active.id) : [];
      if (cancelled) return;
      setState((s) => ({
        ...s,
        conversations,
        activeId: active?.id ?? null,
        selectedBriefIds: active?.selected_brief_ids ?? [],
        messages,
      }));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const openConversation = useCallback(async (id: string) => {
    abortRef.current?.abort();
    setState((s) => ({ ...s, loadingMessages: true, error: null }));
    const convo = (await copilotStore.listConversations()).find((c) => c.id === id);
    const messages = await copilotStore.listMessages(id);
    setState((s) => ({
      ...s,
      activeId: id,
      selectedBriefIds: convo?.selected_brief_ids ?? [],
      messages,
      loadingMessages: false,
    }));
  }, []);

  const newConversation = useCallback(() => {
    abortRef.current?.abort();
    setState((s) => ({
      ...s,
      activeId: null,
      selectedBriefIds: [],
      messages: [],
      error: null,
    }));
  }, []);

  const deleteConversation = useCallback(
    async (id: string) => {
      await copilotStore.deleteConversation(id);
      const conversations = await copilotStore.listConversations();
      setState((s) => {
        if (s.activeId !== id) return { ...s, conversations };
        return { ...s, conversations, activeId: null, selectedBriefIds: [], messages: [] };
      });
    },
    [],
  );

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

      let conversationId = state.activeId;
      if (!conversationId) {
        const convo = await copilotStore.createConversation(state.selectedBriefIds);
        conversationId = convo.id;
        setState((s) => ({
          ...s,
          activeId: convo.id,
          conversations: [convo, ...s.conversations],
        }));
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
        const finalMsg = await copilotStore.sendMessage(
          conversationId,
          trimmed,
          titles,
          {
            signal: ctrl.signal,
            onToken: (chunk) =>
              patchAssistant((t) => ({ ...t, content: t.content + chunk })),
            onProposals: (proposals) =>
              patchAssistant((t) => ({ ...t, proposals })),
          },
        );
        patchAssistant((t) => ({
          ...t,
          id: finalMsg.id,
          streaming: false,
          proposals: finalMsg.proposals,
        }));
        const conversations = await copilotStore.listConversations();
        setState((s) => ({ ...s, sending: false, conversations }));
      } catch (e) {
        const msg = (e as Error).message ?? "Send failed";
        patchAssistant((t) => ({ ...t, streaming: false, content: t.content || `[error] ${msg}` }));
        setState((s) => ({ ...s, sending: false, error: msg }));
      }
    },
    [state.activeId, state.selectedBriefIds, state.sending, titleFor],
  );

  const resolveProposal = useCallback(
    async (messageId: string, proposalId: string, status: "applied" | "discarded") => {
      const { activeId } = state;
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
    [state],
  );

  return {
    ...state,
    openConversation,
    newConversation,
    deleteConversation,
    toggleResearch,
    send,
    resolveProposal,
  };
}
