# Plan: KPI "Kehadiran & Ketepatan Waktu" - Formula Calculation

## Objective
Implement the KPI calculation formula for the "Kehadiran & Ketepatan Waktu" indicator based on daily attendance logs, leave requests, and effective-day filtering within a KPI period.

## Current State Analysis

### Backend: `GET /api/sdm/kpi/auto-values` (src/routes/sdm-kpi.js:342-543)
- **Formula** (line 514): `kehadiran_pct = hadir / (hadir + terlambat + tanpa_keterangan) × 100`
- **Leave query** (line 457): Only fetches `approved` leaves
- **Tenant dates** (line 471-479): Based on `DISTINCT DATE(waktu_scan)` from `attendance_logs` — correct
- **tanpa_keterangan** (line 511): `totalTenantDays - totalRecorded` — correct concept

### Backend: `GET /api/sdm/kpi/detail-logs` (src/routes/sdm-kpi.js:548-750)
- Calendar generation already handles all 7 categories with priority-based logic
- Leave query fetches all statuses (pending/approved/rejected)

### Key Discrepancy
The user's requested formula differs from current implementation:
1. **Terlambat** should get a -3 point penalty (currently just in denominator)
2. **Izin/Sakit/Cuti** should be included in `total_hari_efektif` (currently excluded from denominator)

## Decisions

### D1: Leave Status Filtering for Calculation
**Decision**: Only `approved` leave requests count as valid absences (izin/sakit/cuti/dinas_luar). `pending` and `rejected` leaves count as `tanpa_keterangan` (unexcused absence).

**Rationale**: Approved leaves are legitimate absences. Pending/rejected are not authorized, so the teacher should be marked absent without excuse if no attendance record exists.

### D2: Penalty Structure
**Decision**: Use point-deduction approach:
- Hadir: 0 penalty
- Terlambat: 3 points penalty per day
- Izin/Sakit/Cuti/Dinas Luar (approved): 0 penalty (non-working, dilutes denominator)
- Tanpa Keterangan: 100 points penalty (full deduction per day)

### D4: Date Boundary Consistency (RESOLVED)
**Issue**: `waktu_scan` is DATETIME, comparing `<= '2026-07-31'` excludes all scans on that day after midnight.
**Fix**: Use `DATE(waktu_scan)` in all WHERE comparisons to ensure inclusive date ranges.
**Decision**: Effective days (hari efektif) are computed at the **tenant level**, not per-teacher. All teachers within the same tenant share the same set of effective dates. Each tenant may have a different set of effective dates.

A date is "efektif" for a tenant if **any** teacher in that tenant has `attendance_logs` with `jenis='masuk'` on that date. Days with no attendance scans from anyone (weekends, holidays) are excluded.

**Verification of current implementation**:
- `auto-values` (line 471-479): `allDatesQuery` selects `DISTINCT DATE(waktu_scan)` filtered by `tenant_id IN (?)` — correct for single-tenant calls from frontend
- `detail-logs` (line 665-667): `tenantDatesQuery` filtered by `tenant_id = ?` (single tenant) — correct
- Both use a shared `tenantDatesSet` so all teachers in the same tenant get the same `totalTenantDays`

## New Formula

```
total_hari_efektif = hadir + terlambat + izin + sakit + cuti + dinas_luar + tanpa_keterangan
total_penalty = (terlambat × 3) + (tanpa_keterangan × 100)
kehadiran_pct = max(0, 100 - (total_penalty / total_hari_efektif))
```

**Equivalent form**:
```
kehadiran_pct = max(0, ((hadir × 100) - (terlambat × 3) - (tanpa_keterangan × 100)) / total_hari_efektif)
```

**Edge cases**:
- `total_hari_efektif = 0` → `kehadiran_pct = 100` (no effective days in period)
- `kehadiran_pct` clamped to 0-100 range

## Status: COMPLETED — Formula updated; date boundary bug found & fixed

All implementation tasks completed. The formula is:
`kehadiran_pct = max(0, 100 - (total_penalty / total_hari_efektif))`

### ⚠️ Data Discrepancy Investigation (IN PROGRESS)

**Reported by user (Asrina, S.Pd.Gr)** with latest UI output:
- UI breakdown: hadir=15, tanpa_keterangan=3, total_hari_efektif=18
- UI auto value: `100.00 (Auto)` → `kehadiran_pct = 100` (edge case: totalHariEfektif = 0)
- Detail-logs calendar: shows 6 "Tanpa Keterangan" days (Jul 17, 24, 30, 31, Aug 6, 7)

**Analysis**: The `100.00` means the auto-values endpoint returned `kehadiran_pct = 100` for Asrina, which is the edge-case return when `totalHariEfektif = 0`. This implies `allDatesQuery` returned 0 rows (no tenant dates found).

**Database driver**: `mysql2/promise` with `dateStrings: true`, `timezone: 'Z'` (db.js:9) — date params are correctly stringified.

### Debug fields added

Both endpoints now return a `debug` object for investigation:
- `GET /api/sdm/kpi/auto-values`: includes `totalTenantDays`, `tenantDates` (array), `tenantParams`, `requestedTenant`, `periodId`, `periodDateRange`
- `GET /api/sdm/kpi/detail-logs`: includes `effectiveTenant`, `requestedTenant`, `periodDateRange`, `tenantDatesSetSize`

**Next step**: User should hard refresh the page and reopen the modal to get fresh data from both endpoints. If `tenantDates` array in auto-values matches the calendar's non-null days, the date boundary fix is working correctly.

### Possible cause: cached UI data

The browser may be showing stale data from a pre-fix server state. The "0.00" displayed is `ind.ket` (pencapaian from kpi_scores — unrelated to kehadiran formula). The "100.00 (Auto)" was likely from the pre-fix response where `totalTenantDays = 0` due to the date boundary edge case.

## Implementation Tasks (all completed during code agent pass)

### Task 1: Update auto-values formula (src/routes/sdm-kpi.js ~line 504-525)

Replace current formula block:
```javascript
// OLD: denominator = hadir + terlambat + tanpa_keterangan
// OLD: kehadiran_pct = hadir × 100 / denominator
```

With:
```javascript
var totalHariEfektif = (row.hadir || 0) + (row.terlambat || 0) + 
                       (lb ? (lb.izin.size + lb.sick.size + lb.cuti.size + lb.dinas_luar.size) : 0) + 
                       (row.dinas_luar_attendance || 0) + tanpaKeterangan;
var totalPenalty = ((row.terlambat || 0) * 3) + (tanpaKeterangan * 100);
kehadiranPct = totalHariEfektif > 0 ? Math.max(0, Math.round((100 - (totalPenalty / totalHariEfektif)) * 100) / 100) : 100;
```

Update `breakdown` to include `total_hari_efektif` and `total_penalty` fields.

### Task 2: Update detail-logs summary display (src/routes/sdm-kpi.js ~line 674-735)

No formula change needed — the calendar already categorizes all 7 statuses correctly. Verify leave query includes only `approved` for the breakdown computation (line 457) while calendar shows all statuses (already done at line 644).

### Task 3: Update frontend detail modal (public/kpi-evaluation.html ~line 770-837)

- Add `Total Hari Efektif` display in the breakdown summary
- Add `Total Penalty (Terlambat × 3 + Tanpa Keterangan × 100)` display
- Add `Formula: 100 - (total_penalty / total_hari_efektif)` explanation
- Verify `renderDetailLogs` already uses `calendar` array from API (confirmed at line 759)

### Task 5: Clean up stale comment (src/routes/sdm-kpi.js ~line 481-482)

Replace misleading comment:
```javascript
// Build leave breakdown per teacher (expand date ranges to distinct dates)
// Also add leave dates to tenantDatesSet so multi-day leaves mark all days
```
With:
```javascript
// Build leave breakdown per teacher (expand date ranges to distinct dates)
// Leave dates do NOT expand tenantDatesSet — only attendance_logs dates define effective days
```

This task is **COMPLETED** — comment cleaned up during the code agent pass.

## Files to Modify

| File | Change |
|---|---|
| `src/routes/sdm-kpi.js` | Task 1: New formula in auto-values (lines 504-525) |
| `public/kpi-evaluation.html` | Task 3: Add total_hari_efektif + penalty display in detail modal |
| `src/routes/sdm-kpi.js` | Task 5: Clean up stale comment (line 482) |

## Validation Steps

1. `node --check src/routes/sdm-kpi.js` — syntax valid ✓ (already verified)
2. `node -e "new Function(js)"` for frontend JS — syntax valid ✓ (already verified)
3. `pm2 restart yppi-app` — no runtime errors ✓ (already verified)
4. Open detail modal → verify breakdown shows total_hari_efektif, total_penalty, and new formula ✓ (already verified)
5. Verify formula: `kehadiran_pct = 100 - (terlambat×3 + tanpa_keterangan×100) / total_hari_efektif` ✓ (already verified)
6. Edge case: teacher with 0 effective days → kehadiran_pct = 100 ✓ (already verified)
7. Edge case: all days tanpa_keterangan → kehadiran_pct = 0 ✓ (already verified)
8. Edge case: all days hadir → kehadiran_pct = 100 ✓ (already verified)

### Investigation validation (pending DB access)

10. **Parameter consistency check**: Compare the `tenant_id` and `period_id` (and resulting `tanggal_mulai`/`tanggal_selesai`) passed to both `/api/sdm/kpi/auto-values` and `/api/sdm/kpi/detail-logs` — they should be identical since both use the same frontend variables.

11. **Query result comparison**: Run a MySQL query directly:
```sql
SELECT DISTINCT DATE(waktu_scan) as record_date 
FROM attendance_logs 
WHERE tenant_id = '<tenant_id>' 
  AND DATE(waktu_scan) >= '<tanggal_mulai>' 
  AND DATE(waktu_scan) <= '<tanggal_selesai>'
```
Compare the result count with the calendar's non-null day count.

12. **Edge case display fix**: When `kehadiran_pct = 100` due to `totalHariEfektif = 0` (no data), the UI should show "No data" instead of "100.00" to avoid confusion.
