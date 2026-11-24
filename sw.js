const CACHE = 'ms-accounting-offline-v3';
const APP_FILES = ['./', './index.html', './manifest.json', './cloud.js', './firebase-config.js'];
const FIREBASE_ORIGIN = 'https://www.gstatic.com';
const FIREBASE_PREFIX = '/firebasejs/10.14.1/';
const FIREBASE_MODULES = [
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_FILES);
    await Promise.all(FIREBASE_MODULES.map(async url => {
      try { const response = await fetch(url, { mode: 'cors' }); if (response && response.ok) await cache.put(url, response.clone()); } catch (error) { /* Runtime fetch will retry when online. */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('ms-accounting-') && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === FIREBASE_ORIGIN && url.pathname.startsWith(FIREBASE_PREFIX)) {
    event.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response && (response.ok || response.type === 'opaque')) await cache.put(request, response.clone());
          return response;
        } catch (error) {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request).then(async response => {
        if (response && response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      }).catch(async () => {
        const cache = await caches.open(CACHE);
        return (await cache.match(request)) || (request.mode === 'navigate' ? await cache.match('./index.html') : Response.error());
      })
    );
  }
});
