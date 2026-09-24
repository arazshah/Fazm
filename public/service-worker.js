const CACHE_NAME = "fazm-shell-v1";
const SHELL_ASSETS = [
  "/",
  "/app.js",
  "/styles.css",
  "/logo.svg",
  "/favicon.svg",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-192-maskable.png",
  "/icons/icon-512-maskable.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // چت، تصویرها و صفحات اشتراک همیشه باید تازه و خصوصی بمانند؛ کش نمی‌شوند.
  if (isSameOrigin && (url.pathname.startsWith("/api/") || url.pathname.startsWith("/f/"))) {
    event.respondWith(fetch(request));
    return;
  }

  if (!isSameOrigin) {
    // فونت و منابع خارجی از کش سرویس‌ورکر مدیریت نمی‌شوند؛ کش HTTP خودِ مرورگر کافی است.
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          return response;
        })
        .catch(() => cached || (request.mode === "navigate" ? caches.match("/") : undefined));
      return cached || network;
    })
  );
});
