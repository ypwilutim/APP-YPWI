# Fix: kpi-evaluation.html - Effective Days & Leave Status Visibility

## Root Cause Analysis

1. **Auto leave query tenant_id mismatch**: `leave_requests.tenant_id` can be empty string (`''`) or NULL (created via absensi.js:714 with `String(tenant_id || '')`). Auto-values query uses `lr.tenant_id IN (?)` which doesn't match empty/NULL values.

2. **tenantDatesSet includes leave dates**: Both auto-values and detail-logs add leave request date ranges to the tenant-level dates set, making non-effektive days (no attendance) appear as "Tanpa Keterangan" instead of null/empty.

3. **Leave statuses not showing in calendar**: Fixed in detail-logs (fetches all statuses), but auto-values still filters by `status = 'approved'` only. Summary breakdown won't show pending leave counts.

## "Hari Efektif" Definition

A day is **efektif** if at least one teacher in the tenant has attendance_logs (jenis='masuk') on that date. Leave requests do NOT make a day efektif.

## Implementation Tasks

### Task 1: Fix auto-values leave query to handle empty/NULL tenant_id

**File:** `src/routes/sdm-kpi.js` (line 457)

Change:
```sql
AND lr.tenant_id IN (${tenantParams.map(() => '?').join(',')})
```
To:
```sql
AND (lr.tenant_id IN (${tenantParams.map(() => '?').join(',')}) OR lr.tenant_id = '' OR lr.tenant_id IS NULL)
```

Params: `[...leaveDateParams, ...tenantParams]` — no change needed (OR doesn't add placeholders)

### Task 2: Remove leave date expansion from tenantDatesSet (auto-values)

**File:** `src/routes/sdm-kpi.js` (line 497)

Remove the lines that add leave dates to `tenantDatesSet`:
```javascript
// Remove THIS block from the leaveBreakdown forEach:
// "Add to tenant-level dates so these days are recognized"
// tenantDatesSet.add(dayKey);
```

`totalTenantDays` should only count attendance scan dates.

### Task 3: Remove leave date expansion from tenantDatesSet (detail-logs)

**File:** `src/routes/sdm-kpi.js` (line 680)

Remove the block that adds leave dates to `tenantDatesSet`:
```javascript
// Remove THIS block:
// leaveRequests.forEach(function(lr) {
//     if (lr.status !== 'approved') return;
//     tenantDatesSet.add(dayKey);
// });
```

### Task 4: Keep calendar showing ALL leave statuses

**File:** `src/routes/sdm-kpi.js` (line 698)

The calendar already matches all leave statuses (pending/approved/rejected). No change needed - this was already fixed in the previous iteration.

**File:** `public/kpi-evaluation.html` (line 814)

The frontend already renders leave badges with pending/rejected styling. No change needed.

## Nilai Calculation (Unchanged)

```
nilai = hadir / (hadir + terlambat + tanpa_keterangan) × 100
```

Where:
- `totalTenantDays` = only attendance dates (after Task 2)
- `totalRecorded` = hadir + terlambat + dinas_luar_attendance + izin + sakit + cuti + dinas_luar (approved only)
- `tanpa_keterangan = max(0, totalTenantDays - totalRecorded)`

Leave days are excluded from the denominator (legitimate absences). Non-efektive days (no attendance, null) are excluded entirely.

## Files to Modify

| File | Changes |
|---|---|
| `src/routes/sdm-kpi.js` | Task 1: Fix auto-values leave query tenant_id; Task 2: Remove leave date expansion from tenantDatesSet; Task 3: Remove leave date expansion from detail-logs tenantDatesSet |

## Validation Steps

1. Restart server
2. Open detail modal for a teacher with leave requests
3. Verify calendar shows leave statuses (izin/sakit/cuti/dinas_luar) on appropriate dates
4. Verify non-efektive days (no attendance) → empty/null, NOT tanpa_keterangan
5. Verify efektive days with no teacher record → "Tanpa Keterangan"
6. Verify summary breakdown shows non-zero counts for izin/sakit/cuti/dinas_luar (if data exists)
7. Verify nilai_aktual = hadir / (hadir + terlambat + tanpa_keterangan) × 100
8. Verify Datang (Masuk) and Pulang scan tables show both scan types
