import { useAuth } from "@clerk/clerk-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { apiBaseUrl } from "../lib/api";
import type { Message, MessageRole } from "../lib/types";

interface DraftMessage {
  id: string;
  chat_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
  /** True while tokens are still arriving from the server. */
  streaming?: boolean;
}

export interface ChatStreamState {
  messages: DraftMessage[];
  streaming: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  reset: (messages: Message[]) => void;
}

const TEMP_PREFIX = "tmp_";
const makeTempId = (): string => `${TEMP_PREFIX}${Math.random().toString(36).slice(2, 11)}`;

/**
 * POSTs a user message to /chats/{id}/messages/stream and parses the SSE
 * response, appending tokens to a draft assistant message until `event: done`.
 *
 * `initial` seeds the message list (e.g. from a `/chats/{id}` GET) and is
 * re-applied whenever the chat id changes.
 */
export function useChatStream(chatId: string | null, initial: Message[]): ChatStreamState {
  const { getToken } = useAuth();
  const [messages, setMessages] = useState<DraftMessage[]>(initial);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setMessages(initial);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const reset = useCallback((next: Message[]) => {
    setMessages(next);
    setError(null);
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!chatId || streaming) return;
      const trimmed = content.trim();
      if (!trimmed) return;

      const token = await getToken();
      if (!token) {
        setError("Authentication required");
        return;
      }

      const now = new Date().toISOString();
      const userDraft: DraftMessage = {
        id: makeTempId(),
        chat_id: chatId,
        role: "user",
        content: trimmed,
        created_at: now,
      };
      const assistantDraft: DraftMessage = {
        id: makeTempId(),
        chat_id: chatId,
        role: "assistant",
        content: "",
        created_at: now,
        streaming: true,
      };
      const assistantId = assistantDraft.id;

      setMessages((prev) => [...prev, userDraft, assistantDraft]);
      setStreaming(true);
      setError(null);

      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;

      try {
        const response = await fetch(`${apiBaseUrl}/chats/${chatId}/messages/stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ content: trimmed }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const body = await response.text().catch(() => "");
          throw new Error(body || `Stream failed (${response.status})`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const parsed = parseSseFrame(frame);
            if (!parsed) continue;
            if (parsed.event === "token") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: m.content + parsed.data } : m
                )
              );
            }
            // 'done' frame is implicit — loop ends when reader finishes.
          }
        }
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          setError((err as Error).message);
        }
      } finally {
        setMessages((prev) => {
          // Drop the assistant draft if nothing streamed in — leaving a blank
          // bubble on an error reads worse than just showing the error line.
          const draft = prev.find((m) => m.id === assistantId);
          if (draft && draft.content.length === 0) {
            return prev.filter((m) => m.id !== assistantId);
          }
          return prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m
          );
        });
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [chatId, getToken, streaming]
  );

  return { messages, streaming, error, sendMessage, reset };
}

interface SseFrame {
  event: string;
  data: string;
}

function parseSseFrame(raw: string): SseFrame | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith(":")) continue; // comment / keep-alive
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      // SSE spec: strip a single leading space.
      const v = line.slice(5);
      dataLines.push(v.startsWith(" ") ? v.slice(1) : v);
    }
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}
