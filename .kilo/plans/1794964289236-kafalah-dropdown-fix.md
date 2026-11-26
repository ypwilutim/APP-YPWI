# KAFALAH Dropdown Fix for sdm-dashboard-v2.html

## Problem
The school dropdown in Pengaturan KAFALAH (Komponen Tunjangan & Potongan) on `sdm-dashboard-v2.html` is empty because the `/sdm-dashboard/tenants` endpoint filters tenants using `getSdmAllowedTenants()` which only returns tenants for SDM/Leader roles (`kepalasekolah`, `pimpinan`, `ketua`, `sdm`). It does NOT include `bendahara` roles.

Users who are logged in as bendahara (or have bendahara assignments) cannot see their schools in the KAFALAH dropdown.

## Solution
Modify `getSdmAllowedTenants()` in `src/routes/sdm-dashboard.js` to also include tenants where the user has `bendahara` assignment.

## Changes

### 1. Update `getSdmAllowedTenants` function (src/routes/sdm-dashboard.js:30-59)

Add `bendahara` to the list of roles that grant tenant access:

```javascript
async function getSdmAllowedTenants(req) {
  if (req.user.role === 'admin') {
    const allTenants = await db.query('SELECT tenant_id FROM tenants');
    return allTenants.map(t => t.tenant_id);
  }

  const norm = (v) => (v || '').toLowerCase().replace(/[\s_]+/g, '');
  const isLeader = (a) => ['kepalasekolah', 'pimpinan', 'ketua'].includes(norm(a.jabatan_di_unit));

  const assignments = req.user.assignments || [];
  const sdmAssignments = assignments.filter(a =>
    (a.jabatan_di_unit || '').toLowerCase().includes('sdm')
  );
  const leaderAssignments = assignments.filter(isLeader);
  // NEW: Add bendahara assignments
  const bendaharaAssignments = assignments.filter(a =>
    norm(a.jabatan_di_unit) === 'bendahara'
  );

  if (sdmAssignments.length === 0 && leaderAssignments.length === 0 && bendaharaAssignments.length === 0) {
    return [];
  }

  const isSdmPusat = sdmAssignments.some(a => a.tenant_id === 'YPWILUTIM');
  if (isSdmPusat) {
    const allTenants = await db.query('SELECT tenant_id FROM tenants');
    return allTenants.map(t => t.tenant_id);
  }

  const tenants = new Set();
  sdmAssignments.forEach(a => { if (a.tenant_id) tenants.add(a.tenant_id); });
  leaderAssignments.forEach(a => { if (a.tenant_id) tenants.add(a.tenant_id); });
  // NEW: Add bendahara tenants
  bendaharaAssignments.forEach(a => { if (a.tenant_id) tenants.add(a.tenant_id); });
  return [...tenants];
}
```

## Impact
This change affects ALL endpoints in `sdm-dashboard.js` that use `getSdmAllowedTenants()` (21 endpoints). This is acceptable because:
- Bendahara users should have access to their school's data in the SDM dashboard
- The SDM dashboard is meant for operational staff including bendahara
- The change is additive (only adds more tenants, doesn't remove existing access)

## Verification
1. Login as a user with only `bendahara` assignment (no SDM/Leader role)
2. Navigate to sdm-dashboard-v2.html
3. Open KAFALAH tab
4. Verify the school dropdown (`kafalahTenantSelect`) shows the user's assigned school(s)
5. Verify KAFALAH data loads correctly for the selected school