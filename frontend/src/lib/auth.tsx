import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Navigate, useLocation } from "react-router-dom";

const BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api";

const STORAGE_KEY = "rc.auth";

export interface AuthUser {
  id: string;
  email: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
}

interface AuthContextValue {
  /** `null` while we're still reading localStorage; `undefined` afterwards if signed out. */
  session: AuthSession | null;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  getToken: () => string | null;
}

const Ctx = createContext<AuthContextValue | null>(null);

function readStored(): AuthSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed?.token || !parsed?.user?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(s: AuthSession | null) {
  if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  else localStorage.removeItem(STORAGE_KEY);
}

async function authFetch(path: string, body: object): Promise<AuthSession> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      json?.error?.message ??
      (Array.isArray(json?.detail) ? json.detail[0]?.msg : null) ??
      `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return { token: json.access_token, user: json.user };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  // Cold-load: read whatever's in localStorage. JWT verification happens on
  // the backend — we just trust the cached token here and let the next API
  // call surface a 401 if it's expired.
  useEffect(() => {
    setSession(readStored());
    setLoading(false);
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const next = await authFetch("/auth/sign-up", { email, password });
    writeStored(next);
    setSession(next);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const next = await authFetch("/auth/sign-in", { email, password });
    writeStored(next);
    setSession(next);
  }, []);

  const signOut = useCallback(() => {
    writeStored(null);
    setSession(null);
  }, []);

  const getToken = useCallback(() => session?.token ?? null, [session]);

  const value = useMemo(
    () => ({ session, loading, signUp, signIn, signOut, getToken }),
    [session, loading, signUp, signIn, signOut, getToken]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

// ─── Drop-in replacements for Clerk gating components ──────────────────────

export function SignedIn({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return null;
  return session ? <>{children}</> : null;
}

export function SignedOut({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return null;
  return session ? null : <>{children}</>;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (!session) {
    return (
      <Navigate
        to="/sign-in"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }
  return <>{children}</>;
}
