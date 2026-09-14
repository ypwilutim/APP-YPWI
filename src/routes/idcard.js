const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../../db');
const { authenticateToken, authenticateOperator } = require('../middleware/auth');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const axios = require('axios');
const sharp = require('sharp');

const router = express.Router();

const MM_TO_PT = 2.83464567;
const CARD_W_MM = 55;
const CARD_H_MM = 85;
const CARD_W = CARD_W_MM * MM_TO_PT;
const CARD_H = CARD_H_MM * MM_TO_PT;
const PAGE_MARGIN_MM = 5;
const PAGE_MARGIN = PAGE_MARGIN_MM * MM_TO_PT;
const COLS = 3;
const ROWS = 3;
const CARD_GAP = 5 * MM_TO_PT;

async function fetchImageBuffer(url) {
  if (!url) return null;
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
    return response.data;
  } catch (e) {
    return null;
  }
}

async function qrBuffer(data) {
  try {
    return await QRCode.toBuffer(data, { width: 300, margin: 1, color: { dark: '#066e3a', light: '#ffffff' } });
  } catch (e) {
    return null;
  }
}

async function fetchTeacherPhoto(teacher) {
  if (!teacher.link_foto) {
    const url = `https://ui-avatars.com/api/?name=${encodeURIComponent(teacher.nama || 'Guru')}&size=150&background=066e3a&color=fff`;
    return fetchImageBuffer(url);
  }
  return fetchImageBuffer(teacher.link_foto);
}

let logoBuf = null;
function loadLogo() {
  if (logoBuf) return logoBuf;
  const candidates = [
    'public/assets/images/icon.png',
    'public/assets/images/YPWI LOGO FULL COLOR.png',
    'public/assets/images/YPWI LOGO HITAM.png',
    'public/assets/images/header-yayasan.png',
    'public/assets/images/header-yayasan-landscape.png',
    'public/images/header-yayasan.png',
    'public/logo.png'
  ];
  for (const c of candidates) {
    try {
      const full = path.isAbsolute(c) ? c : path.join(__dirname, '../../', c);
      if (fs.existsSync(full)) { logoBuf = fs.readFileSync(full); return logoBuf; }
    } catch (e) { /* try next */ }
  }
  return null;
}

let bgBuf = null;
function loadBackground() {
  if (bgBuf) return bgBuf;
  const candidates = [
    'public/assets/images/background_idcard.png',
    'public/assets/images/background_idcard.jfif',
    'public/assets/images/background_idcard.jpg'
  ];
  for (const c of candidates) {
    try {
      const full = path.isAbsolute(c) ? c : path.join(__dirname, '../../', c);
      if (fs.existsSync(full)) { 
        bgBuf = fs.readFileSync(full); 
        return bgBuf; 
      }
    } catch (e) { 
      /* try next */ 
    }
  }
  return null;
}

let patternBuf = null;
async function getPatternBuffer() {
  if (patternBuf) return patternBuf;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
      <rect width="80" height="80" fill="#066e3a"/>
      <path d="M40 0 L80 40 L40 80 L0 40 Z" fill="none" stroke="#c5a24e" stroke-width="1" opacity="0.5"/>
      <circle cx="40" cy="40" r="20" fill="none" stroke="#c5a24e" stroke-width="0.8" opacity="0.4"/>
      <circle cx="40" cy="40" r="8" fill="none" stroke="#c5a24e" stroke-width="0.5" opacity="0.3"/>
    </svg>
  `;
  patternBuf = await sharp(Buffer.from(svg)).png().toBuffer();
  return patternBuf;
}

const GREEN = '#066e3a';
const GREEN_DARK = '#044e24';
const GOLD = '#c5a24e';
const GOLD_LIGHT = '#f3e6c5';
const CREAM = '#faf8f3';

router.get('/proxy-image', async (req, res) => {
  try {
    const targetUrl = req.query.url;
    if (!targetUrl) {
      return res.status(400).json({ success: false, message: 'URL is required' });
    }

    if (targetUrl.startsWith('uploads/') || targetUrl.startsWith('/uploads/')) {
      const filePath = path.join(__dirname, '../../public', targetUrl.replace(/^\//, ''));
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, message: 'File not found' });
      }
      const ext = path.extname(filePath).toLowerCase();
      const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
      res.set({
        'Content-Type': mimeMap[ext] || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*'
      });
      return res.send(fs.readFileSync(filePath));
    }

    const response = await axios.get(targetUrl, { responseType: 'arraybuffer', timeout: 15000 });
    const contentType = response.headers['content-type'] || 'image/jpeg';

    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*'
    });
    res.send(response.data);
  } catch (error) {
    console.error('Proxy image error:', error.message);
    res.status(500).json({ success: false, message: 'Error proxying image' });
  }
});

router.get('/teachers', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    
    if (req.user.role === 'guru' && !tenantId) {
      const adminAssignments = (req.user.assignments || []).filter(a => {
        const roles = ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (adminAssignments.length === 1) {
        tenantId = adminAssignments[0].tenant_id;
      }
    }

    let query = `
      SELECT t.id, t.nama, t.nik, t.nip, t.no_wa, t.tmt, t.status_kepegawaian, t.link_foto, t.scan_id, 
             GROUP_CONCAT(DISTINCT tn.nama_sekolah SEPARATOR '; ') AS nama_sekolah,
             GROUP_CONCAT(DISTINCT ta.jabatan_di_unit SEPARATOR '; ') AS jabatan_di_unit
      FROM teachers t
      LEFT JOIN teacher_assignments ta ON t.id = ta.teacher_id
      LEFT JOIN tenants tn ON ta.tenant_id = tn.tenant_id
      WHERE t.status_aktif = 1
    `;
    let params = [];

    if (tenantId) {
      query += ' AND ta.tenant_id = ?';
      params.push(tenantId);
    }

    query += ' GROUP BY t.id ORDER BY t.nama ASC LIMIT 500';
    const teachers = await db.query(query, params);
    
    res.json({ success: true, data: teachers });
  } catch (error) {
    console.error('ID Card teachers error:', error);
    res.status(500).json({ success: false, message: 'Error fetching teachers' });
  }
});

router.get('/teachers/pdf', authenticateOperator, async (req, res) => {
  try {
    console.log('IDCARD PDF REQUEST:', req.query, req.user);
    let tenantId = req.query.tenant_id;
    if (req.user.role === 'guru' && !tenantId) {
      const adminAssignments = (req.user.assignments || []).filter((a) => {
        const roles = ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (adminAssignments.length === 1) tenantId = adminAssignments[0].tenant_id;
    }

    const teacherId = req.query.teacher_id;
    let ids = null;
    if (req.query.ids) {
      ids = String(req.query.ids).split(',').map((s) => s.trim()).filter(Boolean);
    }
    const { q, params } = buildTeacherQuery({ tenantId, teacherId, ids, limit: req.query.limit });
    console.log('IDCARD PDF QUERY:', q, params);
    const teachers = await db.query(q, params);
    console.log('IDCARD PDF COUNT:', teachers.length);

    if (!teachers || teachers.length === 0) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
    }

    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('error', (err) => {
      console.error('PDFKit stream error:', err);
      if (!res.headersSent) res.status(500).json({ success: false, message: 'Error generating PDF' });
    });
    doc.on('end', () => {
      const buf = Buffer.concat(chunks);
      const isSingle = teacherId;
      const filename = isSingle
        ? `idcard-guru-${teachers[0].nama || teachers[0].id}.pdf`
        : `idcard-guru-bulk${tenantId ? '-' + tenantId : ''}.pdf`;
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'X-Card-Count': String(teachers.length),
        'Content-Length': buf.length
      });
      res.send(buf);
    });

    const a4w = doc.page.width;
    const a4h = doc.page.height;
    const marginLeft = PAGE_MARGIN + (a4w - 2 * PAGE_MARGIN - (COLS * CARD_W + (COLS - 1) * CARD_GAP)) / 2;
    const marginTop = PAGE_MARGIN + (a4h - 2 * PAGE_MARGIN - (ROWS * CARD_H + (ROWS - 1) * CARD_GAP)) / 2;

    let col = 0;
    let row = 0;

    for (let i = 0; i < teachers.length; i++) {
      const teacher = teachers[i];
      const [qrBuf, photoBuf] = await Promise.all([qrBuffer(teacher.scan_id || teacher.id), fetchTeacherPhoto(teacher)]);
      const ox = marginLeft + col * (CARD_W + CARD_GAP);
      const oy = marginTop + row * (CARD_H + CARD_GAP);
      await drawCard(doc, ox, oy, teacher, qrBuf, photoBuf);

      col++;
      if (col >= COLS) {
        col = 0;
        row++;
        if (row >= ROWS && i < teachers.length - 1) {
          doc.addPage();
          row = 0;
        }
      }
    }

    doc.end();
  } catch (error) {
    console.error('ID Card PDF error:', error);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Error generating PDF' });
  }
});

router.get('/teachers/:id', authenticateOperator, async (req, res) => {
  try {
    const [teacher] = await db.query(
      `SELECT t.id, t.nama, t.nik, t.nip, t.no_wa, t.email, t.link_foto, t.scan_id,
              GROUP_CONCAT(DISTINCT tn.nama_sekolah SEPARATOR '; ') AS nama_sekolah,
              GROUP_CONCAT(DISTINCT ta.jabatan_di_unit SEPARATOR '; ') AS jabatan_di_unit
       FROM teachers t
       LEFT JOIN teacher_assignments ta ON t.id = ta.teacher_id
       LEFT JOIN tenants tn ON ta.tenant_id = tn.tenant_id
       WHERE t.id = ? AND t.status_aktif = 1
       GROUP BY t.id`,
      [req.params.id]
    );

    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
    }

    const qrCodeUrl = await QRCode.toDataURL(`${teacher.scan_id || teacher.id}`, {
      width: 150,
      margin: 1,
      color: { dark: '#066e3a', light: '#ffffff' }
    });

    res.json({ success: true, data: { ...teacher, qr_code: qrCodeUrl } });
  } catch (error) {
    console.error('ID Card teacher error:', error);
    res.status(500).json({ success: false, message: 'Error fetching teacher' });
  }
});

router.get('/teachers/:id/qr', async (req, res) => {
  try {
    const [teacher] = await db.query(
      'SELECT scan_id FROM teachers WHERE id = ? AND status_aktif = 1',
      [req.params.id]
    );

    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
    }

    const qrCodeUrl = await QRCode.toDataURL(`${teacher.scan_id || req.params.id}`, {
      width: 100,
      margin: 1
    });

    // Fallback ke QR server eksternal jika gagal
    res.json({ success: true, qr_code: qrCodeUrl, fallback: `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${teacher.scan_id || req.params.id}` });
  } catch (error) {
    console.error('QR teacher error:', error);
    res.status(500).json({ success: false, message: 'Error generating QR' });
  }
});

router.get('/students', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    
    if (req.user.role === 'guru' && !tenantId) {
      const adminAssignments = (req.user.assignments || []).filter(a => {
        const roles = ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (adminAssignments.length === 1) {
        tenantId = adminAssignments[0].tenant_id;
      }
    }

    let query = `
      SELECT s.id, s.nama_siswa, s.nisn, s.nis, s.jenis_kelamin, s.tenant_id,
             c.nama_kelas, tn.nama_sekolah
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id
      WHERE 1=1
    `;
    let params = [];

    if (tenantId) {
      query += ' AND s.tenant_id = ?';
      params.push(tenantId);
    }

    query += ' ORDER BY s.nama_siswa ASC LIMIT 100';
    const students = await db.query(query, params);
    
    res.json({ success: true, data: students });
  } catch (error) {
    console.error('ID Card students error:', error);
    res.status(500).json({ success: false, message: 'Error fetching students' });
  }
});

router.get('/students/:id', authenticateOperator, async (req, res) => {
  try {
    const [student] = await db.query(
      `SELECT s.id, s.nama_siswa, s.nisn, s.nis, s.jenis_kelamin, s.tenant_id,
              c.nama_kelas, tn.nama_sekolah
       FROM students s
       LEFT JOIN classes c ON s.class_id = c.id
       LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id
       WHERE s.id = ?`,
      [req.params.id]
    );

    if (!student) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }

    const qrCodeUrl = await QRCode.toDataURL(`${student.nis}`, {
      width: 150,
      margin: 1,
      color: { dark: '#066e3a', light: '#ffffff' }
    });

    res.json({ success: true, data: { ...student, qr_code: qrCodeUrl } });
  } catch (error) {
    console.error('ID Card student error:', error);
    res.status(500).json({ success: false, message: 'Error fetching student' });
  }
});

router.get('/students/:id/qr', async (req, res) => {
  try {
    const [student] = await db.query(
      'SELECT nis FROM students WHERE id = ?',
      [req.params.id]
    );

    if (!student) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }

    const qrCodeUrl = await QRCode.toDataURL(`${student.nis}`, {
      width: 100,
      margin: 1
    });

    res.json({ success: true, qr_code: qrCodeUrl });
  } catch (error) {
    console.error('QR student error:', error);
    res.status(500).json({ success: false, message: 'Error generating QR' });
  }
});

async function drawCard(doc, ox, oy, teacher, qrBuf, photoBuf, single) {
  const cw = CARD_W;
  const ch = CARD_H;
  const logo = loadLogo();
  const bg = loadBackground() || await getPatternBuffer();

  doc.save();

  if (bg) {
    doc.image(bg, ox, oy, { width: cw * 1.2, height: ch * 1.2, fit: [cw * 1.2, ch * 1.2] });
  }
  doc.roundedRect(ox, oy, cw, ch, 6).fillOpacity(0.12).fill('#ffffff');
  doc.roundedRect(ox, oy, cw, ch, 6).lineWidth(0.7).stroke(GOLD);

  const headerH = 32;
  const headerY = oy + 10;
  const headerGradient = doc.linearGradient(ox, headerY, ox, headerY + headerH);
  headerGradient.stop(0, '#2563eb');
  headerGradient.stop(0.5, '#0284c7');
  headerGradient.stop(1, '#0d9488');
  doc.roundedRect(ox + 5, headerY, cw - 10, headerH, 8).fill(headerGradient);

  const lanyardY = headerY + 2;
  const lanyardW = 18;
  const lanyardH = 3;
  const lanyardX = ox + (cw - lanyardW) / 2;
  doc.roundedRect(lanyardX, lanyardY, lanyardW, lanyardH, 2).fill('rgba(255,255,255,0.35)');

  if (logo) {
    const iconW = 16;
    const iconH = 16;
    const iconX = ox + 10;
    const iconY = headerY + (headerH - iconH) / 2;
    try {
      doc.image(logo, iconX, iconY, { width: iconW, height: iconH, fit: [iconW, iconH] });
    } catch (e) {
      doc.rect(iconX, iconY, iconW, iconH).fill('#ffffff').fillOpacity(0.3);
    }
  }

  const sekolah = (teacher.nama_sekolah || '').split('; ')[0] || '';
  if (sekolah) {
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(6)
      .text(sekolah.toUpperCase(), ox + 30, headerY + 5, { width: cw - 38, align: 'left' });
    doc.fillColor('#e0f2fe').font('Helvetica').fontSize(5)
      .text('Kartu Pendidik & Tenaga Kependidikan', ox + 30, headerY + 13, { width: cw - 38, align: 'left' });
  }

  const photoX = ox + 14;
  const photoY = headerY + headerH + 8;
  const photoW = 60;
  const photoH = 70;

  doc.roundedRect(photoX - 1, photoY - 1, photoW + 2, photoH + 2, 8).fill('#ffffff').stroke('#e0f2fe').lineWidth(0.8);
  doc.save();
  doc.roundedRect(photoX, photoY, photoW, photoH, 6).clip();
  if (photoBuf) {
    doc.image(photoBuf, photoX, photoY, { width: photoW, height: photoH, fit: [photoW, photoH] });
  } else {
    doc.rect(photoX, photoY, photoW, photoH).fill('#f3f4f6');
  }
  doc.restore();

  const infoX = photoX + photoW + 8;
  const infoW = cw - (infoX - ox) - 14;
  let curInfoY = photoY + 3;

  const statusText = (teacher.status_kepegawaian || '').toUpperCase() || 'GURU';
  doc.fillColor('#0284c7').font('Helvetica-Bold').fontSize(5.5)
    .text(statusText, infoX, curInfoY, { width: infoW, align: 'left' });
  curInfoY += 8;

  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(9)
    .text(teacher.nama || 'Guru', infoX, curInfoY, { width: infoW, align: 'left' });
  curInfoY += 11;

  doc.fillColor('#2563eb').font('Helvetica-Bold').fontSize(6.5)
    .text(teacher.jabatan_di_unit || '-', infoX, curInfoY, { width: infoW, align: 'left' });
  curInfoY += 8;

  const gridTop = photoY + photoH + 8;
  const gridPad = 14;
  const gridX = ox + gridPad;
  const gridW = cw - 2 * gridPad;
  const gridH = 26;

  doc.roundedRect(gridX, gridTop, gridW, gridH, 6).fill('#f8fafc').stroke('#f1f5f9').lineWidth(0.5);

  const col1X = gridX + 6;
  const col2X = gridX + gridW / 2;
  let gridY = gridTop + 4;

  doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(5).text('NIP', col1X, gridY, { width: gridW/2 - 8, align: 'left' });
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(5.5).text(teacher.nip || '-', col1X, gridY + 5, { width: gridW/2 - 8, align: 'left' });

  doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(5).text('NIK', col2X, gridY, { width: gridW/2 - 8, align: 'left' });
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(5.5).text(teacher.nik || '-', col2X, gridY + 5, { width: gridW/2 - 8, align: 'left' });

  gridY += 12;
  const berlaku = teacher.tmt ? new Date(teacher.tmt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-';
  doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(5).text('Berlaku s.d', col1X, gridY, { width: gridW - 10, align: 'left' });
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(5.5).text(berlaku, col1X, gridY + 5, { width: gridW - 10, align: 'left' });

  const footerTop = gridTop + gridH + 8;
  const footerH = ch - (footerTop - oy) - 10;
  const footerPad = 14;
  const footerX = ox + footerPad;
  const footerW = cw - 2 * footerPad;
  const footerY = oy + ch - 10 - footerH;

  doc.roundedRect(footerX, footerY, footerW, footerH, 10).fill('#f0f9ff').stroke('#7dd3fc').lineWidth(0.8);

  const qrSize = 30;
  const qrPad = 6;
  const qrX = footerX + qrPad;
  const qrY = footerY + (footerH - qrSize) / 2;

  doc.roundedRect(qrX - 2, qrY - 2, qrSize + 4, qrSize + 4, 6).fill('#ffffff').stroke('#bae6fd').lineWidth(0.6);
  if (qrBuf) {
    doc.image(qrBuf, qrX, qrY, { width: qrSize, height: qrSize });
  } else {
    doc.rect(qrX, qrY, qrSize, qrSize).fill('#f3f4f6');
  }

  const metaX = qrX + qrSize + 8;
  const metaW = footerW - (metaX - footerX) - qrPad;
  let metaY = footerY + 6;

  doc.fillColor('#0369a1').font('Helvetica-Bold').fontSize(6)
    .text('PRESENSI DIGITAL', metaX, metaY, { width: metaW, align: 'left' });
  metaY += 7;
  doc.fillColor('#334155').font('Helvetica').fontSize(5)
    .text('Scan kode QR ini untuk verifikasi presensi & sistem akademik.', metaX, metaY, { width: metaW, align: 'left' });

  doc.restore();
}

function buildTeacherQuery(opts) {
  const { tenantId, teacherId, ids, limit = 200 } = opts;
  let q = `
    SELECT t.id, t.nama, t.nik, t.nip, t.no_wa, t.email, t.link_foto, t.scan_id,
           t.tempat_lahir, t.tanggal_lahir, t.status_kepegawaian, t.tmt, t.pendidikan_terakhir, t.alamat,
           GROUP_CONCAT(DISTINCT tn.nama_sekolah SEPARATOR '; ') AS nama_sekolah,
           GROUP_CONCAT(DISTINCT ta.jabatan_di_unit SEPARATOR '; ') AS jabatan_di_unit
    FROM teachers t
    LEFT JOIN teacher_assignments ta ON t.id = ta.teacher_id
    LEFT JOIN tenants tn ON ta.tenant_id = tn.tenant_id
    WHERE t.status_aktif = 1
  `;
  const params = [];
  if (teacherId) {
    q += ' AND t.id = ?';
    params.push(Number(teacherId));
  } else if (ids && ids.length) {
    q += ` AND t.id IN (?${',?'.repeat(ids.length - 1)})`;
    ids.forEach((id) => params.push(Number(id)));
  } else if (tenantId) {
    q += ' AND ta.tenant_id = ?';
    params.push(tenantId);
  }
  q += ` GROUP BY t.id ORDER BY t.nama ASC LIMIT ${Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500)}`;
  return { q, params };
}

module.exports = router;