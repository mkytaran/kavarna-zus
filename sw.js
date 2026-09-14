const CACHE_NAME = "zuskafe-app-shell";

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json"
];

// Instalace - stáhne aktuální soubory s obchvatem HTTP cache prohlížeče
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        STATIC_ASSETS.map((url) => {
          return fetch(url, { cache: "no-cache" })
            .then((res) => {
              if (res.ok) return cache.put(url, res);
            })
            .catch((err) => console.warn("SW install cache failed for:", url, err));
        })
      );
    })
  );
});

// Aktivace - okamžité převzetí kontroly nad všemi klienty
self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Pročištění případných starých neplatných cache
      caches.keys().then((keys) => {
        return Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        );
      })
    ])
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") return;

  // 1. Google Apps Script API a QR server -> VŽDY NATIVNÍ SÍŤ
  if (
    url.hostname.includes("script.google.com") ||
    url.hostname.includes("googleusercontent.com") ||
    url.hostname.includes("api.qrserver.com")
  ) {
    return;
  }

  // 2. HTML dokument (Index) -> NETWORK-FIRST (s no-cache validací)
  if (request.mode === "navigate" || request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(request, { cache: "no-cache" })
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        })
        .catch(() => caches.match(request).then((res) => res || caches.match("./index.html")))
    );
    return;
  }

  // 3. Statické assety (CSS, JS) -> STALE-WHILE-REVALIDATE
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const networkUpdate = fetch(request, { cache: "no-cache" })
        .then(async (networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(CACHE_NAME);

            if (cachedResponse) {
              const oldEtag = cachedResponse.headers.get("ETag");
              const newEtag = networkResponse.headers.get("ETag");
              const oldModified = cachedResponse.headers.get("Last-Modified");
              const newModified = networkResponse.headers.get("Last-Modified");

              let hasChanged = false;

              if (newEtag && oldEtag) {
                hasChanged = oldEtag !== newEtag;
              } else if (newModified && oldModified) {
                hasChanged = oldModified !== newModified;
              } else {
                // Pojistka pro servery bez hlaviček: porovnání délky obsahu
                const oldLen = cachedResponse.headers.get("Content-Length");
                const newLen = networkResponse.headers.get("Content-Length");
                if (oldLen && newLen && oldLen !== newLen) {
                  hasChanged = true;
                }
              }

              if (hasChanged) {
                await cache.put(request, networkResponse.clone());
                await notifyClientsAboutUpdate();
                return networkResponse;
              }
            }
            await cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline provoz - tichý návrat
        });

      return cachedResponse || networkUpdate;
    })
  );
});

// Informuje všechny otevřené PWA instance včetně standalone oken na iOS
async function notifyClientsAboutUpdate() {
  const clients = await self.clients.matchAll({
    includeUncontrolled: true,
    type: "window"
  });

  clients.forEach((client) => {
    client.postMessage({ type: "ASSET_UPDATED" });
  });
}