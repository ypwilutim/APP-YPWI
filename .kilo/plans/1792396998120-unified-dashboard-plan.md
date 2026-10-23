# Unified Dashboard Plan - APP-YPWI (Final Version)

## Overview
Unified dashboard system with payroll hierarchy, SPMB features, item management, and cashflow recording. All dashboards (sdm, bendahara, admin) share unified payroll with tenant-based filtering.

## Salary Structure & Hierarchy

### Income Components (13 items)
1. KAFALAH POKOK
2. Tunj. Keluarga (Istri, Anak, Jumlah anak)
3. Tunj. Struktural
4. Tunj. Fungsional
5. Tunj. Transportasi
6. Tunj. Kedatangan
7. Tunj. Tidak Pulang Cepat
8. Tunj. Uang Makan
9. KJM
10. Tunj. Prestasi Kinerja (KPI)
11. Tunj. Apresiasi
12. Tunj. Pembina
13. Tunj. Jam Mengajar

### Deduction Components (4 items)
1. PEMOTONGAN LUAR TANGGUNGAN
2. DURASI SIM-T
3. Ta'awun
4. Piutang

### Setting Hierarchy (3 levels)
- **Level 1: Pusat (YPWILUTIM)** → Base nominal for all schools
- **Level 2: Sekolah** → Override central if funding constraints
- **Level 3: Bendahara/Individual** → Per-teacher nominal flexibility

### SPMB Features
- **Pemasukan SPMB**: Biaya pendaftaran siswa, diatur admin pusat & bendahara
- **Pengeluaran SPMB**: Biaya buku/seragam/dll yang dikeluarkan, tercatat saat pengeluaran
- SPMB tracked per-tenant with central/school/individual override capability

## Affected Files & Boundaries

### `src/routes/treasurer.js`
- `GET /treasurer/payroll-unified` - Unified payroll with tenant filtering + hierarchy
- `GET/POST /treasurer/salary-settings` - Manage 3-tier salary settings
- `GET/POST /treasurer/spmb-transactions` - SPMB income/expense tracking
- Tenant-aware queries (YPWILUTIM = all, others = unit only)

### `src/routes/admin.js`
- Admin salary settings management (central level)
- School SPMB settings
- SPMB transaction endpoints

### Dashboard HTML files
- `public/admin-dashboard.html` - Central settings + SPMB overview
- `public/bendahara-dashboard.html` - School + individual settings + cashflow
- `public/sdm-dashboard.html` - Central settings oversight + payroll
- `public/bendahara-sekolah.html` (new) - School-level SPMB + individual settings

### Key Boundaries
- YPWILUTIM: Can manage all tenants, all levels
- SDM Sekolah: Only their unit's teachers + their school's settings
- Bendahara Pusat: All schools, all levels
- Bendahara Sekolah: Only their school's teachers + their school's settings

## Data Flow

### Payroll Calculation with Hierarchy
```
1. Fetch central defaults (YPWILUTIM tenant)
2. Apply school override if tenant != YPWILUTIM
3. Apply individual bendahara override per teacher
4. Return calculated salary with all 13+4 components
```

### SPMB Income/Expense Tracking
```
- Input: SPMB transaction (income or expense)
- Filter by tenant with hierarchy awareness
- Store: type (income/expense), category (pendaftaran/buku/seragam/dll), nominal, date, tenant_id
- Report: SPMB financial summary per school
```

### Cashflow Recording
- Form in bendahara-dashboard financial tab
- "Dengan struk" mode: Auto-extract items via AI
- "Tanpa struk" mode: Manual input, pending approval
- Links to salary components and SPMB categories

## Implementation Phases

### Phase 1: Core Infrastructure
- [x] Salary hierarchy schema (salary_settings table or extensions)
- [x] Payroll-unified API with tenant filtering
- [x] Three-tier override logic

### Phase 2: SPMB Features
- SPMB transaction API endpoints
- SPMB income/expense tracking UI
- Financial reports including SPMB

### Phase 3: Dashboard Integration
- Admin: Central salary settings + SPMB overview
- Bendahara: School + individual settings + cashflow form
- SDM: Central settings oversight + payroll
- New: bendahara-sekolah.html with school-level features

### Phase 4: Validation
- Payroll shows correct hierarchical values
- YPWILUTIM sees all schools, others see their unit
- SPMB income/expense tracked per school
- Cashflow records match transactions
- All 4 dashboards consistent when filtered by same tenant/period

## Open Questions (Documented)
1. Salary settings storage: new table vs extend existing?
2. 13+4 components across 3 levels: separate fields or JSON?
3. UI bendahara view: central + overrides or just their level?
4. Migration: existing teachers' data transition?
5. Cashback feature: user dismissed, likely not needed or separate feature
6. Point 2.6: Referenced in original progress but needs clarification

## Validation Plan (Comprehensive)
1. Central sets base KAFALAH POKOK = 1,000,000 → all teachers get this
2. School A overrides → their teachers get 900,000 instead
3. Bendahara at School A sets individual → Teacher X = 800,000, Teacher Y = 950,000
4. YPWILUTIM overrides central → all schools affected uniformly
5. Non-YPWILUTIM tenants: only see their relevant levels
6. Payroll API returns values considering all overrides correctly
7. SPMB transactions: income/expense tracked per school, balances correctly
8. Cashflow: records created, categorized, appear in financial reports
9. All 4 dashboards show consistent data when filtered by same tenant/period
10. School admin can manage their SPMB settings, admin pusat can view all