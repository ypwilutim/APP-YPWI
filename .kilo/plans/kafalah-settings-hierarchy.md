# KAFALAH Settings Hierarchy - UI Plan

## Goal
Add UI to manage and choose between 2-level BASE settings + Individual overrides:

**Base Setting (dipilih sekolah via radio):**
1. **Pengaturan Pusat (Global)** - Central admin defaults
2. **Pengaturan Sekolah (Tenant)** - School admin overrides

**Override Layer (selalu berlaku):**
3. **Pengaturan Individu (Teacher Override)** - Manual per-teacher, untuk 1-2 guru exception

## Current State
- `kafalah_settings` table: supports both global (tenant_id IS NULL) and tenant-specific
- `kafalah_teacher_overrides` table: per-teacher overrides (only 4 fields: struktural, pembina, pondok, apresiasi)
- Bendahara dashboard shows only global settings in "Pengaturan Pembayaran" tab
- No school-admin UI for KAFALAH settings
- WA Slip has "Pusat" (global+individu) and "Individu" modes, but no "Sekolah" mode

## Required Changes

### 0. Database Migration (NEW)
**File:** `server.js` migration or new migration file

**Table: `kafalah_teacher_overrides` - Expand fields + add `is_active` flag**
```sql
ALTER TABLE kafalah_teacher_overrides 
ADD COLUMN is_active TINYINT(1) DEFAULT 0,
ADD COLUMN tunj_transport DECIMAL(12,2) DEFAULT NULL,
ADD COLUMN tunj_tepat_waktu DECIMAL(12,2) DEFAULT NULL,
ADD COLUMN tunj_tidak_cepat_pulang DECIMAL(12,2) DEFAULT NULL,
ADD COLUMN tunj_uang_makan DECIMAL(12,2) DEFAULT NULL,
ADD COLUMN tunj_fungsional DECIMAL(12,2) DEFAULT NULL,
ADD COLUMN tunj_prestasi_kinerja DECIMAL(12,2) DEFAULT NULL,
ADD COLUMN tunj_apresiasi DECIMAL(12,2) DEFAULT NULL,  -- already exists
ADD COLUMN tunj_jam_mengajar DECIMAL(12,2) DEFAULT NULL,
ADD COLUMN tunj_pembina DECIMAL(12,2) DEFAULT NULL,    -- already exists
ADD COLUMN tunj_pondok DECIMAL(12,2) DEFAULT NULL,     -- already exists
ADD COLUMN tunj_struktural DECIMAL(12,2) DEFAULT NULL, -- already exists
ADD COLUMN tunj_istri DECIMAL(12,2) DEFAULT NULL,
ADD COLUMN tunj_anak DECIMAL(12,2) DEFAULT NULL,
ADD COLUMN nominal_kjm DECIMAL(12,2) DEFAULT NULL,
ADD COLUMN pot_luar_tanggungan DECIMAL(12,2) DEFAULT NULL,
ADD COLUMN pot_durasi_simt DECIMAL(12,2) DEFAULT NULL,
ADD COLUMN pot_taawun DECIMAL(12,2) DEFAULT NULL,
ADD COLUMN pot_piutang DECIMAL(12,2) DEFAULT NULL;
```
- `is_active = 1` → teacher uses override (NULL fields fall back to base)
- `is_active = 0` → teacher follows base setting (pusat/sekolah)
- **All fields NULLABLE** - only non-NULL values override base setting

### 1. Bendahara Dashboard (Pengaturan Pembayaran tab)
**File:** `public/bendahara-dashboard.html`

Add **radio toggle 2 mode** (BASE setting) above KAFALAH settings form:
```html
<div class="mb-4 p-3 bg-gray-50 rounded-lg">
  <label class="flex items-center gap-2">
    <input type="radio" name="kafalahBaseMode" value="pusat" id="modePusat" class="radio-radio">
    <span>Pengaturan Pusat (Global)</span>
  </label>
  <label class="flex items-center gap-2 ml-4">
    <input type="radio" name="kafalahBaseMode" value="sekolah" id="modeSekolah" class="radio-radio">
    <span>Pengaturan Sekolah</span>
  </label>
  <span class="ml-4 text-xs text-gray-500">* Individual override selalu berlaku di atas base setting</span>
</div>
```

- **Default**: "Sekolah" if tenant has settings, else "Pusat"
- When "Pusat" selected → load global settings (tenant_id IS NULL), hide tenant_id field
- When "Sekolah" selected → load tenant settings (tenant_id = current school), show tenant_id
- Individual overrides = separate table/modal with **toggle switch per teacher**

### 2. School Admin Dashboard (New KAFALAH Tab)
**File:** `public/school-admin.html`

Add new tab "Pengaturan KAFALAH" with same form fields but auto-fills tenant_id from logged-in school. Only "Sekolah" mode available (school manages their own settings).

### 3. Individual Overrides UI (NEW)
**File:** `public/bendahara-dashboard.html` + `public/js/kafalah-bendahara.js`

Add section below settings form:
```html
<div class="mt-6 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
  <h4 class="font-semibold mb-4">Individual Override (Exception per Guru)</h4>
  <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead class="bg-gray-50">
        <tr>
          <th class="px-3 py-2">Guru</th>
          <th class="px-3 py-2">
            <label class="flex items-center gap-2">
              <input type="checkbox" id="toggleAllOverrides">
              <span>Aktif</span>
            </label>
          </th>
          <th class="px-3 py-2">T. Struktural</th>
          <th class="px-3 py-2">T. Transport</th>
          <th class="px-3 py-2">T. Kedatangan</th>
          <th class="px-3 py-2">T. Tidak Cepat Pulang</th>
          <th class="px-3 py-2">T. Uang Makan</th>
          <th class="px-3 py-2">T. Fungsional</th>
          <th class="px-3 py-2">T. Prestasi</th>
          <th class="px-3 py-2">T. Apresiasi</th>
          <th class="px-3 py-2">T. Jam Mengajar</th>
          <th class="px-3 py-2">T. Pembina</th>
          <th class="px-3 py-2">T. Pondok</th>
          <th class="px-3 py-2">T. Istri</th>
          <th class="px-3 py-2">T. Anak</th>
          <th class="px-3 py-2">KJM/jam</th>
          <th class="px-3 py-2">Pot. Luar Tanggungan</th>
          <th class="px-3 py-2">Pot. SIM-T</th>
          <th class="px-3 py-2">Pot. Ta'awun</th>
          <th class="px-3 py-2">Pot. Piutang</th>
        </tr>
      </thead>
      <tbody id="teacherOverridesTable">
        <!-- populated by JS -->
      </tbody>
    </table>
  </div>
</div>
```
- Checkbox per row = `is_active` toggle
- Empty input = use base setting (kosongkan = tidak override)
- Isi input = override value
- "Toggle All" checkbox for bulk enable/disable

### 3. Backend API
**File:** `src/routes/kafalah.js`

- `GET /kafalah/settings?base=pusat|sekolah` - returns base settings (without individual overrides)
- `GET /kafalah/overrides?tenant_id=X` - returns individual overrides with `is_active` flag
- `PUT /kafalah/settings` - accepts `base` param (pusat/sekolah) to save to correct scope
- `PUT /kafalah/overrides/:teacherId` - save individual override (including `is_active`)

### 4. WA Slip Mode (2 base modes + individual override)
**File:** `src/routes/kafalah.js` + `public/js/kafalah-bendahara.js`

**2 Mode only** (base selection):
- **Pusat**: Global base + Individual override
- **Sekolah**: Tenant base + Individual override

Individual override is ALWAYS applied on top, not a separate mode.

### 5. Calculation Logic Update
**File:** `src/routes/kafalah.js` `computeKafalah()`

```javascript
// Current: const tunjStruktural = num(ov.tunj_struktural) || base;
// New:
const tunjStruktural = (ov.is_active && ov.tunj_struktural !== null) 
  ? num(ov.tunj_strukural) 
  : num(baseSettings.tunj_struktural);
```
Apply same pattern to ALL overrideable fields.

## Data Flow

```
Calculation:
1. Get BASE setting (based on school's choice: Pusat or Sekolah)
2. For each teacher:
   a. Check if ov.is_active = 1
   b. If YES: use override values (NULL = fallback to base)
   c. If NO: use base values entirely
3. Result = Base + Individual override (if active)
```

## UI Locations

| Role | Page | Tab |
|------|------|-----|
| Bendahara (Central) | bendahara-dashboard.html | Pengaturan Pembayaran → KAFALAH Settings |
| School Admin | school-admin.html | New: Pengaturan KAFALAH |

## Validation Rules
- School admin can only edit their own tenant settings (base = sekolah)
- Central admin can edit global + any tenant
- Individual overrides always take precedence when `is_active = 1`
- Deleting school setting → falls back to global
- Override field NULL = use base; Override field has value = use override

## Open Questions
1. Should "Pengaturan Sekolah" be visible to central bendahara for all schools?
2. Default radio selection logic: if school has settings → "Sekolah", else "Pusat"?
3. Should individual overrides table be inline or separate modal?