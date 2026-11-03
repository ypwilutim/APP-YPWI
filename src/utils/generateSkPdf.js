const pdfMake = require('pdfmake');
const { buildDocDefinition } = require('./skPdfTemplate');
const fs = require('fs');
const path = require('path');

// Font file paths - use absolute paths
const baseDir = __dirname;
const fontsDir = path.resolve(baseDir, '../fonts');

const fontDescriptors = {
  NotoSerif: {
    normal: path.resolve(fontsDir, 'NotoSerif-Regular.ttf'),
    bold: path.resolve(fontsDir, 'NotoSerif-Bold.ttf'),
    italics: path.resolve(fontsDir, 'NotoSerif-Italic.ttf'),
    bolditalics: path.resolve(fontsDir, 'NotoSerif-BoldItalic.ttf')
  }
};

// Verify font files exist
for (const fontFamily of Object.values(fontDescriptors)) {
  for (const [style, fontPath] of Object.entries(fontFamily)) {
    if (!fs.existsSync(fontPath)) {
      console.error('Font file not found:', fontPath);
    } else {
      console.log('Font found:', style, fontPath);
    }
  }
}

const printer = new pdfMake(fontDescriptors);

function generateSkPdf(skData) {
  const docDefinition = buildDocDefinition(skData);

  const pdfDoc = printer.createPdfKitDocument(docDefinition);

  return new Promise((resolve, reject) => {
    const chunks = [];
    pdfDoc.on('data', chunk => chunks.push(chunk));
    pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
    pdfDoc.on('error', reject);
    pdfDoc.end();
  });
}

module.exports = { generateSkPdf };