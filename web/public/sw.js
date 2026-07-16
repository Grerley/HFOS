/* HFOS service worker — offline shell + read caching.
 *
 * Strategy:
 *   · Static assets (/_next/static, icons, manifest): cache-first (immutable).
 *   · Navigations: network-first, fall back to the cached page, then to a
 *     cached app shell so the SPA still boots offline.
 *   · GET /api/*: network-first; on success cache the response, on failure
 *     serve the last cached copy so views render with last-synced data.
 *     Cache is keyed per household so switching households never crosses data.
 *   · Non-GET /api/*: never handled here — the app-level write queue owns
 *     offline mutations (see lib/offline.ts).
 */
const VERSION = "hfos-v1";
const STATIC_CACHE = `${VERSION}-static`;
const API_CACHE = `${VERSION}-api`;
const SHELL_CACHE = `${VERSION}-shell`;
const SHELL_URLS = ["/dashboard", "/login"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_URLS).catch(() => undefined)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

// Allow the app to clear cached API data (e.g. on logout).
self.addEventListener("message", (event) => {
  if (event.data === "hfos-clear-api-cache") {
    caches.delete(API_CACHE);
  }
});

function apiCacheKey(request) {
  // Key API entries by URL + active household so caches never bleed across them.
  const hh = request.headers.get("X-Household-Id") || "none";
  const url = new URL(request.url);
  url.searchParams.set("__hh", hh);
  return new Request(url.toString(), { method: "GET" });
}

async function networkFirstApi(request) {
  const cache = await caches.open(API_CACHE);
  const key = apiCacheKey(request);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(key);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("X-HFOS-Offline", "cache");
      return new Response(cached.body, { status: cached.status, headers });
    }
    return new Response(JSON.stringify({ detail: "Offline and no cached data available." }), {
      status: 503,
      headers: { "Content-Type": "application/json", "X-HFOS-Offline": "miss" },
    });
  }
}

async function networkFirstNav(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    return (await cache.match(request)) || (await cache.match("/dashboard")) ||
      new Response("You are offline.", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // writes are handled by the app queue
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirstApi(request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirstNav(request));
    return;
  }
  if (url.pathname.startsWith("/_next/static") || url.pathname.startsWith("/icon") ||
      url.pathname.startsWith("/apple-icon") || url.pathname.endsWith(".png") ||
      url.pathname.endsWith(".webmanifest") || url.pathname === "/logo-full.png") {
    event.respondWith(cacheFirst(request));
  }
});
