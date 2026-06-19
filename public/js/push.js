(function () {
  const VAPID_PUBLIC_KEY = (typeof process !== 'undefined' && process.env && process.env.VAPID_PUBLIC_KEY) || '';

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  window.ypwiPush = {
    urlBase64ToUint8Array,
    register: async function () {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return null;
      try {
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
        return sub;
      } catch (e) {
        console.warn('Push subscribe failed:', e);
        return null;
      }
    },
    sendSubscriptionToServer: async function (subscription, token) {
      try {
        await fetch('/api/notifications/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(subscription)
        });
      } catch (e) {
        console.warn('Failed to save push subscription:', e);
      }
    }
  };
})();
