(function () {
  if (!('indexedDB' in window)) return;
  const DB_NAME = 'ypwi-auth';
  const DB_VERSION = 1;
  const STORE = 'sessions';

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  window.ypwi = window.ypwi || {};
  window.ypwi.authDb = {
    saveSession(data) {
      return open().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ id: 'session', ...data, savedAt: Date.now() });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      }));
    },
    loadSession() {
      return open().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get('session');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(tx.error);
      }));
    },
    clearSession() {
      return open().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete('session');
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      }));
    }
  };
})();