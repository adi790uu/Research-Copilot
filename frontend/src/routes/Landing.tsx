import { Link } from "react-router-dom";
import { SignedIn, SignedOut } from "../lib/auth";

import { MarketingShell } from "../components/marketing/MarketingShell";

export default function Landing() {
  return (
    <MarketingShell>
      <Hero />
      <Workflow />
      <ForWhom />
      <Closer />
    </MarketingShell>
  );
}

function Hero() {
  return (
    <section className="relative">
      <div className="mx-auto max-w-4xl px-6 md:px-10 pt-20 md:pt-28 pb-24 stagger">
        <p className="eyebrow">
          A research copilot for sellers · Vol. 01
        </p>

        <h1
          className="mt-8 font-display text-ink leading-[0.98] tracking-[-0.025em]"
          style={{
            fontVariationSettings: '"opsz" 144, "SOFT" 60',
            fontSize: "clamp(3rem, 8vw, 6rem)",
          }}
        >
          Your sellers run the conversation.{" "}
          <em
            className="italic text-accent"
            style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
          >
            We do everything else.
          </em>
        </h1>

        <p className="mt-8 text-lg md:text-xl text-ink-soft leading-relaxed max-w-prose">
          Give us a company and a reason to care.
          We research the business, draft a structured briefing — overview,
          signals, risks, the questions worth asking — and stay with you through
          the follow-up. Before the meeting starts, you already know how it
          should end.
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

      {/* Decorative rule */}
      <div className="mx-auto max-w-6xl px-6 md:px-10">
        <div className="border-t border-rule/10" />
      </div>
    </section>
  );
}

function Workflow() {
  const steps = [
    {
      n: "01",
      label: "Planner",
      title: "Reads your objective.",
      body: "Decomposes what you actually want to learn into 4–6 research questions worth answering.",
    },
    {
      n: "02",
      label: "Researcher",
      title: "Reads the public web.",
      body: "Fans out across multiple sources, deduplicates, and keeps the citations attached to the facts.",
    },
    {
      n: "03",
      label: "Extractor",
      title: "Pulls out the signal.",
      body: "Structured facts from each source, each one linked back to the page it came from.",
    },
    {
      n: "04",
      label: "Synthesizer",
      title: "Writes the briefing.",
      body: "Nine sections, each grounded in sources you can hand-check. No invented logos. No fictional execs.",
    },
    {
      n: "05",
      label: "Quality gate",
      title: "Audits itself.",
      body: "Re-researches when confidence is low. Names what it doesn't know, instead of guessing.",
    },
    {
      n: "06",
      label: "Assembler",
      title: "Hands you the brief.",
      body: "A document you'd be proud to bring to the meeting. Plus a chat that knows it cold.",
    },
  ];

  return (
    <section id="how" className="border-b border-rule/8">
      <div className="mx-auto max-w-6xl px-6 md:px-10 py-24 md:py-32">
        <div className="max-w-2xl">
          <p className="eyebrow">How it works</p>
          <h2
            className="mt-5 font-display text-display-lg text-ink"
            style={{ fontVariationSettings: '"opsz" 144, "SOFT" 60' }}
          >
            Six steps from a company name to a brief you'd{" "}
            <em
              className="italic text-accent"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
            >
              actually use.
            </em>
          </h2>
          <p className="mt-5 text-ink-soft leading-relaxed">
            Behind the scenes, a stateful LangGraph workflow plans the research,
            executes it across the web, audits its own output, and only then writes
            the report. Each step is inspectable. Each citation is real.
          </p>
        </div>

        <div className="mt-16 grid gap-x-10 gap-y-12 md:grid-cols-2 lg:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n} className="space-y-3">
              <div className="flex items-baseline gap-3 border-b border-rule/10 pb-2">
                <span
                  className="font-display italic text-2xl text-accent"
                  style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
                  aria-hidden
                >
                  {s.n}
                </span>
                <span className="eyebrow">{s.label}</span>
              </div>
              <h3
                className="font-display italic text-xl text-ink leading-snug"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100' }}
              >
                {s.title}
              </h3>
              <p className="text-sm text-ink-soft leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ForWhom() {
  const personas = [
    {
      who: "Account executives",
      pain: "Discovery calls where you spent the first ten minutes finding your footing.",
      lift: "Walk in with the business model, the buyer's pressures, and three questions they'll actually want to answer.",
    },
    {
      who: "SDRs & BDRs",
      pain: "Forty minutes of research per account, multiplied by the list.",
      lift: "Briefs that pay rent on the outbound list. Pattern-match faster. Personalize at speed.",
    },
    {
      who: "Founders selling",
      pain: "Investor and partner meetings where you can't afford to look unprepared.",
      lift: "An analyst on call. A second pair of eyes. A briefing your team can read in five minutes.",
    },
    {
      who: "Customer success",
      pain: "QBR prep that takes a whole afternoon.",
      lift: "Refreshed signals from the account on a schedule you set. Walk in knowing what changed.",
    },
  ];

  return (
    <section id="users">
      <div className="mx-auto max-w-6xl px-6 md:px-10 py-24 md:py-32">
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
            is yours. We make sure you arrive ready for it.
          </h2>
        </div>

        <div className="mt-14 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          {personas.map((p) => (
            <article
              key={p.who}
              className="space-y-4 border-t border-rule/15 pt-5"
            >
              <h3 className="font-display italic text-xl text-ink"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100' }}>
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
          ))}
        </div>
      </div>
    </section>
  );
}

function Closer() {
  return (
    <section className="border-t border-rule/8">
      <div className="mx-auto max-w-6xl px-6 md:px-10 py-24 md:py-32 text-center">
        <p
          className="font-display italic text-2xl md:text-3xl text-ink-soft max-w-prose mx-auto leading-snug"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100' }}
        >
          "The seller who arrives prepared is already in conversation;
          the one who isn't is still in introduction."
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
      </div>
    </section>
  );
}
