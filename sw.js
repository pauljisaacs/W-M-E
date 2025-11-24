const CACHE_NAME = 'wav-player-v2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './metadata-handler.js',
  './audio-engine.js',
  './mixer.js',
  './file-io.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting(); // Force activation
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim()); // Take control immediately
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        return response || fetch(event.request).catch(() => {
          // Return 404 or fallback for missing assets
          return new Response('Not found', { status: 404 });
        });
      })
  );
});
