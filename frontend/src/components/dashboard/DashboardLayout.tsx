import { UserButton } from "@clerk/clerk-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useApi } from "../../lib/api";
import { ThemeToggle } from "../ui/ThemeToggle";
import { Wordmark } from "../ui/Wordmark";

export function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[16rem_1fr]">
      <Sidebar />
      <main className="flex flex-col min-h-screen md:min-h-0">
        <MobileBar />
        <div className="flex-1">{children}</div>
      </main>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="hidden md:flex md:flex-col md:sticky md:top-0 md:h-screen border-r border-rule/8 bg-bg-elev/40 px-5 py-5">
      <div className="px-1">
        <Wordmark />
      </div>

      <nav className="mt-10 flex flex-col gap-0.5">
        <SideLink to="/app" end label="Overview" hint="Home" />
        <SideLink to="/app#new" label="New brief" hint="Compose" />
        <SideLink to="/app#archive" label="Archive" hint="History" />
      </nav>

      <div className="mt-10 px-1 pt-6 border-t border-rule/10">
        <p className="eyebrow">Soon</p>
        <ul className="mt-3 space-y-2 text-xs text-ink-faint">
          <li className="flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-ink-faint/50" />
            Saved searches
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-ink-faint/50" />
            CRM sync
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-ink-faint/50" />
            Team archives
          </li>
        </ul>
      </div>

      <div className="mt-auto pt-6 border-t border-rule/10 flex items-center justify-between">
        <UserChip />
        <ThemeToggle />
      </div>
    </aside>
  );
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

function SideLink({
  to,
  label,
  hint,
  end,
}: {
  to: string;
  label: string;
  hint: string;
  end?: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();

  // Hash links don't behave with NavLink's "active" state; handle manually.
  const hashTarget = to.includes("#") ? to.split("#")[1] : null;
  const isHashActive = hashTarget && location.hash === `#${hashTarget}`;

  if (hashTarget) {
    return (
      <button
        onClick={() => {
          navigate(to);
          // Smooth scroll the section into view after navigation settles.
          requestAnimationFrame(() => {
            document
              .getElementById(hashTarget)
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        }}
        className={`group flex items-baseline justify-between px-2 py-1.5 rounded-sm text-left transition-colors
          ${isHashActive ? "bg-bg/60 text-ink" : "text-ink-soft hover:text-ink hover:bg-bg/40"}`}
      >
        <span className="text-sm">{label}</span>
        <span className="font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint/70">
          {hint}
        </span>
      </button>
    );
  }

  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `group flex items-baseline justify-between px-2 py-1.5 rounded-sm transition-colors
        ${isActive ? "bg-bg/60 text-ink" : "text-ink-soft hover:text-ink hover:bg-bg/40"}`
      }
    >
      <span className="text-sm">{label}</span>
      <span className="font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint/70">
        {hint}
      </span>
    </NavLink>
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
