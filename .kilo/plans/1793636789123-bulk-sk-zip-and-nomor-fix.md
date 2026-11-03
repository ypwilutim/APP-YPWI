# Plan: Bulk SK Generate - Fix Nomor Surat Allocation & Add ZIP Download

## Problem 1: Nomor Surat Wasted on Skipped Rows
Current flow in `bulk-generate` (line 1205):
```javascript
const nomorUrut = await getNextSkNumber(teacher.tenant_id, hijriToday.year);
```
This increments the DB sequence **for every row in the loop**, even if the row is later skipped (duplicate no_surat, NIY conflict, not qualified, tenant access denied). This wastes nomor surat numbers.

**User requirement:** Only assign nomor surat to teachers that are actually generated. If unchecked in UI → no nomor allocated. If skipped due to error → nomor not wasted.

## Problem 2: No ZIP Download for Bulk Generate
After bulk generate, users must download each SK individually via `/api/file/:skId`. Need a bulk download endpoint that returns a ZIP with all generated SK PDFs.

---

## Solution Design

### 1. Fix Nomor Surat Allocation (Backend)

**Change in `src/routes/sk-guru.js` - `bulk-generate` endpoint:**

**Current approach:** Call `getNextSkNumber` inside the loop for each row.

**New approach:** Two-pass processing:
- **Pass 1:** Validate all rows, collect valid rows that will be generated
- **Pass 2:** For each valid row, call `getNextSkNumber` and insert

This ensures sequence only advances for rows that actually get inserted.

```javascript
// Pass 1: Validate all rows, build list of valid rows
const validRows = [];
for (const row of rows) {
  // ... validation logic (teacher exists, qualified, no conflicts, etc.)
  // If valid, push to validRows with all computed data EXCEPT nomorUrut
  validRows.push({ row, teacher, skDataWithoutNomor });
}

// Pass 2: Assign nomorUrut and insert
for (const { row, teacher, skDataWithoutNomor } of validRows) {
  const nomorUrut = await getNextSkNumber(teacher.tenant_id, hijriToday.year);
  const skData = buildSkData(..., nomorUrut, ...);
  // INSERT
}
```

**Key changes:**
- Move `getNextSkNumber` call to AFTER all validation passes
- Only call for rows that pass all checks
- Keep `usedNoSurat` and `usedTeacherKey` checks in pass 1

### 2. Add ZIP Download Endpoint (Backend)

**New endpoint:** `POST /api/sk-guru/bulk-download`
- Input: `{ sk_ids: [1, 2, 3, ...] }` or `{ generated: [...] }` from bulk-generate response
- Output: ZIP file containing PDF for each SK
- Uses existing PDF generation logic (reuse `buildHtmlSk` + Chrome headless)

**Implementation:**
```javascript
router.post('/bulk-download', authenticateOperator, async (req, res) => {
  const { sk_ids } = req.body;
  // Verify access for all SKs
  // Generate PDF for each SK in memory
  // Create ZIP using archiver or similar
  // Stream ZIP to response
});
```

**Dependencies:** Add `archiver` package (or use existing `pizzip` if suitable for ZIP)

### 3. Frontend Changes

**In `public/js/admin-dashboard.js`:**
- After bulk generate success, show "Download ZIP" button alongside the result modal
- Call new `/api/sk-guru/bulk-download` with list of generated SK IDs
- Handle ZIP blob download

---

## Files to Modify

1. **`src/routes/sk-guru.js`**
   - Refactor `bulk-generate` to two-pass validation
   - Add `POST /bulk-download` endpoint

2. **`public/js/admin-dashboard.js`**
   - Add `downloadSkBulkZip` function
   - Add ZIP download button in bulk generate result modal

3. **`package.json`** (if needed)
   - Add `archiver` dependency for ZIP creation

---

## Validation Plan

1. **Nomor Surat Fix:**
   - Test bulk generate with 5 teachers, uncheck 2 → only 3 nomor surat used
   - Test with duplicate no_surat in payload → only valid rows get nomor
   - Test with NIY conflict → skipped row doesn't consume nomor
   - Verify sequence in `sk_sequence` table only advances for generated rows

2. **ZIP Download:**
   - Generate 3 SKs via bulk → click "Download ZIP" → receive valid ZIP with 3 PDFs
   - Verify each PDF in ZIP is valid and correct
   - Test with single SK (edge case)

3. **Regression:**
   - Single SK generate still works
   - Bulk generate still works for all valid cases
   - Approval flow unchanged
   - Scheduler auto-generate unchanged

---

## Rollout
- Deploy backend changes first
- Deploy frontend changes
- Test in staging with real data
- Monitor `sk_sequence` table for correct increments

---

## Open Questions

1. **ZIP library:** Use `archiver` (streaming, memory efficient) or `pizzip` (already in deps)? → Recommend `archiver` for streaming large ZIPs
2. **Batch size limit:** Should bulk-download have a max SK count (e.g., 50) to avoid memory issues?
3. **Async vs sync:** Generate PDFs sequentially or in parallel? → Sequential to avoid Chrome headless conflicts