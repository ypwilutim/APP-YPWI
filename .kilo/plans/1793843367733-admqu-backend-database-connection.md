# ADMQU Backend & Database Connection Plan

## Goal
Make `public/admqu.html` fully functional for a logged-in guru by connecting all three tabs (SK Guru, Ringkasan Absensi, Slip Gaji) to the existing Express backend and MySQL database, including SK preview/generate/download and salary slip PDF/email.

## Root Causes
1. `src/routes/admqu.js` is mounted behind `authenticateOperator`, which rejects regular `guru` users without an admin/operator assignment, so every ADMQU API call returns 403.
2. `src/routes/sk-guru.js` preview/generate/file endpoints are also `authenticateOperator`-only and use `verifyTenantAccess`, blocking a regular guru from acting on their own SK.
3. `admqu.js` slip-gaji queries a non-existent table `payroll_deduction_settings`; the actual table is `payroll_settings`.
4. `admqu.js` SK status filters SK rows by Gregorian year while storing/comparing against a Hijri year (`bh`), so an existing SK is never detected.

## Scope
- Backend: `src/routes/admqu.js`, `src/routes/sk-guru.js`, `src/middleware/auth.js`
- Frontend: `public/js/admqu.js` (small fixes only if needed)
- No schema changes; use existing `payroll_settings`.

## Implementation Tasks

### A. Allow self-service access
1. In `src/routes/admqu.js`, replace `authenticateOperator` with `authenticateToken` for:
   - `GET /sk-status`
   - `GET /absensi-ringkasan`
   - `GET /slip-gaji`
   - `GET /slip-gaji/history`
   - `GET /sk-list`
   Data is already filtered by `getTeacherIdFromUser(req.user)`, so only the logged-in teacher's data is returned.
2. In `src/routes/sk-guru.js`, replace `authenticateOperator` with `authenticateToken` only for:
   - `POST /preview`
   - `POST /generate`
   - `GET /file/:skId`
   Keep `authenticateOperator` for admin-only endpoints (`/list`, `/bulk-*`, etc.).
3. Add an operator/privileged check helper in `src/middleware/auth.js` (or inline) using the same role rules as `authenticateOperator` (admin, bendahara, guru with admin/TU/operator/SDM assignment).
4. In `preview` and `generate`, before `verifyTenantAccess`:
   - If caller is not privileged, require `teacher_id === req.user.guru_id`; otherwise return 403.
   - If privileged, keep existing `verifyTenantAccess(req, teacher.tenant_id)`.
5. In `file/:skId`, after loading the SK:
   - If caller is not privileged, require `sk.teacher_id === req.user.guru_id`; otherwise 403.
   - If privileged, keep `verifyTenantAccess(req, sk.tenant_id)`.

### B. Fix database queries
6. In `src/routes/admqu.js` `/slip-gaji`, change `payroll_deduction_settings` to `payroll_settings`.
7. Ensure a settings row exists before reading it, mirroring `src/routes/payroll.js` (`INSERT INTO payroll_settings (id) VALUES (1) ON DUPLICATE KEY UPDATE id = id`), then read `id = 1`; fall back to zeros if still missing.
8. In `/sk-status`, replace `YEAR(STR_TO_DATE(bm, ...)) = hijriYear` with a Hijri-year match on `bh`, e.g. `bh LIKE ?` with param `` `% ${hijriYear} H` `` (or equivalent), so an existing SK for the current Hijri year is detected.

### C. Frontend verification
9. Keep `public/js/admqu.js` endpoints as-is (`/admqu/*`, `/sk-guru/preview`, `/sk-guru/generate`, `/admqu/sk-list`, treasurer PDF/email URLs already match backend).
10. Confirm `loadUserInfo()` gets `guru_id` from JWT; if missing, redirect to login (already handled).
11. Optional cleanup: remove orphaned buttons in `public/admqu.html` only if they cause duplicate handlers.

## Risks / Edge Cases
- Admins without `guru_id` cannot use ADMQU self-service endpoints; that is acceptable because the page is guru self-service. Admin SK workflows remain on admin dashboard.
- `temp_teachers` salary lookup is by `nama`; if no matching row, salary components are zero but page still renders.
- `sk_guru.bh` must contain the Hijri year for detection; generated SKs already store it.
- Ownership checks must be enforced before any DB write/read of another teacher's SK.

## Validation
- Log in as a regular guru (no admin assignment) and open ADMQU: SK, Absensi, and Slip Gaji tabs load without 403.
- SK flow: status -> preview -> generate -> download PDF/DOCX for own SK only.
- Attempt to download another teacher's SK via `/api/sk-guru/file/:id` returns 403 for a regular guru.
- Absensi calendar and summary render for the selected month.
- Slip Gaji breakdown renders; PDF download and email work.
- No cross-tenant data leakage.
- Server starts without DB errors; `payroll_settings` row is used.
