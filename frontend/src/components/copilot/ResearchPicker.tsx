import { useMemo, useState } from "react";

import type { Brief } from "../../lib/types";

export function ResearchPicker({
  researches,
  loading,
  selectedIds,
  onToggle,
}: {
  researches: Brief[];
  loading: boolean;
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return researches;
    return researches.filter(
      (b) =>
        b.company_name.toLowerCase().includes(q) ||
        b.objective.toLowerCase().includes(q),
    );
  }, [researches, query]);

  const selected = new Set(selectedIds);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <p className="eyebrow">Context</p>
        {selectedIds.length > 0 ? (
          <span className="font-mono text-[0.5625rem] uppercase tracking-wider text-accent">
            {selectedIds.length} selected
          </span>
        ) : null}
      </div>

      <div className="px-3 pb-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter researches"
          className="w-full rounded-lg bg-ink/[0.04] px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {loading ? (
          <SkeletonRows />
        ) : filtered.length === 0 ? (
          <p className="px-3 py-2 text-xs text-ink-faint/80 leading-relaxed">
            {researches.length === 0
              ? "No researches yet."
              : "Nothing matches that filter."}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((b) => {
              const isSel = selected.has(b.id);
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => onToggle(b.id)}
                    className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${
                      isSel ? "bg-accent/[0.08]" : "hover:bg-ink/[0.04]"
                    }`}
                  >
                    <Checkbox checked={isSel} />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-sm ${
                          isSel ? "text-ink" : "text-ink-soft"
                        }`}
                      >
                        {b.company_name}
                      </span>
                      <span className="block truncate text-xs text-ink-faint/80">
                        {b.objective}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border transition-colors ${
        checked ? "border-accent bg-accent text-bg" : "border-rule/25 text-transparent"
      }`}
    >
      <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  );
}

function SkeletonRows() {
  return (
    <ul className="space-y-1 px-1 animate-pulse" aria-busy>
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="rounded-lg px-2 py-2">
          <div className="h-3.5 w-32 rounded-sm bg-ink/10" />
          <div className="mt-1.5 h-2.5 w-40 rounded-sm bg-ink/5" />
        </li>
      ))}
    </ul>
  );
}
