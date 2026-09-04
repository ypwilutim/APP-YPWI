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
    'public/assets/images/YPWI LOGO FULL COLOR.png',
    'public/assets/images/YPWI LOGO HITAM.png',
    'public/assets/images/header-yayasan.png',
    'public/assets/images/header-yayasan-landscape.png',
    'public/assets/images/icon.png',
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

const GREEN = '#066e3a';
const GREEN_DARK = '#044e24';

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
  const pad = 10;
  const logo = loadLogo();

  doc.save();

  doc.roundedRect(ox, oy, cw, ch, 6).lineWidth(0.6).stroke('#cbd5e1');
  doc.roundedRect(ox, oy, cw, 18, 6).fill(GREEN);

  let curY = oy + 5;

  if (logo) {
    const logoW = 32;
    const logoX = ox + (cw - logoW) / 2;
    try {
      doc.image(logo, logoX, curY, { width: logoW, height: 12, fit: [logoW, 12] });
    } catch (e) {
      doc.rect(logoX, curY, logoW, 12).fill('#e5e7eb');
    }
    curY += 14;
  }

  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10.5)
    .text('YPWI LUTIM', ox + pad, curY, { width: cw - 2 * pad, align: 'center' });
  curY += 13;

  const photoW = 50;
  const photoH = 66;
  const photoX = ox + (cw - photoW) / 2;
  const photoY = curY;
  doc.save();
  doc.roundedRect(photoX, photoY, photoW, photoH, 4).clip();
  if (photoBuf) {
    doc.image(photoBuf, photoX, photoY, { width: photoW, height: photoH, fit: [photoW, photoH] });
  } else {
    doc.rect(photoX, photoY, photoW, photoH).fill('#e5e7eb');
    doc.fillColor('#9ca3af').font('Helvetica').fontSize(6).text('FOTO', photoX, photoY + photoH / 2 - 3, { width: photoW, align: 'center' });
  }
  doc.restore();
  doc.roundedRect(photoX, photoY, photoW, photoH, 4).lineWidth(1).stroke('#4ade80');
  curY = photoY + photoH + 14;

  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(13)
    .text(teacher.nama || 'Guru', ox + pad, curY, { width: cw - 2 * pad, align: 'center' });
  curY += 16;

  doc.fillColor('#4b5563').font('Helvetica').fontSize(8)
    .text(teacher.scan_id || teacher.id || '', ox + pad, curY, { width: cw - 2 * pad, align: 'center' });
  curY += 12;

  const jabatan = teacher.jabatan_di_unit || '-';
  const badgeW = cw - 2 * pad;
  const badgeH = doc.heightOfString(jabatan, { width: badgeW - 6, font: 'Helvetica-Bold', fontSize: 8 });
  const badgePad = 4;
  const badgeTotalH = Math.max(badgeH + badgePad * 2, 14);
  const badgeY = curY;
  doc.roundedRect(ox + pad, badgeY, badgeW, badgeTotalH, badgeTotalH / 2)
    .fill(GREEN).fillOpacity(0.1).stroke(GREEN).lineWidth(0.5);
  doc.save();
  doc.roundedRect(ox + pad, badgeY, badgeW, badgeTotalH, badgeTotalH / 2).clip();
  doc.fillColor(GREEN_DARK).font('Helvetica-Bold').fontSize(8)
    .text(jabatan, ox + pad + badgePad, badgeY + (badgeTotalH - badgeH) / 2, { width: badgeW - badgePad * 2 });
  doc.restore();
  curY = badgeY + badgeTotalH + 6;

  doc.moveTo(ox + pad, oy + ch - 72).lineTo(ox + cw - pad, oy + ch - 72).stroke('#e5e7eb');

  const qrSize = 50;
  const boxPad = 6;
  const qrX = ox + (cw - qrSize) / 2;
  const qrY = oy + ch - pad - qrSize - 14;
  doc.roundedRect(qrX - boxPad, qrY - boxPad, qrSize + boxPad * 2, qrSize + boxPad * 2, 4)
    .fill('#ffffff').stroke('#e5e7eb').lineWidth(0.6);
  if (qrBuf) {
    doc.image(qrBuf, qrX, qrY, { width: qrSize, height: qrSize });
  } else {
    doc.rect(qrX, qrY, qrSize, qrSize).fill('#f3f4f6');
  }
  doc.fillColor('#475569').font('Helvetica').fontSize(6)
    .text(`Scan ID: ${teacher.scan_id || teacher.id || ''}`, ox + pad, qrY + qrSize + 4, { width: cw - 2 * pad, align: 'center' });

  doc.fillColor('#9ca3af').font('Helvetica-Oblique').fontSize(6)
    .text('YAYASAN PENDIDIKAN WIYATA LUTIM', ox + pad, oy + ch - 6);

  doc.restore();
}

function buildTeacherQuery(opts) {
  const { tenantId, teacherId, ids, limit = 200 } = opts;
  let q = `
    SELECT t.id, t.nama, t.nik, t.nip, t.no_wa, t.email, t.link_foto, t.scan_id,
           t.tempat_lahir, t.tanggal_lahir, t.status_kepegawaian, t.tmt, t.pendidikan_terakhir,
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