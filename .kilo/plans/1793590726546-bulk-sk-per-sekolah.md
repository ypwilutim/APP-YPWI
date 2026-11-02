# Rencana: Bulk SK Guru per Sekolah / Semua Sekolah — dengan Preview List & Edit per Baris

## Tujuan
Menggantikan bulk generate buta saat ini dengan alur: pilih scope (sekolah tertentu atau semua sekolah) → muat list guru aktif dengan detail SK yang akan dibuat → sesuaikan per baris lewat tombol Edit (dan centang baris yang dipilih) → generate.

## Keputusan Desain (dikonfirmasi user)
1. **Output**: SK tersimpan di DB (`sk_guru`), ringkasan berhasil/gagal ditampilkan. File diunduh satu-satu lewat tombol download di list SK yang sudah ada (`GET /api/sk-guru/file/:id`). Tidak ada ZIP.
2. **Kandidat**: semua guru aktif (`status_aktif = 1`), bukan hanya tanpa NIY.
3. **Edit per baris**: field lengkap seperti modal tunggal — No. Surat, Jenis/Tentang SK, Periode Mulai/Selesai, Pendidikan Terakhir, TMT.
4. **Penomoran**: nomor surat berbeda per guru (dijamin oleh sequence `sk_sequence` yang naik per SK terbit). Pemisahan modul penomoran (tabel `letter_sequence` generic) **out of scope** — follow-up terpisah.

## Asumsi (bisa diveto saat review)
- Baris yang sudah punya SK terbaru (`already_has_sk`) tetap tampil, checkbox-nya **tidak dicentang default** (tapi tetap bisa dipilih/diedit untuk jenis SK lain seperti kembali/kontrak). Baris tanpa SK dicentang default.
- Status kelayakan (masa pengabdian vs `employment_rules`) ditampilkan sebagai badge info, **tidak memblokir** seleksi — user yang memutuskan.
- Nomor surat di list adalah **provisional** (peek sequence per tenant + index). Saat generate, nomor final diambil dari sequence yang naik per baris (auto) atau nomor custom hasil edit.
- Scope akses: admin bisa pilih "Semua Sekolah" atau sekolah tertentu; operator/TU hanya sekolah yang di-assign-nya (pola endpoint `/approval` saat ini).

## Perubahan Backend — `src/routes/sk-guru.js`

### 1. Endpoint baru: `GET /api/sk-guru/bulk-candidates?tenant_id=<id|all>`
- Query guru aktif: `teachers JOIN teacher_assignments JOIN tenants`, `status_aktif = 1`.
- Scope & hak akses: mirror logika endpoint `/approval` (admin: semua tenant atau filter `tenant_id`; non-admin: turunkan dari assignments admin, wajib `verifyTenantAccess`).
- Untuk tiap guru, hitung detail SK preview dengan `buildSkData(...)` menggunakan:
  - Nomor provisional: peek base per tenant (`peekNextSkNumber`) + index urut dalam tenant itu.
  - `tentang_type` default `'baru'`; PT/TMT dari data guru.
- Tambahkan per baris: `qualified` + `years_of_service` (pola cek `employment_rules`/`employment_status_rules` seperti bulk lama), `already_has_sk` (cek `sk_guru` terbaru untuk guru itu), `nip` ada/kosong.
- Response: `{ success, data: [ {teacher_id, nama, nik, nip, tenant_id, nama_sekolah, unit, jabatan, status_kepegawaian, tmt, pt, ttl, qualified, years_of_service, already_has_sk, sk: {no_surat, tentang, tgl_mulai, tgl_selesai, periode, niy, bh, bm, ...}} ], hijri_year }`.
- Limit 500 baris (catat di response jika lebih) — paginasi/pencarian server-side sebagai follow-up.

### 2. Ganti endpoint `POST /api/sk-guru/bulk-generate` (payload baru)
Payload: `{ rows: [ {teacher_id, tentang_type, pt, tmt_custom, no_surat, tgl_mulai_custom, tgl_selesai_custom, tentang} ] }`
Per baris (loop, satu baris gagal tidak menggagalkan yang lain):
1. Validasi guru ada, aktif, dan `verifyTenantAccess`.
2. Deteksi `no_surat` custom duplikat dalam payload → baris dilewati dengan alasan.
3. Cek konflik NIY (pola existing di `/generate`).
4. Nomor: `no_surat` custom jika ada; jika kosong → `getNextSkNumber(tenant_id, hijri_year)` (naikkan sequence → nomor unik per guru).
5. `buildSkData` dengan nilai field dari baris (field adalah sumber kebenaran — sama dengan modal tunggal).
6. INSERT `sk_guru` (termasuk `tahun_ajaran_id` dari `req.activeTahunAjaran`), UPDATE `teachers.nip` jika kosong.
Response: `{ success, generated: [...], skipped: [...], errors: [...] }`.

### 3. Hapus endpoint bulk-generate lama (payload `{tenant_id, tentang_type, pt}`) — digantikan endpoint baru di atas.

## Perubahan Frontend — `public/admin-dashboard.html` + `public/js/admin-dashboard.js`

### 1. Documents Tab (admin-dashboard.html:1289-1328)
- Tambah tombol **"Bulk Generate SK"** di header sebelah "Buat SK Guru".
- Hapus tombol "Bulk Generate" lama dari modal SK tunggal (admin-dashboard.html:1445-1448).

### 2. Modal baru `skBulkModal`
- Scope selector: dropdown sekolah (dari `/api/admin/tenants`, pola `loadTenantsForQR`) + opsi "Semua Sekolah" (admin saja). Operator: sekolah otomatis dari assignment.
- Tombol "Muat Daftar Guru" → panggil `bulk-candidates`.
- Search input (filter nama client-side).
- Tabel: checkbox (header ada "pilih semua") | No. Surat (provisional) | Nama | Sekolah / Unit | Jenis & Tentang | Periode | TMT | PT | NIY | Status (badge layak / sudah punya SK) | Aksi (**Edit**).
- Footer: info jumlah terpilih + tombol **"Generate SK Terpilih (N)"** → POST `bulk-generate` dengan array baris terpilih (termasuk hasil edit) → tampilkan ringkasan (berhasil/gagal/dilewati) → refresh `loadSkGuruList`.
- State list disimpan di variabel (`skBulkRows`) agar edit bisa mengubah data di memori lalu di-render ulang.

### 3. Modal edit per baris `skBulkEditModal`
- Field lengkap seperti modal tunggal: Jenis SK (`tentang_type`), No. Surat, Tentang (opsional), Periode Mulai, Periode Selesai, PT, TMT (format month). Info guru readonly (nama, sekolah, unit).
- Simpan → update `skBulkRows`, re-render tabel.

### 4. JS (`admin-dashboard.js`)
- Fungsi baru: `openSkBulkModal`, `loadSkBulkCandidates`, `renderSkBulkTable`, `toggleSkBulkSelectAll`, `openSkBulkEdit(rowIndex)`, `saveSkBulkEdit`, `submitSkBulkGenerate`.
- Hapus fungsi `bulkGenerateSkGuru` lama (digantikan alur baru).
- Pola auth header: `skGuruAuthHdr()` (sudah ada).

## Perilaku Penomoran (penting)
- List menampilkan nomor provisional berurutan per sekolah (peek, sequence tidak berubah).
- Generate: baris tanpa nomor custom → ambil dari sequence yang naik per baris (nomor final unik & berbeda per guru); baris dengan nomor custom hasil edit → pakai nomor itu.
- Duplikat nomor custom dalam satu batch → baris dilewati dengan alasan jelas.

## Risiko
- List besar saat scope "Semua Sekolah" → limit 500 + search client-side; paginasi server-side follow-up.
- Nomor provisional bisa berbeda dengan final jika ada generate lain di antara preview dan generate (race kecil, dapat diterima).
- Generate sebagian gagal → baris lain tetap proses, dilaporkan per baris.
- Tidak ada render PDF saat bulk (DB-only) → file diunduh nanti per SK dari list SK (`/file/:id`), sesuai keputusan output.

## Validasi
1. Admin: Documents → Bulk Generate → scope "Semua Sekolah" → muat → semua guru aktif tampil dengan detail; nomor provisional berbeda per guru dan berurutan per sekolah.
2. Operator: scope otomatis hanya sekolah yang di-assign.
3. Edit satu baris (ubah no surat, jenis, periode, PT, TMT) → list terupdate; generate → SK di DB memakai nilai hasil edit.
4. Pilih sebagian baris → Generate → ringkasan berhasil/gagal; cek tabel `sk_guru` & `teachers.nip` terisi; nomor surat unik.
5. Baris dengan nomor custom duplikat → dilewati dengan alasan.
6. Download SK dari list SK (`/file/:id`) menghasilkan PDF/DOCX sesuai field.
7. Regression: modal SK tunggal tetap jalan; flow approval Desember & scheduler tidak terganggu.

## File yang Disentuh
- `src/routes/sk-guru.js` — endpoint `bulk-candidates` (baru), `bulk-generate` (ganti payload), hapus bulk lama
- `public/admin-dashboard.html` — tombol Bulk di Documents tab, modal `skBulkModal` + `skBulkEditModal`, hapus tombol bulk lama di modal tunggal
- `public/js/admin-dashboard.js` — fungsi-fungsi bulk baru, hapus `bulkGenerateSkGuru` lama

## Tidak Berubah
- Endpoint SK tunggal (`/generate`, `/preview`, `/teachers/:id/data`, `/list`, `/file/:id`), approval, settings, scheduler.js, tabel `sk_guru`/`sk_sequence` (tanpa migrasi DB).

---

# Hotfix: 404 pada endpoint SK Guru (prefix URL salah)

## Root Cause
- Router sk-guru dipasang **hanya di `/api`** (server.js:276: `app.use('/api', skGuruRoutes)`). **Tidak ada mounting `/api/sk-guru`** di mana pun.
- 7 titik panggil frontend memakai prefix `/api/sk-guru/...` yang tidak pernah ada → Express jatuh ke 404 HTML → error `SyntaxError: Unexpected token '<', "<!DOCTYPE "...`.
- Bug laten pre-existing: `last-number`, `settings` (×2), `approval`, `approve` (×2) sebenarnya sudah 404 sejak awal (error tertangkap diam-diam, fitur tampak mati). Panggilan `bulk-candidates` baru meniru pola prefix yang salah ini.
- Faktor kedua: proses server berjalan (PID 239646) dimulai **sebelum** perubahan backend → route `bulk-candidates`/`bulk-generate` baru belum terdaftar. **Restart server wajib.**

## Perubahan — `public/js/admin-dashboard.js` (7 URL, murni penggantian string)
Ganti prefix `/api/sk-guru/` → `/api/`:
1. Line 3859: `/api/sk-guru/last-number` → `/api/last-number`
2. Line 4163: `/api/sk-guru/bulk-candidates` → `/api/bulk-candidates`
3. Line 4430: `/api/sk-guru/settings` → `/api/settings`
4. Line 4465: `/api/sk-guru/settings` → `/api/settings`
5. Line 4499: `/api/sk-guru/approval` → `/api/approval`
6. Line 4535: `/api/sk-guru/approve` → `/api/approve`
7. Line 4561: `/api/sk-guru/approve` → `/api/approve`

Panggilan lain sudah benar dan tidak diubah: `/api/preview`, `/api/generate`, `/api/list`, `/api/bulk-generate`, `/api/save-settings`, `/api/file/:id`, `/api/teachers/:id/data`, `/api/admin/tenants`.

## Alternatif yang ditolak
- Menambah mounting `app.use('/api/sk-guru', skGuruRoutes)` di server.js: memperbaiki URL tanpa sentuh frontend, tapi meninggalkan dua namespace URL untuk handler yang sama dan tidak memperbaiki konsistensi. Prefix `/api/...` dipakai mayoritas panggilan SK yang sudah berfungsi.

## Keamanan perubahan
- Tidak ada tabrakan path: `/last-number`, `/settings`, `/approval`, `/approve`, `/bulk-candidates`, `/bulk-generate` hanya didefinisikan di `src/routes/sk-guru.js` (verifikasi grep seluruh `src/routes/*.js`). Router lain yang dipasang di `/api` tidak memakai path-path ini.

## Wajib: Restart server
- Proses `node server.js` berjalan dengan kode lama. Restart (Ctrl+C di terminal pemilik proses, lalu `node server.js`) agar route `bulk-candidates` & `bulk-generate` baru terdaftar. Setelah itu hard-refresh browser (Ctrl+Shift+R).

## Validasi
1. Setelah restart + hard refresh: Documents → Bulk Generate SK → list guru termuat (DevTools network: `GET /api/bulk-candidates?tenant_id=all` → 200 JSON, bukan 404 HTML).
2. Buka modal Buat SK → hint "Nomor surat terakhir: ..." tampil (sebelumnya gagal diam-diam).
3. Pengaturan otomatisasi SK termuat (toggle AKTIF/MATI sesuai DB).
4. Tab persetujuan Desember termuat list-nya; tombol setujui berfungsi.
5. Regression: SK tunggal (preview/generate/download), list SK, bulk generate terpilih — tetap jalan.
