import { UserButton } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";

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
    <div
      className={`min-h-screen md:grid ${
        collapsed ? "md:grid-cols-[3.25rem_1fr]" : "md:grid-cols-[17rem_1fr]"
      }`}
    >
      {collapsed ? (
        <CollapsedRail onExpand={() => setCollapsed(false)} />
      ) : (
        <Sidebar onCollapse={() => setCollapsed(true)} />
      )}
      <main className="flex flex-col min-h-screen md:min-h-0 min-w-0">
        <MobileBar />
        <div className="flex-1 min-w-0">{children}</div>
      </main>
    </div>
  );
}

function CollapsedRail({ onExpand }: { onExpand: () => void }) {
  return (
    <aside className="hidden md:flex md:flex-col md:items-center md:sticky md:top-0 md:h-screen bg-bg-elev/50 py-4 gap-4">
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
    <aside className="hidden md:flex md:flex-col md:sticky md:top-0 md:h-screen bg-bg-elev/50">
      <div className="px-5 pt-5 flex items-start justify-between gap-3">
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

      <div className="px-5 mt-7">
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

      <div className="mt-auto px-5 py-4 border-t border-rule/10 flex items-center justify-between">
        <UserChip />
        <ThemeToggle />
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
      className="group w-full inline-flex items-center justify-between gap-2 px-3 py-2.5 rounded-sm border border-rule/12 hover:border-ink/40 bg-bg/40 hover:bg-bg/70 transition-colors text-left"
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className="font-display italic text-accent leading-none"
          style={{ fontSize: "1.05rem", fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
        >
          +
        </span>
        <span className="text-sm text-ink">New brief</span>
      </span>
      <span className="font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint group-hover:text-ink-soft">
        Compose
      </span>
    </button>
  );
}

function ResearchList() {
  const api = useApi();
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: api.sessions.list,
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

  if (!sessions.data || sessions.data.length === 0) {
    return (
      <p className="px-2 pt-2 text-xs text-ink-faint italic leading-relaxed">
        No briefs yet. Compose your first one above.
      </p>
    );
  }

  return (
    <ul className="space-y-px">
      {sessions.data.map((s, idx) => (
        <ResearchRow key={s.id} session={s} ordinal={sessions.data!.length - idx} />
      ))}
    </ul>
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
      <div className="flex items-center gap-3">
        <ThemeToggle />
        <UserButton afterSignOutUrl="/" />
      </div>
    </div>
  );
}

function UserChip() {
  return (
    <div className="flex items-center gap-2">
      <UserButton
        afterSignOutUrl="/"
        appearance={{ elements: { userButtonAvatarBox: { height: 28, width: 28 } } }}
      />
      <Health />
    </div>
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

function Health() {
  const api = useApi();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 15_000,
  });

  let dotClass = "bg-ink-faint animate-pulse-dot";
  if (health.error) dotClass = "bg-bad";
  else if (health.data) dotClass = "bg-good";

  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint"
      title={health.data ? `Backend v${health.data.version}` : "Backend offline"}
    >
      <span className={`h-[5px] w-[5px] rounded-full ${dotClass}`} />
      {health.data ? "online" : health.error ? "offline" : "…"}
    </span>
  );
}
