# PWA Update Button in Dashboard

## Goal
Add a "Check for Updates" button in dashboard.html that allows users to manually trigger a PWA update when new code is deployed, without needing to clear browser cache manually.

## Current State
- Service worker (`sw-global.js`) uses hardcoded `CACHE_VERSION = 'sekolah-app-v2'`
- SW listens for `SKIP_WAITING` message (line 128-130)
- No UI for users to trigger update

## Implementation Plan

### 1. Add Update Button to dashboard.html
**Location**: In `pc-action-header` (desktop) and `mobile-bottom-nav` (mobile)

**Desktop** (after ADMQU button, before Logout):
```html
<button id="pwaUpdateBtn" onclick="checkPwaUpdate()" title="Cek Update Aplikasi"
  style="display: inline-flex; align-items: center; gap: 0.5rem; background: #e0e7ff; color: #3730a3; padding: 0.6rem 1rem; border-radius: 0.5rem; font-weight: 600; font-size: 0.85rem; border: 1px solid #c7d2fe; cursor: pointer;">
  <i class="fas fa-sync-alt"></i> Update
</button>
<span id="pwaUpdateBadge" style="display:none; margin-left: 0.5rem; background: #22c55e; color: white; padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.7rem;">Baru</span>
```

**Mobile** (in `mobile-bottom-nav`, after Chat):
```html
<button id="mobilePwaUpdateBtn" onclick="checkPwaUpdate()" style="text-decoration: none; border: none; background: transparent; cursor: pointer; padding: 0;">
  <div style="text-align: center; color: #3730a3; cursor: pointer; -webkit-tap-highlight-color: transparent;">
    <i class="fas fa-sync-alt" style="font-size: 1.3rem; display: block; margin-bottom: 2px;"></i>
    <span style="font-size: 0.65rem; font-weight: 600;">Update</span>
  </div>
</button>
```

### 2. Add Update Logic to dashboard.js
```javascript
// Check for PWA update
async function checkPwaUpdate() {
  if (!('serviceWorker' in navigator)) {
    Swal.fire('Info', 'PWA tidak didukung di browser ini', 'info');
    return;
  }

  const registration = await navigator.serviceWorker.ready;
  
  // Check if there's a waiting SW
  if (registration.waiting) {
    promptReload();
    return;
  }

  // Check for updates
  try {
    await registration.update();
    
    if (registration.waiting) {
      promptReload();
    } else if (registration.installing) {
      // Wait for installing to finish
      registration.installing.addEventListener('statechange', () => {
        if (registration.waiting) promptReload();
      });
    } else {
      Swal.fire('Info', 'Aplikasi sudah versi terbaru', 'info');
    }
  } catch (err) {
    console.error('PWA update check failed:', err);
    Swal.fire('Error', 'Gagal cek update: ' + err.message, 'error');
  }
}

function promptReload() {
  Swal.fire({
    title: 'Update Tersedia',
    text: 'Versi baru aplikasi siap. Reload halaman untuk menerapkan update?',
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Reload Sekarang',
    cancelButtonText: 'Nanti',
    confirmButtonColor: '#3730a3'
  }).then((result) => {
    if (result.isConfirmed) {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
      }
      window.location.reload();
    }
  });
}

// Auto-check on page load (optional)
window.addEventListener('load', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // SW updated, could show toast
    });
    
    navigator.serviceWorker.ready.then(reg => {
      if (reg.waiting) {
        showUpdateBadge();
      }
    });
  }
});

function showUpdateBadge() {
  document.getElementById('pwaUpdateBadge')?.style.setProperty('display', 'inline-block');
  document.getElementById('mobilePwaUpdateBadge')?.style.setProperty('display', 'inline-block');
}
```

### 3. Optional: Auto Version Bump Script
Create a simple deploy script that increments `CACHE_VERSION` in `sw-global.js`:
```bash
# deploy.sh
#!/bin/bash
# Increment version
sed -i "s/CACHE_VERSION = 'sekolah-app-v[0-9]*'/CACHE_VERSION = 'sekolah-app-v$(date +%s)'/" public/sw-global.js
```

### 4. Add admqu.html to Precaching
Add `/admqu.html` and `/js/admqu.js` to `PRECACHE_ASSETS` in `sw-global.js` so they're cached on install.

## Files to Modify
1. `public/dashboard.html` - Add update buttons (desktop + mobile)
2. `public/js/dashboard.js` - Add update logic functions
3. `public/sw-global.js` - Add admqu.html/js to PRECACHE_ASSETS
4. Optional: `deploy.sh` - Version bump script

## Validation
- [ ] Button visible on desktop and mobile
- [ ] Clicking checks for SW update
- [ ] Shows "Update Tersedia" prompt when new SW waiting
- [ ] Reload applies new version
- [ ] Badge shows when update available on load
- [ ] Works in PWA standalone mode

## Out of Scope
- Automatic background update checks (can be added later with periodic sync)
- Forced update without user consent