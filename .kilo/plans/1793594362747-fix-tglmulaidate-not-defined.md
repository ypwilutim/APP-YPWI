# Perbaikan: ReferenceError "tglMulaiDate is not defined" di buildSkData

## Konteks & Root Cause
- `buildSkData()` (`src/routes/sk-guru.js:285-407`) hanya menghitung **string tampilan Indonesia** `tglMulai`/`tglSelesai` (baris 333-380), tetapi baris 384-385 merujuk objek Date `tglMulaiDate`/`tglSelesaiDate` yang **tidak pernah didefinisikan** → `ReferenceError` setiap kali fungsi dipanggil.
- `tmtDate` sudah didefinisikan (baris 288), sehingga baris 386 (`tmtMonthValue`) aman. Hanya 2 variabel ini yang bermasalah.
- **Semua pemanggil `buildSkData` saat ini crash (500):**
  - `POST /api/sk-guru/preview` — `sk-guru.js:885`
  - `POST /api/sk-guru/generate` — `sk-guru.js:445`
  - `GET /api/bulk-candidates` — `sk-guru.js:1004` (error yang dilaporkan user)
  - `POST /api/bulk-generate` — `sk-guru.js:1123`
- `scheduler.js:581` punya fungsi `buildSkData` **sendiri** (signature berbeda) — tidak terdampak, jangan disentuh.
- Field `tglMulaiMonth`/`tglSelesaiMonth` (format `YYYY-MM`) dikonsumsi frontend untuk auto-fill `<input type="month">`: bulk edit modal (`admin-dashboard.js:4270,4272`), payload bulk-generate (`admin-dashboard.js:4388-4389`), dan auto-fill modal manual via `/teachers/:id/data` (`admin-dashboard.js:4739,4742,4745`).

## Keputusan Desain
1. **Turunkan objek Date dari string tampilan yang sudah dihitung** (`tglMulai`/`tglSelesai`), bukan menambah pelacakan Date di tiap cabang if/else. Lebih minim invasif, dan konsisten dengan `computePeriode` (baris 382) yang sudah mem-parsing string yang sama via `parseIndoDate`.
2. Gunakan helper yang sudah ada: `parseIndoDate` (`sk-guru.js:255`) untuk string Indonesia ("1 Januari 2026 M"), dengan fallback `parseDate` (`sk-guru.js:72`) yang menangani input mentah `YYYY-MM` / `YYYY-MM-DD` — penting karena `customEndInput` (baris 340) bisa berupa `"2026-12"` dari input month frontend, yang tidak bisa di-parse `parseIndoDate`.
3. Format output tetap `YYYY-MM` (kontrak existing dengan frontend). Tidak ada perubahan API contract, DB, atau frontend.
4. Scope: **hanya `src/routes/sk-guru.js`**.

## Perubahan

### Task 1 (wajib — perbaiki crash)
File: `src/routes/sk-guru.js`, di dalam `buildSkData`, sisipkan tepat **sebelum baris 384**:

```js
const tglMulaiDate = parseIndoDate(tglMulai) || parseDate(tglMulai);
const tglSelesaiDate = parseIndoDate(tglSelesai) || parseDate(tglSelesai);
```

Baris 384-385 tetap seperti semula (sudah merujuk variabel ini dengan benar):

```js
const tglMulaiMonth = tglMulaiDate ? tglMulaiDate.getFullYear() + '-' + String(tglMulaiDate.getMonth() + 1).padStart(2, '0') : '';
const tglSelesaiMonth = tglSelesaiDate ? tglSelesaiDate.getFullYear() + '-' + String(tglSelesaiDate.getMonth() + 1).padStart(2, '0') : '';
```

Cakupan semua cabang (terverifikasi terhadap logika baris 333-380):
- Custom mulai + selesai: `parseDate` menangani `YYYY-MM` dari input month; `parseIndoDate` menangani string Indonesia.
- Hanya custom selesai (baris 348-366): string hasil komputasi Indonesia → `parseIndoDate` ✓.
- Default (baris 367-380): "1 Januari <tahun> M" / tanggal hari ini / "31 Desember <tahun> M" → `parseIndoDate` ✓. Untuk `pimpinan` (`periodYears = 4`) bulan selesai tetap `-12`, tahun `currYear + 3` ✓.

### Task 2 (opsional, direkomendasikan — normalisasi tanggal selesai custom)
Di cabang `tglMulaiCustom` (baris 339-340), `customEndInput` mentah (`"2026-12"`) saat ini disimpan apa adanya ke `tglSelesai` → dokumen menampilkan "2026-12", `computePeriode` (baris 382) gagal parse → `periode: ''`, dan DB `sk_guru.tgl_selesai` berisi format mentah. Normalisasi:

```js
if (customEndInput) {
  const parsedEnd = parseDate(customEndInput);
  tglSelesai = parsedEnd
    ? parsedEnd.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) + ' M'
    : customEndInput;
}
```

Letakkan sebelum `computePeriode` (baris 382) agar `periode` juga benar. Ini memperbaiki alur bulk-edit (frontend mengirim `tgl_mulai_custom`/`tgl_selesai_custom` format `YYYY-MM`, lihat `admin-dashboard.js:4388-4389`) dan preview/generate manual.

## Risiko
- String tidak ter-parse oleh kedua helper → `tglMulaiMonth`/`tglSelesaiMonth` = `''` → frontend month input kosong (graceful, tidak crash). Tidak ada jalur exception baru.
- Task 2 mengubah isi `sk_guru.tgl_selesai` dan tampilan `<<TGL_SELESAI>>` untuk kasus custom-end dari format mentah menjadi format Indonesia — ini perbaikan arah, tetapi merupakan perubahan perilaku yang terlihat; bisa ditunda ke PR terpisah jika diinginkan.
- Tidak ada migrasi DB. Tidak ada perubahan response contract (field `tgl_mulai_month`/`tgl_selesai_month` sudah ada di response bulk-candidates, baris 1038-1039).

## Validasi
1. `node --check src/routes/sk-guru.js` (sintaks).
2. Restart server, login sebagai admin.
3. **Bulk candidates**: buka Admin Dashboard → SK Guru → tab Bulk (atau `GET /api/bulk-candidates?tenant_id=all`) — harus sukses, bukan 500; setiap baris punya `sk.tgl_mulai_month` / `sk.tgl_selesai_month` format `YYYY-MM` (mis. `2026-11`, `2026-12`).
4. **Bulk edit modal**: buka edit salah satu baris → input month Mulai/Selesai terisi otomatis.
5. **Preview manual**: modal Buat SK → pilih guru → Preview → tidak error; periode tampil benar.
6. **Generate langsung** (tanpa preview) → file PDF/DOCX terunduh, tidak error.
7. **Bulk generate**: pilih beberapa guru → generate → insert `sk_guru` sukses, tidak ada "error per baris".
8. **Edge cases**: guru dengan `tmt` kosong (fallback today); `tentang_type = pimpinan` (selesai 31 Desember tahun+3, `tgl_selesai_month` = `<tahun+3>-12`); custom mulai+selesai via bulk edit (Task 2: dokumen menampilkan "31 Desember 2026 M", bukan "2026-12"; `periode` terisi).

## Catatan Terkait (di luar scope rencana ini)
- `scheduler.js:617` merujuk `birthDate` yang tidak terdefinisi — bug terpisah yang sudah di-flag di plan `1793585326546-sk-field-driven-generation.md`; tidak diperbaiki di sini.
- `GET /teachers/:id/data` (`sk-guru.js:185-186`) hardcode `tgl_selesai_month = currYear + '-12'`, tidak konsisten dengan logika pimpinan 4 tahun di `buildSkData` — pertimbangkan di PR terpisah.

## File yang Disentuh
- `src/routes/sk-guru.js` — `buildSkData()` (Task 1: 2 baris baru sebelum baris 384; Task 2 opsional: normalisasi `customEndInput` di baris 339-340)
