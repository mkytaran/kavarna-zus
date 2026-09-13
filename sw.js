const CACHE_NAME = "zuskafe-app-shell";

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
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
            .catch(() => {});
        })
      );
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") return;

  // 1. Google Sheets / Apps Script API a externí QR kód -> VŽDY NATIVNÍ SÍŤ
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

  // 3. Statické assety (CSS, JS, obrázky) -> STALE-WHILE-REVALIDATE
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      // Dotaz na pozadí ověřující ETag/datum změny na serveru
      const networkUpdate = fetch(request, { cache: "no-cache" })
        .then(async (networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            
            // Detekce, zda se soubor skutečně změnil oproti cache
            if (cachedResponse) {
              const oldEtag = cachedResponse.headers.get("ETag");
              const newEtag = networkResponse.headers.get("ETag");
              const oldModified = cachedResponse.headers.get("Last-Modified");
              const newModified = networkResponse.headers.get("Last-Modified");

              const hasChanged = (newEtag && oldEtag !== newEtag) || 
                                 (newModified && oldModified !== newModified);

              if (hasChanged) {
                await cache.put(request, networkResponse.clone());
                // Upozorníme aplikaci na změnu klíčového skriptu/stylu
                notifyClientsAboutUpdate();
                return networkResponse;
              }
            }
            await cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline stav ignorujeme
        });

      // Vrátíme okamžitě z cache, pokud máme; jinak čekáme na síť
      return cachedResponse || networkUpdate;
    })
  );
});

// Informuje všechny otevřené záložky/PWA okna
async function notifyClientsAboutUpdate() {
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({ type: "ASSET_UPDATED" });
  });
}