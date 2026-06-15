import { useEffect, useRef, useState } from "react";

import type { Source } from "../../lib/types";

/**
 * Footnote-style citation chip. Hover or focus reveals a preview card with
 * the source title, host, and snippet. Click navigates to the source.
 *
 * Positioning is plain absolute over the chip — no portal needed at this
 * density of citations, and it keeps the component self-contained.
 */
export function SourceCitation({
  source,
  index,
}: {
  source: Source;
  index?: number;
}) {
  const [open, setOpen] = useState(false);
  const [placeAbove, setPlaceAbove] = useState(true);
  const chipRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open || !chipRef.current) return;
    const rect = chipRef.current.getBoundingClientRect();
    // Flip below if there isn't ~200px of headroom above.
    setPlaceAbove(rect.top > 220);
  }, [open]);

  const label = index != null ? String(index).padStart(2, "0") : source.id.replace(/^src_/, "");

  return (
    <span
      ref={chipRef}
      className="relative inline-block align-baseline"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <a
        href={source.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center font-mono text-[0.625rem] tracking-wider text-ink-faint hover:text-ink transition-colors px-1 py-0 align-baseline"
        aria-describedby={`src-preview-${source.id}`}
      >
        <span aria-hidden className="text-ink-faint/60">[</span>
        <span className="tabular-nums">{label}</span>
        <span aria-hidden className="text-ink-faint/60">]</span>
      </a>

      {open && (
        <span
          id={`src-preview-${source.id}`}
          role="tooltip"
          className={[
            "absolute z-30 left-0 w-80 max-w-[20rem] not-italic",
            "border border-rule/15 bg-surface shadow-lg",
            "px-4 py-3 rounded-sm",
            placeAbove ? "bottom-full mb-2" : "top-full mt-2",
          ].join(" ")}
        >
          <span className="block font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint/80 mb-1">
            {prettyHost(source.url)}
          </span>
          <span className="block text-sm text-ink leading-snug">
            {source.title || source.url}
          </span>
          {source.snippet && (
            <span className="mt-2 block text-xs text-ink-soft leading-relaxed line-clamp-4">
              {source.snippet}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

function prettyHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
