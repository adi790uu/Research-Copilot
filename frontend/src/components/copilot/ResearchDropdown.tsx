import { useEffect, useMemo, useRef, useState } from "react";

import type { Brief } from "../../lib/types";

export function ResearchDropdown({
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

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
  const label =
    selectedIds.length === 0
      ? "Select researches"
      : selectedIds.length === 1
        ? researches.find((b) => b.id === selectedIds[0])?.company_name ?? "1 selected"
        : `${selectedIds.length} researches`;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex h-8 max-w-[11rem] items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors ${
          selectedIds.length > 0
            ? "bg-accent/[0.1] text-accent"
            : "bg-ink/[0.05] text-ink-soft hover:bg-ink/[0.08]"
        }`}
      >
        <FolderIcon />
        <span className="truncate">{label}</span>
        <ChevronIcon open={open} />
      </button>

      {open ? (
        <div className="absolute bottom-full left-0 z-20 mb-2 flex max-h-80 w-72 flex-col overflow-hidden rounded-xl bg-bg-elev shadow-xl shadow-black/30">
          <div className="px-3 pb-2 pt-3">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter researches"
              className="w-full rounded-lg bg-ink/[0.04] px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
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
      ) : null}
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

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={11}
      height={11}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
