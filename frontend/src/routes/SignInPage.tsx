import { SignIn } from "@clerk/clerk-react";
import { Link } from "react-router-dom";

import { ThemeToggle } from "../components/ui/ThemeToggle";
import { Wordmark } from "../components/ui/Wordmark";

export default function SignInPage() {
  return (
    <div className="min-h-screen grid md:grid-cols-2">
      {/* Left — editorial pitch */}
      <aside className="hidden md:flex flex-col justify-between border-r border-rule/8 px-10 py-10 bg-bg-elev/40">
        <Wordmark />

        <div className="space-y-6 stagger">
          <p className="eyebrow">Returning</p>
          <h1
            className="font-display text-4xl text-ink leading-tight"
            style={{ fontVariationSettings: '"opsz" 144, "SOFT" 60' }}
          >
            Welcome back.{" "}
            <em
              className="italic text-accent"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
            >
              Whose meeting is next?
            </em>
          </h1>
          <p className="text-ink-soft leading-relaxed max-w-prose">
            Your archive is waiting on the other side. Sign in and pick up where
            you left off.
          </p>
        </div>

        <p className="font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-faint">
          Set in Fraunces &amp; Geist
        </p>
      </aside>

      {/* Right — Clerk form */}
      <section className="flex flex-col">
        <header className="flex items-center justify-between px-6 md:px-10 h-14 border-b border-rule/8">
          <Link
            to="/"
            className="font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-faint hover:text-ink transition-colors"
          >
            ← Back home
          </Link>
          <ThemeToggle />
        </header>

        <div className="flex-1 flex items-center justify-center px-6 py-10">
          <div className="w-full max-w-sm">
            <SignIn
              routing="path"
              path="/sign-in"
              signUpUrl="/sign-up"
              fallbackRedirectUrl="/app"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
