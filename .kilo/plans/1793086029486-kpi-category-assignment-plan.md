# KPI Category Assignment & Rating Plan

## Goal
Enable SDM (School Data Manager) to:
1. **Manually assign each teacher/employee to KPI category "guru" or "staf"**, overriding automatic classification based on `jabatan_di_unit`. This addresses the "guru isomer" case.
2. **Input KPI values using simplified rating system**: 1 = Kurang, 2 = Cukup, 3 = Baik, 4 = Sangat Baik (dengan mapping 0-50%, 51-70%, 71-85%, 86-100%)

The system flow begins with **school selection**, then displays teacher list with indicators, followed by rating-based input.

## Problem Statement

### 1. KPI Category Classification
Currently, the system automatically determines KPI category based on `jabatan_di_unit` field in `teacher_assignments`:
- Jabatan containing "guru", "wali" → category "guru"
- Jabatan containing "bendahara", "tu", "kepala", "admin" → category "staf"

This fails for teachers who have administrative roles but whose primary work is teaching (e.g., "Kepala Sekolah" who still teaches, or "Guru" with additional admin duties).

### 2. Manual KPI Input Complexity
Current manual KPI input requires filling numeric fields (`nilai_aktual`, `pencapaian`, `skor`) with percentages and calculations. This is cumbersome for SDM who just want to give quick ratings.

The correct flow: **Pilih sekolah → Tampil list guru → Input penilaian dengan tombol 1-4**

## Solution Overview

### A. KPI Category Assignment (Feature)
Add a `kpi_category` field to `teacher_assignments` table that allows SDM to manually set the KPI category per assignment. Priority system: manual setting > automatic classification based on jabatan.

### B. Simplified KPI Rating System (NEW - Flow Dependent on School Selection)
Add simplified rating input 1-4 that maps to percentage ranges, replacing complex manual numeric input. The system stores numeric values but displays user-friendly labels.

**Key UI Flow:**
1. User selects **school** (tenant)
2. System displays **list of teachers** for that school with their categories
3. User selects a **teacher** and sees their **KPI indicators**
4. For manual indicators, user clicks **rating buttons 1-4**
5. Values stored as 25/50/75/100 with labels "Kurang/Cukup/Baik/Sangat Baik"

## Affected Tables

### 1. `teacher_assignments`
Add column: `kpi_category ENUM('guru','staf') DEFAULT NULL AFTER jabatan_di_unit`

**Rationale**: Store the manually-set KPI category per teacher assignment. NULL means "use automatic classification".

### 2. `kpi_scores` (existing - minor change)
The `pencapaian` field already exists as `DECIMAL(7,2) DEFAULT 0`. No schema change needed, but application logic changes to accept 1-4 rating and convert to 25/50/75/100.

### 3. `kpi_indicators` (existing)
No changes needed. Already has `kategori ENUM('guru','staf')`.

## Data Flow Changes

### 1. KPI Category Classification (Priority Logic)

```
START: Load teacher assignment for selected school
│
├─ kpi_category IS NULL?
│  │
│  ├─ YES → Use automatic classification from jabatan_di_unit
│  │     └─ Contains 'guru'/'wali' → 'guru'
│  │     └─ Contains 'bendahara'/'tu'/'kepala'/'admin' → 'staf'
│  │     └─ Default → 'guru'
│  │
│  └─ NO → Use manual kpi_category value
│
END: Return category for KPI processing
```

### 2. KPI Rating Input Flow (New - School-Selected Flow)

```
Step 1: User selects school (tenant)
│
Step 2: System displays teachers list for that school with categories
│
Step 3: User selects teacher → System shows KPI indicators for that teacher
│
Step 4: For each indicator with source "manual":
│   ├─ Show rating buttons: 1, 2, 3, 4
│   └─ On click: Store value in pencapaian:
│        1 → 25 (0-50%)
│        2 → 50 (51-70%)
│        3 → 75 (71-85%)
│        4 → 100 (86-100%)
│        Display label: "Kurang/Cukup/Baik/Sangat Baik"
│
Step 5: Submit → API simpan nilai pencapaian sesuai kategori
│
Step 6: System calculates skor: pencapaian × bobot / 100
```

### 3. Auto Calculation & Display

When displaying KPI results:
- Store numeric: `pencapaian` = 25/50/75/100
- Display text: "Kurang"/"Cukup"/"Baik"/"Sangat Baik"
- Auto calculation shows corresponding label based on numeric value

## Affected Tables

### 1. `teacher_assignments`
Add column: `kpi_category ENUM('guru','staf') DEFAULT NULL AFTER jabatan_di_unit`

### 2. `kpi_scores` (existing - minor change)
The `pencapaian` field already exists as `DECIMAL(7,2) DEFAULT 0`. No schema change needed, but application logic changes to accept 1-4 rating and convert to 25/50/75/100.

### 3. `kpi_indicators` (existing)
No changes needed. Already has `kategori ENUM('guru','staf')`.

## API Changes

### 1. New Endpoint: Set KPI Category
```
POST /api/sdm/kpi/assignments/:teacherId/category
```
**Request Body**: `{ "kpi_category": "guru" | "staf" }`
**Authentication**: `authenticateOperator` middleware
**Authorization**: Hanya SDM Pusat

**Success Response**:
```json
{ "success": true, "message": "Kategori KPI berhasil diupdate", "kpi_category": "guru" }
```

**Error Responses**:
- 403: Bukan SDM Pusat
- 400: kpi_category tidak valid

### 2. Modified Endpoint: Input KPI Assessment
Update `/api/sdm/kpi/assessments` to accept simplified rating input.

**Request Body additions**:
```json
{
  "teacher_id": 1,
  "period_id": 1, 
  "indicator_id": 1,
  "nilai_aktual": 85.5,
  "target": 90,
  "pencapaian": 75,      // Bisa langsung 25/50/75/100 dari rating 1-4
  "skor": 22.5,
  "rating": 3            // BARU: Input 1-4 dari UI (opsional, jika tidak ada convert ke pencapaian)
}
```

**New Logic**:
- If `rating` provided (1-4): 
  - Convert to `pencapaian`: rating 1→25, 2→50, 3→75, 4→100
  - Simpan `pencapaian` dengan nilai tersebut
  - Hitung `skor` berdasarkan `pencapaian` × `bobot` / 100
- If `rating` not provided: gunakan nilai `pencapaian` langsung dari request

**Success Response**:
```json
{ "success": true, "message": "Nilai KPI berhasil disimpan", "pencapaian": 75, "rating_label": "Baik" }
```

### 3. Get Teachers by School (SDM Employees)
Update `/api/sdm/employees` to include `kpi_category` in response and filter by selected school.

## UI Changes

### 1. School Selection (Existing)
Di halaman KPI Dashboard, user memilih sekolah via dropdown `tenantSelect`. 
- Sistem menyimpan `currentTenant` dan menampilkan data hanya untuk sekolah tersebut.
- Semua query ke API menyertakan `tenant_id` yang dipilih.

### 2. Teachers List with Categories (Updated)
Di halaman SDM Employees atau halaman KPI, setelah sekolah dipilih:
- Tampil daftar guru beserta kategori KPI- mereka
- Kategori ditentukan otomatis dari `jabatan_di_unit` atau manual jika sudah di-set
- Setiap guru menampilkan: nama, NIK, jabatan, kategori (Guru/Staf)

```html
<div class="teacher-card" data-teacher-id="${teacherId}">
  <span class="teacher-name">${teacherName}</span>
  <span class="teacher-category ${kpiCategory === 'guru' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}">
    ${kpiCategory === 'guru' ? 'Guru' : 'Staf'}
  </span>
</div>
```

### 3. KPI Input Form - Rating Buttons (Updated)
Di halaman input KPI, setelah guru dipilih dan periode dikonfirmasi:
- Hanya menampilkan indikator KPI untuk guru yang dipilih
- Untuk indikator dengan `sumber = 'manual'`:
  ```html
  <div class="rating-buttons">
    <button class="rating-btn rating-1" onclick="setKPIRating(1)">1</button>
    <button class="rating-btn rating-2" onclick="setKPIRating(2)">2</button>
    <button class="rating-btn rating-3" onclick="setKPIRating(3)">3</button>
    <button class="rating-btn rating-4" onclick="setKPIRating(4)">4</button>
  </div>
  <span class="rating-desc" id="ratingDesc">Pilih 1 (Kurang) sampai 4 (Sangat Baik)</span>
  ```
- Untuk indikator dengan sumber "kehadiran" atau "evaluasi": tampilkan nilai otomatis dengan label "Otomatis dari [sumber]"

**JavaScript**: `setKPIRating(rating)` mengisi field `pencapaian` dengan nilai terconvert (25/50/75/100) dan menampilkan label di `ratingDesc`.

### 4. Display Format di Tabel Hasil KPI
| Nama Guru | Kategori | Indikator | Nilai | Status |
|-----------|----------|-----------|-------|--------|
| Bpk Andi | Guru | Kehadiran | 85% | Hadir |
| Ibu Siti | Staf | Kerjasama Tim | **3** | **Baik** *(nilai rating 3 = 75%)* |
| Bpk Bambang | Guru | Kualitas | **2** | **Cukup** *(nilai rating 2 = 50%)* |

*Note: Kolom "Nilai" menampilkan persentase (25/50/75/100) dan/atau label "Kurang/Cukup/Baik/Sangat Baik" sesuai setting rating.*

## Migration Path

### Step 1: Database Migration
Add column to existing `teacher_assignments` table:
```sql
ALTER TABLE teacher_assignments ADD COLUMN kpi_category ENUM('guru','staf') DEFAULT NULL AFTER jabatan_di_unit;
```

**Default values**: All existing rows get NULL (automatic classification continues as before).

### Step 2: Seed/Default Values (Optional)
Run update to set default categories based on existing `jabatan_di_unit`:
```sql
UPDATE teacher_assignments 
SET kpi_category = CASE 
  WHEN LOWER(jabatan_di_unit) LIKE '%guru%' OR LOWER(jabatan_di_unit) LIKE '%wali%' THEN 'guru'
  WHEN LOWER(jabatan_di_unit) LIKE '%bendahara%' OR LOWER(jabatan_di_unit) LIKE '%tu%' 
       OR LOWER(jabatan_di_unit) LIKE '%kepala%' OR LOWER(jabatan_di_unit) LIKE '%admin%' 
       OR LOWER(jabatan_di_unit) LIKE '%operator%' THEN 'staf'
  ELSE 'guru'
END;
```

### Step 3: API Implementation
Implement the new endpoint to set `kpi_category`.

### Step 4: API Logic Update
Update `/sdm/kpi/assessments` endpoint to accept and handle `rating` field 1-4.

### Step 5: UI Implementation
Update SDM employees view and KPI dashboard to use the new field and rating buttons.

**Implementation Order:**
1. First: School selection and teacher list display
2. Second: KPI indicators display per teacher with categories
3. Third: Rating buttons 1-4 for manual indicators
4. Fourth: Submit and save functionality

### Step 6: Documentation
Add documentation explaining the 1-4 rating system, its mapping to percentages, and the complete UI flow:
1. Select school
2. View teachers list
3. Select teacher → view indicators
4. Input rating 1-4
5. Submit results

## Validation Plan

### 1. Unit Tests
- Test API endpoint `/sdm/kpi/assignments/:teacherId/category` with:
  - SDM Pusat → should succeed
  - Non-SDM → should return 403
  - Invalid kpi_category value → should return 400

- Test automatic classification logic:
  - Teacher with jabatan "Guru KTSP" → category "guru"
  - Teacher with jabatan "Kepala Sekolah" → category "staf" (default)
  - Teacher with jabatan "Wali Kelas XI" → category "guru"

- Test rating input conversion:
  - Rating 1 → pencapaian 25, label "Kurang"
  - Rating 2 → pencapaian 50, label "Cukup"
  - Rating 3 → pencapaian 75, label "Baik"
  - Rating 4 → pencapaian 100, label "Sangat Baik"

- Test KPI save with rating field:
  - POST with `rating: 3` → should save pencapaian=75 and skor calculated correctly
  - POST without rating but with pencapaian=75 → should work as before

### 2. Integration Tests
- **School selection flow**: 
  - User selects school → teachers list loaded for that school only
  - Changing school updates teacher list
- **Teacher selection + rating input**:
  - User selects teacher → indicators loaded
  - User clicks rating 1-4 → pencapaian terisi nilai terconvert
  - User submits → nilai berhasil disimpan di database
- **Category assignment**:
  - User manually sets category via API → kategorinya berubah di UI
  - Auto-classification bekerja jika kpi_category = NULL
- **Auto-filled KPI**:
  - Indikator dengan source kehadiran/evaluasi tetap tampil nilai otomatis
  - Tidak terpengaruh oleh rating 1-4 (hanya untuk source manual)

### 3. Edge Cases
- Teacher with multiple assignments (different tenants): each assignment has independent `kpi_category`
- Teacher with `kpi_category` = NULL and unusual `jabatan_di_unit`: falls back to default "guru"
- Rating input tanpa nilai `nilai_aktual` → handling error/validation
- Bulk KPI input: should respect individual teacher's rating input
- Reports: filter by `kpi_category` from assignment vs `kategori` from indicator
- Empty rating (user submit tanpa klik 1-4) → validasi form
- School with no teachers → menampilkan pesan "Tidak ada guru"
- School with teachers but no KPI indicators → menampilkan pesan "Belum ada template KPI"

### 4. UI/UX Tests
- School dropdown functional and filters teachers correctly
- Teacher cards display correct category labels
- Rating buttons visible only for manual source indicators
- Default rating state ketika halaman dimuat (tidak ada yang terpilih)
- Tooltip/description "1=Kurang(0-50%), 2=Cukup(51-70%), 3=Baik(71-85%), 4=Sangat Baik(86-100%)" tampil
- Pada display hasil, label "Kurang/Cukup/Baik/Sangat Baik" muncul sesuai nilai terpanah
- Submitting form tanpa rating validasi menampilkan pesan peringatan

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| SDM lupa mengubah kategori, menyebabkan evaluasi salah | Sistem menampilkan label warnanya di UI: "Kategori otomatis berdasarkan jabatan" |
| Data tidak konsisten antara assignment dan kpi_scores | Pastikan logika insert KPI skor selalu memperhitungkan kpi_category dari assignment |
| SDM bingung antara `rating` 1-4 dengan nilai persentase | Dokumentasi jelas di UI dan tooltip explaining mapping 1-4 ke 0-100% |
| Lupa migrasi database | Tambahkan script migrasi dalam dokumentasi deployment |
| Confusion between `kategori` (indicator) and `kpi_category` (assignment) | Documentation dan UI labeling yang jelas membedakan keduanya |
| Rating 1-4 digunakan salah satunya (untuk indicator bukan manual) | Validasi di backend: hanya proses rating jika indicator sumber 'manual' |
| School selection tidak memfilter teachers dengan benar | Test integrasi menyertai berbagai kondisi school/tenant |

## Rollback Plan

Jika ada masalah setelah deploy:
1. **Database**: Kolom `kpi_category` bisa didelete tanpa merusak data KPI exististing (hanya membatalkan fitur manual override)
2. **API**: Endpoint dihapus, kembali ke klasifikasi otomatis saja
3. **UI**: Menghapus kolom selector kategori dan rating buttons, kembali ke form input numerik lama
4. **Logika KPI**: Kembali menerima `pencapaian` langsung dari request tanpa konversi dari rating

**Catatan**: Setiap teacher assignment tetap mempertahankan `jabatan_di_unit` untuk kebutuhan lain, hanya kategori KPI yang ditambahkan.

## Fitur Baru: Sistem Penilaian 1-4 (Detail Implementasi)

### Mapping 1-4 ke Nilai Persentase:
| Klik | Nilai Terpanah (pencapaian) | Rentang Persentase | Label Tampil |
|------|---------------------------|-------------------|-------------|
| **1** | 25 | 0-50% | Kurang |
| **2** | 50 | 51-70% | Cukup |
| **3** | 75 | 71-85% | Baik |
| **4** | 100 | 86-100% | Sangat Baik |

### Alur Lengkap Input di UI:

1. **Pilih Sekolah** - User memilih sekolah dari dropdown di header KPI Dashboard
   - Sistem menyimpan `currentTenant` dan melakukan filter pada semua query berikutnya
   - Hanya data untuk sekolah yang dipilih yang ditampilkan

2. **Tampil Daftar Guru** - System menampilkan daftar guru untuk sekolah yang dipilih
   - Setiap guru menampilkan: nama, NIK, jabatan, kategori KPI (Otomatik/Guru/Staf)
   - Kategori ditampilkan dengan warna: Hijau (Guru) | Abu-abu (Staf)

3. **Pilih Guru dan Lihat Indikator** - User memilih guru dari daftar
   - Sistem menampilkan semua indikator KPI untuk guru tersebut
   - Untuk setiap indikator: nama indikator, kategori (guru/staf), sumber (manual/kehadiran/evaluasi)
   - Jika sumber "manual": tampilkan tombol rating 1-4
   - Jika sumber "kehadiran"/"evaluasi": tampilkan nilai otomatis dengan badge "Otomatis"

4. **Input Rating 1-4** - SDM memilih tombol 1, 2, 3, atau 4
   - Tombol 1: "Kurang" (0-50%)
   - Tombol 2: "Cukup" (51-70%)
   - Tombol 3: "Baik" (71-85%)
   - Tombol 4: "Sangat Baik" (86-100%)
   - Sistem mengisi field `pencapaian` dengan nilai 25/50/75/100
   - Menampilkan label "Kurang/Cukup/Baik/Sangat Baik" di samping field
   - Tombol yang dipilih dihightlight (warna berbeda)

5. **Submit Nilai** - SDM menekan tombol "Simpan Nilai"
   - API menerima data: teacher_id, period_id, indicator_id, pencapaian (25/50/75/100), rating_label
   - Sistem menghitung `skor`: pencapaian × bobot indicator / 100
   - Menampilkan pesan sukses: "Nilai KPI berhasil disimpan"
   - Data tersimpan di database dengan pencapaian sebagai angka 25/50/75/100

6. **Lihat Hasil** - Setelah disimpan, tampil di tabel ringkasan KPI
   - Setiap baris menampilkan: nama guru, kategori, indikator, nilai (persentase/label), skor
   - Laporan bisa difilter berdasarkan kategori (Guru/Staf)

### Kompatibilitas Mundur:
- Jika sistem rating 1-4 mati/disable, form input numerik `pencapaian` masih berfungsi se semula
- Data lama yang sudah ada di database (pencapaian 25/50/75/100) tetap terbaca dengan benar
- Label "Kurang/Cukup/Baik/Sangat Baik" bisa ditampilkan jika nilai pencapaian sesuai rentangnya
- Flow lama (mengisi numerik langsung) tetap tersedia sebagai opsi fallback

## Open Questions (for User Confirmation)

1. Apakah ingin menjalankan migrasi awal untuk mengisi `kpi_category` berdasarkan `jabatan_di_unit` otomatis, atau biarkan NULL hingga SDM manually set?

2. Apakah ingin menambahkan fitur massal (bulk) pengubahan kategori untuk multiple guru sekaligus?

3. Apakah kategori `kpi_category` ini juga harus mempengaruhi filter absensi/attendance, atau hanya untuk fitur KPI saja?

4. *(Baru, terkait alur)* Apakah perlu menambahkan validasi bahwa user **wajib** memilih sekolah terlebih dahulu sebelum bisa mengakses fitur KPI dan melihat daftar guru?

5. Apakah sistem rating 1-4 ini hanya untuk indikator KPI dengan sumber "manual", atau juga boleh digunakan untuk indikator "evaluasi" dan "kehadiran" (dengan konversi otomatis)?

6. Apakah field `nilai_aktual` tetap digunakan untuk nilai aktual (seperti absensi/skor sebenarnya), atau hanya `pencapaian` yang diisi dari rating 1-4?

## Success Criteria

- [ ] Database migration successful, all existing assignments have `kpi_category = NULL`
- [ ] API endpoint POST `/sdm/kpi/assignments/:id/category` dapat diakses SDM Pusat
- [ ] UI menampilkan kategori KPI per guru di halaman SDM Employees
- [ ] SDM dapat mengubah kategori KPI per guru dari "staf" ke "guru" atau sebaliknya
- [ ] **FITUR BARU**: Alur input dimulai dari pemilihan sekolah, lalu tampil daftar guru, lalu input rating 1-4 terintegrasi dengan benar
- [ [ ] Rating 1-4 terconvert ke pencapaian 25/50/75/100 dengan label yang tepat
- [ ] Input KPI nilai_aktual tetap berfungsi seblum
- [ ] Laporan KPI dapat difilter berdasarkan kategori assignment
- [ ] Tidak ada breaking change ke fitur KPI yang sudah ada
- [ ] Test konversi rating 1→25, 2→50, 3→75, 4→100 berhasil di semua kondisi
- [ ] UI flow: School selection → Teacher list → Indicator display → Rating input → Save