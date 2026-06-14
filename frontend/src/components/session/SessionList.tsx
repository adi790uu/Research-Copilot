import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { ApiError, useApi } from "../../lib/api";
import { formatRelative, shortId } from "../../lib/format";
import type { Session } from "../../lib/types";
import { Status, statusTone } from "../ui/Pill";

export function SessionList() {
  const api = useApi();
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: api.sessions.list,
  });

  if (sessions.isLoading) return <SkeletonList />;
  if (sessions.error)
    return <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />;
  if (!sessions.data || sessions.data.length === 0) return <EmptyState />;

  return (
    <ul className="rule-t">
      {sessions.data.map((s, idx) => (
        <SessionRow key={s.id} session={s} index={sessions.data!.length - idx} />
      ))}
    </ul>
  );
}

function SessionRow({ session, index }: { session: Session; index: number }) {
  return (
    <li className="rule-b">
      <Link
        to={`/app/sessions/${session.id}`}
        className="group grid grid-cols-[2.5rem_1fr_auto] items-baseline gap-x-5 py-5 transition-colors hover:bg-bg-elev/60 -mx-3 px-3 rounded-sm"
      >
        <span
          aria-hidden
          className="font-mono text-[0.6875rem] uppercase tracking-wider text-ink-faint/70 tabular-nums"
        >
          №{String(index).padStart(2, "0")}
        </span>

        <div className="min-w-0">
          <div className="flex items-baseline flex-wrap gap-x-3 gap-y-1">
            <h3 className="text-[1.05rem] font-medium text-ink leading-tight truncate max-w-full">
              {session.company_name}
            </h3>
            <Status
              tone={statusTone(session.status)}
              pulse={session.status === "running"}
            >
              {session.status}
            </Status>
          </div>
          <p className="mt-1 text-sm text-ink-soft line-clamp-1 max-w-prose">
            {session.objective}
          </p>
        </div>

        <div className="flex flex-col items-end shrink-0 text-right">
          <time
            className="font-mono text-xs text-ink-faint tabular-nums"
            dateTime={session.created_at}
          >
            {formatRelative(session.created_at)}
          </time>
          <span className="font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint/60 mt-1">
            {shortId(session.id, 4)}
          </span>
        </div>
      </Link>
    </li>
  );
}

function SkeletonList() {
  return (
    <ul className="rule-t" aria-busy>
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="rule-b py-5 grid grid-cols-[2.5rem_1fr_auto] gap-x-5 items-baseline"
        >
          <span className="font-mono text-[0.6875rem] text-ink-faint/40">№—</span>
          <div className="space-y-2">
            <div className="h-4 w-32 bg-ink/10 rounded-sm" />
            <div className="h-3 w-3/4 bg-ink/5 rounded-sm" />
          </div>
          <div className="space-y-1.5">
            <div className="h-3 w-16 bg-ink/10 rounded-sm" />
            <div className="h-2 w-10 bg-ink/5 rounded-sm ml-auto" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyState() {
  return (
    <div className="py-14 text-center">
      <p
        className="font-display italic text-2xl text-ink-soft leading-tight"
        style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
      >
        Your archive is empty.
      </p>
      <p className="text-sm text-ink-faint mt-3 max-w-xs mx-auto leading-relaxed">
        The brief you write today might decide the meeting you walk into tomorrow.
      </p>
    </div>
  );
}

function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const message =
    error instanceof ApiError ? error.message : "Failed to load sessions";
  return (
    <div className="py-8 border-l-2 border-bad/60 pl-4">
      <p className="font-mono text-xs uppercase tracking-wider text-bad mb-2">
        Could not reach archive
      </p>
      <p className="text-sm text-ink-soft mb-3">{message}</p>
      <button onClick={onRetry} className="btn-ghost">
        Try again →
      </button>
    </div>
  );
}
