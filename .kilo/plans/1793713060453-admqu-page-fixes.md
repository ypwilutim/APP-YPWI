# ADMQU Page Fixes & Completion Plan

## Issues to Fix

### 1. SK Download Security Issue (`public/js/admqu.js:322-335`)
**Problem**: `downloadSk()` calls `/api/sk-guru/list?tenant_id=` which returns ALL SKs for the tenant, exposing other teachers' SK data.
**Fix**: Add new endpoint `/api/admqu/sk-list` that filters by `teacher_id` only, or modify existing call to use `/api/sk-guru/list` with teacher filter.

### 2. Slip Gaji PDF Download URL Mismatch (`public/js/admqu.js:485-490`)
**Problem**: Frontend uses `/treasurer/public/salary-slip/${teacherId}/${tahun}-${bulan}` but backend endpoint is `/treasurer/public/salary-slip-pdf/:teacherId?month=YYYY-MM`.
**Fix**: Update frontend URL to match backend: `/treasurer/public/salary-slip-pdf/${teacherId}?month=${tahun}-${bulan.padStart(2,'0')}`

### 3. SK Preview Not Working (`public/js/admqu.js:203-234`, `public/admqu.html:835-852`)
**Problem**: Preview modal opens but preview generation may fail due to:
- Missing `teacher_id` in payload
- Incorrect API endpoint usage
- Modal HTML structure issues (duplicate close buttons, etc.)

### 4. Access Control for Regular Teachers (`src/routes/admqu.js`)
**Problem**: `verifyTenantAccess` requires admin/operator role. Regular guru without admin assignment get 403 when accessing their own data.
**Fix**: For self-service endpoints, allow access if `teacher_id` matches logged-in user's `guru_id` regardless of role.

### 5. Duplicate/Incomplete Modal HTML (`public/admqu.html:620-626`, `772-852`)
**Problem**: Lines 620-626 have orphaned buttons outside any modal. SK Apply Modal and SK Preview Modal both exist but may have conflicting IDs/handlers.

---

## Implementation Tasks

### Phase 1: Backend Fixes (`src/routes/admqu.js`)

| Task | Description |
|------|-------------|
| 1.1 | Add `/sk-list` endpoint filtered by `teacher_id` for secure SK download |
| 1.2 | Remove `verifyTenantAccess` check from self-service endpoints (`/sk-status`, `/absensi-ringkasan`, `/slip-gaji`, `/slip-gaji/history`) - only verify `teacher_id` matches authenticated user |
| 1.3 | Ensure `getTeacherIdFromUser` properly handles all user types (admin, guru with assignments) |

### Phase 2: Frontend Fixes (`public/js/admqu.js`, `public/admqu.html`)

| Task | Description |
|------|-------------|
| 2.1 | Fix `downloadSk()` to use new `/api/admqu/sk-list` endpoint |
| 2.2 | Fix `downloadSlipGaji()` URL to match treasurer endpoint |
| 2.3 | Fix SK preview flow: ensure proper payload, handle modal show/hide correctly |
| 2.4 | Clean up orphaned HTML buttons (lines 620-626 in admqu.html) |
| 2.5 | Ensure SK Apply Modal and Preview Modal don't conflict |

### Phase 3: Testing & Validation

| Task | Description |
|------|-------------|
| 3.1 | Test with regular guru (no admin role) - verify all tabs load |
| 3.2 | Test SK flow: status → preview → generate → download PDF/DOCX |
| 3.3 | Test Absensi: month change, stats, calendar render |
| 3.4 | Test Slip Gaji: month change, breakdown, PDF download, email |
| 3.5 | Verify no cross-tenant data leakage |
| 3.6 | Mobile responsiveness check |

---

## Files to Modify

1. `src/routes/admqu.js` - Backend API fixes
2. `public/js/admqu.js` - Frontend logic fixes
3. `public/admqu.html` - HTML cleanup (orphaned buttons)

---

## Validation Checklist

- [ ] Regular guru (no admin role) can access ADMQU page
- [ ] SK tab shows only current user's SK (or empty state)
- [ ] SK preview generates correct HTML
- [ ] SK generate creates record & returns PDF/DOCX
- [ ] SK download (PDF/DOCX) works for own SK only
- [ ] Absensi tab loads current month by default
- [ ] Month change refreshes absensi data correctly
- [ ] Slip Gaji tab shows salary breakdown with deductions
- [ ] Download PDF works for slip gaji (correct URL)
- [ ] Email slip sends successfully
- [ ] No cross-tenant data leakage
- [ ] Mobile layout works (tabs, modals, calendar)