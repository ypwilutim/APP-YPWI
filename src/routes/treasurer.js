const express = require('express');
const db = require('../../db');
const nodemailer = require('nodemailer');
const axios = require('axios');
const { authenticateToken, authenticateOperator, verifyTenantAccess } = require('../middleware/auth');
const { sendBillTemplate } = require('../utils/whatsappTemplate');

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
// GET /api/treasurer/public/spp-summary - Ringkasan pembayaran SPP (Xendit)
router.get('/treasurer/public/spp-summary', async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;

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
      LEFT JOIN payment_invoices pi ON s.id = pi.student_id AND pi.status = 'paid'
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
        (SELECT COALESCE(SUM(amount),0) FROM payment_invoices pi WHERE pi.student_id = s.id AND pi.status NOT IN ('paid','cancelled')) as arrears_pi,
        (SELECT COALESCE(SUM(amount),0) FROM xendit_invoices xi WHERE xi.student_id = s.id AND xi.status NOT IN ('PAID','EXPIRED')) as arrears_xi
      FROM students s
      JOIN tenants tn ON s.tenant_id = tn.tenant_id
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE s.iuran_bulanan IS NOT NULL
    `;
    let params = [];

    if (tenantId) {
      query += ' AND s.tenant_id = ?';
      params.push(tenantId);
    }

    query += ' ORDER BY tn.nama_sekolah ASC, s.nama_siswa ASC';
    const defaulters = await db.query(query, params);

    const data = defaulters.map(s => ({
      ...s,
      total_arrears: parseFloat(s.arrears_pi || 0) + parseFloat(s.arrears_xi || 0),
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
    const { no_wa, nama_siswa, jumlah_tagihan, bulan, tanggal_jatuh_tempo, tenant_id, student_id } = req.body;

    if (!no_wa) {
      return res.status(400).json({ success: false, message: 'Nomor WA tidak tersedia' });
    }
    if (!nama_siswa) {
      return res.status(400).json({ success: false, message: 'Nama siswa tidak tersedia' });
    }

    let invoiceUrl = null;
    if (student_id) {
      const [inv] = await db.query(
        'SELECT external_id FROM xendit_invoices WHERE student_id = ? AND status = "PENDING" ORDER BY created_at DESC LIMIT 1',
        [student_id]
      );
      if (inv?.external_id) {
        invoiceUrl = `xendit-payment.html?external_id=${inv.external_id}`;
      }
    }
    const finalInvoiceUrl = invoiceUrl || `xendit-payment.html?student_id=${student_id || ''}`;

    const now = new Date();
    const bulanPengiriman = bulan || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const jatuhTempo = tanggal_jatuh_tempo || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-10`;

    const result = await sendBillTemplate(no_wa, {
      nama_siswa,
      bulan: bulanPengiriman,
      jumlah_tagihan: jumlah_tagihan ? `${Number(jumlah_tagihan).toLocaleString('id-ID')}` : '-',
      tanggal_jatuh_tempo: jatuhTempo,
      invoice_url: finalInvoiceUrl
    }, 'invoice_spp');

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
    const { tenant_id } = req.body;
    let tenantId = tenant_id || null;

    let defaulterQuery = `
      SELECT s.id, s.nama_siswa, s.nisn, s.no_wa, tn.nama_sekolah, tn.tenant_id,
        COALESCE(CASE WHEN s.kelas = 'PI' THEN s.arrears_pi WHEN s.kelas = 'XI' THEN s.arrears_xi ELSE 0 END, 0) as total_arrears
      FROM students s
      JOIN tenants tn ON s.tenant_id = tn.tenant_id
      WHERE s.status = 'active'
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

    let sent = 0, failed = 0;
    const results = [];

    for (const student of defaulters) {
      if (!student.no_wa) { failed++; continue; }

      const number = student.no_wa.replace(/[^0-9]/g, '');

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

      try {
        const result = await sendBillTemplate(number, {
          nama_siswa: student.nama_siswa,
          bulan: bulanPengiriman,
          jumlah_tagihan: student.total_arrears ? `${Number(student.total_arrears).toLocaleString('id-ID')}` : '-',
          tanggal_jatuh_tempo: jatuhTempo,
          invoice_url: invoiceUrl
        }, 'invoice_spp');
        sent++;
        results.push({ id: student.id, success: true });
      } catch (e) {
        failed++;
        results.push({ id: student.id, success: false, error: e.message });
      }
    }

    res.json({ success: true, message: `Terkirim: ${sent} | Gagal: ${failed}`, sent, failed });
  } catch (error) {
    console.error('Send all SPP reminders error:', error.message);
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
      SELECT s.id, s.nama_siswa, s.nisn, s.iuran_bulanan, s.tenant_id, tn.nama_sekolah, s.va_number, s.nis
      FROM students s
      JOIN tenants tn ON s.tenant_id = tn.tenant_id
      WHERE s.va_number = ? OR s.nis = ?
    `;
    const [student] = await db.query(query, [va_number, vaWithoutPrefix]);

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
      SELECT SUM(pi.amount) as total_income
      FROM xendit_invoices xi
      WHERE pi.status = 'paid' AND DATE_FORMAT(xi.created_at, '%Y-%m') = ?
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
      SELECT SUM(pi.amount) as total_income
      FROM xendit_invoices xi
      WHERE pi.status = 'paid' AND DATE_FORMAT(xi.created_at, '%Y-%m') = ?
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

router.get('/treasurer/public/tenants', authenticateOperator, async (req, res) => {
  try {
    const tenants = await db.query('SELECT tenant_id, nama_sekolah FROM tenants ORDER BY nama_sekolah');
    res.json({ success: true, data: tenants });
  } catch (error) {
    console.error('Get tenants error:', error)
    res.status(500).json({ success: false, message: 'Gagal ambil data sekolah' });
  }
})

// ===== BSI VA MANUAL ENDPOINTS =====

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
router.post('/treasurer/bsi/create-single', authenticateOperator, async (req, res) => {
  try {
    const { tenant_id, student_id, amount } = req.body;
    if (!tenant_id || !student_id) {
      return res.status(400).json({ success: false, message: 'tenant_id dan student_id wajib' });
    }
    if (!verifyTenantAccess(req, tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const [student] = await db.query(
      'SELECT id, nama_siswa, tenant_id, iuran_bulanan FROM students WHERE id = ? AND tenant_id = ?',
      [student_id, tenant_id]
    );
    if (!student) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }

    // Generate 10 digit acak untuk kolom VA di CUZ BSI (tanpa prefix).
    const vaSuffix = String(Math.floor(1000000000 + Math.random() * 9000000000));
    // Di database ditambah prefix dari env BSI_VA_PREFIX (default 832231).
    const vaPrefix = process.env.BSI_VA_PREFIX || '832231';
    const vaNumber = `${vaPrefix}${vaSuffix}`;

    // Simpan va_number (ber-prefix) ke tabel students
    await db.query(
      'UPDATE students SET va_number = ?, va_name = ? WHERE id = ?',
      [vaNumber, student.nama_siswa, student_id]
    );

    // Insert ke payment_transactions status pending
    const finalAmount = amount !== undefined && amount !== null && !isNaN(parseFloat(amount))
      ? parseFloat(amount)
      : parseFloat(student.iuran_bulanan) || 0;

    await db.query(
      `INSERT INTO payment_transactions (tenant_id, student_id, gateway, external_id, amount, status, payment_method, description, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      message: 'VA BSI berhasil dibuat',
      data: { student_id, va_number: vaNumber, va_name: student.nama_siswa, amount: finalAmount }
    });
  } catch (error) {
    console.error('Create BSI VA error:', error);
    res.status(500).json({ success: false, message: 'Gagal buat VA BSI' });
  }
});

// GET /api/treasurer/bsi/generate-csv?tenant_id=XXX - download CSV sesuai format BSI CUZ
// Header: Type,Parent Account,Virtual Account Number,Virtual Account Name,Amount,Remark,Transaction Date
router.get('/treasurer/bsi/generate-csv', authenticateOperator, async (req, res) => {
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
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-indexed
    const lastDay = new Date(year, month + 1, 0).getDate();
    const expireDate = `${String(lastDay).padStart(2, '0')}/${String(month + 1).padStart(2, '0')}/${year}`;
    const rows = (students || []).map(s => {
      const rawVa = (s.va_number || `${vaPrefix}${String(s.id).padStart(10, '0')}`).replace(/[^0-9]/g, '');
      const va = rawVa.padStart(16, '0').slice(-16); // Pastikan 16 digit tanpa spasi
      const amount = parseFloat(s.iuran_bulanan) || 0;
      const limitDebit = amount + 2000;
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
        'Debit',
        parentAccount.replace(/\s/g, ''),
        va,
        vaName,
        'One Time',
        limitDebit,
        '',
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
router.get('/treasurer/bsi/students-with-va', authenticateOperator, async (req, res) => {
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

module.exports = router
