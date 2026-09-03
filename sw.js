const CACHE_NAME = 'zus-kava-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
});

self.addEventListener('fetch', e => {
  // Pro GET požadavky zkusíme síť, při výpadku cache
  if (e.request.method === 'GET' && !e.request.url.includes('script.google.com')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
  }
});