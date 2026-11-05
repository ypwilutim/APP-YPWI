# Plan: Add "Approval & Reset" Tab to Admin Dashboard

## Goal
Add a new tab "Approval & Reset" in admin-dashboard.html with 4 sub-tabs:
1. **Approval Perizinan** - Leave request approval (existing API: `/api/admin/leave-requests`)
2. **Approval Pengajuan SK** - Manual SK request approval (NEW - needs backend or use existing SK list)
3. **Approval Penerbitan SK Otomatis** - Automatic SK issuance approval (existing API: `/api/sk-guru/approval`)
4. **Reset Absensi** - Attendance data reset (NEW API needed)

## Current State Analysis

### Existing APIs
| Feature | API Endpoint | Location |
|---------|--------------|----------|
| Leave Requests (Perizinan) | `GET /api/admin/leave-requests`, `PUT /api/admin/leave-requests/:id/status` | `src/routes/admin.js:5633` |
| SK Approval (Auto/December) | `GET /api/sk-guru/approval`, `POST /api/sk-guru/approve` | `src/routes/sk-guru.js:1315` |
| SK List/Management | `GET /api/sk-guru/list` | `src/routes/sk-guru.js:638` |

### Existing Frontend
- **Leave Request Approval UI**: In `public/js/dashboard.js` (`loadApprovalIzin`, `processApprovalIzin`, `bulkProcessApprovalIzin`)
- **SK Approval UI**: In `public/js/admin-dashboard.js` (`loadSkApprovalList`, `approveSkGuru`, `approveSelectedSkGuru`) - used in "Dokumen SK Guru" tab
- **SK Management UI**: In "Dokumen SK Guru" tab - admin creates SK directly

### Missing
- **Attendance Reset API**: No existing endpoint to delete/reset attendance_logs
- **Manual SK Request Approval**: No existing "teacher requests SK → admin approves" flow. Current flow: admin creates SK directly in "Dokumen SK Guru" tab.

## Design Decisions (User Confirmed)

1. **Sub-tabs (horizontal)** for the 4 sections
2. **Separate SK flows**: "Pengajuan SK Manual" and "Penerbitan SK Otomatis" as separate sub-tabs
3. **Reset Absensi**: Super-admin (YPWILUTIM) only
4. **Reset Filters**: Full filters - tenant, date range, teacher search, jenis (masuk/pulang/semua)

## Implementation Plan

### Phase 1: Backend - Attendance Reset API
**File**: `src/routes/admin.js`
- Add `DELETE /api/admin/attendance/reset` endpoint
- Params: `tenant_id`, `teacher_id`, `date_from`, `date_to`, `jenis`
- Require `authenticateOperator` + check `req.user.tenant_id === 'YPWILUTIM'` (super-admin only)
- Return count of deleted records

### Phase 2: Backend - Manual SK Request Approval (if needed)
**File**: `src/routes/sk-guru.js` or `src/routes/admin.js`
- Option A: Create new `sk_requests` table + approval flow (teacher submits → admin approves)
- Option B: Use existing SK list (`/api/sk-guru/list`) as "approval" interface where admin reviews/edits before finalizing
- **Recommendation**: Option B for MVP - reuse existing SK list with "Review & Approve" action. Can add proper request flow later.

### Phase 3: Frontend - HTML Tab Structure
**File**: `public/admin-dashboard.html`
1. Add nav item in sidebar (after "Log Kehadiran" or before "Pengaturan")
2. Add tab content with 4 sub-tabs:
   - Sub-tab 1: Approval Perizinan
   - Sub-tab 2: Approval Pengajuan SK (reuse SK list with approve action)
   - Sub-tab 3: Approval Penerbitan SK Otomatis (existing auto-approval UI)
   - Sub-tab 4: Reset Absensi

### Phase 4: Frontend - JavaScript Logic
**File**: `public/js/admin-dashboard.js`
1. Add `initApprovalResetTab()` - sub-tab switcher
2. Add `loadApprovalPerizinan()` - adapt from dashboard.js
3. Add `loadApprovalSKManual()` - reuse SK list with approve workflow
4. Add `loadApprovalSKAuto()` - adapt existing auto-approval UI
5. Add `loadResetAbsensi()` - new UI with filters + reset button

### Phase 5: Integration & Testing
- Add nav click handler for new tab
- Test all 4 sections with different user roles

## Files to Modify
1. `public/admin-dashboard.html` - Add nav item + tab content with 4 sub-tabs
2. `public/js/admin-dashboard.js` - Add JS functions for all 4 sections
3. `src/routes/admin.js` - Add attendance reset API
4. (Optional) `src/routes/sk-guru.js` - Add manual SK request approval API if Option A chosen

## Notes
- "Approval Pengajuan SK Manual": For MVP, will reuse existing `/api/sk-guru/list` with an "Approve/Review" action. Proper request→approval flow can be added later.
- "Approval Penerbitan SK Otomatis": Direct reuse of existing `/api/sk-guru/approval` UI.
- Permission for Reset Absensi: Check `req.user.tenant_id === 'YPWILUTIM'` in backend.