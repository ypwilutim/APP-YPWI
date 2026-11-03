# Plan: Fix Empty ZIP in Bulk Download - Switch to pdfkit

## Problem
The `/api/bulk-download` endpoint generates empty ZIP files on hosting because:
1. Chrome/Chromium is not installed on the hosting server
2. `getChromePath()` returns `undefined` 
3. PDF generation is silently skipped (`if (chromePath)` check fails)
4. No PDFs are appended to the archive → empty ZIP

## Root Cause
In `src/routes/sk-guru.js:1386`:
```javascript
const chromePath = getChromePath();
if (chromePath) {
  // generate PDF with Chrome
}
// If chromePath is falsy, nothing happens, loop continues
```

## Solution: Use pdfkit (already in codebase)
Refactor SK PDF generation to use `pdfkit` instead of headless Chrome. This is already used in:
- `paktaIntegritas.js`
- `payroll.js`
- `idcard.js`
- `treasurer.js`

## Files to Modify
1. **`src/routes/sk-guru.js`** - Replace Chrome-based PDF generation with pdfkit in:
   - `GET /file/:skId` (single SK download)
   - `POST /bulk-download` (bulk ZIP download)
   - `POST /preview` (preview)

## Implementation Approach

### Option A: Create a reusable `generateSkPdf(skData)` function
- Accepts the `htmlData` object (same as `buildHtmlSk`)
- Returns a PDF buffer using pdfkit
- Replaces the HTML→Chrome→PDF pipeline

### Option B: Convert HTML template to pdfkit drawing commands
- More work but pixel-perfect
- Since template is complex (tables, images, positioning), Option A is simpler

### Recommended: Hybrid Approach
1. Keep the HTML template for structure reference
2. Create pdfkit equivalent that draws the same layout
3. Use the existing `buildSkData()` output (already has all formatted fields)

## Key Fields from `buildSkData()` to render:
| Field | Usage |
|-------|-------|
| `noSurat` | Header |
| `tentang` | Title |
| `nama`, `ttl`, `tmtFormatted`, `ptFormatted` | Biodata table |
| `niy` | Biodata |
| `unit` | Unit kerja |
| `jabatan` | Jabatan |
| `tglMulai`, `tglSelesai`, `periode` | PERTAMA dictum |
| `bhFormatted`, `bmFormatted` | TTD date |

## Validation Plan
1. Single SK download (`/api/file/:id?format=pdf`) → valid PDF
2. Bulk download (`/api/bulk-download`) → ZIP with multiple PDFs
3. Preview (`/api/preview`) → PDF download works
4. Compare output visually with old Chrome-generated PDF

## Rollback
Keep the old Chrome code commented or in a separate branch for comparison.

## Questions
1. Should we keep the DOCX download path unchanged? (Yes, it uses PizZip/template)
2. Any specific fonts/images in the HTML template that need replication? (KOP image, Bismillah image, signature image, stamp image)
3. Page size: F4/Folio (215mm x 330mm) per template `@page` rule