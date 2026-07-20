// Thin API client. Attaches the JWT and active household to every request.
// All figures returned are already computed server-side; the client never
// re-implements any financial calculation.

// Same-origin API: the Next.js Route Handlers live under /api on the same Worker.
const BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "/api";

const TOKEN_KEY = "hfos_token";
const HOUSEHOLD_KEY = "hfos_household";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export function getHouseholdId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(HOUSEHOLD_KEY);
}

export function setHouseholdId(id: number | string | null) {
  if (typeof window === "undefined") return;
  if (id) window.localStorage.setItem(HOUSEHOLD_KEY, String(id));
  else window.localStorage.removeItem(HOUSEHOLD_KEY);
}

export function logout() {
  setToken(null);
  setHouseholdId(null);
  // Drop cached API responses so a different user can't see them (best-effort).
  import("./offline").then((m) => m.clearApiCache()).catch(() => undefined);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Thrown when a write is queued because the device is offline. Pages can treat
// this as a soft success ("saved offline") rather than a hard failure.
export class OfflineError extends Error {
  queued = true;
  constructor(message = "Saved offline — this change will sync when you reconnect.") {
    super(message);
  }
}

function isNetworkError(err: unknown): boolean {
  // fetch() rejects with a TypeError on network failure (offline, DNS, etc.).
  return err instanceof TypeError || (typeof navigator !== "undefined" && !navigator.onLine);
}

// Queue a mutating request for later replay; used when the network is down.
async function queueOrThrow<T>(method: string, path: string, body: unknown): Promise<T> {
  const { enqueueWrite } = await import("./offline");
  await enqueueWrite({ method, path, body, token: getToken(), household: getHouseholdId() });
  throw new OfflineError();
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const hh = getHouseholdId();
  if (hh) headers["X-Household-Id"] = hh;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string };
      detail = body.detail || JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// POSTs that are query-like (not mutations) — never queue these for replay.
const NON_QUEUEABLE = ["/copilot/ask", "/import/workbook/analyze"];

async function mutate<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await request<T>(path, { method, body: body != null ? JSON.stringify(body) : undefined });
  } catch (err) {
    // Only queue genuine offline/network failures — real server errors propagate.
    if (err instanceof ApiError) throw err;
    if (isNetworkError(err)) {
      if (NON_QUEUEABLE.some((p) => path.startsWith(p))) {
        throw new OfflineError("You're offline — reconnect to use this.");
      }
      return queueOrThrow<T>(method, path, body ?? null);
    }
    throw err;
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => mutate<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => mutate<T>("PATCH", path, body),
  del: <T>(path: string) => mutate<T>("DELETE", path),

  // Multipart upload (workbook import) — no JSON content-type.
  async upload<T>(path: string, form: FormData): Promise<T> {
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const hh = getHouseholdId();
    if (hh) headers["X-Household-Id"] = hh;
    const res = await fetch(`${BASE}${path}`, { method: "POST", headers, body: form });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.json();
  },
};

export const AUTH = {
  async login(email: string, password: string) {
    const body = await request<import("./types").AuthResponse>("/auth/login/json", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    return body;
  },
  async register(name: string, email: string, password: string, household_name?: string) {
    return request<import("./types").AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password, household_name }),
    });
  },
  me() {
    return request<import("./types").AuthResponse>("/auth/me");
  },
  forgotPassword(email: string) {
    return request<{ ok: boolean; message: string }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },
  resetPassword(token: string, password: string) {
    return request<{ ok: boolean; message: string }>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    });
  },
};
