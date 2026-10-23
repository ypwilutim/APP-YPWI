# SPMB Landing Page Fixes - Implementation Plan

## Context
The `spmb-public.html` landing page has several issues with data binding from the backend API response. It was marked "works correctly" in the main SPMB plan but actually has mismatches.

---

## Issues Identified

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 1 | Backend returns `program_name`, frontend expects `prog.name` | `spmb.js:107` vs `spmb-public.html:306` | Programs not displayed |
| 2 | Register buttons missing `?tenant=` param | `spmb-public.html:214,308` | Broken registration flow |
| 3 | Waves data fetched but not rendered | `spmb.js:109-110` | Gelombang info missing |
| 4 | Stats data fetched but not rendered | `spmb.js:115-116` | Statistik sekolah missing |
| 5 | School logo not displayed | `spmb.js:129` | Branding incomplete |
| 6 | Primary/accent colors not applied | `spmb.js:130-131` | Custom theming broken |
| 7 | No handling for `is_open = false` | `spmb.js:118` | Register should disable when closed |

---

## Plan: Landing Page Fixes (P1 - High)

### Phase 1: Backend API Fix (Optional - for consistency)
**Goal**: Align field names to reduce frontend complexity

- [ ] **Task 1.1**: Alias `program_name` → `name` in SQL query for programs
- [ ] **Task 1.2**: Alias wave fields to match frontend expectation (`name`, `start_date`, `end_date`, `status`, `badge_class`)

### Phase 2: Frontend Data Binding Fixes
**Goal**: Render all fetched data correctly

- [ ] **Task 2.1**: Fix programs rendering - use `prog.program_name` or add alias
- [ ] **Task 2.2**: Add tenant parameter to ALL register links:
  - `heroRegisterBtn` (hero section)
  - Program card links (programsGrid)
  - Nav CTA button
- [ ] **Task 2.3**: Render **Waves/Gelombang** section:
  - Show wave name, date range, status badge
  - Only show active waves (`is_active = 1`)
- [ ] **Task 2.4**: Render **Stats** section:
  - Display as stat cards (label + value)
- [ ] **Task 2.5**: Display **School Logo** in navbar/hero
- [ ] **Task 2.6**: Apply **Dynamic Colors** from API:
  - Update CSS variables `--primary`, `--accent` at runtime
  - Fallback to defaults if not set

### Phase 3: Registration State Handling
**Goal**: Proper UX based on registration open/closed status

- [ ] **Task 3.1**: Check `config.is_open`:
  - If `false`: Disable register buttons, show "Pendaftaran Ditutup" badge
  - If `true`: Enable buttons, show "Pendaftaran Dibuka" badge
- [ ] **Task 3.2**: Update hero badge text based on `is_open`
- [ ] **Task 3.3**: Show wave registration status (upcoming/open/closed) based on dates

### Phase 4: Enhanced UI (Optional - Nice to Have)
- [ ] **Task 4.1**: Add wave cards with countdown timer
- [ ] **Task 4.2**: Add program detail modal on click
- [ ] **Task 4.3**: SEO meta tags from API data
- [ ] **Task 4.4**: Loading skeleton while fetching

---

## File Changes

| File | Changes |
|------|---------|
| `public/SPMB/spmb-public.html` | Major: data binding, tenant param, waves/stats rendering, dynamic colors |
| `src/routes/spmb.js` (optional) | Minor: SQL aliases for consistency |

---

## Validation Steps

1. **Test with tenant that has full data** (programs, waves, faqs, stats, logo, colors)
2. **Test with tenant that has minimal data** (only school name)
3. **Test `is_open = false`** → register buttons disabled
4. **Test register flow** → click "Daftar Sekarang" → redirect to register.html with `?tenant=`
5. **Test dynamic colors** → verify CSS variables updated
6. **Test waves display** → dates, status badges correct
7. **Test stats display** → label/value pairs shown

---

## Open Questions

1. **Wave status logic**: Should status be computed from dates (`registration_start`/`registration_end` vs now) or use `status` column from `spmb_waves`? Currently backend has `status` column but query doesn't fetch it.

2. **Color application**: Apply to all components or just primary buttons/accents?

3. **Logo fallback**: If `logo_url` empty, show default icon or text?

4. **Programs vs Waves**: Should programs be grouped by wave, or separate sections?

---

## Dependencies

- Requires backend API `/api/spmb/landing/:tenantId` working (already done)
- Requires tenant to have data in `spmb_settings`, `spmb_programs`, `spmb_waves`, `spmb_faqs`, `spmb_stats`
- Register page must accept `?tenant=` param (already implemented)