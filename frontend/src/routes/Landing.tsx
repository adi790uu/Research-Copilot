import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { SignedIn, SignedOut } from "../lib/auth";

import { MarketingShell } from "../components/marketing/MarketingShell";

export default function Landing() {
  return (
    <MarketingShell>
      <Hero />
      <Divider />
      <Specimen />
      <Divider />
      <HowItWorks />
      <Divider />
      <ForWhom />
      <Divider />
      <Closer />
    </MarketingShell>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="relative">
      <div className="mx-auto max-w-5xl px-6 md:px-10 pt-20 md:pt-28 pb-16 stagger">
        <p className="eyebrow">A research copilot for sellers · Vol. 01</p>

        <h1
          className="mt-8 font-display text-ink leading-[0.98] tracking-[-0.025em]"
          style={{
            fontVariationSettings: '"opsz" 144, "SOFT" 60',
            fontSize: "clamp(3rem, 8vw, 6rem)",
          }}
        >
          Walk into every meeting{" "}
          <em
            className="italic text-accent"
            style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
          >
            already ahead.
          </em>
        </h1>

        <p className="mt-8 text-lg md:text-xl text-ink-soft leading-relaxed max-w-prose">
          Name the company and why the meeting matters. Pith researches the
          business, verifies your contact, and writes the pitch to bring, all
          cited. Then it answers your follow-ups in a chat that knows the account
          cold.
        </p>

        <div className="mt-12 flex flex-wrap items-center gap-4">
          <SignedOut>
            <Link to="/sign-up" className="btn-primary">
              Brief your first meeting<span className="arrow">→</span>
            </Link>
            <Link
              to="/sign-in"
              className="font-mono text-xs uppercase tracking-eyebrow text-ink-soft hover:text-ink transition-colors px-2 py-2"
            >
              Already have an account
            </Link>
          </SignedOut>
          <SignedIn>
            <Link to="/app" className="btn-primary">
              Open your archive<span className="arrow">→</span>
            </Link>
          </SignedIn>
        </div>

        <p className="mt-10 text-xs font-mono uppercase tracking-eyebrow text-ink-faint">
          Free during private beta · No card required
        </p>
      </div>

      {/* Proof strip — three terse facts, set like a masthead dateline */}
      <div className="mx-auto max-w-6xl px-6 md:px-10">
        <div className="divider-x" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-0 py-8">
          {[
            ["Cited, not guessed", "every claim traces to a source"],
            ["The right person", "contact research, identity-checked"],
            ["Research to pitch", "tailored to what you sell"],
          ].map(([big, small]) => (
            <div key={big} className="sm:px-8 sm:first:pl-0">
              <p className="flex items-center gap-2.5">
                <span className="h-1 w-1 rounded-full bg-accent" />
                <span
                  className="font-display italic text-xl text-ink"
                  style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100' }}
                >
                  {big}
                </span>
              </p>
              <p className="mt-1.5 pl-[1.125rem] text-sm text-ink-faint">{small}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Specimen: what you actually get ────────────────────────────────────────

const DELIVERABLES: Array<[string, string]> = [
  ["The answer", "your objective, addressed up front"],
  ["Company research", "market, signals and risks, every line cited"],
  ["Meeting contact", "the person you're meeting, identity-verified"],
  ["The pitch", "your angle, talking points and opener"],
];

function Specimen() {
  return (
    <section>
      <div className="mx-auto max-w-6xl px-6 md:px-10 py-24 md:py-32">
        <div className="grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <Reveal>
            <p className="eyebrow">What you get</p>
            <h2
              className="mt-5 font-display text-display-lg text-ink"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 60' }}
            >
              A dossier you'd be proud to{" "}
              <em
                className="italic text-accent"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
              >
                bring to the room.
              </em>
            </h2>
            <p className="mt-5 text-ink-soft leading-relaxed max-w-prose">
              Not a wall of links. Your objective answered up front, the company
              researched and fully cited, the person you're meeting verified, and
              a pitch built around what you sell. Each a click away.
            </p>
            <p className="mt-6 inline-flex items-center gap-2 font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-faint">
              <span className="h-1 w-1 rounded-full bg-accent" />
              Plus a chat grounded in every account
            </p>
          </Reveal>

          {/* The dossier specimen */}
          <Reveal delay={120}>
            <div
              className="relative rounded-[14px] bg-bg-elev/70 border border-rule/[0.08] overflow-hidden"
              style={{ boxShadow: "0 40px 90px -50px rgba(0,0,0,0.9)" }}
            >
              {/* accent spine */}
              <div className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-accent/60 to-transparent" />
              <header className="flex items-baseline justify-between gap-4 px-7 pt-6 pb-5 hairline-b">
                <p className="eyebrow !tracking-[0.18em]">Research dossier</p>
                <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint">
                  Acme Inc · cited
                </p>
              </header>
              <ol className="px-7 py-4">
                {DELIVERABLES.map(([label, note], i) => (
                  <li
                    key={label}
                    className="flex items-baseline gap-4 py-3 border-b border-rule/[0.06] last:border-0"
                  >
                    <span className="w-6 shrink-0 font-mono text-[0.6875rem] text-accent/80 tabular-nums">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className="block font-display text-[1.05rem] text-ink leading-snug"
                        style={{ fontVariationSettings: '"opsz" 36, "SOFT" 40' }}
                      >
                        {label}
                      </span>
                      <span className="mt-0.5 block text-[0.8125rem] text-ink-faint leading-snug">
                        {note}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

// ─── How it works ───────────────────────────────────────────────────────────

const STEPS = [
  {
    n: "01",
    label: "Plan",
    body: "You give the company and why the meeting matters. It asks a couple of sharp clarifying questions, then shows a research plan for you to approve.",
  },
  {
    n: "02",
    label: "Research",
    body: "Fans out across the public web in parallel, researching the company and the person you're meeting, keeping every citation attached to the fact it supports.",
  },
  {
    n: "03",
    label: "Verify",
    body: "Re-checks its findings, confirms the contact really is who you think (never an unrelated namesake), and names what it couldn't confirm instead of guessing.",
  },
  {
    n: "04",
    label: "Deliver",
    body: "Builds a dashboard: your objective answered, the cited research, the verified contact, and a pitch drawn from your company profile. Plus a chat that answers follow-ups from the same evidence.",
  },
];

function HowItWorks() {
  return (
    <section id="how">
      <div className="mx-auto max-w-6xl px-6 md:px-10 py-24 md:py-32">
        <Reveal>
          <div className="max-w-2xl">
            <p className="eyebrow">How it works</p>
            <h2
              className="mt-5 font-display text-display-lg text-ink"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 60' }}
            >
              From a company name to a meeting that's{" "}
              <em
                className="italic text-accent"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
              >
                done the homework.
              </em>
            </h2>
            <p className="mt-5 text-ink-soft leading-relaxed">
              It plans the questions, researches the company and the contact
              across the web, checks its own work, then assembles the
              dashboard: answer, cited research, verified contact, and a pitch.
              Every step is inspectable. Every citation is real.
            </p>
          </div>
        </Reveal>

        <div className="mt-16 grid gap-x-12 gap-y-12 md:grid-cols-2">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 90}>
              <div className="group flex gap-6 hairline-t pt-6">
                <span
                  className="font-display italic text-3xl text-accent leading-none shrink-0 transition-transform duration-300 group-hover:-translate-y-0.5"
                  style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
                  aria-hidden
                >
                  {s.n}
                </span>
                <div>
                  <h3
                    className="font-display text-xl text-ink"
                    style={{ fontVariationSettings: '"opsz" 72, "SOFT" 60' }}
                  >
                    {s.label}
                  </h3>
                  <p className="mt-2 text-sm text-ink-soft leading-relaxed max-w-sm">
                    {s.body}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Who it's for ────────────────────────────────────────────────────────────

const PERSONAS = [
  {
    who: "Account executives",
    pain: "Discovery calls where you spend the first ten minutes finding your footing.",
    lift: "Walk in with the business model, the buyer's pressures, and three questions they'll want to answer.",
  },
  {
    who: "SDRs & BDRs",
    pain: "Forty minutes of research per account, multiplied by the whole list.",
    lift: "Briefs that pay rent on the outbound list. Pattern-match faster, personalize at speed.",
  },
  {
    who: "Founders selling",
    pain: "Investor and partner meetings where you can't afford to look unprepared.",
    lift: "An analyst on call. A second pair of eyes your team can read in five minutes.",
  },
  {
    who: "Customer success",
    pain: "QBR prep that eats a whole afternoon.",
    lift: "Refreshed signals on a schedule you set. Walk in knowing what changed.",
  },
];

function ForWhom() {
  return (
    <section id="users">
      <div className="mx-auto max-w-6xl px-6 md:px-10 py-24 md:py-32">
        <Reveal>
          <div className="max-w-2xl">
            <p className="eyebrow">Who it's for</p>
            <h2
              className="mt-5 font-display text-display-lg text-ink"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 60' }}
            >
              The meeting that{" "}
              <em
                className="italic text-accent"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
              >
                matters
              </em>{" "}
              is yours. We make sure you arrive ready.
            </h2>
          </div>
        </Reveal>

        <div className="mt-14 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          {PERSONAS.map((p, i) => (
            <Reveal key={p.who} delay={i * 80}>
              <article className="space-y-4 hairline-t pt-5 h-full">
                <h3
                  className="font-display italic text-xl text-ink"
                  style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100' }}
                >
                  {p.who}
                </h3>
                <div>
                  <p className="eyebrow !text-bad/80">Before</p>
                  <p className="text-sm text-ink-soft leading-relaxed mt-1.5">
                    {p.pain}
                  </p>
                </div>
                <div>
                  <p className="eyebrow !text-good/80">After</p>
                  <p className="text-sm text-ink leading-relaxed mt-1.5">
                    {p.lift}
                  </p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Closer ──────────────────────────────────────────────────────────────────

function Closer() {
  return (
    <section>
      <div className="mx-auto max-w-6xl px-6 md:px-10 py-24 md:py-32 text-center">
        <Reveal>
          <p
            className="font-display italic text-2xl md:text-3xl text-ink-soft max-w-prose mx-auto leading-snug"
            style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100' }}
          >
            "The seller who arrives prepared is already in conversation; the one
            who isn't is still in introduction."
          </p>

          <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
            <SignedOut>
              <Link to="/sign-up" className="btn-primary">
                Write your first brief<span className="arrow">→</span>
              </Link>
            </SignedOut>
            <SignedIn>
              <Link to="/app" className="btn-primary">
                Open your archive<span className="arrow">→</span>
              </Link>
            </SignedIn>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Primitives ───────────────────────────────────────────────────────────────

/** Edge-fading section divider — replaces the full-bleed cream rules that read
 * cheap on the dark theme. */
function Divider() {
  return (
    <div className="mx-auto max-w-6xl px-6 md:px-10">
      <div className="divider-x" />
    </div>
  );
}

/** Fades + lifts its children into view once on scroll. Falls back to visible
 * if IntersectionObserver is unavailable or the user prefers reduced motion. */
function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`${className} transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        shown ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
      }`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}
