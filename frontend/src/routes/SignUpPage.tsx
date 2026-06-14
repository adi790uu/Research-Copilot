import { SignUp } from "@clerk/clerk-react";
import { Link } from "react-router-dom";

import { ThemeToggle } from "../components/ui/ThemeToggle";
import { Wordmark } from "../components/ui/Wordmark";

export default function SignUpPage() {
  return (
    <div className="min-h-screen grid md:grid-cols-2">
      {/* Left — editorial pitch */}
      <aside className="hidden md:flex flex-col justify-between border-r border-rule/8 px-10 py-10 bg-bg-elev/40">
        <Wordmark />

        <div className="space-y-6 stagger">
          <p className="eyebrow">First brief</p>
          <h1
            className="font-display text-4xl text-ink leading-tight"
            style={{ fontVariationSettings: '"opsz" 144, "SOFT" 60' }}
          >
            Start the brief that{" "}
            <em
              className="italic text-accent"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
            >
              decides the deal.
            </em>
          </h1>
          <p className="text-ink-soft leading-relaxed max-w-prose">
            Free during private beta. No card required. Your first briefing is
            usually drafted in under a minute.
          </p>

          <ul className="mt-6 space-y-3 text-sm text-ink-soft border-t border-rule/10 pt-6">
            <li className="flex gap-3">
              <span className="font-display italic text-accent shrink-0"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}>
                01
              </span>
              <span>Tell us the company, the URL, the objective.</span>
            </li>
            <li className="flex gap-3">
              <span className="font-display italic text-accent shrink-0"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}>
                02
              </span>
              <span>Watch the workflow execute live.</span>
            </li>
            <li className="flex gap-3">
              <span className="font-display italic text-accent shrink-0"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}>
                03
              </span>
              <span>Read the brief. Ask follow-up questions. Walk in ready.</span>
            </li>
          </ul>
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
            <SignUp
              routing="path"
              path="/sign-up"
              signInUrl="/sign-in"
              fallbackRedirectUrl="/app"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
