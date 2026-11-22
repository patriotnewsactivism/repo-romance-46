/**
 * Auth client.
 *
 * The app used Supabase Auth; identity now comes from the first-party
 * `/api/auth/*` endpoints on the self-hosted API. This module deliberately
 * mirrors the handful of Supabase methods the UI already calls
 * (`getSession`, `getUser`, `onAuthStateChange`, `signInWithOAuth`, …) so
 * components did not have to change. The session token is an opaque bearer
 * string issued by our API, stored in localStorage.
 */

export interface AuthUser {
  id: string;
  email: string | null;
  user_metadata: {
    user_name?: string | null;
    full_name?: string | null;
    avatar_url?: string | null;
    github_login?: string | null;
  };
}

export interface AuthSession {
  access_token: string;
  token_type: "bearer";
  user: AuthUser;
  /** Present only immediately after a GitHub handshake, matching Supabase. */
  provider_token?: string;
}

interface SessionResponse {
  token?: string;
  user?: {
    id: string;
    email: string | null;
    display_name: string | null;
    avatar_url: string | null;
    github_login: string | null;
  };
  error?: string;
}

const STORAGE_KEY = "bluebook.session";
const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

type Listener = (event: string, session: AuthSession | null) => void;

const listeners = new Set<Listener>();

function readStored(): AuthSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthSession) : null;
  } catch {
    return null;
  }
}

let current: AuthSession | null = readStored();

function emit(event: string): void {
  for (const listener of listeners) listener(event, current);
}

function persist(session: AuthSession | null): void {
  current = session;
  try {
    if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private-mode storage failures must not break sign-in.
  }
  emit(session ? "SIGNED_IN" : "SIGNED_OUT");
}

function toSession(payload: SessionResponse): AuthSession | null {
  if (!payload.token || !payload.user) return null;
  const user = payload.user;
  return {
    access_token: payload.token,
    token_type: "bearer",
    user: {
      id: user.id,
      email: user.email,
      user_metadata: {
        user_name: user.github_login ?? user.display_name,
        full_name: user.display_name,
        avatar_url: user.avatar_url,
        github_login: user.github_login,
      },
    },
  };
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function authHeader(): Record<string, string> {
  return current ? { Authorization: `Bearer ${current.access_token}` } : {};
}

export const supabase = {
  auth: {
    async getSession() {
      return { data: { session: current }, error: null as { message: string } | null };
    },

    async getUser() {
      if (!current) {
        return { data: { user: null }, error: { message: "Not authenticated" } };
      }
      return { data: { user: current.user }, error: null };
    },

    async getSessionUser() {
      if (!current) return { data: { user: null }, error: { message: "Not authenticated" } };
      const res = await request("/auth/session", { headers: authHeader() });
      if (!res.ok) return { data: { user: null }, error: { message: "Session expired" } };
      const payload = (await res.json()) as SessionResponse;
      const refreshed = toSession({ ...payload, token: current.access_token });
      if (refreshed) persist(refreshed);
      return { data: { user: refreshed?.user ?? null }, error: null };
    },

    async refreshSession() {
      if (!current) return { data: { session: null }, error: { message: "Not authenticated" } };
      const res = await request("/auth/session", { headers: authHeader() });
      if (!res.ok) {
        persist(null);
        return { data: { session: null }, error: { message: "Session expired" } };
      }
      const payload = (await res.json()) as SessionResponse;
      const refreshed = toSession({ ...payload, token: current.access_token });
      if (refreshed) persist(refreshed);
      return { data: { session: refreshed }, error: null };
    },

    onAuthStateChange(callback: Listener) {
      listeners.add(callback);
      // Supabase emitted an initial event; keep that contract without calling
      // the callback synchronously during a render.
      queueMicrotask(() => callback("INITIAL_SESSION", current));
      return { data: { subscription: { unsubscribe: () => { listeners.delete(callback); } } } };
    },

    async signInWithOAuth(options: { provider: string; options?: { redirectTo?: string; scopes?: string } }) {
      if (options.provider !== "github") {
        return { data: { url: null, provider: options.provider }, error: { message: "Unsupported provider" } };
      }
      // The API owns the OAuth exchange and returns to /auth/callback, so a
      // browser-side redirect is all that is needed here.
      window.location.assign(`${API_BASE}/auth/github/start`);
      return { data: { url: `${API_BASE}/auth/github/start`, provider: "github" }, error: null };
    },

    async signInWithPassword({ email, password }: { email: string; password: string }) {
      const res = await request("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      const payload = (await res.json()) as SessionResponse;
      if (!res.ok) {
        return { data: { session: null, user: null }, error: { message: payload.error ?? "Sign-in failed" } };
      }
      const session = toSession(payload);
      persist(session);
      return { data: { session, user: session?.user ?? null }, error: null };
    },

    async signUp({ email, password }: { email: string; password: string }) {
      const res = await request("/auth/signup", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      const payload = (await res.json()) as SessionResponse;
      if (!res.ok) {
        return {
          data: { session: null, user: null },
          error: { message: payload.error ?? "Could not create the account" },
        };
      }
      const session = toSession(payload);
      persist(session);
      return { data: { session, user: session?.user ?? null }, error: null };
    },

    async exchangeCodeForSession(url: string) {
      const hash = url.includes("#") ? url.slice(url.indexOf("#") + 1) : "";
      const params = new URLSearchParams(hash);

      const oauthError = params.get("error");
      if (oauthError) {
        return { data: { session: null }, error: { message: decodeURIComponent(oauthError) } };
      }

      const token = params.get("access_token");
      if (!token) {
        return { data: { session: current }, error: current ? null : { message: "No session to exchange" } };
      }

      const res = await request("/auth/session", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        return { data: { session: null }, error: { message: "Could not verify the GitHub session" } };
      }
      const payload = (await res.json()) as SessionResponse;
      const session = toSession({ ...payload, token });
      persist(session);
      // Drop the token from the address bar so a reload cannot replay it.
      window.history.replaceState(null, "", window.location.pathname);
      return { data: { session }, error: null };
    },

    async signOut() {
      if (current) {
        try {
          await request("/auth/logout", { method: "POST", headers: authHeader() });
        } catch {
          // A failed logout still clears local state; the token expires server-side.
        }
      }
      persist(null);
      return { error: null };
    },
  },
};

export default supabase;
