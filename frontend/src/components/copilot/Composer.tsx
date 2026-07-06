import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import type { Brief } from "../../lib/types";
import { ResearchDropdown } from "./ResearchDropdown";

export function Composer({
  disabled,
  researches,
  researchesLoading,
  selectedIds,
  onToggleResearch,
  onSend,
}: {
  disabled: boolean;
  researches: Brief[];
  researchesLoading: boolean;
  selectedIds: string[];
  onToggleResearch: (id: string) => void;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const canSend = text.trim().length > 0 && !disabled;

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!canSend) return;
    onSend(text);
    setText("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="shrink-0 px-6 pb-6 pt-2">
      <form
        onSubmit={submit}
        className="mx-auto max-w-2xl rounded-2xl bg-bg-elev/70 px-3 py-2 transition-shadow focus-within:ring-1 focus-within:ring-accent/40"
      >
        <div className="flex items-center gap-2 pb-1.5">
          <ResearchDropdown
            researches={researches}
            loading={researchesLoading}
            selectedIds={selectedIds}
            onToggle={onToggleResearch}
          />
        </div>
        <div className="flex items-end gap-2">
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Ask across your selected researches, or ask to update one"
            className="block max-h-[200px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[0.9375rem] leading-relaxed text-ink placeholder:text-ink-faint/60 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send"
            className="mb-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink text-bg transition-opacity disabled:opacity-30"
          >
            <SendIcon />
          </button>
        </div>
      </form>
      <p className="mx-auto mt-2 max-w-2xl px-2 font-mono text-[0.5625rem] uppercase tracking-eyebrow text-ink-faint/70">
        <span className="text-ink-faint/50">Enter to send, Shift + Enter for a new line</span>
      </p>
    </div>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}
