# KAFALAH Redesign Plan

## Executive Summary
Redesign sistem KAFALAH dengan arsitektur hierarki pengaturan yang jelas: **Global (Pusat)** vs **Sekolah (Tenant)**, toggle base setting yang persist, perhitungan otomatis dengan load-from-DB-first, manual edit via modal, dan mekanisme re-calculation.

---

## 1. Arsitektur Settings Hierarchy

### 1.1 Tabel Settings (Existing: `kafalah_settings`)
| Kolom | Deskripsi |
|-------|-----------|
| `tenant_id` | NULL = Global/Pusat, `"SEKOLAH_ID"` = Per Sekolah |
| `setting_name` | Nama setting (tunj_struktural, gaji_pokok_base, dll) |
| `setting_value` | Nilai numerik |
| `level` | 'global' \| 'school' (untuk klarifikasi) |

**Perubahan:** Tambah kolom `level ENUM('global','school')` untuk eksplisit.

### 1.2 Tabel Gaji Pokok (New: `kafalah_gaji_pokok_config`)
| Kolom | Deskripsi |
|-------|-----------|
| `id` | PK |
| `tenant_id` | NULL = Global, sekolah_id = Per Sekolah |
| `status_pegawai` | 'PT' \| 'PK' |
| `jenjang` | 'TK' \| 'SD' \| 'SMP' \| 'SMA' \| 'PONPES' |
| `pendidikan` | 'SMA' \| 'D3' \| 'S1' \| 'S2' \| 'S3' |
| `gaji_pokok_base` | DECIMAL(12,2) - gaji pokok tahun 0-2 |
| `kenaikan_per_tahun` | DECIMAL(12,2) |
| `interval_tahun` | INT |
| `masa_kerja_max` | INT |
| `updated_at` | TIMESTAMP |

### 1.3 Tabel Struktural per Jabatan (Existing: `kafalah_jabatan_tunjangan`)
Tetap dipakai, tipe per jabatan. Bisa di-override per sekolah via `kafalah_settings` (tunj_struktural).

---

## 2. Toggle Base Setting Persistence

### 2.1 Lokasi Penyimpanan
Tabel baru: `kafalah_base_mode`
```sql
CREATE TABLE kafalah_base_mode (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,              -- bendahara yang set
  tenant_id VARCHAR(50),             -- NULL = global preference, sekolah_id = per sekolah
  base_mode ENUM('global','school') NOT NULL DEFAULT 'global',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_tenant (user_id, tenant_id)
);
```

### 2.2 Behavior
| User Role | Default | Can Toggle? |
|-----------|---------|-------------|
| Bendahara Pusat (YPWILUTIM) | global | Ya (global + per sekolah) |
| Bendahara Sekolah | school | Ya (hanya school) |

### 2.3 UI Sync
- Toggle + School Selector di **Payment Settings Tab** (sudah ada)
- Di KAFALAH Tab: info banner "Base Setting dikelola di Pengaturan Pembayaran"
- `kafalahOnSettingsContextChange()` sinkronkan kedua tab

---

## 3. Calculation Logic (computeKafalah)

### 3.1 Resolution Order
```javascript
function resolveSettings(tenantId, baseMode) {
  if (baseMode === 'global') {
    return getKafalahSettings(null); // global (tenant_id = NULL)
  } else {
    // school mode
    const schoolSettings = getKafalahSettings(tenantId);
    if (hasSchoolSettings(schoolSettings)) {
      return schoolSettings;
    }
    // fallback ke global jika sekolah belum punya settings
    return getKafalahSettings(null);
  }
}
```

### 3.2 Gaji Pokok Resolution
```javascript
function resolveGajiPokokConfig(tenantId, baseMode) {
  if (baseMode === 'global') {
    return getGajiPokokConfig(null);
  } else {
    const config = getGajiPokokConfig(tenantId);
    return config.length ? config : getGajiPokokConfig(null);
  }
}
```

### 3.3 computeKafalah Signature Change
```javascript
async function computeKafalah(tenantId, startDate, endDate, labelPeriode, baseMode = 'school') {
  const settings = await resolveSettings(tenantId, baseMode);
  const gajiConfig = await resolveGajiPokokConfig(tenantId, baseMode);
  const overrides = await getOverrides(tenantId);
  // ... existing logic
}
```

---

## 4. Frontend Changes

### 4.1 KAFALAH Tab UI (bendahara-dashboard.html & bendahara-sekolah.html)

#### Hapus:
- Inline editing di tabel preview (input `tunj_struktural`, `tunj_apresiasi`, `total_c`)
- Kolom aksi edit inline

#### Tambah:
- **Action Button** per row: `<button onclick="openKafalahEditModal(teacherId, teacherData)">Edit</button>`
- **Modal Edit Manual** dengan field lengkap KAFALAH per guru
- **Info Badge** di header tabel: "Mode: Global/Sekolah - Data dari DB/Hitung Baru"
- **Button "Hitung & Simpan"** yang:
  - Cek `kafalah_payroll` existing untuk periode & guru
  - Jika ADA → load dari DB, tampilkan (read-only kecuali manual edit)
  - Jika TIDAK ADA → hitung otomatis, tampilkan preview, allow save

### 4.2 Modal Edit Manual (`#kafalahEditModal`)
Fields (read-only + editable):
| Field | Type | Editable? |
|-------|------|-----------|
| Guru, NIK, Jabatan, Status | Display | No |
| Gaji Pokok | Number | Yes |
| Tunj. Keluarga (Istri/Anak) | Number | Yes |
| Semua Tunjangan B | Number | Yes |
| Potongan C | Number | Yes |
| **Total** | Calculated | Read-only |

**Save** → Update `kafalah_payroll` row + set flag `is_manual_edit = 1`

### 4.3 "Hitung & Simpan" Logic Flow
```
click "Hitung & Simpan"
    │
    ├─ Cek DB: SELECT * FROM kafalah_payroll 
    │    WHERE teacher_id IN (...) AND periode_mulai=? AND periode_selesai=?
    │
    ├─ JIKA ADA data existing:
    │    ├─ Load data dari DB
    │    ├─ Tampilkan di tabel (read-only)
    │    ├─ Badge: "Data dari Database (klik Edit untuk ubah)"
    │    └─ Allow "Edit Manual" per row → update row
    │
    └─ JIKA TIDAK ADA:
         ├─ Panggil computeKafalah(tenantId, start, end, label, baseMode)
         ├─ Tampilkan preview
         ├─ Button "Simpan ke Database" → INSERT ke kafalah_payroll
         └─ Badge: "Hitungan Baru (belum disimpan)"
```

---

## 5. Re-Calculation Mechanism

### 5.1 Problem
Data sudah tersimpan di `kafalah_payroll` → user ingin hitung ulang (misal: gaji pokok config berubah, absensi di-update).

### 5.2 Solution: "Hitung Ulang" Button
UI: Tombol terpisah dari "Hitung & Simpan" → **"Hitung Ulang (Force)"**

Backend: Endpoint baru `POST /api/kafalah/regenerate`
```javascript
router.post('/kafalah/regenerate', authenticateBendahara, async (req, res) => {
  const { teacher_ids, tenant_id, periode_mulai, periode_selesai, label_periode, base_mode } = req.body;
  
  // 1. Hapus existing
  await db.query(
    `DELETE FROM kafalah_payroll 
     WHERE teacher_id IN (?) AND tenant_id=? AND periode_mulai=? AND periode_selesai=?`,
    [teacher_ids, tenant_id, periode_mulai, periode_selesai]
  );
  
  // 2. Recompute fresh
  const rows = await computeKafalah(tenant_id, periode_mulai, periode_selesai, label_periode, base_mode);
  
  // 3. Filter hanya teacher_ids yang diminta
  const filtered = rows.filter(r => teacher_ids.includes(r.teacher_id));
  
  // 4. Insert baru
  await insertPayrollRows(filtered);
  
  res.json({ success: true, message: `${filtered.length} slip diregenerasi`, data: filtered });
});
```

### 5.3 UI Flow
- Jika data existing → tampilkan tombol **"Hitung Ulang"** (merah, butuh konfirmasi)
- Konfirmasi: "Data akan dihapus dan dihitung ulang dari nol. Lanjutkan?"
- Setelah regenerate → reload tabel, badge: "Diregenerasi pada [timestamp]"

---

## 6. Database Changes

### 6.1 Migration: `2026_kafalah_redesign.sql`
```sql
-- 1. Add level column to kafalah_settings
ALTER TABLE kafalah_settings ADD COLUMN level ENUM('global','school') DEFAULT 'global' AFTER tenant_id;

-- 2. New table: kafalah_gaji_pokok_config
CREATE TABLE IF NOT EXISTS kafalah_gaji_pokok_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(50) DEFAULT NULL,
  status_pegawai ENUM('PT','PK') NOT NULL,
  jenjang ENUM('TK','SD','SMP','SMA','PONPES') NOT NULL,
  pendidikan ENUM('SMA','D3','S1','S2','S3') NOT NULL,
  gaji_pokok_base DECIMAL(12,2) NOT NULL DEFAULT 0,
  kenaikan_per_tahun DECIMAL(12,2) NOT NULL DEFAULT 0,
  interval_tahun INT NOT NULL DEFAULT 2,
  masa_kerja_max INT NOT NULL DEFAULT 30,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_config (tenant_id, status_pegawai, jenjang, pendidikan),
  KEY idx_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. New table: kafalah_base_mode
CREATE TABLE IF NOT EXISTS kafalah_base_mode (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  tenant_id VARCHAR(50) DEFAULT NULL,
  base_mode ENUM('global','school') NOT NULL DEFAULT 'global',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_tenant (user_id, tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. Add is_manual_edit flag to kafalah_payroll
ALTER TABLE kafalah_payroll ADD COLUMN is_manual_edit TINYINT(1) NOT NULL DEFAULT 0 AFTER updated_at;
ALTER TABLE kafalah_payroll ADD COLUMN base_mode_used ENUM('global','school') DEFAULT NULL AFTER is_manual_edit;

-- 5. Seed default gaji pokok config (global)
INSERT IGNORE INTO kafalah_gaji_pokok_config (tenant_id, status_pegawai, jenjang, pendidikan, gaji_pokok_base, kenaikan_per_tahun, interval_tahun, masa_kerja_max)
SELECT NULL, status_pegawai, jenjang, pendidikan, gaji_awal, kenaikan_per_tahun, interval_tahun, masa_kerja_max
FROM kafalah_kenaikan_config;
```

---

## 7. API Endpoints Changes

| Endpoint | Method | Change |
|----------|--------|--------|
| `/api/kafalah/preview` | POST | Add `base_mode` param, use `resolveSettings()` |
| `/api/kafalah/generate` | POST | Add `base_mode`, check existing, return `is_existing` flag |
| `/api/kafalah/regenerate` | POST | **NEW** - Force regenerate (delete + recompute) |
| `/api/kafalah/save-manual` | POST | **NEW** - Save manual edit per row |
| `/api/kafalah/base-mode` | GET/PUT | **NEW** - Get/set user's base mode preference |

---

## 8. Validation & Testing

### 8.1 Test Cases
| Scenario | Expected |
|----------|----------|
| Global mode, no school settings | Pakai global settings |
| Global mode, school has settings | Tetap pakai global (toggle = global) |
| School mode, school has settings | Pakai school settings |
| School mode, school NO settings | Fallback ke global |
| Manual edit → save → hitung ulang | Data manual dipertahankan (is_manual_edit=1) |
| Hitung ulang force | Hapus semua (termasuk manual), hitung fresh |
| Bendahara sekolah toggle ke global | Hanya baca global, tidak bisa edit global settings |

### 8.2 Edge Cases
- Sekolah belum punya settings tapi toggle = school → fallback global + warning UI
- Guru pindah sekolah di tengah periode → gunakan settings sekolah saat generate
- Absensi di-update setelah generate → butuh "Hitung Ulang" manual

---

## 9. Implementation Order

### Phase 1: Database & Backend Core
1. Migration SQL (kafalah_gaji_pokok_config, kafalah_base_mode, flags)
2. Backend helpers: `resolveSettings()`, `resolveGajiPokokConfig()`, `getBaseMode()`
3. Update `computeKafalah()` accept `baseMode`
4. New endpoints: `/regenerate`, `/save-manual`, `/base-mode`

### Phase 2: Frontend Core
1. Update `kafalah-bendahara.js`: `loadKafalahSettings()` → load base mode
2. Modal Edit Manual component
3. "Hitung & Simpan" logic dengan load-from-DB check
4. "Hitung Ulang" button + confirmation

### Phase 3: UI Polish & Sync
1. Sync toggle between bendahara-dashboard & bendahara-sekolah
2. Info badges (Global/Sekolah, Data dari DB/Hitung Baru)
3. Disable inline editing, enable action button
4. Test cross-tab sync

### Phase 4: Migration & Seed
1. Run migration SQL
2. Seed default gaji pokok from existing kenaikan_config
3. Set default base_mode for existing users

---

## 10. Open Questions

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | Apakah `kafalah_kenaikan_config` (matrix lama) tetap dipakai atau diganti sepenuhnya oleh `kafalah_gaji_pokok_config` baru? | **Migrasi gradual**: baru dipakai untuk gaji pokok, matrix lama tetap untuk kompatibilitas history |
| 2 | Bendahara sekolah boleh edit `gaji_pokok_base` per jenjang/pendidikan? | **Tidak** - hanya bendahara pusat. Sekolah hanya pakai hasil compute. |
| 3 | Apakah `tunj_struktural` per jabatan (`kafalah_jabatan_tunjangan`) juga punya level global/school? | **Ya** - via `kafalah_settings.tunj_struktural` (flat override). Jabatan default tetap dari tabel referensi. |
| 4 | Bagaimana handle guru yang punya override manual (kafalah_teacher_overrides) saat base mode berubah? | Override **selalu** mengoverride base setting (existing behavior: `getOverrideValue(ov, base, field)`). Base mode hanya menentukan `base` value. |
| 5 | Apakah butuh audit log untuk perubahan manual? | **Ya** - tambah `created_by`, `updated_by` di `kafalah_payroll` (sudah ada), log di tabel terpisah optional. |

---

## 11. Rollback Plan
- Migration reversible: `DROP TABLE` baru, `ALTER TABLE ... DROP COLUMN`
- Feature flag: `KAFALAH_REDESIGN_ENABLED` env var untuk toggle on/off
- Keep old compute path sebagai fallback jika flag off

---

## 12. Files to Modify

### Backend
- `src/routes/kafalah.js` - core logic, new endpoints
- `src/routes/treasurer.js` - if any KAFALAH related
- `server.js` - migration, new tables
- `migrations/2026_kafalah_redesign.sql` - new migration

### Frontend
- `public/bendahara-dashboard.html` - KAFALAH tab UI, modal edit
- `public/bendahara-sekolah.html` - KAFALAH UI (school version)
- `public/js/kafalah-bendahara.js` - JS logic, modal, hitung/regenerate

---

## 13. Next Steps
1. **Review & approve plan** - konfirmasi design decisions
2. **Create migration SQL** - implement schema changes
3. **Backend implementation** - helpers, endpoints
4. **Frontend implementation** - UI, modals, logic
5. **Integration testing** - end-to-end flow

---

*Plan ini siap untuk review. Silakan berikan feedback pada design decisions di bagian 10, atau lanjut ke implementasi.*