import { Link } from "react-router-dom";

export function Wordmark({ as = "link" }: { as?: "link" | "static" }) {
  const content = (
    <span className="inline-flex items-baseline gap-2 group">
      <span
        className="font-display text-[1.35rem] leading-none italic tracking-tight text-ink"
        style={{ fontVariationSettings: '"opsz" 144, "SOFT" 80, "WONK" 1' }}
      >
        Research
      </span>
      <span className="h-1 w-1 rounded-full bg-accent translate-y-[-3px] group-hover:bg-ink transition-colors" />
      <span className="font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-soft group-hover:text-ink transition-colors">
        Copilot
      </span>
    </span>
  );

  if (as === "static") return content;

  return (
    <Link to="/" className="inline-flex items-center" aria-label="Research Copilot — home">
      {content}
    </Link>
  );
}
