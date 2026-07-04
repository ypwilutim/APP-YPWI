const fs = require('fs');
const PizZip = require('pizzip');
const path = require('path');

const templatePath = path.join(__dirname, 'SKTEMPLATE.docx');
const templateContent = fs.readFileSync(templatePath, 'binary');
let zip = new PizZip(templateContent);
let docXml = zip.file('word/document.xml').asText();

// Add &lt;&lt;JABATAN&gt;&gt; after "sebagai "
// Find "sebagai </w:t>" and insert placeholder
docXml = docXml.replace(/(sebagai <w:t>)([^<]*<\/w:t>)/g, '$1&lt;&lt;JABATAN&gt;&gt;<w:r><w:t>$2');

// Fix TGL_MULAI that may be split
// Replace any TGL_MULAI related tags
const tglMulaiMatch = docXml.match(/&lt;&lt;TGL_MULAI[^>]*>([^<]*)<\/w:t>/);
if (tglMulaiMatch) {
    console.log('TGL_MULAI format:', tglMulaiMatch[0].substring(0, 100));
}

zip.file('word/document.xml', docXml);
const buf = zip.generate({ type: 'nodebuffer' });

// Backup and replace
fs.copyFileSync(templatePath, templatePath + '.backup');
fs.writeFileSync(templatePath, buf);

console.log('Template updated');