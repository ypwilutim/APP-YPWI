const express = require('express');
const db = require('../../db');
const { authenticateToken, authenticateOperator, verifyTenantAccess, authenticateAdmin, isSuperAdminTenant } = require('../middleware/auth');
const router = express.Router();

console.log('[PAYMENTS_MODULE] payments.js module loaded at', new Date().toISOString());

function generateInvoiceNumber(tenant_id, periode, student_id) {
  return `INV-${tenant_id}-${periode}-${student_id}-${Date.now().toString(36).toUpperCase()}`;
}

function now() {
  return new Date();
}

async function computeInvoiceAmount(studentId, tenantId, overrideAmount) {
  if (overrideAmount !== undefined && overrideAmount !== null && overrideAmount !== '' && !isNaN(parseFloat(overrideAmount))) {
    return parseFloat(overrideAmount);
  }
  const [student] = await db.query('SELECT iuran_bulanan FROM students WHERE id = ? AND tenant_id = ?', [studentId, tenantId]);
  const base = parseFloat(student && student.iuran_bulanan) || 0;
  const [arrears] = await db.query(
    "SELECT COALESCE(SUM(amount),0) as total FROM payment_invoices WHERE student_id = ? AND tenant_id = ? AND status NOT IN ('paid','cancelled')",
    [studentId, tenantId]
  );
  const [xenditArrears] = await db.query(
    "SELECT COALESCE(SUM(amount),0) as total FROM xendit_invoices WHERE student_id = ? AND tenant_id = ? AND status NOT IN ('PAID','EXPIRED')",
    [studentId, tenantId]
  );
  const arrearsTotal = parseFloat(arrears && arrears.total) || 0;
  const xenditArrearsTotal = parseFloat(xenditArrears && xenditArrears.total) || 0;
  return base + arrearsTotal + xenditArrearsTotal;
}

// POST /api/payments/create-invoice - Create internal payment invoice
router.post('/payments/create-invoice', async (req, res) => {
  try {
    const { tenant_id, student_id, amount, description, due_date, notes } = req.body;

    if (!tenant_id || !student_id) {
      return res.status(400).json({ success: false, message: 'tenant_id dan student_id wajib diisi' });
    }

    const [student] = await db.query(
      'SELECT s.*, tn.nama_sekolah, p.no_wa as parent_wa, p.nama_orang_tua FROM students s JOIN tenants tn ON s.tenant_id = tn.tenant_id LEFT JOIN parents p ON s.parent_id = p.id WHERE s.id = ? AND s.tenant_id = ?',
      [student_id, tenant_id]
    );
    if (!student) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }

    const finalAmount = await computeInvoiceAmount(student_id, tenant_id, amount);

    const date = now();
    const periode = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const invoiceNumber = generateInvoiceNumber(tenant_id, periode, student_id);

    const [existing] = await db.query(
      'SELECT id FROM payment_invoices WHERE student_id = ? AND tenant_id = ? AND periode = ? AND status NOT IN ("paid", "cancelled")',
      [student_id, tenant_id, periode]
    );
    if (existing) {
      return res.status(400).json({ success: false, message: 'Invoice untuk periode ini sudah ada' });
    }

    const result = await db.query(
      `INSERT INTO payment_invoices (tenant_id, student_id, invoice_number, amount, description, periode, status, due_date, notes, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenant_id,
        student_id,
        invoiceNumber,
        finalAmount,
        description || `SPP ${student.nama_siswa} - ${student.nama_sekolah} - ${periode}`,
        periode,
        'pending',
        due_date || null,
        notes || null,
        JSON.stringify({
          student_name: student.nama_siswa,
          school_name: student.nama_sekolah,
          parent_wa: student.parent_wa || null,
          parent_name: student.nama_orang_tua || null,
          type: 'SPP'
        })
      ]
    );

    const invoiceId = result.insertId;

    await db.query(
      'INSERT INTO payment_status_history (invoice_id, old_status, new_status, changed_by, notes) VALUES (?, ?, ?, ?, ?)',
      [invoiceId, null, 'pending', (req.user && req.user.id) || 0, 'Invoice dibuat']
    );

    const invoice = await db.query('SELECT * FROM payment_invoices WHERE id = ?', [invoiceId]);

    res.json({
      success: true,
      message: 'Invoice berhasil dibuat',
      data: invoice[0]
    });
  } catch (error) {
    console.error('Create internal invoice error:', error);
    res.status(500).json({ success: false, message: 'Error creating internal invoice' });
  }
});

// POST /api/payments/public/create-invoices-batch - Batch create SPP invoices (testing)
router.post('/payments/public/create-invoices-batch', async (req, res) => {
  try {
    const { tenant_id, periode, amount, description, due_date } = req.body;
    const scope = (!tenant_id || tenant_id === 'YPWILUTIM') ? null : tenant_id;
    const targetPeriode = periode || `${now().getFullYear()}-${String(now().getMonth() + 1).padStart(2, '0')}`;

    const students = await db.query(
      `SELECT s.id, s.nama_siswa, s.tenant_id, tn.nama_sekolah FROM students s JOIN tenants tn ON s.tenant_id = tn.tenant_id ${scope ? 'WHERE s.tenant_id = ?' : ''}`,
      scope ? [scope] : []
    );

    const existingRows = await db.query(
      `SELECT student_id FROM payment_invoices WHERE periode = ? ${scope ? 'AND tenant_id = ?' : ''} AND status NOT IN ('paid', 'cancelled')`,
      scope ? [targetPeriode, scope] : [targetPeriode]
    );
    const existingSet = new Set((existingRows || []).map(e => e.student_id));

    let created = 0, skipped = 0;
    for (const st of students) {
      if (existingSet.has(st.id)) { skipped++; continue; }
      const finalAmount = await computeInvoiceAmount(st.id, st.tenant_id, amount);
      if (finalAmount <= 0) { skipped++; continue; }
      const invoiceNumber = generateInvoiceNumber(st.tenant_id, periode, st.id);
      await db.query(
        `INSERT INTO payment_invoices (tenant_id, student_id, invoice_number, amount, description, periode, status, due_date, notes, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          st.tenant_id,
          st.id,
          invoiceNumber,
          finalAmount,
          description || `SPP ${st.nama_siswa} - ${st.nama_sekolah} - ${periode}`,
          periode,
          'pending',
          due_date || null,
          null,
          JSON.stringify({ student_name: st.nama_siswa, school_name: st.nama_sekolah, type: 'SPP' })
        ]
      );
      created++;
    }

    res.json({
      success: true,
      message: `Berhasil buat ${created} invoice, ${skipped} dilewati (sudah ada)`,
      created,
      skipped,
      periode
    });
  } catch (error) {
    console.error('Batch create invoices error:', error);
    res.status(500).json({ success: false, message: 'Error batch creating invoices' });
  }
});

// GET /api/payments/invoices - List invoices
router.get('/payments/invoices', authenticateToken, async (req, res) => {
  try {
    const reqTenantId = req.query.tenant_id;
    const status = req.query.status;
    const periode = req.query.periode;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    let tenantId = reqTenantId;
    if (!tenantId) {
      const treasurerAssignments = (req.user && req.user.assignments || []).filter(a => ['bendahara', 'tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'].includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, '')));
      if (treasurerAssignments.length === 1) {
        tenantId = treasurerAssignments[0].tenant_id;
      } else if (treasurerAssignments.length > 1) {
        tenantId = treasurerAssignments[0].tenant_id;
      }
    }
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'tenant_id required' });
    }

    let query = 'SELECT pi.*, s.nama_siswa, s.nisn, s.tenant_id, tn.nama_sekolah, p.no_wa as parent_wa FROM payment_invoices pi JOIN students s ON pi.student_id = s.id JOIN tenants tn ON s.tenant_id = tn.tenant_id LEFT JOIN parents p ON s.parent_id = p.id';
    const params = [];

    if (!isSuperAdminTenant(tenantId)) {
      query += ' WHERE pi.tenant_id = ?';
      params.push(tenantId);
    }

    if (status) {
      query += isSuperAdminTenant(tenantId) ? ' WHERE pi.status = ?' : ' AND pi.status = ?';
      params.push(status);
    }
    if (periode) {
      query += isSuperAdminTenant(tenantId) ? ' WHERE pi.periode = ?' : ' AND pi.periode = ?';
      params.push(periode);
    }

    query += ' ORDER BY pi.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, (page - 1) * limit);

    const invoices = await db.query(query, params);

    const countQuery = `SELECT COUNT(*) as total FROM payment_invoices pi JOIN students s ON pi.student_id = s.id ${isSuperAdminTenant(tenantId) ? '' : 'WHERE pi.tenant_id = ?'}`;
    const countParams = isSuperAdminTenant(tenantId) ? [] : [tenantId];
    const [countRow] = await db.query(countQuery, countParams);

    res.json({
      success: true,
      data: invoices,
      pagination: {
        total: countRow.total,
        page,
        limit,
        total_pages: Math.ceil(countRow.total / limit)
      }
    });
  } catch (error) {
    console.error('List internal invoices error:', error);
    res.status(500).json({ success: false, message: 'Error fetching invoices' });
  }
});

// GET /api/payments/invoices/:id - Get invoice detail
router.get('/payments/invoices/:id', authenticateOperator, async (req, res) => {
  try {
    const invoiceId = req.params.id;

    const [invoice] = await db.query(
      'SELECT pi.*, s.nama_siswa, s.nisn, p.no_wa as parent_wa FROM payment_invoices pi JOIN students s ON pi.student_id = s.id LEFT JOIN parents p ON s.parent_id = p.id WHERE pi.id = ?',
      [invoiceId]
    );
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice tidak ditemukan' });
    }

    if (!verifyTenantAccess(req, invoice.tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const history = await db.query(
      'SELECT * FROM payment_status_history WHERE invoice_id = ? ORDER BY created_at ASC',
      [invoiceId]
    );

    res.json({ success: true, data: { ...invoice, history } });
  } catch (error) {
    console.error('Get internal invoice error:', error);
    res.status(500).json({ success: false, message: 'Error fetching invoice' });
  }
});

// POST /api/payments/invoices/:id/approve - Approve payment
router.post('/payments/invoices/:id/approve', async (req, res) => {
  try {
    const invoiceId = req.params.id;
    const { notes, payment_method, payment_channel, paid_amount } = req.body;

    const [invoice] = await db.query('SELECT * FROM payment_invoices WHERE id = ?', [invoiceId]);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice tidak ditemukan' });
    }

    if (invoice.status === 'paid') {
      return res.status(400).json({ success: false, message: 'Invoice sudah lunas' });
    }

    const paidAt = now();

    await db.query(
      'UPDATE payment_invoices SET status = ?, paid_at = ?, paid_amount = ?, payment_method = ?, payment_channel = ?, approved_by = ?, approved_at = ?, notes = ? WHERE id = ?',
      ['paid', paidAt, parseFloat(paid_amount || invoice.amount), payment_method || 'internal', payment_channel || 'manual', (req.user && req.user.id) || 0, paidAt, notes || invoice.notes, invoiceId]
    );

    await db.query(
      'INSERT INTO payment_status_history (invoice_id, old_status, new_status, changed_by, notes) VALUES (?, ?, ?, ?, ?)',
      [invoiceId, invoice.status, 'paid', (req.user && req.user.id) || 0, notes || 'Pembayaran disetujui oleh bendahara']
    );

    await db.query(
      'UPDATE students SET iuran_bulanan = ? WHERE id = ?',
      [parseFloat(paid_amount || invoice.amount), invoice.student_id]
    );

    res.json({ success: true, message: 'Pembayaran berhasil disetujui' });
  } catch (error) {
    console.error('Approve internal payment error:', error);
    res.status(500).json({ success: false, message: 'Error approving payment' });
  }
});

// POST /api/payments/invoices/:id/reject - Reject payment
router.post('/payments/invoices/:id/reject', async (req, res) => {
  try {
    const invoiceId = req.params.id;
    const { notes } = req.body;

    const [invoice] = await db.query('SELECT * FROM payment_invoices WHERE id = ?', [invoiceId]);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice tidak ditemukan' });
    }

    if (invoice.status === 'paid') {
      return res.status(400).json({ success: false, message: 'Invoice sudah lunas' });
    }

    await db.query(
      'UPDATE payment_invoices SET status = ?, notes = ? WHERE id = ?',
      ['pending', notes || invoice.notes, invoiceId]
    );

    await db.query(
      'INSERT INTO payment_status_history (invoice_id, old_status, new_status, changed_by, notes) VALUES (?, ?, ?, ?, ?)',
      [invoiceId, invoice.status, 'pending', (req.user && req.user.id) || 0, notes || 'Pembayaran ditolak/dikembalikan ke pending']
    );

    res.json({ success: true, message: 'Invoice dikembalikan ke pending' });
  } catch (error) {
    console.error('Reject internal payment error:', error);
    res.status(500).json({ success: false, message: 'Error rejecting payment' });
  }
});

// POST /api/payments/invoices/:id/cancel - Cancel invoice (testing, public)
router.post('/payments/invoices/:id/cancel', async (req, res) => {
  try {
    const invoiceId = req.params.id;
    const { notes } = req.body;

    const [invoice] = await db.query('SELECT * FROM payment_invoices WHERE id = ?', [invoiceId]);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice tidak ditemukan' });
    }

    await db.query(
      'UPDATE payment_invoices SET status = ?, notes = ? WHERE id = ?',
      ['cancelled', notes || invoice.notes, invoiceId]
    );

    await db.query(
      'INSERT INTO payment_status_history (invoice_id, old_status, new_status, changed_by, notes) VALUES (?, ?, ?, ?, ?)',
      [invoiceId, invoice.status, 'cancelled', (req.user && req.user.id) || 0, notes || 'Invoice dibatalkan (mode testing)']
    );

    res.json({ success: true, message: 'Invoice dibatalkan' });
  } catch (error) {
    console.error('Cancel internal payment error:', error);
    res.status(500).json({ success: false, message: 'Error cancelling payment' });
  }
});

// DELETE /api/payments/invoices/:id - Delete invoice (testing, public)
router.delete('/payments/invoices/:id', async (req, res) => {
  try {
    const invoiceId = req.params.id;

    const [invoice] = await db.query('SELECT * FROM payment_invoices WHERE id = ?', [invoiceId]);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice tidak ditemukan' });
    }

    await db.query('DELETE FROM payment_status_history WHERE invoice_id = ?', [invoiceId]);
    await db.query('DELETE FROM payment_invoices WHERE id = ?', [invoiceId]);

    res.json({ success: true, message: 'Invoice dihapus' });
  } catch (error) {
    console.error('Delete internal payment error:', error);
    res.status(500).json({ success: false, message: 'Error deleting payment' });
  }
});

// POST /api/payments/invoices/:id/upload-proof - Upload payment proof
router.post('/payments/invoices/:id/upload-proof', async (req, res) => {
  try {
    const invoiceId = req.params.id;
    const { payment_proof_url, notes } = req.body;

    const [invoice] = await db.query('SELECT * FROM payment_invoices WHERE id = ?', [invoiceId]);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice tidak ditemukan' });
    }

    await db.query(
      'UPDATE payment_invoices SET payment_proof_url = ?, notes = ? WHERE id = ?',
      [payment_proof_url || null, notes || invoice.notes, invoiceId]
    );

    await db.query(
      'INSERT INTO payment_status_history (invoice_id, old_status, new_status, changed_by_type, notes) VALUES (?, ?, ?, ?, ?)',
      [invoiceId, invoice.status, invoice.status, 'system', 'Bukti pembayaran diupload']
    );

    res.json({ success: true, message: 'Bukti pembayaran berhasil diupload' });
  } catch (error) {
    console.error('Upload payment proof error:', error);
    res.status(500).json({ success: false, message: 'Error uploading payment proof' });
  }
});

// GET /api/payments/summary - Payment summary
router.get('/payments/summary', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    const month = req.query.month || `${now().getFullYear()}-${String(now().getMonth() + 1).padStart(2, '0')}`;

    if (req.user.role !== 'admin' && !tenantId) {
      const treasurerAssignments = (req.user.assignments || []).filter(a => {
        const roles = ['bendahara', 'tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (treasurerAssignments.length === 1) {
        tenantId = treasurerAssignments[0].tenant_id;
      }
    }

    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'tenant_id required' });
    }

    if (!verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const [summary] = await db.query(
      `SELECT 
        COUNT(*) as total_siswa,
        SUM(CASE WHEN pi.status = 'paid' THEN 1 ELSE 0 END) as sudah_bayar,
        SUM(CASE WHEN pi.status IN ('pending', 'expired') THEN 1 ELSE 0 END) as belum_bayar,
        SUM(CASE WHEN pi.due_date < ? AND pi.status != 'paid' THEN 1 ELSE 0 END) as terlambat,
        SUM(CASE WHEN pi.status = 'paid' THEN pi.paid_amount ELSE 0 END) as total_pemasukan,
        SUM(pi.amount) as total_tagihan
      FROM students s
      LEFT JOIN payment_invoices pi ON s.id = pi.student_id AND pi.periode = ?
      WHERE ${isSuperAdminTenant(tenantId) ? '1=1' : 's.tenant_id = ?'}`,
      isSuperAdminTenant(tenantId) ? [now().toISOString().slice(0, 10), month] : [now().toISOString().slice(0, 10), month, tenantId]
    );

    const summaryRow = summary[0] || {
      total_siswa: 0,
      sudah_bayar: 0,
      belum_bayar: 0,
      terlambat: 0,
      total_pemasukan: 0,
      total_tagihan: 0
    };

    res.json({
      success: true,
      data: {
        tenant_id: tenantId,
        periode: month,
        total_siswa: summaryRow.total_siswa || 0,
        sudah_bayar: summaryRow.sudah_bayar || 0,
        belum_bayar: summaryRow.belum_bayar || 0,
        terlambat: summaryRow.terlambat || 0,
        total_pemasukan: parseFloat(summaryRow.total_pemasukan) || 0,
        total_tagihan: parseFloat(summaryRow.total_tagihan) || 0
      }
    });
  } catch (error) {
    console.error('Payment summary error:', error);
    res.status(500).json({ success: false, message: 'Error fetching payment summary' });
  }
});

// GET /api/payments/summary-by-school - Payment summary by school
router.get('/payments/summary-by-school', async (req, res) => {
  console.log('[PAYMENTS_DEBUG] ROUTE HANDLER STARTED');
  try {
    console.log('[PAYMENTS_DEBUG] summary-by-school called with query:', req.query);
    let tenantId = req.query.tenant_id;
    const month = req.query.month || `${now().getFullYear()}-${String(now().getMonth() + 1).padStart(2, '0')}`;

    console.log('[PAYMENTS_DEBUG] tenantId:', tenantId, 'month:', month);

    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'tenant_id required' });
    }

    console.log('[PAYMENTS_DEBUG] building query...');

    let schoolQuery = `
      SELECT 
        tn.tenant_id,
        tn.nama_sekolah,
        COUNT(DISTINCT s.id) as total_siswa,
        SUM(CASE WHEN pi.status = 'paid' THEN 1 ELSE 0 END) as sudah_bayar,
        SUM(CASE WHEN pi.status IN ('pending', 'expired') THEN 1 ELSE 0 END) as belum_bayar,
        SUM(CASE WHEN pi.due_date < ? AND pi.status != 'paid' THEN 1 ELSE 0 END) as terlambat,
        SUM(COALESCE(pi.paid_amount, 0)) as total_pemasukan,
        SUM(COALESCE(pi.amount, 0)) as total_tagihan
      FROM tenants tn
      LEFT JOIN students s ON tn.tenant_id = s.tenant_id
      LEFT JOIN payment_invoices pi ON s.id = pi.student_id AND pi.periode = ?
      ${isSuperAdminTenant(tenantId) ? '' : 'WHERE tn.tenant_id = ?'}
      GROUP BY tn.tenant_id, tn.nama_sekolah
      ORDER BY tn.nama_sekolah ASC
    `;
    const schoolParams = isSuperAdminTenant(tenantId)
      ? [now().toISOString().slice(0, 10), month]
      : [now().toISOString().slice(0, 10), month, tenantId];

    const [rows] = await db.query(schoolQuery, schoolParams);
    console.log('[PAYMENTS_DEBUG] summary-by-school rows:', JSON.stringify(rows));
    const items = Array.isArray(rows) ? rows : (rows ? [rows] : []);

    res.json({
      success: true,
      data: items.map(r => ({
        ...r,
        total_siswa: r.total_siswa || 0,
        sudah_bayar: r.sudah_bayar || 0,
        belum_bayar: r.belum_bayar || 0,
        terlambat: r.terlambat || 0,
        total_pemasukan: parseFloat(r.total_pemasukan) || 0,
        total_tagihan: parseFloat(r.total_tagihan) || 0
      }))
    });
  } catch (error) {
    console.error('Payment summary by school error:', error);
    res.status(500).json({ success: false, message: 'Error fetching payment summary by school' });
  }
});

// GET /api/payments/send-reminder - Send payment reminder WhatsApp
router.post('/payments/send-reminder', authenticateOperator, async (req, res) => {
  try {
    const { tenant_id, invoice_id, student_id } = req.body;

    let query = `
      SELECT pi.id as invoice_id, pi.invoice_number, pi.amount, pi.due_date, pi.periode, s.nama_siswa, s.nis, p.no_wa as parent_wa, p.nama_orang_tua, tn.nama_sekolah
      FROM payment_invoices pi
      JOIN students s ON pi.student_id = s.id
      LEFT JOIN parents p ON s.parent_id = p.id
      JOIN tenants tn ON s.tenant_id = tn.tenant_id
      WHERE pi.status IN ('pending', 'expired')
    `;
    const params = [];

    if (invoice_id) {
      query += ' AND pi.id = ?';
      params.push(invoice_id);
    } else if (student_id && tenant_id) {
      if (!isSuperAdminTenant(tenant_id)) {
        query += ' AND pi.student_id = ? AND pi.tenant_id = ?';
        params.push(student_id, tenant_id);
      } else {
        query += ' AND pi.student_id = ?';
        params.push(student_id);
      }
    } else if (tenant_id) {
      if (!isSuperAdminTenant(tenant_id)) {
        query += ' AND pi.tenant_id = ?';
        params.push(tenant_id);
      }
    } else {
      return res.status(400).json({ success: false, message: 'tenant_id atau invoice_id wajib diisi' });
    }

    const invoices = await db.query(query, params);

    if (invoices.length === 0) {
      return res.json({ success: true, message: 'Tidak ada invoice yang perlu diingatkan', count: 0 });
    }

    const { sendWhatsAppTemplate, sendWhatsAppText } = require('./notifications');

    let sentCount = 0;
    for (const inv of invoices) {
      const wa = inv.parent_wa;
      if (!wa) continue;

      const message = `Assalamu'alaikum Bapak/Ibu ${inv.nama_orang_tua || 'Wali Murid'}, 

Ini adalah pengingat pembayaran SPP untuk:
- Siswa: ${inv.nama_siswa} (${inv.nis || '-'})
- Bulan: ${inv.periode}
- Jumlah: Rp ${parseFloat(inv.amount).toLocaleString('id-ID')}
- No. Invoice: ${inv.invoice_number}

Silakan lakukan pembayaran sebelum tanggal ${inv.due_date ? new Date(inv.due_date).toLocaleDateString('id-ID') : 'segera'}.

Hubungi admin/bendahara jika ada kendala. Terima kasih.`;

      try {
        await sendWhatsAppText(`62${wa.replace(/^0/, '')}`, message);
        sentCount++;
      } catch (err) {
        console.error(`Failed to send reminder to ${wa}:`, err.message);
      }
    }

    res.json({
      success: true,
      count: sentCount,
      message: `Pengingat terkirim ke ${sentCount} wali murid`
    });
  } catch (error) {
    console.error('Send reminder error:', error);
    res.status(500).json({ success: false, message: 'Error sending reminder' });
  }
});

// POST /api/payments/generate-monthly - Generate monthly invoices (auto on 1st)
router.post('/payments/generate-monthly', authenticateOperator, async (req, res) => {
  try {
    const { tenant_id, periode, amount, description } = req.body;

    if (!tenant_id) {
      return res.status(400).json({ success: false, message: 'tenant_id required' });
    }

    if (!verifyTenantAccess(req, tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const targetPeriode = periode || `${now().getFullYear()}-${String(now().getMonth() + 1).padStart(2, '0')}`;

    let studentsQuery = `
      SELECT s.id, s.tenant_id, s.parent_id, p.no_wa as parent_wa, p.nama_orang_tua, tn.nama_sekolah
      FROM students s
      JOIN tenants tn ON s.tenant_id = tn.tenant_id
      LEFT JOIN parents p ON s.parent_id = p.id
    `;
    const studentsParams = [];

    if (!isSuperAdminTenant(tenant_id)) {
      studentsQuery += ' WHERE s.tenant_id = ?';
      studentsParams.push(tenant_id);
    }

    const [students] = await db.query(studentsQuery, studentsParams);

    if (!students || students.length === 0) {
      return res.json({ success: true, message: isSuperAdminTenant(tenant_id) ? 'Tidak ada siswa di sistem' : 'Tidak ada siswa di tenant ini', count: 0 });
    }

    let createdCount = 0;
    let skippedCount = 0;

    for (const student of students) {
      const [existing] = await db.query(
        'SELECT id FROM payment_invoices WHERE student_id = ? AND tenant_id = ? AND periode = ?',
        [student.id, tenant_id, targetPeriode]
      );

      if (existing) {
        skippedCount++;
        continue;
      }

      const invoiceNumber = generateInvoiceNumber(student.tenant_id, targetPeriode, student.id);

      const [result] = await db.query(
        `INSERT INTO payment_invoices (tenant_id, student_id, invoice_number, amount, description, periode, status, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          student.tenant_id,
          student.id,
          invoiceNumber,
          parseFloat(amount || 0),
          description || `SPP ${student.nama_siswa} - ${student.nama_sekolah} - ${targetPeriode}`,
          targetPeriode,
          'pending',
          JSON.stringify({
            student_name: student.nama_siswa,
            school_name: student.nama_sekolah,
            parent_wa: student.parent_wa || null,
            parent_name: student.nama_orang_tua || null,
            type: 'SPP'
          })
        ]
      );

      const invoiceId = result.insertId;

      await db.query(
        'INSERT INTO payment_status_history (invoice_id, old_status, new_status, changed_by, notes) VALUES (?, ?, ?, ?, ?)',
        [invoiceId, null, 'pending', req.user.id, 'Invoice bulanan otomatis dibuat']
      );

      createdCount++;
    }

    res.json({
      success: true,
      count: createdCount,
      skipped: skippedCount,
      message: `Berhasil generate ${createdCount} invoice bulanan, ${skippedCount} dilewati karena sudah ada`
    });
  } catch (error) {
    console.error('Generate monthly invoices error:', error);
    res.status(500).json({ success: false, message: 'Error generating monthly invoices' });
  }
});

// GET /api/payments/public/invoice-status - Public endpoint to check invoice status
router.get('/payments/public/invoice-status', async (req, res) => {
  try {
    const invoiceNumber = req.query.invoice_number;
    if (!invoiceNumber) {
      return res.status(400).json({ success: false, message: 'invoice_number required' });
    }

    const [invoice] = await db.query('SELECT * FROM payment_invoices WHERE invoice_number = ?', [invoiceNumber]);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice tidak ditemukan' });
    }

    const [student] = await db.query('SELECT s.nama_siswa, s.nis, tn.nama_sekolah, p.no_wa as parent_wa FROM students s JOIN tenants tn ON s.tenant_id = tn.tenant_id LEFT JOIN parents p ON s.parent_id = p.id WHERE s.id = ?', [invoice.student_id]);

    const history = await db.query('SELECT * FROM payment_status_history WHERE invoice_id = ? ORDER BY created_at ASC', [invoice.id]);

    res.json({
      success: true,
      data: {
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        amount: parseFloat(invoice.amount),
        description: invoice.description,
        periode: invoice.periode,
        status: invoice.status,
        due_date: invoice.due_date,
        paid_at: invoice.paid_at,
        paid_amount: invoice.paid_amount ? parseFloat(invoice.paid_amount) : null,
        payment_method: invoice.payment_method,
        payment_channel: invoice.payment_channel,
        payment_proof_url: invoice.payment_proof_url,
        created_at: invoice.created_at,
        updated_at: invoice.updated_at,
        student_name: student[0]?.nama_siswa || null,
        student_nis: student[0]?.nis || null,
        school_name: student[0]?.nama_sekolah || null,
        parent_wa: student[0]?.parent_wa || null,
        history
      }
    });
  } catch (error) {
    console.error('Public invoice status error:', error);
    res.status(500).json({ success: false, message: 'Error fetching invoice status' });
  }
});

// GET /api/payments/settings - Get payment settings for a tenant
router.get('/payments/settings', authenticateAdmin, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'tenant_id required' });
    }

    if (!verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const [settings] = await db.query(
      'SELECT monthly_amount, due_day FROM payment_settings WHERE tenant_id = ? LIMIT 1',
      [tenantId]
    );

    res.json({
      success: true,
      data: settings || { monthly_amount: null, due_day: 10 }
    });
  } catch (error) {
    console.error('Get payment settings error:', error);
    res.status(500).json({ success: false, message: 'Error fetching payment settings' });
  }
});

// POST /api/payments/settings - Update payment settings (admin only)
router.post('/payments/settings', authenticateAdmin, async (req, res) => {
  try {
    const { tenant_id, monthly_amount, due_day } = req.body;

    if (!tenant_id) {
      return res.status(400).json({ success: false, message: 'tenant_id required' });
    }

    if (!verifyTenantAccess(req, tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const [existing] = await db.query('SELECT tenant_id FROM payment_settings WHERE tenant_id = ?', [tenant_id]);
    if (existing) {
      await db.query(
        'UPDATE payment_settings SET monthly_amount = ?, due_day = ?, updated_at = NOW() WHERE tenant_id = ?',
        [monthly_amount ? parseFloat(monthly_amount) : null, due_day ? parseInt(due_day) : 10, tenant_id]
      );
    } else {
      await db.query(
        'INSERT INTO payment_settings (tenant_id, monthly_amount, due_day) VALUES (?, ?, ?)',
        [tenant_id, monthly_amount ? parseFloat(monthly_amount) : null, due_day ? parseInt(due_day) : 10]
      );
    }

    res.json({ success: true, message: 'Pengaturan pembayaran berhasil disimpan' });
  } catch (error) {
    console.error('Save payment settings error:', error);
    res.status(500).json({ success: false, message: 'Error saving payment settings' });
  }
});

module.exports = router;
