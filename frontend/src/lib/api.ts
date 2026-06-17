import { useMemo } from "react";

import { useAuth } from "./auth";

import type {
  ActivitySummary,
  ChatTurnPayload,
  FollowupMessage,
  ResearchJob,
  ResearchJobEvent,
  ResearchTask,
  ResearcherResult,
  Session,
  SessionCreate,
  SessionPage,
  User,
} from "./types";

const BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api";

export const apiBaseUrl = BASE_URL;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type Health = { status: string; version: string };

type TokenSource = (() => string | null) | null;

type Fetcher = <T>(path: string, init?: RequestInit) => Promise<T>;

function buildFetcher(getToken: TokenSource): Fetcher {
  return async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
    };

    if (getToken) {
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });

    if (!res.ok) {
      let code = "http_error";
      let message = `Request failed (${res.status})`;
      try {
        const body = (await res.json()) as {
          error?: { code?: string; message?: string };
          detail?: unknown;
        };
        if (body.error) {
          code = body.error.code ?? code;
          message = body.error.message ?? message;
        } else if (Array.isArray(body.detail) && body.detail.length > 0) {
          code = "validation_error";
          const first = body.detail[0] as { msg?: string; loc?: unknown[] };
          const field = Array.isArray(first.loc)
            ? first.loc.slice(1).join(".")
            : "";
          message = field ? `${field}: ${first.msg ?? "invalid"}` : (first.msg ?? message);
        }
      } catch {
        // ignore body-parse failure; fall back to status
      }
      throw new ApiError(res.status, code, message);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  };
}

interface ApiClient {
  health: () => Promise<Health>;
  me: {
    get: () => Promise<User>;
    activity: () => Promise<ActivitySummary>;
  };
  sessions: {
    create: (payload: SessionCreate) => Promise<Session>;
    list: (params?: { limit?: number; offset?: number }) => Promise<SessionPage>;
    get: (id: string) => Promise<Session>;
    /** Phase 1 SSE chat: returns the raw Response so the caller can read
     * the event stream off `response.body`. */
    chat: (
      id: string,
      payload: ChatTurnPayload,
      signal?: AbortSignal
    ) => Promise<Response>;
    /** Most-recent job for this session (404 if none). */
    latestJob: (id: string) => Promise<ResearchJob>;
    listJobs: (id: string) => Promise<ResearchJob[]>;
    /** Follow-up chat history (post-report). */
    listMessages: (id: string) => Promise<FollowupMessage[]>;
    /** Post a follow-up message; returns the raw streaming Response. */
    postMessage: (
      id: string,
      content: string,
      signal?: AbortSignal
    ) => Promise<Response>;
  };
  jobs: {
    get: (id: string) => Promise<ResearchJob>;
    events: (id: string) => Promise<ResearchJobEvent[]>;
    researchers: (id: string) => Promise<ResearcherResult[]>;
    tasks: (id: string) => Promise<ResearchTask[]>;
    reportPdf: (id: string) => Promise<{ blob: Blob; filename: string }>;
  };
}

function buildClient(fetcher: Fetcher, getToken: TokenSource): ApiClient {
  return {
    health: () => fetcher<Health>("/health"),
    me: {
      get: () => fetcher<User>("/me"),
      activity: () => fetcher<ActivitySummary>("/me/activity"),
    },
    sessions: {
      create: (payload) =>
        fetcher<Session>("/sessions", {
          method: "POST",
          body: JSON.stringify(payload),
        }),
      list: (params) => {
        const q = new URLSearchParams();
        if (params?.limit != null) q.set("limit", String(params.limit));
        if (params?.offset != null) q.set("offset", String(params.offset));
        const qs = q.toString();
        return fetcher<SessionPage>(`/sessions${qs ? `?${qs}` : ""}`);
      },
      get: (id) => fetcher<Session>(`/sessions/${id}`),
      chat: async (id, payload, signal) => {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        };
        if (getToken) {
          const token = getToken();
          if (token) headers.Authorization = `Bearer ${token}`;
        }
        return fetch(`${BASE_URL}/sessions/${id}/chat`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal,
        });
      },
      latestJob: (id) => fetcher<ResearchJob>(`/sessions/${id}/job`),
      listJobs: (id) => fetcher<ResearchJob[]>(`/sessions/${id}/jobs`),
      listMessages: (id) =>
        fetcher<FollowupMessage[]>(`/sessions/${id}/messages`),
      postMessage: async (id, content, signal) => {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        };
        if (getToken) {
          const token = getToken();
          if (token) headers.Authorization = `Bearer ${token}`;
        }
        return fetch(`${BASE_URL}/sessions/${id}/messages`, {
          method: "POST",
          headers,
          body: JSON.stringify({ content }),
          signal,
        });
      },
    },
    jobs: {
      get: (id) => fetcher<ResearchJob>(`/jobs/${id}`),
      events: (id) => fetcher<ResearchJobEvent[]>(`/jobs/${id}/events`),
      researchers: (id) => fetcher<ResearcherResult[]>(`/jobs/${id}/researchers`),
      tasks: (id) => fetcher<ResearchTask[]>(`/jobs/${id}/tasks`),
      reportPdf: async (id) => {
        const headers: Record<string, string> = { Accept: "application/pdf" };
        if (getToken) {
          const token = getToken();
          if (token) headers.Authorization = `Bearer ${token}`;
        }
        const res = await fetch(`${BASE_URL}/jobs/${id}/report.pdf`, {
          method: "GET",
          headers,
        });
        if (!res.ok) {
          let message = `PDF export failed (${res.status})`;
          try {
            const body = (await res.json()) as {
              error?: { message?: string };
            };
            if (body.error?.message) message = body.error.message;
          } catch {
            // ignore — fall back to status
          }
          throw new ApiError(res.status, "pdf_error", message);
        }
        const disposition = res.headers.get("Content-Disposition") ?? "";
        const match = disposition.match(/filename="?([^"]+)"?/i);
        const filename = match?.[1] ?? `brief-${id.slice(0, 6)}.pdf`;
        const blob = await res.blob();
        return { blob, filename };
      },
    },
  };
}

/**
 * Authed API hook — attaches the stored JWT before every request.
 * Use inside dashboard / protected components.
 */
export function useApi(): ApiClient {
  const { getToken } = useAuth();
  return useMemo(
    () => buildClient(buildFetcher(getToken), getToken),
    [getToken]
  );
}

/**
 * Public API client (no auth). Use for /health on the landing page or anywhere
 * the user isn't signed in.
 */
export const publicApi: ApiClient = buildClient(buildFetcher(null), null);
