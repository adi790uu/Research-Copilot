import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";

export default function Home() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 10_000,
  });

  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="text-4xl font-semibold tracking-tight text-ink-50">
        Prepare for the meeting that matters.
      </h1>
      <p className="mt-3 text-ink-300 max-w-xl">
        Give us a company and an objective. We do the research, build the
        briefing, and stay with you through follow-up questions.
      </p>

      <section className="mt-12">
        <div className="rounded-lg border border-ink-800/80 bg-ink-900/40 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium text-ink-100">Backend</h2>
              <p className="text-xs text-ink-500 mt-1">
                FastAPI service at <code>/health</code>
              </p>
            </div>
            <HealthBadge
              loading={health.isLoading}
              error={health.error}
              data={health.data}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function HealthBadge({
  loading,
  error,
  data,
}: {
  loading: boolean;
  error: unknown;
  data: { status: string; version: string } | undefined;
}) {
  if (loading) {
    return <Pill tone="neutral">checking…</Pill>;
  }
  if (error) {
    const message =
      error instanceof ApiError ? error.message : "unreachable";
    return <Pill tone="bad">offline · {message}</Pill>;
  }
  return <Pill tone="good">online · v{data?.version ?? "?"}</Pill>;
}

function Pill({
  tone,
  children,
}: {
  tone: "good" | "bad" | "neutral";
  children: React.ReactNode;
}) {
  const styles = {
    good: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
    bad: "bg-red-500/10 text-red-300 border-red-500/20",
    neutral: "bg-ink-800 text-ink-300 border-ink-700",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${styles}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          tone === "good"
            ? "bg-emerald-400"
            : tone === "bad"
              ? "bg-red-400"
              : "bg-ink-400"
        }`}
      />
      {children}
    </span>
  );
}
