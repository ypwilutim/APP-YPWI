# Plan: SK PDF Generation with pdfmake (No Chrome/Chromium)

## Goal
Replace Puppeteer/Chrome-based PDF generation with **pdfmake** to generate SK PDFs that match `SKTEMPLATE/test.html` exactly, without requiring Chrome/Chromium on the hosting server.

## Current State
- PDF generation uses `execFileSync(chromePath, [...])` with headless Chrome
- Template: `SKTEMPLATE/test.html` (F4/Folio 215mm×330mm, specific CSS)
- Images: KOP, Bismillah, Stempel, Signature in `SKTEMPLATE/images/`
- DOCX generation via `docxtemplater` + `pizzip` already works

## Target State
- Pure Node.js PDF generation using `pdfmake` (already in deps)
- Exact layout match with `test.html`
- Images embedded as base64
- No Chrome/Chromium dependency
- Remove Chrome fallback code paths

---

## Implementation Steps

### 1. Create PDF Template Module (`src/utils/skPdfTemplate.js`)
Build a pdfmake document definition that replicates `test.html` structure:

**Page Setup**
- Page size: F4/Folio (215mm × 330mm) = 609.45pt × 935.43pt
- Margins: top 10mm (28.35pt), right 15mm (42.52pt), bottom 10mm (28.35pt), left 15mm (42.52pt)
- Font: "Times New Roman" (default), fallback to "Roboto" if needed

**Structure (matching test.html exactly):**
1. **Header/KOP** - Centered image (image2.jpg), full width ~680px
2. **Bismillah** - Centered image (image1.png), width ~130px
3. **Title Block** - "SURAT KEPUTUSAN", "KETUA YAYASAN...", "Nomor: <<NO_SURAT>>", "TENTANG", "<<TENTANG>>"
4. **Preamble** - "KETUA YAYASAN... SETELAH,"
5. **Considerations Table** (Menimbang, Mengingat, Memperhatikan) - 4-column table
6. **MEMUTUSKAN** - Centered
7. **Menetapkan** - Label only
8. **PERTAMA** - Content with placeholders
9. **Biodata Table** - 3-column table, indented 115pt from left
10. **KEDUA & KETIGA** - Simple 3-column table
11. **Tanda Tangan Block** - Right-aligned table with:
    - "Ditetapkan di: Luwu Timur"
    - "Pada tanggal: <<BH>> (underlined) / <<BM>>" stacked
    - Organization lines
    - **Stempel image** (image4.png) - positioned absolute left:-15px, top:-130px, rotated -3deg
    - **Signature image** (image3.png) - positioned absolute left:100px, top:-100px, rotated 1deg
    - Name "Usman, S.Pd.I,. Gr." underlined bold
    - NIY line
12. **Tembusan** - Numbered list

**Image Handling:**
- Read 4 images at module load, convert to base64 data URLs
- Cache base64 strings
- Use in document definition via `image: 'data:image/png;base64,...'`

**Placeholders:**
All `<<PLACEHOLDER>>` tokens replaced at runtime via `buildHtmlSk`-style replacement on the document definition (deep string replace in text fields).

---

### 2. Create PDF Generator Function (`src/utils/generateSkPdf.js`)
```javascript
const pdfMake = require('pdfmake');
const pdfFonts = require('pdfmake/build/vfs_fonts'); // or custom font registration
const skPdfTemplate = require('./skPdfTemplate');

function generateSkPdf(skData) {
  // 1. Get base document definition from template
  const docDefinition = skPdfTemplate.getDefinition(skData);
  
  // 2. Create pdfMake printer with fonts
  const printer = new pdfMake(pdfFonts);
  
  // 3. Create PDF kit doc
  const pdfDoc = printer.createPdfKitDocument(docDefinition);
  
  // 4. Return as buffer (Promise)
  return new Promise((resolve, reject) => {
    const chunks = [];
    pdfDoc.on('data', chunk => chunks.push(chunk));
    pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
    pdfDoc.on('error', reject);
    pdfDoc.end();
  });
}
```

**Font Registration:**
- Register "Times New Roman" if TTF available, otherwise use pdfmake's default Roboto
- Since exact font match is required, consider bundling a TTF or using Roboto with adjusted sizes

---

### 3. Update `src/routes/sk-guru.js`

**Remove:**
- `getChromePath()` function (lines 12-49)
- Chrome `execFileSync` calls in:
  - `POST /generate` (lines 620-659)
  - `GET /file/:skId` (lines 820-857)
  - `POST /bulk-download` (lines 1407-1438)
- Temp file creation (`tmpHtml`, `tmpPdf`)

**Add:**
- Import `generateSkPdf` from `../utils/generateSkPdf`
- Replace PDF generation blocks with:
  ```javascript
  const pdfBuf = await generateSkPdf(htmlData); // htmlData = same object passed to buildHtmlSk
  res.setHeader('Content-Length', pdfBuf.length);
  res.end(pdfBuf);
  ```

**Keep:**
- DOCX generation (unchanged)
- `buildHtmlSk` for HTML preview endpoint
- All data preparation logic (`buildSkData`, etc.)

---

### 4. Handle Fonts for Exact Match
Since test.html uses "Times New Roman" at specific sizes (9.5pt, 10pt):
- Option A: Bundle a Times New Roman TTF (license check needed)
- Option B: Use pdfmake's built-in Roboto, adjust font sizes slightly to match visual density
- Option C: Use `pdfmake` with `fontFamily: 'Times'` (maps to system font - may not exist on server)

**Recommended:** Bundle a free serif font (e.g., "Noto Serif" or "Liberation Serif") that's metrically compatible, register with pdfmake, use consistently.

---

### 5. Image Preparation
Create `SKTEMPLATE/images_base64.json` at build time or load dynamically:
```javascript
const fs = require('fs');
const path = require('path');
const imagesDir = path.join(__dirname, '../../SKTEMPLATE/images');

const imageFiles = {
  kop: 'image2.jpg',      // KOP YPWI
  bismillah: 'image1.png',
  stempel: 'image4.png',
  ttd: 'image3.png'
};

function loadImagesBase64() {
  const result = {};
  for (const [key, filename] of Object.entries(imageFiles)) {
    const filepath = path.join(imagesDir, filename);
    const ext = path.extname(filename).slice(1);
    const buffer = fs.readFileSync(filepath);
    result[key] = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${buffer.toString('base64')}`;
  }
  return result;
}
```

---

### 6. Complex Layout Challenges in pdfmake

| test.html Feature | pdfmake Approach |
|-------------------|------------------|
| F4 page size | `pageSize: { width: 609.45, height: 935.43 }` |
| Custom margins | `pageMargins: [42.52, 28.35, 42.52, 28.35]` |
| Absolute positioned images (stempel, ttd) | Use `canvas` with absolute positioning or `image` with `absolutePosition` |
| Tables with specific column widths | `table: { widths: [90, 10, 15, '*'], body: [...] }` |
| Underlined BH date | `{ text: '<<BH>>', decoration: 'underline' }` |
| Stacked BH/BM dates | `{ stack: [{text: '<<BH>>', decoration: 'underline'}, '<<BM>>'], lineHeight: 1.2 }` |
| Rotated images | Not directly supported - may need to pre-rotate images or skip rotation |
| `mix-blend-mode: multiply` | Not supported in PDF - use opaque images |
| `float: right` table | `alignment: 'right'` on table |

**Workarounds for unsupported features:**
- Stempel/TTD positioning: Use a `canvas` vector drawing or place images in table cells with careful spacing
- Rotation: Pre-rotate images server-side (sharp/gm) or accept non-rotated
- Blend mode: Use original opaque images

---

### 7. Testing & Validation

**Test Cases:**
1. Single SK generation (`POST /generate` with `format: 'pdf'`)
2. SK download by ID (`GET /file/:skId?format=pdf`)
3. Bulk download ZIP (`POST /bulk-download`)
4. Verify layout matches test.html visually (compare PDF output)
5. Verify all placeholders replaced correctly
6. Verify images render correctly
7. Verify F4 page size in PDF properties

**Validation:**
- Open generated PDF, check page size = 215mm × 330mm
- Check margins ≈ 10mm/15mm
- Check font rendering
- Check table alignment
- Check image positions

---

### 8. Files to Modify/Create

| File | Action |
|------|--------|
| `src/utils/skPdfTemplate.js` | **Create** - pdfmake document definition factory |
| `src/utils/generateSkPdf.js` | **Create** - PDF buffer generator |
| `src/routes/sk-guru.js` | **Modify** - Remove Chrome code, add pdfmake imports/calls |
| `package.json` | No change (pdfmake already present) |
| `SKTEMPLATE/images_base64.json` | **Create** (optional, or load dynamically) |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| pdfmake doesn't support exact CSS positioning | Use table/canvas workarounds; accept minor visual differences in signature/stamp placement |
| Font mismatch (Times New Roman) | Bundle Liberation Serif / Noto Serif TTF; register with pdfmake |
| Image rotation/blend mode not supported | Pre-process images (rotate offline); use opaque versions |
| Large base64 images increase memory | Images are small (<200KB each); acceptable |
| Page break issues | Set `pageBreak: 'avoid'` on container; test with varying content lengths |

---

## Rollout Plan
1. Implement `skPdfTemplate.js` and `generateSkPdf.js`
2. Test locally with sample data
3. Compare PDF output visually with Chrome-generated PDF
4. Update `sk-guru.js` to use new generator
5. Remove Chrome-related code
6. Test all endpoints: generate, download, bulk-download
7. Deploy

---

## Open Questions
1. **Font licensing**: Can we bundle Liberation Serif / Noto Serif TTF? (Both SIL Open Font License - OK)
2. **Stempel/TTD exact positioning**: Accept table-based approximation or pre-compose signature block as single image?
3. **Page size**: Confirm F4 (215×330mm) is correct - test.html uses `@page { size: 215mm 330mm }`