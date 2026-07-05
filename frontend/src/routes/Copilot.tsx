import { SessionForm } from "../components/session/SessionForm";
import { useAuth } from "../lib/auth";

/**
 * The default landing page after sign-in. Deliberately spare — a centered
 * greeting and a single composer, closer to a chat app's empty state than
 * the old magazine-style dashboard. Past research lives in the Researches
 * tab now, not here.
 */
export default function Copilot() {
  const { session } = useAuth();
  const firstName = session?.user.email.split("@")[0] ?? null;

  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto px-6">
      <div className="w-full max-w-2xl py-16 stagger">
        <h1
          className="text-center font-display text-[2.25rem] leading-[1.1] text-ink md:text-[2.75rem]"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 60' }}
        >
          {firstName ? (
            <>
              What should we{" "}
              <em
                className="italic text-accent"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
              >
                research
              </em>
              , {firstName}?
            </>
          ) : (
            <>
              What should we{" "}
              <em
                className="italic text-accent"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
              >
                research
              </em>{" "}
              today?
            </>
          )}
        </h1>

        <section className="mt-10">
          <SessionForm />
        </section>
      </div>
    </div>
  );
}
