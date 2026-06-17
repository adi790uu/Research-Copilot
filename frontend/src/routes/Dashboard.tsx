import { SessionForm } from "../components/session/SessionForm";
import { useAuth } from "../lib/auth";

export default function Dashboard() {
  const { session } = useAuth();
  const firstName = session?.user.email.split("@")[0] ?? null;
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="mx-auto max-w-3xl px-6 md:px-10 pt-10 md:pt-14 pb-24 stagger">
      {/* Masthead — feels like the top of a magazine page. The thin
          baseline rule sets the page's typographic floor before the
          composition below. */}
      <div className="flex items-baseline justify-between gap-6 pb-3 border-b border-rule/15">
        <p className="eyebrow">The brief</p>
        <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint">
          {today}
        </p>
      </div>

      <h1
        className="mt-8 font-display text-[2.5rem] leading-[1.05] text-ink md:text-[3.25rem]"
        style={{ fontVariationSettings: '"opsz" 144, "SOFT" 60' }}
      >
        {firstName ? (
          <>
            What should we read for you,{" "}
            <em
              className="italic text-accent"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
            >
              {firstName}
            </em>
            ?
          </>
        ) : (
          <>
            What should we{" "}
            <em
              className="italic text-accent"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
            >
              read
            </em>{" "}
            for you?
          </>
        )}
      </h1>

      <p className="mt-4 max-w-prose text-ink-soft leading-relaxed">
        Compose the brief below. Three lines is all the team needs to
        start digging — the researchers, the supervisor, and the writer
        all begin from what you set down here.
      </p>

      <section id="new" className="mt-14 scroll-mt-20">
        <SessionForm />
      </section>

      <p
        className="mt-24 max-w-prose font-display italic text-base leading-relaxed text-ink-faint"
        style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100' }}
      >
        Every brief is grounded in sources. Every answer is grounded in the
        brief. Walk into the meeting knowing.
      </p>
    </div>
  );
}
