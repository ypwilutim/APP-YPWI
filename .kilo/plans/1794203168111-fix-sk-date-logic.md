# Plan: Update SK Date Logic (Tanggal Mulai & Selesai)

## Current Behavior (in `buildSkData` lines 470-521)
- Default: Guru biasa = 1 tahun (Jan 1 - Dec 31 tahun ini, atau hari ini - Dec 31 kalau bukan Jan)
- Pimpinan = 4 tahun
- Custom dates override if provided via `tgl_mulai_custom` / `tgl_selesai_custom`

## New Requirements

### 1. Default Logic (Per Teacher, based on TMT)
| Condition | Tanggal Mulai | Tanggal Selesai |
|-----------|---------------|-----------------|
| Masa kerja < 1 tahun (dari TMT ke hari ini) | TMT date | 31 Desember **tahun TMT** |
| Masa kerja ≥ 1 tahun | 1 Januari **tahun berjalan** | 31 Desember **tahun berjalan** |
| Pimpinan (kepala/ketua/pimpinan) | 1 Januari **tahun berjalan** | 31 Desember **tahun berjalan + 3** |

**Examples:**
- TMT: 1 Oct 2026, Today: 9 Nov 2026 → Masa kerja < 1 thn → **1 Okt 2026 - 31 Des 2026**
- TMT: 15 Jan 2025, Today: 9 Nov 2026 → Masa kerja ≥ 1 thn → **1 Jan 2026 - 31 Des 2026** (tahun berjalan)
- TMT: 1 Feb 2027, Today: 9 Nov 2027 → Masa kerja < 1 thn → **1 Feb 2027 - 31 Des 2027**

### 2. Custom Override (Bulk Form "Periode SK")
If user fills in the bulk form fields:
- `tgl_mulai_custom` + `tgl_selesai_custom` → **Use for ALL selected teachers** (ignore TMT logic)
- If empty → Use default logic per teacher above

### 3. Periode/Durasi Calculation
- Auto-calculated from `tglMulai` - `tglSelesai` via `computePeriode()`
- Format: "X Tahun Y Bulan" or "X Bulan"

## Implementation Plan

### Files to Modify
1. `src/routes/sk-guru.js` - `buildSkData()` function (lines 470-521)

### Changes in `buildSkData()`

**Replace the default date logic block (lines 507-521) with:**

```javascript
} else {
  // === NEW DEFAULT LOGIC BASED ON TMT ===
  const tmt = tmtDate; // already parsed from teacher.tmt or tmt_custom
  const today = new Date();
  
  // Calculate full years of service (TMT to today)
  let yearsOfService = today.getFullYear() - tmt.getFullYear();
  const monthDiff = today.getMonth() - tmt.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < tmt.getDate())) {
    yearsOfService--;
  }
  
  // Check if leader
  const leaderSource = allJabatan.toLowerCase();
  const isLeader = ['pimpinan', 'kepala', 'ketua'].some(k => leaderSource.includes(k));
  
  let tglMulaiCalc, tglSelesaiCalc;
  
  if (isLeader) {
    // Leader: 4 years from Jan 1 current year
    tglMulaiCalc = '1 Januari ' + today.getFullYear() + ' M';
    tglSelesaiCalc = '31 Desember ' + (today.getFullYear() + 3) + ' M';
  } else if (yearsOfService < 1) {
    // Less than 1 year: start from TMT, end Dec 31 of TMT year
    tglMulaiCalc = tmt.getDate() + ' ' + idnMonths[tmt.getMonth()] + ' ' + tmt.getFullYear() + ' M';
    const lastDayDec = new Date(tmt.getFullYear(), 11, 31).getDate();
    tglSelesaiCalc = lastDayDec + ' Desember ' + tmt.getFullYear() + ' M';
  } else {
    // 1+ years: Jan 1 - Dec 31 current year
    tglMulaiCalc = '1 Januari ' + today.getFullYear() + ' M';
    const lastDayDec = new Date(today.getFullYear(), 11, 31).getDate();
    tglSelesaiCalc = lastDayDec + ' Desember ' + today.getFullYear() + ' M';
  }
  
  tglMulai = tglMulaiCalc;
  tglSelesai = tglSelesaiCalc;
}
```

### Bulk Generate Endpoint
No changes needed - already passes `tgl_mulai_custom` and `tgl_selesai_custom` from request body to `buildSkData`. The custom dates will override the default logic (existing behavior at lines 472-506).

### Preview Endpoint
Same - passes custom dates through.

### Single Generate Endpoint
Same - passes custom dates through.

## Edge Cases Handled
1. **TMT in future** (shouldn't happen but safe): yearsOfService < 0 → treated as < 1 year
2. **TMT = today**: yearsOfService = 0 → < 1 year logic
3. **Leap years**: `new Date(year, 11, 31)` handles Dec 31 correctly
4. **Indonesian month names**: Uses existing `idnMonths` array

## Testing Scenarios
| TMT | Today | Role | Expected Mulai | Expected Selesai |
|-----|-------|------|----------------|------------------|
| 1 Okt 2026 | 9 Nov 2026 | Guru | 1 Oktober 2026 | 31 Des 2026 |
| 15 Jan 2025 | 9 Nov 2026 | Guru | 1 Jan 2026 | 31 Des 2026 |
| 1 Feb 2027 | 9 Nov 2027 | Guru | 1 Feb 2027 | 31 Des 2027 |
| 1 Jan 2026 | 9 Nov 2026 | Kepala | 1 Jan 2026 | 31 Des 2029 |
| (custom) 1 Mar 2026 | - | Guru | 1 Mar 2026 | (custom end) |

## Rollback
Revert `buildSkData` date logic block to previous version (lines 507-521).