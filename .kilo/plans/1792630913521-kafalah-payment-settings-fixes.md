# Implementation Plan: KAFALAH & Payment Settings Fixes

## Overview
Three issues to fix:
1. **Biaya VA Admin tidak bisa dirubah** - Global payment settings table schema issue
2. **Pengaturan KAFALAH absensi adjustment** - Update calculation logic based on check-in/check-out attendance
3. **Fitur KAFALAH - WhatsApp slip gaji** - Add template + calculation mode buttons (Pusat/Individu)

---

## Issue 1: Biaya VA Admin Global Setting Not Saving

### Root Cause
- `src/routes/paymentSettings.js:27` creates table with `subject_type ENUM('student', 'teacher')` 
- But global setting uses `subject_type='global'` (valid in `server.js` which uses `VARCHAR(20)`)
- When table missing/recreated, ENUM rejects 'global' value → INSERT IGNORE fails silently

### Fix
**File:** `src/routes/paymentSettings.js:27`
```javascript
// Change from:
subject_type ENUM('student', 'teacher') NOT NULL,
// To:
subject_type VARCHAR(20) NOT NULL,
```
Also update `src/utils/billing.js:186` for consistency.

---

## Issue 2: KAFALAH Absensi Calculation Adjustment

### Current State
- `getAttendanceSummary()` in `kafalah.js:178-194` only queries `jenis='masuk'` (check-in)
- Missing: `jenis='pulang'` (check-out) data → can't calculate `cepat_pulang`, `tidak_absen_masuk`, `tidak_absen_pulang`
- Current calculation (lines 770-773):
  - `tunjTransport` = flat if any attendance
  - `tunjTepatWaktu` = rate × tepat_waktu count
  - `tunjTidakCepatPulang` = rate × (hariKerja - cepat_pulang) but cepat_pulang always 0
  - `tunjUangMakan` = flat

### New Requirements
| Component | Calculation Logic |
|-----------|-------------------|
| **Transportasi** | Per day: ONLY if `datang tepat_waktu` AND `tidak cepat_pulang` (both same day) |
| **Uang Makan** | Per day: if `hadir` (any check-in: tepat_waktu OR terlambat), regardless of check-out |
| **Kedatangan Tepat Waktu** | `rate × count(tepat_waktu days)` |
| **Tidak Cepat Pulang** | `rate × count(tidak cepat_pulang days)` = `rate × (hari_kerja - cepat_pulang_count)` |

### Implementation

#### A. Update `getAttendanceSummary()` in `kafalah.js`
Query both check-in and check-out logs, join by teacher_id + date:

```sql
SELECT 
  m.teacher_id,
  SUM(CASE WHEN m.status_masuk='tepat_waktu' THEN 1 ELSE 0 END) AS tepat_waktu_masuk,
  SUM(CASE WHEN m.status_masuk='terlambat' THEN 1 ELSE 0 END) AS terlambat,
  SUM(CASE WHEN m.status_pulang='pulang_cepat' THEN 1 ELSE 0 END) AS cepat_pulang,
  SUM(CASE WHEN m.status_masuk IS NULL THEN 1 ELSE 0 END) AS tidak_absen_masuk,
  SUM(CASE WHEN m.status_pulang IS NULL AND m.status_masuk IS NOT NULL THEN 1 ELSE 0 END) AS tidak_absen_pulang,
  SUM(CASE WHEN m.status_masuk IN ('tepat_waktu','terlambat') THEN 1 ELSE 0 END) AS hadir,
  SUM(CASE WHEN m.status_masuk IN ('izin','cuti') THEN 1 ELSE 0 END) AS izin,
  SUM(CASE WHEN m.status_masuk='sakit' THEN 1 ELSE 0 END) AS sakit,
  SUM(CASE WHEN m.status_masuk='dinas_luar' OR m.dinas_luar=1 THEN 1 ELSE 0 END) AS dinas_luar,
  SUM(CASE WHEN m.status_masuk='kjm' THEN 1 ELSE 0 END) AS kjm
FROM (
  SELECT 
    al_masuk.teacher_id,
    DATE(al_masuk.waktu_absen) as tgl,
    al_masuk.status as status_masuk,
    al_pulang.status as status_pulang,
    al_masuk.dinas_luar
  FROM attendance_logs al_masuk
  LEFT JOIN attendance_logs al_pulang
    ON al_masuk.teacher_id = al_pulang.teacher_id
    AND DATE(al_masuk.waktu_absen) = DATE(al_pulang.waktu_absen)
    AND al_pulang.jenis = 'pulang'
  WHERE al_masuk.jenis = 'masuk'
    AND COALESCE(al_masuk.waktu_absen, al_masuk.waktu_scan) >= ?
    AND COALESCE(al_masuk.waktu_absen, al_masuk.waktu_scan) <= ?
) m
GROUP BY m.teacher_id
```

#### B. Update `computeKafalah()` calculation (lines 770-783)

```javascript
// For each teacher, need daily breakdown to calculate per-day conditions
// Option 1: Query daily attendance detail in getAttendanceSummary
// Option 2: Calculate in computeKafalah using daily data

// New logic:
// 1. Get daily attendance for each teacher (date, status_masuk, status_pulang)
// 2. For each day:
//    - hadir = status_masuk in ('tepat_waktu', 'terlambat')
//    - transport_eligible = status_masuk === 'tepat_waktu' AND status_pulang !== 'pulang_cepat'
//    - uang_makan_eligible = hadir
//    - tepat_waktu_count = status_masuk === 'tepat_waktu'
//    - cepat_pulang_count = status_pulang === 'pulang_cepat'
```

#### C. Database: Add columns to `kafalah_payroll` if not exist
- `cepat_pulang` (already exists, default 0)
- `tidak_absen_masuk` (already exists)
- `tidak_absen_pulang` (already exists)

---

## Issue 3: KAFALAH WhatsApp Slip Gaji Feature

### Requirements
1. **Template message** for slip gaji KAFALAH
2. **Two calculation mode buttons:**
   - **Pusat**: Use global KAFALAH settings (overridable per individual)
   - **Individu**: Use teacher-specific overrides only
3. Even if "Pusat" selected, can still override per individual
4. Send via WhatsApp (using existing `global.sendWhatsAppMessage`)

### Implementation

#### A. Backend: New API endpoint
```
POST /api/kafalah/send-slip-whatsapp
Body: { teacher_ids: [], tenant_id, periode_mulai, periode_selesai, mode: 'pusat'|'individu' }
```

#### B. Template Message Format
```
*SLIP GAJI KAFALAH - [NAMA SEKOLAH]*
Periode: [BULAN TAHUN]

👤 *Nama:* [NAMA GURU]
🆔 *NIK:* [NIK]
📋 *Jabatan:* [JABATAN]
📊 *Status:* [PT/PK] - [JENJANG] - [PENDIDIKAN]

──────────────────
💰 *KOMPONEN WAJIB (A)*
• Gaji Pokok: Rp [FORMAT]
• Tunj. Istri: Rp [FORMAT]
• Tunj. Anak: Rp [FORMAT] ([JML] anak)
**Total A: Rp [FORMAT]**

──────────────────
🎁 *KOMPONEN INSSENTIF (B)*
• Struktural: Rp [FORMAT]
• Fungsional: Rp [FORMAT]
• Transportasi: Rp [FORMAT] ([HARI] hari)
• Kedatangan Tepat Waktu: Rp [FORMAT] ([HARI] hari)
• Tidak Pulang Cepat: Rp [FORMAT] ([HARI] hari)
• Uang Makan: Rp [FORMAT] ([HARI] hari)
• KJM: Rp [FORMAT] ([JAM] jam)
• Prestasi Kinerja: Rp [FORMAT]
• Apresiasi: Rp [FORMAT]
• Pembina: Rp [FORMAT]
• Jam Mengajar: Rp [FORMAT] ([JAM] jam)
**Total B: Rp [FORMAT]**

──────────────────
⚠️ *PEMOTONGAN (C)*
• Luar Tanggungan: Rp [FORMAT]
• SIM-T: Rp [FORMAT]
• Ta'awun: Rp [FORMAT]
• Piutang: Rp [FORMAT]
**Total C: Rp [FORMAT]**

──────────────────
✅ *TOTAL DITERIMA: Rp [FORMAT]*
(Total A + Total B - Total C)

📱 *YPWI Luwu Timur - Sistem KAFALAH*
```

#### C. Frontend: Add buttons in KAFALAH tab
- After "Simpan Slip" button, add:
  - "Kirim WA (Pusat)" - uses global settings + individual overrides
  - "Kirim WA (Individu)" - uses only individual overrides
- Modal to select teachers (checkboxes) + confirm

#### D. Calculation Mode Logic
- **Pusat**: Start with global settings → apply individual overrides (kafalah_teacher_overrides)
- **Individu**: Start with zeros → apply only individual overrides (fallback to 0 if not set)

---

## Implementation Order

1. **Fix Issue 1** (Payment Settings) - Quick fix, unblocks VA admin fee
2. **Fix Issue 2** (KAFALAH Absensi Calculation) - Core calculation logic
3. **Fix Issue 3** (WhatsApp Slip) - New feature, depends on Issue 2 data

---

## Testing Checklist

### Issue 1
- [ ] Change VA admin fee in Pengaturan Pembayaran → Save → Refresh → value persists
- [ ] Generate billing → verify biaya_admin_va applied correctly

### Issue 2
- [ ] Preview KAFALAH with attendance data
- [ ] Verify Transportasi only counted on days with tepat_waktu AND no pulang_cepat
- [ ] Verify Uang Makan counted on all hadir days (including terlambat)
- [ ] Verify Kedatangan Tepat Waktu = rate × tepat_waktu days
- [ ] Verify Tidak Cepat Pulang = rate × (hari_kerja - cepat_pulang days)

### Issue 3
- [ ] Send WA slip for single teacher (Pusat mode)
- [ ] Send WA slip for multiple teachers (Individu mode)
- [ ] Verify overrides still work in Pusat mode
- [ ] Verify message format matches template

---

## Files to Modify

### Backend
1. `src/routes/paymentSettings.js` - Fix table schema (line 27)
2. `src/utils/billing.js` - Fix table schema (line 186) 
3. `src/routes/kafalah.js` - Update `getAttendanceSummary()` and `computeKafalah()`
4. `src/routes/kafalah.js` - Add `/kafalah/send-slip-whatsapp` endpoint

### Frontend
5. `public/bendahara-dashboard.html` - Add WhatsApp buttons in KAFALAH tab
6. `public/js/kafalah-bendahara.js` - Add send WA slip functionality