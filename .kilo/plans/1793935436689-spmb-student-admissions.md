# SPMB All Pages Functional + Professional UI Plan

## Goal
Make every SPMB page functional end-to-end and give them a consistent, professional UI using Tailwind + a new custom theme layer (indigo palette).

## Functional Fixes
1. **Route prefix alignment (backend `src/routes/spmb.js`)**:
   - Change `/api/spmb/register` → `/spmb/register`
   - Change `/api/spmb/auth/login` → `/spmb/auth/login`
   - Change `/api/spmb/me` → `/spmb/me`
   - Keep existing `/spmb/...`, `/admin/spmb/...`, `/spmb/student/...` routes.
2. **Frontend** already calls `/api/spmb/...`; no changes needed after backend fix.
3. **Applicants page** (`/SPMB/spmb-applicants.html`): already aligned to `/api/admin/spmb/students`; verify tenant param handling.
4. **Landing manager & school-admin SPMB tab**: smoke-test CRUD flows (settings, programs, waves, FAQs, stats, landing save).
5. **Panitia dashboard**: verify `/api/spmb/committees/active` with `spmb_token`.

## UI Redesign (Professional, Indigo)
1. Create `public/SPMB/css/spmb-theme.css` with:
   - CSS variables for indigo palette, spacing, radius, shadows.
   - Base typography (system/Inter), headings, body.
   - Reusable classes: `.spmb-card`, `.spmb-btn`, `.spmb-btn-secondary`, `.spmb-input`, `.spmb-badge`, `.spmb-empty`, `.spmb-skeleton`, `.spmb-toast`.
   - Responsive containers and grid helpers.
2. Update all SPMB pages to include `spmb-theme.css` after Tailwind:
   - `spmb-public.html`, `spmb-register.html`, `spmb-login.html`, `spmb-dashboard.html`,
   - `spmb-student-apply.html`, `spmb-student-status.html`, `spmb-applicants.html`,
   - `spmb-landing-manager.html`, plus school-admin SPMB tab styling.
3. Shared chrome:
   - Consistent header (logo/title/user), footer, max-width container.
   - Sticky nav on public pages; auth guard on protected pages.
4. UX improvements:
   - Multi-step registration with progress bar and validation states.
   - File upload dropzone with preview and size/type hints.
   - Loading skeletons, empty states, toast feedback.
   - Tables with sticky header, filters, status/payment badges, action buttons.
   - Form focus rings, error messages, disabled states.
5. Accessibility:
   - Semantic headings, labels, `aria-*`, keyboard focus, color contrast (WCAG AA).

## Data Flow / Failure Modes
- Route mismatch resolved; committee registration/login work.
- Missing/invalid files → 400 with clear message.
- Tenant mismatch → 403.
- Upload errors handled in UI with toast.

## Rollout
- No DB migration needed beyond existing.
- Add new CSS file; update HTML `<link>` tags.
- Keep Tailwind build untouched.

## Validation Checklist
- Committee: register → pending; admin approve → login → dashboard loads.
- Student: apply → status check; admin verify/accept → enrolled + student created.
- Landing manager: save settings/content; public page reflects changes.
- Bendahara: create SPMB transaction with application_id → payment_status paid.
- Responsive check at 360px, 768px, 1280px.
- No console errors on all pages.