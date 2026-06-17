import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";

import { useAuth } from "../../lib/auth";

import { useApi } from "../../lib/api";
import type { Session } from "../../lib/types";
import { ThemeToggle } from "../ui/ThemeToggle";
import { Wordmark } from "../ui/Wordmark";

const STORAGE_KEY = "rc:sidebar-collapsed";

function readCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

export function DashboardLayout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  return (
    // h-dvh (dynamic viewport) — works on mobile Safari where 100vh
    // overflows behind the address bar. grid-rows-1 hard-binds the row
    // height so child h-full propagates predictably.
    <div
      className={`h-dvh grid grid-rows-1 md:grid-rows-1 ${
        collapsed
          ? "md:grid-cols-[3.25rem_1fr]"
          : "md:grid-cols-[17rem_1fr]"
      }`}
    >
      {collapsed ? (
        <CollapsedRail onExpand={() => setCollapsed(false)} />
      ) : (
        <Sidebar onCollapse={() => setCollapsed(true)} />
      )}
      <main className="flex flex-col h-full min-h-0 min-w-0 overflow-hidden">
        <MobileBar />
        <div className="flex-1 min-h-0 min-w-0">{children}</div>
      </main>
    </div>
  );
}

function CollapsedRail({ onExpand }: { onExpand: () => void }) {
  return (
    <aside className="hidden md:flex md:flex-col md:items-center md:h-full md:overflow-hidden bg-bg-elev/50 py-4 gap-4">
      <Link
        to="/"
        aria-label="Research Copilot — home"
        className="inline-flex items-center justify-center w-7 h-7 rounded-sm hover:bg-bg/60 transition-colors"
      >
        <span
          className="font-display italic text-xl text-ink leading-none"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 80, "WONK" 1' }}
        >
          R
        </span>
      </Link>
      <button
        type="button"
        onClick={onExpand}
        aria-label="Expand sidebar"
        className="inline-flex items-center justify-center w-7 h-7 rounded-sm text-ink-faint hover:text-ink hover:bg-bg/60 transition-colors"
      >
        <Chevron dir="right" />
      </button>
      <div className="mt-auto">
        <ThemeToggle />
      </div>
    </aside>
  );
}

function Sidebar({ onCollapse }: { onCollapse: () => void }) {
  return (
    <aside className="hidden md:flex md:flex-col md:h-full md:overflow-hidden bg-bg-elev/50">
      <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-3">
        <Wordmark />
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          className="text-ink-faint hover:text-ink transition-colors p-1 -mr-1 -mt-0.5"
        >
          <Chevron dir="left" />
        </button>
      </div>

      <div className="px-3">
        <NewBriefButton />
      </div>

      <div className="px-5 mt-6 flex items-center justify-between">
        <p className="eyebrow">Researches</p>
        <NavLink
          to="/app"
          end
          className={({ isActive }) =>
            `font-mono text-[0.625rem] uppercase tracking-wider transition-colors
            ${isActive ? "text-ink" : "text-ink-faint hover:text-ink"}`
          }
        >
          Overview
        </NavLink>
      </div>

      <div className="mt-2 flex-1 overflow-y-auto px-3 pb-2">
        <ResearchList />
      </div>

      <div className="mt-auto px-5 py-4 flex items-center justify-between">
        <UserChip />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <SignOutButton />
        </div>
      </div>
    </aside>
  );
}

function NewBriefButton() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate("/app#new")}
      className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-ink-soft transition-colors hover:bg-ink/[0.04] hover:text-ink"
    >
      <span
        aria-hidden
        className="grid h-5 w-5 shrink-0 place-items-center text-ink-faint group-hover:text-accent"
      >
        <svg
          viewBox="0 0 24 24"
          width={14}
          height={14}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      </span>
      <span className="text-sm">New brief</span>
    </button>
  );
}

const PAGE_SIZE = 10;

function ResearchList() {
  const api = useApi();
  const [page, setPage] = useState(0); // zero-indexed
  const sessions = useQuery({
    queryKey: ["sessions", { limit: PAGE_SIZE, offset: page * PAGE_SIZE }],
    queryFn: () =>
      api.sessions.list({ limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    placeholderData: (prev) => prev, // smooth page transitions
  });

  if (sessions.isLoading) {
    return (
      <ul className="space-y-2 px-2 pt-2 animate-pulse" aria-busy>
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="space-y-1">
            <div className="h-3 w-4/5 bg-ink/8 rounded-sm" />
            <div className="h-2 w-1/2 bg-ink/5 rounded-sm" />
          </li>
        ))}
      </ul>
    );
  }

  if (sessions.error) {
    return (
      <p className="px-2 pt-2 font-mono text-[0.625rem] uppercase tracking-wider text-bad">
        Archive offline
      </p>
    );
  }

  const items = sessions.data?.items ?? [];
  const total = sessions.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (total === 0) {
    return (
      <p className="px-2 pt-2 text-xs text-ink-faint italic leading-relaxed">
        No briefs yet. Compose your first one above.
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ul className="space-y-px">
        {items.map((s, idx) => {
          // Global ordinal: oldest=1, most recent=total. Page is sorted
          // desc by updated_at, so the row's display number is
          // `total - (offset + idx)`.
          const ordinal = total - (page * PAGE_SIZE + idx);
          return <ResearchRow key={s.id} session={s} ordinal={ordinal} />;
        })}
      </ul>

      {totalPages > 1 ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPage={setPage}
          stale={sessions.isFetching}
        />
      ) : null}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onPage,
  stale,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
  stale: boolean;
}) {
  const atFirst = page === 0;
  const atLast = page >= totalPages - 1;
  return (
    <div className="mt-3 flex items-center justify-between px-2 pb-2">
      <PaginationChevron
        dir="prev"
        disabled={atFirst}
        onClick={() => onPage(Math.max(0, page - 1))}
      />
      <span
        className={`font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint tabular-nums transition-opacity ${
          stale ? "opacity-50" : "opacity-100"
        }`}
        aria-live="polite"
      >
        {String(page + 1).padStart(2, "0")}
        <span className="mx-1 text-ink-faint/50">/</span>
        {String(totalPages).padStart(2, "0")}
      </span>
      <PaginationChevron
        dir="next"
        disabled={atLast}
        onClick={() => onPage(Math.min(totalPages - 1, page + 1))}
      />
    </div>
  );
}

function PaginationChevron({
  dir,
  disabled,
  onClick,
}: {
  dir: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "prev" ? "Previous page" : "Next page"}
      className="grid h-6 w-6 place-items-center rounded text-ink-faint transition-colors enabled:hover:bg-ink/[0.04] enabled:hover:text-ink disabled:opacity-30"
    >
      <svg
        viewBox="0 0 24 24"
        width={12}
        height={12}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transform: dir === "next" ? "scaleX(-1)" : undefined }}
        aria-hidden="true"
      >
        <path d="m15 18-6-6 6-6" />
      </svg>
    </button>
  );
}

function ResearchRow({ session, ordinal }: { session: Session; ordinal: number }) {
  const dot = statusDotClass(session.status);
  const pulsing = session.status === "running" ? "animate-pulse-dot" : "";

  return (
    <li>
      <NavLink
        to={`/app/sessions/${session.id}`}
        className={({ isActive }) =>
          `group flex items-baseline gap-2.5 px-2 py-2 rounded-sm transition-colors
          ${isActive
            ? "bg-bg/70 text-ink"
            : "text-ink-soft hover:text-ink hover:bg-bg/40"}`
        }
      >
        <span
          aria-hidden
          className={`mt-1.5 h-[5px] w-[5px] rounded-full shrink-0 ${dot} ${pulsing}`}
        />
        <span className="flex-1 min-w-0">
          <span className="block text-sm truncate leading-tight">
            {session.company_name}
          </span>
          <span className="block mt-0.5 font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint/80 truncate">
            №{String(ordinal).padStart(2, "0")} · {relativeShort(session.updated_at)}
          </span>
        </span>
      </NavLink>
    </li>
  );
}

function statusDotClass(s: Session["status"]): string {
  switch (s) {
    case "running":
      return "bg-info";
    case "completed":
      return "bg-good";
    case "failed":
      return "bg-bad";
    default:
      return "bg-ink-faint/60";
  }
}

function relativeShort(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function MobileBar() {
  return (
    <div className="md:hidden sticky top-0 z-20 backdrop-blur bg-bg/80 border-b border-rule/8 px-5 h-14 flex items-center justify-between">
      <Wordmark />
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <UserMenu />
        <SignOutButton />
      </div>
    </div>
  );
}

function UserChip() {
  return <UserMenu compact />;
}

function UserMenu({ compact = false }: { compact?: boolean }) {
  const { session } = useAuth();
  if (!session) return null;
  const initials = session.user.email.slice(0, 2).toUpperCase();
  return (
    <div
      className="flex items-center justify-center rounded-full border border-rule/15 bg-bg-elev/60 font-mono text-[0.6875rem] text-ink-soft"
      style={{ width: compact ? 28 : 32, height: compact ? 28 : 32 }}
      title={session.user.email}
    >
      {initials}
    </div>
  );
}

function SignOutButton() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  if (!session) return null;
  return (
    <button
      type="button"
      onClick={() => {
        signOut();
        navigate("/", { replace: true });
      }}
      title="Sign out"
      aria-label="Sign out"
      className="group grid h-8 w-8 place-items-center rounded-md text-ink-faint transition-colors hover:bg-bad/10 hover:text-bad focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bad/40"
    >
      <SignOutIcon />
    </button>
  );
}

function SignOutIcon() {
  // Door frame on the left, arrow stepping out to the right — the canonical
  // "log out" gesture. Stroked, matches the rest of the sidebar's line icons.
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  // Editorial double-chevron — feels like a margin marker.
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ transform: dir === "right" ? "scaleX(-1)" : undefined }}
    >
      <path d="M8.5 3.5L5 7l3.5 3.5" />
      <path d="M11.5 3.5L8 7l3.5 3.5" opacity="0.45" />
    </svg>
  );
}

