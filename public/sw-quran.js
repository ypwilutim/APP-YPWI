const CACHE_NAME = 'mushaf-digital-v3';
const OFFLINE_URL = '/offline.html';

const PRECACHE_ASSETS = [
  '/quran-reader.html',
  '/manifest-quran.json',
  '/js/dexie.js',
  '/js/dashboard.js',
  '/css/style.css',
  'https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Scheherazade+New:wght@400;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css',
  '/assets/images/YPWI LOGO HITAM.png'
];

self.addEventListener('install', (event) => {
  console.log('[SW-QURAN] Installing', CACHE_NAME);
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW-QURAN] Precaching assets');
        return cache.addAll(PRECACHE_ASSETS).catch((err) => {
          console.warn('[SW-QURAN] Precaching partial failure:', err);
        });
      })
      .then(() => {
        console.log('[SW-QURAN] Skip waiting');
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW-QURAN] Activating', CACHE_NAME);
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('mushaf-digital-') && name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW-QURAN] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log('[SW-QURAN] Claiming clients');
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  if (url.origin !== self.location.origin) {
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'cdnjs.cloudflare.com') {
      event.respondWith(
        caches.match(request).then((cached) => cached || fetch(request))
      );
      return;
    }
    return;
  }

  const isQuranImage = url.pathname.startsWith('/quran/') && /\.(png|jpg|jpeg|webp)$/i.test(url.pathname);
  const isHTML = request.headers.get('accept')?.includes('text/html');
  const isAsset = /\.(css|js|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|webp|ico)$/i.test(url.pathname);

  if (isQuranImage) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((response) => {
            cache.put(request, response.clone());
            return response;
          }).catch(() => {
            return new Response('', { status: 408 });
          });
        });
      })
    );
    return;
  }

  if (isHTML) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            if (cached) return cached;
            return caches.match(OFFLINE_URL);
          });
        })
    );
    return;
  }

  if (isAsset) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(request).then((cached) => {
          const fetchPromise = fetch(request).then((networkResponse) => {
            cache.put(request, networkResponse.clone());
            return networkResponse;
          }).catch(() => cached);
          return cached || fetchPromise;
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});