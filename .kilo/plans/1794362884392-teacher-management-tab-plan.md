# Plan: Tab Manajemen Guru di SDM Dashboard

## Overview
Add a new "Manajemen Guru" tab to the SDM Dashboard with features to add, edit, view details, and manage teachers. Backend API endpoints already exist in `src/routes/sdm-dashboard.js`.

## Existing Backend APIs (Ready to Use)
- `GET /api/sdm-dashboard/teacher-list` - List teachers with filters (tenant, jabatan, status, search, pagination)
- `POST /api/sdm-dashboard/teachers` - Create new teacher + assignment
- `PUT /api/sdm-dashboard/teachers/:id` - Update teacher + assignment
- `DELETE /api/sdm-dashboard/teachers/:id` - Soft delete (set status_aktif = 0)
- `GET /api/sdm-dashboard/tenants` - List accessible tenants
- `GET /api/sdm-dashboard/jabatan-list` - List available jabatan

## Implementation Tasks

### 1. HTML Changes (sdm-dashboard.html)
- [ ] Add nav item in sidebar: "Manajemen Guru" with icon `fas fa-chalkboard-teacher`
- [ ] Add new tab content `#teacherTab` with:
  - Search/filter bar (tenant select, jabatan select, status select, search input)
  - Teacher table with columns: Foto, Nama, NIK, NIP, Sekolah, Jabatan, Status Kepegawaian, Status Aktif, Aksi
  - Pagination controls
  - "Tambah Guru" button
- [ ] Add modal `#teacherModal` for Add/Edit:
  - Basic info: Nama, NIK, NIP, Tempat/Tanggal Lahir, Jenis Kelamin, Alamat, No WA, Email
  - Employment: Tenant (select), Jabatan (select), Status Kepegawaian (select), TMT
  - Salary fields: Gaji Pokok, Tunj Kinerja, Tunj Umum, Tunj Istri, Tunj Anak, Tunj Kepala Sekolah, Tunj Wali Kelas, Honor Bendahara, Tunj Kehadiran, Potongan
  - Documents: Link Foto, Link KTP, Link KK, Link Ijazah
- [ ] Add modal `#teacherDetailModal` for View Detail:
  - Display all teacher fields + assignments + attendance summary

### 2. JavaScript Changes (sdm-dashboard.js)
- [ ] Add `'teacher'` to `tabTitles` and `tabSubtitles` objects
- [ ] Add `showTab('teacher')` handler in switch logic
- [ ] Implement `loadTeacherTab()` - loads tenants, jabatan list, then teacher list
- [ ] Implement `loadTeacherList(page)` - fetches from API with current filters
- [ ] Implement `renderTeacherTable(data)` - renders table rows with action buttons
- [ ] Implement `renderPagination(currentPage, totalPages)` 
- [ ] Implement `showTeacherModal(id = null)` - opens modal for add/edit, loads data if editing
- [ ] Implement `closeTeacherModal()` - resets form
- [ ] Implement `saveTeacher()` - POST/PUT to API
- [ ] Implement `showTeacherDetail(id)` - fetches full teacher data + assignments, shows detail modal
- [ ] Implement `closeTeacherDetailModal()`
- [ ] Implement `deleteTeacher(id)` - soft delete with confirmation
- [ ] Add filter change handlers (tenant, jabatan, status, search with debounce)
- [ ] Handle tenant-based jabatan filtering (SDM Pusat vs SDM Sekolah)

### 3. Teacher Detail Modal Data
- [ ] Fetch teacher basic info from teacher-list API or create new endpoint
- [ ] Fetch teacher assignments (from teacher_assignments table)
- [ ] Show attendance summary for current month

### 4. Validation & UX
- [ ] Client-side validation (required fields: nama, nik, tenant_id)
- [ ] NIP validation: required if TMT >= 2 years (matches backend trigger)
- [ ] Show loading states
- [ ] SweetAlert2 for confirmations and toasts
- [ ] Responsive table (horizontal scroll on mobile)

### 5. Access Control
- [ ] Only SDM Pusat (YPWILUTIM) can add/edit/delete teachers across all schools
- [ ] SDM Sekolah can only manage teachers in their own tenant
- [ ] Read-only view for non-SDM users (handled by backend)

## File Changes Summary
1. `public/sdm-dashboard.html` - Add nav item, tab content, modals
2. `public/sdm-dashboard.js` - Add all teacher management functions

## API Integration Details

### Teacher List Query Params
```
tenant_id, jabatan, status_kepegawaian, search, page, limit
```

### Create Teacher Payload
```json
{
  "nama": "string",
  "nik": "string", 
  "nip": "string|null",
  "tenant_id": "string",
  "jabatan_di_unit": "string|null",
  "status_kepegawaian": "string|null",
  "tmt": "YYYY-MM-DD|null",
  "no_wa": "string|null",
  "email": "string|null",
  "status_aktif": 1
}
```

### Update Teacher Payload (all optional)
Same fields as create, only sends changed values.

## Testing Checklist
- [ ] Add new teacher with all fields
- [ ] Edit existing teacher
- [ ] View teacher detail modal
- [ ] Soft delete teacher (verify status_aktif = 0)
- [ ] Filter by tenant, jabatan, status
- [ ] Search by name/NIK/NIP
- [ ] Pagination works
- [ ] NIP validation triggers when TMT >= 2 years
- [ ] SDM Sekolah only sees their tenant
- [ ] Modals open/close correctly
- [ ] Form resets on close

## Dependencies
- Existing: SweetAlert2, Tailwind CSS, FontAwesome
- No new dependencies needed

## Estimated Complexity
Medium - primarily frontend work, backend APIs already exist. Main effort in form handling and modal management.