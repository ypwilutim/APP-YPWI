const express = require('express');
const db = require('../../db');
const nodemailer = require('nodemailer');
const axios = require('axios');
const { authenticateToken, authenticateOperator, authenticateBendahara, verifyTenantAccess } = require('../middleware/auth');
const { sendBillTemplate } = require('../utils/whatsappTemplate');
const billing = require('../utils/billing');

const router = express.Router();

const XENDIT_API_BASE = 'https://api.xendit.co';

function getXenditAuth(apiKey) {
  return Buffer.from(apiKey + ':').toString('base64');
}

async function getTenantXenditConfig(tenantId) {
  try {
    const [tenant] = await db.query(
      'SELECT xendit_api_key, xendit_public_key, xendit_webhook_token, xendit_enabled FROM tenants WHERE tenant_id = ?',
      [tenantId]
    );
    if (tenant && tenant.xendit_api_key) {
      return tenant;
    }
    return {
      xendit_api_key: process.env.XENDIT_API_KEY || null,
      xendit_public_key: process.env.XENDIT_PUBLIC_KEY || null,
      xendit_webhook_token: process.env.XENDIT_WEBHOOK_TOKEN || null,
      xendit_enabled: process.env.XENDIT_ENABLED === 'true' ? 1 : 0
    };
  } catch (error) {
    console.error('Get xendit config error:', error);
    return {
      xendit_api_key: process.env.XENDIT_API_KEY || null,
      xendit_public_key: process.env.XENDIT_PUBLIC_KEY || null,
      xendit_webhook_token: process.env.XENDIT_WEBHOOK_TOKEN || null,
      xendit_enabled: process.env.XENDIT_ENABLED === 'true' ? 1 : 0
    };
  }
}

// Public endpoints for development/testing (no auth required)
// GET /api/treasurer/public/spp-summary - Ringkasan pembayaran SPP (dari billing_payment + incoming_payments)
router.get('/treasurer/public/spp-summary', async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;

    // Query pendapatan dari incoming_payments per tenant
    let incomeQuery = `
      SELECT 
        s.tenant_id,
        COALESCE(SUM(CASE WHEN ip.status = 'Success' THEN ip.total_amount ELSE 0 END), 0) as total_pemasukan
      FROM incoming_payments ip
      LEFT JOIN students s ON ip.matched_student_id = s.id
    `;
    let incomeParams = [];

    if (tenantId) {
      incomeQuery += ' WHERE s.tenant_id = ?';
      incomeParams.push(tenantId);
    }

    incomeQuery += ' GROUP BY s.tenant_id';

    // Query tunggakan dari saldo_siswa
    let query = `
      SELECT 
        tn.tenant_id,
        tn.nama_sekolah,
        COUNT(s.id) as total_siswa,
        COALESCE(SUM(CASE WHEN ss.saldo < 0 THEN -ss.saldo ELSE 0 END), 0) as total_tunggakan,
        COALESCE(SUM(CASE WHEN ss.saldo > 0 THEN ss.saldo ELSE 0 END), 0) as total_kelebihan,
        COUNT(CASE WHEN ss.saldo < 0 THEN 1 END) as jumlah_tunggakan,
        COUNT(CASE WHEN ss.saldo > 0 THEN 1 END) as jumlah_kelebihan
      FROM tenants tn
      LEFT JOIN students s ON tn.tenant_id = s.tenant_id
      LEFT JOIN saldo_siswa ss ON ss.student_id = s.id
      WHERE 1=1
    `;
    let params = [];

    if (tenantId) {
      query += ' AND tn.tenant_id = ?';
      params.push(tenantId);
    }

    query += ' GROUP BY tn.tenant_id, tn.nama_sekolah ORDER BY tn.nama_sekolah ASC';
    const summary = await db.query(query, params);
    const incomeData = await db.query(incomeQuery, incomeParams);

    // Map pemasukan ke tiap tenant
    const pemasukanMap = {};
    if (incomeData && incomeData.length > 0) {
      incomeData.forEach(row => {
        const tid = tenantId || row.tenant_id;
        pemasukanMap[tid] = parseFloat(row.total_pemasukan) || 0;
      });
    }

    res.json({
      success: true,
      data: summary.map(s => ({
        tenant_id: s.tenant_id,
        nama_sekolah: s.nama_sekolah,
        total_siswa: s.total_siswa || 0,
        sudah_bayar: s.total_siswa - (s.jumlah_tunggakan || 0),
        belum_bayar: s.jumlah_tunggakan || 0,
        total_pemasukan: pemasukanMap[s.tenant_id] || 0,
        total_tunggakan: s.total_tunggakan || 0
      }))
    });
  } catch (error) {
    console.error('Public SPP summary error:', error);
    res.status(500).json({ success: false, message: 'Error fetching SPP summary' });
  }
});

// Public salary summary endpoint
router.get('/treasurer/public/salary-summary', async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    const month = req.query.month || new Date().toISOString().slice(0, 7);

    let query = `
      SELECT 
        t.id as teacher_id,
        t.nama,
        t.nip,
        ta.jabatan_di_unit,
        tn.nama_sekolah,
        tt.Gaji_Pokok,
        tt.Tunj_Kinerja,
        tt.Tunj_Umum,
        tt.Tunj_Istri,
        tt.Tunj_Anak,
        tt.Tunj_Kepala_Sekolah,
        tt.Tunj_Wali_Kelas,
        tt.Honor_Bendahara
      FROM teachers t
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      JOIN tenants tn ON ta.tenant_id = tn.tenant_id
      LEFT JOIN temp_teachers tt ON t.nama = tt.Nama
      WHERE t.status_aktif = 1
    `;
    let params = [];

    if (tenantId) {
      query += ' AND ta.tenant_id = ?';
      params.push(tenantId);
    }

    query += ' ORDER BY t.nama ASC';
    const teachers = await db.query(query, params);

    let totalGajiPokok = 0, totalTunjangan = 0, totalHonor = 0;
    const results = teachers.map(t => {
      const gaji = parseFloat(t.Gaji_Pokok) || 0;
      const tunjangan = (
        (parseFloat(t.Tunj_Kinerja) || 0) +
        (parseFloat(t.Tunj_Umum) || 0) +
        (parseFloat(t.Tunj_Istri) || 0) +
        (parseFloat(t.Tunj_Anak) || 0) +
        (parseFloat(t.Tunj_Kepala_Sekolah) || 0) +
        (parseFloat(t.Tunj_Wali_Kelas) || 0)
      );
      const honor = parseFloat(t.Honor_Bendahara) || 0;
      const total = gaji + tunjangan;

      totalGajiPokok += gaji;
      totalTunjangan += tunjangan;
      totalHonor += honor;

      return {
        teacher_id: t.teacher_id,
        nama: t.nama,
        nip: t.nip,
        jabatan: t.jabatan_di_unit,
        sekolah: t.nama_sekolah,
        gaji_pokok: gaji,
        tunjangan: tunjangan,
        honor_bendahara: honor,
        total_gaji: total
      };
    });

    res.json({
      success: true,
      month,
      data: results,
      summary: {
        total_guru: results.length,
        total_gaji_pokok: totalGajiPokok,
        total_tunjangan: totalTunjangan,
        total_honor: totalHonor,
        grand_total: totalGajiPokok + totalTunjangan + totalHonor
      }
    });
  } catch (error) {
    console.error('Public salary summary error:', error);
    res.status(500).json({ success: false, message: 'Error fetching salary summary' });
  }
});

// Public payment defaulters endpoint
router.get('/treasurer/public/payment-defaulters', async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;

    let query = `
      SELECT s.id, s.nama_siswa, s.nisn, s.iuran_bulanan, tn.nama_sekolah, p.no_wa,
        COALESCE(ss.saldo, 0) as arrears_billing
      FROM students s
      JOIN tenants tn ON s.tenant_id = tn.tenant_id
      LEFT JOIN parents p ON s.parent_id = p.id
      LEFT JOIN saldo_siswa ss ON ss.student_id = s.id
      WHERE s.iuran_bulanan IS NOT NULL`;
    let params = [];

    if (tenantId) {
      query += ' AND s.tenant_id = ?';
      params.push(tenantId);
    }

    query += ' AND COALESCE(ss.saldo, 0) < 0 ORDER BY tn.nama_sekolah ASC, s.nama_siswa ASC';
    const defaulters = await db.query(query, params);

const data = defaulters.map(s => ({
      ...s,
      total_arrears: Math.abs(parseFloat(s.arrears_billing || 0)),
      arrears_months: s.total_arrears > 0 ? Math.ceil(s.total_arrears / parseFloat(s.iuran_bulanan || 1)) : 0
    }));

    res.json({
      success: true,
      data: data
    });
  } catch (error) {
    console.error('Public payment defaulters error:', error);
    res.status(500).json({ success: false, message: 'Error fetching payment defaulters' });
  }
});

// POST /api/treasurer/public/send-spp-reminder - Kirim pengingat SPP via Meta WhatsApp template
router.post('/treasurer/public/send-spp-reminder', async (req, res) => {
  try {
    const { no_wa, nama_siswa, jumlah_tagihan, bulan, tanggal_jatuh_tempo, tenant_id, student_id, template_type } = req.body;

    let resolvedTemplate = template_type;
    if (template_type === 'bsi_auto' && student_id) {
      const [saldo] = await db.query(
        'SELECT saldo FROM saldo_siswa WHERE student_id = ? LIMIT 1',
        [student_id]
      );
      const saldoVal = parseFloat(saldo?.saldo || 0);
      if (saldoVal >= 0) {
        return res.json({ success: false, message: 'Siswa tidak memiliki tunggakan', skipped: true });
      }
      resolvedTemplate = 'tagihan_spp_bsi';
    } else if (template_type === 'bsi_auto') {
      resolvedTemplate = 'tagihan_spp_bsi';
    }
    const templateName = resolvedTemplate === 'tagihan_spp_bsi' ? 'tagihan_spp_bsi' : (resolvedTemplate === 'tagihan_spp' ? 'tagihan_spp' : 'invoice_spp');

    if (!no_wa) {
      return res.status(400).json({ success: false, message: 'Nomor WA tidak tersedia' });
    }
    if (!nama_siswa) {
      return res.status(400).json({ success: false, message: 'Nama siswa tidak tersedia' });
    }

    const now = new Date();
    const bulanPengiriman = bulan || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const jatuhTempo = tanggal_jatuh_tempo || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-10`;

    let params = {
      nama_siswa,
      bulan: bulanPengiriman,
      jumlah_tagihan: jumlah_tagihan ? `${Number(jumlah_tagihan).toLocaleString('id-ID')}` : '-',
      tanggal_jatuh_tempo: jatuhTempo
    };

    if (templateName === 'invoice_spp') {
      let invoiceUrl = null;
      if (student_id) {
        const [inv] = await db.query(
          'SELECT external_id FROM xendit_invoices WHERE student_id = ? AND status = "PENDING" ORDER BY created_id DESC LIMIT 1',
          [student_id]
        );
        if (inv?.external_id) {
          invoiceUrl = `xendit-payment.html?external_id=${inv.external_id}`;
        }
      }
      params.invoice_url = invoiceUrl || `xendit-payment.html?student_id=${student_id || ''}`;
      params.nama_pembayaran = 'SPP';
    } else if (templateName === 'tagihan_spp_bsi') {
      let tenantIdForBendahara = tenant_id;
      let vaRaw = '';
      let vaNumber = '-';
      let vaName = '-';
      let kelas = '-';
      let infoSekolah = '-';
      let namaSekolah = '-';
      if (student_id) {
        const stuResult = await db.query(
          `SELECT s.va_number, s.nama_siswa, s.class_id, s.tenant_id, c.nama_kelas, c.tingkatan, tn.nama_sekolah
           FROM students s
           LEFT JOIN classes c ON s.class_id = c.id
           LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id
           WHERE s.id = ? LIMIT 1`,
          [student_id]
        );
        const stu = Array.isArray(stuResult) ? stuResult[0] : stuResult;
        if (stu) {
          vaRaw = (stu.va_number || '').replace(/[^0-9]/g, '');
          vaNumber = vaRaw ? `BSI ${vaRaw}` : '-';
          vaName = (stu.nama_siswa || '').replace(/,/g, ' ');
          kelas = stu.nama_kelas || (stu.tingkatan ? `Kelas ${stu.tingkatan}` : '-');
          namaSekolah = stu.nama_sekolah || '-';
          infoSekolah = namaSekolah;
          // Use student's tenant_id if not provided
          if (!tenantIdForBendahara && stu.tenant_id) {
            tenantIdForBendahara = stu.tenant_id;
          }
        }
        // Get treasurer phone from teacher assignment
        if (tenantIdForBendahara) {
          const bendaharaResult = await db.query(
            `SELECT t.no_wa FROM teacher_assignments ta
             JOIN teachers t ON ta.teacher_id = t.id
             WHERE ta.tenant_id = ? AND ta.jabatan_di_unit = 'bendahara'
             LIMIT 1`,
            [tenantIdForBendahara ?? null]
          );
          const bendahara = Array.isArray(bendaharaResult) ? bendaharaResult[0] : bendaharaResult;
          if (bendahara && bendahara.no_wa) {
            // Add + prefix for WhatsApp click-to-chat link
            const waBendahara = `+${bendahara.no_wa.replace(/[^0-9]/g, '')}`;
            infoSekolah = `${namaSekolah} - ${waBendahara}`;
          }
        }
      }
      params.nomor_rekening = vaNumber;
      params.nama_penerima = vaName;
      params.kelas = kelas;
      params.nama_siswa_2 = nama_siswa;
      params.info_sekolah = infoSekolah;
      params.nama_sekolah = namaSekolah;
      params.va_raw = vaRaw;

      // Validasi: jika tidak ada VA, tidak bisa kirim template BSI
      if (!vaRaw) {
        return res.status(400).json({ success: false, message: 'Siswa belum memiliki VA BSI. Generate VA terlebih dahulu.' });
      }
    } else {
      let vaNumber = '-';
      let vaName = '-';
      if (student_id) {
        const [stu] = await db.query('SELECT s.va_number, s.nama_siswa FROM students s WHERE s.id = ? LIMIT 1', [student_id]);
        if (stu) {
          vaNumber = (stu.va_number || '').replace(/[^0-9]/g, '');
          vaNumber = vaNumber ? `BSI ${vaNumber}` : '-';
          vaName = (stu.nama_siswa || '').replace(/,/g, ' ');
        }
      }
      params.nomor_rekening = vaNumber;
      params.nama_penerima = vaName;
    }

    const result = await sendBillTemplate(no_wa, params, templateName);

    res.json({
      success: true,
      message: 'Pengingat SPP berhasil dikirim via WhatsApp',
      messageId: result.messageId
    });
  } catch (error) {
    console.error('Send SPP reminder error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/treasurer/public/send-all-spp-reminders - Kirim pengingat ke semua siswa belum bayar
router.post('/treasurer/public/send-all-spp-reminders', async (req, res) => {
  try {
    const { tenant_id, template_type } = req.body;
    const resolvedTemplate = template_type === 'bsi_auto' ? 'tagihan_spp_bsi' : template_type;
    const templateName = resolvedTemplate === 'tagihan_spp_bsi' ? 'tagihan_spp_bsi' : (resolvedTemplate === 'tagihan_spp' ? 'tagihan_spp' : 'invoice_spp');
    let tenantId = tenant_id || null;

    let defaulterQuery = `
      SELECT s.id, s.nama_siswa, s.nisn, s.no_wa, s.va_number, s.class_id, c.nama_kelas, c.tingkatan, p.nama_orang_tua, tn.nama_sekolah, tn.tenant_id,
        COALESCE(CASE WHEN s.kelas = 'PI' THEN s.arrears_pi WHEN s.kelas = 'XI' THEN s.arrears_xi ELSE 0 END, 0) as total_arrears
      FROM students s
      JOIN tenants tn ON s.tenant_id = tn.tenant_id
      LEFT JOIN parents p ON s.parent_id = p.id
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE s.status = 'active'
        AND s.va_number IS NOT NULL AND s.va_number != ''
    `;
    const params = [];
    if (tenantId) {
      defaulterQuery += ' AND s.tenant_id = ?';
      params.push(tenantId);
    }
    defaulterQuery += ' AND (COALESCE(CASE WHEN s.kelas = "PI" THEN s.arrears_pi WHEN s.kelas = "XI" THEN s.arrears_xi ELSE 0 END, 0) > 0)';

    const [defaulters] = await db.query(defaulterQuery, params);

    if (!defaulters || defaulters.length === 0) {
      return res.json({ success: true, message: 'Tidak ada siswa yang belum bayar', sent: 0, failed: 0 });
    }

    const now = new Date();
    const bulanPengiriman = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const jatuhTempo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-10`;

    // Get treasurer phone from teacher assignment
    let teleponBendahara = '';
    if (tenantId) {
      const [bendahara] = await db.query(
        `SELECT t.no_wa FROM teacher_assignments ta
         JOIN teachers t ON ta.teacher_id = t.id
         WHERE ta.tenant_id = ? AND ta.jabatan_di_unit = 'bendahara'
         LIMIT 1`,
        [tenantId]
      );
      if (bendahara && bendahara.no_wa) {
        teleponBendahara = bendahara.no_wa;
      }
    }

    let sent = 0, failed = 0;
    const results = [];

    for (const student of defaulters) {
      if (!student.no_wa) { failed++; continue; }

      const number = student.no_wa.replace(/[^0-9]/g, '');

      const templateParams = {
        nama_siswa: student.nama_siswa,
        bulan: bulanPengiriman,
        jumlah_tagihan: student.total_arrears ? `${Number(student.total_arrears).toLocaleString('id-ID')}` : '-',
        tanggal_jatuh_tempo: jatuhTempo
      };

      if (templateName === 'invoice_spp') {
        let invoiceUrl = null;
        const [inv] = await db.query(
          'SELECT external_id FROM xendit_invoices WHERE student_id = ? AND status = "PENDING" ORDER BY created_at DESC LIMIT 1',
          [student.id]
        );
        if (inv?.external_id) {
          invoiceUrl = `xendit-payment.html?external_id=${inv.external_id}`;
        } else {
          invoiceUrl = `xendit-payment.html?student_id=${student.id}`;
        }
        templateParams.invoice_url = invoiceUrl;
        templateParams.nama_pembayaran = 'SPP';
      } else if (templateName === 'tagihan_spp_bsi') {
        const vaRaw = (student.va_number || '').replace(/[^0-9]/g, '');
        const kelas = student.nama_kelas || (student.tingkatan ? `Kelas ${student.tingkatan}` : '-');
        const namaSekolah = student.nama_sekolah || '-';
        let infoSekolah = namaSekolah;
        if (teleponBendahara) {
          // Add + prefix for WhatsApp click-to-chat link
          const waBendahara = `+${teleponBendahara.replace(/[^0-9]/g, '')}`;
          infoSekolah = `${namaSekolah} - ${waBendahara}`;
        }
        templateParams.nomor_rekening = vaRaw ? `BSI ${vaRaw}` : '-';
        templateParams.nama_penerima = (student.nama_siswa || '').replace(/,/g, ' ');
        templateParams.kelas = kelas;
        templateParams.nama_siswa_2 = student.nama_siswa;
        templateParams.info_sekolah = infoSekolah;
        templateParams.nama_sekolah = namaSekolah;
        templateParams.va_raw = vaRaw;
      } else {
        const vaRaw = (student.va_number || '').replace(/[^0-9]/g, '');
        templateParams.nomor_rekening = vaRaw ? `BSI ${vaRaw}` : '-';
        templateParams.nama_penerima = (student.nama_siswa || '').replace(/,/g, ' ');
      }

      try {
        const result = await sendBillTemplate(number, templateParams, templateName);
        sent++;
        results.push({ id: student.id, success: true });
      } catch (e) {
        failed++;
        results.push({ id: student.id, success: false, error: e.message });
      }
    }

    res.json({ 
      success: true, 
      message: `Terkirim: ${sent} | Gagal: ${failed}`, 
      sent, 
      failed, 
      data: defaulters.map(s => ({ id: s.id, nama_siswa: s.nama_siswa, nisn: s.nisn, no_wa: s.no_wa, nama_sekolah: s.nama_sekolah, total_arrears: s.total_arrears }))
    });
  } catch (error) {
    console.error('Send all SPP reminders error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/treasurer/public/send-selected-spp-reminders - Kirim pengingat ke siswa yang dipilih
router.post('/treasurer/public/send-selected-spp-reminders', async (req, res) => {
  try {
    const { student_ids, template_type, bulan, tanggal_jatuh_tempo } = req.body;
    if (!student_ids || !Array.isArray(student_ids) || student_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'student_ids wajib diisi' });
    }

    const resolvedTemplate = template_type === 'bsi_auto' ? 'tagihan_spp_bsi' : template_type;
    const templateName = resolvedTemplate === 'tagihan_spp_bsi' ? 'tagihan_spp_bsi' : (resolvedTemplate === 'tagihan_spp' ? 'tagihan_spp' : 'invoice_spp');

    const placeholders = student_ids.map(() => '?').join(',');
     const [defaulters] = await db.query(
      `SELECT s.id, s.nama_siswa, s.nisn, p.no_wa, s.va_number, s.parent_id, s.tenant_id, c.nama_kelas, c.tingkatan, tn.nama_sekolah, COALESCE(COALESCE(CASE WHEN s.kelas = 'PI' THEN s.arrears_pi WHEN s.kelas = 'XI' THEN s.arrears_xi ELSE 0 END, 0), 0) as total_arrears FROM students s JOIN tenants tn ON s.tenant_id = tn.tenant_id LEFT JOIN classes c ON s.class_id = c.id LEFT JOIN parents p ON s.parent_id = p.id WHERE s.id IN (${placeholders})`,
      student_ids
    );

    if (!defaulters || defaulters.length === 0) {
      return res.json({ success: true, message: 'Tidak ada siswa ditemukan', sent: 0, failed: 0 });
    }

    const now = new Date();
    const bulanPengiriman = bulan || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const jatuhTempo = tanggal_jatuh_tempo || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-10`;

    // Get treasurer phone from teacher assignment (use first student's tenant)
    let teleponBendahara = '';
    const firstTenantId = defaulters[0].tenant_id;
    const [bendahara] = await db.query(
      `SELECT t.no_wa FROM teacher_assignments ta JOIN teachers t ON ta.teacher_id = t.id WHERE ta.tenant_id = ? AND ta.jabatan_di_unit = 'bendahara' LIMIT 1`,
      [firstTenantId]
    );
    if (bendahara && bendahara.no_wa) {
      teleponBendahara = bendahara.no_wa;
    }

    let sent = 0, failed = 0;

    for (const student of defaulters) {
      if (!student.no_wa) { failed++; continue; }

      const number = student.no_wa.replace(/[^0-9]/g, '');
      const templateParams = {
        nama_siswa: student.nama_siswa,
        bulan: bulanPengiriman,
        jumlah_tagihan: student.total_arrears ? `${Number(student.total_arrears).toLocaleString('id-ID')}` : '-',
        tanggal_jatuh_tempo: jatuhTempo
      };

      if (templateName === 'invoice_spp') {
        let invoiceUrl = null;
        const [inv] = await db.query(
          'SELECT external_id FROM xendit_invoices WHERE student_id = ? AND status = "PENDING" ORDER BY created_at DESC LIMIT 1',
          [student.id]
        );
        if (inv?.external_id) {
          invoiceUrl = `xendit-payment.html?external_id=${inv.external_id}`;
        } else {
          invoiceUrl = `xendit-payment.html?student_id=${student.id}`;
        }
        templateParams.invoice_url = invoiceUrl;
        templateParams.nama_pembayaran = 'SPP';
      } else if (templateName === 'tagihan_spp_bsi') {
        const vaRaw = (student.va_number || '').replace(/[^0-9]/g, '');
        const kelas = student.nama_kelas || (student.tingkatan ? `Kelas ${student.tingkatan}` : '-');
        const namaSekolah = student.nama_sekolah || '-';
        let infoSekolah = namaSekolah;
        if (teleponBendahara) {
          const waBendahara = `+${teleponBendahara.replace(/[^0-9]/g, '')}`;
          infoSekolah = `${namaSekolah} - ${waBendahara}`;
        }
        templateParams.nomor_rekening = vaRaw ? `BSI ${vaRaw}` : '-';
        templateParams.nama_penerima = (student.nama_siswa || '').replace(/,/g, ' ');
        templateParams.kelas = kelas;
        templateParams.nama_siswa_2 = student.nama_siswa;
        templateParams.info_sekolah = infoSekolah;
        templateParams.nama_sekolah = namaSekolah;
        templateParams.va_raw = vaRaw;
      } else {
        const vaRaw = (student.va_number || '').replace(/[^0-9]/g, '');
        templateParams.nomor_rekening = vaRaw ? `BSI ${vaRaw}` : '-';
        templateParams.nama_penerima = (student.nama_siswa || '').replace(/,/g, ' ');
      }

      try {
        const result = await sendBillTemplate(number, templateParams, templateName);
        sent++;
      } catch (e) {
        failed++;
      }
    }

    res.json({
      success: true,
      message: `Terkirim: ${sent} | Gagal: ${failed} dari ${defaulters.length} siswa`,
      sent,
      failed,
      total: defaulters.length
    });
  } catch (error) {
    console.error('Send selected SPP reminders error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/treasurer/public/create-concession-invoice - Create concession invoice (additional installment)
router.post('/treasurer/public/create-concession-invoice', async (req, res) => {
  try {
    const { student_id, amount } = req.body;

    if (!student_id) {
      return res.status(400).json({ success: false, message: 'student_id wajib diisi' });
    }

    const [student] = await db.query(
      'SELECT s.*, tn.nama_sekolah, tn.tenant_id FROM students s JOIN tenants tn ON s.tenant_id = tn.tenant_id WHERE s.id = ?',
      [student_id]
    );
    if (!student) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }

    const tenantId = student.tenant_id;
    const config = await getTenantXenditConfig(tenantId);
    if (!config || !config.xendit_api_key || config.xendit_enabled !== 1) {
      return res.status(400).json({ success: false, message: 'Xendit belum dikonfigurasi untuk tenant ini' });
    }

    let finalAmount;
    if (amount !== undefined && amount !== null && amount !== '' && !isNaN(parseFloat(amount))) {
      finalAmount = parseFloat(amount);
    } else {
      const [arrears] = await db.query(
        "SELECT COALESCE(SUM(amount),0) as total FROM xendit_invoices WHERE student_id = ? AND tenant_id = ? AND status NOT IN ('PAID','EXPIRED')",
        [student_id, tenantId]
      );
      const [paymentArrears] = await db.query(
        "SELECT COALESCE(SUM(amount),0) as total FROM payment_invoices WHERE student_id = ? AND tenant_id = ? AND status NOT IN ('paid','cancelled')",
        [student_id, tenantId]
      );
      finalAmount = (parseFloat(arrears && arrears.total) || 0) + (parseFloat(paymentArrears && paymentArrears.total) || 0);
    }

    if (finalAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Amount tidak valid' });
    }

    const externalId = `CONCESSION-${tenantId}-${student_id}-${Date.now()}`;
    const callbackUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/api/xendit/webhook`;
    const successRedirect = `${process.env.BASE_URL || 'http://localhost:3000'}/xendit-payment.html?external_id=${externalId}`;
    const failureRedirect = `${process.env.BASE_URL || 'http://localhost:3000'}/xendit-payment.html?external_id=${externalId}`;

    const invoicePayload = {
      external_id: externalId,
      amount: finalAmount,
      description: `Cicilan tambahan ${student.nama_siswa} - ${student.nama_sekolah}`,
      invoice_duration: 31536000,
      currency: 'IDR',
      success_redirect_url: successRedirect,
      failure_redirect_url: failureRedirect
    };

    const response = await axios.post(
      `${XENDIT_API_BASE}/v2/invoices`,
      invoicePayload,
      {
        headers: {
          'Authorization': `Basic ${getXenditAuth(config.xendit_api_key)}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const xenditInvoice = response.data;

    console.log(`[CONCESSION] Invoice created: ${xenditInvoice.id} for student ${student_id}, tenant ${tenantId}`);

    await db.query(
      `INSERT INTO xendit_invoices (tenant_id, student_id, xendit_invoice_id, external_id, amount, description, status, payment_method, callback_url, invoice_url, expiry_date, installment_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        student_id,
        xenditInvoice.id,
        externalId,
        finalAmount,
        invoicePayload.description,
        xenditInvoice.status,
        'MULTIPLE',
        callbackUrl,
        xenditInvoice.invoice_url,
        xenditInvoice.expiry_date,
        'concession'
      ]
    );

    res.json({
      success: true,
      message: 'Invoice konsesi Xendit berhasil dibuat',
      data: {
        invoice_id: xenditInvoice.id,
        external_id: externalId,
        invoice_url: xenditInvoice.invoice_url,
        payment_page_url: `${process.env.BASE_URL || 'http://localhost:3000'}/xendit-payment.html?external_id=${encodeURIComponent(externalId)}`,
        amount: finalAmount,
        status: xenditInvoice.status,
        expiry_date: xenditInvoice.expiry_date,
        payment_methods: xenditInvoice.available_payment_methods,
        installment_type: 'concession'
      }
    });
  } catch (error) {
    console.error('Create concession invoice error:', error.response?.data || error.message);
    res.status(500).json({ success: false, message: error.response?.data?.message || 'Error creating concession invoice' });
  }
});

// POST /api/treasurer/public/create-invoice - Create Xendit invoice (public endpoint)
router.post('/treasurer/public/create-invoice', async (req, res) => {
  try {
    const { student_id, amount, tenant_id } = req.body;

    if (!student_id || !tenant_id) {
      return res.status(400).json({ success: false, message: 'student_id dan tenant_id wajib diisi' });
    }

    const [student] = await db.query(
      'SELECT s.*, tn.nama_sekolah FROM students s JOIN tenants tn ON s.tenant_id = tn.tenant_id WHERE s.id = ? AND s.tenant_id = ?',
      [student_id, tenant_id]
    );
    if (!student) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }

    const config = await getTenantXenditConfig(tenant_id);
    if (!config || !config.xendit_api_key || config.xendit_enabled !== 1) {
      return res.status(400).json({ success: false, message: 'Xendit belum dikonfigurasi untuk tenant ini' });
    }

    const [existing] = await db.query(
      'SELECT id, xendit_invoice_id FROM xendit_invoices WHERE student_id = ? AND tenant_id = ? AND status = "PENDING" ORDER BY created_at DESC LIMIT 1',
      [student_id, tenant_id]
    );
    if (existing) {
      try {
        await axios.post(
          `${XENDIT_API_BASE}/v2/invoices/${existing.xendit_invoice_id}/expire`,
          {},
          { headers: { 'Authorization': `Basic ${getXenditAuth(config.xendit_api_key)}` } }
        );
        await db.query('UPDATE xendit_invoices SET status = "EXPIRED" WHERE id = ?', [existing.id]);
        console.log(`[PUBLIC-CREATE-INVOICE] Expired old invoice: ${existing.xendit_invoice_id}`);
      } catch (e) { console.warn('Failed to expire old invoice:', e.message); }
    }

    const finalAmount = amount !== undefined && amount !== null && !isNaN(parseFloat(amount))
      ? parseFloat(amount)
      : parseFloat(student.iuran_bulanan) || 0;

    if (finalAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Amount tidak valid' });
    }

    const periode = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

    const externalId = `SPP-${tenant_id}-${student_id}-${periode}-${Date.now()}`;
    const callbackUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/api/xendit/webhook`;
    const successRedirect = `${process.env.BASE_URL || 'http://localhost:3000'}/xendit-payment.html?external_id=${externalId}`;
    const failureRedirect = `${process.env.BASE_URL || 'http://localhost:3000'}/xendit-payment.html?external_id=${externalId}`;

    const invoicePayload = {
      external_id: externalId,
      amount: finalAmount,
      description: `SPP ${student.nama_siswa} - ${student.nama_sekolah}`,
      invoice_duration: 31536000,
      currency: 'IDR',
      success_redirect_url: successRedirect,
      failure_redirect_url: failureRedirect
    };

    const response = await axios.post(
      `${XENDIT_API_BASE}/v2/invoices`,
      invoicePayload,
      {
        headers: {
          'Authorization': `Basic ${getXenditAuth(config.xendit_api_key)}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const xenditInvoice = response.data;

    console.log(`[PUBLIC-CREATE-INVOICE] Invoice created: ${xenditInvoice.id} for student ${student_id}, tenant ${tenant_id}`);

    await db.query(
      `INSERT INTO xendit_invoices (tenant_id, student_id, xendit_invoice_id, external_id, amount, description, status, payment_method, callback_url, invoice_url, expiry_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenant_id,
        student_id,
        xenditInvoice.id,
        externalId,
        finalAmount,
        invoicePayload.description,
        xenditInvoice.status,
        'MULTIPLE',
        callbackUrl,
        xenditInvoice.invoice_url,
        xenditInvoice.expiry_date
      ]
    );

    res.json({
      success: true,
      message: 'Invoice Xendit berhasil dibuat',
      data: {
        invoice_id: xenditInvoice.id,
        external_id: externalId,
        invoice_url: xenditInvoice.invoice_url,
        payment_page_url: `${process.env.BASE_URL || 'http://localhost:3000'}/xendit-payment.html?external_id=${encodeURIComponent(externalId)}`,
        amount: finalAmount,
        status: xenditInvoice.status,
        expiry_date: xenditInvoice.expiry_date,
        payment_methods: xenditInvoice.available_payment_methods
      }
    });
  } catch (error) {
    console.error('Create invoice error:', error.response?.data || error.message);
    res.status(500).json({ success: false, message: error.response?.data?.message || 'Error creating invoice' });
  }
});

// Public endpoint to check BSI payment by virtual account
router.get('/treasurer/public/check-bsi-payment', async (req, res) => {
  try {
    const { va_number } = req.query;
    if (!va_number) {
      return res.json({ success: true, data: null });
    }

    const bsiPrefix = process.env.BSI_VA_PREFIX || '832231';
    const vaWithoutPrefix = va_number.replace(bsiPrefix, '');

    const query = `
      SELECT s.id, s.nama_siswa, s.nisn, s.iuran_bulanan, s.tenant_id, tn.nama_sekolah, s.va_number, s.nis,
             c.nama_kelas, c.tingkatan, COALESCE(ss.saldo, 0) as arrears_billing
      FROM students s
      JOIN tenants tn ON s.tenant_id = tn.tenant_id
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN saldo_siswa ss ON ss.student_id = s.id
      WHERE s.va_number = ? OR s.nis = ?
    `;
    const [student] = await db.query(query, [va_number, vaWithoutPrefix]);

    if (student) {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const bills = await db.query(
        `SELECT bulan, spp_bulanan, ransportasi, subsidi, keterangan_spp, transaksi, status, metode_pembayaran, tanggal_bayar
         FROM billing_payment
         WHERE student_id = ? AND status = 'belum' AND keterangan_spp > 0
         ORDER BY bulan ASC`,
        [student.id]
      );
      const tunggunganFromBills = (bills || []).reduce((a, b) => a + (parseFloat(b.keterangan_spp) || 0), 0);
      const arrearsDb = parseFloat(student.arrears_billing) || 0;
      const tunggungan = tunggunganFromBills > 0 ? tunggunganFromBills : (arrearsDb < 0 ? Math.abs(arrearsDb) : 0);
      // Cek apakah bulan berjalan sudah tercantum (lunas/belum) di billing_payment
      const [currentRow] = await db.query(
        `SELECT status, keterangan_spp FROM billing_payment WHERE student_id = ? AND bulan = ? LIMIT 1`,
        [student.id, currentMonth]
      );
      let addCurrent = 0;
      if (tunggunganFromBills > 0) {
        // Billing detail ada: jika tidak ada row bulan berjalan, asumsikan SPP bulan ini masih terutang.
        addCurrent = currentRow ? 0 : (parseFloat(student.iuran_bulanan) || 0);
      }
      // bila pakai fallback saldo (tidak ada row belum sama sekali), saldo sudah termasuk bulan berjalan -> tidak tambah iuran lagi.
      student.tagihan = bills || [];
      student.tunggungan = tunggungan;
      student.bulan_berjalan = currentMonth;
      student.total_tagihan = tunggungan + addCurrent;
    }

    res.json({
      success: true,
      data: student || null
    });
  } catch (error) {
    console.error('Check BSI payment error:', error);
    res.status(500).json({ success: false, message: 'Error checking BSI payment' });
  }
});

// Public endpoint to list students (for testing / invoice creation)
router.get('/treasurer/public/students', async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    let query = `
      SELECT s.id, s.nama_siswa, s.nisn, s.tenant_id, tn.nama_sekolah, p.no_wa as parent_wa, p.nama_orang_tua, s.iuran_bulanan, s.va_number, s.va_name, s.status
      FROM students s
      JOIN tenants tn ON s.tenant_id = tn.tenant_id
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE 1=1
    `;
    let params = [];
    if (tenantId) {
      query += ' AND s.tenant_id = ?';
      params.push(tenantId);
    }
    query += " AND (s.status = 'active' OR s.status = 'aktif' OR s.status IS NULL) ORDER BY s.nama_siswa ASC";
    const students = await db.query(query, params);
    res.json({ success: true, data: students });
  } catch (error) {
    console.error('Public students error:', error);
    res.status(500).json({ success: false, message: 'Error fetching students' });
  }
});

// Public endpoint to update student payment
router.post('/treasurer/public/update-payment', async (req, res) => {
  try {
    const { student_id, amount, payment_date, va_number } = req.body;

    if (!student_id || !amount) {
      return res.status(400).json({ success: false, message: 'student_id dan amount required' });
    }

    const query = `
      UPDATE students 
      SET iuran_bulanan = ?
      WHERE id = ?
    `;
    await db.query(query, [amount, student_id]);

    res.json({
      success: true,
      message: 'Pembayaran berhasil diupdate',
      data: { student_id, amount, payment_date }
    });
  } catch (error) {
    console.error('Update payment error:', error);
    res.status(500).json({ success: false, message: 'Error updating payment' });
  }
});

// Public endpoint for CSV payment upload (BSI format)
router.post('/treasurer/public/upload-payments', async (req, res) => {
  try {
    const payments = req.body.payments || [];
    let updated = 0, not_found = 0;

    for (const payment of payments) {
      const { va_number, amount, payment_date, description } = payment;

      if (!va_number || !amount) continue;

      const query = `
        UPDATE students 
        SET iuran_bulanan = ?
        WHERE va_number = ? OR nisn = ?
      `;
      const result = await db.query(query, [amount, va_number, va_number]);

      if (result.affectedRows > 0) {
        updated++;
      } else {
        not_found++;
      }
    }

    res.json({
      success: true,
      message: `Berhasil update ${updated} pembayaran, ${not_found} tidak ditemukan`,
      updated,
      not_found
    });
  } catch (error) {
    console.error('Upload payments error:', error);
    res.status(500).json({ success: false, message: 'Error uploading payments' });
  }
});

// Public endpoint to export VA for Cuz BSI
router.get('/treasurer/public/export-va', async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    const parentAccount = req.query.parent_account || '1029129123';
    const bsiPrefix = process.env.BSI_VA_PREFIX || '832231';

    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 1);
    const expiryStr = expiry.toLocaleDateString('id-ID').replace(/\//g, '/');

    let query = `
      SELECT s.id, s.nama_siswa, s.nisn, s.iuran_bulanan, s.nis, tn.nama_sekolah, tn.nomor_rekening, p.no_wa
      FROM students s
      JOIN tenants tn ON s.tenant_id = tn.tenant_id
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE 1=1
    `;
    let params = [];

    if (tenantId) {
      query += ' AND s.tenant_id = ?';
      params.push(tenantId);
    }

    query += ' ORDER BY tn.nama_sekolah ASC, s.nama_siswa ASC';
    const students = await db.query(query, params);

    // Update va_number to students table (with BSI prefix), but export CSV uses NIS only
    for (const s of students) {
      const vaNumber = bsiPrefix + s.nis;
      const vaName = `A/N ${s.nama_siswa}`;
      await db.query(
        'UPDATE students SET va_number = ?, va_name = ? WHERE id = ?',
        [vaNumber, vaName, s.id]
      );
    }

    let csv = `Type;Parent Account;Virtual Account Number (Prefix VA + Number);Virtual Account Name;Virtual Account Scheme;Limit Debit;Limit Credit;Limit Transaction;Physical Card;Auto Renewal Limit;;Expire Date;KYC;;;;;Additional Info\n`;
    csv += `;;;;;;;;Every;Date / Day;15/06/2024;Name;Mobile Phone;ID Type;ID Number;Address;Label1\n`;

    students.forEach(s => {
      const limit = parseFloat(s.iuran_bulanan) || 150000;
      const wa = s.no_wa || '';
      csv += `Debit;${parentAccount};${s.nis};A/N ${s.nama_siswa};Open Limit;${limit};;;;No;;;${expiryStr};${s.nama_siswa};${wa};KTP;;;;;;;;\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=va_export_bsi.csv');
    res.send(csv);
  } catch (error) {
    console.error('Export VA error:', error);
    res.status(500).json({ success: false, message: 'Error exporting VA data' });
  }
});

// Public endpoint to check BSI payment by virtual account

// Public financial report endpoint - from Xendit invoices
router.get('/treasurer/public/financial-report', async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    const month = req.query.month || new Date().toISOString().slice(0, 7);

    let incomeQuery = `
      SELECT SUM(xi.amount) as total_income
      FROM xendit_invoices xi
      WHERE xi.status = 'paid' AND DATE_FORMAT(xi.created_at, '%Y-%m') = ?
    `;
    let incomeParams = [month];

    if (tenantId) {
      incomeQuery += ' AND xi.tenant_id = ?';
      incomeParams.push(tenantId);
    }

    const incomeResult = await db.query(incomeQuery, incomeParams);

    let expenseQuery = `
      SELECT 
        SUM(CAST(tt.Gaji_Pokok AS DECIMAL(10,2)) +
            CAST(tt.Tunj_Kinerja AS DECIMAL(10,2)) +
            CAST(tt.Tunj_Umum AS DECIMAL(10,2)) +
            CAST(tt.Tunj_Istri AS DECIMAL(10,2)) +
            CAST(tt.Tunj_Anak AS DECIMAL(10,2)) +
            CAST(tt.Tunj_Kepala_Sekolah AS DECIMAL(10,2)) +
            CAST(tt.Tunj_Wali_Kelas AS DECIMAL(10,2))) as total_expense
      FROM teachers t
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      LEFT JOIN temp_teachers tt ON t.nama = tt.Nama
      WHERE t.status_aktif = 1
    `;
    let expenseParams = [];

    if (tenantId) {
      expenseQuery += ' AND ta.tenant_id = ?';
      expenseParams.push(tenantId);
    }

    const expenseResult = await db.query(expenseQuery, expenseParams);

    const totalIncome = parseFloat(incomeResult[0]?.total_income) || 0;
    const totalExpense = parseFloat(expenseResult[0]?.total_expense) || 0;

    res.json({
      success: true,
      month,
      report: {
        total_pemasukan: totalIncome,
        total_pengeluaran: totalExpense,
        saldo: totalIncome - totalExpense,
        breakdown: {
          spp_masuk: totalIncome,
          gaji_guru: totalExpense,
          honor_bendahara: 0
        }
      }
    });
  } catch (error) {
    console.error('Public financial report error:', error);
    res.status(500).json({ success: false, message: 'Error fetching financial report' });
  }
});

// Protected endpoints (require authentication)
// GET /api/treasurer/salary-summary - Ringkasan gaji guru
router.get('/treasurer/salary-summary', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;

    if (req.user.role !== 'admin' && !tenantId) {
      const treasurerAssignments = (req.user.assignments || []).filter(a => {
        const roles = ['bendahara', 'tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (treasurerAssignments.length === 1) {
        tenantId = treasurerAssignments[0].tenant_id;
      }
    }

    if (tenantId && !verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const month = req.query.month || new Date().toISOString().slice(0, 7);

    let query = `
      SELECT 
        t.id as teacher_id,
        t.nama,
        t.nip,
        ta.jabatan_di_unit,
        tn.nama_sekolah,
        tt.Gaji_Pokok,
        tt.Tunj_Kinerja,
        tt.Tunj_Umum,
        tt.Tunj_Istri,
        tt.Tunj_Anak,
        tt.Tunj_Kepala_Sekolah,
        tt.Tunj_Wali_Kelas,
        tt.Honor_Bendahara
      FROM teachers t
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      JOIN tenants tn ON ta.tenant_id = tn.tenant_id
      LEFT JOIN temp_teachers tt ON t.nama = tt.Nama
      WHERE t.status_aktif = 1
    `;
    let params = [];

    if (tenantId) {
      query += ' AND ta.tenant_id = ?';
      params.push(tenantId);
    }

    query += ' ORDER BY t.nama ASC';
    const teachers = await db.query(query, params);

    let totalGajiPokok = 0, totalTunjangan = 0, totalHonor = 0;
    const results = teachers.map(t => {
      const gaji = parseFloat(t.Gaji_Pokok) || 0;
      const tunjangan = (
        (parseFloat(t.Tunj_Kinerja) || 0) +
        (parseFloat(t.Tunj_Umum) || 0) +
        (parseFloat(t.Tunj_Istri) || 0) +
        (parseFloat(t.Tunj_Anak) || 0) +
        (parseFloat(t.Tunj_Kepala_Sekolah) || 0) +
        (parseFloat(t.Tunj_Wali_Kelas) || 0)
      );
      const honor = parseFloat(t.Honor_Bendahara) || 0;
      const total = gaji + tunjangan;

      totalGajiPokok += gaji;
      totalTunjangan += tunjangan;
      totalHonor += honor;

      return {
        teacher_id: t.teacher_id,
        nama: t.nama,
        nip: t.nip,
        jabatan: t.jabatan_di_unit,
        sekolah: t.nama_sekolah,
        gaji_pokok: gaji,
        tunjangan: tunjangan,
        honor_bendahara: honor,
        total_gaji: total
      };
    });

    res.json({
      success: true,
      month,
      data: results,
      summary: {
        total_guru: results.length,
        total_gaji_pokok: totalGajiPokok,
        total_tunjangan: totalTunjangan,
        total_honor: totalHonor,
        grand_total: totalGajiPokok + totalTunjangan + totalHonor
      }
    });
  } catch (error) {
    console.error('Treasurer salary summary error:', error);
    res.status(500).json({ success: false, message: 'Error fetching salary summary' });
  }
});

// GET /api/treasurer/spp-summary - Ringkasan pembayaran SPP
router.get('/treasurer/spp-summary', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;

    // User YPWILUTIM (bendahara/ketua) boleh lihat semua tenant
    if (req.user.role === 'guru') {
      const hasYPWILUTIM = req.user.assignments?.some(a => a.tenant_id === 'YPWILUTIM');
      if (hasYPWILUTIM) tenantId = null; // Show all tenants
    }

    if (tenantId && !verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    let query = `
      SELECT 
        tn.tenant_id,
        tn.nama_sekolah,
        COUNT(s.id) as total_siswa,
        COALESCE(SUM(CASE WHEN pi.status = 'paid' THEN pi.amount ELSE 0 END), 0) as total_pemasukan,
        COUNT(CASE WHEN pi.status = 'paid' THEN 1 END) as sudah_bayar,
        COUNT(CASE WHEN pi.status != 'paid' OR pi.status IS NULL THEN 1 END) as belum_bayar
      FROM tenants tn
      LEFT JOIN students s ON tn.tenant_id = s.tenant_id
      LEFT JOIN payment_invoices pi ON s.id = pi.student_id
      WHERE 1=1
    `;
    let params = [];

    if (tenantId) {
      query += ' AND tn.tenant_id = ?';
      params.push(tenantId);
    }

    query += ' GROUP BY tn.tenant_id, tn.nama_sekolah ORDER BY tn.nama_sekolah ASC';
    const summary = await db.query(query, params);

    res.json({
      success: true,
      data: summary.map(s => ({
        tenant_id: s.tenant_id,
        nama_sekolah: s.nama_sekolah,
        total_siswa: s.total_siswa || 0,
        total_pemasukan: s.total_pemasukan || 0,
        sudah_bayar: s.sudah_bayar || 0,
        belum_bayar: s.belum_bayar || 0
      }))
    });
  } catch (error) {
    console.error('Treasurer SPP summary error:', error);
    res.status(500).json({ success: false, message: 'Error fetching SPP summary' });
  }
});

// GET /api/treasurer/financial-report - Laporan keuangan
router.get('/treasurer/financial-report', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    const month = req.query.month || new Date().toISOString().slice(0, 7);

    if (req.user.role !== 'admin' && !tenantId) {
      const treasurerAssignments = (req.user.assignments || []).filter(a => {
        const roles = ['bendahara', 'tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (treasurerAssignments.length === 1) {
        tenantId = treasurerAssignments[0].tenant_id;
      }
    }

    if (tenantId && !verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    let incomeQuery = `
      SELECT SUM(xi.amount) as total_income
      FROM xendit_invoices xi
      WHERE xi.status = 'paid' AND DATE_FORMAT(xi.created_at, '%Y-%m') = ?
    `;
    let incomeParams = [month];

    if (tenantId) {
      incomeQuery += ' AND xi.tenant_id = ?';
      incomeParams.push(tenantId);
    }

    const incomeResult = await db.query(incomeQuery, incomeParams);

    let expenseQuery = `
      SELECT 
        SUM(CAST(tt.Gaji_Pokok AS DECIMAL(10,2)) +
            CAST(tt.Tunj_Kinerja AS DECIMAL(10,2)) +
            CAST(tt.Tunj_Umum AS DECIMAL(10,2)) +
            CAST(tt.Tunj_Istri AS DECIMAL(10,2)) +
            CAST(tt.Tunj_Anak AS DECIMAL(10,2)) +
            CAST(tt.Tunj_Kepala_Sekolah AS DECIMAL(10,2)) +
            CAST(tt.Tunj_Wali_Kelas AS DECIMAL(10,2))) as total_expense
      FROM teachers t
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      LEFT JOIN temp_teachers tt ON t.nama = tt.Nama
      WHERE t.status_aktif = 1
    `;
    let expenseParams = [];

    if (tenantId) {
      expenseQuery += ' AND ta.tenant_id = ?';
      expenseParams.push(tenantId);
    }

    const expenseResult = await db.query(expenseQuery, expenseParams);

    const totalIncome = parseFloat(incomeResult[0]?.total_income) || 0;
    const totalExpense = parseFloat(expenseResult[0]?.total_expense) || 0;

    res.json({
      success: true,
      month,
      report: {
        total_pemasukan: totalIncome,
        total_pengeluaran: totalExpense,
        saldo: totalIncome - totalExpense,
        breakdown: {
          spp_masuk: totalIncome,
          gaji_guru: totalExpense,
          honor_bendahara: 0
        }
      }
    });
  } catch (error) {
    console.error('Treasurer financial report error:', error);
    res.status(500).json({ success: false, message: 'Error fetching financial report' });
  }
});

// GET /api/treasurer/teachers-with-evaluation - Guru dengan nilai evaluasi untuk tunjangan
router.get('/treasurer/teachers-with-evaluation', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    const month = req.query.month || new Date().toISOString().slice(0, 7);

    if (req.user.role !== 'admin' && !tenantId) {
      const treasurerAssignments = (req.user.assignments || []).filter(a => {
        const roles = ['bendahara', 'tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (treasurerAssignments.length === 1) {
        tenantId = treasurerAssignments[0].tenant_id;
      }
    }

    if (tenantId && !verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    let query = `
      SELECT 
        t.id,
        t.nama,
        t.nip,
        ta.jabatan_di_unit,
        tn.nama_sekolah,
        tt.Gaji_Pokok,
        tt.Tunj_Kinerja,
        e.score,
        e.category,
        e.evaluation_date
      FROM teachers t
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      JOIN tenants tn ON ta.tenant_id = tn.tenant_id
      LEFT JOIN temp_teachers tt ON t.nama = tt.Nama
      LEFT JOIN evaluations e ON t.id = e.teacher_id 
        AND e.category IN ('kehadiran', 'disiplin', 'profesionalisme', 'komunikasi', 'kepemimpinan')
      WHERE t.status_aktif = 1
    `;
    let params = [];

    if (tenantId) {
      query += ' AND ta.tenant_id = ?';
      params.push(tenantId);
    }

    query += ' ORDER BY t.nama ASC';
    const teachers = await db.query(query, params);

    res.json({
      success: true,
      month,
      data: teachers.map(t => {
        const baseTunjangan = (
          (parseFloat(t.Tunj_Kinerja) || 0) *
          (t.score ? (t.score / 5) : 1)
        );
        return {
          teacher_id: t.id,
          nama: t.nama,
          nip: t.nip,
          jabatan: t.jabatan_di_unit,
          sekolah: t.nama_sekolah,
          gaji_pokok: parseFloat(t.Gaji_Pokok) || 0,
          tunjangan_kinerja_base: parseFloat(t.Tunj_Kinerja) || 0,
          tunjangan_kinerja_aktual: Math.round(baseTunjangan),
          score: t.score || null,
          evaluation_category: t.category || null
        };
      })
    });
  } catch (error) {
    console.error('Treasurer teachers with evaluation error:', error);
    res.status(500).json({ success: false, message: 'Error fetching teachers data' });
  }
});

// GET /api/treasurer/payment-defaulters - Siswa yang belum bayar SPP
router.get('/treasurer/payment-defaulters', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;

    // User YPWILUTIM boleh lihat semua tenant
    if (req.user.role === 'guru') {
      const hasYPWILUTIM = req.user.assignments?.some(a => a.tenant_id === 'YPWILUTIM');
      if (hasYPWILUTIM) tenantId = null;
    }

    if (tenantId && !verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    let query = `
      SELECT s.id, s.nama_siswa, s.nisn, s.iuran_bulanan, tn.nama_sekolah, p.no_wa
      FROM students s
      JOIN tenants tn ON s.tenant_id = tn.tenant_id
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE s.iuran_bulanan = 0 OR s.iuran_bulanan IS NULL
    `;
    let params = [];

    if (tenantId) {
      query += ' AND s.tenant_id = ?';
      params.push(tenantId);
    }

    query += ' ORDER BY tn.nama_sekolah ASC, s.nama_siswa ASC';
    const defaulters = await db.query(query, params);

    res.json({
      success: true,
      data: defaulters
    });
  } catch (error) {
    console.error('Treasurer payment defaulters error:', error);
    res.status(500).json({ success: false, message: 'Error fetching payment defaulters' });
  }
});

// PDF Slip Gaji
router.get('/treasurer/public/salary-slip-pdf/:teacherId', async (req, res) => {
  try {
    const teacherId = req.params.teacherId;
    const month = req.query.month || new Date().toISOString().slice(0, 7);

    const query = `
      SELECT t.id, t.nama, t.nip, ta.jabatan_di_unit, tn.nama_sekolah, tn.tenant_id,
        tt.Gaji_Pokok, tt.Tunj_Kinerja, tt.Tunj_Umum, tt.Tunj_Istri, tt.Tunj_Anak,
        tt.Tunj_Kepala_Sekolah, tt.Tunj_Wali_Kelas, tt.Honor_Bendahara
      FROM teachers t
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      JOIN tenants tn ON ta.tenant_id = tn.tenant_id
      LEFT JOIN temp_teachers tt ON t.nama = tt.Nama
      WHERE t.id = ?
    `;
    const [teacher] = await db.query(query, [teacherId]);

    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
    }

    const gaji = parseFloat(teacher.Gaji_Pokok) || 0;
    const tunjangan = (
      (parseFloat(teacher.Tunj_Kinerja) || 0) +
      (parseFloat(teacher.Tunj_Umum) || 0) +
      (parseFloat(teacher.Tunj_Istri) || 0) +
      (parseFloat(teacher.Tunj_Anak) || 0) +
      (parseFloat(teacher.Tunj_Kepala_Sekolah) || 0) +
      (parseFloat(teacher.Tunj_Wali_Kelas) || 0)
    );
    const honor = parseFloat(teacher.Honor_Bendahara) || 0;
    const total = gaji + tunjangan;

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=slip_gaji_${teacher.nama}_${month}.pdf`);

    doc.pipe(res);

    doc.fontSize(20).text('Slip Gaji Guru', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).text(`Nama: ${teacher.nama}`);
    doc.text(`NIP: ${teacher.nip || '-'}`);
    doc.text(`Jabatan: ${teacher.jabatan_di_unit}`);
    doc.text(`Sekolah: ${teacher.nama_sekolah}`);
    doc.moveDown();

    doc.text('Rincian Gaji:', { underline: true });
    doc.text(`Gaji Pokok: Rp ${(gaji || 0).toLocaleString('id-ID')}`);
    doc.text(`Tunjangan: Rp ${(tunjangan || 0).toLocaleString('id-ID')}`);
    doc.text(`Honor Bendahara: Rp ${(honor || 0).toLocaleString('id-ID')}`);
    doc.moveDown();

    doc.fontSize(14).text(`Total Gaji: Rp ${(total || 0).toLocaleString('id-ID')}`, { align: 'right' });
    doc.moveDown(2);
    doc.text(`Bulan: ${month}`, { align: 'right' });
    doc.text(`Tanggal: ${new Date().toLocaleDateString('id-ID')}`, { align: 'right' });

    doc.end();
  } catch (error) {
    console.error('PDF slip error:', error);
    res.status(500).json({ success: false, message: 'Error generating PDF' });
  }
});

// Send salary slip email
router.post('/treasurer/public/send-salary-slip-email', async (req, res) => {
  try {
    const { teacherId, month } = req.body;

    if (!teacherId) {
      return res.status(400).json({ success: false, message: 'teacherId required' });
    }

    const nodemailer = require('nodemailer');

    const query = `
      SELECT t.id, t.nama, t.nip, t.email, ta.jabatan_di_unit, tn.nama_sekolah,
        tt.Gaji_Pokok, tt.Tunj_Kinerja, tt.Tunj_Umum, tt.Tunj_Istri, tt.Tunj_Anak,
        tt.Tunj_Kepala_Sekolah, tt.Tunj_Wali_Kelas, tt.Honor_Bendahara
      FROM teachers t
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      JOIN tenants tn ON ta.tenant_id = tn.tenant_id
      LEFT JOIN temp_teachers tt ON t.nama = tt.Nama
      WHERE t.id = ?
    `;
    const [teacher] = await db.query(query, [teacherId]);

    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
    }

    const gaji = parseFloat(teacher.Gaji_Pokok) || 0;
    const tunjangan = (
      (parseFloat(teacher.Tunj_Kinerja) || 0) +
      (parseFloat(teacher.Tunj_Umum) || 0) +
      (parseFloat(teacher.Tunj_Istri) || 0) +
      (parseFloat(teacher.Tunj_Anak) || 0) +
      (parseFloat(teacher.Tunj_Kepala_Sekolah) || 0) +
      (parseFloat(teacher.Tunj_Wali_Kelas) || 0)
    );
    const honor = parseFloat(teacher.Honor_Bendahara) || 0;
    const total = gaji + tunjangan;

    console.log('Processing salary slip for:', teacher.nama, 'Email:', teacher.email);

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="https://app.ypwilutim.com/assets/images/header-yayasan.png" width="500" style="max-width: 100%;">
        </div>
        <h2 style="color: #059669; text-align: center;">Slip Gaji Guru</h2>
        <p>Assalamu'alaikum Bapak/Ibu ${teacher.nama},</p>
        <p>Berikut slip gaji untuk bulan ${month || new Date().toISOString().slice(0, 7)}:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0; border: 2px solid #059669;">
          <tr style="background: #f3f4f6;">
            <td style="padding: 10px; border: 1px solid #ddd;">Keterangan</td>
            <td style="padding: 10px; border: 1px solid #ddd; text-align: right;">Jumlah</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">Gaji Pokok</td>
            <td style="padding: 10px; border: 1px solid #ddd; text-align: right;">Rp ${(gaji || 0).toLocaleString('id-ID')}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">Tunjangan</td>
            <td style="padding: 10px; border: 1px solid #ddd; text-align: right;">Rp ${(tunjangan || 0).toLocaleString('id-ID')}</td>
          </tr>
          ${honor > 0 ? `<tr><td style="padding: 10px; border: 1px solid #ddd;">Honor Bendahara</td><td style="padding: 10px; border: 1px solid #ddd; text-align: right;">Rp ${honor.toLocaleString('id-ID')}</td></tr>` : ''}
          <tr style="background: #dcfce7;">
            <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Total Gaji</td>
            <td style="padding: 10px; border: 1px solid #ddd; text-align: right; font-weight: bold; color: #059669;">Rp ${(total || 0).toLocaleString('id-ID')}</td>
          </tr>
        </table>
        <hr style="border: 1px solid #ddd; margin: 20px 0;">
        <p style="font-size: 12px; color: #666;">Hormat kami,<br><strong>Yayasan Pendidikan Wahdah Islamiyah Luwu Timur</strong></p>
      </div>
    `;

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50 });
    const pdfChunks = [];

    doc.on('data', chunk => pdfChunks.push(chunk));
    doc.on('end', () => { });

    // Header image
    const fs = require('fs');
    const path = require('path');
    try {
      const headerPath = path.join(__dirname, '../../template/header-yayasan.png');
      if (fs.existsSync(headerPath)) {
        doc.image(headerPath, 50, 30, { width: 500 });
        doc.moveDown(4);
      }
    } catch (e) { }

    doc.fontSize(16).fillColor('#059669').text('SLIP GAJI GURU', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Nama: ${teacher.nama}`);
    doc.text(`NIP: ${teacher.nip || '-'}`);
    doc.text(`Jabatan: ${teacher.jabatan_di_unit}`);
    doc.text(`Sekolah: ${teacher.nama_sekolah}`);
    doc.moveDown();
    doc.text('Rincian Gaji:');
    doc.text(`Gaji Pokok: Rp ${(gaji || 0).toLocaleString('id-ID')}`);
    doc.text(`Tunjangan: Rp ${(tunjangan || 0).toLocaleString('id-ID')}`);
    if (honor > 0) doc.text(`Honor: Rp ${honor.toLocaleString('id-ID')}`);
    doc.moveDown();
    doc.fontSize(14).text(`Total: Rp ${(total || 0).toLocaleString('id-ID')}`, { align: 'right' });

    doc.end();

    await new Promise(resolve => doc.on('end', resolve));

    const pdfBuffer = Buffer.concat(pdfChunks);
    console.log('PDF size:', pdfBuffer.length);

    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'mail.ypwilutim.com',
      port: parseInt(process.env.EMAIL_PORT) || 465,
      secure: true,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });

    try {
      const info = await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: teacher.email,
        subject: `Slip Gaji ${month || new Date().toISOString().slice(0, 7)}`,
        html: htmlBody,
        attachments: [{
          filename: `slip_gaji_${teacher.nama.replace(/\s+/g, '_')}.pdf`,
          content: pdfBuffer
        }]
      });
      console.log('Email terkirim, messageId:', info.messageId);
      res.json({ success: true, message: 'Email terkirim ke ' + teacher.email });
    } catch (emailError) {
      console.error('Email send error:', emailError);
      return res.status(500).json({ success: false, message: 'Gagal kirim email: ' + emailError.message });
    }
  } catch (error) {
    console.error('Email slip error:', error);
    res.status(500).json({ success: false, message: 'Error sending email' });
  }
});

// Test email endpoint
router.get('/treasurer/public/test-email', async (req, res) => {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'mail.ypwilutim.com',
      port: parseInt(process.env.EMAIL_PORT) || 465,
      secure: true,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });

    const testResult = await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: 'test@example.com',
      subject: 'Test Email',
      text: 'Test SMTP connection'
    });

    res.json({ success: true, messageId: testResult.messageId });
  } catch (error) {
    console.error('Test email error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/treasurer/gateway/settings', authenticateOperator, async (req, res) => {
  try {
    const { tenant_id, gateway, enabled, api_key, client_key, config } = req.body
    if (!tenant_id || !gateway) return res.status(400).json({ success: false, message: 'tenant_id dan gateway required' })
    if (!verifyTenantAccess(req, tenant_id)) return res.status(403).json({ success: false, message: 'Akses ditolak' })
    const gwConfig = { ...(config || {}), va_prefix: gateway === 'bsi_manual' ? (config?.va_prefix || '2231') : undefined }
    const [existing] = await db.query('SELECT id FROM payment_gateways WHERE tenant_id = ? AND gateway = ?', [tenant_id, gateway])
    if (existing) {
      await db.query('UPDATE payment_gateways SET is_active = ?, api_key = ?, client_key = ?, config = ? WHERE tenant_id = ? AND gateway = ?', [enabled ? 1 : 0, api_key || null, client_key || null, JSON.stringify(gwConfig), tenant_id, gateway])
    } else {
      await db.query('INSERT INTO payment_gateways (tenant_id, gateway, is_active, api_key, client_key, config) VALUES (?, ?, ?, ?, ?, ?)', [tenant_id, gateway, enabled ? 1 : 0, api_key || null, client_key || null, JSON.stringify(gwConfig)])
    }
    res.json({ success: true, message: `Gateway ${gateway} ${enabled ? 'diaktifkan' : 'dinonaktifkan'}` })
  } catch (error) {
    console.error('Update gateway settings error:', error)
    res.status(500).json({ success: false, message: 'Error updating gateway settings' })
  }
})

router.get('/treasurer/gateway/settings', authenticateOperator, async (req, res) => {
  try {
    const tenant_id = req.query.tenant_id
    if (!tenant_id) return res.status(400).json({ success: false, message: 'tenant_id required' })
    if (!verifyTenantAccess(req, tenant_id)) return res.status(403).json({ success: false, message: 'Akses ditolak' })
    let gateways = await db.query('SELECT gateway, is_active, api_key, client_key, config FROM payment_gateways WHERE tenant_id = ? ORDER BY gateway ASC', [tenant_id])
    if (!gateways || gateways.length === 0) {
      const defaultGateways = ['midtrans', 'xendit', 'bsi_manual', 'doku']
      for (const gw of defaultGateways) {
        await db.query('INSERT IGNORE INTO payment_gateways (tenant_id, gateway, is_active) VALUES (?, ?, 0)', [tenant_id, gw])
      }
      gateways = await db.query('SELECT gateway, is_active, api_key, client_key, config FROM payment_gateways WHERE tenant_id = ? ORDER BY gateway ASC', [tenant_id])
    }
    res.json({ success: true, data: gateways })
  } catch (error) {
    console.error('Get gateway settings error:', error)
    res.status(500).json({ success: false, message: 'Error fetching gateway settings' })
  }
})

router.get('/treasurer/bsi/template', authenticateOperator, async (req, res) => {
  try {
    const fs = require('fs')
    const path = require('path')
    const templatePath = path.join(__dirname, '../../template/BSI/BULK_VA_Transaction_Template.csv')
    if (fs.existsSync(templatePath)) {
      const csv = fs.readFileSync(templatePath, 'utf8')
      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', 'attachment; filename=BULK_VA_Template.csv')
      res.send(csv)
    } else {
      res.status(404).json({ success: false, message: 'Template tidak ditemukan' })
    }
  } catch (error) {
    console.error('Get BSI template error:', error)
    res.status(500).json({ success: false, message: 'Error getting template' })
  }
})

router.get('/treasurer/bsi/export', authenticateOperator, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id
    let vaPrefix = '2231'
    const [gw] = await db.query('SELECT config FROM payment_gateways WHERE tenant_id = ? AND gateway = ? AND is_active = 1', [tenantId || 'YPWILUTIM', 'bsi_manual'])
    if (gw && gw.config) {
      try { const cfg = JSON.parse(gw.config); vaPrefix = cfg.va_prefix || '2231' } catch (e) { }
    }
    let query = 'SELECT pt.*, s.nama_siswa, s.nisn FROM payment_transactions pt LEFT JOIN students s ON pt.student_id = s.id WHERE gateway = ?'
    const params = ['bsi_manual']
    if (tenantId) { query += ' AND pt.tenant_id = ?'; params.push(tenantId) }
    query += ' ORDER BY pt.created_at DESC LIMIT 500'
    const [transactions] = await db.query(query, params)
    const header = 'Type,Parent Account,Virtual Account Number,Virtual Account Name,Amount,Remark,Transaction Date'
    const rows = (transactions || []).map(t => [
      'Debit', '', (vaPrefix + (t.external_id || '')), t.nama_siswa || '', t.amount, t.description || '', t.paid_at || ''
    ].map(v => `"${v || ''}"`).join(','))
    res.setHeader('Content-Type', 'text/csv')
    res.send([header, ...rows].join('\n'))
  } catch (error) {
    console.error('Export BSI error:', error)
    res.status(500).json({ success: false, message: 'Error exporting BSI data' })
  }
})

router.get('/treasurer/public/tenants', async (req, res) => {
  try {
    const tenants = await db.query('SELECT tenant_id, nama_sekolah FROM tenants ORDER BY nama_sekolah');
    res.json({ success: true, data: tenants });
  } catch (error) {
    console.error('Get tenants error:', error)
    res.status(500).json({ success: false, message: 'Gagal ambil data sekolah' });
  }
})

// GET /api/treasurer/bendahara/profile - Profil bendahara (akses terbatas)
// Hanya role admin ATAU guru dengan assignment YPWILUTIM jabatan bendahara/admin
router.get('/treasurer/bendahara/profile', authenticateBendahara, async (req, res) => {
  try {
    const user = req.user;
    res.json({
      success: true,
      data: {
        role: user.role,
        guru_id: user.guru_id || null,
        name: user.name || (user.assignments && user.assignments[0] && user.assignments[0].nama_sekolah) || 'Bendahara',
        assignments: user.assignments || []
      }
    });
  } catch (error) {
    console.error('Bendahara profile error:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat profil bendahara' });
  }
});

// GET /api/treasurer/bendahara/search-students - Cari siswa langsung dari tabel students (tanpa billing)
router.get('/treasurer/bendahara/search-students', authenticateBendahara, async (req, res) => {
  try {
    const search = req.query.q || '';
    if (!search || search.length < 2) {
      return res.json({ success: false, message: 'Kata kunci minimal 2 karakter' });
    }
    
    const [students] = await db.query(`
      SELECT s.id, s.nama_siswa, s.nisn, s.tenant_id, s.iuran_bulanan, tn.nama_sekolah, s.va_number
      FROM students s
      JOIN tenants tn ON s.tenant_id = tn.tenant_id
      WHERE (s.nama_siswa LIKE ? OR s.nisn LIKE ?) AND (s.status = 'active' OR s.status = 'aktif' OR s.status IS NULL)
      ORDER BY s.nama_siswa ASC
      LIMIT 50
    `, ['%' + search + '%', '%' + search + '%']);
    
    res.json({ success: true, data: students });
  } catch (e) {
    console.error('Search students error:', e);
    res.status(500).json({ success: false, message: 'Gagal mencari siswa' });
  }
});

// GET /api/treasurer/bendahara/saldo - Saldo berjalan siswa (tunggakan / kelebihan) — baca dari billing_payment + incoming_payments
router.get('/treasurer/bendahara/saldo', authenticateBendahara, async (req, res) => {
  try {
    try {
      await billing.ensureBillingTables();
    } catch (e) {
      console.error('ensureBillingTables error:', e.message);
    }

    const tenantId = req.query.tenant_id || '';
    const statusFilter = req.query.status || ''; // 'tunggakan' | 'kelebihan' | '' (semua)
    const search = req.query.search || ''; // Cari nama_siswa atau nisn
    const limit = parseInt(req.query.limit) || 500;
    const page = parseInt(req.query.page) || 1;

    // Handle 'all' for tenant filter - show all schools
    let effectiveTenantId = tenantId;
    if (tenantId === 'all' || !tenantId) {
      effectiveTenantId = null;
    }

    let where = 'WHERE 1=1';
    const params = [];
    if (effectiveTenantId) { where += ' AND s.tenant_id = ?'; params.push(effectiveTenantId); }

    if (statusFilter === 'tunggakan') { where += ' AND COALESCE(ss.saldo, 0) < 0'; }
    else if (statusFilter === 'kelebihan') { where += ' AND COALESCE(ss.saldo, 0) > 0'; }
    else if (statusFilter === 'lunas') { where += ' AND COALESCE(ss.saldo, 0) = 0'; }

    // Tambahkan filter pencarian
    if (search) {
      where += ' AND (s.nama_siswa LIKE ? OR s.nisn LIKE ?)';
      params.push('%' + search + '%', '%' + search + '%');
    }

    const query = `
      SELECT s.id, s.nama_siswa, s.nisn, s.tenant_id, tn.nama_sekolah,
        s.iuran_bulanan, COALESCE(ss.saldo, 0) as saldo, c.nama_kelas, c.tingkatan
      FROM students s
      JOIN tenants tn ON s.tenant_id = tn.tenant_id
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN saldo_siswa ss ON ss.student_id = s.id
      ${where}
      ORDER BY saldo ASC
      LIMIT ? OFFSET ?
    `;
    const data = await db.query(query, [...params, limit, (page - 1) * limit]);

    // Ringkasan global (dari saldo_siswa) - dengan filter yang sama
    const summaryWhere = search ? ' AND (s.nama_siswa LIKE ? OR s.nisn LIKE ?)' : '';
    const summaryParams = effectiveTenantId ? [effectiveTenantId] : [];
    if (search) summaryParams.push('%' + search + '%', '%' + search + '%');
    
    const tenantWhere = effectiveTenantId ? 'WHERE s.tenant_id = ?' : '';
    const [summary] = await db.query(`
      SELECT
        COUNT(*) as total_siswa,
        COALESCE(SUM(CASE WHEN COALESCE(ss.saldo,0) < 0 THEN -ss.saldo ELSE 0 END), 0) as total_tunggakan,
        COALESCE(SUM(CASE WHEN COALESCE(ss.saldo,0) > 0 THEN ss.saldo ELSE 0 END), 0) as total_kelebihan,
        COUNT(CASE WHEN COALESCE(ss.saldo,0) < 0 THEN 1 END) as jumlah_tunggakan,
        COUNT(CASE WHEN COALESCE(ss.saldo,0) > 0 THEN 1 END) as jumlah_kelebihan
      FROM students s
      LEFT JOIN saldo_siswa ss ON ss.student_id = s.id
      ${tenantWhere}${search ? summaryWhere : ''}
    `, [...summaryParams]);

    res.json({
      success: true,
      total: summary.total_siswa,
      data: data.map(d => ({
        ...d,
        saldo: parseFloat(d.saldo) || 0,
        iuran_bulanan: parseFloat(d.iuran_bulanan) || 0
      })),
      summary: {
        total_siswa: summary.total_siswa || 0,
        total_tunggakan: summary.total_tunggakan || 0,
        total_kelebihan: summary.total_kelebihan || 0,
        jumlah_tunggakan: summary.jumlah_tunggakan || 0,
        jumlah_kelebihan: summary.jumlah_kelebihan || 0
      },
      pagination: { page, limit }
    });
  } catch (error) {
    console.error('Bendahara saldo error:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil saldo siswa' });
  }
});

// POST /api/treasurer/bendahara/billing/generate - Generate billing dari tahun_masuk ke bulan ini
router.post('/treasurer/bendahara/billing/generate', authenticateBendahara, async (req, res) => {
  try {
    await billing.ensureBillingTables();
    const { tenant_id } = req.body;
    
    // If tenant_id is provided, generate for that tenant only
    // Otherwise, generate for all tenants
    if (tenant_id) {
      const result = await billing.generateBilling(tenant_id);
      res.json({
        success: true,
        message: `Billing dibuat: ${result.created} baris, ${result.skipped} dilewati`,
        created: result.created,
        skipped: result.skipped
      });
    } else {
      // Generate for all tenants
      const tenants = await db.query('SELECT tenant_id, nama_sekolah FROM tenants');
      let totalCreated = 0;
      let totalSkipped = 0;
      const details = [];
      
      for (const tenant of tenants) {
        try {
          const result = await billing.generateBilling(tenant.tenant_id);
          totalCreated += result.created;
          totalSkipped += result.skipped;
          details.push({
            tenant_id: tenant.tenant_id,
            nama_sekolah: tenant.nama_sekolah,
            created: result.created,
            skipped: result.skipped
          });
        } catch (err) {
          console.error(`[BILLING] Failed for tenant ${tenant.tenant_id}:`, err.message);
          details.push({
            tenant_id: tenant.tenant_id,
            nama_sekolah: tenant.nama_sekolah,
            error: err.message
          });
        }
      }
      
      res.json({
        success: true,
        message: `Billing dibuat untuk ${tenants.length} sekolah: ${totalCreated} baris, ${totalSkipped} dilewati`,
        total_created: totalCreated,
        total_skipped: totalSkipped,
        tenants_processed: tenants.length,
        details: details
      });
    }
  } catch (error) {
    console.error('Generate billing error:', error);
    res.status(500).json({ success: false, message: 'Gagal generate billing' });
  }
});

// POST /api/treasurer/bendahara/billing/generate-student - Generate billing for specific student
router.post('/treasurer/bendahara/billing/generate-student', authenticateBendahara, async (req, res) => {
  try {
    await billing.ensureBillingTables();
    const { student_id, bulan, spp_bulanan } = req.body;
    
    if (!student_id || !bulan) {
      return res.status(400).json({ success: false, message: 'student_id dan bulan wajib' });
    }

    const [student] = await db.query('SELECT id, tenant_id, iuran_bulanan, va_number, subsidi FROM students WHERE id = ?', [student_id]);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }

    const spp = spp_bulanan !== undefined ? parseFloat(spp_bulanan) : parseFloat(student.iuran_bulanan) || 0;
    const transport = parseFloat(student.ransportasi) || 0;
    const subsidiAmount = parseFloat(student.subsidi) || 0;

    // Get biaya admin VA dari global payment_admin_settings (berlaku untuk semua)
    let biayaAdminVa = 0;
    if (student.va_number) {
      const psResult = await db.query(
        'SELECT biaya_admin_va FROM payment_admin_settings WHERE subject_type = ? AND subject_id = ?',
        ['global', 0]
      );
      const ps = Array.isArray(psResult) ? psResult[0] : psResult;
      if (ps) {
        biayaAdminVa = parseFloat(ps.biaya_admin_va) || 0;
      }
    }

    // Check if billing already exists
    const [existing] = await db.query('SELECT id FROM billing_payment WHERE student_id = ? AND bulan = ?', [student_id, bulan]);

    if (existing) {
      // Update existing
      await db.query(
        'UPDATE billing_payment SET spp_bulanan = ?, ransportasi = ?, subsidi = ?, biaya_admin_va = ?, keterangan_spp = ?, status = "belum" WHERE id = ?',
        [spp, transport, subsidiAmount, biayaAdminVa, spp + transport - subsidiAmount, existing.id]
      );
      await billing.recalcStudent(student_id);
      res.json({
        success: true,
        message: `Billing ${bulan} untuk ${student_id} diupdate`,
        action: 'updated'
      });
    } else {
      // Create new
      await db.query(
        'INSERT INTO billing_payment (tenant_id, student_id, spp_bulanan, ransportasi, subsidi, biaya_admin_va, bulan, transaksi, keterangan_spp, status) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, "belum")',
        [student.tenant_id, student_id, spp, transport, subsidiAmount, biayaAdminVa, bulan, spp + transport - subsidiAmount]
      );
      await billing.recalcStudent(student_id);
      res.json({
        success: true,
        message: `Billing ${bulan} untuk ${student_id} dibuat`,
        action: 'created'
      });
    }
  } catch (error) {
    console.error('Generate student billing error:', error);
    res.status(500).json({ success: false, message: 'Gagal generate billing siswa' });
  }
});

// POST /api/treasurer/bendahara/billing/recalc - Hitung ulang saldo semua siswa di tenant
router.post('/treasurer/bendahara/billing/recalc', authenticateBendahara, async (req, res) => {
  try {
    await billing.ensureBillingTables();
    const { tenant_id } = req.body;
    
    if (tenant_id) {
      const result = await billing.recalcTenant(tenant_id);
      res.json({
        success: true,
        message: `Saldo dihitung ulang untuk ${result.updated} siswa`,
        updated: result.updated
      });
    } else {
      // Recalc for all tenants
      const tenants = await db.query('SELECT tenant_id, nama_sekolah FROM tenants');
      let totalUpdated = 0;
      const details = [];
      
      for (const tenant of tenants) {
        try {
          const result = await billing.recalcTenant(tenant.tenant_id);
          totalUpdated += result.updated;
          details.push({
            tenant_id: tenant.tenant_id,
            nama_sekolah: tenant.nama_sekolah,
            updated: result.updated
          });
        } catch (err) {
          console.error(`[RECALC] Failed for tenant ${tenant.tenant_id}:`, err.message);
          details.push({
            tenant_id: tenant.tenant_id,
            nama_sekolah: tenant.nama_sekolah,
            error: err.message
          });
        }
      }
      
      res.json({
        success: true,
        message: `Saldo dihitung ulang untuk ${tenants.length} sekolah: ${totalUpdated} siswa`,
        total_updated: totalUpdated,
        tenants_processed: tenants.length,
        details: details
      });
    }
  } catch (error) {
    console.error('Student billing error:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil data billing siswa' });
  }
});

// GET /api/treasurer/bendahara/billing/month?tenant_id=XXX&bulan=2026-09&search=keyword - Get billing for specific month
router.get('/treasurer/bendahara/billing/month', authenticateBendahara, async (req, res) => {
  try {
    await billing.ensureBillingTables();
    const { tenant_id, bulan, search } = req.query;
    
    if (!bulan || !/^\d{4}-\d{2}$/.test(bulan)) {
      return res.status(400).json({ success: false, message: 'Format bulan tidak benar (YYYY-MM)' });
    }

    let query = `
      SELECT 
        bp.id as billing_id,
        bp.student_id,
        bp.bulan,
        bp.spp_bulanan,
        bp.subsidi,
        bp.transaksi,
        bp.keterangan_spp,
        bp.status,
        bp.catatan,
        bp.metode_pembayaran,
        bp.tanggal_bayar,
        bp.dibayar_oleh,
        bp.catatan_pelunasan,
        s.nama_siswa,
        s.nisn,
        s.iuran_bulanan,
        s.ransportasi,
        s.tenant_id,
        s.tahun_masuk,
        s.va_number,
        tn.nama_sekolah,
        COALESCE(ss.saldo, 0) as saldo
      FROM billing_payment bp
      JOIN students s ON bp.student_id = s.id
      LEFT JOIN saldo_siswa ss ON s.id = ss.student_id
      LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id
      WHERE bp.bulan = ?
        AND (s.status = 'active' OR s.status = 'aktif' OR s.status IS NULL)
    `;
    const params = [bulan];

    if (tenant_id) {
      query += ' AND s.tenant_id = ?';
      params.push(tenant_id);
    }

    if (search) {
      query += ' AND (s.nama_siswa LIKE ? OR s.nisn LIKE ? OR s.va_number LIKE ? OR tn.nama_sekolah LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }

    query += ' ORDER BY s.nama_siswa ASC';
    const billings = await db.query(query, params);

    // Get students who don't have billing for this month
    let missingQuery = `
      SELECT 
        s.id as student_id,
        s.nama_siswa,
        s.nisn,
        s.iuran_bulanan,
        s.ransportasi,
        s.subsidi,
        s.tenant_id,
        s.tahun_masuk,
        s.va_number,
        tn.nama_sekolah
      FROM students s
      LEFT JOIN billing_payment bp ON s.id = bp.student_id AND bp.bulan = ?
      LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id
      WHERE bp.id IS NULL
        AND (s.status = 'active' OR s.status = 'aktif' OR s.status IS NULL)
    `;
    const missingParams = [bulan];

    if (tenant_id) {
      missingQuery += ' AND s.tenant_id = ?';
      missingParams.push(tenant_id);
    }

    if (search) {
      missingQuery += ' AND (s.nama_siswa LIKE ? OR s.nisn LIKE ? OR s.va_number LIKE ? OR tn.nama_sekolah LIKE ?)';
      const like = `%${search}%`;
      missingParams.push(like, like, like, like);
    }

    missingQuery += ' ORDER BY s.nama_siswa ASC';
    const missingStudents = await db.query(missingQuery, missingParams);

    res.json({
      success: true,
      data: {
        bulan: bulan,
        existing: billings.map(b => ({
          billing_id: b.billing_id,
          student_id: b.student_id,
          nama_siswa: b.nama_siswa,
          nisn: b.nisn,
          spp_bulanan: parseFloat(b.spp_bulanan) || 0,
          subsidi: parseFloat(b.subsidi) || 0,
          transaksi: parseFloat(b.transaksi) || 0,
          keterangan_spp: parseFloat(b.keterangan_spp) || 0,
          status: b.status,
          catatan: b.catatan,
          metode_pembayaran: b.metode_pembayaran,
          tanggal_bayar: b.tanggal_bayar,
          dibayar_oleh: b.dibayar_oleh,
          catatan_pelunasan: b.catatan_pelunasan,
          iuran_bulanan: parseFloat(b.iuran_bulanan) || 0,
          ransportasi: parseFloat(b.ransportasi) || 0,
          tahun_masuk: b.tahun_masuk,
          saldo: parseFloat(b.saldo) || 0,
          va_number: b.va_number,
          nama_sekolah: b.nama_sekolah
        })),
        missing: missingStudents.map(s => ({
          student_id: s.student_id,
          nama_siswa: s.nama_siswa,
          nisn: s.nisn,
          iuran_bulanan: parseFloat(s.iuran_bulanan) || 0,
          ransportasi: parseFloat(s.ransportasi) || 0,
          subsidi: parseFloat(s.subsidi) || 0,
          tahun_masuk: s.tahun_masuk,
          va_number: s.va_number,
          nama_sekolah: s.nama_sekolah
        }))
      }
    });
  } catch (error) {
    console.error('Get billing month error:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil data billing bulan' });
  }
});

// PUT /api/treasurer/bendahara/billing/update - Update billing (subsidi/potongan)
router.put('/treasurer/bendahara/billing/update', authenticateBendahara, async (req, res) => {
  try {
    await billing.ensureBillingTables();
    const { billing_id, spp_bulangan, subsidi, catatan } = req.body;

    if (!billing_id) {
      return res.status(400).json({ success: false, message: 'billing_id wajib' });
    }

    // Get current billing
    const [current] = await db.query('SELECT * FROM billing_payment WHERE id = ?', [billing_id]);
    if (!current) {
      return res.status(404).json({ success: false, message: 'Billing tidak ditemukan' });
    }

    const newSpp = spp_bulangan !== undefined ? parseFloat(spp_bulangan) : parseFloat(current.spp_bulanan);
    const subsidiAmount = subsidi ? parseFloat(subsidi) : 0;
    const ransportasiAmount = ransportasi !== undefined ? parseFloat(ransportasi) : (parseFloat(current.ransportasi) || 0);
    const finalSpp = Math.max(0, newSpp + ransportasiAmount - subsidiAmount);

    // Update billing
    await db.query(
      `UPDATE billing_payment
       SET spp_bulanan = ?, ransportasi = ?, subsidi = ?, keterangan_spp = ?, catatan = ?
       WHERE id = ?`,
      [newSpp, ransportasiAmount, subsidiAmount, finalSpp, catatan || null, billing_id]
    );

    // Recalc student balance
    await billing.recalcStudent(current.student_id);

    res.json({
      success: true,
      message: 'Billing berhasil diupdate',
      data: {
        billing_id: billing_id,
        student_id: current.student_id,
        bulan: current.bulan,
        spp_bulanan: finalSpp,
        subsidi: subsidiAmount
      }
    });
  } catch (error) {
    console.error('Update billing error:', error);
    res.status(500).json({ success: false, message: 'Gagal update billing' });
  }
});

// PUT /api/treasurer/bendahara/billing/update-iuran - Update iuran_bulanan siswa
router.put('/treasurer/bendahara/billing/update-iuran', authenticateBendahara, async (req, res) => {
  try {
    const { student_id, iuran_bulanan } = req.body;

    if (!student_id || iuran_bulanan === undefined) {
      return res.status(400).json({ success: false, message: 'student_id dan iuran_bulanan wajib' });
    }

    const [student] = await db.query('SELECT id, nama_siswa, iuran_bulanan, ransportasi FROM students WHERE id = ?', [student_id]);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }

    const oldIuran = parseFloat(student.iuran_bulanan) || 0;
    const newIuran = parseFloat(iuran_bulanan) || 0;
    const transport = parseFloat(student.ransportasi) || 0;

    // Update iuran in students table
    await db.query('UPDATE students SET iuran_bulanan = ? WHERE id = ?', [newIuran, student_id]);

    // Update all future billings for this student
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    await db.query(
      'UPDATE billing_payment SET spp_bulanan = ?, keterangan_spp = ? WHERE student_id = ? AND bulan >= ? AND status = "belum"',
      [newIuran, newIuran + transport, student_id, currentMonth]
    );

    // Recalc student balance
    await billing.recalcStudent(student_id);

    res.json({
      success: true,
      message: `Iuran ${student.nama_siswa} diupdate dari Rp ${oldIuran.toLocaleString('id-ID')} ke Rp ${newIuran.toLocaleString('id-ID')}`,
      data: {
        student_id: student_id,
        nama_siswa: student.nama_siswa,
        iuran_lama: oldIuran,
        iuran_baru: newIuran
      }
    });
  } catch (error) {
    console.error('Update iuran error:', error);
    res.status(500).json({ success: false, message: 'Gagal update iuran' });
  }
});
router.put('/treasurer/bendahara/billing/update-batch', authenticateBendahara, async (req, res) => {
  try {
    await billing.ensureBillingTables();
    const { updates } = req.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ success: false, message: 'Array updates wajib' });
    }

    let updated = 0;
    const details = [];

    for (const update of updates) {
      try {
        const { billing_id, subsidi, catatan } = update;

        if (!billing_id) continue;

        const [current] = await db.query('SELECT * FROM billing_payment WHERE id = ?', [billing_id]);
        if (!current) continue;

        // SPP and Transportasi stay the same - only update subsidi
        const spp = parseFloat(current.spp_bulanan) || 0;
        const transport = parseFloat(current.ransportasi) || 0;
        const subsidiAmount = subsidi !== undefined ? parseFloat(subsidi) : 0;
        const finalTotal = Math.max(0, spp + transport - subsidiAmount);

        await db.query(
          `UPDATE billing_payment
           SET subsidi = ?, keterangan_spp = ?, catatan = ?
           WHERE id = ?`,
          [subsidiAmount, finalTotal, catatan || null, billing_id]
        );

        await billing.recalcStudent(current.student_id);
        updated++;
        details.push({
          billing_id: billing_id,
          student_id: current.student_id,
          bulan: current.bulan,
          spp_bulanan: spp,
          ransportasi: transport,
          subsidi: subsidiAmount,
          keterangan_spp: finalTotal,
          status: 'updated'
        });
      } catch (err) {
        details.push({
          billing_id: update.billing_id,
          error: err.message
        });
      }
    }

    res.json({
      success: true,
      message: `${updated} billing berhasil diupdate`,
      updated: updated,
      details: details
    });
  } catch (error) {
    console.error('Update batch billing error:', error);
    res.status(500).json({ success: false, message: 'Gagal update batch billing' });
  }
});

// POST /api/treasurer/bendahara/billing/create-batch - Create multiple billings for students without billing
router.post('/treasurer/bendahara/billing/create-batch', authenticateBendahara, async (req, res) => {
  try {
    await billing.ensureBillingTables();
    const { bulan, students } = req.body;

    if (!bulan || !Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ success: false, message: 'bulan dan array students wajib' });
    }

    let created = 0;
    const details = [];

    for (const s of students) {
      try {
        const { student_id, subsidi } = s;

        if (!student_id) continue;

        // Check if billing already exists
        const [existing] = await db.query(
          'SELECT id FROM billing_payment WHERE student_id = ? AND bulan = ?',
          [student_id, bulan]
        );

        if (existing) {
          details.push({
            student_id: student_id,
            bulan: bulan,
            status: 'skipped',
            message: 'Billing sudah ada'
          });
          continue;
        }

        // Get SPP, Transportasi, and Subsidi from students table
        const [student] = await db.query(
          'SELECT iuran_bulanan, ransportasi, subsidi, va_number FROM students WHERE id = ?',
          [student_id]
        );

        if (!student) {
          details.push({
            student_id: student_id,
            bulan: bulan,
            status: 'error',
            message: 'Siswa tidak ditemukan'
          });
          continue;
        }

        const spp = parseFloat(student.iuran_bulanan) || 0;
        const transport = parseFloat(student.ransportasi) || 0;
        const subsidiAmount = parseFloat(student.subsidi) || 0;

        // Get biaya admin VA dari global payment_admin_settings (berlaku untuk semua)
        let biayaAdminVa = 0;
        if (student.va_number) {
          const psResult = await db.query(
            'SELECT biaya_admin_va FROM payment_admin_settings WHERE subject_type = ? AND subject_id = ?',
            ['global', 0]
          );
          const ps = Array.isArray(psResult) ? psResult[0] : psResult;
          if (ps) {
            biayaAdminVa = parseFloat(ps.biaya_admin_va) || 0;
          }
        }

        const keterangan = Math.max(0, spp + transport - subsidiAmount);

        await db.query(
          `INSERT INTO billing_payment (student_id, bulan, spp_bulanan, ransportasi, subsidi, biaya_admin_va, keterangan_spp, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'belum')`,
          [student_id, bulan, spp, transport, subsidiAmount, biayaAdminVa, keterangan]
        );

        await billing.recalcStudent(student_id);
        created++;
        details.push({
          student_id: student_id,
          bulan: bulan,
          spp_bulanan: spp,
          ransportasi: transport,
          subsidi: subsidiAmount,
          biaya_admin_va: biayaAdminVa,
          keterangan_spp: keterangan,
          status: 'created'
        });
        details.push({
          student_id: student_id,
          bulan: bulan,
          spp_bulanan: spp,
          ransportasi: transport,
          subsidi: subsidiAmount,
          status: 'created'
        });
      } catch (err) {
        details.push({
          student_id: s.student_id,
          bulan: bulan,
          status: 'error',
          error: err.message
        });
      }
    }

    res.json({
      success: true,
      message: `${created} billing baru berhasil dibuat`,
      created: created,
      details: details
    });
  } catch (error) {
    console.error('Create batch billing error:', error);
    res.status(500).json({ success: false, message: 'Gagal buat batch billing' });
  }
});

// POST /api/treasurer/bendahara/billing/reset - Reset selected billings (delete only if not paid)
router.post('/treasurer/bendahara/billing/reset', authenticateBendahara, async (req, res) => {
  try {
    const { billing_ids } = req.body;
    if (!Array.isArray(billing_ids) || billing_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'billing_ids wajib diisi' });
    }

    const placeholders = billing_ids.map(() => '?').join(',');
    const targetBillings = await db.query(
      `SELECT id, student_id, bulan, status, spp_bulanan, keterangan_spp FROM billing_payment WHERE id IN (${placeholders})`,
      billing_ids
    );

    if (!targetBillings || targetBillings.length === 0) {
      return res.status(404).json({ success: false, message: 'Billing tidak ditemukan' });
    }

    let deleted = 0, skipped = 0;
    const deletedIds = [];
    const skippedDetails = [];

    for (const b of targetBillings) {
      if (b.status === 'lunas') {
        skipped++;
        skippedDetails.push({ billing_id: b.id, reason: 'sudah lunas' });
        continue;
      }
      try {
        await db.query('DELETE FROM billing_payment WHERE id = ?', [b.id]);
        if (b.student_id) {
          await billing.recalcStudent(b.student_id);
        }
        deleted++;
        deletedIds.push(b.id);
      } catch (err) {
        skippedDetails.push({ billing_id: b.id, reason: err.message });
      }
    }

    res.json({
      success: true,
      message: `Berhasil reset ${deleted} billing. ${skipped} dilewati (sudah lunas).`,
      deleted,
      skipped,
      deleted_ids: deletedIds,
      skipped_details: skippedDetails
    });
  } catch (error) {
    console.error('Reset billing error:', error);
    res.status(500).json({ success: false, message: 'Gagal reset billing' });
  }
});

// POST /api/treasurer/bendahara/billing/reset-all - Reset all billings for a month (optionally filtered by tenant)
router.post('/treasurer/bendahara/billing/reset-all', authenticateBendahara, async (req, res) => {
  try {
    const { tenant_id, bulan } = req.body;
    if (!bulan || !/^\d{4}-\d{2}$/.test(bulan)) {
      return res.status(400).json({ success: false, message: 'Format bulan tidak benar (YYYY-MM)' });
    }

    let query = `SELECT bp.id, bp.student_id, bp.status, s.tenant_id FROM billing_payment bp JOIN students s ON bp.student_id = s.id WHERE bp.bulan = ?`;
    const params = [bulan];
    if (tenant_id) {
      query += ' AND s.tenant_id = ?';
      params.push(tenant_id);
    }
    const targetBillings = await db.query(query, params);

    if (!targetBillings || targetBillings.length === 0) {
      return res.json({ success: true, message: 'Tidak ada billing untuk direset', deleted: 0, skipped: 0 });
    }

    let deleted = 0, skipped = 0;
    const affectedStudents = new Set();

    for (const b of targetBillings) {
      if (b.status === 'lunas') {
        skipped++;
        continue;
      }
      try {
        await db.query('DELETE FROM billing_payment WHERE id = ?', [b.id]);
        if (b.student_id) affectedStudents.add(b.student_id);
        deleted++;
      } catch (err) {
        skipped++;
      }
    }

    for (const studentId of affectedStudents) {
      try {
        await billing.recalcStudent(studentId);
      } catch (e) {
        // continue
      }
    }

    res.json({
      success: true,
      message: `Reset selesai: ${deleted} billing dihapus, ${skipped} dilewati (sudah lunas).`,
      deleted,
      skipped,
      total: targetBillings.length
    });
  } catch (error) {
    console.error('Reset all billing error:', error);
    res.status(500).json({ success: false, message: 'Gagal reset semua billing' });
  }
});

// POST /api/treasurer/bendahara/billing/lunasi - Tandai billing lunas (tunai/transfer ke rekening pusat)
router.post('/treasurer/bendahara/billing/lunasi', authenticateBendahara, async (req, res) => {
  try {
    await billing.ensureBillingTables();
    const { billing_ids, metode_pembayaran, tanggal_bayar, dibayar_oleh, catatan_pelunasan } = req.body;

    if (!Array.isArray(billing_ids) || billing_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'billing_ids wajib diisi' });
    }
    if (!metode_pembayaran || !['tunai', 'transfer_pusat'].includes(metode_pembayaran)) {
      return res.status(400).json({ success: false, message: 'metode_pembayaran harus tunai atau transfer_pusat' });
    }
    if (!tanggal_bayar) {
      return res.status(400).json({ success: false, message: 'tanggal_bayar wajib diisi' });
    }

    const placeholders = billing_ids.map(() => '?').join(',');
    const targetBillings = await db.query(
      `SELECT id, student_id, status FROM billing_payment WHERE id IN (${placeholders})`,
      billing_ids
    );

    if (!targetBillings || targetBillings.length === 0) {
      return res.status(404).json({ success: false, message: 'Billing tidak ditemukan' });
    }

    let lunas = 0, dilewati = 0;
    const affectedStudents = new Set();
    const skippedDetails = [];

    for (const b of targetBillings) {
      if (b.status === 'lunas') {
        dilewati++;
        skippedDetails.push({ billing_id: b.id, reason: 'sudah lunas' });
        continue;
      }
      try {
        // Ambil data billing lengkap untuk hitung total
        const detailResult = await db.query(
          `SELECT student_id, tenant_id, bulan, COALESCE(spp_bulanan, 0) as spp, 
           COALESCE(ransportasi, 0) as transport, COALESCE(subsidi, 0) as subsidi, 
           COALESCE(biaya_admin_va, 0) as admin_va
           FROM billing_payment WHERE id = ?`,
          [b.id]
        );
        const detail = Array.isArray(detailResult) ? detailResult[0] : detailResult;

        const totalBayar = detail
          ? (parseFloat(detail.spp) + parseFloat(detail.transport) - parseFloat(detail.subsidi) + parseFloat(detail.admin_va))
          : 0;

        // Insert record ke incoming_payments supaya recalcStudent bisa mendeteksi pembayaran
        if (detail && detail.student_id) {
          try {
            await db.query(
              `INSERT INTO incoming_payments 
               (matched_student_id, periode, total_amount, channel, status, remarks, created_at) 
               VALUES (?, ?, ?, ?, 'Success', ?, NOW())`,
              [
                detail.student_id,
                detail.bulan,
                totalBayar,
                metode_pembayaran === 'tunai' ? 'Tunai' : 'Transfer Bank',
                `Pelunasan manual via bendahara - ${dibayar_oleh || '-'} ${catatan_pelunasan ? '(' + catatan_pelunasan + ')' : ''}`
              ]
            );
          } catch (e) {
            // Tabel incoming_payments mungkin tidak ada, lanjut tanpa error
            console.warn('[LUNASI] Gagal insert incoming_payments:', e.message);
          }
        }

        // Set transaksi = total tagihan supaya konsisten
        await db.query(
          `UPDATE billing_payment 
           SET status = 'lunas', 
               metode_pembayaran = ?, 
               tanggal_bayar = ?, 
               dibayar_oleh = ?, 
               catatan_pelunasan = ?,
               transaksi = ?,
               keterangan_spp = 0
           WHERE id = ?`,
          [metode_pembayaran, tanggal_bayar, dibayar_oleh || null, catatan_pelunasan || null, totalBayar, b.id]
        );
        if (b.student_id) affectedStudents.add(b.student_id);
        lunas++;
      } catch (err) {
        dilewati++;
        skippedDetails.push({ billing_id: b.id, reason: err.message });
      }
    }

    // Recalculate saldo siswa
    for (const studentId of affectedStudents) {
      try {
        await billing.recalcStudent(studentId);
      } catch (e) {
        // continue
      }
    }

    res.json({
      success: true,
      message: `Berhasil melunaskan ${lunas} billing. ${dilewati} dilewati (sudah lunas).`,
      lunas,
      dilewati,
      skipped_details: skippedDetails
    });
  } catch (error) {
    console.error('Lunasi billing error:', error);
    res.status(500).json({ success: false, message: 'Gagal melunaskan billing' });
  }
});

// ===== BSI VA MANUAL ENDPOINTS =====

// GET /api/treasurer/bendahara/student-billing/:student_id - Detail billing siswa
router.get('/treasurer/bendahara/student-billing/:student_id', authenticateBendahara, async (req, res) => {
  try {
    await billing.ensureBillingTables();
    const studentId = req.params.student_id;
    const [student] = await db.query('SELECT s.id, s.nama_siswa, s.nisn, s.tenant_id, s.iuran_bulanan, tn.nama_sekolah FROM students s LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id WHERE s.id = ?', [studentId]);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }
    const bills = await db.query('SELECT * FROM billing_payment WHERE student_id = ? ORDER BY bulan DESC', [studentId]);
    const [saldoRow] = await db.query('SELECT saldo FROM saldo_siswa WHERE student_id = ?', [studentId]);
    res.json({
      success: true,
      data: {
        student: {
          id: student.id,
          nama_siswa: student.nama_siswa,
          nisn: student.nisn,
          tenant_id: student.tenant_id,
          nama_sekolah: student.nama_sekolah,
          iuran_bulanan: student.iuran_bulanan
        },
        billing: bills.map(b => ({
          bulan: b.bulan,
          spp_bulanan: parseFloat(b.spp_bulanan) || 0,
          transaksi: parseFloat(b.transaksi) || 0,
          keterangan_spp: parseFloat(b.keterangan_spp) || 0,
          status: b.status
        })),
        saldo: parseFloat(saldoRow?.saldo) || 0
      }
    });
  } catch (error) {
    console.error('Student billing error:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil data billing siswa' });
  }
});

// Ambil VA prefix default dari config payment_gateways (default '2231')
async function getBsiVaPrefix(tenantId) {
  try {
    const [gw] = await db.query(
      'SELECT config FROM payment_gateways WHERE tenant_id = ? AND gateway = ? AND is_active = 1',
      [tenantId, 'bsi_manual']
    );
    if (gw && gw.config) {
      const cfg = typeof gw.config === 'string' ? JSON.parse(gw.config) : gw.config;
      if (cfg && cfg.va_prefix) return String(cfg.va_prefix);
    }
    const [def] = await db.query(
      'SELECT config FROM payment_gateways WHERE gateway = ? AND is_active = 1 LIMIT 1',
      ['bsi_manual']
    );
    if (def && def.config) {
      const cfg = typeof def.config === 'string' ? JSON.parse(def.config) : def.config;
      if (cfg && cfg.va_prefix) return String(cfg.va_prefix);
    }
  } catch (e) { /* fallback ke default */ }
  return '2231';
}

// Ambil Parent Account dari config payment_gateways (default '1029129123')
async function getBsiParentAccount(tenantId) {
  try {
    // Parent Account diambil dari bank_account_number tenant (sesuai kebutuhan BSI CUZ).
    const [t] = await db.query('SELECT bank_account_number FROM tenants WHERE tenant_id = ? LIMIT 1', [tenantId]);
    if (t && t.bank_account_number) return String(t.bank_account_number).replace(/\s/g, '');

    // Fallback ke config payment_gateways bila bank_account_number kosong.
    const [gw] = await db.query(
      'SELECT config FROM payment_gateways WHERE tenant_id = ? AND gateway = ? AND is_active = 1',
      [tenantId, 'bsi_manual']
    );
    if (gw && gw.config) {
      const cfg = typeof gw.config === 'string' ? JSON.parse(gw.config) : gw.config;
      if (cfg && cfg.parent_account) return String(cfg.parent_account).replace(/\s/g, '');
    }
  } catch (e) { /* fallback ke default */ }
  return '1029129123';
}

// POST /api/treasurer/bsi/create-single - buat VA BSI manual per siswa
// body: { tenant_id, student_id } -> VA = prefix + student_id, insert payment_transactions pending
router.post('/treasurer/bsi/create-single', authenticateBendahara, async (req, res) => {
  try {
    const { tenant_id, student_id, amount } = req.body;
    if (!tenant_id || !student_id) {
      return res.status(400).json({ success: false, message: 'tenant_id dan student_id wajib' });
    }
    if (!verifyTenantAccess(req, tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const [student] = await db.query(
      'SELECT id, nama_siswa, tenant_id, iuran_bulanan, va_number FROM students WHERE id = ? AND tenant_id = ?',
      [student_id, tenant_id]
    );
    if (!student) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }

    // Validasi: siswa dengan iuran_bulanan = 0 tidak perlu dibuat VA
    const iuranBulanan = parseFloat(student.iuran_bulanan) || 0;
    if (iuranBulanan <= 0) {
      return res.status(400).json({
        success: false,
        message: `Siswa ${student.nama_siswa} memiliki SPP = 0. VA tidak dibuat untuk siswa yang tidak memiliki tagihan SPP.`,
        skipped: true
      });
    }

    const vaPrefix = (process.env.BSI_VA_PREFIX || '832231').replace(/[^0-9]/g, '');
    let vaNumber = student.va_number ? String(student.va_number).replace(/[^0-9]/g, '') : '';

    if (!vaNumber || vaNumber.length < 10) {
      const vaSuffix = String(Math.floor(1000000000 + Math.random() * 9000000000));
      vaNumber = `${vaPrefix}${vaSuffix}`;

      await db.query(
        'UPDATE students SET va_number = ?, va_name = ? WHERE id = ?',
        [vaNumber, student.nama_siswa, student_id]
      );
    }

    const finalAmount = amount !== undefined && amount !== null && !isNaN(parseFloat(amount))
      ? parseFloat(amount)
      : parseFloat(student.iuran_bulanan) || 0;

    await db.query(
      `INSERT INTO payment_transactions (tenant_id, student_id, gateway, external_id, amount, status, payment_method, description, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE amount = VALUES(amount), description = VALUES(description)`,
      [
        tenant_id,
        student_id,
        'bsi_manual',
        vaNumber,
        finalAmount,
        'pending',
        'BSI VA',
        `VA BSI ${vaNumber} - ${student.nama_siswa}`,
        JSON.stringify({ student_name: student.nama_siswa })
      ]
    );

    res.json({
      success: true,
      message: student.va_number ? 'VA BSI sudah ada dan tetap digunakan' : 'VA BSI berhasil dibuat',
      data: { student_id, va_number: vaNumber, va_name: student.nama_siswa, amount: finalAmount }
    });
  } catch (error) {
    console.error('Create BSI VA error:', error);
    res.status(500).json({ success: false, message: 'Gagal buat VA BSI' });
  }
});

// POST /api/treasurer/bsi/create-all - buat VA BSI untuk semua siswa aktif (semua sekolah)
// body: { only_without_va: true/false } -> hanya buat untuk siswa yang belum punya VA
router.post('/treasurer/bsi/create-all', authenticateBendahara, async (req, res) => {
  try {
    const { only_without_va = true } = req.body;
    const vaPrefix = (process.env.BSI_VA_PREFIX || '832231').replace(/[^0-9]/g, '');
    
    // Get all active students
    let query = `
      SELECT s.id, s.nama_siswa, s.tenant_id, s.iuran_bulanan, s.va_number, tn.nama_sekolah
      FROM students s
      JOIN tenants tn ON s.tenant_id = tn.tenant_id
      WHERE (s.status = 'active' OR s.status = 'aktif' OR s.status IS NULL)
        AND COALESCE(s.iuran_bulanan, 0) > 0
    `;

    if (only_without_va) {
      query += ' AND (s.va_number IS NULL OR s.va_number = "")';
    }

    query += ' ORDER BY tn.nama_sekolah, s.nama_siswa';

    const students = await db.query(query);

    if (!students || students.length === 0) {
      return res.json({ success: true, message: 'Tidak ada siswa yang perlu dibuat VA (cek SPP > 0)', created: 0, skipped: 0 });
    }
    
    let created = 0;
    let skipped = 0;
    const details = [];
    
    for (const student of students) {
      try {
        let vaNumber = student.va_number ? String(student.va_number).replace(/[^0-9]/g, '') : '';
        
        // Generate new VA if doesn't exist
        if (!vaNumber || vaNumber.length < 10) {
          const vaSuffix = String(Math.floor(1000000000 + Math.random() * 9000000000));
          vaNumber = `${vaPrefix}${vaSuffix}`;
          
          await db.query(
            'UPDATE students SET va_number = ?, va_name = ? WHERE id = ?',
            [vaNumber, student.nama_siswa, student.id]
          );
          
          // Insert payment transaction
          const finalAmount = parseFloat(student.iuran_bulanan) || 0;
          await db.query(
            `INSERT INTO payment_transactions (tenant_id, student_id, gateway, external_id, amount, status, payment_method, description, metadata)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE amount = VALUES(amount), description = VALUES(description)`,
            [
              student.tenant_id,
              student.id,
              'bsi_manual',
              vaNumber,
              finalAmount,
              'pending',
              'BSI VA',
              `VA BSI ${vaNumber} - ${student.nama_siswa}`,
              JSON.stringify({ student_name: student.nama_siswa })
            ]
          );
          
          created++;
          details.push({
            student_id: student.id,
            nama_siswa: student.nama_siswa,
            nama_sekolah: student.nama_sekolah,
            va_number: vaNumber,
            status: 'created'
          });
        } else {
          skipped++;
          details.push({
            student_id: student.id,
            nama_siswa: student.nama_siswa,
            nama_sekolah: student.nama_sekolah,
            va_number: vaNumber,
            status: 'skipped_existing'
          });
        }
      } catch (err) {
        console.error(`[VA ALL] Failed for student ${student.id}:`, err.message);
        details.push({
          student_id: student.id,
          nama_siswa: student.nama_siswa,
          error: err.message
        });
      }
    }
    
    res.json({
      success: true,
      message: `VA dibuat: ${created} baru, ${skipped} sudah ada, ${students.length} total`,
      total_students: students.length,
      created: created,
      skipped: skipped,
      details: details
    });
  } catch (error) {
    console.error('Create all VA error:', error);
    res.status(500).json({ success: false, message: 'Gagal buat VA untuk semua siswa' });
  }
});

// GET /api/treasurer/bsi/generate-csv?tenant_id=XXX - download CSV sesuai format BSI CUZ
// Header: Type,Parent Account,Virtual Account Number,Virtual Account Name,Amount,Remark,Transaction Date
router.get('/treasurer/bsi/generate-csv', authenticateBendahara, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    if (tenantId && !verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const vaPrefix = process.env.BSI_VA_PREFIX || '832231';
    const parentAccount = await getBsiParentAccount(tenantId);

    let query = `
      SELECT s.id, s.nama_siswa, s.tenant_id, tn.nama_sekolah, s.iuran_bulanan, s.va_number, p.nama_orang_tua, p.no_wa as parent_wa
      FROM students s
      JOIN tenants tn ON s.tenant_id = tn.tenant_id
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE (s.status = 'active' OR s.status = 'aktif' OR s.status IS NULL)
        AND s.va_number IS NOT NULL AND s.va_number != ''
    `;
    const params = [];
    if (tenantId) {
      query += ' AND s.tenant_id = ?';
      params.push(tenantId);
    }
    query += ' ORDER BY tn.nama_sekolah, s.nama_siswa';

    const students = await db.query(query, params);

    const header1 = 'Type,Parent Account,Virtual Account Number (Prefix VA + Number),Virtual Account Name,Virtual Account Scheme,Limit Debit,Limit Credit,Limit Transaction,Physical Card,Auto Renewal Limit,,Expire Date,KYC,,,,,Additional Info,,,,,,,,,,';
    const header2 = ',,,,,,,,,,Every,Date / Day,,Name,Mobile Phone,ID Type,ID Number,Address,Label1;Value1,Label2;Value2,Label3;Value3,Label4;Value4,Label5;Value5,Label6;Value6,Label7;Value7,Label8;Value8,Label9;Value10;Value10';
    let expireDate;
    if (req.query.expire_date) {
      expireDate = req.query.expire_date;
    } else {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const lastDay = new Date(year, month + 1, 0).getDate();
      expireDate = `${String(lastDay).padStart(2, '0')}/${String(month + 1).padStart(2, '0')}/${year}`;
    }
    const rows = (students || []).map(s => {
      const rawVa = (s.va_number || `${vaPrefix}${String(s.id).padStart(10, '0')}`).replace(/[^0-9]/g, '');
      const va = rawVa.padStart(16, '0').slice(-16); // Pastikan 16 digit tanpa spasi
      const amount = parseFloat(s.iuran_bulanan) || 0;
      const limitAmount = amount + 2000;
      const kycName = (s.nama_orang_tua || s.nama_siswa).replace(/,/g, ' ');
      const vaName = (s.nama_siswa || '').replace(/,/g, ' ');
      const autoRenewal = 'Monthly';
      const every = '1';
      const idType = 'KTP';
      const idNumber = '1293000299101000'; // NIK dummy 16 digit valid
      const mobilePhone = (() => {
        const raw = (s.parent_wa || '').replace(/[^0-9]/g, '');
        if (!raw) return '6287766263637';
        if (raw.startsWith('0')) return '62' + raw.slice(1);
        if (raw.startsWith('62')) return raw;
        return '62' + raw;
      })();
      return [
        'Credit',
        parentAccount.replace(/\s/g, ''),
        va,
        vaName,
        'Open Limit',
        '',
        limitAmount,
        '',
        'Yes',
        '',
        '',
        expireDate,
        kycName,
        mobilePhone,
        'KTP',
        '1293000299101000',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '', ''
      ].join(',');
    });

    const txt = [header1, header2, ...rows].join('\n');
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename=BSI_VA_${tenantId || 'all'}_${Date.now()}.txt`);
    res.send(txt);
  } catch (error) {
    console.error('Generate BSI CSV error:', error);
    res.status(500).json({ success: false, message: 'Gagal generate CSV BSI' });
  }
});

// GET /api/treasurer/bsi/students-with-va - list siswa beserta VA (untuk tabel)
router.get('/treasurer/bsi/students-with-va', authenticateBendahara, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    if (tenantId && !verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
    let query = `
      SELECT s.id, s.nama_siswa, s.nisn, s.tenant_id, tn.nama_sekolah, s.iuran_bulanan, s.va_number,
        (SELECT status FROM payment_transactions pt WHERE pt.external_id = s.va_number AND pt.gateway = 'bsi_manual' ORDER BY pt.created_at DESC LIMIT 1) as va_status
      FROM students s
      JOIN tenants tn ON s.tenant_id = tn.tenant_id
      WHERE (s.status = 'active' OR s.status = 'aktif' OR s.status IS NULL)
    `;
    const params = [];
    if (tenantId) { query += ' AND s.tenant_id = ?'; params.push(tenantId); }
    query += ' ORDER BY tn.nama_sekolah, s.nama_siswa';
    const students = await db.query(query, params);
    res.json({ success: true, data: students });
  } catch (error) {
    console.error('BSI students with VA error:', error);
    res.status(500).json({ success: false, message: 'Gagal ambil data siswa VA' });
  }
});


// GET summary pendapatan per parent account (nomor VA tenant)
router.get('/treasurer/bsi/summary', authenticateToken, authenticateOperator, verifyTenantAccess, async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const [tenant] = await db.query(
      'SELECT bsi_va_number FROM tenants WHERE tenant_id = ?', [tenantId]
    );

    const [summary] = await db.query(
      `SELECT 
        SUM(amount) as total_pendapatan,
        COUNT(*) as jumlah_transaksi,
        MIN(transaction_date) as transaksi_pertama,
        MAX(transaction_date) as transaksi_terakhir
       FROM payment_bsi_transactions 
       WHERE beneficiary_va IN (SELECT va_number FROM students WHERE tenant_id = ?) AND status = 'Success'`,
      [tenantId]
    );

    res.json({ success: true, data: summary[0] });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Gagal ambil summary BSI' });
  }
});

// GET list transaksi BSI
router.get('/treasurer/bsi/transactions', authenticateToken, authenticateOperator, verifyTenantAccess, async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const [transactions] = await db.query(
      `SELECT t.*, s.nama_siswa FROM payment_bsi_transactions t 
       LEFT JOIN students s ON t.beneficiary_va = s.va_number 
       WHERE s.tenant_id = ? ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
      [tenantId, limit, offset]
    );

    res.json({ success: true, data: transactions });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Gagal ambil transaksi BSI' });
  }
});

// GET payroll data untuk bendahara sekolah
router.get('/treasurer/bendahara/payroll', authenticateBendahara, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id || '';
    const bulan = parseInt(req.query.bulan) || (new Date().getMonth() + 1);
    const tahun = parseInt(req.query.tahun) || new Date().getFullYear();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    let query = `
      SELECT t.id, t.nama, t.nik, t.gaji_pokok, t.tunj_kinerja, t.tunj_umum, t.tunj_istri, t.tunj_anak, t.tunj_kepala_sekolah, t.tunj_wali_kelas, t.honor_bendahara
      FROM teachers t
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      WHERE t.status_aktif = 1
    `;
    let params = [];

    if (tenantId) {
      query += ' AND ta.tenant_id = ?';
      params.push(tenantId);
    }

    query += ' ORDER BY t.nama ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const teachers = await db.query(query, params);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total
      FROM teachers t
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      WHERE t.status_aktif = 1
    `;
    let countParams = [];
    if (tenantId) {
      countQuery += ' AND ta.tenant_id = ?';
      countParams.push(tenantId);
    }
    const countResult = await db.query(countQuery, countParams);
    const total = countResult[0]?.total || 0;

    const result = teachers.map(t => ({ 
      id: t.id, 
      nama: t.nama, 
      nik: t.nik || '',
      gaji_pokok: t.gaji_pokok || 0, 
      tunj_kinerja: t.tunj_kinerja || 0, 
      tunj_umum: t.tunj_umum || 0, 
      tunj_istri: t.tunj_istri || 0, 
      tunj_anak: t.tunj_anak || 0, 
      tunj_kepala_sekolah: t.tunj_kepala_sekolah || 0, 
      tunj_wali_kelas: t.tunj_wali_kelas || 0, 
      honor_bendahara: t.honor_bendahara || 0, 
      potongan: 0, 
      total_gaji: t.gaji_pokok || 0 
    }));
    res.json({ success: true, data: result, total: total });
  } catch (e) {
    console.error('Payroll error:', e);
    res.status(500).json({ success: false, message: 'Error payroll: ' + e.message });
  }
});

// PUT update salary field teacher
router.put('/treasurer/bendahara/teacher/:id', authenticateBendahara, async (req, res) => {
  try {
    const teacherId = req.params.id;
    const field = req.body.field;
    const value = req.body.value;
    await db.query('UPDATE teachers SET ' + field + ' = ? WHERE id = ?', [value, teacherId]);
    res.json({ success: true, message: 'Tersimpan' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Gagal simpan' });
  }
});

router.put('/treasurer/bendahara/spp/:id', authenticateBendahara, async (req, res) => {
  try {
    const studentId = req.params.id;
    const { iuran_bulanan } = req.body;
    const tenantId = req.query.tenant_id || req.body.tenant_id;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'tenant_id required' });
    }
    await db.query('UPDATE students SET iuran_bulanan = ? WHERE id = ? AND tenant_id = ?', [iuran_bulanan, studentId, tenantId]);
    res.json({ success: true, message: 'Iuran diupdate' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Gagal update SPP' });
  }
});

// ==================== AUTO BILLING REPORT & SETTINGS ====================

// GET /api/treasurer/bendahara/auto-billing/settings - Get auto billing settings
router.get('/treasurer/bendahara/auto-billing/settings', authenticateBendahara, async (req, res) => {
  try {
    // Ensure table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS bill_settings (
        id INT PRIMARY KEY DEFAULT 1,
        send_day INT DEFAULT 1,
        due_day INT DEFAULT 10,
        is_enabled TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // Insert default if not exists
    const existing = await db.query('SELECT id FROM bill_settings LIMIT 1');
    if (existing.length === 0) {
      await db.query('INSERT INTO bill_settings (send_day, due_day, is_enabled) VALUES (1, 10, 0)');
    }
    const settings = await db.query('SELECT send_day, due_day, is_enabled FROM bill_settings LIMIT 1');
    res.json({
      success: true,
      data: settings[0] || { send_day: 1, due_day: 10, is_enabled: 0 }
    });
  } catch (error) {
    console.error('Get auto billing settings error:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil pengaturan' });
  }
});

// POST /api/treasurer/bendahara/auto-billing/toggle - Toggle auto billing on/off
router.post('/treasurer/bendahara/auto-billing/toggle', authenticateBendahara, async (req, res) => {
  try {
    // Ensure table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS bill_settings (
        id INT PRIMARY KEY DEFAULT 1,
        send_day INT DEFAULT 1,
        due_day INT DEFAULT 10,
        is_enabled TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    const { is_enabled, send_day, due_day } = req.body;
    await db.query(
      'UPDATE bill_settings SET is_enabled = ?, send_day = ?, due_day = ? WHERE id = 1',
      [is_enabled ? 1 : 0, send_day || 1, due_day || 10]
    );
    res.json({
      success: true,
      message: is_enabled ? 'Auto billing diaktifkan' : 'Auto billing dinonaktifkan'
    });
  } catch (error) {
    console.error('Toggle auto billing error:', error);
    res.status(500).json({ success: false, message: 'Gagal mengubah pengaturan' });
  }
});

// GET /api/treasurer/bendahara/auto-billing/report - Get auto billing report
router.get('/treasurer/bendahara/auto-billing/report', authenticateBendahara, async (req, res) => {
  try {
    // Ensure table exists with correct collation
    await db.query(`
      CREATE TABLE IF NOT EXISTS auto_billing_reports (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id VARCHAR(50) NOT NULL,
        periode VARCHAR(20) NOT NULL,
        student_id INT NOT NULL,
        nama_siswa VARCHAR(255),
        no_wa VARCHAR(20),
        saldo DECIMAL(10,2) DEFAULT 0,
        status ENUM('terkirim', 'gagal', 'no_wa') NOT NULL,
        message_id VARCHAR(100),
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_periode (periode),
        INDEX idx_tenant (tenant_id),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    // Fix collation if table already existed with wrong collation
    await db.query(`ALTER TABLE auto_billing_reports CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    const { periode, status } = req.query;

    let query = `
      SELECT 
        abr.tenant_id,
        abr.periode,
        abr.student_id,
        abr.nama_siswa,
        abr.no_wa,
        abr.saldo,
        abr.status,
        abr.message_id,
        abr.error_message,
        abr.created_at,
        tn.nama_sekolah
      FROM auto_billing_reports abr
      LEFT JOIN tenants tn ON abr.tenant_id = tn.tenant_id
      WHERE 1=1
    `;
    const params = [];

    if (periode) {
      query += ' AND abr.periode = ?';
      params.push(periode);
    }

    if (status) {
      query += ' AND abr.status = ?';
      params.push(status);
    }

    query += ' ORDER BY abr.created_at DESC, tn.nama_sekolah ASC, abr.nama_siswa ASC';

    const reports = await db.query(query, params);

    // Summary
    const summaryQuery = `
      SELECT 
        periode,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'terkirim' THEN 1 ELSE 0 END) as total_terkirim,
        SUM(CASE WHEN status = 'gagal' THEN 1 ELSE 0 END) as total_gagal,
        SUM(CASE WHEN status = 'no_wa' THEN 1 ELSE 0 END) as total_no_wa
      FROM auto_billing_reports
      GROUP BY periode
      ORDER BY periode DESC
    `;
    const summary = await db.query(summaryQuery);

    res.json({
      success: true,
      data: reports,
      summary: summary
    });
  } catch (error) {
    console.error('Get auto billing report error:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil laporan' });
  }
});

module.exports = router
