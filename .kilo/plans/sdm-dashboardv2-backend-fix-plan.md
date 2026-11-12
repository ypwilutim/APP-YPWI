# SDM Dashboard v2 Backend Fix Plan

## Critical Bugs Identified and Fixes Required

### Bug 1: Teacher List - Today Attendance Subqueries Don't Filter by Tenant

**File**: `src/routes/sdm-dashboard.js:457-458`

**Problem**: The `today_present` and `today_late` subqueries in the teacher-list endpoint count attendance from ALL teachers across ALL tenants, not just the user's allowed tenants. This returns incorrect attendance counts for SDM Sekolah users who should only see their unit's data.

**Current code**:
```sql
(SELECT COUNT(*) FROM attendance_logs al WHERE al.teacher_id = t.id AND DATE(al.waktu_scan) = CURDATE() AND al.jenis = 'masuk') as today_present,
(SELECT COUNT(*) FROM attendance_logs al WHERE al.teacher_id = t.id AND DATE(al.waktu_scan) = CURDATE() AND al.jenis = 'masuk' AND al.status = 'terlambat') as today_late
```

**Fix**: Add tenant filtering via the existing `teacher_assignments` join (ta). The teacher `t` is already joined with `teacher_assignments ta`, so we can filter by `ta.tenant_id`:

```sql
(SELECT COUNT(*) FROM attendance_logs al JOIN teacher_assignments ta2 ON al.teacher_id = ta2.teacher_id WHERE al.teacher_id = t.id AND DATE(al.waktu_scan) = CURDATE() AND al.jenis = 'masuk' AND ta2.tenant_id = ta.tenant_id) as today_present,
(SELECT COUNT(*) FROM attendance_logs al JOIN teacher_assignments ta2 ON al.teacher_id = ta2.teacher_id WHERE al.teacher_id = t.id AND DATE(al.waktu_scan) = CURDATE() AND al.jenis = 'masuk' AND al.status = 'terlambat' AND ta2.tenant_id = ta.tenant_id) as today_late
```

**Impact**: SDM Sekolah users get correct per-teacher attendance counts limited to their unit. SDM Pusat/Admin still gets all teachers but with correct tenant-aware counting.

---

### Bug 2: KPI Auto-Values - Invalid OR Condition for Tenant Filter

**File**: `src/routes/sdm-kpi.js:466-467`

**Problem**: The leave request query has an invalid OR condition that produces broken SQL when `tenantParams` is empty: `AND (lr.tenant_id IN (${tenantParams.map(() => '?').join(',')}) OR lr.tenant_id = '' OR lr.tenant_id IS NULL)`. When `tenantParams` is empty, `IN ()` produces invalid SQL syntax. The `lr.tenant_id = ''` check rarely matches real data since tenant IDs are never empty strings.

**Current code** (partial):
```sql
AND (lr.tenant_id IN (${tenantParams.map(() => '?').join(',')}) OR lr.tenant_id = '' OR lr.tenant_id IS NULL)
```

**Fix**: Replace with proper tenant filtering using `COALESCE`:
```sql
AND COALESCE(lr.tenant_id, '') IN (${tenantParams.map(() => '?').join(',')})
```
Or simply remove the OR conditions and rely on the main tenant filter from the JOIN.

**Impact**: KPI auto-values endpoint would crash with invalid SQL when no tenant is specified or when tenantParams is empty.

---

### Bug 3: Manual Attendance Monthly - Complex Logic Bugs

**File**: `src/routes/sdm-dashboard.js:1001-1157`

**Problem**: The manual attendance monthly endpoint has highly complex JavaScript logic with multiple potential bugs:

1. **Leave request date expansion** (lines 1058-1078): The logic for expanding leave date ranges has edge case issues - the condition `startDate.getMonth() === bulan - 1 && startDate.getFullYear() === tahun || endDate.getMonth() === bulan - 1 && endDate.getFullYear() === tahun || (startDate.getMonth() < bulan - 1 && endDate.getMonth() > bulan - 1)` has operator precedence issues (AND binds tighter than OR).

2. **Daily "best" status selection** (lines 1088-1107): The conditional logic for selecting the "best" record per day is overly complex with incorrect priority:
   ```javascript
   if (!dailyBest[day]) dailyBest[day] = { masuk: null, pulang: null, masukStatus: null, leave: null };
   const jam = waktu ? waktu.getHours() * 60 + waktu.getMinutes() : -1;
   if (l.leave_id) {
     dailyBest[day].leave = ...;
   }
   if (l.jenis === 'masuk') {
     if (!dailyBest[day].masuk || (jam >= 240 && jam < dailyBest[day].masuk) || (dailyBest[day].masuk < 240 && jam >= 240)) {
       // Wrong logic - this prioritizes late over on-time incorrectly
     }
   }
   ```

3. **Tanpa keterangan classification** (lines 1110-1145): The logic for marking "tanpa keterangan" (absent without permission) is incorrect:
   - Days with no records at all should be `''` (empty) or marked differently
   - Days where other teachers have records but this teacher doesn't should be `tanpa_keterangan`
   - Current code may miscategorize days

4. **Weekend handling** (line 1114): `if (isWeekend) continue;` correctly skips weekends, but the `activeDays` check below may incorrectly include/exclude days.

**Fix**: Rewrite the logic with correct prioritization:
- Leave records take highest priority
- Attendance records (masuk/pulang) second
- Proper "tanpa keterangan" = day has attendance_logs for other teachers but not this teacher
- Weekends properly excluded from hadir/terlambat counts

**Impact**: Monthly attendance display shows wrong status per day per teacher, especially for leave and "tanpa keterangan" cases.

---

### Bug 4: SDM Access Candidates - Missing Tenant Filter for Non-Pusat SDM

**File**: `src/routes/sdm-dashboard.js:682-723`

**Problem**: The `/sdm-dashboard/access/candidates` endpoint checks `isSdmPusat(req)` but doesn't properly filter candidates by the user's allowed tenants when the user is SDM Sekolah. Currently it only checks if the user is SDM Pusat, but doesn't restrict the query to the user's assigned tenant.

**Current code** (lines 704-707):
```javascript
if (tenant_id) {
  joinClause = `JOIN teacher_assignments ta ON t.id = ta.teacher_id AND ta.tenant_id = ?`;
  params.unshift(tenant_id);
}
```

**Fix**: Add tenant filtering based on user's role:
- SDM Pusat: show all candidates across all tenants (current behavior)
- SDM Sekolah: only show candidates from their assigned tenant

**Impact**: SDM Sekolah can see teacher candidates from all tenants instead of just their unit.

---

### Bug 5: Teacher Update - Assignment Tenant Logic

**File**: `src/routes/sdm-dashboard.js:954-979`

**Problem**: The teacher update endpoint's assignment logic has a bug where it may update the wrong assignment or create duplicate assignments. When `tenant_id` is provided, it updates "first matching assignment" which may not be correct if the teacher has assignments in multiple tenants.

**Current code** (lines 957-966):
```javascript
const assign = await db.query(
  `SELECT id FROM teacher_assignments WHERE teacher_id = ? AND tenant_id IN (${placeholders})`,
  [teacherId, ...allowedTenants]
);
// update first matching assignment
if (assign.length) {
  await db.query(
    'UPDATE teacher_assignments SET tenant_id = ?, jabatan_di_unit = COALESCE(?, jabatan_di_unit) WHERE id = ?',
    [tenant_id, jabatan_di_unit || null, assign[0].id]
  );
}
```

**Fix**: More careful logic to either:
- Update only the assignment matching the specified tenant_id, or
- Replace all assignments for the teacher in allowed tenants

**Impact**: Teacher records may have incorrect assignment tenant/jabatan after update.

---

## Summary of Changes Needed

| # | File | Lines | Issue | Fix Type |
|---|------|-------|-------|----------|
| 1 | `src/routes/sdm-dashboard.js` | 457-458 | Teacher list attendance subqueries don't filter by tenant | SQL fix |
| 2 | `src/routes/sdm-kpi.js` | 466-467 | Invalid OR condition in leave query | SQL fix |
| 3 | `src/routes/sdm-dashboard.js` | 1001-1157 | Complex JS logic bugs in monthly attendance | JS rewrite |
| 4 | `src/routes/sdm-dashboard.js` | 682-723 | Access candidates don't filter by tenant for SDM Sekolah | SQL/logic fix |
| 5 | `src/routes/sdm-dashboard.js` | 954-979 | Teacher update assignment logic may update wrong assignment | SQL fix |

## Validation Steps

After applying fixes, verify:

1. **Teacher list**: Per-teacher `today_present` and `today_late` counts are filtered by user's allowed tenants
2. **KPI auto-values**: Endpoint returns valid JSON without SQL errors; attendance percentages computed correctly
3. **Manual attendance monthly**: Correct status per day per teacher (hadir/terlambat/izin/sakit/cuti/dinas_luar/tanpa_keterangan)
4. **Access candidates**: SDM Sekolah only sees candidates from their assigned unit; SDM Pusat sees all
5. **Teacher update**: Assignment tenant/jabatan correctly updated without creating duplicates
6. **All existing endpoints**: Still return correct results with proper tenant filtering