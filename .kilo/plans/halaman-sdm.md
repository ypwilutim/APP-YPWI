# Rencana Pengembangan Halaman SDM (`sdm-dashboard.html`)

## Ringkasan keputusan (hasil diskusi)

| Aspek | Keputusan |
|---|---|
| Bentuk | Halaman terpisah `public/sdm-dashboard.html` + `public/js/sdm-dashboard.js` |
| Peran baru | `jabatan_di_unit = 'SDM'` di `teacher_assignments` (bukan enum `users.role`, karena enum hanya `admin|guru`) |
| Cakupan data | SDM di tenant `YPWILUTIM` = semua sekolah; SDM di tenant lain = hanya unitnya (pola sama seperti bendahara) |
| Modul | Pegawai & riwayat kepegawaian, Cuti/Izin, Kontrak Kerja, Surat Keterangan & Arsip, Laporan & Rekap, Penggajian (kontrol penuh), KPI guru & staf, Onboarding, Monitoring ID Card, Pengingat otomatis |
| KPI | Otomatis (kehadiran, evaluasi) + manual (disiplin, kerjasama, inisiatif), berbobot, nilai akhir → grade A–D |
| Payroll lama | Tetap aktif di `admin-dashboard.html` & `bendahara-dashboard.html` (tidak ada duplikasi logika — keduanya memakai endpoint yang sama) |

## Arsitektur

**Frontend**
- `public/sdm-dashboard.html` — sidebar + tab, memakai Tailwind CDN + FontAwesome, mengikuti pola `master-dashboard.html` dan `admin-dashboard.html`
- `public/js/sdm-dashboard.js` — semua fungsi load/render (memisahkan dari HTML seperti `admin-dashboard.js`)

**Backend**
- `src/routes/sdm.js` (baru) — router khusus modul SDM (kontrak, surat, KPI, riwayat status, laporan SDM)
- Mounting di `server.js:272` (sebelah `app.use('/api', payrollRoutes)`):
  `app.use('/api', require('./src/routes/sdm'));`
- `src/middleware/auth.js` — middleware baru `authenticateSDM`: izinkan `role === 'admin'` **atau** `role === 'guru'` dengan assignment `jabatan_di_unit` mengandung `sdm`. Jika ada assignment di `YPWILUTIM`, beri akses lintas tenant; selain itu batasi ke tenant-nya.

**Entry point navigasi**
- `public/dashboard.html` — tombol "SDM" di header (pola `setupTreasurerNav()` di `public/js/dashboard.js:2562`) + item di mobile nav
- `public/master-dashboard.html:331-371` — tab "HR & Dokumen" yang masih placeholder diarahkan ke `sdm-dashboard.html`

## Perubahan WAJIB pada kode existing (risiko 403 / tenant null)

Tanpa perubahan ini, pengguna SDM akan ditolak endpoint yang dipakai ulang:

1. `src/middleware/auth.js:159` — tambahkan `'sdm'` ke array `adminRoles` pada `authenticateOperator`
2. `src/routes/payroll.js:61-71` — tambahkan `'sdm'` di `resolveTenantId()` agar tenant terisi
3. `src/routes/admin.js:6674` dan `src/routes/admin.js:6865` — tambahkan `'sdm'` di array `adminRoles` (rekap absensi)
4. Helper "allowed tenants" di `src/routes/admin.js:5575-5600` (daftar & approval cuti/izin) — tambahkan `'sdm'`
5. Cek endpoint lain yang dipakai SDM dengan pola array role serupa (guru, `teacher-profile-summary`, `leave-requests`, dll) agar konsisten

## Skema database baru

File migrasi idempotent mengikuti pola `migrations/`: **`migrations/2026_sdm_tables.sql`** (`CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, sesuai `migration_add_ta_all_tables.sql`).

```
hr_contracts        -- id, teacher_id, tenant_id, jenis(PKWT/PKWTT/Honorer), nomor,
                       tanggal_mulai, tanggal_selesai, status(aktif/habis/diakhiri/diperpanjang),
                       file_url, catatan, created_at/by
hr_documents        -- id, nomor_surat, jenis(surat_keterangan_kerja/surat_tugas/pengangkatan/lainnya),
                       teacher_id, tenant_id, tanggal, perihal, isi, file_url(docx/pdf), created_at/by
kpi_indicators      -- id, nama, kategori(guru|staf), bobot, satuan, target_default,
                       sumber(manual|kehadiran|evaluasi), aktif
kpi_periods         -- id, nama, jenis(bulanan|semester|tahunan), tanggal_mulai, tanggal_selesai,
                       status(draft|aktif|published)
kpi_scores          -- id, period_id, teacher_id, tenant_id, indicator_id, nilai_aktual,
                       pencapaian(%), skor, penilai_id, catatan, created_at
hr_status_history   -- id, teacher_id, tenant_id, perubahan(json), tanggal_efektif, dibuat_oleh  (audit riwayat)
```

Tidak perlu tabel untuk: biodata, dokumen pribadi, riwayat jabatan (sudah ada di `teachers`, `teacher_assignments`, `teacher_family`).

## Template dokumen

Folder baru **`SDMTEMPLATE/`** dengan file `.docx` (pola docxtemplater seperti `src/routes/sk-guru.js:422-511`):
- `surat_keterangan_kerja.docx`
- `surat_tugas.docx`
- `kontrak_kerja.docx`
- `surat_pengangkatan.docx`

Output ke `public/downloads/` (pola yang sama dengan SK).

## Modul, pemakaian ulang & endpoint baru

| Modul | Endpoint yang DIPAKAI ULANG | Endpoint BARU (`/api/sdm/*`) |
|---|---|---|
| Pegawai & riwayat | `GET /api/admin/teachers`, `GET /api/admin/teachers/:id`, `PUT /api/admin/teachers/:id`, `POST /api/admin/teachers/:id/assignments/bulk`, `PUT /api/admin/teachers/:id/transfer`, `GET /api/admin/teacher-profile-summary` | `GET /api/sdm/status-history/:teacherId` |
| Cuti & izin | `GET /api/admin/leave-requests`, `PUT /api/admin/leave-requests/:id/status` | — (opsi tambah kuota cuti nanti) |
| Kontrak kerja | — (multer upload pola `admin.js:75-134`) | `CRUD /api/sdm/contracts`, `POST /api/sdm/contracts/:id/upload` |
| Surat & arsip | pola generator `sk-guru.js` | `POST /api/sdm/documents/generate`, `GET /api/sdm/documents`, `GET /api/sdm/documents/:id/file` |
| Laporan & rekap | rekap absensi `/api/admin/attendance-monthly`, `/api/admin/attendance-export-pdf` | `GET /api/sdm/reports/employees` (Excel via `xlsx`, pola BSI export) |
| Penggajian (penuh) | `/api/admin/payroll/settings`, `/deduction-settings`, `PUT /admin/teachers/:id/salary-field`, `POST /generate`, `GET /history`, `POST /import`, `POST /send-slip-email`, `POST /send-bulk`, `GET /bsi-export` | — (UI SDM memanggil endpoint yang sama, tidak ada logika ganda) |
| KPI | data kehadiran (`attendance-monthly`), skor evaluasi (`/api/evaluations/summary`) | `CRUD /api/sdm/kpi/indicators`, `CRUD /api/sdm/kpi/periods`, `POST /api/sdm/kpi/scores` (manual), `POST /api/sdm/kpi/auto-fill`, `GET /api/sdm/kpi/result?period_id=` |
| Onboarding | `temp_teachers`, `profile_access_requests`, `GET /api/admin/teacher-profile-summary` | `GET /api/sdm/onboarding`, `POST /api/sdm/onboarding/:id/approve` |
| ID Card | `src/routes/idcard.js` (status template & kartu) | `GET /api/sdm/idcard-status` |
| Pengingat otomatis | `node-cron` (scheduler sudah jalan), `waha.js`/`whatsapp.js` | `scheduler` job: kontrak habis (30/14/7 hari), dokumen belum lengkap, ulang tahun kerja |

**Rumus KPI:** `skor_indikator = min(100, nilai_aktual / target × 100)` → `nilai_akhir = Σ (bobot/100 × skor_indikator)` → grade: ≥90 A, ≥80 B, ≥70 C, selain itu D. Indikator `sumber=kehadiran` terisi otomatis dari rekap absensi, `sumber=evaluasi` dari rata-rata skor evaluasi, sisanya dinilai manual oleh SDM/kepala sekolah.

## Fase pengerjaan

**Fase 1 — Fondasi (wajib lebih dulu)**
- Middleware `authenticateSDM` + penyesuaian array role (5 poin di atas)
- `src/routes/sdm.js` + mounting di `server.js`
- `migrations/2026_sdm_tables.sql`
- Halaman `sdm-dashboard.html` + navigasi (tombol SDM di `dashboard.html`, link dari tab HR `master-dashboard.html`)
- Modul **Pegawai & Riwayat**: daftar lintas sekolah/unit, detail biodata, dokumen, riwayat jabatan & status

**Fase 2 — Administrasi kepegawaian**
- Cuti & izin (approve/reject + kalender bulanan)
- Kontrak kerja (CRUD + upload scan + penanda kontrak akan habis)
- Surat keterangan & arsip dokumen (generator `.docx` + template `SDMTEMPLATE/`)

**Fase 3 — Penggajian & laporan**
- Modul payroll penuh di SDM (memakai endpoint yang ada)
- Laporan & rekap SDM + export Excel/PDF

**Fase 4 — KPI**
- Setup indikator (bobot, target, kategori guru/staf), periode penilaian
- Input nilai manual + auto-fill kehadiran & evaluasi, hasil akhir & grade, riwayat KPI

**Fase 5 — Pendukung**
- Onboarding & registrasi guru, monitoring ID Card
- Pengingat otomatis (cron + WhatsApp) sebagai tahap terakhir

## Verifikasi

1. `node --check` untuk setiap file JS yang diubah/dibuat
2. Uji otomatis di browser headless (Puppeteer + mock API) seperti pengujian rekap absensi sebelumnya: login sebagai SDM (token + assignment jabatan SDM), klik setiap tab, pastikan request ke endpoint benar
3. Uji akses: SDM `YPWILUTIM` melihat semua sekolah; SDM tenant sekolah **tidak** bisa melihat sekolah lain; guru biasa mendapat 403 di endpoint `/api/sdm/*`
4. Uju dokumen: generate surat/kontrak → cek file `.docx` muncul di `public/downloads/` dan bisa diunduh
5. `git diff` ditinjau sebelum commit; deploy: `git pull` di hosting → **restart app Node.js** (perubahan server) → Ctrl+F5

## Risiko & catatan

- **Perubahan array role harus dilakukan bersamaan.** Kalau 'sdm' belum ditambahkan di `auth.js`, `payroll.js`, dan `admin.js`, halaman SDM akan berjalan tapi data gagal dimuat (403 / `tenant_id diperlukan`). Sertakan dalam satu commit dengan modul.
- **Payroll dua pintu** (sesuai keputusan): tidak ada logika payroll yang diubah/digandakan — SDM hanya UI baru di atas endpoint yang sama. Beri catatan "Kelola juga di Admin/Bendahara" pada judul modul payroll SDM.
- **Enum `users.role` tidak diubah** (hanya `admin|guru`) — jadi peran SDM murni lewat `jabatan_di_unit`, sama seperti operator/TU/bendahara saat ini. Pemberian peran dilakukan di master dashboard (opsi "SDM" ditambahkan ke `#assignJabatan`) atau via endpoint assignment yang ada.
- Folder `public/uploads/hr/` dan `SDMTEMPLATE/` harus ikut ter-deploy & writable di hosting cPanel.
- File `.docx` template perlu dibuat sekali lalu di-commit ke repo (jangan generate template saat runtime).
