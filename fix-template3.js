const fs = require('fs');
const PizZip = require('pizzip');
const path = require('path');

const templatePath = path.join(__dirname, 'SKTEMPLATE.docx');
const templateContent = fs.readFileSync(templatePath, 'binary');
let zip = new PizZip(templateContent);
let docXml = zip.file('word/document.xml').asText();

// Add placeholder &lt;&lt;JABATAN&gt;&gt; after "sebagai </w:t>"
docXml = docXml.replace(
    /sebagai <w:t><\/w:t><w:r w:rsidR/g, 
    'sebagai &lt;&lt;JABATAN&gt;&gt;<w:r w:rsidR'
);

// Find and fix TGL_MULAI placeholder
// It might be broken into multiple parts
docXml = docXml.replace(
    /&lt;&lt;TGL_MULAI <w:t>/g,
    '&lt;&lt;TGL_MULAI&gt;&gt;<w:t>'
);

zip.file('word/document.xml', docXml);
fs.writeFileSync(templatePath, zip.generate({ type: 'nodebuffer' }));
console.log('Done');