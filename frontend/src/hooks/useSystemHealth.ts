import { useQuery } from "@tanstack/react-query";

import { publicApi } from "../lib/api";

const POLL_INTERVAL_MS = 10_000;

/**
 * Polls the backend `/health` endpoint on a fixed interval. Used by the
 * `SystemHealthGate` to swap the whole app for a "we're down" page the
 * moment the backend stops responding, and to seamlessly recover once
 * it's reachable again.
 *
 * Uses the public (unauthed) client so the check works on the landing
 * page and on the sign-in screen too.
 */
export function useSystemHealth() {
  return useQuery({
    queryKey: ["system-health"],
    queryFn: publicApi.health,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    // One quick retry on the initial fetch so a single transient blip
    // doesn't paint the down page during cold start.
    retry: 1,
    retryDelay: 600,
    staleTime: 0,
    gcTime: Infinity,
  });
}
