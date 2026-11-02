# Plan: Fix KPI Evaluation Save Button & Calculation Bugs

## Problem Summary

### Issue 1: "Simpan Semua Perubahan" button doesn't work
**Root Causes:**
1. `simpanData()` sends `indicator_ids` containing ALL indicator IDs from ALL teachers including:
   - Duplicate IDs (same indicator across multiple teachers)
   - Fake IDs `'ind_1'`...`'ind_5'` from `transformAssessmentData()` fallback padding (lines 529-540)
2. Backend `POST /api/sdm/kpi/assessments/bulk` does cartesian product `teacher_ids × indicator_ids` and tries to match against `providedAssessments` - fake IDs never match
3. If user hasn't selected period, `period_id` is empty string → backend returns 400

### Issue 2: KPI Calculation Bugs in `renderTable()`
**Location:** `kpi-evaluation.html` lines 690-728
**Bugs:**
1. **Variable name mismatch**: `filteredData.forEach(function(lettes)` but code uses `pegawai.indikator` (undefined)
2. **Double loop**: Two consecutive `forEach` loops over same indicators, doubling `totalNilaiWeighted` and `totalBobot`
3. **Inconsistent scoring**: Loop 1 uses `scaleToPercent` (discrete 1-4 only), Loop 2 uses `convertScoreToPercent` (all methods)
4. **Stale badgeGrade**: Recalculates badgeGrade after second loop but uses old `totalSkorAkhir` value

### Issue 3: `showDetailModal` bug (line 951)
Searches indicator by `ind.id === pegawaiId` (teacher ID) instead of indicator ID.

---

## Fix Plan

### Task 1: Fix Frontend `simpanData()` - Only send valid assessments
**File:** `public/kpi-evaluation.html`

**Changes:**
1. Filter `dataPegawai` to only include teachers matching current `unitSelect`
2. Only include indicators that exist in database (exclude fake `'ind_N'` IDs)
3. Build `scoresToSave` directly from filtered data - no cartesian product
4. Send payload as `{ assessments: [...] }` only (backend bulk endpoint accepts this)
5. Add validation: check period selected, show toast if not

**Implementation:**
```javascript
async function simpanData() {
    const periodId = document.getElementById('selectPeriode').value;
    const unitSelect = document.getElementById('selectSekolah').value;
    
    if (!periodId) {
        bukaModal(false, 'Periode Belum Dipilih', 'Silakan pilih periode evaluasi terlebih dahulu.');
        return;
    }
    if (!unitSelect) {
        bukaModal(false, 'Sekolah Belum Dipilih', 'Silakan pilih sekolah/unit terlebih dahulu.');
        return;
    }

    const scoresToSave = [];
    
    dataPegawai.forEach(function(pegawai) {
        if (pegawai.sekolah !== unitSelect) return;
        if (!Array.isArray(pegawai.indikator)) return;
        
        pegawai.indikator.forEach(function(ind) {
            // Skip fake indicators (id starts with 'ind_')
            if (String(ind.id).startsWith('ind_')) return;
            
            let nilaiAktual;
            if (ind.jenis === 'auto') {
                nilaiAktual = ind.nilai || 0;
            } else {
                const method = ind.scoring_method || 'discrete_1_4';
                nilaiAktual = convertScoreToPercent(ind.skor || 0, method, ind.score_min, ind.score_max);
            }
            
            scoresToSave.push({
                teacher_id: pegawai.id,
                tenant_id: unitSelect,
                period_id: periodId,
                indicator_id: ind.id,
                skor: ind.skor || 0,
                nilai_aktual: nilaiAktual
            });
        });
    });

    if (scoresToSave.length === 0) {
        bukaModal(false, 'Tidak Ada Data', 'Tidak ada nilai KPI yang bisa disimpan.');
        return;
    }

    const payload = { assessments: scoresToSave };
    
    try {
        const response = await fetch('/api/sdm/kpi/assessments/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': authHeader.Authorization || '' },
            body: JSON.stringify(payload)
        });
        const resData = await response.json();
        
        if (response.ok && resData.success) {
            bukaModal(true, 'Berhasil Disimpan!', resData.message || 'Seluruh nilai KPI berhasil diperbarui.');
        } else {
            bukaModal(false, 'Gagal Menyimpan', resData.message || 'Terjadi kesalahan saat menyimpan.');
        }
    } catch (err) {
        console.error("Gagal menyimpan data KPI:", err);
        bukaModal(false, 'Kesalahan Koneksi', 'Gagal menghubungkan ke server backend.');
    }
}
```

### Task 2: Fix Backend Bulk Endpoint - Accept direct assessments array
**File:** `src/routes/sdm-kpi.js`

**Changes:**
1. Modify `POST /api/sdm/kpi/assessments/bulk` to accept `assessments` array directly (already supported but not used properly)
2. Remove requirement for `teacher_ids` and `indicator_ids` arrays
3. Process each assessment in `req.body.assessments` directly
4. Keep validation: period active, SDM Pusat, teacher in allowed tenant

**Implementation:** Update bulk endpoint to iterate `providedAssessments` directly instead of cartesian product.

### Task 3: Fix `renderTable()` Calculation Bugs
**File:** `public/kpi-evaluation.html` (lines 690-728)

**Changes:**
1. Fix variable name: `lettes` → `pegawai` (or rename parameter)
2. Remove second duplicate loop entirely
3. Use `convertScoreToPercent` consistently for all manual indicators
4. Calculate `totalSkorAkhir` once after single loop
5. Compute `badgeGrade` after final score

**Correct logic:**
```javascript
filteredData.forEach(function(pegawai) {
    let totalNilaiWeighted = 0;
    pegawai.indikator.forEach(function(ind) {
        if (ind.jenis === 'auto') {
            totalNilaiWeighted += (ind.nilai * (ind.bobot / 100));
        } else {
            const method = ind.scoring_method || 'discrete_1_4';
            const nilaiPersen = convertScoreToPercent(ind.skor || 0, method, ind.score_min, ind.score_max);
            totalNilaiWeighted += (nilaiPersen * (ind.bobot / 100));
        }
    });
    const totalSkorAkhir = totalNilaiWeighted.toFixed(2);
    // compute badgeGrade based on totalSkorAkhir
    // render row
});
```

### Task 4: Fix `showDetailModal` indicator lookup
**File:** `public/kpi-evaluation.html` line 951

**Change:**
```javascript
// Current (broken):
const ind = pegawai ? pegawai.indikator.find(function(i) { return String(i.id) === String(pegawaiId); }) : null;

// Fixed: remove unused variable or fix if needed
// ind is never used after this - just remove the line
```

### Task 5: Remove fake indicator padding in `transformAssessmentData`
**File:** `public/kpi-evaluation.html` lines 529-540

**Change:** Remove the `while (pegawai.indikator.length < 5)` block that adds fake indicators. Template should provide correct number of indicators.

---

## Validation Steps

1. **Manual Test - Save Button:**
   - Login as SDM Pusat
   - Select sekolah & periode
   - Modify some manual KPI scores (click 1-4 buttons)
   - Click "Simpan Semua Perubahan" (top or bottom)
   - Verify success toast appears
   - Refresh page - verify scores persisted

2. **Manual Test - Calculation:**
   - Verify total score matches weighted sum of indicators
   - Test with different scoring_method (discrete_1_4, scale_1_5, percent_0_100, custom)
   - Verify auto indicators (kehadiran, evaluasi) use `ind.nilai` directly
   - Verify grade badges: ≥90=A, ≥75=B, else C

3. **Edge Cases:**
   - No period selected → proper error toast
   - No sekolah selected → proper error toast
   - Mixed auto/manual indicators
   - Indicators with custom scoring_method

---

## Files to Modify

1. `public/kpi-evaluation.html` - Main fixes (Tasks 1, 3, 4, 5)
2. `src/routes/sdm-kpi.js` - Backend bulk endpoint (Task 2)

---

## Rollback Plan

- Keep `sdm-kpi.js.bak` as backup
- Changes are isolated to KPI evaluation module
- No database schema changes required