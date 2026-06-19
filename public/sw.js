/*
 * PWA Service Worker for YPWI Lutim
 * - Offline caching
 * - Background sync
 * - Push notifications
 */

const CACHE_VERSION = 'ypwi-v1';
const STATIC_ASSETS = [
  '/',
  '/login.html',
  '/dashboard.html',
  '/chat.html',
  '/manifest.json',
  '/styles.css',
  'https://cdn.jsdelivr.net/npm/sweetalert2@11',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    })
  );
});

self.addEventListener('push', (event) => {
  let payload = { title: 'YPWI Lutim', body: 'Anda memiliki pesan baru', icon: '/assets/images/YPWI LOGO HITAM.png', badge: '/assets/images/YPWI LOGO HITAM.png' };
  if (event.data) {
    try { payload = { ...payload, ...event.data.json() }; } catch {}
  }
  const options = {
    body: payload.body,
    icon: payload.icon,
    badge: payload.badge,
    vibrate: [100, 50, 100],
    data: payload.data || {},
    requireInteraction: false,
    actions: payload.actions || [
      { action: 'open_chat', title: 'Buka Chat', icon: '/assets/images/YPWI LOGO HITAM.png' },
      { action: 'dismiss', title: 'Tutup' }
    ]
  };
  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.action === 'open_chat' ? '/chat.html' : '/';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
    for (const client of clientList) { if (client.url.includes('/') && 'focus' in client) return client.focus(); }
    return clients.openWindow(url);
  }));
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: self.applicationServerKey })
      .then((subscription) => {
        return self.clients.matchAll().then((clientList) => {
          for (const client of clientList) {
            if (client.url.startsWith('http')) {
              return client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED', subscription });
            }
          }
        });
      })
  );
});