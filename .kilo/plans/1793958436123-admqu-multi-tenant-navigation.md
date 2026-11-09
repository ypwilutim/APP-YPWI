# SPMB Landing & Panitia Workflow Plan

## Goal
Implement requested SPMB improvements:
1. Open/close SPMB follows wave dates (gelombang), not manual toggle.
2. Add/Edit Program Studi, Gelombang, FAQ, Statistik via modals.
3. Rename "Tidak ada program studi" to "Program Unggulan".
4. Logo upload to Google Drive (not URL).
5. Flyer upload in landing manager and display large flyer image on public landing (no label, image only).
6. Remove SPMB panitia self-registration; panitia assigned in school-admin.
7. In dashboard.html, if user is active SPMB panitia, show button to access panitia dashboard using token (no separate login).

## Current State
- `public/SPMB/spmb-landing-manager.html`: inline lists with add buttons; logo_url text input; no flyer upload; tabs for branding/programs/waves/faqs/stats.
- `public/SPMB/spmb-public.html`: reads config.is_open and wave status.
- `src/routes/spmb.js`: has `/admin/spmb/config/:tenantId`, `/admin/spmb/landing/:tenantId` (GET/PUT), committees endpoints, `/spmb/login`.
- `public/school-admin.html`: shows active committees and SPMB overview.
- `public/dashboard.html`: has ADMQU button; no SPMB panitia button.

## Design Decisions
- Open/close: derive from active wave (registration_start <= now <= registration_end). Remove manual is_open toggle dependency in public page; keep is_open as override? Use wave-based only.
- Modal forms: use SweetAlert2 or native modal; simpler to use SweetAlert2 inputs for add/edit.
- Logo/Flyer upload: add multer endpoints in spmb.js to upload to Drive and store file ID/link in spmb_settings (logo_file_id, logo_url, flyer_file_id, flyer_url). Need DB columns.
- Panitia access: school-admin assigns committee (teacher_id + tenant_id + spmb_role). Dashboard checks `/admin/spmb/committees/active?teacher_id=...`; if active, show button linking to `spmb-dashboard.html?token=<JWT>` and auto-login via token param.

## Implementation Tasks

### A. Wave-based open/close
1. In `spmb-public.html`, compute `isOpen` from waves: any wave with now between start and end. Use that for register buttons and badge.
2. Remove manual toggle from landing manager (or keep as override but default wave-based). Recommended: remove toggle; open/close fully wave-based.

### B. Modal CRUD
3. In landing manager, replace "Tambah" inline buttons with modal forms for Program, Wave, FAQ, Stat.
4. Rename empty state "Tidak ada program studi" → "Program Unggulan" (and tab label maybe "Program Unggulan").

### C. Logo/Flyer upload to Drive
5. Add DB columns to `spmb_settings`: `logo_file_id`, `logo_url`, `flyer_file_id`, `flyer_url` (if not exist).
6. Add multer upload endpoints in `src/routes/spmb.js`:
   - POST `/admin/spmb/upload-logo/:tenantId`
   - POST `/admin/spmb/upload-flyer/:tenantId`
   Store file in Drive folder per tenant, save link.
7. In landing manager: replace logo URL input with file input + preview; add flyer upload input + preview.
8. In landing PUT handler: accept `logo_url`, `flyer_url` (already via upsertSettings if columns exist).
9. In public landing: display flyer as large image (if flyer_url) without label.

### D. Panitia without registration
10. Remove/disable `spmb-register.html` registration flow (or keep but not linked). Panitia assigned via school-admin committees.
11. In `dashboard.html`, after loading user assignments, check if user is active SPMB panitia for any tenant. If yes, show button "Akses Panitia SPMB" linking to `spmb-dashboard.html?token=<token>`.
12. In `spmb-dashboard.html`, on load, if `token` query param exists, store it and auto-login (skip login form).

### E. Data consistency
13. Ensure all GET/PUT endpoints return and persist data correctly (already partially fixed).
14. Ensure tenant isolation.

## Risks / Edge Cases
- Google Drive upload requires service account credentials; handle missing gracefully (fallback to local upload).
- Multi-tenant user: show panitia button only if active committee exists for that tenant; token scoped to tenant.
- Wave dates: timezone handling; use server time.
- Modal forms must update landingData and re-render preview.

## Validation
- Create wave with current date range → public landing shows "Dibuka" and register button enabled.
- Outside wave range → "Ditutup".
- Upload logo/flyer → appears in landing manager preview and public landing.
- Add/edit program/wave/faq/stat via modal → persists after refresh.
- Assign panitia in school-admin → dashboard shows button → opens spmb-dashboard with token.
- No registration page accessible.

## Open Questions
- Should flyer replace the hero section or be a separate large banner?
- Should panitia token be the same JWT as dashboard or a scoped token? (Recommended: same JWT, auto-login)