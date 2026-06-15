import { useAuth } from "@clerk/clerk-react";
import { useMemo } from "react";

import type {
  ActivitySummary,
  Chat,
  ChatCreate,
  ChatWithMessages,
  Message,
  MessageCreate,
  Report,
  Session,
  SessionCreate,
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

type Fetcher = <T>(path: string, init?: RequestInit) => Promise<T>;

function buildFetcher(getToken: (() => Promise<string | null>) | null): Fetcher {
  return async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
    };

    if (getToken) {
      const token = await getToken();
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
    list: () => Promise<Session[]>;
    get: (id: string) => Promise<Session>;
    run: (id: string) => Promise<{ session_id: string; status: string }>;
    report: (id: string) => Promise<Report>;
    streamUrl: (id: string, token: string) => string;
  };
  chats: {
    create: (payload: ChatCreate) => Promise<Chat>;
    list: () => Promise<Chat[]>;
    get: (id: string) => Promise<ChatWithMessages>;
    addMessage: (id: string, payload: MessageCreate) => Promise<Message>;
  };
}

function buildClient(fetcher: Fetcher): ApiClient {
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
      list: () => fetcher<Session[]>("/sessions"),
      get: (id) => fetcher<Session>(`/sessions/${id}`),
      run: (id) =>
        fetcher<{ session_id: string; status: string }>(`/sessions/${id}/run`, {
          method: "POST",
        }),
      report: (id) => fetcher<Report>(`/sessions/${id}/report`),
      streamUrl: (id, token) =>
        `${BASE_URL}/sessions/${id}/stream?token=${encodeURIComponent(token)}`,
    },
    chats: {
      create: (payload) =>
        fetcher<Chat>("/chats", {
          method: "POST",
          body: JSON.stringify(payload),
        }),
      list: () => fetcher<Chat[]>("/chats"),
      get: (id) => fetcher<ChatWithMessages>(`/chats/${id}`),
      addMessage: (id, payload) =>
        fetcher<Message>(`/chats/${id}/messages`, {
          method: "POST",
          body: JSON.stringify(payload),
        }),
    },
  };
}

/**
 * Authed API hook — pulls a fresh Clerk JWT before every request.
 * Use inside dashboard / protected components.
 */
export function useApi(): ApiClient {
  const { getToken } = useAuth();
  return useMemo(() => buildClient(buildFetcher(getToken)), [getToken]);
}

/**
 * Public API client (no auth). Use for /health on the landing page or anywhere
 * the user isn't signed in.
 */
export const publicApi: ApiClient = buildClient(buildFetcher(null));
