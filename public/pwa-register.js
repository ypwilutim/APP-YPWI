/**
 * PWA Global Registration Script
 * Daftarkan di semua halaman HTML untuk install PWA dan update notification
 */

(function () {
  'use strict';

  const SW_PATH = '/sw-global.js';
  const UPDATE_PROMPT_ID = 'pwa-update-prompt';
  let deferredPrompt = null;
  let newWorker = null;

  function showUpdatePrompt() {
    if (document.getElementById(UPDATE_PROMPT_ID)) return;

    const prompt = document.createElement('div');
    prompt.id = UPDATE_PROMPT_ID;
    prompt.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #1f2937;
      color: white;
      padding: 12px 20px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      gap: 12px;
      z-index: 9999;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3);
      max-width: 90vw;
    `;

    const text = document.createElement('span');
    text.textContent = 'Ada pembaruan aplikasi tersedia';

    const reloadBtn = document.createElement('button');
    reloadBtn.textContent = 'Muat Ulang';
    reloadBtn.style.cssText = `
      background: #4CAF50;
      color: white;
      border: none;
      padding: 6px 14px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      font-size: 13px;
      white-space: nowrap;
    `;

    reloadBtn.addEventListener('click', () => {
      prompt.remove();
      if (newWorker) {
        newWorker.postMessage({ type: 'SKIP_WAITING' });
      }
      window.location.reload();
    });

    prompt.appendChild(text);
    prompt.appendChild(reloadBtn);
    document.body.appendChild(prompt);

    setTimeout(() => {
      if (prompt.parentNode) prompt.remove();
    }, 30000);
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      console.log('[PWA] Service Worker tidak didukung');
      return;
    }

    try {
      const registration = await navigator.serviceWorker.register(SW_PATH, {
        scope: '/'
      });

      console.log('[PWA] Service Worker terdaftar:', registration.scope);

      registration.addEventListener('updatefound', () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;

        installingWorker.addEventListener('statechange', () => {
          if (installingWorker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              console.log('[PWA] Versi baru tersedia');
              newWorker = installingWorker;
              showUpdatePrompt();
            } else {
              console.log('[PWA] Konten di-cache untuk offline');
            }
          }
        });
      });

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('[PWA] Controller berubah, SW baru aktif');
      });

      if (registration.waiting) {
        console.log('[PWA] SW menunggu, tampilkan prompt update');
        newWorker = registration.waiting;
        showUpdatePrompt();
      }

    } catch (error) {
      console.error('[PWA] Gagal mendaftar Service Worker:', error);
    }
  }

  async function handleBeforeInstall() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;

      const installBtn = document.getElementById('pwa-install-btn');
      if (installBtn) {
        installBtn.style.display = 'inline-flex';
        installBtn.addEventListener('click', async () => {
          installBtn.style.display = 'none';
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          console.log('[PWA] Install outcome:', outcome);
          deferredPrompt = null;
        });
      }
    });

    window.addEventListener('appinstalled', () => {
      console.log('[PWA] Aplikasi berhasil di-install');
      deferredPrompt = null;
      const installBtn = document.getElementById('pwa-install-btn');
      if (installBtn) installBtn.style.display = 'none';
    });
  }

  function showOnlineStatus() {
    const statusEl = document.getElementById('pwa-online-status');
    if (!statusEl) return;

    const updateStatus = () => {
      if (navigator.onLine) {
        statusEl.style.display = 'none';
      } else {
        statusEl.style.display = 'flex';
      }
    };

    updateStatus();
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      registerServiceWorker();
      handleBeforeInstall();
      showOnlineStatus();
    });
  } else {
    registerServiceWorker();
    handleBeforeInstall();
    showOnlineStatus();
  }
})();
