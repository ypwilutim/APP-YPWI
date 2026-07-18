// ============================================================
// PAKTA INTEGRITAS ROUTES
// Sign (RBAC signer) + View (RBAC viewer @ YPWILUTIM)
// PDF digenerate di server (PDFKit) dari data + gambar tanda tangan saja.
// ============================================================

const express = require('express');
const path = require('path');
const fs = require('fs');
const PDFKit = require('pdfkit');
const db = require('../../db');
const { authenticateToken } = require('../middleware/auth');
const { requireSignAccess, requireViewAccess, SIGNER_JABATANS } = require('../middleware/paktaAcl');
const { logToFile } = require('../middlewares/logger');

const router = express.Router();

const HEADER_IMG = path.join(__dirname, '..', '..', 'public', 'assets', 'images', 'header-yayasan.png');

const currentPeriode = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const PAKTA_PARAGRAPHS_FALLBACK = [
  'Saya siap untuk mengikuti program coaching THE INFLUENTIAL LEADER bersama Coach Bambang Triyawan dengan total 10 sesi pertemuan dengan sebaik-baiknya dari awal hingga akhir. Termasuk di dalamnya kesiapan untuk mengerjakan tugas-tugas yang diberikan coach secara disiplin dan penuh tanggung jawab.',
  'Saya siap untuk menerapkan hasil pembelajaran dalam pekerjaan saya sebagai pimpinan di sekolah.',
  'Saya siap untuk menunjukkan loyalitas kepada sekolah tempat saya mengabdi dengan tidak mengundurkan diri dalam waktu 1 tahun ke depan.',
  'Saya menyatakan bersedia mengikuti seluruh rangkaian program dengan penuh komitmen. Apabila saya tidak menghadiri secara penuh 10 (sepuluh) kali pertemuan dalam program ini dan/atau tidak mengerjakan tugas yang telah ditetapkan tanpa alasan yang dapat dipertanggungjawabkan, maka saya bersedia mengganti biaya program sebesar Rp1.500.000,- (satu juta lima ratus ribu rupiah).',
  'Demikian pernyataan ini saya buat tanpa paksaan pihak manapun dan menjadi pedoman untuk menilai komitmen saya berkaitan dengan program coaching yang akan saya ikuti.'
];

async function getPaktaParagraphs() {
  try {
    const [cfg] = await db.query('SELECT teks_pakta FROM pakta_config WHERE id = 1');
    if (cfg && cfg.teks_pakta) {
      const arr = JSON.parse(cfg.teks_pakta);
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch (e) { /* abaikan, pakai fallback */ }
  return PAKTA_PARAGRAPHS_FALLBACK;
}

// Generate PDF (teks) + embed signature image -> tulis ke outPath
function generatePaktaPdf({ nama, jabatan, unit, tanggal, signatureBuffer, paragraphs, outPath }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFKit({ margin: 50, size: 'A4' });
    const ws = fs.createWriteStream(outPath);
    doc.pipe(ws);

    // --- 1. Judul ---
    doc.fontSize(14).font('Helvetica-Bold').text('SURAT PERNYATAAN KOMITMEN', { align: 'center' });
    doc.moveDown(1.5);

    // --- 2. Identitas (Titik dua sejajar) ---
    doc.fontSize(12).font('Helvetica');
    const labelX = 50;
    const valueX = 160;

    const drawIdentitas = (label, value) => {
      doc.text(label, labelX, doc.y);
      doc.text(`: ${value}`, valueX, doc.y - doc.currentLineHeight());
    };

    drawIdentitas('Nama', nama);
    drawIdentitas('Posisi/Jabatan', jabatan);
    drawIdentitas('Sekolah', unit);
    doc.moveDown(1.5);
    doc.x = doc.page.margins.left; // Reset ke margin kiri untuk isi surat

    // --- 3. Isi Surat ---
    (paragraphs || []).forEach((p) => {
      doc.font('Helvetica').text(p, { align: 'justify', lineGap: 4, continued: false });
      doc.moveDown(0.8);
    });

    // --- 4. Tanda Tangan (Rata tengah di sisi kanan) ---
    doc.moveDown(1);

    const sigBoxWidth = 200;
    const sigBoxX = doc.page.width - doc.page.margins.right - sigBoxWidth;

    doc.text('Luwu Timur, ' + tanggal, sigBoxX, doc.y, { width: sigBoxWidth, align: 'center' });
    doc.text('Yang Membuat Pernyataan,', { width: sigBoxWidth, align: 'center' });

    doc.moveDown(2.5);

    if (signatureBuffer && signatureBuffer.length) {
      const imgWidth = 140;
      doc.image(signatureBuffer, sigBoxX + (sigBoxWidth - imgWidth) / 2, doc.y - 30, { fit: [imgWidth, 80] });
    }

    doc.moveDown(2);
    doc.font('Helvetica-Bold').text(nama, sigBoxX, doc.y, { width: sigBoxWidth, align: 'center' });

    doc.end();
    ws.on('finish', () => resolve(outPath));
    ws.on('error', reject);
  });
}

// GET /api/pakta/config - teks pakta & klausul sanksi aktif
router.get('/pakta/config', authenticateToken, async (req, res) => {
  try {
    const [cfg] = await db.query('SELECT judul, teks_pakta, klausul_sanksi, nominal_sanksi FROM pakta_config WHERE id = 1 AND is_active = 1');
    if (!cfg) return res.status(404).json({ success: false, message: 'Konfigurasi pakta tidak ditemukan.' });
    res.json({ success: true, data: cfg });
  } catch (err) {
    logToFile(`PAKTA config error: ${err.message}`);
    res.status(500).json({ success: false, message: 'Gagal memuat konfigurasi pakta.' });
  }
});

// GET /api/pakta/me - status pakta user saat ini (per periode)
router.get('/pakta/me', authenticateToken, requireSignAccess, async (req, res) => {
  try {
    const periode = req.query.periode || currentPeriode();
    const [row] = await db.query(
      'SELECT id, status, pdf_path, signed_at FROM pakta_integritas WHERE teacher_id = ? AND periode = ?',
      [req.user.guru_id, periode]
    );
    res.json({ success: true, periode, data: row || null });
  } catch (err) {
    logToFile(`PAKTA me error: ${err.message}`);
    res.status(500).json({ success: false, message: 'Gagal memuat status pakta.' });
  }
});

// POST /api/pakta/sign - terima tanda tangan (data URL) -> generate PDF di server
router.post('/pakta/sign', authenticateToken, requireSignAccess, async (req, res) => {
  try {
    const signatureData = req.body.signature_data;
    if (!signatureData || !/^data:image\//.test(signatureData)) {
      return res.status(400).json({ success: false, message: 'Tanda tangan wajib diisi.' });
    }

    const periode = req.body.periode || currentPeriode();
    const teacherId = req.user.guru_id;
    const tenantId = req.body.tenant_id
      || (req.user.assignments || []).find(() => true)?.tenant_id
      || 'YPWILUTIM';
    const signatureBuffer = Buffer.from((signatureData.split(',')[1] || ''), 'base64');

    const [teacher] = await db.query('SELECT nama, email FROM teachers WHERE id = ?', [teacherId]);
    const assignments = await db.query(
      `SELECT ta.tenant_id, ta.jabatan_di_unit, tn.nama_sekolah
         FROM teacher_assignments ta JOIN tenants tn ON ta.tenant_id = tn.tenant_id
        WHERE ta.teacher_id = ?`,
      [teacherId]
    );
    const signerUnit = (assignments || []).find((a) =>
      SIGNER_JABATANS.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''))
    ) || (assignments || [])[0];

    const nama = (teacher && teacher.nama) || '-';
    const jabatan = signerUnit ? (signerUnit.jabatan_di_unit || '-') : '-';
    const unit = signerUnit ? (signerUnit.nama_sekolah || signerUnit.tenant_id || '-') : '-';
    const tanggal = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const paragraphs = await getPaktaParagraphs();

    const outDir = 'public/uploads/pakta';
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `pakta_${teacherId}_${periode}_${Date.now()}.pdf`);

    await generatePaktaPdf({ nama, jabatan, unit, tanggal, signatureBuffer, paragraphs, outPath });

    const pdfPath = '/uploads/pakta/' + path.basename(outPath);

    await db.query(
      `INSERT INTO pakta_integritas (teacher_id, tenant_id, periode, status, pdf_path, signature_data, signed_at)
       VALUES (?, ?, ?, 'sudah', ?, ?, NOW())
       ON DUPLICATE KEY UPDATE status='sudah', pdf_path=VALUES(pdf_path), signature_data=VALUES(signature_data), signed_at=NOW(), updated_at=NOW()`,
      [teacherId, tenantId, periode, pdfPath, signatureData]
    );

    res.json({ success: true, message: 'Surat Pernyataan Komitmen berhasil ditandatangani.', pdf_path: pdfPath });

    try {
      if (teacher && teacher.email) {
        await global.sendEmail(
          teacher.email,
          'Surat Pernyataan Komitmen - ' + nama,
          '<div style="font-family:Arial;max-width:600px;margin:0 auto">' +
          '<h2 style="color:#0f766e;">Surat Pernyataan Komitmen</h2>' +
          '<p>Assalamu alaikum ' + nama + ',</p>' +
          '<p>Terima kasih. Berikut terlampir dokumen <strong>Surat Pernyataan Komitmen</strong> yang telah Anda tanda tangani untuk periode <strong>' + periode + '</strong>.</p>' +
          '<p style="color:#64748b;font-size:13px;">Email ini dikirim otomatis oleh sistem YPWI Lutim.</p>' +
          '</div>',
          'Dokumen Surat Pernyataan Komitmen periode ' + periode + ' terlampir.',
          [{ filename: 'surat-pernyataan-komitmen-' + periode + '.pdf', path: outPath }],
          'documents'
        );
      }
    } catch (emailErr) {
      logToFile(`PAKTA email error: ${emailErr.message}`);
    }
  } catch (err) {
    logToFile(`PAKTA sign error: ${err.message}\n${err.stack}`);
    console.error('[PAKTA SIGN ERROR]', err);
    res.status(500).json({ success: false, message: err.message || 'Gagal menyimpan pakta.' });
  }
});

// GET /api/pakta/records - daftar dokumen (hanya viewer YPWILUTIM)
router.get('/pakta/records', authenticateToken, requireViewAccess, async (req, res) => {
  try {
    const params = [];
    let where = '';
    if (req.query.tenant_id) {
      where = 'WHERE p.tenant_id = ?';
      params.push(req.query.tenant_id);
    }
    const rows = await db.query(
      `SELECT p.id, p.teacher_id, t.nama AS nama_guru, p.tenant_id, p.periode, p.status, p.pdf_path, p.signed_at
         FROM pakta_integritas p
         LEFT JOIN teachers t ON t.id = p.teacher_id
         ${where}
         ORDER BY p.signed_at DESC`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    logToFile(`PAKTA records error: ${err.message}`);
    res.status(500).json({ success: false, message: 'Gagal memuat daftar dokumen.' });
  }
});

// GET /api/pakta/file/:id - stream PDF (hanya viewer YPWILUTIM)
router.get('/pakta/file/:id', authenticateToken, requireViewAccess, async (req, res) => {
  try {
    const [row] = await db.query('SELECT pdf_path FROM pakta_integritas WHERE id = ?', [req.params.id]);
    if (!row || !row.pdf_path) return res.status(404).json({ success: false, message: 'Dokumen tidak ditemukan.' });

    const filePath = path.join('public', row.pdf_path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: 'File tidak ditemukan di server.' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    logToFile(`PAKTA file error: ${err.message}`);
    res.status(500).json({ success: false, message: 'Gagal memuat file.' });
  }
});

module.exports = router;
