# KAFALAH Central vs Local Toggle - Implementation Plan

## Executive Summary
Refactor KAFALAH to use a **per-tenant** `level` flag (global/school) in `kafalah_settings` instead of the current per-user `base_mode` preference. This ensures consistent behavior across all users of a school and enables proper read-only locking when central mode is active.

---

## Current State Analysis

| Aspect | Current Implementation | Required Behavior |
|--------|----------------------|-------------------|
| **Toggle Storage** | Per-user in `kafalah_base_mode` table | Per-tenant in `kafalah_settings.level` (already exists in DB) |
| **Backend Resolution** | `getBaseMode()` reads user preference | Auto-resolve from tenant's `level` column |
| **Frontend Toggle** | Sends `base_mode` in every request | Reads/writes tenant's `level`; locks UI when `level='global'` |
| **Permission** | Any bendahara can toggle | Only SDM Pusat/Admin Pusat can change school's `level` |

---

## Database Changes

### 1. Verify `kafalah_settings.level` column exists
```sql
-- Already added via migration 2026_kafalah_redesign.sql
-- ENUM('global','school') DEFAULT 'global'
-- Verify with: SHOW COLUMNS FROM kafalah_settings LIKE 'level';
```

### 2. Add index for performance
```sql
ALTER TABLE kafalah_settings ADD INDEX idx_level (level);
```

### 3. Seed default for existing schools
```sql
-- Schools without explicit settings get global level
UPDATE kafalah_settings SET level = 'global' WHERE level IS NULL;
```

---

## Backend Changes (`src/routes/kafalah.js`)

### 1. Remove per-user `kafalah_base_mode` dependency
- **Delete** `getBaseMode()` function (lines 183-211)
- **Delete** `/kafalah/base-mode` GET/PUT endpoints (lines 783-811)
- **Drop** `kafalah_base_mode` table (optional, after migration)

### 2. Add tenant-level resolution function
```javascript
// Returns { level: 'global'|'school', settings: {...}, source: 'central'|'local' }
async function resolveKafalahSettings(tenantId) {
  const rows = await db.query(
    'SELECT * FROM kafalah_settings WHERE tenant_id = ? LIMIT 1',
    [tenantId]
  );
  
  if (rows.length && rows[0].level === 'school') {
    // School has local settings - use them
    return { level: 'school', settings: rows[0], source: 'local' };
  }
  
  // Fallback to global settings (tenant_id IS NULL)
  const globalRows = await db.query(
    'SELECT * FROM kafalah_settings WHERE tenant_id IS NULL AND id = 1 LIMIT 1'
  );
  return { 
    level: 'global', 
    settings: globalRows[0] || {}, 
    source: 'central' 
  };
}
```

### 3. Add permission check for toggle changes
```javascript
async function canManageKafalahLevel(req, tenantId) {
  // SDM Pusat / Admin Pusat: can manage any school
  if (req.user.role === 'admin') return true;
  
  // Check if user has SDM assignment at YPWILUTIM (yayasan level)
  const assignments = req.user.assignments || [];
  const isSDMPusat = assignments.some(a => 
    a.tenant_id === 'YPWILUTIM' && 
    ['sdm', 'direktur', 'ketua'].includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''))
  );
  
  if (isSDMPusat) return true;
  
  // School bendahara: can ONLY view, cannot change level
  return false;
}
```

### 4. New endpoint: GET tenant's KAFALAH level (read-only for school)
```javascript
router.get('/kafalah/settings/level', authenticateBendahara, async (req, res) => {
  const tenantId = req.query.tenant_id || req.user.tenant_id;
  const { level, settings, source } = await resolveKafalahSettings(tenantId);
  const canManage = await canManageKafalahLevel(req, tenantId);
  res.json({ success: true, data: { level, source, can_manage: canManage, settings } });
});
```

### 5. New endpoint: PUT tenant's KAFALAH level (SDM Pusat only)
```javascript
router.put('/kafalah/settings/level', authenticateBendahara, async (req, res) => {
  const tenantId = req.body.tenant_id;
  const level = req.body.level; // 'global' | 'school'
  
  if (!['global', 'school'].includes(level)) {
    return res.status(400).json({ success: false, message: 'Invalid level' });
  }
  
  const canManage = await canManageKafalahLevel(req, tenantId);
  if (!canManage) {
    return res.status(403).json({ 
      success: false, 
      message: 'Hanya SDM Pusat/Admin Pusat yang dapat mengubah mode KAFALAH sekolah' 
    });
  }
  
  // Ensure settings row exists
  await db.query(
    `INSERT INTO kafalah_settings (tenant_id, level) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE level = VALUES(level)`,
    [tenantId, level]
  );
  
  res.json({ success: true, message: `Mode KAFALAH diubah ke ${level === 'global' ? 'Pusat' : 'Lokal'}`, data: { level } });
});
```

### 6. Update all calculation endpoints to use `resolveKafalahSettings()`
- `/kafalah/preview` (line 701)
- `/kafalah/generate` (line 717)
- `/kafalah/regenerate` (line 814)
- `/kafalah/send-slip-whatsapp` (line 1001)

Replace explicit `base_mode` parameter with automatic resolution:
```javascript
const { settings, source } = await resolveKafalahSettings(tenant_id);
// Use settings object for all calculations
// Store source in payroll.base_mode_used ('central' | 'local')
```

### 7. Update settings GET/PUT to respect level
- **GET `/kafalah/settings/tenant`**: Return `level` and `source` in response
- **PUT `/kafalah/settings/tenant`**: 
  - If `level === 'global'`, reject with 403: "Pengaturan dikunci: sekolah menggunakan standar pusat"
  - If `level === 'school'`, allow update

---

## Frontend Changes (`public/js/kafalah-bendahara.js`)

### 1. Replace `base_mode` toggle with `level` display
```javascript
// OLD: kafalahBaseToggle (checkbox sending base_mode)
// NEW: kafalahLevelBadge (read-only display for school, editable for SDM Pusat)

window.loadKafalahLevel = async function(tenantId) {
  const res = await fetch('/api/kafalah/settings/level?tenant_id=' + encodeURIComponent(tenantId), { headers: getAuthHeader() });
  const json = await res.json();
  if (!json.success) return;
  
  const { level, source, can_manage, settings } = json.data;
  
  // Update badge
  const badge = document.getElementById('kafalahLevelBadge');
  if (badge) {
    badge.textContent = level === 'global' ? '🌐 Pusat (Standar Yayasan)' : '🏫 Lokal (Khusus Sekolah)';
    badge.className = level === 'global' ? 'badge bg-blue-100 text-blue-800' : 'badge bg-emerald-100 text-emerald-800';
  }
  
  // Show/hide toggle control
  const toggleContainer = document.getElementById('kafalahLevelToggleContainer');
  if (toggleContainer) {
    toggleContainer.style.display = can_manage ? 'block' : 'none';
  }
  
  // Lock/unlock settings form
  const form = document.getElementById('kafalahSettingsForm');
  if (form) {
    const inputs = form.querySelectorAll('input, select, button[type="submit"]');
    inputs.forEach(el => {
      el.disabled = (level === 'global' && !can_manage);
    });
    
    // Show lock notice
    const notice = document.getElementById('kafalahLockNotice');
    if (notice) {
      notice.style.display = (level === 'global' && !can_manage) ? 'block' : 'none';
      notice.innerHTML = '<i class="fas fa-lock mr-1"></i> Menggunakan Standar Pengaturan Kafalah Pusat. Hanya SDM Pusat yang dapat mengubah mode ini.';
    }
  }
  
  // Load settings values (always show current effective settings)
  loadKafalahSettings(tenantId);
};
```

### 2. Add level toggle control (for SDM Pusat only)
```html
<!-- In settings tab HTML -->
<div id="kafalahLevelToggleContainer" class="hidden mb-4">
  <label class="block text-sm font-medium text-gray-700">Mode KAFALAH Sekolah:</label>
  <div class="flex items-center space-x-3 mt-1">
    <select id="kafalahLevelSelect" class="px-3 py-2 border border-gray-300 rounded-lg" onchange="saveKafalahLevel()">
      <option value="school">🏫 Lokal (Khusus Sekolah)</option>
      <option value="global">🌐 Pusat (Standar Yayasan)</option>
    </select>
    <span id="kafalahLevelSaveStatus" class="text-xs text-gray-500"></span>
  </div>
  <p id="kafalahLockNotice" class="hidden text-xs text-amber-600 mt-1">
    <i class="fas fa-lock mr-1"></i> Menggunakan Standar Pengaturan Kafalah Pusat.
  </p>
</div>

<!-- Badge in preview tab -->
<div id="kafalahLevelBadge" class="badge bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-sm"></div>
```

### 3. Save level (SDM Pusat only)
```javascript
window.saveKafalahLevel = async function() {
  const tenantId = getKafalahTenantId();
  const level = document.getElementById('kafalahLevelSelect').value;
  
  try {
    const res = await fetch('/api/kafalah/settings/level', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ tenant_id: tenantId, level })
    });
    const json = await res.json();
    if (json.success) {
      showToast(json.message, 'success');
      document.getElementById('kafalahLevelSaveStatus').textContent = 'Tersimpan ' + new Date().toLocaleTimeString('id-ID');
      loadKafalahLevel(tenantId);
    } else {
      showToast(json.message || 'Gagal', 'error');
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
};
```

### 4. Remove `base_mode` from preview/generate requests
```javascript
// In previewKafalah(), generateKafalah(), regenerateKafalah():
// REMOVE: baseMode = document.getElementById('kafalahBaseToggle')?.checked ? 'school' : 'global'
// REMOVE: base_mode from request body
// Backend now auto-resolves from tenant's level
```

### 5. Update preview/generate to show effective source
```javascript
// In preview response handler:
showToast(`Mode: ${json.source === 'central' ? 'Pusat (Standar Yayasan) 🌐' : 'Lokal (Khusus Sekolah) 🏫'}`, 'info');
```

---

## Permission Matrix

| Action | SDM Pusat / Admin Pusat | Bendahara Sekolah |
|--------|------------------------|-------------------|
| View school's KAFALAH level | ✅ | ✅ |
| Change school's KAFALAH level | ✅ | ❌ |
| Edit local settings (when level=school) | ✅ | ✅ |
| Edit local settings (when level=global) | ✅ | ❌ (read-only) |
| Generate payroll | ✅ | ✅ |
| View payroll history | ✅ | ✅ |

---

## Migration Steps

1. **Run migration** to ensure `level` column exists with defaults
2. **Deploy backend changes** (new endpoints, updated calculation logic)
3. **Deploy frontend changes** (new UI, removed base_mode toggle)
4. **Verify** all schools default to `level='global'` (central)
5. **SDM Pusat** manually switches schools to `level='school'` where needed

---

## Rollback Plan

If issues arise:
1. Revert frontend to use `kafalahBaseToggle` (keep `base_mode` in requests)
2. Revert backend to use `getBaseMode()` with fallback to `level` column
3. Keep `kafalah_base_mode` table until fully validated

---

## Testing Checklist

- [ ] School with `level='global'` shows locked settings, uses central config
- [ ] School with `level='school'` shows editable settings, uses local config
- [ ] SDM Pusat can toggle any school's level
- [ ] School bendahara CANNOT toggle level (403 response)
- [ ] Payroll generation uses correct config based on level
- [ ] `base_mode_used` in `kafalah_payroll` correctly records 'central'/'local'
- [ ] Preview shows correct source badge
- [ ] All existing schools default to global after migration

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/routes/kafalah.js` | Core logic changes (remove base_mode, add level endpoints, update calculations) |
| `public/js/kafalah-bendahara.js` | UI changes (level badge, lock notice, remove base_mode toggle) |
| `public/bendahara-dashboard.html` | Add level badge/toggle HTML in KAFALAH tab |
| `public/sdm-dashboard.html` | Add level management UI for SDM Pusat |
| `public/school-admin.html` | Add level badge (read-only) |
| `migrations/2026_kafalah_ensure_level.sql` | New migration to verify/seed level column |

---

## Out of Scope

- PDF slip generation (separate feature)
- Bulk WhatsApp sending enhancements (separate feature)
- Excel import for KAFALAH (separate feature)
- Historical payroll migration (existing data keeps its `base_mode_used`)

---

# Guru Khusus / Individual Kafalah Override - Implementation Plan

## Executive Summary
Enable per-teacher custom override of specific KAFALAH components (tunjangan, potongan, gaji pokok) for "Guru Khusus" (guest lecturers, experts, senior ustadz) who don't follow standard schemes. Uses existing `kafalah_teacher_overrides` table with `is_active` flag as the marker.

---

## Current State Analysis

| Aspect | Current Implementation | Required Behavior |
|--------|----------------------|-------------------|
| **Override Storage** | `kafalah_teacher_overrides` table with 18 nullable fields + `is_active` | Already complete - supports partial override of any component |
| **Override Resolution** | `getOverrides()` + `getOverrideValue()` in computeKafalah | Already works - applies override when `is_active=1` |
| **Guru Khusus Marker** | Implicit: teacher with active override entry | Make explicit in UI with "Guru Khusus" badge/tag |
| **Audit Trail** | `is_manual_edit` + `base_mode_used` in payroll | Add `override_note` text field to record which components were custom |
| **Permissions** | Both endpoints exist but no permission check | School bendahara manages own school; SDM Pusat manages all |

---

## Database Changes

### 1. Add audit note column to `kafalah_payroll`
```sql
-- Track which components used custom override for transparency
ALTER TABLE kafalah_payroll 
ADD COLUMN override_note TEXT DEFAULT NULL 
COMMENT 'JSON/notes: which components used custom override, e.g. "tunj_struktural, tunj_transport: custom override applied"'
AFTER base_mode_used;
```

### 2. Ensure `kafalah_teacher_overrides` has all required fields
```sql
-- Already complete per 000_full_structure.sql lines 624-650
-- Has: is_active, all 18 override fields (nullable), UNIQUE(teacher_id, tenant_id)
-- No changes needed
```

---

## Backend Changes (`src/routes/kafalah.js`)

### 1. Enhance `computeKafalah()` to build override audit note
```javascript
// In computeKafalah(), after calculating each teacher's row:
const ov = overrides[t.id] || {};
let overrideComponents = [];

if (ov.is_active) {
  // Check which override fields are actually set (non-null)
  const overrideFields = [
    'tunj_struktural', 'tunj_pembina', 'tunj_pondok', 'tunj_apresiasi',
    'tunj_transport', 'tunj_tepat_waktu', 'tunj_tidak_cepat_pulang',
    'tunj_uang_makan', 'tunj_fungsional', 'tunj_prestasi_kinerja',
    'tunj_jam_mengajar', 'tunj_istri', 'tunj_anak', 'nominal_kjm',
    'pot_luar_tanggungan', 'pot_durasi_simt', 'pot_taawun', 'pot_piutang'
  ];
  
  overrideFields.forEach(f => {
    if (ov[f] !== null && ov[f] !== undefined) {
      overrideComponents.push(f);
    }
  });
}

// Add to row object:
override_note: overrideComponents.length > 0 
  ? `Override components: ${overrideComponents.join(', ')}` 
  : null,
is_custom_scheme: overrideComponents.length > 0 ? 1 : 0,
```

### 2. Update payroll INSERT to include override_note
```javascript
// In generate/regenerate endpoints, add to INSERT:
override_note: r.override_note || null,
// Column already added via migration above
```

### 3. Add permission check to override endpoints
```javascript
async function canManageTeacherOverrides(req, tenantId) {
  // SDM Pusat / Admin Pusat: can manage any school
  if (req.user.role === 'admin') return true;
  
  // Check if user has SDM assignment at YPWILUTIM
  const assignments = req.user.assignments || [];
  const isSDMPusat = assignments.some(a => 
    a.tenant_id === 'YPWILUTIM' && 
    ['sdm', 'direktur', 'ketua'].includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''))
  );
  
  if (isSDMPusat) return true;
  
  // School bendahara: can manage own school only
  const userTenantId = req.user.tenant_id || 
    (req.user.assignments?.find(a => a.is_paid)?.tenant_id);
  return userTenantId === tenantId;
}
```

### 4. Apply permission to existing override endpoints
```javascript
// GET /kafalah/overrides - add tenant access check
// PUT /kafalah/overrides/:teacherId - add canManageTeacherOverrides check
// GET /kafalah/teachers - already filtered by tenant
```

---

## Frontend Changes (`public/js/kafalah-bendahara.js`)

### 1. Add "Guru Khusus" Management UI in Settings Tab
```html
<!-- In KAFALAH Settings tab, after main settings form -->
<div class="mt-6 border-t pt-4">
  <h4 class="font-medium text-gray-900 mb-3 flex items-center gap-2">
    <i class="fas fa-user-cog text-emerald-600"></i>
    Guru Khusus (Custom Override)
  </h4>
  <p class="text-xs text-gray-500 mb-3">
    Set komponen KAFALAH custom untuk guru tertentu (guru tamu, pakar, ustadz senior).
    Komponen yang tidak diisi akan menggunakan standar sekolah/pusat.
  </p>
  
  <div class="mb-3">
    <label class="block text-sm font-medium text-gray-700 mb-1">Pilih Guru:</label>
    <select id="overrideTeacherSelect" class="w-full md:w-1/2 px-3 py-2 border border-gray-300 rounded-lg" onchange="loadTeacherOverride()">
      <option value="">-- Pilih Guru --</option>
    </select>
  </div>
  
  <div id="overrideFormContainer" class="hidden">
    <div class="bg-gray-50 p-4 rounded-lg mb-3">
      <div class="flex items-center justify-between mb-3">
        <span id="overrideTeacherName" class="font-medium"></span>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" id="overrideIsActive" onchange="toggleOverrideForm()">
          <span>Aktifkan Override Custom (Guru Khusus)</span>
        </label>
      </div>
      
      <div id="overrideFields" class="grid grid-cols-1 md:grid-cols-2 gap-3" style="display: none;">
        <!-- Generated dynamically from OVERRIDE_FIELDS -->
      </div>
    </div>
    <button onclick="saveTeacherOverride()" class="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
      <i class="fas fa-save mr-1"></i> Simpan Override
    </button>
  </div>
  
  <div class="mt-4">
    <h5 class="font-medium text-gray-700 mb-2">Daftar Guru Khusus Aktif:</h5>
    <div id="activeOverridesList" class="space-y-2"></div>
  </div>
</div>
```

### 2. Load teacher list for override selection
```javascript
window.loadOverrideTeacherList = async function(tenantId) {
  const res = await fetch('/api/kafalah/teachers?tenant_id=' + encodeURIComponent(tenantId), { headers: getAuthHeader() });
  const json = await res.json();
  if (!json.success) return;
  
  const select = document.getElementById('overrideTeacherSelect');
  select.innerHTML = '<option value="">-- Pilih Guru --</option>' + 
    json.data.map(t => `<option value="${t.id}">${t.nama}</option>`).join('');
};
```

### 3. Load/edit teacher override
```javascript
window.loadTeacherOverride = async function() {
  const teacherId = document.getElementById('overrideTeacherSelect').value;
  if (!teacherId) { 
    document.getElementById('overrideFormContainer').classList.add('hidden');
    return; 
  }
  
  const tenantId = getKafalahTenantId();
  const res = await fetch('/api/kafalah/overrides?tenant_id=' + encodeURIComponent(tenantId), { headers: getAuthHeader() });
  const json = await res.json();
  if (!json.success) return;
  
  const ov = json.data[teacherId] || {};
  const container = document.getElementById('overrideFormContainer');
  container.classList.remove('hidden');
  
  document.getElementById('overrideTeacherName').textContent = document.getElementById('overrideTeacherSelect').selectedOptions[0].text;
  document.getElementById('overrideIsActive').checked = !!ov.is_active;
  
  // Generate fields
  const fieldsHtml = OVERRIDE_FIELDS.map(f => {
    const label = f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const value = ov[f] !== null && ov[f] !== undefined ? ov[f] : '';
    const placeholder = ov[f] === null || ov[f] === undefined ? ' (standar)' : '';
    return `
      <div>
        <label class="block text-xs font-medium text-gray-600 mb-1">${label}${placeholder}</label>
        <input type="number" name="${f}" value="${value || ''}" step="1000" min="0" 
          class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm ${ov[f] === null ? 'bg-gray-50' : ''}"
          placeholder="Kosong = gunakan standar">
      </div>
    `;
  }).join('');
  
  document.getElementById('overrideFields').innerHTML = fieldsHtml;
  document.getElementById('overrideFields').style.display = ov.is_active ? 'grid' : 'none';
};

window.toggleOverrideForm = function() {
  const active = document.getElementById('overrideIsActive').checked;
  document.getElementById('overrideFields').style.display = active ? 'grid' : 'none';
};
```

### 4. Save teacher override
```javascript
window.saveTeacherOverride = async function() {
  const teacherId = document.getElementById('overrideTeacherSelect').value;
  const tenantId = getKafalahTenantId();
  const isActive = document.getElementById('overrideIsActive').checked;
  
  const fields = { is_active: isActive ? 1 : 0 };
  document.querySelectorAll('#overrideFields input[name]').forEach(input => {
    const val = input.value.trim();
    if (val !== '') fields[input.name] = parseFloat(val);
  });
  
  try {
    const res = await fetch('/api/kafalah/overrides/' + teacherId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ ...fields, tenant_id: tenantId })
    });
    const json = await res.json();
    if (json.success) {
      showToast('Override guru tersimpan', 'success');
      loadTeacherOverride();
      loadActiveOverridesList();
    } else showToast(json.message || 'Gagal', 'error');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
};
```

### 5. Show active overrides list
```javascript
window.loadActiveOverridesList = async function() {
  const tenantId = getKafalahTenantId();
  const res = await fetch('/api/kafalah/overrides?tenant_id=' + encodeURIComponent(tenantId), { headers: getAuthHeader() });
  const json = await res.json();
  if (!json.success) return;
  
  const active = Object.values(json.data).filter(o => o.is_active);
  const list = document.getElementById('activeOverridesList');
  
  if (active.length === 0) {
    list.innerHTML = '<p class="text-sm text-gray-500">Tidak ada guru khusus aktif.</p>';
    return;
  }
  
  list.innerHTML = active.map(o => `
    <div class="flex items-center justify-between p-2 bg-emerald-50 rounded border border-emerald-100">
      <div>
        <span class="font-medium">${o.nama}</span>
        <span class="text-xs text-gray-500 ml-2">(ID: ${o.teacher_id})</span>
      </div>
      <span class="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">Guru Khusus</span>
    </div>
  `).join('');
};
```

### 6. Show "Guru Khusus" badge in preview table
```javascript
// In renderKafalahTable(), add badge for teachers with active override:
const ov = overrides[r.teacher_id] || {};
const isCustom = ov.is_active && Object.values(ov).some((v, k) => k !== 'is_active' && k !== 'teacher_id' && k !== 'tenant_id' && k !== 'updated_at' && v !== null);
<td class="px-2 py-1">${kafalahEsc(r.nama)} ${isCustom ? '<span class="ml-1 text-xs bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">Khusus</span>' : ''}</td>
```

---

## Permission Matrix (Extended)

| Action | SDM Pusat / Admin Pusat | Bendahara Sekolah |
|--------|------------------------|-------------------|
| View override list | ✅ (all schools) | ✅ (own school) |
| Create/edit override | ✅ (all schools) | ✅ (own school) |
| Delete override | ✅ (all schools) | ✅ (own school) |
| View override in preview | ✅ | ✅ |

---

## Migration Steps

1. **Run migration** to add `override_note` column to `kafalah_payroll`
2. **Deploy backend changes** (permission checks, audit note generation)
3. **Deploy frontend changes** (Guru Khusus management UI)
4. **Verify** existing overrides still work with new UI

---

## Testing Checklist

- [ ] School bendahara can create override for teacher in their school
- [ ] School bendahara CANNOT create override for teacher in other school (403)
- [ ] SDM Pusat can create override for any school
- [ ] Override applies correctly in preview/generate (partial components)
- [ ] Non-overridden components use standard (central/local) calculation
- [ ] `override_note` in payroll shows which components were custom
- [ ] "Guru Khusus" badge appears in preview table
- [ ] Active overrides list shows correctly
- [ ] Disabling override (`is_active=0`) reverts to standard calculation

---

## Files to Modify (Extended)

| File | Changes |
|------|---------|
| `src/routes/kafalah.js` | Add permission checks, override_note generation in computeKafalah |
| `public/js/kafalah-bendahara.js` | Add Guru Khusus management UI (load/save/list) |
| `public/bendahara-dashboard.html` | Add override UI HTML in KAFALAH Settings tab |
| `public/sdm-dashboard.html` | Add override UI for SDM Pusat (cross-school) |
| `migrations/2026_kafalah_override_note.sql` | Add override_note column to kafalah_payroll |