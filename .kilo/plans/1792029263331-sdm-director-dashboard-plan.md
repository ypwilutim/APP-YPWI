# Plan: Halaman Direktur SDM (SDM Director Dashboard)

## Overview
Membuat halaman terpisah `public/sdm-dashboard.html` yang mengabsorbs semua fitur dari `admin-dashboard.html` dengan filtering berbasis role SDM (SDM Pusat vs SDM Per Sekolah) dan menambahkan sistem KPI custom.

---

## Arsitektur & Data Flow

### Access Control
| Role | Tenant Visibility | Jabatan Visibility |
|------|------------------|-------------------|
| **SDM Pusat** (YPWILUTIM) | Semua tenant | Semua jabatan |
| **SDM Sekolah** | Hanya tenant assignment mereka | Hanya jabatan di tenant tsb |

### Backend Routes (Existing + New)
| Route | Method | Description | Access |
|-------|--------|-------------|--------|
| `/api/sdm/summary` | GET | Statistik agregat SDM | SDM Pusat/Sekolah |
| `/api/sdm/employees` | GET | List guru dengan filter SDM | SDM Pusat/Sekolah |
| `/api/admin/teachers` | GET | Full teacher management | SDM (filtered by tenant) |
| `/api/admin/payroll/*` | GET/POST | Payroll system | SDM (filtered by tenant) |
| `/api/evaluations/auto-calculate` | POST | Auto-evaluasi kehadiran | SDM |
| `/api/evaluations` | GET/POST | Manual evaluation CRUD | SDM |
| **NEW** `/api/sdm/kpi` | GET/POST | Custom KPI management | SDM Pusat/Sekolah |
| **NEW** `/api/sdm/kpi/templates` | GET | KPI templates per jabatan | SDM Pusat |

---

## Frontend Structure: `public/sdm-dashboard.html`

### Layout
```
┌─────────────────────────────────────────────────────────────┐
│ Sidebar (Navigation)                                        │
├─────────────────────────────────────────────────────────────┤
│ Header: User Info | Tenant Filter (SDM Pusat only) | Date  │
├─────────────────────────────────────────────────────────────┤
│ Tab Content Area                                            │
└─────────────────────────────────────────────────────────────┘
```

### Tabs (Mirip admin-dashboard + KPI)
1. **Dashboard** - Statistik ringkas + chart kehadiran + KPI overview
2. **Manajemen Guru** - CRUD guru, filter, mutasi lintas sekolah
3. **KPI & Evaluasi** ⭐ **NEW**
   - Sub-tab: Evaluasi Kehadiran (existing auto-calc)
   - Sub-tab: KPI Custom (target/achievement/weight per jabatan)
4. **Penggajian** - Payroll dengan komponen gaji & potongan absensi
5. **Log Kehadiran** - Log harian + Rekap bulanan + Export PDF/Excel
6. **Dokumen SK Guru** - Generate SK pengangkatan/peletakan/mutasi
7. **Aturan Kepegawaian** - Status kepegawaian, TMT, NIP validation
8. **QR Scanner & Generator** - Untuk absensi guru
9. **Cetak ID Card** - ID Card guru/karyawan
10. **Pengaturan** - Tenant settings, deduction settings, dll

---

## Database Schema Additions

### Table: `kpi_templates` (NEW)
```sql
CREATE TABLE kpi_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(20) NULL,  -- NULL = global template (SDM Pusat)
  jabatan VARCHAR(100) NOT NULL, -- e.g., 'Guru', 'Kepala Sekolah', 'TU', 'Bendahara'
  kpi_name VARCHAR(200) NOT NULL,
  kpi_description TEXT,
  weight DECIMAL(5,2) NOT NULL DEFAULT 1.00, -- bobot %
  target_value DECIMAL(10,2), -- target numerik
  target_type ENUM('numeric','percentage','boolean') DEFAULT 'numeric',
  measurement_freq ENUM('monthly','quarterly','semester','yearly') DEFAULT 'monthly',
  is_active BOOLEAN DEFAULT TRUE,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id),
  FOREIGN KEY (created_by) REFERENCES teachers(id)
);
```

### Table: `kpi_assessments` (NEW)
```sql
CREATE TABLE kpi_assessments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT NOT NULL,
  tenant_id VARCHAR(20) NOT NULL,
  kpi_template_id INT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  target_value DECIMAL(10,2),
  actual_value DECIMAL(10,2),
  achievement_pct DECIMAL(5,2), -- (actual/target)*100
  score DECIMAL(4,2), -- skor 1-5 atau 0-100
  notes TEXT,
  assessed_by INT, -- SDM yang menilai
  assessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status ENUM('draft','submitted','approved') DEFAULT 'draft',
  FOREIGN KEY (teacher_id) REFERENCES teachers(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id),
  FOREIGN KEY (kpi_template_id) REFERENCES kpi_templates(id),
  FOREIGN KEY (assessed_by) REFERENCES teachers(id),
  UNIQUE KEY unique_assessment (teacher_id, kpi_template_id, period_start, period_end)
);
```

### Table: `kpi_periods` (NEW) - Periode penilaian KPI
```sql
CREATE TABLE kpi_periods (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL, -- e.g., 'Semester 1 2025/2026'
  period_type ENUM('monthly','quarterly','semester','yearly') NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  tenant_id VARCHAR(20) NULL, -- NULL = all tenants
  is_active BOOLEAN DEFAULT TRUE,
  is_locked BOOLEAN DEFAULT FALSE, -- prevent editing after lock
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## Implementation Tasks

### Phase 1: Backend Routes (New Files)
- [ ] **Create** `src/routes/sdm-dashboard.js` - Main SDM dashboard routes
  - [ ] `GET /api/sdm-dashboard/stats` - Aggregated stats for dashboard cards
  - [ ] `GET /api/sdm-dashboard/attendance-chart` - Chart data mingguan/bulanan
  - [ ] `GET /api/sdm-dashboard/kpi-summary` - KPI overview per jabatan/sekolah
- [ ] **Create** `src/routes/sdm-kpi.js` - Custom KPI management
  - [ ] `GET /api/sdm/kpi/templates` - List templates (filtered by role/tenant)
  - [ ] `POST /api/sdm/kpi/templates` - Create template (SDM Pusat only)
  - [ ] `PUT /api/sdm/kpi/templates/:id` - Update template
  - [ ] `DELETE /api/sdm/kpi/templates/:id` - Delete template
  - [ ] `GET /api/sdm/kpi/assessments` - List assessments with filters
  - [ ] `POST /api/sdm/kpi/assessments` - Create/update assessment
  - [ ] `POST /api/sdm/kpi/assessments/bulk` - Bulk input untuk banyak guru
  - [ ] `GET /api/sdm/kpi/periods` - List periods
  - [ ] `POST /api/sdm/kpi/periods` - Create period (SDM Pusat)

### Phase 2: Frontend - `public/sdm-dashboard.html`
- [ ] **Create** main HTML structure dengan sidebar navigation
- [ ] **Tab 1: Dashboard** - Stats cards, attendance chart, KPI summary widgets
- [ ] **Tab 2: Manajemen Guru** - Adapt dari admin-dashboard teachersTab
- [ ] **Tab 3: KPI & Evaluasi** ⭐
  - [ ] Sub-tab: Evaluasi Kehadiran (pakai existing auto-calc API)
  - [ ] Sub-tab: KPI Custom - CRUD template, input nilai, recap per guru
- [ ] **Tab 4: Penggajian** - Adapt dari admin-dashboard payrollTab
- [ ] **Tab 5: Log Kehadiran** - Adapt dari admin-dashboard attendanceTab
- [ ] **Tab 6: Dokumen SK Guru** - Adapt dari admin-dashboard documentsTab
- [ ] **Tab 7: Aturan Kepegawaian** - Status kepegawaian, validasi NIP/TMT
- [ ] **Tab 8: QR Scanner** - Adapt dari admin-dashboard qr-generatorTab
- [ ] **Tab 9: ID Card** - Adapt dari admin-dashboard idcardTab
- [ ] **Tab 10: Pengaturan** - Deduction settings, tenant config

### Phase 3: JavaScript Module - `public/sdm-dashboard.js`
- [ ] Authentication check & role detection (SDM Pusat vs Sekolah)
- [ ] Tenant filter dropdown (hanya tampil untuk SDM Pusat)
- [ ] Tab switching logic
- [ ] API service layer untuk semua endpoint SDM
- [ ] Chart.js integration untuk attendance & KPI charts
- [ ] Modal management (add/edit guru, KPI template, assessment)
- [ ] Export functions (PDF/Excel untuk rekap)

### Phase 4: CSS - `public/css/sdm-dashboard.css`
- [ ] Sidebar styling (consistent dengan admin-dashboard)
- [ ] Card/stat widget styling
- [ ] Table styling dengan sorting/filtering
- [ ] Modal styling
- [ ] KPI-specific components (progress bars, score badges)
- [ ] Responsive adjustments

### Phase 5: Integration & Testing
- [ ] Register routes di `server.js` atau route aggregator
- [ ] Add navigation link dari login/landing page untuk role SDM
- [ ] Test access control: SDM Pusat vs SDM Sekolah
- [ ] Test KPI flow: Template → Period → Assessment → Report
- [ ] Verify data isolation per tenant untuk SDM Sekolah

---

## KPI Custom Design Details

### Template per Jabatan (Contoh)
| Jabatan | KPI | Weight | Target | Type |
|---------|-----|--------|--------|------|
| Guru | Kehadiran | 30% | 95% | percentage |
| Guru | Penyelesaian Kurikulum | 25% | 100% | percentage |
| Guru | Evaluasi Siswa | 20% | 80% | numeric |
| Guru | Pengembangan Diri | 15% | 4 jam/bln | numeric |
| Guru | Kerja Sama Tim | 10% | Good | boolean |
| Kepala Sekolah | Manajemen Sekolah | 30% | - | - |
| TU/Bendahara | Ketepatan Administrasi | 40% | 98% | percentage |

### Assessment Flow
1. **SDM Pusat** buat template KPI per jabatan (global/per tenant)
2. **SDM Pusat** buat periode penilaian (semester/tahunan)
3. **SDM (Pusat/Sekolah)** input nilai aktual per guru per periode
4. Sistem hitung `achievement_pct = (actual/target)*100`
5. Convert ke `score` (skala 1-5 atau 0-100)
6. **Report**: Recap per guru, per jabatan, per sekolah, per periode

---

## API Response Examples

### GET /api/sdm-dashboard/stats
```json
{
  "success": true,
  "data": {
    "total_teachers": 150,
    "active_teachers": 142,
    "today_attendance": 138,
    "late_today": 12,
    "on_leave_today": 5,
    "kpi_summary": {
      "total_templates": 12,
      "active_period": "Semester 1 2025/2026",
      "completion_rate": 78.5,
      "avg_score": 4.2
    },
    "by_school": [
      {"tenant_id": "SMP01", "nama_sekolah": "SMP YPWI 1", "teachers": 45, "attendance_rate": 94.2},
      {"tenant_id": "SMP02", "nama_sekolah": "SMP YPWI 2", "teachers": 38, "attendance_rate": 91.8}
    ]
  }
}
```

### GET /api/sdm/kpi/templates?jabatan=Guru
```json
{
  "success": true,
  "data": [
    {"id": 1, "jabatan": "Guru", "kpi_name": "Kehadiran", "weight": 30, "target_value": 95, "target_type": "percentage"},
    {"id": 2, "jabatan": "Guru", "kpi_name": "Kurikulum", "weight": 25, "target_value": 100, "target_type": "percentage"}
  ]
}
```

---

## Validation & Error Handling

### Access Control Middleware
```javascript
function verifySdmAccess(req, targetTenantId) {
  if (req.user.role === 'admin') return true;
  
  const sdmAssignments = (req.user.assignments || []).filter(a => 
    (a.jabatan_di_unit || '').toLowerCase().includes('sdm')
  );
  
  if (sdmAssignments.length === 0) return false;
  
  const isSdmPusat = sdmAssignments.some(a => a.tenant_id === 'YPWILUTIM');
  if (isSdmPusat) return true; // Bisa akses semua
  
  // SDM Sekolah: hanya tenant assignment mereka
  const allowedTenants = sdmAssignments.map(a => a.tenant_id);
  return allowedTenants.includes(targetTenantId);
}
```

---

## Rollout Plan

1. **Week 1**: Backend routes + DB migration
2. **Week 2**: Frontend HTML + JS core (tabs, auth, tenant filter)
3. **Week 3**: Tab implementations (Dashboard, Guru, KPI, Payroll, Attendance)
4. **Week 4**: Remaining tabs (SK, Rules, QR, ID Card, Settings) + Polish
5. **Week 5**: Testing access control, KPI flow, exports + Bug fixes

---

## Open Questions / Decisions Needed

1. **KPI Scoring Scale**: 1-5 (seperti evaluasi existing) atau 0-100?
2. **KPI Approval Workflow**: Butuh approval atasan (Kepala Sekolah → SDM) atau langsung SDM input?
3. **Historical Data**: Apakah migrasi data evaluasi existing ke KPI baru?
4. **Notification**: Butuh notifikasi WhatsApp/Email saat KPI period dibuka/ditutup?
5. **Print Layout**: Format laporan KPI per guru (untuk SK/penilaian tahunan)?

---

## File Structure Output

```
/run/media/akbar-irwansya/Home/APP-YPWI/APP-YPWI/
├── public/
│   ├── sdm-dashboard.html          # MAIN PAGE
│   ├── sdm-dashboard.js            # Main JS module
│   └── css/
│       └── sdm-dashboard.css       # Custom styles
├── src/
│   └── routes/
│       ├── sdm-dashboard.js        # Dashboard stats APIs
│       └── sdm-kpi.js              # KPI management APIs
└── migrations/
    └── 001_add_kpi_tables.sql      # DB migration
```