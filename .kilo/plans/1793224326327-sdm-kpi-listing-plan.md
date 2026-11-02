# SDM KPI & Evaluasi - Sistem Listing Plan

## Overview
Replace the "Input Nilai" form with a "Sistem Listing" (Listing System) for KPI & Evaluasi page. The key changes are:

1. **School + Period Selection Behavior**:
   - Select school (tenant) + period
   - If KPI scores already exist for that period → show "Overview" (read-only summary)
   - If no scores exist for that period → show "Input Nilai" listing form

2. **Input Nilai Listing View**:
   - Display list of teachers with: nama guru, jabatan, status
   - Show KPI assessment indicators per teacher
   - For "auto" source indicators: auto-filled values (from attendance/evaluasi)
   - For "manual" source indicators: click buttons 1-4 instead of numeric input
     - 1 = range 1-25, 2 = range 26-50, 3 = range 51-75, 4 = range 76-100
     - Button value stored as midpoint: 13, 38, 63, 88
     - Mapping configurable per KPI template

3. **Behavior Details**:
   - Overview mode: shows KPI completion stats, average scores per school/jab indicator
   - Input Nilai mode: editable per-teacher KPI inputs with button selection
   - Only SDM Pusat (YPWILUTIM) can input/save KPI scores
   - Non-SDM users get read-only interface

## Affected Files

### 1. public/sdm-dashboard.html
- Add school/tenant selector in KPI overview section
- Modify KPI input area to support two modes: overview vs listing
- Add button-based input controls for manual source indicators

### 2. public/sdm-dashboard.js
- Modify `loadKpiOverview()` to detect if scores exist for selected period
- Create new `renderKpiListingView(periodId)` function
- Modify `loadKpiInputTable(teacherId, periodId)` to show overview or listing based on score existence
- Add button click handlers for manual input (1-4 mapping)
- Update `saveKpiScores()` to handle button-based nilai_aktual values
- Add helper functions for rendering teacher lists and button groups

### 3. src/routes/sdm-kpi.js (backend)
- May add new endpoint to check if assessments exist for a period
- Existing endpoints should work without modification

## Data Flow

### When User Selects School + Period:

```
1. User selects tenant (school) from dropdown
2. User selects period from kpiPeriodSelect
3. loadKpiOverview() is triggered
4. API check: GET /sdm/kpi/assessments?period_id=${periodId}
   - If results exist → renderOverviewMode()
   - If no results → renderListingMode()
```

### Listing Mode Rendering:

```
5. Fetch teacher list: GET /sdm-dashboard/teacher-list?tenant_id=${tenantId}
6. For each teacher, render KPI indicator table:
   - Auto source indicators: pre-filled nilai_aktual from attendance/evaluasi
   - Manual source indicators: 4 buttons (1-4) with range labels
   - Buttons on click: set nilai_aktual to midpoint (13/38/63/88)
7. Save button: saveKpiScores() collects all rows, sends to /api/sdm/kpi/assessments/bulk
```

### Overview Mode:

```
8. Show KPI summary stats (avg score, completion rate, by school, by jabatan)
9. Disable input controls, show read-only state
```

## Button Mapping (Manual Source)

| Button | Label | Range | Stored nilai_aktual (midpoint) |
|--------|-------|-------|-------------------------------|
| 1 | 1 | 1-25 | 13 |
| 2 | 2 | 26-50 | 38 |
| 3 | 3 | 51-75 | 63 |
| 4 | 4 | 76-100 | 88 |

- Mapping can be configured per KPI template `sumber = 'manual'`
- Clicking a button sets `nilai_aktual` to the midpoint value
- `skor` is automatically calculated as `(nilai_aktual / target) * 100`

## Validation & Edge Cases

- If teacher has no assignment in selected tenant, skip/score gracefully
- If period is not active, show warning and don't allow input
- If user switches from overview to input mode, clear any existing selections
- Non-SDM users cannot access input mode (already handled by `applyKpiAccessControl()`)
- Target field disabled for auto source indicators, enabled for manual source

## Rollback Plan

If needed, revert HTML/JS changes to restore original "Input Nilai" form behavior. The backend APIs remain unchanged, so data integrity is maintained.