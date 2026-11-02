# Rencana: SK Guru — Generate Berbasis Isi Field (Field-Driven)

## Tujuan
Saat membuat SK Guru di Admin Dashboard: pilih guru + jenis SK → field auto-fill. Setelah itu, **isi field adalah sumber kebenaran** — Preview dan Generate harus memakai apa yang tertulis di field, bukan hitungan otomatis backend.

## Keputusan Desain (sudah dikonfirmasi user)
1. Field editable `skTglMulai` (Periode SK/Masa Kerja) & `skTglSelesai` (Periode SK Berakhir) menjadi acuan `<<TGL_MULAI>>`, `<<TGL_SELESAI>>`, `<<PERIODE>>`. Checkbox "Gunakan Tanggal Hari Ini untuk Mulai" menulis bulan berjalan ke `skTglMulai`. Field readonly `skTglMulaiAuto` hanya tampilan saran (tidak dikirim backend).
2. "Tentang / Perihal" custom = **replace total**: teks di field dipakai apa adanya. Auto-fill tetap mengisi label default.
3. Lingkup: **hanya modal manual** di Admin Dashboard. Bulk Generate, approval Desember, dan auto-generate 1 Januari (scheduler.js) tetap otomatis — tidak diubah.

## Akar Masalah (mengapa preview/generate tidak mengikuti field)
1. `confirmGenerateSkDirect()` (tombol Generate SK / submit form) hanya mengirim `teacher_id, tentang_type, pt, tmt_custom, format` — tidak mengirim `no_surat`, `tgl_mulai_custom`, `tgl_selesai_custom`, `tentang` (`public/js/admin-dashboard.js:4573-4577`).
2. Backend `buildSkData` memprioritaskan DB untuk PT: `teacher.pt || pt || default` (`src/routes/sk-guru.js:321`).
3. Auto-fill guru menulis tanggal format Indonesia ("2 November 2026 M") ke `<input type="month">` (butuh "YYYY-MM") → field periode tampak kosong setelah pilih guru (`admin-dashboard.js:4494-4501`, data dari `sk-guru.js:159-164,183-184`).
4. Checkbox `skUseTodayAsStart` hanya mengisi field readonly, tidak pernah mempengaruhi payload (`admin-dashboard.js:3931-3954`).

## Perubahan

### A. Backend — `src/routes/sk-guru.js`
1. **`buildSkData()` — prioritaskan field:**
   - PT: `const ptFormatted = pt || teacher.pt || 'S1/PEND. SOSIOLOGI/UNM/2019';` (field didahulukan).
   - Tentang: jika `tentangCustom` non-empty → pakai apa adanya (replace total); else `tentag_label + ' (' + teacher.nama_sekolah + ')'`.
   - No. Surat, TMT, Tgl Mulai, Tgl Selesai: sudah field-first (`noSuratCustom || auto`, `tmt_custom || teacher.tmt`, `tglMulaiCustom`/`tglSelesaiCustom` branches) — pertahankan.
2. **`GET /teachers/:id/data`**: tambahkan `tgl_mulai_month` dan `tgl_selesai_month` (format `YYYY-MM`) selain string tampilan Indonesia, supaya auto-fill ke input month valid.
3. **Tidak diubah:** logika `sk_sequence`, NIY, status/jabatan/unit/TTL/Nama (tetap dari DB), bulk-generate, approval, settings.

### B. Frontend — `public/js/admin-dashboard.js`
1. **`confirmGenerateSkDirect()`** (generate langsung tanpa preview): kirim payload lengkap sama seperti `confirmGenerateSk()` — tambahkan `no_surat` (dari `skNoSurat`), `tgl_mulai_custom` (`skTglMulai`), `tgl_selesai_custom` (`skTglSelesai`), `tentang` (`skTentang`).
2. **`selectSkTeacher()`**: isi `skTglMulai`, `skTglSelesai`, `skTglMulaiAuto` dari `d.tgl_mulai_month` / `d.tgl_selesai_month` (fallback ke `d.tgl_mulai`/`d.tgl_selesai` jika tidak ada). `skTmt` tetap dari `d.tmt_formatted` (sudah `YYYY-MM`).
3. **`updateSkAutoDates()`**: checkbox `skUseTodayAsStart` — jika dicentang, tulis bulan berjalan (`YYYY-MM`) ke `skTglMulai`; jika tidak dicentang, kosongkan `skTglMulai` (kembali ke otomatis). Field readonly `skTglMulaiAuto` tetap diisi sebagai tampilan saran (dari checkbox / `skTglMulai` / hari ini).
4. **`updateSkTentangFromType()`**: pertahankan auto-fill label + unit saat jenis SK berubah (sesuai spesifikasi "pilih jenis SK → field terisi otomatis"). Catatan: mengganti jenis SK setelah user edit tentang akan menimpa tulisan user — perilaku yang dapat diterima.
5. **`previewSkGuru()`**: sudah mengirim semua field — tidak perlu ubah; setelah perbaikan A1, preview akan mengikuti field.
6. **`confirmGenerateSk()`** (download dari modal preview): sudah mengirim semua field — tidak perlu ubah.

### C. Tidak berubah
- `public/admin-dashboard.html` (field-field sudah ada).
- `scheduler.js` (auto-generate 1 Januari) dan alur bulk/approval.
- Tidak ada migrasi DB.

## Risiko / Catatan
- `scheduler.js:617` merujuk variabel `birthDate` yang tidak terdefinisi (potensi error di auto-generate) — di luar lingkup; flag saja, tidak diperbaiki kecuali diminta.
- Jika user mengisi No. Surat custom, `sk_sequence` tetap naik saat generate (perilaku lama dipertahankan agar NIY tetap punya nomor urut).
- Edge case yang harus tetap berjalan: No. Surat kosong → nomor otomatis; TMT kosong → fallback TMT guru; periode mulai kosong + selesai diisi → backend hitung mulai dari selesai; keduanya kosong → otomatis (Guru 1 tahun / Pimpinan 4 tahun s.d. 31 Desember); Januari → mulai 1 Januari; PT kosong → fallback `teacher.pt` → placeholder default; Tentang kosong → label otomatis + unit.

## Validasi
1. Buka modal Buat SK → pilih guru → semua field terisi; input month menampilkan nilai (tidak kosong).
2. Ubah No. Surat / Tentang / PT / TMT / Periode Mulai / Periode Selesai → klik Preview → modal preview menampilkan persis isi field.
3. Generate langsung dari form (tanpa preview) → file PDF/DOCX memuat isi field yang diubah.
4. Kosongkan No. Surat → nomor otomatis `QR.001/02/YPWI-LT/...` terbit dan sequence naik.
5. Cek tabel `sk_guru`: kolom `no_surat`, `tentang`, `pt`, `tmt`, `tgl_mulai`, `tgl_selesai` sesuai isi field.
6. Regression: Bulk Generate, list persetujuan Desember, dan auto-generate scheduler tetap berfungsi.

## File yang Disentuh
- `src/routes/sk-guru.js` — `buildSkData()`, `GET /teachers/:id/data`
- `public/js/admin-dashboard.js` — `confirmGenerateSkDirect()`, `selectSkTeacher()`, `updateSkAutoDates()`
