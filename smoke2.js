const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const MM = 2.83464567;
const CW = 55 * MM, CH = 85 * MM;
const PM = 5 * MM;
const COLS = 3, ROWS = 3, GAP = 5 * MM;
const GREEN = '#066e3a', GD = '#044e24';

let logoBuf = null;
const cands = ['public/assets/images/YPWI LOGO FULL COLOR.png', 'public/assets/images/YPWI LOGO HITAM.png', 'public/assets/images/header-yayasan.png'];
for (const c of cands) {
  const full = path.join(process.cwd(), c);
  if (fs.existsSync(full)) { logoBuf = fs.readFileSync(full); console.log('LOGO:', c); break; }
}
if (!logoBuf) console.log('LOGO: NONE');

async function qrB(d) { return await QRCode.toBuffer(d, { width: 300, margin: 1, color: { dark: GREEN, light: '#fff' } }); }

function drawCard(doc, ox, oy, t, qrBuf) {
  const cw = CW, ch = CH, pad = 10; let curY = oy + 6;
  if (logoBuf) { try { doc.image(logoBuf, ox + (cw - 34) / 2, curY, { width: 34, height: 14, fit: [34, 14] }); } catch (e) { console.log('logo draw err', e.message); } curY += 18; }
  doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(12).text('YPWI LUTIM', ox + pad, curY, { width: cw - 2 * pad, align: 'center' }); curY += 14;
  const photoW = 50, photoH = 66; const px = ox + (cw - photoW) / 2, py = curY;
  doc.rect(px, py, photoW, photoH).fill('#e5e7eb');
  curY = py + photoH + 10;
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(13).text(t.nama || 'Guru', ox + pad, curY, { width: cw - 2 * pad, align: 'center' }); curY += 15;
  doc.fillColor('#4b5563').font('Helvetica').fontSize(8).text(t.scan_id || t.id || '', ox + pad, curY, { width: cw - 2 * pad, align: 'center' }); curY += 12;
  const j = t.jabatan_di_unit || '-';
  doc.fillColor(GD).font('Helvetica-Bold').fontSize(8).text(j, ox + pad, curY, { width: cw - 2 * pad, align: 'center' });
  doc.moveTo(ox + pad, oy + ch - 70).lineTo(ox + cw - pad, oy + ch - 70).stroke('#e5e7eb');
  const qrz = 54, qrX = ox + (cw - qrz) / 2, qrY = oy + ch - pad - qrz;
  if (qrBuf) doc.image(qrBuf, qrX, qrY, { width: qrz, height: qrz });
  doc.restore();
}

(async () => {
  const doc = new PDFDocument({ margin: 0, size: 'A4' }); const chunks = [];
  doc.on('data', c => chunks.push(c));
  const a4w = doc.page.width, a4h = doc.page.height;
  const ml = PM + (a4w - 2 * PM - (COLS * CW + (COLS - 1) * GAP)) / 2;
  const mt = PM + (a4h - 2 * PM - (ROWS * CH + (ROWS - 1) * GAP)) / 2;
  const t = { id: 1, nama: 'Ahmad Sulaiman', scan_id: 'SCN-001', jabatan_di_unit: 'Guru Mapel; Wali Kelas 7A' };
  const qr = await qrB(t.scan_id || t.id);
  drawCard(doc, ml, mt, t, qr);
  doc.end();
  doc.on('end', () => {
    const buf = Buffer.concat(chunks);
    fs.writeFileSync('C:\\Users\\Akbar Irwansya\\AppData\\Local\\Temp\\kilo\\logo-test.pdf', buf);
    console.log('BYTES', buf.length, 'PNG_SIG', buf.slice(0, 5).toString() === '%PDF-');
  });
})();
