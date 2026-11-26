# KAFALAH Settings: Per-Tenant with Global Toggle - Implementation Plan

## Executive Summary
Refactor KAFALAH settings from a `level` column (global/school) to a per-tenant `use_global` boolean flag. Each tenant ALWAYS has their own settings row in `kafalah_settings`. The global settings remain at `tenant_id IS NULL`. The `use_global` flag determines which settings are effective: when `true`, use global; when `false`, use tenant's own settings. This is per-tenant, not system-wide.

---

## Current State Analysis

| Aspect | Current Implementation | Desired Behavior |
|--------|----------------------|------------------|
| **Settings Storage** | `level` ENUM('global','school') + tenant row only exists when level='school' | Every tenant has a row; `use_global` BOOLEAN DEFAULT false |
| **Global Settings** | `tenant_id IS NULL, id=1` | Same: `tenant_id IS NULL, id=1` |
| **Tenant Settings** | Row created when switching to 'school' level | Row always exists (created on first access/tenant creation) |
| **Effective Settings** | `level='global'` → global, `level='school'` → local | `use_global=true` → global, `use_global=false` → local |
| **Switching Modes** | Loses local settings when switching to global | Preserves local settings when toggling global on/off |
| **Permission** | Only SDM Pusat can change `level` | SDM Pusat can change `use_global`; School bendahara can edit local settings |

---

## Database Changes

### 1. Modify `kafalah_settings` table
```sql
-- Add use_global column (replaces level concept for effective settings)
ALTER TABLE kafalah_settings 
ADD COLUMN use_global TINYINT(1) NOT NULL DEFAULT 0 
COMMENT '1 = use global settings, 0 = use own settings'
AFTER level;

-- Migrate existing data: if level='global' → use_global=1, else 0
UPDATE kafalah_settings SET use_global = CASE WHEN level = 'global' THEN 1 ELSE 0 END;

-- Keep level column for backward compatibility (optional, can be deprecated)
-- Or drop it after migration: ALTER TABLE kafalah_settings DROP COLUMN level;
```

### 2. Ensure every tenant has a settings row
```sql
-- Create settings rows for existing tenants that don't have one
INSERT IGNORE INTO kafalah_settings (tenant_id, use_global)
SELECT DISTINCT tenant_id, 0 
FROM tenants 
WHERE tenant_id NOT IN (SELECT tenant_id FROM kafalah_settings WHERE tenant_id IS NOT NULL);
```

---

## Backend Changes (`src/routes/kafalah.js`)

### 1. Update `resolveKafalahSettings()` function
```javascript
// Returns { useGlobal: boolean, settings: {...}, source: 'central'|'local' }
async function resolveKafalahSettings(tenantId) {
  // Get tenant's settings row (always exists)
  const tenantRows = await db.query(
    'SELECT * FROM kafalah_settings WHERE tenant_id = ? LIMIT 1',
    [tenantId]
  );
  
  // Get global settings (always exists)
  const globalRows = await db.query(
    'SELECT * FROM kafalah_settings WHERE tenant_id IS NULL AND id = 1 LIMIT 1'
  );
  const globalSettings = globalRows[0] || {};
  
  if (!tenantRows.length) {
    // Tenant row doesn't exist yet - create it with defaults from global
    const defaultSettings = { ...globalSettings };
    delete defaultSettings.id;
    delete defaultSettings.tenant_id;
    defaultSettings.tenant_id = tenantId;
    defaultSettings.use_global = 0;
    
    const cols = Object.keys(defaultSettings);
    const ph = cols.map(() => '?').join(',');
    await db.query(
      `INSERT INTO kafalah_settings (${cols.join(',')}) VALUES (${ph})`,
      Object.values(defaultSettings)
    );
    
    return { useGlobal: false, settings: defaultSettings, source: 'local' };
  }
  
  const tenantSettings = tenantRows[0];
  const useGlobal = Boolean(tenantSettings.use_global);
  
  return {
    useGlobal,
    settings: useGlobal ? globalSettings : tenantSettings,
    source: useGlobal ? 'central' : 'local'
  };
}
```

### 2. Update `getKafalahSettings()` function
```javascript
async function getKafalahSettings(tenantId = null) {
  if (!tenantId) {
    // Return global settings
    const rows = await db.query('SELECT * FROM kafalah_settings WHERE tenant_id IS NULL AND id = 1');
    return rows[0] || {};
  }
  
  // Return tenant's own settings row (not effective settings)
  const rows = await db.query('SELECT * FROM kafalah_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
  if (rows.length) return rows[0];
  
  // Create if not exists
  const globalSettings = await getKafalahSettings(null);
  const defaultSettings = { ...globalSettings };
  delete defaultSettings.id;
  defaultSettings.tenant_id = tenantId;
  defaultSettings.use_global = 0;
  
  const cols = Object.keys(defaultSettings);
  const ph = cols.map(() => '?').join(',');
  await db.query(
    `INSERT INTO kafalah_settings (${cols.join(',')}) VALUES (${ph})`,
    Object.values(defaultSettings)
  );
  return defaultSettings;
}
```

### 3. New endpoint: GET tenant's effective settings + toggle status
```javascript
router.get('/kafalah/settings/tenant', authenticateBendahara, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    if (!tenantId) return res.status(400).json({ success: false, message: 'tenant_id required' });
    
    if (!verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
    
    const { useGlobal, settings, source } = await resolveKafalahSettings(tenantId);
    const canManageGlobal = await canManageKafalahGlobal(req, tenantId);
    
    res.json({ 
      success: true, 
      data: { 
        use_global: useGlobal, 
        source, 
        can_manage_global: canManageGlobal,
        settings 
      } 
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
```

### 4. New endpoint: PUT toggle use_global (SDM Pusat only)
```javascript
router.put('/kafalah/settings/use-global', authenticateBendahara, async (req, res) => {
  try {
    const tenantId = req.body.tenant_id;
    const useGlobal = req.body.use_global === true || req.body.use_global === 1;
    
    if (!tenantId) return res.status(400).json({ success: false, message: 'tenant_id required' });
    
    const canManage = await canManageKafalahGlobal(req, tenantId);
    if (!canManage) {
      return res.status(403).json({ 
        success: false, 
        message: 'Hanya SDM Pusat/Admin Pusat yang dapat mengubah mode global KAFALAH' 
      });
    }
    
    // Ensure tenant row exists
    await db.query(
      `INSERT INTO kafalah_settings (tenant_id, use_global) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE use_global = VALUES(use_global)`,
      [tenantId, useGlobal ? 1 : 0]
    );
    
    res.json({ 
      success: true, 
      message: `Mode KAFALAH diubah ke ${useGlobal ? 'Global (Standar Pusat)' : 'Lokal (Pengaturan Sekolah)'}`,
      data: { use_global: useGlobal }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
```

### 5. Update PUT `/kafalah/settings/tenant` - allow editing local settings always
```javascript
// PUT settings (tenant-specific) - ALWAYS allowed, saves to tenant's own row
// The use_global flag determines which is EFFECTIVE, not which can be EDITED
router.put('/kafalah/settings/tenant', authenticateBendahara, async (req, res) => {
  try {
    const tenantId = req.body.tenant_id || req.query.tenant_id;
    if (!tenantId) return res.status(400).json({ success: false, message: 'tenant_id required' });
    
    if (!verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
    
    // ALWAYS allow editing tenant's own settings row
    // The effective settings depend on use_global flag
    const allFields = [...]; // all settings fields
    const fields = allFields.filter(f => req.body[f] !== undefined);
    if (fields.length === 0) return res.status(400).json({ success: false, message: 'Tidak ada field' });
    
    const vals = { tenant_id: tenantId };
    fields.forEach(f => { vals[f] = num(req.body[f]); });
    
    const set = fields.map(f => `${f}=?`).join(', ');
    await db.query(
      `INSERT INTO kafalah_settings (tenant_id, ${fields.join(',')}) VALUES (?, ${fields.map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE ${set}`,
      [tenantId, ...fields.map(f => vals[f]), ...fields.map(f => vals[f])]
    );
    res.json({ success: true, message: 'Pengaturan KAFALAH sekolah tersimpan' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
```

### 6. Update all calculation endpoints to use `resolveKafalahSettings()`
- `/kafalah/preview`
- `/kafalah/generate`
- `/kafalah/regenerate`
- `/kafalah/send-slip-whatsapp`

```javascript
// In each calculation endpoint:
const { settings, source } = await resolveKafalahSettings(tenant_id);
// Use settings for all calculations
// Store source in payroll.base_mode_used ('central' | 'local')
```

### 7. Permission helper for global toggle
```javascript
async function canManageKafalahGlobal(req, tenantId) {
  // Admin can manage all
  if (req.user.role === 'admin') return true;
  
  // Check if user has SDM assignment at YPWILUTIM (yayasan level)
  const assignments = req.user.assignments || [];
  const isSDMPusat = assignments.some(a => 
    a.tenant_id === 'YPWILUTIM' && 
    ['sdm', 'direktur', 'ketua', 'sdmpusat', 'pusat', 'sdm_pusat'].includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''))
  );
  
  return isSDMPusat;
}
```

---

## Frontend Changes (`public/sdm-dashboard.html` + `public/js/kafalah-bendahara.js`)

### 1. Update Settings Tab UI
Replace the level toggle with a "Use Global Settings" checkbox/toggle:

```html
<!-- In Pengaturan KAFALAH section (settingsTab) -->
<div id="kafalahGlobalToggleContainer" class="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
  <label class="flex items-center gap-3 cursor-pointer">
    <input type="checkbox" id="kafalahUseGlobalToggle" onchange="saveKafalahUseGlobal()" 
           class="w-5 h-5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500">
    <span class="text-sm font-medium text-gray-700">Gunakan Pengaturan Global (Standar Yayasan)</span>
  </label>
  <p id="kafalahGlobalNotice" class="hidden text-xs text-amber-600 mt-2 ml-6">
    <i class="fas fa-info-circle mr-1"></i> Menggunakan Standar Pengaturan Kafalah Pusat. 
    Pengaturan lokal sekolah tetap tersimpan dan akan dipakai saat toggle dimatikan.
  </p>
  <p id="kafalahGlobalLockNotice" class="hidden text-xs text-red-600 mt-2 ml-6">
    <i class="fas fa-lock mr-1"></i> Hanya SDM Pusat yang dapat mengubah toggle ini.
  </p>
</div>

<!-- Badge in KAFALAH tab (preview) -->
<span id="kafalahModeBadge" class="badge bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-sm"></span>
```

### 2. JavaScript: Load effective settings and toggle state
```javascript
window.loadKafalahSettingsContext = async function(tenantId) {
  if (!tenantId) return;
  
  try {
    const res = await fetch('/api/kafalah/settings/tenant?tenant_id=' + encodeURIComponent(tenantId), { headers: getAuthHeader() });
    const json = await res.json();
    if (!json.success) return;
    
    const { use_global, source, can_manage_global, settings } = json.data;
    
    // Update badge in KAFALAH tab
    const badge = document.getElementById('kafalahModeBadge');
    if (badge) {
      badge.textContent = use_global ? '🌐 Global (Standar Pusat)' : '🏫 Lokal (Pengaturan Sekolah)';
      badge.className = use_global ? 'badge bg-blue-100 text-blue-800' : 'badge bg-emerald-100 text-emerald-800';
    }
    
    // Update toggle
    const toggle = document.getElementById('kafalahUseGlobalToggle');
    if (toggle) {
      toggle.checked = use_global;
      toggle.disabled = !can_manage_global;
    }
    
    // Show/hide notices
    const notice = document.getElementById('kafalahGlobalNotice');
    const lockNotice = document.getElementById('kafalahGlobalLockNotice');
    if (notice) notice.style.display = use_global ? 'block' : 'none';
    if (lockNotice) lockNotice.style.display = (!can_manage_global && use_global) ? 'block' : 'none';
    
    // Load settings values into form (always show tenant's own settings)
    loadKafalahSettingsForm(settings);
    
  } catch (e) {
    console.error('loadKafalahSettingsContext error:', e);
  }
};

window.saveKafalahUseGlobal = async function() {
  const tenantId = getKafalahTenantId();
  const useGlobal = document.getElementById('kafalahUseGlobalToggle').checked;
  
  try {
    const res = await fetch('/api/kafalah/settings/use-global', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ tenant_id: tenantId, use_global: useGlobal })
    });
    const json = await res.json();
    if (json.success) {
      showToast(json.message, 'success');
      loadKafalahSettingsContext(tenantId);
    } else {
      // Revert toggle on error
      document.getElementById('kafalahUseGlobalToggle').checked = !useGlobal;
      showToast(json.message || 'Gagal', 'error');
    }
  } catch (e) {
    document.getElementById('kafalahUseGlobalToggle').checked = !useGlobal;
    showToast('Error: ' + e.message, 'error');
  }
};
```

### 3. Update `loadKafalahSettings()` to always show tenant's own settings
```javascript
window.loadKafalahSettings = async function (tenantId) {
  try {
    // Always fetch tenant's own settings row (not effective settings)
    const res = await fetch('/api/kafalah/settings/tenant?tenant_id=' + encodeURIComponent(tenantId), { headers: getAuthHeader() });
    const json = await res.json();
    if (!json.success) return;
    
    const s = json.data.settings || {};
    
    // Update info text
    const infoEl = document.getElementById('kafalahSettingsInfo');
    if (infoEl) {
      const sel = document.getElementById('kafalahSettingsTenantSelect') || document.getElementById('kafalahTenantSelect');
      const schoolName = sel?.selectedOptions[0]?.text || 'sekolah ini';
      if (json.data.use_global) {
        infoEl.innerHTML = '<i class="fas fa-info-circle mr-1"></i> Saat ini menggunakan <b>Pengaturan Global (Pusat)</b>. Pengaturan di bawah ini adalah pengaturan lokal <b>' + schoolName + '</b> yang tersimpan dan akan dipakai saat toggle Global dimatikan.';
      } else {
        infoEl.innerHTML = '<i class="fas fa-info-circle mr-1"></i> Menggunakan pengaturan lokal <b>' + schoolName + '</b>. Bisa diubah sewaktu-waktu.';
      }
    }
    
    // Fill form with tenant's own settings
    setVal('ksTunjStruktural', s.tunj_struktural);
    setVal('ksTunjPengabdian', s.tunj_pengabdian);
    // ... all other fields
    
  } catch (e) { console.error(e); }
};
```

### 4. Update `saveKafalahSettings()` - always save to tenant's row
```javascript
window.saveKafalahSettings = async function (e) {
  e.preventDefault();
  const tenantId = getKafalahTenantId();
  
  const fields = [...]; // all field mappings
  const body = { tenant_id: tenantId };
  fields.forEach(f => {
    const el = document.getElementById('ks' + f.split('_').map(s => s[0].toUpperCase() + s.slice(1)).join(''));
    if (el) body[f] = parseFloat(el.value || 0);
  });
  
  try {
    const res = await fetch('/api/kafalah/settings/tenant', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(body)
    });
    const json = await res.json();
    if (json.success) {
      showToast('Pengaturan KAFALAH sekolah tersimpan', 'success');
    } else showToast(json.message || 'Gagal', 'error');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
};
```

### 5. Update preview/generate to remove base_mode from requests
```javascript
window.previewKafalah = async function () {
  const tenantId = document.getElementById('kafalahTenantSelect').value;
  const period = getKafalahPeriod();
  if (!tenantId || !period) { showToast('Pilih sekolah & bulan', 'error'); return; }
  
  // REMOVE base_mode from request - backend auto-resolves from use_global
  const res = await fetch('/api/kafalah/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify({ tenant_id: tenantId, periode_mulai: start, periode_selesai: end, label_periode: label })
  });
  // ... rest same
};
```

---

## Migration Steps

1. **Run database migration** to add `use_global` column and seed data
2. **Deploy backend changes** (new endpoints, updated resolution logic)
3. **Deploy frontend changes** (new toggle UI, removed level badge)
4. **Verify** all existing schools have `use_global` set correctly (migrated from `level`)
5. **SDM Pusat** can now toggle per-school global mode

---

## Rollback Plan

If issues arise:
1. Revert frontend to use level badge/toggle
2. Revert backend to use `level` column with fallback to `use_global`
3. Keep both columns during transition period

---

## Testing Checklist

- [ ] School with `use_global=true` uses global settings, shows "Global" badge
- [ ] School with `use_global=false` uses local settings, shows "Lokal" badge
- [ ] SDM Pusat can toggle any school's global mode
- [ ] School bendahara CANNOT toggle global mode (checkbox disabled)
- [ ] School bendahara CAN edit local settings regardless of global toggle state
- [ ] Toggling global ON preserves local settings in database
- [ ] Toggling global OFF restores local settings immediately
- [ ] Payroll generation uses correct config based on `use_global`
- [ ] `base_mode_used` in `kafalah_payroll` correctly records 'central'/'local'
- [ ] Preview shows correct source badge
- [ ] All existing schools migrated correctly from `level` column

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/routes/kafalah.js` | Core logic: new `resolveKafalahSettings()`, new endpoints, updated calculations |
| `public/js/kafalah-bendahara.js` | UI: global toggle, badge, form loading/saving logic |
| `public/sdm-dashboard.html` | Settings tab: global toggle HTML, badge in KAFALAH tab |
| `public/bendahara-dashboard.html` | KAFALAH tab: badge showing effective mode |
| `public/school-admin.html` | KAFALAH tab: badge showing effective mode (read-only) |
| `migrations/2026_kafalah_use_global.sql` | New migration for `use_global` column |

---

## Out of Scope

- PDF slip generation (separate feature)
- Bulk WhatsApp sending enhancements (separate feature)
- Excel import for KAFALAH (separate feature)
- Historical payroll migration (existing data keeps its `base_mode_used`)