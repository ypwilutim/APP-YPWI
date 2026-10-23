# SPMB Landing Manager - Dedicated Page Plan

## Goal
Create a standalone page `public/SPMB/spmb-landing-manager.html` for managing SPMB landing page content, accessible from `school-admin.html` SPMB tab and directly via URL.

---

## Design Decisions (Confirmed)

| Aspect | Decision |
|--------|----------|
| Layout | Single page with section tabs (Branding → Programs → Waves → FAQs → Stats) |
| Preview | Split view (left: editor, right: live preview) on desktop; tab toggle on mobile |
| Validation | Client-side + server-side on submit |
| Waves dates | `<input type="date">` picker |
| Colors | Color picker + YPWI preset palette |
| Logo | URL input (upload later) |
| Auth | Same as school-admin: operator, TU, admin, bendahara |
| URL | `/SPMB/spmb-landing-manager.html?tenant=TENANT_ID` |
| Access from school-admin | Button "Kelola Landing Page" in SPMB tab |

---

## File Structure

```
public/SPMB/
├── spmb-landing-manager.html    # NEW: Main page
├── spmb-public.html             # Existing: public landing (updated)
├── spmb-register.html           # Existing: register form
├── spmb-login.html              # Existing: login
├── spmb-dashboard.html          # Existing: panitia dashboard
├── flyerspmb.html               # Existing: flyer view
└── css/tailwind.css             # Shared styles
```

---

## API Endpoints (Already Exist)

| Method | Endpoint | Used For |
|--------|----------|----------|
| GET | `/api/spmb/landing/:tenantId` | Load all data for editor |
| PUT | `/api/spmb/landing/:tenantId` | Save all sections at once |
| GET | `/api/spmb/public-info` | Quick settings load |
| PUT | `/api/spmb/config/:tenantId` | Save settings only |

---

## Page Sections

### 1. Header
- School name + tenant ID
- "Lihat Halaman Publik" button (opens `spmb-public.html?tenant=`)
- "Simpan" button (fixed bottom-right on mobile)

### 2. Section Tabs (Sticky on scroll)
```
[Branding] [Programs] [Waves] [FAQs] [Stats]
```

### 3. Editor Panel (Left / Full width on mobile)

#### Tab 1: Branding
- Nama Sekolah (text)
- Tagline (text)
- Logo URL (text + preview thumbnail)
- Warna Utama (color picker + YPWI presets: #066e3a, #2563eb, #dc2626, #7c3aed)
- Warna Aksen (color picker + presets: #f59e0b, #10b981, #ec4899, #f97316)

#### Tab 2: Programs (Jalur Pendaftaran)
- List of programs with inline edit
- Fields: Nama, Deskripsi, Kuota, Aktif (checkbox)
- "Tambah Program" button
- Drag to reorder (sort_order)

#### Tab 3: Waves (Gelombang)
- List with inline edit
- Fields: Nama, Nomor Gelombang, Tanggal Mulai (date), Tanggal Selesai (date), Kuota Maksimal, Aktif
- "Tambah Gelombang" button
- Status badge computed from dates (upcoming/open/closed)

#### Tab 4: FAQs
- List with inline edit
- Fields: Pertanyaan (text), Jawaban (textarea), Urutan
- "Tambah FAQ" button

#### Tab 5: Stats
- List with inline edit
- Fields: Label, Nilai (number), Urutan
- "Tambah Statistik" button

### 4. Preview Panel (Right / Hidden on mobile, toggle via tab)
- Real-time render of `spmb-public.html` layout
- Iframe or shadow DOM preview
- Updates on input change (debounced 300ms)

---

## Data Flow

```
LOAD:
1. Page opens with ?tenant=ID
2. Fetch GET /api/spmb/landing/:tenantId
3. Populate all form fields
4. Render initial preview

EDIT:
1. User edits any field
2. Debounced update preview (300ms)
3. Local state updated

SAVE:
1. User clicks "Simpan"
2. Collect all sections → spmbLandingData object
3. PUT /api/spmb/landing/:tenantId with JSON body
4. On success: toast "Tersimpan", update preview
5. On error: toast error, keep local changes
```

---

## Integration with school-admin.html

In `school-admin.html` SPMB tab (line ~1273):
- Add button: `<button id="openLandingManagerBtn" class="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Kelola Landing Page</button>`
- On click: `window.open('/SPMB/spmb-landing-manager.html?tenant=' + tenantId, '_blank')`
- Or navigate in same tab if preferred

---

## Technical Details

### State Management
```javascript
let landingData = {
  school: { name, tagline, logo_url, primary_color, accent_color },
  programs: [{ name, description, quota, is_active, sort_order }],
  waves: [{ wave_number, name, registration_start, registration_end, max_participants, is_active, sort_order }],
  faqs: [{ question, answer, sort_order }],
  stats: [{ label, value, sort_order }]
};
```

### Preview Implementation
- Option A: Clone `spmb-public.html` render logic into preview function (recommended - no iframe complexity)
- Option B: Load `spmb-public.html` in iframe with postMessage (simpler but less integrated)

### Preset Colors (YPWI)
```javascript
const YPWI_COLORS = {
  primary: ['#066e3a', '#2563eb', '#dc2626', '#7c3aed', '#0891b2', '#ca8a04'],
  accent: ['#f59e0b', '#10b981', '#ec4899', '#f97316', '#6366f1', '#84cc16']
};
```

---

## Validation Rules

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| school.name | Yes | string | Max 100 char |
| school.tagline | No | string | Max 200 char |
| school.logo_url | No | URL | Must be valid URL if filled |
| program.name | Yes | string | Max 100 char |
| program.quota | No | number | Min 0 |
| wave.name | Yes | string | Max 100 char |
| wave.registration_start | Yes | date | |
| wave.registration_end | Yes | date | Must >= start |
| wave.max_participants | No | number | Min 0 |
| faq.question | Yes | string | |
| faq.answer | Yes | string | |
| stat.label | Yes | string | |
| stat.value | Yes | number | |

---

## Tasks

### Phase 1: Create Page Structure
- [ ] Create `public/SPMB/spmb-landing-manager.html` with HTML skeleton
- [ ] Add Tailwind + FontAwesome + custom CSS
- [ ] Build header with tenant info + action buttons
- [ ] Build section tabs navigation
- [ ] Build editor panel with 5 tab panels
- [ ] Build preview panel (desktop: right sidebar; mobile: modal/bottom sheet)

### Phase 2: Implement Editor Tabs
- [ ] Branding tab: form fields + color pickers + presets
- [ ] Programs tab: dynamic list with add/remove/reorder
- [ ] Waves tab: dynamic list with date pickers + status badge
- [ ] FAQs tab: dynamic list with add/remove
- [ ] Stats tab: dynamic list with add/remove

### Phase 3: Preview Panel
- [ ] Implement renderPreview() function mirroring spmb-public.html logic
- [ ] Debounced update on input change
- [ ] Mobile: preview as bottom sheet or tab

### Phase 4: Data Load/Save
- [ ] Load data from API on page init
- [ ] Populate all form fields
- [ ] Save handler: collect → validate → PUT API → toast result
- [ ] Handle loading/error states

### Phase 5: school-admin.html Integration
- [ ] Add "Kelola Landing Page" button in SPMB tab
- [ ] Button opens landing manager in new tab with tenant param

### Phase 6: Polish & Testing
- [ ] Responsive design (mobile < 768px)
- [ ] Keyboard navigation
- [ ] Accessibility (labels, ARIA)
- [ ] Test with empty data, full data, partial data
- [ ] Test save + reload persistence

---

## Out of Scope
- Logo file upload (use URL for now)
- Image optimization
- Version history / rollback
- Multi-language support
- Public page preview authentication (public page is open)

---

## Validation Plan
1. Open `/SPMB/spmb-landing-manager.html?tenant=TEST001`
2. Verify all sections load from DB
3. Edit each section → preview updates real-time
4. Click Save → verify DB updated
5. Open public page → verify changes reflected
6. Test on mobile (responsive tabs, preview toggle)
7. Test from school-admin.html → button opens correct tenant

---

## Open Questions (None - All Decided)

All design decisions confirmed per user "saya ikuti rekomendasimu".