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

  window.ypwiSessionResume = async () => {
    try {
      const db = await open();
      const record = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get('session');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      if (!record || !record.token) return null;
      localStorage.setItem('token', record.token);
      if (record.user) localStorage.setItem('user', JSON.stringify(record.user));
      return record;
    } catch (e) { console.warn('Resume session failed', e); return null; }
  };

  window.ypwiSessionSave = async (data) => {
    try {
      const db = await open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ id: 'session', ...data, savedAt: Date.now() });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) { console.warn('Save session failed', e); }
  };

  window.ypwiSessionClear = async () => {
    try {
      const db = await open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete('session');
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    } catch (e) { console.warn('Clear session failed', e); }
  };
})();
