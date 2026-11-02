# Plan: KPI Scoring Method Configuration per Indicator

## Objective
Menambahkan konfigurasi metode scoring per indikator di template KPI (`kpi_indicators`), sehingga setiap indikator bisa memilih metode input nilai:
- **1-4** (diskrit, sudah ada)
- **0-100** (input angka persentase langsung)
- **1-5** (skala bintang seperti evaluasi)
- **Custom** (min/max configurable)

Auto indicators (kehadiran, evaluasi) tetap otomatis tanpa override.

## Current State Analysis

### Database (`kpi_indicators`)
```sql
CREATE TABLE `kpi_indicators` (
  `id`             INT(11) NOT NULL AUTO_INCREMENT,
  `nama`           VARCHAR(150) NOT NULL,
  `kategori`       ENUM('guru','staf') NOT NULL DEFAULT 'guru',
  `bobot`          DECIMAL(5,2) NOT NULL DEFAULT 0,
  `satuan`         VARCHAR(50) DEFAULT '%',
  `target_default` DECIMAL(12,2) NOT NULL DEFAULT 100,
  `sumber`         ENUM('manual','kehadiran','evaluasi') NOT NULL DEFAULT 'manual',
  `urutan`         INT(11) NOT NULL DEFAULT 0,
  `aktif`          TINYINT(1) NOT NULL DEFAULT 1,
  `keterangan`     VARCHAR(255) DEFAULT NULL,
  -- NEW FIELDS NEEDED:
  -- `scoring_method`  ENUM('discrete_1_4','percent_0_100','scale_1_5','custom') NOT NULL DEFAULT 'discrete_1_4',
  -- `score_min`       DECIMAL(5,2) DEFAULT 0,
  -- `score_max`       DECIMAL(5,2) DEFAULT 100,
  PRIMARY KEY (`id`)
);
```

### Frontend Rendering (kpi-evaluation.html:602-615)
- `jenis === 'auto'`: tampilkan nilai otomatis + tombol detail
- `jenis === 'manual'`: render tombol 1-4 (line 607-613)

### Backend Scoring
- `kpi_scores.skor`: nilai skor 1-4 (untuk manual)
- `kpi_scores.nilai_aktual`: persentase 0-100
- `kpi_scores.pencapaian`: = nilai_aktual (karena target=100)
- `kpi_scores.skor` (weighted): `pencapaian * bobot / 100`

## Design Decisions

### D1: Scoring Method Enum
| Value | Label | Description |
|-------|-------|-------------|
| `discrete_1_4` | 1-4 Diskrit | Tombol 1,2,3,4 → 25%,50%,75%,100% (default) |
| `percent_0_100` | Input 0-100 | Text input angka 0-100 (persen langsung) |
| `scale_1_5` | Skala 1-5 | Tombol 1-5 → 20%,40%,60%,80%,100% |
| `custom` | Custom | Min/max configurable (pakai `score_min`, `score_max`) |

### D2: Auto Indicators
- `sumber IN ('kehadiran','evaluasi')` → scoring method **diabaikan**, selalu otomatis
- `scoring_method` hanya berlaku untuk `sumber = 'manual'`

### D3: Score to Percentage Conversion
| Method | Score Value | Percentage Formula |
|--------|-------------|-------------------|
| `discrete_1_4` | 1,2,3,4 | `score * 25` |
| `scale_1_5` | 1,2,3,4,5 | `score * 20` |
| `percent_0_100` | 0-100 | `score` (langsung persen) |
| `custom` | min-max | `(score - min) / (max - min) * 100` |

### D4: Target
- Target **tetap 100** (pencapaian = nilai_aktual langsung)
- `pencapaian` = `nilai_aktual` (0-100%)
- `skor` (weighted) = `pencapaian * bobot / 100`

## Implementation Tasks

### Task 1: Database Migration
```sql
ALTER TABLE `kpi_indicators` 
  ADD COLUMN `scoring_method` ENUM('discrete_1_4','percent_0_100','scale_1_5','custom') 
    NOT NULL DEFAULT 'discrete_1_4' AFTER `sumber`,
  ADD COLUMN `score_min` DECIMAL(5,2) DEFAULT 0 AFTER `scoring_method`,
  ADD COLUMN `score_max` DECIMAL(5,2) DEFAULT 100 AFTER `score_min`;
```

### Task 2: Backend - Update kpi_indicators CRUD
**File:** `src/routes/sdm-kpi.js`
- `GET /api/sdm/kpi/templates`: tambahkan `scoring_method`, `score_min`, `score_max` di SELECT
- `POST /api/sdm/kpi/templates`: validasi & insert field baru
- `PUT /api/sdm/kpi/templates/:id`: update field baru

### Task 3: Backend - Scoring Conversion Helper
**File:** `src/routes/sdm-kpi.js` (fungsi baru)
```javascript
function convertScoreToPercent(score, method, min, max) {
  switch (method) {
    case 'discrete_1_4': return Math.min(100, Math.max(0, score * 25));
    case 'scale_1_5': return Math.min(100, Math.max(0, score * 20));
    case 'percent_0_100': return Math.min(100, Math.max(0, score));
    case 'custom': {
      const range = max - min;
      if (range <= 0) return 0;
      return Math.min(100, Math.max(0, (score - min) / range * 100));
    }
    default: return 0;
  }
}
```

### Task 4: Frontend - Dynamic Input Rendering
**File:** `public/kpi-evaluation.html`
- `renderTable()`: baca `ind.scoring_method`, `ind.score_min`, `ind.score_max`
- Render input berbeda per method:
  - `discrete_1_4`: tombol 1-4 (existing)
  - `scale_1_5`: tombol 1-5
  - `percent_0_100`: `<input type="number" min="0" max="100" step="0.1">`
  - `custom`: `<input type="number" :min="min" :max="max" step="0.1">` + preview persen

### Task 5: Frontend - Save Payload
**File:** `public/kpi-evaluation.html` (`setRating` & `simpanData`)
- `setRating`: untuk diskrit/scale → kirim `skor` (1-4, 1-5)
- `percent_0_100` & `custom`: gunakan `<input>` onchange → kirim `nilai_aktual` (persen)
- `simpanData`: hitung `nilaiAktual` pakai `convertScoreToPercent` di frontend sebelum kirim

### Task 6: Template Management UI
**File:** `public/kpi-evaluation.html` (atau halaman template terpisah)
- Tambah/edit template: dropdown `scoring_method`
- Jika `custom`: tampilkan input `score_min`, `score_max`
- Preview konversi skor → persen

## Files to Modify

| File | Changes |
|------|---------|
| `migrations/2026_sdm_tables.sql` | Add columns (idempotent via procedure) |
| `src/routes/sdm-kpi.js` | CRUD templates + helper `convertScoreToPercent` |
| `public/kpi-evaluation.html` | Dynamic input rendering, scoring conversion |

## Validation Steps

1. **Migration**: `mysql < migrations/2026_sdm_tables.sql` → cek kolom baru
2. **Backend**: `node --check src/routes/sdm-kpi.js`, restart server
3. **Create template**: Pilih `scoring_method = 'custom'`, set min=0, max=10 → cek dropdown
4. **Input 0-100**: Pilih `percent_0_100`, input 85 → `nilai_aktual=85`, pencapaian=85%
5. **Custom scale**: Min=0, Max=10, input 8 → pencapaian=80%
6. **Scale 1-5**: Pilih skor 4 → pencapaian=80%
7. **Auto indicators**: Pastikan kehadiran/evaluasi tidak terpengaruh scoring_method
8. **Total skor**: Verifikasi total weighted score masih benar

## Migration Safety
- Default `scoring_method='discrete_1_4'` menjaga kompatibilitas data lama
- `score_min=0`, `score_max=100` default aman untuk custom