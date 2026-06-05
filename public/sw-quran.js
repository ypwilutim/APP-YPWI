const CACHE_NAME = 'mushaf-digital-v2';
const ASSETS = [
  'manifest-quran.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(err => {
      console.warn('Cache add failed:', err);
    })
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('quran/')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    }).catch(() => fetch(e.request))
  );
});