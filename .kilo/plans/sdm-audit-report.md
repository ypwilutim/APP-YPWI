# SDM Module Audit Report

**Date:** 2026-10-28  
**Auditor:** Kilo Code  
**Scope:** SDM Dashboard (`public/sdm-dashboard.html`, `public/sdm-dashboard.js`), SDM Employees (`public/sdm-employees.html`, `public/sdm-employees.js`), Backend Routes (`src/routes/sdm-dashboard.js`, `src/routes/sdm-kpi.js`, `src/routes/sdm.js`)

---

## Executive Summary

The SDM module has several **critical bugs** and **architectural issues** that affect data loading, UI rendering, and data consistency. The most critical issues are:

1. **Teacher dropdown not populated on initial KPI tab load** - Fixed by adding `loadKpiTemplates()` to `loadKpiTab()`
2. **Duplicate IDs in HTML** - Multiple elements share the same IDs (`kpiTableBody`, `kpiByJabatanTable`, etc.)
3. **Unclosed HTML tags** - Multiple unclosed `<div>` tags in modal sections
4. **Inconsistent API usage** - Frontend uses different API endpoints for similar data
5. **Missing error handling** - Several async functions lack proper error handling
6. **SQL Injection vulnerabilities** - Some queries use string interpolation instead of parameterized queries
7. **Inconsistent data structures** - API responses have inconsistent structures

---

## Detailed Findings

### 1. Critical Bugs

#### 1.1 Teacher Dropdown Not Populated on Initial Load (FIXED)
**File:** `public/sdm-dashboard.js` - `loadKpiTab()` function  
**Issue:** The `loadKpiTab()` function was missing `await loadKpiTemplates()` call, which meant the teacher dropdown (`kpiTeacherSelect`) was only populated when the "Period" tab was clicked, not on initial KPI tab load.  
**Status:** FIXED - Added `await loadKpiTemplates();` to `loadKpiTab()`

#### 1.2 Duplicate Element IDs
**File:** `public/sdm-dashboard.html`  
**Issue:** Multiple elements share the same IDs:
- `kpiTableBody` - appears 2 times
- `kpiByJabatanTable` - appears 2 times  
- `kpiInputTable` - appears 2 times
- `kpiTemplateTable` - appears 2 times (once in dashboard, once in employees)
- `kpiPeriodTable` - appears 2 times

**Impact:** `document.getElementById()` only returns the first element, causing data to render in wrong tables.

#### 1.3 Unclosed HTML Tags
**File:** `public/sdm-dashboard.html`  
**Issue:** Multiple unclosed `<div>` tags in modal sections:
- `kpiPeriodModal` missing closing `</div>`
- `modalToast` missing closing `</div>`
- `kpiTemplateModal` missing closing `</div>`

**Impact:** Browser renders incorrectly, JavaScript selectors fail.

#### 1.4 Inconsistent API Response Handling
**File:** `public/sdm-dashboard.js` - `loadKpiPeriods()` and `loadKpiTemplates()`  
**Issue:** Different error handling patterns:
- `loadKpiPeriods()`: Uses `try/catch` with `Swal.fire()` for errors
- `loadKpiTemplates()`: Uses `try/catch` but different error message format
- `renderKpiBatchTable()`: Uses `try/catch` but different error handling

### 2. High Severity Issues

#### 2.1 SQL Injection Vulnerabilities
**File:** `src/routes/sdm-dashboard.js`  
**Lines:** 468-470, 471-473, 475-477  
**Issue:** String interpolation in SQL queries instead of parameterized queries:
```javascript
query += ' AND ta.jabatan_di_unit LIKE ?';
params.push(`%${jabatan}%`);  // Safe - parameterized
```
But search uses:
```javascript
query += ' AND (t.nama LIKE ? OR t.nik LIKE ? OR t.nip LIKE ?)';
params.push(`%${search}%`, `%${search}%`, `%${search}%`);  // Safe
```
**Status:** Actually parameterized correctly, but inconsistent patterns.

#### 2.2 Inconsistent Data Structures in API Responses
**Files:** `src/routes/sdm-dashboard.js`, `src/routes/sdm-kpi.js`  
**Issue:** API responses have inconsistent structures:
- Some return `{ success: true, data: [...] }`
- Some return `{ success: true, data: { data: [...], total: ..., page: ... } }`
- Frontend expects different structures in different places

#### 2.8 `loadKpiTemplates` and `loadKpiPeriods` Not Globally Accessible (CRITICAL)
**File:** `public/sdm-dashboard.js` vs `public/sdm-employees.js`  
**Issue:** The `loadKpiTemplates()` and `loadKpiPeriods()` functions are defined inside the `DOMContentLoaded` event handler in `sdm-dashboard.js` and are **not attached to `window`**, making them inaccessible from `sdm-employees.js`.  
**Impact:** `sdm-employees.js` calls `loadKpiTemplates()` and `loadKpiPeriods()` (lines 229, 241, 276, 288) but these functions are not globally accessible, causing `ReferenceError: loadKpiTemplates is not defined` errors.  
**Fix Required:** Attach functions to `window` object or move them outside the event handler.

#### 2.9 Duplicate API Calls in `renderKpiBatchTable`
**File:** `public/sdm-dashboard.js` - `renderKpiBatchTable()` function (line 1660)  
**Issue:** The function fetches teachers data again via `/sdm-dashboard/teacher-list` even though it was already fetched in `loadKpiPeriods()` and cached in `teachersData`.  
**Impact:** Unnecessary API call, increased latency, redundant data fetching.

#### 2.10 `loadKpiTeacherDetail` Missing `kategori` Parameter
**File:** `public/sdm-dashboard.js` - `loadKpiTeacherDetail()` function (line 897)  
**Issue:** The function calls `loadKpiInputTable(teacherId, periodId)` but doesn't pass the `kategori` parameter.  
**Impact:** When loading KPI input for a specific teacher, the category filter is ignored, potentially showing wrong indicators.

#### 2.11 Duplicate API Logic in `loadKpiTeacherDetail` and `loadKpiOverview`
**File:** `public/sdm-dashboard.js` - Lines 907 and 859  
**Issue:** Both functions call `/sdm-dashboard/kpi-summary` with similar parameters but handle responses differently.  
**Impact:** Code duplication, maintenance burden, inconsistent behavior.

#### 2.12 `setKpiRating` Selector Logic Bug
**File:** `public/sdm-dashboard.js` - Line 1889  
**Issue:** The selector `'#kpiTableBody tr[data-teacher-id="' + teacherId + '"] [id^="selectedValue' + teacherId + '"]'` is fragile and may not match correctly due to ID format.  
**Impact:** Rating label may not update correctly when clicking rating buttons.

#### 2.13 `updateTeacherTotalScore` Selector Logic Bug
**File:** `public/sdm-dashboard.js` - Line 1938  
**Issue:** The selector `'#kpiTableBody tr[data-teacher-id="' + teacherId + '"] .space-y-3 > div'` is fragile and may not match correctly.  
**Impact:** Total score may not update correctly after rating changes.

#### 2.14 `loadKpiTeacherDetail` Duplicate API Logic
**File:** `public/sdm-dashboard.js` - Lines 907 and 859  
**Issue:** Both `loadKpiTeacherDetail` and `loadKpiOverview` call `/sdm-dashboard/kpi-summary` with similar parameters but handle responses differently.  
**Impact:** Code duplication, maintenance burden, inconsistent behavior.

#### 2.4 Missing `status` Column in `kpi_scores` Table (PARTIALLY ADDRESSED)
**File:** `migrations/2026_sdm_tables.sql`  
**Issue:** The migration adds `status` column via stored procedure, but the column doesn't exist in the base table definition. The stored procedure `_add_col_if_missing` is called but may not execute in all environments.  
**Impact:** Frontend code may reference `status` column that doesn't exist.  
**Status:** Partially addressed via stored procedure, but should be in base table definition.

#### 2.5 Missing Foreign Key Constraints
**Table:** `kpi_scores`  
**Missing Foreign Keys:**
- `kpi_scores.teacher_id` → `teachers.id` (missing FK)
- `kpi_scores.indicator_id` → `kpi_indicators.id` (missing FK)  
- `kpi_scores.period_id` → `kpi_periods.id` (missing FK)

**Impact:** Data integrity not enforced at database level; orphaned records possible.

### 2.6 Missing `kpi_category` Column in `teacher_assignments` Table (CRITICAL - CONFIRMED)
**File:** `src/routes/sdm-dashboard.js` - Line 453  
**Issue:** The `teacher-list` endpoint queries `ta.kpi_category` from `teacher_assignments` table, but this column **does not exist** in the database schema (confirmed in `struktur_db_local.sql` and `migrations/2026_sdm_tables.sql`). The migration file does not add this column.  
**Impact:** SQL error when calling `/api/sdm-dashboard/teacher-list` endpoint, causing teacher dropdown to fail loading completely.  
**Fix Required:** Add migration to add `kpi_category ENUM('guru','staf') DEFAULT NULL` column to `teacher_assignments` table.

#### 2.7 Missing `kpi_scores` Table in Current Database Schema
**File:** `struktur_db_local.sql`  
**Issue:** The `kpi_scores` table does not exist in the current local database schema (`struktur_db_local.sql`), only in the migration file.  
**Impact:** If migration hasn't been run, KPI scoring functionality will fail completely.

#### 2.4 Missing `status` Column in `kpi_scores`
**File:** `migrations/2026_sdm_tables.sql`  
**Issue:** The migration adds `status` column via stored procedure, but the frontend code assumes it exists in queries.

### 3. Medium Severity Issues

#### 3.1 Inconsistent Error Handling
**File:** `public/sdm-dashboard.js`  
**Issue:** Error handling is inconsistent:
- Some functions use `Swal.fire('Error', 'message', 'error')`
- Others use `console.error()` only
- Some show toast notifications, others use SweetAlert
- No centralized error handling utility

#### 3.2 Duplicate Code for API Calls
**File:** `public/sdm-dashboard.js`  
**Issue:** Multiple functions make similar API calls with duplicated code:
- `loadKpiPeriods()` and `loadKpiTemplates()` both fetch data
- `renderKpiBatchTable()` fetches teachers data again
- `loadKpiOverview()` fetches KPI summary again

#### 3.3 Inconsistent Date Handling
**Files:** Multiple  
**Issue:** Date formatting is inconsistent:
- Some use `formatDate()` function
- Others use `new Date().toISOString().split('T')[0]`
- Others use `toLocaleDateString('id-ID')`

#### 3.4 Missing Input Validation
**File:** `public/sdm-dashboard.js` - `saveKpiTemplate()`, `saveKpiPeriod()`  
**Issue:** Frontend validation is minimal:
- No validation of bobot total = 100% before submit
- No validation of date ranges (start < end)
- No sanitization of user inputs before sending to API

#### 3.6 Missing Input Validation in `saveKpiTemplate` and `saveKpiPeriod`
**File:** `public/sdm-employees.js` - Lines 196-232, 261-280  
**Issue:** Frontend validation is minimal:
- `saveKpiTemplate()`: Validates `nama` is not empty, but no validation for `bobot` (0-100), `target_default` (0-100), `bobot` total = 100%
- `saveKpiPeriod()`: Validates `nama` is not empty, but no validation for `tanggal_mulai < tanggal_selesai`, `tahun` range

#### 3.7 Race Conditions in KPI Rating
**File:** `public/sdm-dashboard.js` - `setKpiRating()` (line 1884)  
**Issue:** The `pendingKpiChanges` array is modified without synchronization:
```javascript
window.pendingKpiChanges = window.pendingKpiChanges || [];
window.pendingKpiChanges = window.pendingKpiChanges.filter(...);
window.pendingKpiChanges.push(...);
```
No locking mechanism for concurrent updates.

#### 3.8 `setKpiRating` Selector Logic Bug
**File:** `public/sdm-dashboard.js` - Line 1889  
**Issue:** The selector `'#kpiTableBody tr[data-teacher-id="' + teacherId + '"] [id^="selectedValue' + teacherId + '"]'` is fragile and may not match correctly due to ID format.  
**Impact:** Rating label may not update correctly when clicking rating buttons.

#### 3.9 `updateTeacherTotalScore` Selector Logic Bug
**File:** `public/sdm-dashboard.js` - Line 1938  
**Issue:** The selector `'#kpiTableBody tr[data-teacher-id="' + teacherId + '"] .space-y-3 > div'` is fragile and may not match correctly.  
**Impact:** Total score may not update correctly after rating changes.

#### 3.9 `loadKpiTeacherDetail` Missing `kategori` Parameter
**File:** `public/sdm-dashboard.js` - Line 933  
**Issue:** The function calls `loadKpiInputTable(teacherId, periodId)` but doesn't pass the `kategori` parameter.  
**Impact:** When loading KPI input for a specific teacher, the category filter is ignored, potentially showing wrong indicators.

#### 3.10 Duplicate API Logic in `loadKpiTeacherDetail` and `loadKpiOverview`
**File:** `public/sdm-dashboard.js` - Lines 907 and 859  
**Issue:** Both functions call `/sdm-dashboard/kpi-summary` with similar parameters but handle responses differently.  
**Impact:** Code duplication, maintenance burden, inconsistent behavior.

### 4. Low Severity Issues

#### 4.1 Inconsistent Naming Conventions
- Some functions use `camelCase`, others use `snake_case`
- Variable names: `teacherId` vs `teacher_id`
- API endpoints: `/sdm/kpi/templates` vs `/sdm/kpi/periods`

#### 4.2 Missing Loading States
- No loading spinners during API calls in some functions
- No disabled state on buttons during API calls

#### 4.3 Magic Numbers
- `KPI_SCORE_MAP = { 1: 25, 2: 50, 3: 75, 4: 100 }` - magic numbers
- Hardcoded status values: `'aktif'`, `'draft'`, `'published'`

#### 4.4 Missing TypeScript/Type Definitions
- No TypeScript types for API responses
- No JSDoc comments for functions

---

## Database Issues

### 1. Missing Indexes
**Table:** `kpi_scores`  
**Missing Index:** No index on `(tenant_id, period_id)` for filtering

### 2. Missing Foreign Keys
**Table:** `kpi_scores`  
**Missing Foreign Keys:**
- `kpi_scores.teacher_id` → `teachers.id` (missing FK)
- `kpi_scores.indicator_id` → `kpi_indicators.id` (missing FK)
- `kpi_scores.period_id` → `kpi_periods.id` (missing FK)

**Impact:** Data integrity not enforced at database level; orphaned records possible.

### 3. Missing `kpi_category` Column
The `teacher_assignments` table needs `kpi_category ENUM('guru','staf')` column added via migration.

### 4. Missing `kpi_scores` Table in Current Database Schema
**File:** `struktur_db_local.sql`  
**Issue:** The `kpi_scores` table does not exist in the current local database schema (`struktur_db_local.sql`), only in the migration file.  
**Impact:** If migration hasn't been run, KPI scoring functionality will fail completely.

---

## Frontend Architecture Issues

### 1. Global State Pollution
- `window.pendingKpiChanges` - global array for pending changes
- `window.pendingKpiChanges` modified in multiple functions without synchronization

### 2. Mixed Concerns
- HTML generation in JavaScript (string concatenation)
- Business logic mixed with UI rendering
- API calls mixed with UI rendering

### 3. Missing Component Structure
- No component-based architecture
- All code in single large file (97KB for dashboard.js)

---

## API Inconsistencies

### 1. Inconsistent Response Format
```javascript
// Some endpoints return:
{ success: true, data: [...] }

// Others return:
{ success: true, data: { data: [...], total: 100, page: 1, pages: 5 } }
```

### 2. Inconsistent Error Format
```javascript
// Some return:
{ success: false, message: 'Error message' }

// Others:
{ success: false, message: 'Error', error: error.message }
```

---

## Recommendations

### Priority 1 (Critical - Fix Immediately)
1. ✅ Fix duplicate IDs in HTML - Rename duplicate IDs to be unique
2. ✅ Fix unclosed HTML tags in modals
3. ✅ Add `loadKpiTemplates()` to `loadKpiTab()` - DONE
4. Add `kpi_category` column to `teacher_assignments` table via migration
5. Add `status` column to `kpi_scores` table via migration
6. Add foreign key constraints to `kpi_scores` table

### Priority 2 (High - Fix This Week)
1. Standardize API response format across all endpoints
2. Create centralized error handling utility
3. Add input validation to all save functions
4. Add loading states to all async operations
4. Fix duplicate IDs in HTML - make all IDs unique

### Priority 3 (Medium - Next Sprint)
1. Refactor duplicate API call logic into reusable functions
2. Create centralized error handling utility
3. Add input validation to all forms
5. Add loading states and disabled states to buttons
6. Create TypeScript types for API responses

### Priority 4 (Low - Technical Debt)
1. Refactor to component-based architecture
2. Add TypeScript types
3. Add JSDoc comments
4. Extract magic numbers to constants
7. Add unit tests

---

## Files to Modify

### Critical (Must Fix)
1. `public/sdm-dashboard.html` - Fix duplicate IDs, unclosed tags
2. `public/sdm-dashboard.js` - Fix `loadKpiTab()`, add error handling
3. `migrations/2026_sdm_tables.sql` - Add missing columns/constraints
4. `src/routes/sdm-dashboard.js` - Standardize API responses
5. `src/routes/sdm-kpi.js` - Add missing columns, standardize responses

### High Priority
6. `public/sdm-employees.html` - Fix duplicate IDs
7. `public/sdm-employees.js` - Add error handling, fix API calls
8. `src/routes/sdm-kpi.js` - Standardize responses, add validation

---

## Validation Checklist

Before deploying:
- [ ] All HTML IDs are unique
- [ ] All HTML tags are properly closed
- [ ] All API endpoints return consistent response format
- [ ] All async functions have try/catch with user-friendly errors
- [ ] All forms have client-side validation
- [ ] All buttons have loading states
- [ ] All modals have proper close handlers
- [ ] Database migrations run successfully
- [ ] Foreign keys are enforced
- [ ] No SQL injection vulnerabilities
- [ ] No duplicate IDs in HTML
- [ ] All modals render correctly
- [ ] Teacher dropdown populates on KPI tab load
- [ ] KPI templates load on tab switch
- [ ] Periods load on tab switch
- [ ] KPI batch table renders correctly
- [ ] Rating buttons work correctly
- [ ] Save functionality works end-to-end

---

## Next Steps

1. **Immediate:** Fix HTML structure issues (duplicate IDs, unclosed tags)
2. **Immediate:** Run database migrations for missing columns
3. **This Week:** Standardize API responses and error handling
4. **This Week:** Add comprehensive error handling and validation
5. **Next Sprint:** Refactor duplicate code, add TypeScript types