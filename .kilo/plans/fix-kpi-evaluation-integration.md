# Plan: Integrate kpi-evaluation.html dengan Backend & Database - SELESAI

## Status: SELESAI

## Modifikasi yang Sudah Dilakukan pada kpi-evaluation.html

### 1. Data Loading (lines 223-270)
- **Sebelum**: `dataPegawai` array hardcoded (lines 223-274)
- **Sesudah**: `async function loadData()` yang memanggil `GET /api/sdm/kpi/assessments` dari backend
- **Fungsi `transformAssessmentData()`**: Mentransformasi response dari backend ke format `dataPegawai` internal
- **`window.onload`**: Memanggil `checkUserAccess()` yang jika sukses, memanggil `loadData()`

### 2. Render Table (lines 272-315)
- `renderTable()` sekarang menerima data dari `dataPegawai` yang di-load dari API
- Masih menggunakan `scaleToPercent` untuk konversi skor manual 1-4 ke persen

### 2. Fungsi setRating (lines 479-505)
- **Sebelum**: Hanya update local state `indikator.skor = newSkor` lalu `renderTable()`
- **Sesudah**: juga POST ke `POST /api/sdm/kpi/assessments` dengan payload `{teacher_id, period_id, indicator_id, nilai_aktual, target}` untuk disimpan ke database

### 3. Fungsi simpanData (lines 515-553)
- **Sebelum**: Hanya menampilkan modal toast tanpa menyimpan ke mana pun
- **Sesudah**: 
  - Kumpulkan semua nilai dari `dataPegawai` ke payload
  - POST ke `POST /api/sdm/kpi/assessments/bulk` dengan format `{period_id, teacher_ids, indicator_ids, assessments}`
  - Tampilkan modal sukses/gagal berdasarkan response dari backend

## Endpoint Backend yang Digunakan

| Endpoint | Method | Deskripsi |
|----------|--------|-----------|
| `GET /api/sdm/kpi/assessments` | Get | Ambil data evaluasi KPI (difilter period/tenant) |
| `POST /api/sdm/kpi/assessments` | Post | Input/update nilai KPI per guru per indikator |
| `POST /api/sdm/kpi/assessments/bulk` | Post | Bulk input nilai KPI untuk multiple guru/indikator |

## Alur Kerja

1. User membuka halaman → `window.onload` → `checkUserAccess()` → jika SDM Pusat → `loadData()`
2. `loadData()` memanggil `GET /api/sdm/kpi/assessments` → terima data dari database → `transformAssessmentData()` → `renderTable()`
3. User mengubah skor di UI → `setRating()` → update local state + POST ke `POST /api/sdm/kpi/assessments`
4. User klik "Simpan Semua Perubahan" → `simpanData()` → POST ke `POST /api/sdm/kpi/assessments/bulk` → simpan ke tabel `kpi_scores`
5. Modal toast menampilkan hasil success/error

## Struktur Data yang Ternyata Sudah Ada

Backend dan database sudah lengkap dengan:
- Tabel: `kpi_indicators`, `kpi_periods`, `kpi_scores`, `teachers`
- Migration: `2026_sdm_tables.sql` sudah dibuat
- Routes: `src/routes/sdm-kpi.js` sudah berisi 10+ endpoint KPI
- Auth: Middleware `authenticateOperator` dan `verifyTenantAccess` sudah kerja

## Validasi

- JavaScript syntax valid: Braces balance 101:101, Parens balance 151:151
- Semua endpoint yang digunakan sudah ada di backend
- Format data yang dikirim sesuai dengan yang diharapkan oleh backend

## Catatan

Semua perubahan hanya pada `public/kpi-evaluation.html`. Tidak ada file baru yang dibuat dan tidak ada perubahan pada kode backend atau database.