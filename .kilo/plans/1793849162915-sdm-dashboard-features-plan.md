# SDM Dashboard Feature Plan

## Goal
Tambahkan 3 fitur pada `public/sdm-dashboard.html` / `public/sdm-dashboard.js` dan backend `src/routes/sdm-dashboard.js`:

1. **Manajemen Guru**: CRUD guru (tambah/edit/hapus lunak) dengan modal.
2. **Input Absensi Manual**: tab baru dengan filter pertenant + bulan, grid bulanan, penanda merah hari aktif tanpa record, warna izin merah (pending/rejected) / hijau (approved), modal tambah absensi per guru per bulan.
3. **Rekapitulasi per Sekolah**: baris sekolah bisa diklik untuk menampilkan detail.

## Assumptions
- Akses tetap dibatasi `getSdmAllowedTenants` (SDM sekolah hanya tenant sendiri, SDM pusat semua tenant).
- Hapus guru dilakukan soft delete (`status_aktif = 0`) agar riwayat absensi/payroll tidak rusak.
- Hari aktif = hari yang memiliki minimal 1 record `attendance_logs` (jenis masuk/pulang) pada tenant tersebut; bukan dari leave request.
- Input manual izin/sakit/cuti/dinas luar langsung membuat `leave_requests` status `approved` + `attendance_logs` (metode `dashboard`) agar tampil hijau.
- Izin yang diajukan guru tetap bisa pending (merah) sampai disetujui admin.

## Architecture
- Frontend tab baru: `data-tab="manualAttendance"` → `#manualAttendanceTab`.
- Backend tetap di `src/routes/sdm-dashboard.js`, dengan endpoint SDM-scoped.
- Reuse logika `admin/attendance-monthly` dengan ekstraksi helper `src/utils/attendanceMonthly.js` agar tidak duplikasi.
- Detail sekolah memakai endpoint baru `school-detail`.

## Backend Tasks

### A. Teacher CRUD (`src/routes/sdm-dashboard.js`)
- `POST /sdm-dashboard/teachers`
  - body: `nama, nik, nip, tenant_id, jabatan_di_unit, status_kepegawaian, tmt, no_wa, email, status_aktif`
  - validasi tenant allowed; insert `teachers`; insert `teacher_assignments`.
  - validasi NIP wajib jika `tmt <= 2 tahun lalu` (trigger DB).
- `PUT /sdm-dashboard/teachers/:id`
  - update data guru + assignment tenant/jabatan (hanya tenant allowed).
- `DELETE /sdm-dashboard/teachers/:id` (soft delete)
  - set `status_aktif = 0` pada `teachers` dan `teacher_assignments` terkait tenant allowed.

### B. Manual Attendance Monthly (`src/routes/sdm-dashboard.js`)
- `GET /sdm-dashboard/manual-attendance-monthly?tenant_id=&bulan=&tahun=`
  - validasi tenant allowed.
  - query teachers assigned.
  - query `attendance_logs` bulan tersebut.
  - query `leave_requests` semua status (`pending/approved/rejected`) bulan tersebut.
  - hitung `activeDays` hanya dari `attendance_logs`.
  - return `{ data, daysInMonth, activeDays, leave_requests }`.
- `POST /sdm-dashboard/manual-attendance`
  - body: `teacher_id, tenant_id, tanggal, jenis, status, waktu, keterangan`.
  - validasi teacher assigned ke tenant allowed.
  - jika `jenis` in `izin/sakit/cuti/dinas_luar`: insert `leave_requests` status `approved`, lalu `attendance_logs` (metode `dashboard`) seperti endpoint approval admin.
  - jika `masuk/pulang`: insert `attendance_logs` langsung.
- `DELETE /sdm-dashboard/manual-attendance/:id`
  - hapus hanya record dengan metode `dashboard` dan tenant allowed (hindari menghapus scan asli).

### C. School Detail (`src/routes/sdm-dashboard.js`)
- `GET /sdm-dashboard/school-detail?tenant_id=&days=7`
  - validasi tenant allowed.
  - info tenant + daftar guru + ringkasan kehadiran N hari terakhir (hadir/terlambat/alpha) + jumlah izin pending.

### D. Refactor Shared Helper
- Buat `src/utils/attendanceMonthly.js` berisi fungsi `buildMonthlyAttendance(tenantId, bulan, tahun)` yang dipakai admin dan SDM, dengan opsi `leaveStatusFilter` (`all` atau `approved`).

## Frontend Tasks (`public/sdm-dashboard.html` + `public/sdm-dashboard.js`)

### 1. Manajemen Guru
- Tambah tombol `Tambah Guru` di header tab.
- Modal `teacherModal` dengan field: nama, nik, nip, tenant, jabatan, status kepegawaian, tmt, no_wa, email.
- Tabel: tambah kolom Aksi (edit/hapus).
- Fungsi: `openTeacherModal`, `saveTeacher`, `editTeacher`, `deleteTeacher`.

### 2. Input Absensi Manual (tab baru)
- Nav item + tab `manualAttendance`.
- Filter: `manualTenantSelect`, `manualBulan`, `manualTahun`, tombol Muat.
- Legend: merah = hari aktif tanpa record (TK), izin merah = pending/rejected, hijau = approved.
- Render grid bulanan mirip rekap, dengan warna per sel.
- Modal `manualAttendanceModal`: pilih guru (dari tenant), tanggal, jenis, status, waktu, keterangan; submit lalu reload grid.

### 3. Rekapitulasi per Sekolah
- Tabel `#schoolRecapTable`: tambah class `cursor-pointer` dan `onclick="showSchoolDetail('${tenant_id}','${nama}')"`.
- Modal detail: info sekolah + tabel guru dengan ringkasan kehadiran 7 hari + izin pending.
- Backend data dari `school-detail`.

## Validation
- `node --check public/sdm-dashboard.js`
- `node --check src/routes/sdm-dashboard.js`
- Manual test:
  - Tambah guru pada tenant allowed; list ter-refresh.
  - SDM sekolah tidak bisa tambah guru ke tenant lain.
  - Grid manual menampilkan TK merah hanya pada hari aktif.
  - Izin pending merah, approved hijau.
  - Modal tambah absensi menyimpan dan grid ter-update.
  - Klik sekolah menampilkan detail.

## Risks
- Trigger DB NIP dapat menolak insert jika TMT >= 2 tahun dan NIP kosong; frontend wajib validasi.
- Duplikasi logika monthly; mitigasi dengan helper shared.
- Grid besar untuk banyak guru; pertahankan tanpa pagination seperti existing recap.

## Optional Migration
- Jika ingin membedakan metode input manual, tambahkan enum:
  `ALTER TABLE attendance_logs MODIFY metode ENUM('dashboard','scanner','manual') NOT NULL DEFAULT 'scanner';`
- Kode dapat menggunakan `dashboard` tanpa migrasi.
