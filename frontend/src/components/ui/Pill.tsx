import type { ReactNode } from "react";
import type { BriefStatus } from "../../lib/types";

export type Tone = "good" | "bad" | "neutral" | "warn" | "info";

const dotClass: Record<Tone, string> = {
  good: "bg-good",
  bad: "bg-bad",
  neutral: "bg-ink-faint",
  warn: "bg-warn",
  info: "bg-info",
};

/**
 * Refined inline status — small dot + lowercase label.
 * No pill background; treats status as a typographic accent, not a badge.
 */
export function Status({
  tone,
  children,
  pulse,
}: {
  tone: Tone;
  children: ReactNode;
  pulse?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.6875rem] font-mono uppercase tracking-wider text-ink-soft">
      <span
        className={`h-[5px] w-[5px] rounded-full ${dotClass[tone]} ${pulse ? "animate-pulse-dot" : ""}`}
      />
      {children}
    </span>
  );
}

export function statusTone(status: BriefStatus): Tone {
  switch (status) {
    case "pending":
      return "neutral";
    case "running":
      return "info";
    case "awaiting_clarification":
    case "awaiting_plan_approval":
      return "warn";
    case "completed":
      return "good";
    case "failed":
      return "bad";
  }
}

export function statusLabel(status: BriefStatus): string {
  switch (status) {
    case "awaiting_clarification":
      return "awaiting clarification";
    case "awaiting_plan_approval":
      return "awaiting plan approval";
    default:
      return status;
  }
}

// Backwards-compat export (legacy name)
export const Pill = Status;
