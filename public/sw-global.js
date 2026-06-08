const CACHE_VERSION = 'sekolah-app-v2';
const CACHE_NAME = CACHE_VERSION;
const OFFLINE_URL = '/offline.html';

const PRECACHE_ASSETS = [
  '/',
  '/dashboard.html',
  '/login.html',
  '/offline.html',
  '/manifest.json',
  '/pwa-register.js',
  '/js/dashboard.js',
  '/css/style.css',
  '/assets/images/YPWI LOGO HITAM.png'
];

self.addEventListener('install', (event) => {
  console.log('[SW] Installing', CACHE_VERSION);
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Precaching assets');
        return cache.addAll(PRECACHE_ASSETS).catch((err) => {
          console.warn('[SW] Precaching failed for some assets:', err);
        });
      })
      .then(() => {
        console.log('[SW] Skip waiting');
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating', CACHE_VERSION);
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => {
            if (name === CACHE_NAME) return false;
            return name.startsWith('sekolah-app-') ||
                   name.startsWith('ypwi-') ||
                   name.startsWith('scanner-') ||
                   name.startsWith('quran-');
          })
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log('[SW] Claiming clients');
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') {
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  const isHTML = request.headers.get('accept')?.includes('text/html');
  const isAsset = /\.(css|js|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|webp|ico)$/i.test(url.pathname);

  if (isHTML) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            return caches.match(OFFLINE_URL).then((offlinePage) => {
              if (offlinePage) {
                return offlinePage;
              }
              return new Response('<h1>Offline</h1><p>Periksa koneksi internet Anda.</p>', {
                headers: { 'Content-Type': 'text/html' }
              });
            });
          });
        })
    );
    return;
  }

  if (isAsset) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(request).then((cachedResponse) => {
          const fetchPromise = fetch(request).then((networkResponse) => {
            cache.put(request, networkResponse.clone());
            return networkResponse;
          }).catch(() => {
            return cachedResponse || new Response('', { status: 408 });
          });
          return cachedResponse || fetchPromise;
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      return cachedResponse || fetch(request);
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Skip waiting requested');
    self.skipWaiting();
  }
});
