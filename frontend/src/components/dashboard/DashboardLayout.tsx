import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";

import { useAuth } from "../../lib/auth";

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
        aria-label="Pith — home"
        className="inline-flex items-center justify-center w-7 h-7 rounded-sm hover:bg-bg/60 transition-colors"
      >
        <span
          className="font-display italic text-xl text-ink leading-none"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 80, "WONK" 1' }}
        >
          P
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
        <NewResearchButton />
      </div>

      <nav className="mt-4 px-3 space-y-0.5">
        <SidebarLink to="/app" end label="Copilot" />
        <SidebarLink to="/app/researches" label="Researches" />
      </nav>

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

function NewResearchButton() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate("/app")}
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
      <span className="text-sm">New research</span>
    </button>
  );
}

function SidebarLink({ to, label, end }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `block rounded-lg px-2 py-2 text-sm transition-colors
        ${isActive ? "bg-ink/[0.06] text-ink" : "text-ink-soft hover:bg-ink/[0.04] hover:text-ink"}`
      }
    >
      {label}
    </NavLink>
  );
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

