# Fix SDM Dashboard Modals Not Displaying

## Problem
Four modals in `sdm-dashboard.html` are missing the `hidden` class, and their show/hide functions in `sdm-dashboard.js` only toggle the `show` class without toggling `hidden`. This causes modals to not display properly.

## Root Cause
1. **HTML missing `hidden` class** on 4 modals:
   - `teacherModal` (line 1106)
   - `teacherDetailModal` (line 1274)
   - `manualAttendanceModal` (line 1285)
   - `schoolDetailModal` (line 1338)

2. **JS show/hide functions incomplete** - they only use `classList.add/remove('show')` but don't toggle `hidden` class like the KPI modals do.

3. **CSS** has `.modal { display: none }` and `.modal.show { display: flex !important }` - without `hidden` class (Tailwind's `display: none !important`), the toggle is unreliable.

## Solution

### 1. Add `hidden` class to 4 modals in `public/sdm-dashboard.html`

- Line 1106: `teacherModal` - add `hidden`
- Line 1274: `teacherDetailModal` - add `hidden`
- Line 1285: `manualAttendanceModal` - add `hidden`
- Line 1338: `schoolDetailModal` - add `hidden`

### 2. Update show/hide functions in `public/sdm-dashboard.js`

**For `showTeacherModal` / `closeTeacherModal` (lines ~1715-1734):**
```javascript
function showTeacherModal(id = null) {
  // ... existing code ...
  document.getElementById('teacherModal').classList.remove('hidden');
  document.getElementById('teacherModal').classList.add('show');
}

function closeTeacherModal() {
  document.getElementById('teacherModal').classList.add('hidden');
  document.getElementById('teacherModal').classList.remove('show');
  // ... existing reset code ...
}
```

**For `openManualAttendanceModal` / `closeManualAttendanceModal` (lines ~1491-1510):**
```javascript
function openManualAttendanceModal() {
  // ... existing code ...
  document.getElementById('manualAttendanceModal').classList.remove('hidden');
  document.getElementById('manualAttendanceModal').classList.add('show');
}

function closeManualAttendanceModal() {
  document.getElementById('manualAttendanceModal').classList.add('hidden');
  document.getElementById('manualAttendanceModal').classList.remove('show');
}
```

**For `showSchoolDetail` / `closeSchoolDetailModal` (lines ~1539-1570):**
```javascript
async function showSchoolDetail(tenantId, nama) {
  // ... existing code ...
  document.getElementById('schoolDetailModal').classList.remove('hidden');
  document.getElementById('schoolDetailModal').classList.add('show');
  // ... existing code ...
}

function closeSchoolDetailModal() {
  document.getElementById('schoolDetailModal').classList.add('hidden');
  document.getElementById('schoolDetailModal').classList.remove('show');
}
```

### 3. Verify `teacherDetailModal` has show/hide functions
Check if `showTeacherDetailModal` / `closeTeacherDetailModal` exist and update them similarly.

## Files to Modify
1. `public/sdm-dashboard.html` - Add `hidden` class to 4 modals
2. `public/sdm-dashboard.js` - Update 6 show/hide function pairs

## Validation
- Open each tab that uses modals (Manajemen Guru, Input Absensi Manual, Dashboard school detail)
- Click buttons that should open modals (Tambah Guru, Edit, Detail, Tambah Absensi)
- Verify modals appear and close correctly
- Check no console errors