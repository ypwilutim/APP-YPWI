# Pindahkan KAFALAH ke SDM Dashboard Plan

## Goal
Pindahkan semua fitur KAFALAH (tab KAFALAH + Pengaturan KAFALAH) dari `bendahara-dashboard.html` ke `sdm-dashboard.html`, dan hapus dari bendahara.

## Scope
- Frontend: `public/sdm-dashboard.html`, `public/bendahara-dashboard.html`, `public/js/kafalah-bendahara.js`
- Backend: none (APIs already exist)

## Current State
- `bendahara-dashboard.html` has:
  - Tab "KAFALAH" (data-tab="kafalah") with preview penggajian, WhatsApp, Excel, history, summary
  - Tab "Pengaturan Pembayaran" contains "Pengaturan KAFALAH" section (kafalahSettingsForm, toggle, tenant select, teacher overrides, kenaikan, jabatan, pendidikan ref)
  - Modal kafalahEditModal
  - Script: `js/kafalah-bendahara.js` (1431 lines)
- `sdm-dashboard.html` has nav tabs: dashboard, teachers, access, KPI, attendance, recapAbsensi, manualAttendance, payroll, sk-guru, rules, qr-generator, idcard, settings
- `sdm-dashboard.js` is the main script (no kafalah yet)

## Design Decisions
1. Add KAFALAH as a new nav tab in sdm-dashboard.html (between payroll and sk-guru, or after rules).
2. Copy the full KAFALAH tab HTML block from bendahara to sdm-dashboard.
3. Copy the "Pengaturan KAFALAH" settings section into sdm-dashboard's settings tab (or as a subtab).
4. Copy the kafalahEditModal.
5. Add `<script src="js/kafalah-bendahara.js">` to sdm-dashboard.html (rename to kafalah.js? keep same file to avoid duplication).
6. Ensure all helper functions used by kafalah-bendahara.js are available in sdm context: `getAuthHeader()`, `setVal()`, `kafalahOnSettingsContextChange()`, `loadKafalahMatrix()`, `loadJabatanTunjangan()`, `loadPendidikanRef()`, `loadTeacherOverrides()`, `showToast()`, `apiUrl()`. These are defined in bendahara-dashboard.html inline or other scripts. Need copy or create a shared kafalah-utils.js.
7. Remove KAFALAH tab and settings section from bendahara-dashboard.html.
8. Remove kafalah-bendahara.js script tag from bendahara-dashboard.html.

## Implementation Tasks
1. Create `public/js/kafalah.js` as shared KAFALAH logic (copy of kafalah-bendahara.js with `getAuthHeader`/`setVal`/`apiUrl`/`showToast` defined or imported).
2. Add KAFALAH nav button in sdm-dashboard.html sidebar.
3. Add KAFALAH tab content block (copy from bendahara) in sdm-dashboard.html main content.
4. Add Pengaturan KAFALAH settings section in sdm-dashboard.html settings tab.
5. Add kafalahEditModal to sdm-dashboard.html.
6. Add script tag for kafalah.js in sdm-dashboard.html.
7. Add tab switching logic in sdm-dashboard.js to call `loadKafalahSettings()` and `loadKafalahHistory()` when KAFALAH tab shown.
8. Remove KAFALAH tab and settings from bendahara-dashboard.html.
9. Remove script tag from bendahara-dashboard.html.

## Risks
- `getAuthHeader()`, `setVal()`, `apiUrl()`, `showToast()` may be defined in bendahara inline; need ensure sdm has equivalents or include them in kafalah.js.
- Tenant filter logic in bendahara uses `window.userAssignments`; sdm uses `tenantSelect` with `onTenantChange()`. Need adapt.
- KAFALAH settings context change may reference bendahara-specific DOM IDs; ensure same IDs in sdm.

## Validation
- Open sdm-dashboard.html, click KAFALAH tab, see penggajian table, WhatsApp/Excel buttons, history, summary.
- Open Pengaturan tab, see KAFALAH settings form, save works.
- Open bendahara-dashboard.html, KAFALAH tab and settings gone.
- No console errors.

## Out of Scope
- Changing backend APIs
- Adding new KAFALAH features