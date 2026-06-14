import type { ReactNode } from "react";

interface Props {
  number: string;
  label: string;
  meta?: ReactNode;
}

export function SectionHeading({ number, label, meta }: Props) {
  return (
    <div className="flex items-end justify-between gap-6 pb-3 rule-b">
      <div className="flex items-baseline gap-3">
        <span
          className="font-display italic text-2xl text-accent"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
          aria-hidden
        >
          {number}
        </span>
        <span className="eyebrow">{label}</span>
      </div>
      {meta && <div className="text-ink-faint font-mono text-xs">{meta}</div>}
    </div>
  );
}
