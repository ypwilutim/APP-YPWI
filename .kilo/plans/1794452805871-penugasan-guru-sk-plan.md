# Plan: Sub-tab Penugasan Guru + Generate SK Otomatis

## Tujuan

Menambahkan sub-tab **Penugasan** di dalam tab **Manajemen Guru** pada SDM Dashboard v2. Fitur ini dipakai untuk:

1. Memberi penugasan jabatan baru kepada guru.
2. Mengubah/beralih jabatan guru di sekolah yang sama.
3. Memindahkan guru ke sekolah lain beserta jabatannya (mutasi).
4. Saat penugasan disimpan, sistem otomatis membuat record SK dan men-generate PDF SK dengan tanggal mulai = tanggal penugasan (default hari ini) sampai akhir tahun (default 31 Desember tahun tanggal mulai) atau tanggal akhir yang ditentukan manual.

## Keputusan Desain

- **Target UI**: hanya `public/sdm-dashboard-v2.html` + `public/js/sdm-dashboard-v2.js`.
- **Struktur UI**: dua sub-tab di dalam Manajemen Guru:
  - `Data Guru` — tabel/CRUD guru yang sudah ada.
  - `Penugasan` — daftar riwayat penugasan + tombol `Tambah Penugasan`.
- **Cakupan**: pergantian jabatan di sekolah yang sama dan penugasan/mutasi lintas sekolah.
- **Riwayat**: setiap penugasan disimpan permanen di tabel baru `teacher_penugasan`. Assignment lama **tidak dihapus**, tetapi di-nonaktifkan (`is_paid = 0`) dan diberi `mutasi_reason` + `mutasi_date = NOW()`. Catatan: kolom `mutasi_status` di `teacher_assignments` hanya enum `pending/adopted`, jadi dibiarkan NULL (tidak diisi `'keluar'`).
- **Koreksi**: tidak ada edit/hapus penugasan. Jika salah input, buat penugasan koreksi baru.
- **Alur SK**: `Isi form -> Preview -> Konfirmasi -> Simpan penugasan + generate SK`.
- **Tanggal SK**:
  - `tanggal_mulai` default hari ini, bisa diubah.
  - `tanggal_selesai` default 31 Desember pada tahun yang sama dengan `tanggal_mulai`.
  - Ada checkbox `Akhir tahun otomatis` (default aktif) dan preset durasi (6 Bulan, 1 Tahun, 2 Tahun, 4 Tahun). Jika checkbox dimatikan, tanggal selesai diisi manual (mis. akhir Juni).
- **Nomor SK**: otomatis memakai sequence global yang sudah ada (`sk_global_sequence`), tidak bisa diinput manual.
- **Tentang SK**: default `PENUGASAN JABATAN (UNIT TUJUAN)`, bisa diubah lewat field opsional.
- **Gaji & tunjangan**:
  - Komponen non-jabatan (`gaji_pokok`, `tunj_kinerja`, `tunj_umum`, `tunj_istri`, `tunj_anak`, `tunj_kehadiran`, `potongan`) disalin dari assignment lama; jika tidak ada assignment lama (jenis `baru`), fallback ke kolom gaji di tabel `teachers`, lalu 0.
  - Tunjangan jabatan diisi otomatis sesuai jabatan baru memakai `kafalah_jabatan_tunjangan`:
    - `kepalasekolah`, `kepsek`, `wakasek`, `pimpinan` -> `tunj_kepala_sekolah`
    - `bendahara` -> `honor_bendahara`
    - `walikelas` -> `tunj_wali_kelas`
    - lainnya -> 0
  - Nominal bisa diubah manual di form penugasan.

## Arsitektur

### Database

Buat `migrations/20261112_teacher_penugasan.sql`:

```sql
CREATE TABLE IF NOT EXISTS `teacher_penugasan` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `teacher_id` INT(11) NOT NULL,
  `from_assignment_id` INT(11) DEFAULT NULL,
  `to_assignment_id` INT(11) DEFAULT NULL,
  `from_tenant_id` VARCHAR(20) DEFAULT NULL,
  `to_tenant_id` VARCHAR(20) NOT NULL,
  `from_jabatan` VARCHAR(100) DEFAULT NULL,
  `to_jabatan` VARCHAR(100) NOT NULL,
  `jenis` ENUM('baru','beralih','mutasi') NOT NULL DEFAULT 'beralih',
  `tanggal_mulai` DATE NOT NULL,
  `tanggal_selesai` DATE NOT NULL,
  `periode` VARCHAR(50) DEFAULT NULL,
  `tentang` VARCHAR(255) DEFAULT NULL,
  `no_surat` VARCHAR(100) DEFAULT NULL,
  `sk_guru_id` INT(11) DEFAULT NULL,
  `keterangan` TEXT DEFAULT NULL,
  `status` ENUM('aktif','digantikan','selesai','dibatalkan') NOT NULL DEFAULT 'aktif',
  `replaced_by_id` INT(11) DEFAULT NULL,
  `created_by` INT(11) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tp_teacher` (`teacher_id`),
  KEY `idx_tp_to_tenant` (`to_tenant_id`),
  KEY `idx_tp_status` (`status`),
  KEY `idx_tp_sk` (`sk_guru_id`),
  KEY `idx_tp_from_assignment` (`from_assignment_id`),
  KEY `idx_tp_to_assignment` (`to_assignment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Catatan:
- Tidak mengubah skema `sk_guru` dan `teacher_assignments`.
- `teacher_assignments` tetap menjadi sumber kebenaran assignment aktif (`is_paid = 1`).
- `teacher_penugasan` adalah riwayat/audit; relasi ke assignment baru ada di `to_assignment_id`, relasi ke SK ada di `sk_guru_id`.
- `teacher_assignments.mutasi_status` adalah enum `pending/adopted` (tanpa `keluar`), jadi pada mutasi lintas sekolah kolom ini dibiarkan NULL dan `mutasi_reason`/`mutasi_date` yang diisi.

### Backend

Tambahkan endpoint dan helper di `src/routes/sk-guru.js` (file route yang sudah dipakai untuk generate SK, agar bisa memakai `buildSkData`, `buildHtmlSk`, `generateSkPdf`, `archiveSkPdfToDrive`, `getActualNextSkNumberWithLock`, dll. tanpa refactor besar). Tambahkan route baru di akhir file sebelum `module.exports = router` (baris 2105), dengan route statis didaftarkan sebelum `/penugasan/:id`.

Helper baru:

- `getPenugasanAllowedTenants(req)` — meniru `getSdmAllowedTenants`:
  - `admin` -> semua tenant.
  - assignment SDM di `YPWILUTIM` -> semua tenant.
  - assignment SDM/kepala/pimpinan di sekolah -> tenant tersebut saja.
- `normalizeJabatan(str)` — lowercase + hapus spasi/underscore untuk mapping tunjangan.
- `resolveTunjanganJabatan(jabatan, jabatanMap)` — kembalikan `{ tunj_kepala_sekolah, tunj_wali_kelas, honor_bendahara }`.
- `validatePenugasanPayload(body)` — validasi field wajib, tanggal, dan akses tenant.
- `buildPenugasanSkData({ teacher, toTenant, toJabatan, tanggalMulai, tanggalSelesai, tentang, nomorUrut, hijriYear })` — membuat objek teacher sintetis:
  - `nama_sekolah = toTenant.nama_sekolah`
  - `tenant_id = toTenant.tenant_id`
  - `tenant_pk = toTenant.id`
  - lalu panggil `buildSkData(teacherSynthetic, 'jabatan', teacher.pt, null, nomorUrut, hijriYear, tentang, tanggalMulaiISO, tanggalSelesaiISO, tentang, null, toJabatan)`.
- `getJabatanTunjanganMap()` — `SELECT jabatan_key, jabatan_label, nominal FROM kafalah_jabatan_tunjangan`.

Endpoint:

> Urutan pendaftaran route penting: daftarkan route statis (`/penugasan/candidates`, `/penugasan/jabatan-tunjangan`, `/penugasan`) sebelum `/penugasan/:id` agar tidak tertangkap sebagai `:id`.

1. `GET /api/sk-guru/penugasan/jabatan-tunjangan`
   - Kembalikan mapping nominal tunjangan jabatan untuk auto-fill form.
   - `authenticateOperator`.

2. `GET /api/sk-guru/penugasan/candidates?tenant_id=&q=`
   - Query guru aktif + assignment aktif (boleh lebih dari satu).
   - Response:
     ```json
     {
       "success": true,
       "data": [
         {
           "teacher_id": 1,
           "nama": "...",
           "nik": "...",
           "nip": "...",
           "status_kepegawaian": "...",
           "tmt": "YYYY-MM-DD",
           "pt": "...",
           "assignments": [
             {
               "id": 10,
               "tenant_id": "YPWILUTIM",
               "nama_sekolah": "...",
               "jabatan_di_unit": "Guru",
               "is_paid": 1
             }
           ]
         }
       ]
     }
     ```
   - Guru tanpa assignment tetap ditampilkan dengan `assignments: []` agar mendukung `jenis = 'baru'`.
   - Form memanggil endpoint ini tanpa `tenant_id` agar guru tanpa assignment juga muncul; filter sekolah dipakai pada daftar riwayat penugasan.

3. `GET /api/sk-guru/penugasan?q=&tenant_id=&jenis=&status=&page=1&limit=15`
   - Join `teachers`, `tenants` (from/to), `sk_guru`.
   - Response mengikuti pola SDM: `{ success, data: { data, total, page, pages } }`.
   - Kolom yang dikembalikan: id, nama, nik, nip, from_unit, from_jabatan, to_unit, to_jabatan, jenis, tanggal_mulai, tanggal_selesai, periode, no_surat, status, sk_guru_id, created_at.

4. `GET /api/sk-guru/penugasan/:id`
   - Detail penugasan + data guru + data SK.
   - Akses dibatasi `verifyTenantAccess(req, to_tenant_id)`.

5. `POST /api/sk-guru/penugasan/preview`
   - Body:
     ```json
     {
       "teacher_id": 1,
       "from_assignment_id": 10,
       "to_tenant_id": "SMA 1",
       "to_jabatan": "Wakil Kepala Sekolah",
       "tanggal_mulai": "2026-11-12",
       "tanggal_selesai": "2026-12-31",
       "tentang": "PENUGASAN JABATAN (SMA 1)",
       "keterangan": "opsional",
       "tunj_kepala_sekolah": 600000,
       "tunj_wali_kelas": 0,
       "honor_bendahara": 0
     }
     ```
   - Validasi tanpa mutasi DB.
   - `nomorUrut` memakai `peekActualNextSkNumber(hijriYear)`.
   - Response:
     ```json
     {
       "success": true,
       "data": {
         "no_surat": "QR.001/...",
         "tentang": "PENUGASAN JABATAN (SMA 1)",
         "nama": "...",
         "ttl": "...",
         "tmt": "JANUARI 2020",
         "pt": "...",
         "niy": "...",
         "unit": "SMA 1",
         "jabatan": "Wakil Kepala Sekolah",
         "status": "GTY",
         "tgl_mulai": "12 November 2026 M",
         "tgl_selesai": "31 Desember 2026 M",
         "periode": "2 Bulan",
         "bh": "... H",
         "bm": "... M",
         "jenis": "beralih",
         "from": { "tenant_id": "...", "jabatan": "..." },
         "to": { "tenant_id": "...", "jabatan": "..." }
       }
     }
     ```

6. `POST /api/sk-guru/penugasan`
   - Body sama seperti preview.
   - Simpan penugasan + assignment + SK dalam satu transaksi DB.
   - Setelah commit, generate PDF untuk arsip Google Drive (best-effort, kegagalan tidak membatalkan transaksi).
   - Response:
     ```json
     {
       "success": true,
       "data": {
         "penugasan_id": 1,
         "sk_guru_id": 100,
         "no_surat": "QR.001/...",
         "download_url": "/api/sk-guru/file/100?view=1",
         "warning": "SK tersimpan, tetapi arsip Drive gagal dibuat"
       }
     }
     ```

7. `GET /api/sk-guru/penugasan/:id/sk`
   - Redirect ke `GET /api/sk-guru/file/:skId?view=1` setelah cek akses.
   - Memudahkan tombol unduh di UI.

### Alur transaksi saat simpan

Urutan di `POST /api/sk-guru/penugasan`:

1. Validasi payload, guru aktif, assignment asal, tenant tujuan, dan akses tenant.
2. `db.transaction(async connection => { ... })`.
3. `SELECT ... FROM teachers WHERE id = ? FOR UPDATE` untuk mengunci guru.
4. Tentukan `jenis`:
   - `from_assignment_id` kosong -> `baru`.
   - `from_tenant_id !== to_tenant_id` -> `mutasi`.
   - lainnya -> `beralih`.
   - Jika `beralih` tetapi jabatan sama -> tolak `400`.
5. `UPDATE teacher_penugasan SET status='digantikan', replaced_by_id=NULL WHERE teacher_id=? AND status='aktif'` (relasi `replaced_by_id` diisi setelah insert baru).
6. Insert `teacher_penugasan` dengan `status='aktif'`, `sk_guru_id=NULL`, `to_assignment_id=NULL`.
7. Nonaktifkan assignment lama:
   - `is_paid = 0`
   - `mutasi_status = NULL` (kolom ini adalah enum `pending/adopted`, tidak ada `keluar`)
   - `mutasi_reason = 'Mutasi ke <unit> sebagai <jabatan>'` (lintas tenant) atau `'Beralih jabatan: <lama> -> <baru>'` (sekolah sama)
   - `mutasi_date = NOW()`
   - `mutasi_status = 'keluar'` hanya jika lintas tenant.
8. Insert/update assignment baru:
   - Cek `teacher_assignments` dengan `(teacher_id, to_tenant_id, to_jabatan)`.
   - Jika ada dan `is_paid = 0` -> update menjadi aktif + copy komponen gaji.
   - Jika ada dan `is_paid = 1` -> tolak duplikat.
   - Jika tidak ada -> insert baru.
   - Copy `gaji_pokok`, `tunj_kinerja`, `tunj_umum`, `tunj_istri`, `tunj_anak`, `tunj_kehadiran`, `potongan` dari assignment lama.
   - Set tunjangan jabatan sesuai mapping.
   - `kpi_category` copy dari assignment lama; fallback `guru`/`staf` berdasarkan jabatan.
   - `class_id = NULL`.
   - `is_paid = 1`.
9. `UPDATE teacher_penugasan SET to_assignment_id = ? WHERE id = ?`.
10. Alokasikan nomor SK dengan `getActualNextSkNumberWithLock(hijriToday.year, connection)`.
11. `buildPenugasanSkData(...)`, lalu insert `sk_guru`:
    - `teacher_id`, `tenant_id` target, `tahun_ajaran_id`, `no_surat`, `tentang`, `ttl`, `tmt`, `pt`, `niy`, `unit`, `bh`, `bm`, `jabatan`, `status`, `tentag_type='jabatan'`, `tgl_mulai`, `tgl_selesai`.
12. Jika `teachers.nip` kosong/`-`, update `teachers.nip = skData.niy` setelah cek konflik NIP.
13. `UPDATE teacher_penugasan SET sk_guru_id=?, no_surat=?, tentang=? WHERE id=?`.
14. `UPDATE teacher_penugasan SET replaced_by_id=? WHERE id=?` pada record sebelumnya.
15. Commit.
16. Setelah commit: `generateSkPdf(htmlData)` + `archiveSkPdfToDrive(...)`. Jika berhasil, update `sk_guru` dengan metadata Drive. Jika gagal, log warning dan tetap return success.

### Frontend

#### `public/sdm-dashboard-v2.html`

Ubah bagian tab Manajemen Guru (sekitar baris 315-394):

1. Setelah heading `Manajemen Guru`, tambahkan sub-tab nav:
   ```html
   <div class="flex space-x-2 mb-6">
     <button id="teacherSubDataBtn" onclick="SDMDashboard.showTeacherSub('data')" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium">Data Guru</button>
     <button id="teacherSubPenugasanBtn" onclick="SDMDashboard.showTeacherSub('penugasan')" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-300">Penugasan</button>
   </div>
   ```
2. Bungkus konten tabel guru yang ada ke `<div id="teacherSubData">...</div>`.
3. Tambahkan `<div id="teacherSubPenugasan" class="hidden">` berisi:
   - Filter: search, sekolah, jenis, status, tanggal dari/sampai.
   - Tombol `Tambah Penugasan`.
   - Tabel riwayat: Nama, Dari, Ke, Jenis, Tanggal Mulai, Tanggal Selesai, Periode, No SK, Status, Aksi.
   - Pagination.
4. Tambahkan modal `penugasanModal` (form) dan `penugasanPreviewModal` (preview) setelah `teacherDetailModal` (sekitar baris 1281).

Field form `penugasanModal`:

- Guru (select searchable) + info NIK/NIP/status/TMT.
- Assignment asal (select jika guru punya >1 assignment aktif).
- Sekolah asal (read-only), Jabatan asal (read-only).
- Sekolah tujuan (select dari `/sdm-dashboard/tenants`, default sekolah aktif/user).
- Jabatan baru (select + datalist dari `/sdm-dashboard/jabatan-list`, atau input bebas).
- Jenis penugasan (badge auto: Baru/Beralih/Mutasi).
- Tanggal mulai (`date`, default hari ini).
- Checkbox `Akhir tahun otomatis` (default checked).
- Tanggal selesai (`date`, disabled saat checkbox aktif; default 31 Desember tahun tanggal mulai).
- Preset durasi: 6 Bulan, 1 Tahun, 2 Tahun, 4 Tahun.
- Periode (read-only, auto dari `computePeriode`).
- Tunj. Kepala Sekolah, Tunj. Wali Kelas, Honor Bendahara (auto-fill, editable).
- Keterangan internal (textarea, opsional).
- Tentang SK (opsional; default `PENUGASAN JABATAN (UNIT)`).
- Tombol: `Batal`, `Preview SK`.

Field preview modal:

- Ringkasan data SK (no surat, tentang, nama, ttl, TMT, PT, NIY, unit, jabatan, status, tanggal mulai, tanggal selesai, periode, BH, BM).
- Info `dari -> ke` (unit/jabatan).
- Tombol: `Kembali`, `Simpan & Generate SK`.

#### `public/js/sdm-dashboard-v2.js`

1. `state` (sekitar baris 11-25): tambahkan `teacherSub: 'data'`.
2. `Core` (sekitar baris 306-365):
   - Tambahkan `showTeacherSub(sub)` untuk toggle `teacherSubData` / `teacherSubPenugasan`, update tombol aktif, dan panggil `Penugasan.load()` saat `sub === 'penugasan'`.
   - Pada `loadTabData` case `teacher`, panggil `Teacher.load()`; jika `state.teacherSub === 'penugasan'`, panggil `Penugasan.load()`.
3. Tambahkan module `Penugasan` setelah module `Teacher` (setelah baris 1193):
   - `load()` — load tenant options, jabatan options, candidates, dan list.
   - `loadCandidates()` — `GET /sk-guru/penugasan/candidates`.
   - `onTeacherChange()` — isi select assignment asal + info guru.
   - `onFromAssignmentChange()` — isi sekolah/jabatan asal.
   - `onJabatanChange()` — auto-fill tunjangan jabatan dari `GET /sk-guru/penugasan/jabatan-tunjangan`.
   - `onStartDateChange()` — jika `akhirTahunOtomatis` aktif, set `tanggal_selesai` = 31 Desember tahun tanggal mulai.
   - `applyDurationPreset(months)` — set tanggal selesai = tanggal mulai + N bulan - 1 hari.
   - `updatePeriodePreview()` — hitung periode dari tanggal mulai/selesai (client-side).
   - `showForm()` — reset form, set default tanggal, buka modal.
   - `preview()` — `POST /sk-guru/penugasan/preview`, isi preview modal.
   - `hidePreview()` / `backToForm()`.
   - `save()` — `POST /sk-guru/penugasan`, tampilkan success modal/toast, tutup modal, reload list, sediakan tombol unduh SK.
   - `loadList(page)` — `GET /sk-guru/penugasan?...`.
   - `renderPagination(current, last)`.
   - `showDetail(id)` — `GET /sk-guru/penugasan/:id`, tampilkan detail + tombol unduh.
   - `downloadSk(skId)` — `fetch('/api/sk-guru/file/' + skId + '?view=1', { headers: { Authorization: 'Bearer ' + token } })`, buat blob, download.
4. Tambahkan `Penugasan` ke return object (sekitar baris 2311) dan `showTeacherSub` ke public API (sekitar baris 2302).
5. Tambahkan `showTeacherSub: Core.showTeacherSub` di return object.

Catatan UI:
- Gunakan `Utils.escapeHtml` untuk semua data dinamis.
- Gunakan `Swal.fire` untuk konfirmasi/loading, konsisten dengan `Teacher`.
- Gunakan `Utils.showToast` untuk error/success.
- Untuk download PDF, jangan pakai `Api.get` (response JSON); pakai `fetch` + `blob` + header Authorization.

## Validasi

1. Syntax check:
   ```bash
   node --check src/routes/sk-guru.js
   node --check public/js/sdm-dashboard-v2.js
   ```
2. Jalankan migrasi:
   ```bash
   node run-migration.js 20261112_teacher_penugasan.sql
   ```
3. Jalankan server (`npm start`), login sebagai admin/SDM pusat.
4. Buka Manajemen Guru -> sub-tab Penugasan.
5. Test 1 — beralih jabatan di sekolah sama:
   - Pilih guru, assignment asal, jabatan baru, tanggal mulai hari ini.
   - Preview: cek no surat, jabatan, unit, tanggal mulai/selesai, periode.
   - Simpan: cek `teacher_penugasan` (status aktif, from/to benar), `teacher_assignments` lama `is_paid=0`, assignment baru `is_paid=1`, `sk_guru` dibuat dengan `tentag_type='jabatan'`.
   - Download SK: cek PDF memuat jabatan/unit/tanggal baru.
6. Test 2 — mutasi lintas sekolah:
   - Pilih sekolah tujuan berbeda.
   - Cek assignment lama `is_paid=0`, `mutasi_status='keluar'`, `mutasi_date` terisi.
   - Cek assignment baru di tenant tujuan `is_paid=1`.
   - Cek SK memakai unit tujuan.
7. Test 3 — tanggal selesai custom:
   - Set tanggal mulai 2026-11-12, hilangkan centang `Akhir tahun otomatis`, set 2027-06-30.
   - Cek `tgl_selesai` = `30 Juni 2027 M`, periode `8 Bulan` (atau sesuai hasil `computePeriode`).
8. Test 4 — preset durasi:
   - Pilih 2 Tahun, cek tanggal selesai = 2 tahun dari tanggal mulai - 1 hari.
9. Test 5 — otorisasi:
   - Login sebagai SDM sekolah, coba assign ke sekolah lain -> `403`.
10. Test 6 — duplikat:
    - Coba penugasan ke jabatan yang sudah aktif di tenant yang sama -> `400`.
11. Test 7 — gaji:
    - Cek assignment baru menyalin gaji pokok/tunjangan non-jabatan dari assignment lama.
    - Cek tunjangan jabatan sesuai mapping dan bisa diubah.
12. Test 8 — payroll:
    - Generate payroll periode berjalan, pastikan guru hanya muncul sekali dan memakai assignment baru (`is_paid=1`).

## Risiko & Mitigasi

- **Konflik unique key `teacher_assignments(teacher_id, tenant_id, jabatan_di_unit)`**: gunakan upsert (update jika ada `is_paid=0`, tolak jika sudah aktif).
- **Duplikasi nomor SK**: gunakan `getActualNextSkNumberWithLock` di dalam transaksi; unique key `sk_guru(tenant_id, no_surat)` menjadi lapisan terakhir.
- **PDF/Drive gagal**: transaksi DB tetap commit; SK tetap bisa diunduh karena `/file/:skId` regenerate dari data `sk_guru`. Kegagalan hanya memengaruhi arsip Drive.
- **Guru punya banyak assignment aktif**: form wajib memilih `from_assignment_id`; jangan asumsikan assignment pertama.
- **Mapping tunjangan jabatan tidak lengkap**: fallback ke nilai assignment lama lalu 0; admin bisa menyesuaikan di form.
- **Perubahan `teacher_assignments` memengaruhi payroll/kafalah**: karena assignment lama `is_paid=0`, payroll/kafalah yang memfilter `is_paid=1` otomatis memakai assignment baru. Perlu dicek pada test payroll.
- **SK lama tetap tersimpan**: penugasan baru tidak menghapus SK lama; audit tetap utuh.

## Out of Scope

- Edit/hapus/batalkan penugasan yang sudah disimpan.
- Approval workflow SK.
- Input nomor surat manual.
- Perubahan template SK (`SKTEMPLATE/test.html` / `SKTEMPLATE.docx`).
- Export Excel/PDF daftar penugasan.
- Perubahan `teachers.tmt` atau `status_aktif` guru.
- Hitung ulang payroll periode lampau.
- Penambahan fitur serupa di SDM Dashboard v1 (`sdm-dashboard.html`).
- Menampilkan jabatan lama di body SK (template saat ini hanya punya satu placeholder `<<JABATAN>>`); riwayat lama tersimpan di `teacher_penugasan`.

## Urutan Implementasi

1. Buat migrasi `migrations/20261112_teacher_penugasan.sql` dan jalankan.
2. Tambahkan helper + endpoint di `src/routes/sk-guru.js`.
3. Tambahkan mapping `'jabatan': 'Jabatan'` di `getSkStatusLabel` (`src/routes/sk-guru.js:327`).
4. Ubah `public/sdm-dashboard-v2.html`:
   - sub-tab nav,
   - wrapper `teacherSubData`,
   - section `teacherSubPenugasan`,
   - modal `penugasanModal` dan `penugasanPreviewModal`.
5. Ubah `public/js/sdm-dashboard-v2.js`:
   - state `teacherSub`,
   - `Core.showTeacherSub`,
   - module `Penugasan`,
   - export di public API.
6. Jalankan syntax check dan validasi manual sesuai daftar di atas.