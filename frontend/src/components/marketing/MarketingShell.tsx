import { Link } from "react-router-dom";
import { SignedIn, SignedOut } from "../../lib/auth";
import type { ReactNode } from "react";

import { Wordmark } from "../ui/Wordmark";
import { ThemeToggle } from "../ui/ThemeToggle";

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-20 backdrop-blur-md bg-bg/70 hairline-b">
        <div className="mx-auto max-w-6xl px-6 md:px-10 h-14 flex items-center justify-between">
          <Wordmark />
          <nav className="flex items-center gap-5">
            <a
              href="#how"
              className="hidden sm:inline font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-faint hover:text-ink transition-colors"
            >
              How it works
            </a>
            <a
              href="#users"
              className="hidden sm:inline font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-faint hover:text-ink transition-colors"
            >
              For sellers
            </a>
            <ThemeToggle />
            <SignedOut>
              <Link
                to="/sign-in"
                className="font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-soft hover:text-ink transition-colors"
              >
                Sign in
              </Link>
              <Link
                to="/sign-up"
                className="btn-primary !py-1.5 !text-xs"
              >
                Start free<span className="arrow">→</span>
              </Link>
            </SignedOut>
            <SignedIn>
              <Link
                to="/app"
                className="btn-primary !py-1.5 !text-xs"
              >
                Open app<span className="arrow">→</span>
              </Link>
            </SignedIn>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-auto hairline-t">
        <div className="mx-auto max-w-6xl px-6 md:px-10 py-10 grid gap-6 sm:grid-cols-3">
          <div>
            <Wordmark as="static" />
            <p className="mt-3 text-xs text-ink-faint max-w-xs leading-relaxed">
              A research copilot for sellers, founders, and anyone who walks
              into rooms with stakes attached.
            </p>
          </div>
          <div className="space-y-2">
            <p className="eyebrow">Product</p>
            <ul className="space-y-1.5 text-sm text-ink-soft">
              <li><a href="#how" className="hover:text-ink">How it works</a></li>
              <li><a href="#users" className="hover:text-ink">Who it's for</a></li>
              <li><Link to="/sign-up" className="hover:text-ink">Get started</Link></li>
            </ul>
          </div>
          <div className="space-y-2">
            <p className="eyebrow">Colophon</p>
            <p className="text-xs text-ink-faint font-mono uppercase tracking-wider">
              Set in Fraunces &amp; Geist · v0.1.0
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
