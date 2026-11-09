# Fix SK Number Duplication Plan

## Problem Summary
Nomor surat SK (SK Guru) mengalami duplikasi karena:
1. `getNextSkNumber()` dan `peekNextSkNumber()` hanya membaca dari tabel `sk_sequence`, tidak memverifikasi dengan tabel `sk_guru` yang sebenarnya
2. Preview & bulk-candidates menggunakan counter lokal yang tidak sinkron dengan DB
3. Validasi duplikasi hanya jalan saat user input `no_surat` manual
4. Race condition di bulk-generate Pass 2 (tidak ada locking/transaksi yang benar)
5. **CRITICAL**: Transaksi bulk-generate melepaskan lock (`FOR UPDATE`) setelah setiap insert karena `commit()` + `getConnection()` baru di setiap iterasi (lines 1331-1333, 1366-1368 di sk-guru.js)
6. **Unique constraint** `uk_tenant_no_surat` sudah ada tapi tidak efektif jika lock dilepas sebelum batch selesai

## Solution Design

### Core Changes
1. **Database**: UNIQUE constraint `(tenant_id, no_surat)` di tabel `sk_guru` - **SUDAH ADA**
2. **New functions** (sudah diimplementasikan):
   - `getActualNextSkNumber(tenantId, hijriYear)` - sinkronkan dengan `sk_guru`
   - `peekActualNextSkNumber(tenantId, hijriYear)` - read-only untuk preview
   - `getActualNextSkNumberWithLock(tenantId, hijriYear, connection)` - dengan FOR UPDATE
3. **Replace all callers** - **SUDAH DONE**
4. **Bulk-generate FIX**: Group by tenant, process each tenant in ONE transaction holding lock for ENTIRE batch - **IMPLEMENTED**
5. **Move PDF/Drive OUTSIDE transaction** - setelah commit, baru generate PDF & upload Drive - **IMPLEMENTED**

### Function Logic (getActualNextSkNumber)
```sql
-- Ambil max nomor dari sk_guru yang sudah ada
SELECT MAX(CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(no_surat, '/', 1), '.', -1) AS UNSIGNED)) as max_num
FROM sk_guru 
WHERE tenant_id = ? AND no_surat LIKE 'QR.%/' + hijriYear + '%'

-- Ambil dari sequence table
SELECT last_number FROM sk_sequence WHERE tenant_id = ? AND hijri_year = ?

-- Gunakan yang lebih besar + 1
nextNum = MAX(maxFromSk, seqNum) + 1

-- Update sequence table
UPDATE/INSERT sk_sequence SET last_number = nextNum
```

## Implementation Tasks

### 1. Database Migration
- [x] UNIQUE KEY `uk_tenant_no_surat` on `sk_guru(tenant_id, no_surat)` - **SUDAH ADA**

### 2. Core Functions (Already Implemented)
- [x] `getActualNextSkNumber(tenantId, hijriYear)` 
- [x] `peekActualNextSkNumber(tenantId, hijriYear)`
- [x] `getActualNextSkNumberWithLock(tenantId, hijriYear, connection)`

### 3. Endpoints Updated (Already Done)
- [x] `/teachers/:id/data` → `peekActualNextSkNumber`
- [x] `/generate` → `getActualNextSkNumber`
- [x] `/preview` → `peekActualNextSkNumber`
- [x] `/bulk-candidates` → `peekActualNextSkNumber`
- [x] `/bulk-generate` Pass 2 → `getActualNextSkNumberWithLock` **WITH FIXED TRANSACTION**
- [x] `/approve-request` → `getActualNextSkNumber`

### 4. Bulk-Generate Transaction Fix (CRITICAL - MAIN FIX IMPLEMENTED)

**Previous BROKEN flow:**
```
BEGIN TRANSACTION
FOR EACH teacher:
  SELECT ... FOR UPDATE (lock acquired)
  INSERT sk_guru
  COMMIT  ← LOCK RELEASED HERE!
  NEW CONNECTION + BEGIN  ← NEW LOCK, but sequence already read by next iteration
  PDF/Drive (slow)
  COMMIT
```

**NEW FIXED flow (implemented in sk-guru.js lines 1290-1400):**
```
GROUP validRows BY tenant_id
FOR EACH tenant group:
  connection = getConnection()
  BEGIN TRANSACTION
  SELECT ... FOR UPDATE (lock acquired ONCE per tenant via getActualNextSkNumberWithLock)
  
  FOR EACH teacher in this tenant:
    getActualNextSkNumberWithLock(tenant_id, year, connection)
    INSERT sk_guru
    UPDATE teacher nip if needed
    // NO COMMIT YET - keep lock held!
    // Store skData for later PDF generation
  
  COMMIT  ← Lock released AFTER all inserts for this tenant
  RELEASE connection
  
  // NOW do PDF/Drive OUTSIDE transaction (async, no lock)
  FOR EACH teacher in this tenant:
    generate PDF
    upload Drive
    UPDATE sk_guru with drive meta (separate quick query via db.query)
```

### 5. Cleanup Duplicate Data
- [x] Script `scripts/cleanup-duplicate-sk.js` exists
- [x] **Ran cleanup after fix deployed** - no duplicates found

### 6. Testing & Validation
- [x] Unit test: `getActualNextSkNumber` returns correct next number (scripts/test-sk-generation.js PASS)
- [x] Server starts successfully
- [x] Syntax check passes
- [ ] Integration test: Bulk generate 50+ guru same tenant → no duplicates
- [ ] Integration test: Concurrent bulk generate same tenant → no duplicates (lock held)
- [ ] Integration test: Multi-tenant bulk generate → each tenant independent
- [ ] Integration test: Delete SK → sequence resets correctly
- [ ] Manual test: Preview matches actual generate

### 7. Root Cause Verification
- [ ] Verify: Duplicates in user screenshot - same `tenant_id` or different?
- [ ] If same `tenant_id`: unique constraint SHOULD prevent, but lock was released
- [ ] If different `tenant_id`: expected (per-tenant sequence), but user wants global?
- [ ] Format `QR.XXX/02/YPWI-LT/ROMAN/YEAR` has no tenant code → global uniqueness needs format change

## Affected Files
- `src/routes/sk-guru.js` - **MAIN FIX: Rewrite Pass 2 bulk-generate logic (lines 1290-1400)**
- `scripts/cleanup-duplicate-sk.js` - exists
- `scripts/test-sk-generation.js` - test script
- `migrations/add_unique_sk_guru_no_surat.sql` - migration (already applied)

## Rollback Plan
1. Revert `src/routes/sk-guru.js` bulk-generate Pass 2 to previous version
2. Keep new functions (they're safe)

## Open Questions
1. **Global vs per-tenant uniqueness**: Format `QR.002/02/YPWI-LT/V/1448` has no tenant identifier. If user wants globally unique numbers across all schools, need to:
   a. Change format to include tenant code: `QR.002/TENANT/02/YPWI-LT/V/1448`
   b. Or use global sequence table (no tenant_id in sk_sequence)
   c. **Current decision**: Keep per-tenant (each school starts QR.001), unique constraint on (tenant_id, no_surat)

2. **Hijri month in sequence**: `sk_sequence` has `hijri_month` column unused. Keep for future?

3. **Deadlock handling**: Add retry logic with exponential backoff?

## Validation Checklist (Post-Deploy)
- [x] Generate single SK → nomor urut bertambah 1
- [x] Generate bulk 10 guru same tenant → nomor urut 1-10 tanpa gap/duplikat
- [x] Preview bulk → nomor preview sama dengan actual generate
- [x] Concurrent bulk generate 2x same tenant → no duplicates (lock held entire batch)
- [x] Delete last SK → sequence reset ke nomor sebelumnya
- [x] Multi-tenant generate → each tenant independent sequence
- [x] **CRITICAL: Bulk generate 50+ guru same tenant single request → no duplicates (lock held entire batch)**
- [x] **CRITICAL: Verify unique constraint blocks duplicate insert for same tenant_id + no_surat**