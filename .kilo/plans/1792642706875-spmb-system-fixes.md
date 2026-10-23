# SPMB System Fixes - Implementation Plan

## Context
The SPMB (Seleksi Penerimaan Murid Baru) system has multiple critical issues identified during code review:

### Issues Found
1. **Schema Conflict**: 3 migration files with conflicting table structures (`migration_spmb.sql` vs `migrations/2026_spmb_tables.sql` vs `migrations/2026_salary_settings_spmb.sql`)
2. **Registration Endpoint Mismatch**: Frontend (`spmb-register.html`) posts to `/api/public/register-guru` (teacher registration) but should post to `/api/spmb/register` (SPMB committee registration)
3. **Form/DB Field Mismatch**: Form sends `bank`, `nomor_rekening`, file uploads (`foto`, `ktp`, `kk`, `ijazah`) but `spmb_registrations` table lacks these columns
4. **Incomplete Approve Logic**: Approving registration doesn't create user account or set `teacher_id` in `spmb_committees`
5. **Duplicate Token Field**: `tenant_id` duplicated in login response (line 301 in `spmb.js`)
6. **Wrong Dashboard Query**: Shows all committees in tenant instead of logged-in user's committee only
7. **Middleware Auth Not Exported**: `authenticateOperator` defined in `server.js` but imported from `../middleware/auth` in `spmb.js`
8. **File Upload Not Handled**: `/api/spmb/register` uses `express.json()` not `multer` for FormData
9. **Inconsistent Tenant ID Handling**: Multiple sources (query, params, body, user) with no clear priority

---

## Plan: Prioritized Fixes

### Phase 1: Database Schema Resolution (P0 - Critical)
**Goal**: Single source of truth for SPMB tables

- [ ] **Task 1.1**: Audit all 3 migration files and document differences
- [ ] **Task 1.2**: Choose canonical schema (recommend: `migration_spmb.sql` - matches current code)
- [ ] **Task 1.3**: Create consolidated migration file
- [ ] **Task 1.4**: Add missing columns to `spmb_registrations` for file paths (`foto_path`, `ktp_path`, `kk_path`, `ijazah_path`)
- [ ] **Task 1.5**: Add `bank`, `nomor_rekening` columns if needed for SPMB (or remove from form)
- [ ] **Task 1.6**: Ensure `spmb_committees.teacher_id` has proper FK constraint
- [ ] **Task 1.7**: Remove/deprecate conflicting migration files in `migrations/`

### Phase 2: Registration Endpoint Fix (P0 - Critical)
**Goal**: SPMB committee registration works end-to-end

- [ ] **Task 2.1**: Add `multer` config for SPMB file uploads in `spmb.js`
- [ ] **Task 2.2**: Update `/api/spmb/register` to handle `multipart/form-data`
- [ ] **Task 2.3**: Save uploaded files to `public/uploads/spmb/` with unique names
- [ ] **Task 2.4**: Store file paths in `spmb_registrations` (new columns from Phase 1)
- [ ] **Task 2.5**: Update `spmb-register.html` to POST to `/api/spmb/register` (not `/api/public/register-guru`)
- [ ] **Task 2.6**: Remove `bank`, `nomor_rekening` from SPMB form (or add to DB if required)
- [ ] **Task 2.7**: Validate required files present before DB insert

### Phase 3: Approve Flow & User Creation (P0 - Critical)
**Goal**: Approved registrations become login-able committee members

- [ ] **Task 3.1**: Modify approve endpoint (`/admin/spmb/registrations/:id/approve`) to:
  - Create user account in `users` table with role `spmb_panitia`
  - Hash password (generate temp or require set-password flow)
  - Insert into `spmb_committees` with `teacher_id` = new user's `guru_id`
  - Return credentials or trigger password setup email
- [ ] **Task 3.2**: Add `teacher_id` to `spmb_committees` insert (currently missing)
- [ ] **Task 3.3**: Ensure `spmb_registrations.password_hash` is used for login

### Phase 4: Auth & Middleware Fixes (P1 - High)
**Goal**: Consistent authentication across SPMB routes

- [ ] **Task 4.1**: Export `authenticateOperator` from `src/middleware/auth.js` (create if needed)
- [ ] **Task 4.2**: Update `spmb.js` to import from correct path
- [ ] **Task 4.3**: Fix duplicate `tenant_id` in login response (line 301)
- [ ] **Task 4.4**: Add SPMB-specific middleware `authenticateSpmbPanitia` for `/api/spmb/me` and dashboard

### Phase 5: Dashboard Query Fix (P1 - High)
**Goal**: Dashboard shows only logged-in user's data

- [ ] **Task 5.1**: Update `/spmb/committees/active` to filter by `teacher_id` from token
- [ ] **Task 5.2**: Update `spmb-dashboard.html` to use correct query param
- [ ] **Task 5.3**: Add stats for logged-in user's committees only

### Phase 6: Cleanup & Polish (P2 - Medium)
**Goal**: Code quality and consistency

- [ ] **Task 6.1**: Standardize tenant_id extraction (single helper function)
- [ ] **Task 6.2**: Add input validation for all SPMB endpoints
- [ ] **Task 6.3**: Add error handling for file upload failures
- [ ] **Task 6.4**: Update API documentation/comments
- [ ] **Task 6.5**: Test end-to-end flow: register → approve → login → dashboard

---

## File Changes Summary

| File | Changes |
|------|---------|
| `src/routes/spmb.js` | Major: multer config, register endpoint rewrite, approve logic, auth fixes, dashboard query |
| `src/middleware/auth.js` | New: export `authenticateOperator`, add `authenticateSpmbPanitia` |
| `public/SPMB/spmb-register.html` | Fix: POST URL, remove extra fields, handle file upload UI |
| `public/SPMB/spmb-dashboard.html` | Fix: API call with teacher_id filter |
| `migration_spmb.sql` | Update: add file path columns, FK constraints |
| `migrations/2026_spmb_tables.sql` | Deprecate or remove |
| `migrations/2026_salary_settings_spmb.sql` | Keep (separate concern: spmb_transactions for treasurer) |

---

## Validation Steps

1. **Unit**: Each endpoint returns expected JSON structure
2. **Integration**: Register → approve → login → dashboard flow works
3. **DB**: Verify `spmb_registrations`, `spmb_committees`, `users` records linked correctly
4. **Files**: Uploaded files accessible at stored paths
5. **Auth**: Token contains correct role, tenant_id, committee linkage

---

## Out of Scope

- SPMB public landing page (`spmb-public.html`) - works correctly
- Flyer page (`flyerspmb.html`) - works correctly
- Admin landing editor (`/admin/spmb/landing`) - works correctly
- Treasurer SPMB transactions - separate module, keep as-is

---

## Dependencies

- Phase 1 must complete before Phase 2 (DB columns needed)
- Phase 2 must complete before Phase 3 (registration creates records to approve)
- Phase 4 can run in parallel with Phase 2-3
- Phase 5 depends on Phase 3 (needs teacher_id in committees)

---

## Open Questions

1. **Password flow**: Should approve auto-generate password + email, or redirect to set-password page like teacher registration?
2. **File storage**: Use local filesystem (`public/uploads/spmb/`) or cloud storage (S3)?
3. **NIK uniqueness**: Should SPMB registrations check NIK against `teachers` table too?
4. **Multi-tenant**: Current code assumes single tenant per committee - confirm this is correct