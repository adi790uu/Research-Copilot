import type { ReactNode } from "react";

import { useSystemHealth } from "../hooks/useSystemHealth";

/**
 * Wraps the app and swaps it for a full-page "system down" notice when
 * the backend health check fails. The hook polls every 15s and the
 * notice replaces itself automatically the moment a check succeeds —
 * the user doesn't need to reload.
 */
export function SystemHealthGate({ children }: { children: ReactNode }) {
  const health = useSystemHealth();

  if (health.isError) {
    return (
      <SystemDownPage
        onRetry={() => void health.refetch()}
        retrying={health.isFetching}
      />
    );
  }

  return <>{children}</>;
}

function SystemDownPage({
  onRetry,
  retrying,
}: {
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <main
      role="alert"
      aria-live="assertive"
      className="grid min-h-dvh place-items-center bg-bg px-6"
    >
      <div className="mx-auto w-full max-w-[28rem] text-center">
        {/* A single warm filament with a soft halo — same motif as the
            in-app skeleton, so the down state feels like a pause, not a
            crash. */}
        <div className="mb-10 grid place-items-center">
          <div className="relative grid h-12 place-items-center">
            <div
              aria-hidden
              className="absolute h-32 w-32 rounded-full blur-2xl"
              style={{
                background:
                  "radial-gradient(circle, rgb(var(--accent) / 0.28), transparent 70%)",
                animation: "halo-breathe 3.2s ease-in-out infinite",
              }}
            />
            <div className="relative h-px w-32 overflow-hidden rounded-full bg-ink/8">
              <div
                aria-hidden
                className="absolute inset-y-0 h-px w-1/2"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, rgb(var(--accent)) 50%, transparent)",
                  animation:
                    "filament-draw 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite",
                }}
              />
            </div>
          </div>
        </div>

        <p className="font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-faint">
          The system is paused
        </p>
        <h1 className="mt-3 font-serif text-3xl tracking-tight text-ink">
          We&rsquo;ll be back in a moment
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">
          We&rsquo;re having some technical difficulties right now.
          We&rsquo;re trying our best to bring things back. This page will
          reconnect on its own as soon as it&rsquo;s reachable again.
        </p>

        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mt-7 inline-flex items-center gap-2 rounded-full bg-bg-elev px-4 py-2 font-mono text-[0.625rem] uppercase tracking-eyebrow text-ink-soft transition-colors hover:bg-bg-elev/80 disabled:opacity-50"
        >
          {retrying ? (
            <>
              <span className="block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-r-transparent" />
              Checking
            </>
          ) : (
            <>Try again</>
          )}
        </button>
      </div>
    </main>
  );
}
