# Plan: Perbaikan Pengiriman Data `complete-profile.html`

## Tujuan
Memastikan form profil guru dapat dikirim (submit) tanpa terblokir validasi browser, dengan feedback error yang jelas, dan backend menangani data secara robust.

## Lingkup
- Frontend: `public/complete-profile.html`
- Backend: `src/routes/admin.js` (`PUT /api/public/teachers/:teacherId`, `GET /api/public/teachers/:teacherId`)
- Opsional: `src/routes/auth.js` (`/profile-complete/:teacherId`)

## Root Cause yang Ditemukan
1. Form tidak memakai `novalidate`, sehingga validasi HTML5 pada field hidden/required bisa memblokir submit sebelum handler JS berjalan.
2. `validateStep()` hanya mengecek step 1 dan 2; step 3 tidak divalidasi di JS.
3. `updatePendidikanFields()` tidak dipanggil saat inisialisasi untuk nilai kosong, sehingga field hidden `jurusan`, `nama_sekolah_pendidikan`, `tahun_angkatan` bisa tetap `required`.
4. Upload dokumen (`uploadDocument`) tidak dicek sukses/gagal sebelum submit; link hidden bisa kosong.
5. Backend kurang robust terhadap kolom opsional, nilai `0`, JSON invalid, dan duplicate user/email.

## Task Frontend (`public/complete-profile.html`)
1. Tambahkan `novalidate` pada `<form id="profileForm">`.
2. Di `DOMContentLoaded`, panggil `updatePendidikanFields(document.getElementById('pendidikan_terakhir').value)` setelah `initPendidikanToggle()`.
3. Tambahkan validasi step 3 di `validateStep()`:
   - `pendidikan_terakhir` wajib.
   - Untuk `SD/SMP/SMA/SMK/S1/S2/S3`, `tahun_angkatan` wajib.
   - Untuk `SMK/S1/S2/S3`, `jurusan` dan `nama_sekolah_pendidikan` wajib.
   - Set `required=false` pada field yang hidden.
4. Tambahkan helper `clearHiddenRequired()` yang dipanggil sebelum submit dan saat pindah step: semua input/select/textarea dengan `offsetParent === null` dibuat `required=false`.
5. Perbaiki `uploadDocument()`:
   - `await` hasil fetch.
   - Jika `!data.success`, tampilkan Swal error dan kembalikan `false`.
   - Hanya set `link_*` jika sukses.
   - Tampilkan status upload di UI.
6. Perbaiki submit handler:
   - Panggil `clearHiddenRequired()` di awal.
   - Validasi semua link dokumen sebelum fetch.
   - Tampilkan pesan error dari response body (`errJson.message`) jika ada.
   - Pastikan `submitBtn` re-enabled pada semua jalur (sudah ada, rapikan).
7. Tambahkan logging ringan (`console.error`) untuk kegagalan fetch agar mudah debug.

## Task Backend (`src/routes/admin.js`)
1. Pada `PUT /public/teachers/:teacherId`:
   - Terima `link_foto`, `link_ktp`, `link_kk`, `link_ijazah` dari `req.body` dan update jika disediakan.
   - Ubah penentuan nilai final agar tidak memakai `||` untuk `0` (gunakan `!== undefined ? value : existing`).
   - Jika `data_keluarga` kosong string, ubah ke `null` atau `"[]"` valid.
   - Tangkap error SQL dan kembalikan pesan spesifik:
     - `ER_DUP_ENTRY`
     - foreign key constraint
     - check constraint (`json_valid`)
     - kolom tidak ada
   - Log error lengkap di server.
2. Pada pembuatan user:
   - Jika username (email) sudah ada, update user tersebut (`guru_id`, `is_profile_complete`) alih-alih insert yang gagal.
3. Pada `GET /public/teachers/:teacherId`:
   - Bungkus pemilihan kolom `link_ktp`, `link_kk`, `link_ijazah`, `status_perkawinan`, `jumlah_anak` dengan deteksi kolom agar tidak 500 pada DB lokal.
4. Pastikan response error tetap JSON (`success:false`, `message`).

## Task Backend (`src/routes/auth.js`)
1. Endpoint `/profile-complete/:teacherId` dan `/pendidikan-kode` tetap no-auth; pastikan error handling mengembalikan JSON.
2. Validasi `pendidikan_terakhir` pada endpoint pendidikan-kode (sudah ada).

## Validasi Setelah Implementasi
1. Buka `complete-profile.html?teacher_id=...`.
2. Isi semua step, pastikan bisa lanjut tanpa field hidden required memblokir.
3. Klik “Kirim Data”; pastikan request `PUT /api/public/teachers/:id` terkirim dan status 200.
4. Cek DB: `teachers`, `teacher_assignments`, `teacher_family`, `users.is_profile_complete=1`.
5. Uji kasus gagal:
   - kosongkan dokumen → pesan Swal jelas.
   - duplikat penugasan → pesan jelas.
   - email duplikat → backend tidak 500.

## Risiko
- Perubahan validasi frontend bisa mengubah perilaku lama yang mengandalkan native validation; perlu uji semua status perkawinan dan tingkat pendidikan.
- Backend error handling harus tidak membocorkan detail sensitif; cukup pesan umum + log server.

## Open Questions
- Apakah DB yang dipakai adalah hosting (dengan kolom `status_perkawinan`, `link_ktp`, dll) atau local? Plan mengasumsikan hosting; jika local, jalankan migrasi schema terlebih dahulu.
