# Plan: Fix PDF Export for SK (Surat Keputusan)

## Problem Analysis

The PDF export for SK documents is not working correctly. The current implementation uses Puppeteer to render `SKTEMPLATE/test.html` to PDF, but **placeholder replacement is broken**.

### Root Cause: Placeholder Encoding Mismatch

**Template (`SKTEMPLATE/test.html`)** uses HTML-encoded placeholders:
- Source: `<<NO SURAT>>` → renders as `<<NO SURAT>>` in browser
- In raw HTML string: literal `<<NO SURAT>>` (actual `<` and `>` characters)

**Current Code** (line 154 in `sk-guru.js`):
```javascript
const encodedPlaceholder = "<<<" + key + ">>>";  // Produces <<<KEY>>> (triple)
```

**Should be:**
```javascript
const encodedPlaceholder = "<<" + key + ">>";  // Produces <<KEY>> (double)
```

The template uses **double** `<<KEY>>` (which is `<<KEY>>` in HTML source), but the code generates **triple** `<<<KEY>>>`.

## Files to Modify

1. **`src/routes/sk-guru.js`** - Fix `generateSkPdf()` function

## Fix Plan

### 1. Fix Placeholder Encoding (Critical)

**File:** `src/routes/sk-guru.js` line 154

**Current:**
```javascript
const encodedPlaceholder = "<<<" + key + ">>>"; // WRONG - triple
```

**Fixed:**
```javascript
const encodedPlaceholder = "<<" + key + ">>"; // CORRECT - double
```

### 2. Verify Raw Placeholder Replacement

The `rawPlaceholder` at line 153 uses backticks: `` `<<${key}>>` `` which correctly produces `<<KEY>>` (double). This part is correct.

### 3. Test Data Mapping

Verify the `htmlData` object keys match template placeholders:
- Template uses: `NO SURAT`, `TENTANG`, `TNTANG`, `NAMA`, `TTL`, `TMT`, `PT`, `NIY`, `UNIT`, `JABATAN`, `TGL_MULAI`, `STATUS`, `TGL_SELESAI`, `BH`, `BM`, `PERIODE`
- Current `htmlData` keys match ✓

### 4. Image Path Resolution

Line 165: `renderedHtml.replace(/src="images\//g, 'file://...')` - This converts relative image paths to absolute file:// URLs. Verify images exist at `SKTEMPLATE/images/`.

## Implementation Steps

1. **Edit `src/routes/sk-guru.js`** line 154: Change `<<<` to `<<` and `>>>` to `>>`
2. **Restart server** and test PDF generation
3. **Verify** placeholders are replaced by checking PDF content

## Validation

After fix, test with:
```bash
curl -X GET "http://localhost:2000/api/file/88?format=pdf" -H "Authorization: Bearer <token>" --output test.pdf
pdftotext test.pdf - | head -30
```

Expected: All `<<KEY>>` placeholders replaced with actual data values.

## Rollback

If issues persist, the old `pdfkit` implementation is in git history. The Puppeteer approach is preferred as it renders the exact `test.html` template.