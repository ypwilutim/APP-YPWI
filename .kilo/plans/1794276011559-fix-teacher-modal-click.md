# Fix Teacher Modal Click Issue (sdm-dashboard.html)

## Problem
The "Tambah Guru" and "Edit Guru" buttons in the Manajemen Guru tab don't work because modal visibility is broken.

## Root Cause
Inconsistent modal class handling between HTML and JavaScript:
- **Broken modals** (teacherModal, manualAttendanceModal, schoolDetailModal): Missing `hidden` class in HTML; JS only toggles `show`
- **Working modals** (kpiTemplateModal, kpiPeriodModal): Have `hidden` class in HTML; JS toggles both `hidden` and `show`

## Affected Files
1. `public/sdm-dashboard.html` - Add `hidden` class to 3 modals
2. `public/sdm-dashboard.js` - Update 6 functions to toggle both classes

## Changes

### 1. HTML (sdm-dashboard.html)
| Line | Element | Change |
|------|---------|--------|
| 1052 | teacherModal | Add `hidden` class |
| 1143 | manualAttendanceModal | Add `hidden` class |
| 1196 | schoolDetailModal | Add `hidden` class |

### 2. JavaScript (sdm-dashboard.js)
| Function | Line | Change |
|----------|------|--------|
| openTeacherModal | 1530 | Add `.classList.remove('hidden')` |
| closeTeacherModal | 1554 | Add `.classList.add('hidden')` |
| openManualAttendanceModal | 1710 | Add `.classList.remove('hidden')` |
| closeManualAttendanceModal | 1727 | Add `.classList.add('hidden')` |
| showSchoolDetail | 1758 | Add `.classList.remove('hidden')` |
| closeSchoolDetailModal | 1787 | Add `.classList.add('hidden')` |

## Validation
1. Open sdm-dashboard.html in browser
2. Click "Manajemen Guru" tab
3. Click "Tambah Guru" → modal should appear
4. Click "Edit" on any teacher row → modal should appear with data
5. Close modal → should disappear
6. Repeat for "Input Absensi Manual" tab (manualAttendanceModal)
7. Click "Detail" on school recap card (schoolDetailModal)