import { Link } from "react-router-dom";

export function Wordmark({ as = "link" }: { as?: "link" | "static" }) {
  const content = (
    <span className="inline-flex items-baseline group">
      <span
        className="font-display text-[1.35rem] leading-none italic tracking-tight text-ink"
        style={{ fontVariationSettings: '"opsz" 144, "SOFT" 80, "WONK" 1' }}
      >
        Pith
      </span>
      <span className="ml-0.5 h-1 w-1 rounded-full bg-accent group-hover:bg-ink transition-colors" />
    </span>
  );

  if (as === "static") return content;

  return (
    <Link to="/" className="inline-flex items-center" aria-label="Pith — home">
      {content}
    </Link>
  );
}
