import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { ApiError, useApi } from "../lib/api";
import type { ResearchJob, ResearchJobStatus } from "../lib/types";

const POLL_INTERVAL_MS = 4000;

const TERMINAL: ReadonlySet<ResearchJobStatus> = new Set(["completed", "failed"]);

/**
 * Polls the latest research job for a session. Returns `null` once we've
 * confirmed there isn't one (404 from the backend) so callers can branch
 * cleanly between "no job yet" and "no data yet".
 *
 * Polling stops once the job is terminal (completed/failed). When the
 * session has no job at all (null), polling also stops — the caller is
 * expected to re-enable / invalidate this query when they kick off a run.
 */
export function useLatestJob(
  sessionId: string,
  enabled: boolean
): UseQueryResult<ResearchJob | null> {
  const api = useApi();
  return useQuery({
    queryKey: ["session-job", sessionId],
    queryFn: async () => {
      try {
        return await api.briefs.latestJob(sessionId);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: enabled && sessionId.length > 0,
    refetchInterval: (query) => {
      const data = query.state.data;
      // No job yet — don't poll; caller invalidates when one is spawned.
      if (data === null) return false;
      const status = data?.status;
      if (status && TERMINAL.has(status)) return false;
      return POLL_INTERVAL_MS;
    },
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

/**
 * Polls a specific job. Stops polling once the job hits a terminal state.
 */
export function useJob(jobId: string | null): UseQueryResult<ResearchJob> {
  const api = useApi();
  return useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.jobs.get(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && TERMINAL.has(status)) return false;
      return POLL_INTERVAL_MS;
    },
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}
