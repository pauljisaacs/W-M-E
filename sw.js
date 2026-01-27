const CACHE_NAME = 'wave-agent-x-v73';
const ASSETS = [
  './',
  './index.html',
  './user-guide.html',
  './style.css',
  './app.js',
  './metadata-handler.js',
  './audio-engine.js',
  './audio-processor.js',
  './mixer.js',
  './mixer-metadata.js',
  './file-io.js',
  './lame.min.js',
  './manifest.json',
  './favicon.ico',
  './icon-192.png',
  './icon-512.png'
];

// Install event - cache all assets
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Caching all assets');
        return cache.addAll(ASSETS);
      })
      .then(() => {
        console.log('[Service Worker] All assets cached');
        return self.skipWaiting(); // Activate immediately
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('[Service Worker] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('[Service Worker] Claiming clients');
        return self.clients.claim(); // Take control immediately
      })
  );
});

// Fetch event - CACHE FIRST strategy for offline support
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          // Return cached version immediately
          console.log('[Service Worker] Serving from cache:', event.request.url);
          return cachedResponse;
        }

        // Not in cache, try network
        console.log('[Service Worker] Fetching from network:', event.request.url);
        return fetch(event.request)
          .then((networkResponse) => {
            // Don't cache non-GET requests or non-ok responses
            if (event.request.method !== 'GET' || !networkResponse || networkResponse.status !== 200) {
              return networkResponse;
            }

            // Clone the response (can only be consumed once)
            const responseToCache = networkResponse.clone();

            // Cache the new resource for future offline use
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return networkResponse;
          })
          .catch((error) => {
            // Network failed and not in cache
            console.log('[Service Worker] Fetch failed, offline:', error);

            // If requesting an HTML page, return the cached index.html
            if (event.request.headers.get('accept').includes('text/html')) {
              return caches.match('./index.html');
            }

            // For other resources, return a simple offline response
            return new Response('Offline - Resource not available', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: new Headers({
                'Content-Type': 'text/plain'
              })
            });
          });
      })
  );
});
