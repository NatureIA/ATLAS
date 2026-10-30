/* ATLAS PWA: only public static assets may be cached.
   Financial responses, navigation, authentication and user data are network-only. */
const CACHE_NAME = 'atlas-static-v4';
const STATIC_ASSETS = [
  '/css/site.css',
  '/js/site.js',
  '/js/pwa.js',
  '/manifest.webmanifest',
  '/icons/atlas-192.png',
  '/icons/atlas-512.png'
];

self.addEventListener('install', event => {
  // A transient failure of one asset must not prevent activation.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async cache => {
        await Promise.allSettled(STATIC_ASSETS.map(path => cache.add(path)));
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key =>
        key.startsWith('atlas-static-') && key !== CACHE_NAME
      ).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode === 'navigate') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin ||
      !STATIC_ASSETS.includes(url.pathname) ||
      request.headers.has('authorization')) return;

  event.respondWith(
    fetch(request).then(response => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, copy)));
      }
      return response;
    }).catch(() => caches.match(request))
  );
});
