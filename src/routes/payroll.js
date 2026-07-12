// ============================================================
// PAYROLL ROUTES - Penggajian Guru
// Komponen: Gaji_Pokok + Tunj_Kinerja + Tunj_Umum + Tunj_Istri
//   + Tunj_Anak + Tunj_Kepala_Sekolah + Tunj_Wali_Kelas
//   + Honor_Bendahara - Potongan
// ============================================================

const express = require('express');
const db = require('../../db');
const { authenticateOperator } = require('../middleware/auth');

const router = express.Router();

const COMPONENTS = [
  'gaji_pokok', 'tunj_kinerja', 'tunj_umum', 'tunj_istri',
  'tunj_anak', 'tunj_kepala_sekolah', 'tunj_wali_kelas', 'honor_bendahara'
];
const SALARY_FIELDS = [...COMPONENTS, 'potongan'];

function resolveTenantId(req) {
  let tenantId = req.query.tenant_id;
  if (req.user.role !== 'admin' && !tenantId) {
    const assignments = (req.user.assignments || []).filter(a =>
      ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin', 'bendahara'].includes(
        (a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, '')
      )
    );
    if (assignments.length >= 1) tenantId = assignments[0].tenant_id;
  }
  return tenantId || null;
}

function computeTotal(t) {
  let total = 0;
  COMPONENTS.forEach(f => { total += parseFloat(t[f] || 0); });
  total -= parseFloat(t.potongan || 0);
  return total;
}

function num(v) { return parseFloat(v || 0) || 0; }

async function getPayrollData(tenantId, bulan, tahun) {
  const periode = `${tahun}-${String(bulan).padStart(2, '0')}`;
  const start = `${periode}-01`;
  const lastDay = new Date(tahun, bulan, 0).getDate();
  const end = `${periode}-${String(lastDay).padStart(2, '0')} 23:59:59`;

  let tQuery = `SELECT t.id, t.nama, t.nik, t.nip, t.status_kepegawaian, t.bank, t.nomor_rekening, (SELECT ta.tenant_id FROM teacher_assignments ta WHERE ta.teacher_id = t.id LIMIT 1) as tenant_id, t.gaji_pokok, t.tunj_kinerja, t.tunj_umum, t.tunj_istri, t.tunj_anak, t.tunj_kepala_sekolah, t.tunj_wali_kelas, t.honor_bendahara, t.potongan FROM teachers t`;
  const tParams = [];
  if (tenantId) { tQuery += ' JOIN teacher_assignments ta ON t.id = ta.teacher_id AND ta.tenant_id = ?'; tParams.push(tenantId); }
  tQuery += ' WHERE t.status_aktif = 1';
  const teachers = await db.query(tQuery, tParams);

  let aQuery = `SELECT teacher_id, COUNT(DISTINCT DATE(COALESCE(waktu_absen, waktu_scan))) as hadir, SUM(CASE WHEN status = 'terlambat' THEN 1 ELSE 0 END) as terlambat FROM attendance_logs WHERE jenis = 'masuk' AND COALESCE(waktu_absen, waktu_scan) >= ? AND COALESCE(waktu_absen, waktu_scan) <= ?`;
  const aParams = [start, end];
  if (tenantId) { aQuery += ' AND tenant_id = ?'; aParams.push(tenantId); }
  aQuery += ' GROUP BY teacher_id';
  const att = await db.query(aQuery, aParams);
  const attMap = {};
  att.forEach(a => { attMap[a.teacher_id] = a; });

  return {
    periode,
    data: teachers.map(t => {
      const a = attMap[t.id] || { hadir: 0, terlambat: 0 };
      return {
        id: t.id, nama: t.nama, nik: t.nik, nip: t.nip,
        status_kepegawaian: t.status_kepegawaian, tenant_id: t.tenant_id,
        bank: t.bank, nomor_rekening: t.nomor_rekening,
        gaji_pokok: num(t.gaji_pokok), tunj_kinerja: num(t.tunj_kinerja), tunj_umum: num(t.tunj_umum),
        tunj_istri: num(t.tunj_istri), tunj_anak: num(t.tunj_anak),
        tunj_kepala_sekolah: num(t.tunj_kepala_sekolah), tunj_wali_kelas: num(t.tunj_wali_kelas),
        honor_bendahara: num(t.honor_bendahara), potongan: num(t.potongan),
        hadir: num(a.hadir), terlambat: num(a.terlambat), total_gaji: computeTotal(t)
      };
    })
  };
}

router.get('/admin/payroll/settings', authenticateOperator, async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const bulan = parseInt(req.query.bulan) || (new Date().getMonth() + 1);
    const tahun = parseInt(req.query.tahun) || new Date().getFullYear();
    const result = await getPayrollData(tenantId, bulan, tahun);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Payroll settings error:', error);
    res.status(500).json({ success: false, message: 'Error fetching payroll' });
  }
});

router.put('/admin/teachers/:id/salary', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const vals = {};
    SALARY_FIELDS.forEach(f => { if (req.body[f] !== undefined) vals[f] = num(req.body[f]); });
    if (Object.keys(vals).length === 0) return res.status(400).json({ success: false, message: 'Tidak ada field gaji yang dikirim' });
    const set = Object.keys(vals).map(f => `${f} = ?`).join(', ');
    const result = await db.query(`UPDATE teachers SET ${set} WHERE id = ?`, [...Object.values(vals), id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
    res.json({ success: true, message: 'Komponen gaji diperbarui' });
  } catch (error) {
    console.error('Update salary error:', error);
    res.status(500).json({ success: false, message: 'Error updating salary' });
  }
});

router.post('/admin/payroll/generate', authenticateOperator, async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const { periode } = req.body;
    if (!periode || !/^\d{4}-\d{2}$/.test(periode)) return res.status(400).json({ success: false, message: 'Periode tidak valid (format YYYY-MM)' });
    const [tahun, bulan] = periode.split('-').map(Number);
    const { data } = await getPayrollData(tenantId, bulan, tahun);
    const insertSql = `INSERT INTO payroll (teacher_id, tenant_id, periode, gaji_pokok, tunj_kinerja, tunj_umum, tunj_istri, tunj_anak, tunj_kepala_sekolah, tunj_wali_kelas, honor_bendahara, potongan, total_gaji, hadir, terlambat, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE tenant_id = VALUES(tenant_id), gaji_pokok = VALUES(gaji_pokok), tunj_kinerja = VALUES(tunj_kinerja), tunj_umum = VALUES(tunj_umum), tunj_istri = VALUES(tunj_istri), tunj_anak = VALUES(tunj_anak), tunj_kepala_sekolah = VALUES(tunj_kepala_sekolah), tunj_wali_kelas = VALUES(tunj_wali_kelas), honor_bendahara = VALUES(honor_bendahara), potongan = VALUES(potongan), total_gaji = VALUES(total_gaji), hadir = VALUES(hadir), terlambat = VALUES(terlambat), created_at = NOW()`;
    for (const r of data) {
      await db.query(insertSql, [r.id, r.tenant_id, periode, r.gaji_pokok, r.tunj_kinerja, r.tunj_umum, r.tunj_istri, r.tunj_anak, r.tunj_kepala_sekolah, r.tunj_wali_kelas, r.honor_bendahara, r.potongan, r.total_gaji, r.hadir, r.terlambat, req.user.id]);
    }
    res.json({ success: true, message: `${data.length} slip gaji disimpan untuk ${periode}`, data });
  } catch (error) {
    console.error('Generate payroll error:', error);
    res.status(500).json({ success: false, message: 'Error generating payroll' });
  }
});

router.get('/admin/payroll/history', authenticateOperator, async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const periode = req.query.periode;
    let q = `SELECT p.*, t.nama, t.nik, t.nip, t.status_kepegawaian FROM payroll p JOIN teachers t ON p.teacher_id = t.id WHERE 1=1`;
    const params = [];
    if (tenantId) { q += ' AND p.tenant_id = ?'; params.push(tenantId); }
    if (periode) { q += ' AND p.periode = ?'; params.push(periode); }
    q += ' ORDER BY p.tenant_id, t.nama';
    const rows = await db.query(q, params);
    res.json({ success: true, data: rows.map(r => ({ ...r, gaji_pokok: num(r.gaji_pokok), tunj_kinerja: num(r.tunj_kinerja), tunj_umum: num(r.tunj_umum), tunj_istri: num(r.tunj_istri), tunj_anak: num(r.tunj_anak), tunj_kepala_sekolah: num(r.tunj_kepala_sekolah), tunj_wali_kelas: num(r.tunj_wali_kelas), honor_bendahara: num(r.honor_bendahara), potongan: num(r.potongan), total_gaji: num(r.total_gaji), hadir: num(r.hadir), terlambat: num(r.terlambat) })) });
  } catch (error) {
    console.error('Payroll history error:', error);
    res.status(500).json({ success: false, message: 'Error fetching payroll history' });
  }
});

router.put('/admin/teachers/:id/salary-field', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { field, value } = req.body;
    if (!SALARY_FIELDS.includes(field)) return res.status(400).json({ success: false, message: 'Field tidak valid' });
    const result = await db.query(`UPDATE teachers SET ${field} = ? WHERE id = ?`, [num(value), id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
    const row = await db.query('SELECT * FROM teachers WHERE id = ?', [id]);
    const t = row[0] || {};
    res.json({ success: true, total_gaji: computeTotal(t) });
  } catch (error) {
    console.error('Update salary field error:', error);
    res.status(500).json({ success: false, message: 'Error updating salary field' });
  }
});

router.get('/admin/tenants', authenticateOperator, async (req, res) => {
  try {
    let query = 'SELECT tenant_id, nama_sekolah FROM tenants';
    let params = [];
    if (req.user.role !== 'admin') {
      const assignments = (req.user.assignments || []).filter(a => ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin', 'bendahara'].includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, '')));
      if (assignments.length > 0) {
        const allowedTenants = assignments.map(a => a.tenant_id);
        if (allowedTenants.length === 1) { query += ' WHERE tenant_id = ?'; params.push(allowedTenants[0]); }
      }
    }
    query += ' ORDER BY nama_sekolah ASC';
    const tenants = await db.query(query, params);
    res.json({ success: true, data: tenants });
  } catch (error) {
    console.error('Payroll tenants error:', error);
    res.status(500).json({ success: false, message: 'Error fetching tenants' });
  }
});

// Helper: generate email body
async function sendSalarySlipEmail(teacherId, periode) {
  const monthNames = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const [year, month] = periode.split('-').map(Number);
  const teacher = await db.query('SELECT t.*, tn.nama_sekolah FROM teachers t LEFT JOIN teacher_assignments ta ON t.id = ta.teacher_id LEFT JOIN tenants tn ON ta.tenant_id = tn.tenant_id WHERE t.id = ?', [teacherId]);
  const slip = await db.query('SELECT * FROM payroll WHERE teacher_id = ? AND periode = ?', [teacherId, periode]);
  if (!teacher.length) return { success: false, message: 'Guru tidak ditemukan' };
  const t = teacher[0];
  let gaji;
  if (slip.length) gaji = slip[0];
  else {
    gaji = { gaji_pokok: t.gaji_pokok, tunj_kinerja: t.tunj_kinerja, tunj_umum: t.tunj_umum, tunj_istri: t.tunj_istri, tunj_anak: t.tunj_anak, tunj_kepala_sekolah: t.tunj_kepala_sekolah, tunj_wali_kelas: t.tunj_wali_kelas, honor_bendahara: t.honor_bendahara, potongan: t.potongan };
    const comps = { potongan: t.potongan };
    COMPONENTS.forEach(f => comps[f] = t[f]);
    gaji.total_gaji = computeTotal(comps);
  }
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'mail.ypwilutim.com', port: parseInt(process.env.EMAIL_PORT) || 465, secure: true,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
  });
  if (!t.email) return { success: true, message: 'Guru tidak punya email' };
  const htmlBody = '<div style="font-family:Arial;max-width:600px;margin:0 auto"><div style="text-align:center;margin-bottom:20px"><img src="https://app.ypwilutim.com/assets/images/header-yayasan.png" width="400" style="max-width:100%"></div><h2 style="color:#059669;text-align:center">Slip Gaji Guru</h2><p>Assalamu alaikum Bapak/Ibu ' + t.nama + ',</p><p>Slip gaji Anda untuk ' + monthNames[parseInt(month)] + ' ' + year + ':</p><table style="width:100%;border-collapse:collapse;margin:20px 0;border:2px solid #059669"><tr style="background:#f3f4f6"><td style="padding:10px;border:1px solid #ddd">Keterangan</td><td style="padding:10px;border:1px solid #ddd;text-align:right">Jumlah</td></tr><tr><td style="padding:10px;border:1px solid #ddd">Gaji Pokok</td><td style="padding:10px;border:1px solid #ddd;text-align:right">Rp ' + num(gaji.gaji_pokok).toLocaleString('id-ID') + '</td></tr><tr><td style="padding:10px;border:1px solid #ddd">Tunjangan Kinerja</td><td style="padding:10px;border:1px solid #ddd;text-align:right">Rp ' + num(gaji.tunj_kinerja).toLocaleString('id-ID') + '</td></tr><tr><td style="padding:10px;border:1px solid #ddd">Tunjangan Umum</td><td style="padding:10px;border:1px solid #ddd;text-align:right">Rp ' + num(gaji.tunj_umum).toLocaleString('id-ID') + '</td></tr><tr><td style="padding:10px;border:1px solid #ddd">Tunjangan Istri</td><td style="padding:10px;border:1px solid #ddd;text-align:right">Rp ' + num(gaji.tunj_istri).toLocaleString('id-ID') + '</td></tr><tr><td style="padding:10px;border:1px solid #ddd">Tunjangan Anak</td><td style="padding:10px;border:1px solid #ddd;text-align:right">Rp ' + num(gaji.tunj_anak).toLocaleString('id-ID') + '</td></tr><tr><td style="padding:10px;border:1px solid #ddd">Tunjangan Kepala Sekolah</td><td style="padding:10px;border:1px solid #ddd;text-align:right">Rp ' + num(gaji.tunj_kepala_sekolah).toLocaleString('id-ID') + '</td></tr><tr><td style="padding:10px;border:1px solid #ddd">Tunjangan Wali Kelas</td><td style="padding:10px;border:1px solid #ddd;text-align:right">Rp ' + num(gaji.tunj_wali_kelas).toLocaleString('id-ID') + '</td></tr><tr><td style="padding:10px;border:1px solid #ddd">Honor Bendahara</td><td style="padding:10px;border:1px solid #ddd;text-align:right">Rp ' + num(gaji.honor_bendahara).toLocaleString('id-ID') + '</td></tr><tr><td style="padding:10px;border:1px solid #ddd">Potongan</td><td style="padding:10px;border:1px solid #ddd;text-align:right">Rp ' + num(gaji.potongan).toLocaleString('id-ID') + '</td></tr><tr style="background:#dcfce7"><td style="padding:10px;border:1px solid #ddd;font-weight:bold">Total Gaji</td><td style="padding:10px;border:1px solid #ddd;text-align:right;font-weight:bold;color:#059669">Rp ' + num(gaji.total_gaji).toLocaleString('id-ID') + '</td></tr></table><p style="font-size:12px;color:#666">Hormat kami,<br><strong>Yayasan Pendidikan Wahdah Islamiyah Luwu Timur</strong></p></div>';
  try {
    await transporter.sendMail({ from: process.env.EMAIL_USER, to: t.email, subject: 'Slip Gaji ' + monthNames[parseInt(month)] + ' ' + year, html: htmlBody });
    return { success: true, message: 'Email terkirim ke ' + t.email };
  } catch (emailError) {
    console.error('Email send error:', emailError.message);
    return { success: true, message: 'Email gagal (mode simulasi) ke ' + t.email };
  }
}

router.post('/admin/payroll/send-slip-email', authenticateOperator, async (req, res) => {
  try {
    const { teacher_id, periode } = req.body;
    if (!teacher_id || !periode) return res.status(400).json({ success: false, message: 'teacher_id dan periode required' });
    const result = await sendSalarySlipEmail(teacher_id, periode);
    res.json(result);
  } catch (error) {
    console.error('Send slip email error:', error);
    res.status(500).json({ success: false, message: 'Error sending email' });
  }
});

router.post('/admin/payroll/send-bulk', authenticateOperator, async (req, res) => {
  try {
    const { periode, tenant_id } = req.body;
    const tenantId = resolveTenantId(req) || tenant_id;
    const slips = await db.query('SELECT p.teacher_id, t.nama, t.email FROM payroll p JOIN teachers t ON p.teacher_id = t.id WHERE p.periode = ?' + (tenantId ? ' AND p.tenant_id = ?' : ''), tenantId ? [periode, tenantId] : [periode]);
    let sent = 0;
    for (const slip of slips) { await sendSalarySlipEmail(slip.teacher_id, periode); if (slip.email) sent++; }
    res.json({ success: true, message: sent + ' email slip gaji diproses untuk ' + periode });
  } catch (error) {
    console.error('Bulk email error:', error);
    res.status(500).json({ success: false, message: 'Error sending bulk email' });
  }
});

router.post('/admin/payroll/send-selected-emails', authenticateOperator, async (req, res) => {
  try {
    const { teacher_ids, periode } = req.body;
    if (!teacher_ids || !teacher_ids.length || !periode) return res.status(400).json({ success: false, message: 'teacher_ids dan periode required' });
    let sent = 0;
    for (const teacherId of teacher_ids) {
      const result = await sendSalarySlipEmail(teacherId, periode);
      if (result.success && result.message.includes('terkirim')) sent++;
    }
    res.json({ success: true, message: sent + ' email slip gaji terkirim untuk ' + periode });
  } catch (error) {
    console.error('Send selected emails error:', error);
    res.status(500).json({ success: false, message: 'Error sending selected emails' });
  }
});

router.get('/admin/payroll/bsi-export', authenticateOperator, async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const bulan = parseInt(req.query.bulan) || (new Date().getMonth() + 1);
    const tahun = parseInt(req.query.tahun) || new Date().getFullYear();
    const { data } = await getPayrollData(tenantId, bulan, tahun);
    const bsiData = data.filter(d => (d.bank || '').toUpperCase().includes('BSI'));
    if (!bsiData.length) return res.status(400).json({ success: false, message: 'Tidak ada data guru dengan bank BSI' });
    const tanggal = new Date().toISOString().slice(0, 10);
    const totalNominal = bsiData.reduce((sum, d) => sum + (parseFloat(d.total_gaji) || 0), 0);
    let content = '0||' + tanggal + '|' + bsiData.length + '|' + Math.round(totalNominal) + '|\n';
    content += '0|BENEFICIARY ACCT (35)|BENEFICIARY ACCT NAME |CREDIT AMOUNT CCY|AMOUNT|CUST REF NO|MESSAGE (65)|EXTENDED PAYMENT DETAIL|BENEFICIARY NOTIF EMAIL(100)|SMS NOTIF (100)|\n';
    bsiData.forEach((d, i) => {
      const noRek = (d.nomor_rekening || d.nik || '').substring(0, 35);
      const nama = (d.nama || '').substring(0, 35);
      const nominal = Math.round(parseFloat(d.total_gaji) || 0);
      content += (i + 1) + '|' + noRek + '|' + nama + '|IDR|' + nominal + '||\n';
    });
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="payroll_bsi_cuz_' + tahun + String(bulan).padStart(2, '0') + '.txt"');
    res.send(content);
  } catch (error) {
    console.error('BSI export error:', error);
    res.status(500).json({ success: false, message: 'Error BSI export' });
  }
});

router.get('/admin/attendance-export-pdf', authenticateOperator, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    const bulan = req.query.bulan;
    const tahun = req.query.tahun;
    const token = req.headers['authorization']?.split(' ')[1];
    const fs = require('fs');
    const path = require('path');

    const monthNames = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const attRes = await fetch(`http://localhost:${process.env.PORT || 3000}/api/admin/attendance-monthly?tenant_id=${tenantId}&bulan=${bulan}&tahun=${tahun}`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const attJson = await attRes.json();

    if (!attJson.success) return res.status(500).json({ success: false, message: 'Data tidak ditemukan' });

    const data = attJson.data;
    const daysInMonth = attJson.daysInMonth || 30;
    const tenantName = req.query.tenant_name || '';

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="rekap_absensi_${tenantId}_${tahun}${bulan}.pdf"`);

    doc.pipe(res);

    // Header image
    const headerPath = path.join(__dirname, '../../public/assets/images/header-yayasan-landscape.png');
    if (fs.existsSync(headerPath)) {
      doc.image(headerPath, 0, 0, { width: 595, height: 80 });
    }

    doc.moveDown();
    doc.fontSize(14).text(`Rekap Absensi - ${tenantName} ${monthNames[parseInt(bulan)]} ${tahun}`, { align: 'center' });
    doc.moveDown();

    // Table header
    const colWidth = 25;
    const startX = 20;
    let y = doc.y;

    doc.fontSize(7);
    doc.text('No', startX, y, { width: 20, textAlign: 'center' });
    doc.text('Nama', startX + 20, y, { width: 120, textAlign: 'center' });

    for (let d = 1; d <= daysInMonth; d++) {
      doc.text(String(d), startX + 140 + (d - 1) * colWidth, y, { width: colWidth, textAlign: 'center' });
    }

    const keteranganLabels = ['H', 'T', 'I', 'S', 'D', 'C', '-'];
    for (let i = 0; i < 7; i++) {
      doc.text(keteranganLabels[i], startX + 140 + daysInMonth * colWidth + i * colWidth, y, { width: colWidth, textAlign: 'center' });
    }

    y += 15;

    // Data rows
    data.forEach((d, i) => {
      y += 12;
      doc.text(String(i + 1), startX, y, { width: 20, textAlign: 'center' });
      doc.text(d.nama || '', startX + 20, y, { width: 120, textAlign: 'left' });
      for (let day = 1; day <= daysInMonth; day++) {
        doc.text(d['tgl_' + day] || '', startX + 140 + (day - 1) * colWidth, y, { width: colWidth, textAlign: 'center' });
      }
      doc.text(String(d.hadir || 0), startX + 140 + daysInMonth * colWidth, y, { width: colWidth, textAlign: 'center' });
      doc.text(String(d.terlambat || 0), startX + 140 + (daysInMonth + 1) * colWidth, y, { width: colWidth, textAlign: 'center' });
      doc.text(String(d.izin || 0), startX + 140 + (daysInMonth + 2) * colWidth, y, { width: colWidth, textAlign: 'center' });
      doc.text(String(d.sakit || 0), startX + 140 + (daysInMonth + 3) * colWidth, y, { width: colWidth, textAlign: 'center' });
      doc.text(String(d.dinas_luar || 0), startX + 140 + (daysInMonth + 4) * colWidth, y, { width: colWidth, textAlign: 'center' });
      doc.text(String(d.cuti || 0), startX + 140 + (daysInMonth + 5) * colWidth, y, { width: colWidth, textAlign: 'center' });
      doc.text(String(d.tanpa_keterangan || 0), startX + 140 + (daysInMonth + 6) * colWidth, y, { width: colWidth, textAlign: 'center' });
    });

    doc.end();
  } catch (e) {
    console.error('PDF export error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;