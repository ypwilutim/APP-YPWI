const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../../db');
const { authenticateToken, authenticateOperator } = require('../middleware/auth');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const fetch = require('node-fetch');

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
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.buffer();
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
        console.log('Background loaded:', full, 'size:', bgBuf.length);
        return bgBuf; 
      }
    } catch (e) { 
      console.error('Background load error:', e); 
    }
  }
  console.warn('Background not found, using fallback');
  return null;
}

const GREEN = '#066e3a';
const GREEN_DARK = '#044e24';
const GOLD = '#c5a24e';
const GOLD_LIGHT = '#f3e6c5';
const CREAM = '#faf8f3';

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
      SELECT t.id, t.nama, t.nik, t.nip, t.no_wa, t.link_foto, t.scan_id, 
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

    query += ' GROUP BY t.id ORDER BY t.nama ASC LIMIT 100';
    const teachers = await db.query(query, params);
    
    res.json({ success: true, data: teachers });
  } catch (error) {
    console.error('ID Card teachers error:', error);
    res.status(500).json({ success: false, message: 'Error fetching teachers' });
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

function drawCard(doc, ox, oy, teacher, qrBuf, photoBuf, single) {
  const cw = CARD_W;
  const ch = CARD_H;
  const pad = 17;
  const logo = loadLogo();
  const bg = loadBackground();

  doc.save();

  if (bg) {
    doc.image(bg, ox, oy, { fit: [cw, ch] });
  }

  doc.roundedRect(ox, oy, cw, ch, 6).fillOpacity(0.18).fill('#ffffff');

  doc.roundedRect(ox, oy, cw, ch, 6).lineWidth(0.7).stroke(GOLD);

  const headerTop = oy + 14;
  const logoSize = 40;
  if (logo) {
    try {
      doc.image(logo, ox + pad, headerTop, { width: logoSize, height: logoSize, fit: [logoSize, logoSize] });
    } catch (e) {
      doc.rect(ox + pad, headerTop, logoSize, logoSize).fill('#e5e7eb');
    }
  }

  const sekolah = (teacher.nama_sekolah || '').split('; ')[0] || '';
  if (sekolah) {
    const schoolX = ox + pad + logoSize + 5;
    const schoolW = cw - pad - logoSize - 5 - pad;
    doc.fillColor(GREEN_DARK).font('Helvetica-Bold').fontSize(7)
      .text(sekolah, schoolX, headerTop + 4, { width: schoolW, align: 'left' });
  }

  const titleY = headerTop + logoSize + 3;
  doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(8)
    .text('KARTU IDENTITAS GURU', ox + pad, titleY, { width: cw - 2 * pad, align: 'center' });

  const lineY = titleY + 10;
  doc.moveTo(ox + pad, lineY).lineTo(ox + cw - pad, lineY).stroke(GOLD);

  const photoW = 62;
  const photoH = 85;
  const photoX = ox + pad;
  const photoY = lineY + 8;

  doc.roundedRect(photoX - 1, photoY - 1, photoW + 2, photoH + 2, 3).lineWidth(0.7).stroke(GOLD);
  doc.save();
  doc.roundedRect(photoX, photoY, photoW, photoH, 2).clip();
  if (photoBuf) {
    doc.image(photoBuf, photoX, photoY, { width: photoW, height: photoH, fit: [photoW, photoH] });
  } else {
    doc.rect(photoX, photoY, photoW, photoH).fill('#f3f4f6');
  }
  doc.restore();

  const textX = photoX + photoW + 6;
  const textW = cw - pad - (textX - ox);
  let curTextY = photoY;

  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(7)
    .text(teacher.nama || 'Guru', textX, curTextY, { width: textW, align: 'left' });
  curTextY += 9;

  doc.fillColor('#334155').font('Helvetica-Bold').fontSize(6)
    .text(teacher.jabatan_di_unit || '-', textX, curTextY, { width: textW, align: 'left' });
  curTextY += 8;

  doc.fillColor('#475569').font('Helvetica').fontSize(6)
    .text(`NIK: ${teacher.nik || '-'}`, textX, curTextY, { width: textW, align: 'left' });
  curTextY += 7;

  doc.fillColor('#475569').font('Helvetica').fontSize(6)
    .text(`Mata Pelajaran: ${teacher.jabatan_di_unit || '-'}`, textX, curTextY, { width: textW, align: 'left' });
  curTextY += 7;

  const berlaku = teacher.tmt ? new Date(teacher.tmt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-';
  doc.fillColor('#475569').font('Helvetica').fontSize(6)
    .text(`Berlaku s.d: ${berlaku}`, textX, curTextY, { width: textW, align: 'left' });

  const photoBottom = photoY + photoH;
  const statusY = photoBottom + 5;
  const statusText = (teacher.status_kepegawaian || '').toUpperCase();
  doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(7)
    .text(statusText || 'GURU', ox + pad, statusY, { width: cw - 2 * pad, align: 'center' });

  const sloganY = statusY + 10;
  doc.fillColor('#64748b').font('Helvetica-Oblique').fontSize(5.5)
    .text('Mengajar, membentuk, dan mencetak generasi berakhlak', ox + pad, sloganY, { width: cw - 2 * pad, align: 'center' });

  const schoolY = sloganY + 9;
  if (sekolah) {
    doc.fillColor(GREEN_DARK).font('Helvetica-Bold').fontSize(6)
      .text(sekolah, ox + pad, schoolY, { width: cw - 2 * pad, align: 'center' });
  }

  const qrSize = 40;
  const qrX = ox + cw - pad - qrSize;
  const qrY = oy + ch - pad - qrSize - 3;

  doc.fillColor(GREEN);
  doc.rect(qrX - 3, qrY - 3, qrSize + 6, qrSize + 6, 3).fill();
  doc.roundedRect(qrX - 2, qrY - 2, qrSize + 4, qrSize + 4, 3)
    .fill('#ffffff').stroke(GOLD).lineWidth(0.8);

  if (qrBuf) {
    doc.image(qrBuf, qrX, qrY, { width: qrSize, height: qrSize });
  } else {
    doc.rect(qrX, qrY, qrSize, qrSize).fill('#f3f4f6');
  }

  doc.fillColor(GREEN_DARK).font('Helvetica-Bold').fontSize(5)
    .text('Scan ID', qrX, qrY - 5, { width: qrSize, align: 'center' });

  const alamat = teacher.alamat || '';
  if (alamat) {
    doc.fillColor('#94a3b8').font('Helvetica').fontSize(5)
      .text(alamat, ox + pad, oy + ch - 8, { width: cw - 2 * pad, align: 'center' });
  }

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

router.get('/teachers/pdf', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    if (req.user.role === 'guru' && !tenantId) {
      const adminAssignments = (req.user.assignments || []).filter((a) => {
        const roles = ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin', 'bendahara'];
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
    const teachers = await db.query(q, params);

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
      drawCard(doc, ox, oy, teacher, qrBuf, photoBuf);

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
  } catch (error) {
    console.error('ID Card PDF error:', error);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Error generating PDF' });
  }
});

module.exports = router;