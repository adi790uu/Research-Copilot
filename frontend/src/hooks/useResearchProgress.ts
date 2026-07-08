import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useApi } from "../lib/api";
import type { ResearchProgress } from "../lib/types";

const POLL_INTERVAL_MS = 3500;

/**
 * Polls a running brief's progress (status + tasks) and, when it reaches a
 * terminal state, refreshes the briefs list once so the card silently flips to
 * completed/failed. Polling only runs while `enabled` (i.e. the brief is
 * running).
 */
export function useResearchProgress(briefId: string, enabled: boolean) {
  const api = useApi();
  const queryClient = useQueryClient();
  const wasEnabled = useRef(enabled);

  const query = useQuery<ResearchProgress>({
    queryKey: ["research-progress", briefId],
    queryFn: () => api.briefs.progress(briefId),
    enabled,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === "completed" || status === "failed" ? false : POLL_INTERVAL_MS;
    },
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  // When the poll first reports a terminal status, repaint the list so the
  // brief's own status (synced by the worker) shows through.
  const status = query.data?.status;
  useEffect(() => {
    if (!enabled) {
      wasEnabled.current = false;
      return;
    }
    wasEnabled.current = true;
    if (status === "completed" || status === "failed") {
      queryClient.invalidateQueries({ queryKey: ["briefs"] });
    }
  }, [status, enabled, queryClient]);

  return query.data;
}
