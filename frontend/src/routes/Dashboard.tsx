import { useUser } from "@clerk/clerk-react";

import { SessionForm } from "../components/session/SessionForm";
import { SessionList } from "../components/session/SessionList";
import { SectionHeading } from "../components/ui/SectionHeading";

export default function Dashboard() {
  const { user } = useUser();
  const firstName = user?.firstName ?? user?.username ?? null;

  return (
    <div className="mx-auto max-w-3xl px-6 md:px-10 pt-10 md:pt-14 pb-24 stagger">
      <div>
        <p className="eyebrow">Your workspace</p>
      </div>

      <div>
        <h1
          className="mt-5 font-display text-display-md md:text-display-lg text-ink"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 60' }}
        >
          {firstName ? (
            <>
              Good to see you,{" "}
              <em
                className="italic text-accent"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
              >
                {firstName}.
              </em>
            </>
          ) : (
            <>
              Welcome to your{" "}
              <em
                className="italic text-accent"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
              >
                workspace.
              </em>
            </>
          )}
        </h1>
      </div>

      <div>
        <p className="mt-4 text-ink-soft leading-relaxed max-w-prose">
          Compose a new brief below, or revisit one from your archive.
        </p>
      </div>

      <section id="new" className="mt-14 scroll-mt-20">
        <SectionHeading number="01" label="New brief" meta="Three fields" />
        <div className="mt-8">
          <SessionForm />
        </div>
      </section>

      <section id="archive" className="mt-20 scroll-mt-20">
        <SectionHeading number="02" label="Archive" meta="Most recent first" />
        <div className="mt-6">
          <SessionList />
        </div>
      </section>
    </div>
  );
}
