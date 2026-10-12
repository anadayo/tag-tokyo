const CACHE_NAME = "tag-tokyo-v044";
const BASE = self.location.pathname.replace(/\/sw\.js$/, "");
const APP_SHELL = [`${BASE}/`, `${BASE}/manifest.webmanifest`, `${BASE}/icon-192.png`];
const STATIC_DESTINATIONS = new Set(["style", "script", "worker", "font", "image", "manifest"]);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  const isStaticAsset = event.request.method === "GET"
    && requestUrl.origin === self.location.origin
    && requestUrl.search === ""
    && STATIC_DESTINATIONS.has(event.request.destination);

  if (!isStaticAsset) return;

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok && response.type === "basic") {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)));
    }
    return response;
  })));
});
