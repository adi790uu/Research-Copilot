import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";

import { useAuth } from "../../lib/auth";
import type { Brief } from "../../lib/types";

import { ThemeToggle } from "../ui/ThemeToggle";
import { Wordmark } from "../ui/Wordmark";
import { NewResearchModal } from "./NewResearchModal";
import { NewResearchContext } from "./newResearchContext";

const STORAGE_KEY = "rc:sidebar-collapsed";

function readCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

export function DashboardLayout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const [newResearchOpen, setNewResearchOpen] = useState(false);
  const [resumeBrief, setResumeBrief] = useState<Brief | null>(null);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  const openNewResearch = () => {
    setResumeBrief(null);
    setNewResearchOpen(true);
  };

  const newResearch = useMemo(
    () => ({
      openNew: () => {
        setResumeBrief(null);
        setNewResearchOpen(true);
      },
      openResume: (brief: Brief) => {
        setResumeBrief(brief);
        setNewResearchOpen(true);
      },
    }),
    [],
  );

  return (
    <NewResearchContext.Provider value={newResearch}>
      {/* h-dvh (dynamic viewport) — works on mobile Safari where 100vh
          overflows behind the address bar. grid-rows-1 hard-binds the row
          height so child h-full propagates predictably. */}
      <div
        className={`h-dvh grid grid-rows-1 md:grid-rows-1 ${
        collapsed
          ? "md:grid-cols-[3.25rem_1fr]"
          : "md:grid-cols-[17rem_1fr]"
      }`}
    >
      {collapsed ? (
        <CollapsedRail onExpand={() => setCollapsed(false)} onNewResearch={openNewResearch} />
      ) : (
        <Sidebar onCollapse={() => setCollapsed(true)} onNewResearch={openNewResearch} />
      )}
      <main className="flex flex-col h-full min-h-0 min-w-0 overflow-hidden">
        <MobileBar />
        <div className="flex-1 min-h-0 min-w-0">{children}</div>
      </main>
        <NewResearchModal
          open={newResearchOpen}
          onClose={() => {
            setNewResearchOpen(false);
            setResumeBrief(null);
          }}
          resumeBrief={resumeBrief}
        />
      </div>
    </NewResearchContext.Provider>
  );
}

function CollapsedRail({
  onExpand,
  onNewResearch,
}: {
  onExpand: () => void;
  onNewResearch: () => void;
}) {
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
      <button
        type="button"
        onClick={onNewResearch}
        aria-label="New research"
        title="New research"
        className="grid h-8 w-8 place-items-center rounded-md text-ink-faint transition-colors hover:bg-bg/60 hover:text-accent"
      >
        <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <nav className="mt-2 flex flex-col items-center gap-1">
        <RailLink to="/app" end label="Copilot" icon={<CopilotIcon />} />
        <RailLink to="/app/researches" label="Researches" icon={<ResearchesIcon />} />
        <RailLink to="/app/chats" label="Chats" icon={<ChatsIcon />} />
      </nav>

      <div className="mt-auto">
        <ThemeToggle />
      </div>
    </aside>
  );
}

function RailLink({
  to,
  label,
  end,
  icon,
}: {
  to: string;
  label: string;
  end?: boolean;
  icon: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      aria-label={label}
      className={({ isActive }) =>
        `grid h-8 w-8 place-items-center rounded-md transition-colors
        ${isActive ? "bg-ink/[0.06] text-ink" : "text-ink-faint hover:bg-bg/60 hover:text-ink"}`
      }
    >
      {icon}
    </NavLink>
  );
}

function Sidebar({
  onCollapse,
  onNewResearch,
}: {
  onCollapse: () => void;
  onNewResearch: () => void;
}) {
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
        <NewResearchButton onClick={onNewResearch} />
      </div>

      <nav className="mt-4 px-3 space-y-0.5">
        <SidebarLink to="/app" end label="Copilot" icon={<CopilotIcon />} />
        <SidebarLink to="/app/researches" label="Researches" icon={<ResearchesIcon />} />
        <SidebarLink to="/app/chats" label="Chats" icon={<ChatsIcon />} />
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

function NewResearchButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
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

function SidebarLink({
  to,
  label,
  end,
  icon,
}: {
  to: string;
  label: string;
  end?: boolean;
  icon: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors
        ${isActive ? "bg-ink/[0.06] text-ink" : "text-ink-soft hover:bg-ink/[0.04] hover:text-ink"}`
      }
    >
      <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center">
        {icon}
      </span>
      <span>{label}</span>
    </NavLink>
  );
}

function CopilotIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.5l1.6 4.3a3 3 0 0 0 1.8 1.8L19.7 11l-4.3 1.6a3 3 0 0 0-1.8 1.8L12 18.7l-1.6-4.3a3 3 0 0 0-1.8-1.8L4.3 11l4.3-1.6a3 3 0 0 0 1.8-1.8z" />
      <path d="M18.5 16.5l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z" />
    </svg>
  );
}

function ResearchesIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M15 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}

function ChatsIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12c0 4.4-4 8-9 8a9.9 9.9 0 0 1-4-.8L3 21l1.3-3.9A7.6 7.6 0 0 1 3 12c0-4.4 4-8 9-8s9 3.6 9 8z" />
      <path d="M8.5 12h.01M12 12h.01M15.5 12h.01" />
    </svg>
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

