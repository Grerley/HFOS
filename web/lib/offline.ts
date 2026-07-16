// Offline write queue + service-worker lifecycle.
//
// When a mutating API call fails purely because the device is offline, the API
// client enqueues it here (durably, in IndexedDB) instead of losing it. On
// reconnect the queue is replayed in FIFO order. Replays that fail with a
// server error (4xx/5xx, i.e. a real conflict) are marked "failed" and surfaced
// to the user; network failures simply keep the item queued for the next try.

const DB_NAME = "hfos-offline";
const STORE = "queue";
const DB_VERSION = 1;

export interface QueuedWrite {
  id: number;
  method: string;
  path: string;
  body?: unknown;
  token: string | null;
  household: string | null;
  createdAt: number;
  status: "pending" | "failed";
  error?: string;
}

type Listener = () => void;
const listeners = new Set<Listener>();
export function onQueueChange(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of listeners) fn();
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

export async function enqueueWrite(entry: Omit<QueuedWrite, "id" | "createdAt" | "status">) {
  await tx("readwrite", (s) => s.add({ ...entry, createdAt: Date.now(), status: "pending" }));
  emit();
}

export async function listQueue(): Promise<QueuedWrite[]> {
  const all = await tx<QueuedWrite[]>("readonly", (s) => s.getAll());
  return (all ?? []).sort((a, b) => a.id - b.id);
}

export async function queueCount(): Promise<number> {
  return (await tx<number>("readonly", (s) => s.count())) ?? 0;
}

async function remove(id: number) {
  await tx("readwrite", (s) => s.delete(id));
  emit();
}

async function markFailed(id: number, error: string) {
  const item = await tx<QueuedWrite>("readonly", (s) => s.get(id));
  if (item) {
    await tx("readwrite", (s) => s.put({ ...item, status: "failed", error }));
    emit();
  }
}

export async function discardFailed() {
  const all = await listQueue();
  for (const it of all) if (it.status === "failed") await remove(it.id);
  emit();
}

let flushing = false;

/**
 * Replay queued writes in order. Returns {synced, failed}. A network error stops
 * the flush (still offline); a server error marks that item failed and continues.
 */
export async function flushQueue(base = process.env.NEXT_PUBLIC_API_BASE_URL || "/api"): Promise<{ synced: number; failed: number }> {
  if (flushing || typeof navigator === "undefined" || !navigator.onLine) return { synced: 0, failed: 0 };
  flushing = true;
  let synced = 0;
  let failed = 0;
  try {
    const items = (await listQueue()).filter((i) => i.status === "pending");
    for (const item of items) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (item.token) headers["Authorization"] = `Bearer ${item.token}`;
      if (item.household) headers["X-Household-Id"] = item.household;
      let res: Response;
      try {
        res = await fetch(`${base}${item.path}`, {
          method: item.method,
          headers,
          body: item.body != null ? JSON.stringify(item.body) : undefined,
        });
      } catch {
        break; // network dropped again — leave the rest queued
      }
      if (res.ok || res.status === 204) {
        await remove(item.id);
        synced += 1;
      } else {
        let detail = res.statusText;
        try { const b = (await res.json()) as { detail?: string }; detail = b.detail || detail; } catch { /* ignore */ }
        await markFailed(item.id, `${res.status}: ${detail}`);
        failed += 1;
      }
    }
  } finally {
    flushing = false;
  }
  if (synced > 0) window.dispatchEvent(new CustomEvent("hfos-sync", { detail: { synced, failed } }));
  return { synced, failed };
}

export function isOffline() {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

// Ask the service worker to drop cached API responses (called on logout).
export function clearApiCache() {
  navigator.serviceWorker?.controller?.postMessage("hfos-clear-api-cache");
}

let registered = false;
export function registerServiceWorker() {
  if (registered || typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  registered = true;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
  window.addEventListener("online", () => { flushQueue(); });
}
