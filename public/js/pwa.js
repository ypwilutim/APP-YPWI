(function () {
  if (!('indexedDB' in window)) return;
  const DB_NAME = 'ypwi-auth';
  const STORE = 'sessions';

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  window.ypwi = window.ypwi || {};
  window.ypwi.session = {
    save: async (data) => {
      try {
        const db = await open();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put({ id: 'session', ...data, savedAt: Date.now() });
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
      } catch (e) { console.warn('IDB save failed', e); }
    },
    load: async () => {
      try {
        const db = await open();
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, 'readonly');
          const req = tx.objectStore(STORE).get('session');
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(tx.error);
        });
      } catch (e) { console.warn('IDB load failed', e); return null; }
    },
    clear: async () => {
      try {
        const db = await open();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).delete('session');
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
      } catch (e) { console.warn('IDB clear failed', e); }
    }
  };

  async function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      console.log('[PWA] SW registered', reg.scope);
      const session = await window.ypwi.session.load();
      if (session?.token) {
        const sub = await reg.pushManager.getSubscription();
        if (!sub && 'Notification' in window && Notification.permission === 'granted') {
          try {
            const vapidKey = (window.__VAPID_PUBLIC_KEY__ || '');
            if (vapidKey) {
              const converted = Uint8Array.from(atob(vapidKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
              const newSub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: converted });
              await fetch('/api/notifications/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }, body: JSON.stringify(newSub) });
            }
          } catch (e) { console.warn('[PWA] Push subscribe failed', e); }
        }
      }
    } catch (e) { console.warn('[PWA] SW registration failed', e); }
  }

  window.ypwi.notifications = {
    request: async () => {
      if (!('Notification' in window)) return 'unsupported';
      if (Notification.permission === 'granted') return 'granted';
      return Notification.requestPermission();
    },
    send: async (title, options) => {
      if ('serviceWorker' in navigator && 'Notification' in window && Notification.permission === 'granted') {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg && reg.showNotification) reg.showNotification(title, options);
      } else if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, options);
      }
    }
  };

  registerSW();
  window.__VAPID_PUBLIC_KEY__ = '';
})();
