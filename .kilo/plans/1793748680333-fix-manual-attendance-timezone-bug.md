# Fix Manual Attendance Timezone Bug

## Problem
When admin enters manual attendance with exact time (e.g., 07:00 for "tepat waktu"), it saves as "terlambat" in database.

## Root Cause
Two bugs:
1. **Timezone inconsistency** in time extraction:
   - **Day name**: Uses `toLocaleDateString` with explicit `timeZone: 'Asia/Makassar'` ✓
   - **Time (HH:MM)**: Uses `getHours()`/`getMinutes()` which use server's local timezone ✗
   - **Frontend preview**: Runs in browser timezone, may differ from server

2. **Case-sensitive day name comparison** in manual attendance POST endpoint:
   - `dayName` from `Intl.DateTimeFormat` = `"Rabu"` (capitalized)
   - `ruleDays` from DB = `["senin", "selasa", "rabu", ...]` (lowercase)
   - `"rabu".includes("Rabu")` returns `false` → no matching rules → defaults to 'terlambat'
   - Preview endpoint (`/api/admin/attendance/rules`) correctly uses `day.toLowerCase()` but POST endpoint doesn't

## Solution
1. Use `Intl.DateTimeFormat` with `timeZone: 'Asia/Makassar'` for ALL timezone-sensitive operations in both frontend and backend.
2. Fix case-sensitive comparison by adding `.toLowerCase()` to `dayName` in manual attendance POST endpoint.

## Files to Modify

### 1. Backend: `src/routes/admin.js` (lines 1369-1394)
Replace timezone-naive time extraction with timezone-aware method.

### 2. Frontend: `public/js/admin-dashboard.js` (lines 989-992)
Replace timezone-naive time extraction in `previewManualAttendanceStatus()`.

### 3. Backend: `src/routes/admin.js` (lines 1472-1475) - `/api/admin/attendance/rules` endpoint
Same fix for consistency.

### 4. Backend: `src/routes/admin.js` (line 1396) - **NEW**: Fix case-sensitive day comparison
Add `.toLowerCase()` to `dayName` in the filter callback.

## Implementation Details

### Timezone-aware time extraction helper:
```javascript
function getTimeInTimezone(date, timeZone = 'Asia/Makassar') {
  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone
  }).format(date);
}

function getDayNameInTimezone(date, timeZone = 'Asia/Makassar') {
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    timeZone
  }).format(date);
}
```

### Backend fix (admin.js:1369-1394):
```javascript
const scanDate = new Date(`${tanggal}T${jam}:00`);
if (isNaN(scanDate.getTime())) {
  return res.status(400).json({ success: false, message: 'Format tanggal/jam tidak valid' });
}

const userTimezone = 'Asia/Makassar';
// Use timezone-aware formatting for BOTH day and time
const dayName = new Intl.DateTimeFormat('id-ID', { weekday: 'long', timeZone: userTimezone }).format(scanDate);
const timeOnly = new Intl.DateTimeFormat('id-ID', { 
  hour: '2-digit', 
  minute: '2-digit', 
  hour12: false, 
  timeZone: userTimezone 
}).format(scanDate);
```

### Backend fix for case-sensitive comparison (admin.js:1396):
```javascript
const matchingRules = rules.filter(rule => {
  if (!rule.hari || rule.hari.trim() === '') return true;
  const ruleDays = rule.hari.toLowerCase().split(',').map(d => d.trim());
  return ruleDays.includes(dayName.toLowerCase());  // ADD .toLowerCase()
});
```

### Frontend fix (admin-dashboard.js:989-992):
```javascript
const scanDate = new Date(`${tanggal}T${jam}:00`);
const userTimezone = 'Asia/Makassar';
const dayName = new Intl.DateTimeFormat('id-ID', { weekday: 'long', timeZone: userTimezone }).format(scanDate);
const timeOnly = new Intl.DateTimeFormat('id-ID', { 
  hour: '2-digit', 
  minute: '2-digit', 
  hour12: false, 
  timeZone: userTimezone 
}).format(scanDate);
```

## Testing
1. Enter manual attendance at exact rule boundary (e.g., 07:00 for 06:30-07:00 rule)
2. Verify status shows "Tepat Waktu" in preview
3. Submit and verify database saves status = 'tepat_waktu'
4. Test from different browser timezone (simulate with dev tools)
5. Verify day name matches for edge cases (midnight, DST boundaries)

## Risk Assessment
- **Low risk**: Only changes time formatting and string comparison, no schema changes
- **Backward compatible**: Same input/output format (HH:MM string)
- **Consistent**: Both frontend preview and backend now use same logic