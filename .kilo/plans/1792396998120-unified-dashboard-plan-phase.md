# Phase 1: Payroll Unification (Core Foundation)

## Goal
Create single payroll API endpoint usable by all dashboards with tenant-based filtering.

### Tasks
1. **Modify `src/routes/treasurer.js`**:
   - Add `GET /treasurer/payroll-unified` endpoint
   - Support query params: `tenant_id`, `month`, `year`
   - Filter teacher salaries by tenant access rules
   - Return same structure as existing payroll summary

2. **Update dashboard HTML files** to use new endpoint:
   - `public/sdm-dashboard.html` - replace payroll tab data fetch
   - `public/bendahara-dashboard.html` - replace payroll tab data fetch
   - `public/admin-dashboard.html` - replace payroll tab data fetch
   - (bendahara-sekolah.html akan dibuat dalam fase selanjutnya)

3. **Tenant filtering logic**:
   - `YPWILUTIM` → show all schools' data
   - Other tenants → show only their unit's teachers

### Validation
- All 4 dashboards show consistent payroll data when filtered by same tenant/period
- YPWILUTIM user can see all schools, SDM Sekolah only sees their unit

---

# Phase 2: school-admin.html Creation

## Goal
Create school admin dashboard page with SPMB features.

### Tasks
1. **Create `public/school-admin.html`** based on admin-dashboard SPMB features:
   - SPMB dashboard overview
   - School-level SPMB settings
   - Bendahara receipt processing for SPMB

2. **Add routes** in `src/routes/admin.js`:
   - `GET /api/admin/sph-overview` - SPMB overview per school
   - `POST /api/admin/sph-settings` - Save SPMB settings per school

3. **Add SPMB settings UI**:
   - Site SPMB configuration form
   - Admin pusat vs admin sekolah permission separation

### Validation
- School admin can access their school's SPMB settings
- Admin pusat can view/modify all schools' SPMB settings
- Bendahara can process SPMB receipts per their access level

---

# Phase 3: Item Management System

## Goal
Universal, local, and individual item management.

### Tasks
1. **Add item API endpoints** in `src/routes/treasurer.js`:
   - `GET /treasurer/items?type=universal/local/individual`
   - `POST /treasurer/items` - Create new item
   - `PUT /treasurer/items/:id` - Update item
   - `DELETE /treasurer/items/:id` - Delete item

2. **Tenant filtering for items**:
   - Universal items: visible to all tenants
   - Local items: visible only to specific tenant's school
   - Individual items: associated with specific student

3. **Update dashboard UIs**:
   - Add item selection in billing/SPP forms
   - Show item categories per school capability

### Validation
- Can create universal items visible to all schools
- Can create local items restricted to specific tenant
- Can create individual items for specific students
- Item selection works in SPP billing forms

---

# Phase 4: Cashflow Recording

## Goal
Add cashflow transaction recording to financial tab.

### Tasks
1. **Enhance financial tab** in bendahara-dashboard.html:
   - Add "Catat Transaksi" (Record Transaction) button
   - Add transaction form with: tanggal, jenis, nominal, akun, keterangan
   - Support "dengan struk" and "tanpa struk" modes

2. **Add API endpoints** in `src/routes/treasurer.js`:
   - `POST /treasurer/financial-transactions` - Create new transaction
   - Support BSI VA integration for "dengan struk" mode

3. **Update financial report** to include cashflow:
   - Modify existing `GET /treasurer/financial-report` to include cashflow items
   - Show breakdown: pemasukan (SPP + cashflow), pengeluaran (gaji + cashflow), saldo

### Validation
- Transactions can be recorded with or without receipt
- "Dengan struk" mode extracts items via AI automatically
- "Tanpa struk" mode requires manual approval
- Financial reports balance correctly (pemasukan - pengeluaran = saldo)

---

# Phase 5: SPMB Integration & VA Testing

## Goal
Complete SPMB features and test VA transactions.

### Tasks
1. **Add SPMB routes** in `src/routes/admin.js`:
   - `GET /api/admin/spmb-dashboard` - SPMB dashboard data
   - `POST /api/admin/spmb-settings` - Save SPMB site settings
   - `GET /api/admin/spmb-student/:id` - Get student SPMB data

2. **Integrate with bendahara dashboards**:
   - Add SPMB receipt processing in bendahara-dashboard.html
   - Add SPMB VA check endpoint integration

3. **Test VA transactions**:
   - Test `GET /treasurer/public/check-bsi-payment` endpoint
   - Verify financial report balance after VA payments
   - Test report generation (PDF/Excel export)

### Validation
- VA payments correctly update student balances
- SPMB dashboard shows correct per-school data
- Financial reports include SPMB transactions
- VA check endpoint returns correct payment status

---

# Phase 6: Remaining Checklist Items

## Goal
Complete all items from original progress list.

### Tasks
1. **Ceklist item sesuai kemampuan sekolah** - Add school capability filtering in item management
2. **Webflow pencatatan uang keluar masuk (cashflow)** - Already covered in Phase 4
3. **Webflow cashback** - Add cashback calculation in financial reports
4. **Webflow spp** - Ensure SPMB integration works across all dashboards
5. **Webflow pengaturan admin pusat** - Add central admin SPMB settings
6. **Webflow pengaturan admin sekolah** - Add school-level SPMB settings
7. **Webflow pemasukan dan pengeluaran SPMB** - Integration point for SPMB fees
8. **SPMB - admin-dashboard.html dan school-admin.html** - Completed in Phases 2 & 5
9. **SPP - Bendahara-dashboard.html** - Already has SPP features, enhance with item management
10. **Testing VA transacion & report** - Already covered in Phase 5

### Validation
- All checklist items from original progress list are addressed
- School capability filtering works correctly
- Cashback feature integrated in financial reports
- SPMB features work across all specified pages
- VA transactions tested and reports generated correctly