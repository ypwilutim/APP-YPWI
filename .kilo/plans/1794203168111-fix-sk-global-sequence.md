# Plan: Update SK Number Format to Global Sequence + Tenant ID

## Current Format
```
QR.{nomor_urut_per_tenant}/02/YPWI-LT/{bulan_romawi}/{tahun_hijriah}
```
- Nomor urut per tenant (QR.001 bisa duplikat di tenant berbeda)
- `/02/` hardcoded, bukan tenant ID

## New Format (Required)
```
QR.{nomor_urut_global}/{tenant_id}/YPWI-LT/{bulan_romawi}/{tahun_hijriah}
```
- **Nomor urut GLOBAL** (unique across all tenants)
- **Tenant ID** di posisi ke-2 (ganti `/02/`)

## Contoh Baru
| Tenant | Nomor Surat |
|--------|-------------|
| PPIB | `QR.001/PPIB/YPWI-LT/V/1448` |
| PPIB | `QR.002/PPIB/YPWI-LT/V/1448` |
| SDIT01 | `QR.003/SDIT01/YPWI-LT/V/1448` |
| TKIT02 | `QR.004/TKIT02/YPWI-LT/V/1448` |

## Implementation Plan

### 1. Database Changes
- [ ] **Migration**: Create global sequence table (or modify `sk_sequence`)
- [ ] **Unique constraint**: Already on `(tenant_id, no_surat)` - keep
- [ ] **Index**: Add index on `no_surat` for global lookup

### 2. Core Functions (`sk-guru.js`)

#### `getActualNextSkNumber` / `peekActualNextSkNumber`
- Change to use **global sequence** (single counter for all tenants)
- Remove `tenant_id` from sequence lookup
- Sequence keyed only by `hijri_year`

#### `buildSkData` (line ~442)
```javascript
// OLD:
const noSurat = noSuratCustom || ('QR.' + String(nomorUrut).padStart(3, '0') + '/02/YPWI-LT/' + romanMonth + '/' + hijriToday.year);

// NEW:
const tenantCode = teacher.tenant_id || 'UNKNOWN';
const noSurat = noSuratCustom || ('QR.' + String(nomorUrut).padStart(3, '0') + '/' + tenantCode + '/YPWI-LT/' + romanMonth + '/' + hijriToday.year);
```

#### Parsing logic (for duplicate check)
- Update regex in `getActualNextSkNumber` to extract nomor urut from new format
- Old: `SUBSTRING_INDEX(SUBSTRING_INDEX(no_surat, '/', 1), '.', -1)`
- New: Same (still `QR.XXX/...`)

### 3. Sequence Table Schema
```sql
-- Option A: Modify existing sk_sequence (simpler)
-- Current: tenant_id, hijri_year, hijri_month, last_number
-- New: hijri_year (PK), last_number (global)

-- Option B: New table sk_global_sequence
CREATE TABLE sk_global_sequence (
  hijri_year INT PRIMARY KEY,
  last_number INT NOT NULL DEFAULT 0
);
```

**Recommendation: Option B** - cleaner separation

### 4. Migration Steps
1. Create `sk_global_sequence` table
2. Migrate existing max numbers per hijri_year from `sk_guru`
3. Update all functions to use global sequence
4. Update `buildSkData` format string
5. Test

### 5. Functions to Update
- `peekActualNextSkNumber` → global, no tenant_id param
- `getActualNextSkNumber` → global, no tenant_id param  
- `getActualNextSkNumberWithLock` → global, FOR UPDATE on global table
- `buildSkData` → use `teacher.tenant_id` in format
- `bulk-generate` Pass 2 → lock global sequence once per batch

### 6. Bulk Generate Transaction
- Single global lock for entire batch (not per tenant)
- `SELECT last_number FROM sk_global_sequence WHERE hijri_year = ? FOR UPDATE`

### 7. Backward Compatibility
- Old format numbers still valid in DB (unique constraint on tenant_id + no_surat)
- New numbers follow new format
- No need to rename existing SKs

## Rollback Plan
1. Revert `buildSkData` format string
2. Revert sequence functions to per-tenant
3. Drop `sk_global_sequence` table

## Testing Checklist
- [ ] Global sequence increments across tenants
- [ ] Tenant ID appears correctly in no_surat
- [ ] No duplicate QR.XXX across all tenants
- [ ] Bulk generate multiple tenants → sequential global numbers
- [ ] Preview matches actual generate
- [ ] Unique constraint still works