/*
 * Service worker: enough to install as an app and open offline.
 *
 * Hand written rather than generated, because the whole job is two rules and a plugin would be
 * more machinery than the problem needs.
 *
 * The shell is cached so the app opens with no network. API calls are never cached: a stale task
 * list is worse than an honest error, and the app already says plainly when it cannot reach the
 * backend.
 */

const CACHE = "cadence-shell-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Never cache the API. Showing yesterday's tasks as if they were today's would be a lie.
  if (url.pathname.startsWith("/api/") || url.port === "8000") return;

  // Navigations: network first so a deploy is picked up, cache as the offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/index.html").then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Everything else is a build asset with a hashed name, so cache first is safe.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok && url.origin === self.location.origin) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
