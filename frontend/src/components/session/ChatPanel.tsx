import { useEffect, useMemo, useRef, useState } from "react";

import { useChatStream } from "../../hooks/useChatStream";
import type { ChatWithMessages, Source } from "../../lib/types";
import { SourceCitation } from "./SourceCitation";

const PROMPTS = [
  "What should I lead with?",
  "What signals matter most right now?",
  "Who else should be on the email?",
];

interface Props {
  chat: ChatWithMessages;
  sources: Source[];
}

export function ChatPanel({ chat, sources }: Props) {
  const { messages, streaming, error, sendMessage } = useChatStream(chat.id, chat.messages);
  const [draft, setDraft] = useState("");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const sourceById = useMemo(() => {
    const m: Record<string, { source: Source; index: number }> = {};
    sources.forEach((s, i) => {
      m[s.id] = { source: s, index: i + 1 };
    });
    return m;
  }, [sources]);

  // Sticky-bottom auto-scroll: only follow new tokens if the user is already
  // pinned to the bottom. If they scrolled up to read history, leave them be.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = draft;
    setDraft("");
    await sendMessage(content);
  };

  const onSuggest = async (prompt: string) => {
    if (streaming) return;
    setDraft("");
    await sendMessage(prompt);
  };

  const showEmptyState = messages.length === 0 && !streaming;

  return (
    <div className="surface rounded-sm overflow-hidden flex flex-col" style={{ minHeight: "28rem" }}>
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-4 sm:px-6 md:px-8 py-6 space-y-5"
        style={{ maxHeight: "32rem" }}
      >
        {showEmptyState ? (
          <EmptyState onPick={onSuggest} />
        ) : (
          messages.map((m) => (
            <MessageRow
              key={m.id}
              role={m.role}
              content={m.content}
              streaming={m.streaming === true && m.role === "assistant"}
              sourceById={sourceById}
            />
          ))
        )}

        {error && (
          <p className="font-mono text-[0.6875rem] uppercase tracking-wider text-bad">
            {error}
          </p>
        )}
      </div>

      <form
        onSubmit={onSubmit}
        className="border-t border-rule/10 px-4 sm:px-6 md:px-8 py-4"
      >
        <div className="flex items-end gap-3">
          <label htmlFor="chat-input" className="sr-only">
            Ask the briefing
          </label>
          <textarea
            id="chat-input"
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!streaming && draft.trim()) {
                  void onSubmit(e as unknown as React.FormEvent);
                }
              }
            }}
            placeholder="Ask the brief — sources, signals, talking points…"
            className="input flex-1 resize-none py-2"
            style={{ maxHeight: "8rem" }}
            disabled={streaming}
          />
          <button
            type="submit"
            className="btn-primary"
            disabled={streaming || !draft.trim()}
            aria-label="Send message"
          >
            <span className="hidden sm:inline">
              {streaming ? "Streaming…" : "Send"}
            </span>
            <span aria-hidden className="arrow">→</span>
          </button>
        </div>
        <p className="mt-2 font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint/70">
          <kbd className="not-italic">↵</kbd> to send ·{" "}
          <kbd className="not-italic">⇧ ↵</kbd> for newline
        </p>
      </form>
    </div>
  );
}

interface MessageRowProps {
  role: "user" | "assistant";
  content: string;
  streaming: boolean;
  sourceById: Record<string, { source: Source; index: number }>;
}

function MessageRow({ role, content, streaming, sourceById }: MessageRowProps) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-surface px-4 py-3 rounded-sm border border-rule/10">
          <p className="text-sm text-ink whitespace-pre-wrap leading-relaxed">{content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="eyebrow">Assistant</span>
      <div className="text-[0.9375rem] text-ink leading-relaxed whitespace-pre-wrap">
        <RenderWithCitations text={content} sourceById={sourceById} />
        {streaming && <StreamingCursor />}
      </div>
    </div>
  );
}

const CITATION_RE = /\[([a-zA-Z0-9_-]+(?:\s*,\s*[a-zA-Z0-9_-]+)*)\]/g;

function RenderWithCitations({
  text,
  sourceById,
}: {
  text: string;
  sourceById: Record<string, { source: Source; index: number }>;
}) {
  if (!text) return null;
  const out: React.ReactNode[] = [];
  let lastIdx = 0;
  let key = 0;

  for (const match of text.matchAll(CITATION_RE)) {
    const ids = match[1].split(/\s*,\s*/);
    const known = ids.map((id) => sourceById[id]).filter(Boolean);
    if (known.length === 0) continue;

    const start = match.index ?? 0;
    if (start > lastIdx) out.push(text.slice(lastIdx, start));
    known.forEach(({ source, index }, i) => {
      out.push(
        <SourceCitation key={`c-${key++}`} source={source} index={index} />
      );
      if (i < known.length - 1) out.push(" ");
    });
    lastIdx = start + match[0].length;
  }
  if (lastIdx < text.length) out.push(text.slice(lastIdx));
  return <>{out}</>;
}

function StreamingCursor() {
  return (
    <span
      aria-hidden
      className="inline-block w-[0.4em] h-[1em] align-text-bottom ml-1 bg-ink/70"
      style={{ animation: "cursor-blink 1s steps(1) infinite" }}
    />
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="py-6">
      <p className="eyebrow">Conversation open</p>
      <h3
        className="mt-3 font-display italic text-2xl text-ink"
        style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
      >
        Ask the brief anything.
      </h3>
      <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-prose">
        Answers stay grounded in the report and its sources. Try one of these to
        start, or write your own.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        {PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className="btn-ghost text-xs"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
