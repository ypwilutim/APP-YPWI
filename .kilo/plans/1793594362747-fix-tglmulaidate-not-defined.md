# Plan: SK Guru — Guru Multi-Jabatan (satu SK per guru per sekolah) + tuntaskan verifikasi manual bulk

## Tujuan
1. Satu guru multi-jabatan di sekolah yang sama tidak menghasilkan >1 SK (dedup per teacher_id + tenant_id; gabungkan jabatan di satu SK).
2. Tuntaskan fitur verifikasi manual bulk yang saat ini setengah jalan (backend selesai, frontend rusak): guru belum layak dapat diverifikasi manual agar tetap bisa generate SK.
3. Perbaiki duplikasi serangkaian pada semua alur SK yang JOIN teacher_assignments (single-teacher, preview, download, approval, scheduler) dengan pola deterministik yang sama.

## Konteks & temuan (sudah diverifikasi di kode)
- `teacher_assignments` (struktur_db_local.sql:805): (id, teacher_id, tenant_id, jabatan_di_unit, class_id, created_at, updated_at). Tanpa kolom flag "utama". Satu guru boleh >1 baris (multi jabatan di sekolah sama ATAU assignment di beberapa sekolah).
- 9 situs query duplikatif JOIN teacher_assignments tanpa dedup di `src/routes/sk-guru.js`: line 124 (GET /teachers/:id/data), 424 (POST /generate), 675 (GET /file/:skId download — pake `formatJabatan(teacher.unit)` baris 704), 874 (POST /preview), 985 (bulk-candidates baseQuery), 1102 (bulk-generate per-teacher), 1251 & 1276 (GET /approval), 1348 (approval detail). Setiap guru dengan N assignment muncul sebagai N baris kandidat.
- `scheduler.js:522-530` (approvedTeachers) juga JOIN teacher_assignments tanpa dedup → auto-generate 1 Januari bisa menghasilkan >1 SK per guru. scheduler.js:617 ada bug `birthDate` undefined (crash auto-generate, tercatat di plan lama).
- `employment_rules`: (job_title_pattern unique, min_years). Kualifikasi = yearsOfService dari `teachers.tmt` (level GURU, bukan per assignment) >= min_years yang dicocokkan via pola jabatan_di_unit atau employment_status_rules (by status_kepegawaian).
- `existingSkSet` di bulk-candidates (sk-guru.js:988-989): `SELECT DISTINCT teacher_id FROM sk_guru` — level guru. Dengan dedup per tenant ini perlu jadi per (teacher_id, tenant_id), else guru yang punya SK di sekolah A akan terblokir di sekolah B.
- NIY dibangun dari tenant_pk + tmt + tanggal lahir + seq (per sekolah).

## State implementasi saat ini (handoff)
- Fix `tglMulaiDate` (plan lama) SUDAH diimplementasi dan server sudah restart (PID baru, port 2000). Selesai.
- Verifikasi manual bulk — BACKEND SELESAI: gate kelayakan sk-guru.js:1116-1129, INSERT kolom `manual_verified` baris 1158-1161, response flag baris 1167, `ensureColumn` di server.js baris 1192.
- Verifikasi manual bulk — FRONTEND BELUM LENGKAP / RUSAK:
  - Diterapkan: loadSkBulkCandidates mapping (`selected: r.qualified && !r.already_has_sk`, `manual_verified: false`, info hint), toggleSkBulkSelectAll (hanya yang qualified/terverifikasi), toggleSkBulkRow, fungsi toggleSkBulkManualVerify (sudah ada).
  - BELUM diterapkan: renderSkBulkTable masih lama (colspan 11 sel, header sudah 12 kolom → tidak sinkron; tidak ada sel "Verifikasi"; checkbox utama tidak disabled untuk belum-layak-belum-diverifikasi), payload submitSkBulkGenerate belum kirim `manual_verified`, hasil generate belum tampilkan badge [verifikasi manual].
  - Akibat saat ini: SEMUA guru belum layak ditolak gate backend (karena tidak ada manual_verified yang dikirim) — verifikasi manual tidak bisa dilakukan sama sekali.

## Keputusan (rekomendasi default; tandai Q1–Q4 sebagai keputusan terbuka untuk konfirmasi di chat baru)
- Q1 (PENTING): Dedup key = (teacher_id, tenant_id) → satu SK per guru per sekolah. Multi-jabatan di sekolah sama → 1 SK. Guru di beberapa sekolah → 1 SK per sekolah (SK terbit untuk unit/sekolah tertentu). Rekomendasi: YA. (Jika user ingin 1 SK total untuk seluruh sekolah, jabatan/tenant/tenant_pk/NIY akan ambigu — disarankan tetap per sekolah.)
- Q2: Jabatan yang ditulis di SK untuk guru multi-jabatan di satu sekolah = gabungan semua jabatan di sekolah itu (contoh "Guru / Wali Kelas / Wakasek"), diterapkan formatJabatan per komponen. Alternatif: jabatan utama saja, atau operator pilih per guru via dropdown di UI. Rekomendasi: gabungan otomatis.
- Q3: "Assignment utama" (mengemudi NIY tenant_pk, unit, dan rule matching) = assignment terlama (`MIN(created_at)`, tie-break `MIN(id)`), deterministik. Tanpa ubah schema sekarang.
- Q4: Rule kelayakan = paling ketat (`MAX(min_years)`) di antara assignment guru pada sekolah itu. Alternatif: rule assignment utama saja. Rekomendasi: paling ketat (konservatif).
- Q5: Scope = semua alur SK (bulk + single-teacher + preview/generate/download + approval Desember + scheduler), bukan hanya bulk. Rekomendasi: semua, karena akar masalah sama.
- Q6: Perbaiki bug `birthDate` undefined di scheduler.js:617 sekarang? Rekomendasi: YA (memblokir auto-generate 1 Januari). Jika tidak, tandai sebagai terpisah.

## Tugas (urutan pelaksanaan)
1. Tuntaskan frontend verifikasi manual (`public/js/admin-dashboard.js`):
   - renderSkBulkTable: colspan 11 → 12; tambah sel "Verifikasi" (checkbox hanya untuk guru belum layak & belum punya SK, onchange panggil toggleSkBulkManualVerify); checkbox utama disabled jika belum layak & belum diverifikasi (title "Belum layak — centang Verifikasi dulu"); badge status guru belum-layak-tetap-diverifikasi jadi amber "⚠ Verifikasi Manual (X/Y thn)".
   - submitSkBulkGenerate payload: tambah `manual_verified: !!r.manual_verified` per baris.
   - Hasil generate: nama yang diverifikasi ditandai tag `<span class="text-amber-600 font-medium">[verifikasi manual]</span>`.
   - Backend sudah siap (gate + INSERT + ensureColumn). Setelah ini, verifikasi manual berfungsi end-to-end.
2. Helper dedup assignment (`src/routes/sk-guru.js`): fungsi pickPrimaryAssignment(rows) → primary = terlama (created_at, tie-break id); combineJabatan(rows) → string gabungan unik dari jabatan_di_unit per (teacher_id, tenant_id).
3. GET /bulk-candidates (sk-guru.js:985): query tambah `ORDER BY t.id, ta.created_at, ta.id`; dedup di JS by (teacher_id, tenant_id); gabungkan jabatan untuk tampilan; qualified dihitung per guru (TMT); rule pakai Q4; existingSkSet ubah jadi `SELECT DISTINCT teacher_id, tenant_id FROM sk_guru` dan cek per baris; response sertakan `jabatan_list` untuk tampilan.
4. POST /bulk-generate (sk-guru.js:1102): per-teacher query tambah `ORDER BY ta.created_at, ta.id`; pakai primary + jabatan gabungan untuk buildSkData; guard duplikat (teacher_id+tenant_id) dalam satu batch seperti usedNoSurat; gate kelayakan (manual_verified) tetap.
5. Alur single-teacher (sk-guru.js:124 GET /teachers/:id/data, 424 POST /generate, 675 GET /file/:skId download, 874 POST /preview): ganti `const [teacher] = ...` dengan pilih primary deterministik (fetch-all lalu pick primary, atau `ORDER BY ta.created_at, ta.id LIMIT 1`); jabatan di SK = gabungan (Q2); `tentang` tetap pakai nama_sekolah.
6. GET /approval (sk-guru.js:1251, 1276, 1348): dedup (teacher_id, tenant_id) — GROUP BY SQL atau dedup JS.
7. scheduler.js: dedup approvedTeachers by (teacher_id, tenant_id); perbaiki `birthDate` undefined (baris 617) jika Q6 = ya; selaraskan format noSurat scheduler (baris 587) dengan flow manual (opsional).
8. UI opsional (hanya jika Q2 = operator pilih): dropdown assignment di bulk edit modal & modal tunggal. Jika Q2 = gabungan otomatis, cukup tampilkan jabatan gabungan di tabel bulk & modal tunggal.

## Risiko
- String jabatan gabungan panjang di template `<<JABATAN>>` (SKTEMPLATE/test.html baris 126, 136, 191) — cek apakah masih muat di dokumen.
- already_has_sk berubah dari level guru menjadi per (teacher_id, tenant_id): guru yang punya SK di sekolah A tidak lagi otomatis "Sudah punya SK" di baris sekolah B. Ini perbaikan sengaja, bukan regresi.
- Dedup JS butuh ORDER BY deterministik; tanpa itu "assignment utama" bisa berganti antar refresh.
- Tidak ada migrasi schema untuk dedup (tidak perlu kolom is_primary sekarang). manual_verified sudah via ensureColumn (server.js:1192).
- Jika Q2 = operator pilih, butuh tambahan UI state & validasi backend bahwa chosen assignment milik guru tsb.

## Validasi
1. `node --check src/routes/sk-guru.js server.js scheduler.js public/js/admin-dashboard.js`.
2. Restart server; buka tab Bulk SK Guru: guru dengan 3 jabatan di 1 sekolah → 1 baris saja dengan jabatan gabungan; guru di 2 sekolah → 2 baris (1 per sekolah).
3. Guru belum layak: tanpa centang "Verifikasi" → skipped dengan alasan "Belum layak... Centang verifikasi manual"; dengan centang → generate sukses, `sk_guru.manual_verified = 1`, hasil generate menunjukkan tag [verifikasi manual].
4. Modal SK tunggal: refresh berulang → assignment yang dipilih konsisten (tidak berganti).
5. Approval Desember & scheduler: tidak ada duplikat SK per guru per sekolah.
6. Regression: guru single-assignment layak → perilaku tetap sama seperti sebelum.

## File terkait
- `src/routes/sk-guru.js` (bulk-candidates, bulk-generate, single-teacher, preview, download, approval)
- `server.js` (ensureColumn manual_verified — sudah terpasang)
- `scheduler.js` (auto-generate 1 Januari)
- `public/js/admin-dashboard.js` (renderSkBulkTable, submitSkBulkGenerate)
- `public/admin-dashboard.html` (header kolom Verifikasi + colspan — sudah terpasang)

## Keputusan terbuka (bawa ke chat baru; jawab salah satu dulu, yang paling materi adalah Q1)
- Q1: dedup per sekolah atau per guru total? [Rekom: per sekolah]
- Q2: jabatan di SK gabungan / utama / operator pilih? [Rekom: gabungan]
- Q3: scope semua alur atau bulk saja? [Rekom: semua]
- Q4/Q6: perbaiki birthDate scheduler sekarang? [Rekom: ya]

Untuk melanjutkan: implementasi sesuai tugas di atas, atau tanya Q1–Q4 dulu jika ingin mengubah rekomendasi.