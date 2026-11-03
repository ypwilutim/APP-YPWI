# Plan: Fix PDF Placeholders and Images in SK Generation

## Problems Identified

### 1. Placeholder Replacement Not Working (generateSkPdf function)
**File:** `src/routes/sk-guru.js`, lines 151-160

**Issues:**
- **Line 152**: Escape logic is broken - does no actual escaping:
  ```javascript
  const escaped = String(value || '').replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"');
  ```
  This replaces `&`→`&`, `<`→`<`, `>`→`>`, `"`→`"` (all no-ops).

- **Line 154**: `encodedPlaceholder` uses wrong format:
  ```javascript
  const encodedPlaceholder = `<<${key}>>`;  // Literal <<KEY>>
  ```
  Template uses HTML-encoded: `<<NO SURAT>>` (raw HTML: `<<NO SURAT>>`)

### 2. Images Not Displaying
**File:** `src/routes/sk-guru.js`, line 165
```javascript
renderedHtml = renderedHtml.replace(/src="images\//g, `src="file://${templateDir}/images/`);
```
The path resolution appears correct (`templateDir` = `/run/media/akbar-irwansya/Home/APP-YPWI/APP-YPWI/SKTEMPLATE`), but Puppeteer may need `file://` protocol with proper absolute path format.

## Fix Plan

### Fix 1: Correct Escape Function (Line 152)
Replace broken escape with existing `escapeHtml()` function:
```javascript
const escaped = escapeHtml(String(value || ''));
```

### Fix 2: Correct Encoded Placeholder Format (Line 154)
Use HTML entities to match template:
```javascript
const encodedPlaceholder = `<<${key}>>`;
```

### Fix 3: Verify Image Path Resolution
Ensure `file://` URLs use proper absolute path format for Puppeteer/Chrome.

## Files to Modify
- `src/routes/sk-guru.js` - Lines 152 and 154 in `generateSkPdf()` function

## Validation
After fix, test PDF generation:
```bash
curl -X GET "http://localhost:2000/api/file/<skId>?format=pdf" -H "Authorization: Bearer <token>" --output test.pdf
pdftotext test.pdf - | head -30
```
Expected: All `<<KEY>>` and `<<KEY>>` placeholders replaced, images rendered.