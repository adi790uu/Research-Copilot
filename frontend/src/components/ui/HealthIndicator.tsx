import { useQuery } from "@tanstack/react-query";

import { publicApi } from "../../lib/api";

export function HealthIndicator() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: publicApi.health,
    // One-shot check on mount; no recurring pings.
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  let dotClass = "bg-ink-faint animate-pulse-dot";
  let label = "checking";

  if (health.error) {
    dotClass = "bg-bad";
    label = "offline";
  } else if (health.data) {
    dotClass = "bg-good";
    label = `v${health.data.version}`;
  }

  return (
    <span
      className="inline-flex items-center gap-2 font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-faint"
      title={health.error ? "Backend is unreachable" : "Backend is online"}
    >
      <span className={`h-[5px] w-[5px] rounded-full ${dotClass}`} />
      <span>{label}</span>
    </span>
  );
}
