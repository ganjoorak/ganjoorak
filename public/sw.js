// Registered as /sw.js?v=<build id>, so every deploy installs a new worker
// with its own cache and activation drops the previous deploy's cache.
const BUILD_ID = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE_VERSION = `ganjoorak-${BUILD_ID}`;
// Only cheap static pages: precaching runs on the first visit, next to the feed's own requests.
// Pages that render upstream data (/poets, /today) are still cached on navigation by the fetch
// handler below.
const APP_SHELL = [
  "/",
  "/saved",
  "/faq",
  "/updates",
  "/manifest.json",
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

const isCacheable = (request, pathname) =>
  request.mode === "navigate" ||
  pathname.endsWith(".css") ||
  pathname.endsWith(".js") ||
  APP_SHELL.includes(pathname);

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (requestUrl.pathname.startsWith("/api/")) {
    return;
  }

  if (!isCacheable(event.request, requestUrl.pathname)) {
    return;
  }

  // Network first: always serve the current deploy; the cache is only the
  // offline fallback.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const cloned = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, cloned));
        }
        return response;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then((cachedResponse) => cachedResponse || Response.error()),
      ),
  );
});
