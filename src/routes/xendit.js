const express = require('express');
const db = require('../../db');
const axios = require('axios');
const { authenticateToken, authenticateOperator, verifyTenantAccess, isSuperAdminTenant } = require('../middleware/auth');

const router = express.Router();

const XENDIT_API_BASE = 'https://api.xendit.co';

function getXenditAuth(apiKey) {
  return Buffer.from(apiKey + ':').toString('base64');
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

// GET /api/xendit/settings - Get Xendit settings for a tenant
router.get('/xendit/settings', authenticateOperator, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'tenant_id required' });
    }

    if (!verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const config = await getTenantXenditConfig(tenantId);
    if (!config) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    res.json({
      success: true,
      data: {
        tenant_id: tenantId,
        xendit_api_key: config.xendit_api_key ? '••••••••' : null,
        xendit_public_key: config.xendit_public_key ? '••••••••' : null,
        xendit_webhook_token: config.xendit_webhook_token ? '••••••••' : null,
        xendit_enabled: config.xendit_enabled ? true : false
      }
    });
  } catch (error) {
    console.error('Get xendit settings error:', error);
    res.status(500).json({ success: false, message: 'Error fetching xendit settings' });
  }
});

// PUT /api/xendit/settings - Update Xendit settings (admin only)
router.put('/xendit/settings', authenticateOperator, async (req, res) => {
  try {
    const { tenant_id, xendit_api_key, xendit_public_key, xendit_webhook_token, xendit_enabled } = req.body;

    if (!tenant_id) {
      return res.status(400).json({ success: false, message: 'tenant_id required' });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Hanya admin yang dapat mengubah pengaturan Xendit' });
    }

    if (!verifyTenantAccess(req, tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const [existing] = await db.query('SELECT tenant_id FROM tenants WHERE tenant_id = ?', [tenant_id]);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Tenant tidak ditemukan' });
    }

    const updateFields = [];
    const updateValues = [];

    if (xendit_api_key !== undefined) {
      updateFields.push('xendit_api_key = ?');
      updateValues.push(xendit_api_key || null);
    }
    if (xendit_public_key !== undefined) {
      updateFields.push('xendit_public_key = ?');
      updateValues.push(xendit_public_key || null);
    }
    if (xendit_webhook_token !== undefined) {
      updateFields.push('xendit_webhook_token = ?');
      updateValues.push(xendit_webhook_token || null);
    }
    if (xendit_enabled !== undefined) {
      updateFields.push('xendit_enabled = ?');
      updateValues.push(xendit_enabled ? 1 : 0);
    }

    if (updateFields.length > 0) {
      updateValues.push(tenant_id);
      const queryStr = `UPDATE tenants SET ${updateFields.join(', ')} WHERE tenant_id = ?`;
      await db.query(queryStr, updateValues);
    }

    res.json({ success: true, message: 'Pengaturan Xendit berhasil disimpan' });
  } catch (error) {
    console.error('Update xendit settings error:', error);
    res.status(500).json({ success: false, message: 'Error saving xendit settings' });
  }
});

// POST /api/xendit/create-invoice - Create Xendit invoice for a student
router.post('/xendit/create-invoice', authenticateOperator, async (req, res) => {
  try {
    const { tenant_id, student_id, amount, description, payment_method, redirect_url } = req.body;

    if (!tenant_id || !student_id) {
      return res.status(400).json({ success: false, message: 'tenant_id dan student_id wajib diisi' });
    }

    if (!verifyTenantAccess(req, tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

const config = await getTenantXenditConfig(tenant_id);
    if (!config || !config.xendit_api_key || config.xendit_enabled !== 1) {
      return res.status(400).json({ success: false, message: 'Xendit belum dikonfigurasi untuk tenant ini' });
    }

    console.log('Creating invoice - student_id:', student_id, 'tenant_id:', tenant_id);
    const [student] = await db.query(
      'SELECT s.*, tn.nama_sekolah, p.no_wa as parent_wa FROM students s JOIN tenants tn ON s.tenant_id = tn.tenant_id LEFT JOIN parents p ON s.parent_id = p.id WHERE s.id = ?',
      [student_id]
    );
    console.log('Student query result:', student ? 'found' : 'not found');
    if (!student) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }

    const finalAmount = await computeInvoiceAmount(student_id, tenant_id, amount);

    const periode = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

    const [existing] = await db.query(
      'SELECT id, external_id, xendit_invoice_id FROM xendit_invoices WHERE student_id = ? AND tenant_id = ? AND status = "PENDING" ORDER BY created_at DESC LIMIT 1',
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
      } catch (e) { console.warn('Failed to expire old invoice:', e.message); }
    }

    const paymentMethods = payment_method === 'VIRTUAL_ACCOUNT'
      ? [{ type: 'VIRTUAL_ACCOUNT', virtual_account: { channel_code: ['MANDIRI', 'BNI', 'BRI', 'BSI', 'PERMATA', 'CIMB'] } }]
      : payment_method === 'QRIS'
        ? [{ type: 'QRIS' }]
        : [
          { type: 'VIRTUAL_ACCOUNT', virtual_account: { channel_code: ['MANDIRI', 'BNI', 'BRI', 'BSI', 'PERMATA', 'CIMB'] } },
          { type: 'QRIS' },
          { type: 'EWALLET', ewallet: { channel_code: ['SHOPEEPAY', 'LINKAJA', 'DANA', 'OVO'] } },
          { type: 'RETAIL_OUTLET', retail_outlet: { channel_code: ['ALFAMART', 'INDOMARET'] } }
        ];

    const externalId = `SPP-${tenant_id}-${student_id}-${periode}-${Date.now()}`;
    const callbackUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/api/xendit/webhook`;
    const successRedirect = redirect_url || `${process.env.BASE_URL || 'http://localhost:3000'}/xendit-payment.html?external_id=${externalId}`;
    const failureRedirect = redirect_url || `${process.env.BASE_URL || 'http://localhost:3000'}/xendit-payment.html?external_id=${externalId}`;

    const invoicePayload = {
      external_id: externalId,
      amount: finalAmount,
      description: description || `SPP ${student.nama_siswa} - ${student.nama_sekolah}`,
      invoice_duration: 31536000,
      currency: 'IDR',
      success_redirect_url: successRedirect,
      failure_redirect_url: failureRedirect
    };

console.log('Invoice payload being sent to Xendit:', JSON.stringify(invoicePayload, null, 2));
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

    console.log(`[CREATE-INVOICE] Invoice created: ${xenditInvoice.id} for student ${student_id}, tenant ${tenant_id}`);

await db.query(
       `INSERT INTO xendit_invoices (tenant_id, student_id, xendit_invoice_id, external_id, amount, description, status, payment_method, callback_url, invoice_url, expiry_date, installment_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
       [
         tenant_id,
         student_id,
         xenditInvoice.id,
         externalId,
         finalAmount,
         invoicePayload.description,
         xenditInvoice.status,
         payment_method || 'MULTIPLE',
         callbackUrl,
         xenditInvoice.invoice_url,
         xenditInvoice.expiry_date,
         installment_type || null
       ]
     );

    res.json({
       success: true,
       message: 'Invoice Xendit berhasil dibuat',
       data: {
         invoice_id: xenditInvoice.id,
         external_id: externalId,
         invoice_url: xenditInvoice.invoice_url,
        amount: finalAmount,
        status: xenditInvoice.status,
        expiry_date: xenditInvoice.expiry_date,
        payment_methods: xenditInvoice.available_payment_methods
      }
    });
  } catch (error) {
    console.error('Create xendit invoice error:', error.response?.data || error.message);
    res.status(500).json({ success: false, message: error.response?.data?.message || 'Error creating xendit invoice' });
  }
});

// POST /api/xendit/public/create-invoice - Create Xendit invoice (testing, public)
 router.post('/xendit/public/create-invoice', async (req, res) => {
   try {
     const { tenant_id, student_id, amount, description, payment_method, redirect_url, installment_type } = req.body;

     if (!tenant_id || !student_id) {
       return res.status(400).json({ success: false, message: 'tenant_id dan student_id wajib diisi' });
     }

     const config = await getTenantXenditConfig(tenant_id);
     if (!config || !config.xendit_api_key || config.xendit_enabled !== 1) {
       return res.status(400).json({ success: false, message: 'Xendit belum dikonfigurasi untuk tenant ini' });
     }

     const [student] = await db.query(
       'SELECT s.*, tn.nama_sekolah, p.no_wa as parent_wa FROM students s JOIN tenants tn ON s.tenant_id = tn.tenant_id LEFT JOIN parents p ON s.parent_id = p.id WHERE s.id = ?',
       [student_id]
     );
     if (!student) {
       return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
     }

     const finalAmount = installment_type === 'partial'
       ? (amount !== undefined && amount !== null && !isNaN(parseFloat(amount)) ? parseFloat(amount) : 0)
       : await computeInvoiceAmount(student_id, tenant_id, amount);

     if (finalAmount <= 0) {
       return res.status(400).json({ success: false, message: 'Amount tidak valid' });
     }

     const periode = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

if (installment_type !== 'partial') {
        const [existing] = await db.query(
          'SELECT id, xendit_invoice_id FROM xendit_invoices WHERE student_id = ? AND tenant_id = ? AND status IN ("PENDING", "OPEN") ORDER BY created_at DESC LIMIT 1',
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
          } catch (e) { console.warn('Failed to expire old invoice:', e.message); }
        }
      }

    const paymentMethods = payment_method === 'VIRTUAL_ACCOUNT'
      ? [{ type: 'VIRTUAL_ACCOUNT', virtual_account: { channel_code: ['MANDIRI', 'BNI', 'BRI', 'BSI', 'PERMATA', 'CIMB'] } }]
      : payment_method === 'QRIS'
        ? [{ type: 'QRIS' }]
        : [
          { type: 'VIRTUAL_ACCOUNT', virtual_account: { channel_code: ['MANDIRI', 'BNI', 'BRI', 'BSI', 'PERMATA', 'CIMB'] } },
          { type: 'QRIS' },
          { type: 'EWALLET', ewallet: { channel_code: ['SHOPEEPAY', 'LINKAJA', 'DANA', 'OVO'] } },
          { type: 'RETAIL_OUTLET', retail_outlet: { channel_code: ['ALFAMART', 'INDOMARET'] } }
        ];

    const externalId = `SPP-${tenant_id}-${student_id}-${periode}-${Date.now()}`;
    const callbackUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/api/xendit/webhook`;
    const successRedirect = redirect_url || `${process.env.BASE_URL || 'http://localhost:3000'}/xendit-payment.html?external_id=${externalId}`;
    const failureRedirect = redirect_url || `${process.env.BASE_URL || 'http://localhost:3000'}/xendit-payment.html?external_id=${externalId}`;

    const invoicePayload = {
      external_id: externalId,
      amount: finalAmount,
      description: description || `SPP ${student.nama_siswa} - ${student.nama_sekolah}`,
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

    console.log(`[PUBLIC] Invoice created: ${xenditInvoice.id} for student ${student_id}, tenant ${tenant_id}`);

await db.query(
       `INSERT INTO xendit_invoices (tenant_id, student_id, xendit_invoice_id, external_id, amount, description, status, payment_method, callback_url, invoice_url, expiry_date, installment_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
       [
         tenant_id,
         student_id,
         xenditInvoice.id,
         externalId,
         finalAmount,
         invoicePayload.description,
         xenditInvoice.status,
         payment_method || 'MULTIPLE',
         callbackUrl,
         xenditInvoice.invoice_url,
         xenditInvoice.expiry_date,
         installment_type || null
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
        payment_methods: xenditInvoice.available_payment_methods,
        installment_type: installment_type || null
      }
    });
   } catch (error) {
     console.error('Create public xendit invoice error:', error.response?.data || error.message);
     res.status(500).json({ success: false, message: error.response?.data?.message || 'Error creating xendit invoice' });
   }
 });

 // GET /api/xendit/public/invoices - List Xendit invoices (testing, public)
router.get('/xendit/public/invoices', async (req, res) => {
  try {
    const reqTenantId = req.query.tenant_id;
    const status = req.query.status;
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

    const isAll = !tenantId && (req.user && req.user.role === 'admin');
    let query = isAll ? 'SELECT * FROM xendit_invoices WHERE 1=1' : 'SELECT * FROM xendit_invoices WHERE tenant_id = ?';
    const params = isAll ? [] : [tenantId];

    if (!isAll && !tenantId) {
      return res.status(400).json({ success: false, message: 'tenant_id required' });
    }

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    if (req.query.periode) {
      query += ' AND external_id LIKE ?';
      params.push('%' + req.query.periode + '%');
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, (page - 1) * limit);

    const invoices = await db.query(query, params);

    let countSql = isAll ? 'SELECT COUNT(*) as total FROM xendit_invoices' : 'SELECT COUNT(*) as total FROM xendit_invoices WHERE tenant_id = ?';
    let countParams = isAll ? [] : [tenantId];
    if (status) {
      countSql += isAll ? ' WHERE status = ?' : ' AND status = ?';
      countParams.push(status);
    }
    const [countRow] = await db.query(countSql, countParams);

    res.json({
      success: true,
      data: invoices,
      pagination: { total: countRow.total, page, limit, total_pages: Math.ceil(countRow.total / limit) }
    });
  } catch (error) {
    console.error('List public xendit invoices error:', error);
    res.status(500).json({ success: false, message: 'Error fetching invoices' });
  }
});

// POST /api/xendit/public/create-invoices-batch - Batch create Xendit invoices (testing, public)
router.post('/xendit/public/create-invoices-batch', async (req, res) => {
  try {
    const { tenant_id, amount, description, payment_method } = req.body;
    const scope = (!tenant_id || isSuperAdminTenant(tenant_id)) ? null : tenant_id;
    const config = await getTenantXenditConfig(scope || 'YPWILUTIM');
    if (!config || !config.xendit_api_key || !config.xendit_enabled) {
      return res.status(400).json({ success: false, message: 'Xendit belum dikonfigurasi' });
    }

    const students = await db.query(
      `SELECT s.id, s.tenant_id, s.nama_siswa, tn.nama_sekolah FROM students s JOIN tenants tn ON s.tenant_id = tn.tenant_id ${scope ? 'WHERE s.tenant_id = ?' : ''}`,
      scope ? [scope] : []
    );

const paidRows = await db.query(
      `SELECT student_id FROM xendit_invoices WHERE ${scope ? 'tenant_id = ? AND' : ''} status = 'PAID'`,
      scope ? [scope] : []
    );
    const paidSet = new Set((paidRows || []).map(e => e.student_id));

    const pendingInvoices = await db.query(
      `SELECT student_id, id, xendit_invoice_id, amount FROM xendit_invoices WHERE ${scope ? 'tenant_id = ? AND' : ''} status IN ('PENDING','OPEN')`,
      scope ? [scope] : []
    );
    const pendingSyncMap = new Map((pendingInvoices || []).map(e => [e.student_id, e]));

    let created = 0, skipped = 0, failed = 0;
    for (const st of students) {
      console.log(`[BATCH] Processing student: ${st.id} - ${st.nama_siswa}`);
      if (paidSet.has(st.id)) {
        skipped++; continue;
      }
      if (pendingSyncMap.has(st.id)) {
        const existingInvoice = pendingSyncMap.get(st.id);
        if (existingInvoice && existingInvoice.xendit_invoice_id) {
          try {
            const syncResponse = await axios.get(`${XENDIT_API_BASE}/v2/invoices/${existingInvoice.xendit_invoice_id}`, { headers: { 'Authorization': `Basic ${getXenditAuth(config.xendit_api_key)}` } });
            const syncData = syncResponse.data;
            if (syncData.status === 'PAID' || syncData.status === 'SETTLED') {
              await db.query('UPDATE xendit_invoices SET status = ?, paid_at = NOW() WHERE id = ?', ['PAID', existingInvoice.id]);
              await db.query('UPDATE students SET iuran_bulanan = ?, updated_at = NOW() WHERE id = ?', [existingInvoice.amount || 0, st.id]);
              console.log(`[BATCH] Synced invoice ${existingInvoice.xendit_invoice_id} to PAID for student ${st.id}`);
            } else if (syncData.status === 'EXPIRED') {
              await db.query('UPDATE xendit_invoices SET status = "EXPIRED" WHERE id = ?', [existingInvoice.id]);
            }
          } catch (syncErr) {
            console.error('[BATCH] Sync error for invoice', existingInvoice.xendit_invoice_id, syncErr.response?.data || syncErr.message);
          }
        }
        skipped++; continue;
      }
      let finalAmount = parseFloat(amount);
      if (!finalAmount) {
        const [baseRow] = await db.query('SELECT iuran_bulanan FROM students WHERE id = ? AND tenant_id = ?', [st.id, st.tenant_id]);
        const [arrRow] = await db.query("SELECT COALESCE(SUM(amount),0) as total FROM xendit_invoices WHERE student_id = ? AND tenant_id = ? AND status NOT IN ('PAID','EXPIRED')", [st.id, st.tenant_id]);
        finalAmount = (parseFloat(baseRow && baseRow.iuran_bulanan) || 0) + (parseFloat(arrRow && arrRow.total) || 0);
      }
      if (!finalAmount) { skipped++; continue; }
      try {
        const externalId = `SPP-${st.tenant_id}-${st.id}-${Date.now()}-${created}`;
        const invoicePayload = {
          external_id: externalId,
          amount: finalAmount,
          description: description || `SPP ${st.nama_siswa} - ${st.nama_sekolah}`,
          invoice_duration: 31536000,
          currency: 'IDR',
          success_redirect_url: `${process.env.BASE_URL || 'http://localhost:3000'}/xendit-payment.html?external_id=${externalId}`,
          failure_redirect_url: `${process.env.BASE_URL || 'http://localhost:3000'}/xendit-payment.html?external_id=${externalId}`
        };
        const response = await axios.post(
          `${XENDIT_API_BASE}/v2/invoices`,
          invoicePayload,
          { headers: { 'Authorization': `Basic ${getXenditAuth(config.xendit_api_key)}`, 'Content-Type': 'application/json' } }
        );
        const xi = response.data;
        await db.query(
          `INSERT INTO xendit_invoices (tenant_id, student_id, xendit_invoice_id, external_id, amount, description, status, payment_method, callback_url, invoice_url, expiry_date) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [st.tenant_id, st.id, xi.id, externalId, finalAmount, invoicePayload.description, xi.status, payment_method || 'MULTIPLE', `${process.env.BASE_URL || 'http://localhost:3000'}/api/xendit/webhook`, xi.invoice_url, xi.expiry_date]
        );
        console.log(`[BATCH] Invoice created for student ${st.id}: ${xi.id}`);
        created++;
      } catch (e) {
        failed++;
      }
    }

    res.json({ success: true, message: `Berhasil buat ${created} invoice Xendit, ${skipped} dilewati, ${failed} gagal`, created, skipped, failed });
  } catch (error) {
    console.error('Batch create xendit invoices error:', error);
    res.status(500).json({ success: false, message: 'Error batch creating xendit invoices' });
  }
});

// GET /api/xendit/public/invoices/:id/sync - Sync Xendit invoice status (testing, public)
router.get('/xendit/public/invoices/:id/sync', async (req, res) => {
  try {
    const invoiceId = req.params.id;
    const [invoice] = await db.query('SELECT * FROM xendit_invoices WHERE id = ?', [invoiceId]);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice tidak ditemukan' });
    }

    const config = await getTenantXenditConfig(invoice.tenant_id);
    if (!config || !config.xendit_api_key) {
      return res.status(400).json({ success: false, message: 'Xendit belum dikonfigurasi' });
    }

    const response = await axios.get(
      `${XENDIT_API_BASE}/v2/invoices/${invoice.xendit_invoice_id}`,
      { headers: { 'Authorization': `Basic ${getXenditAuth(config.xendit_api_key)}` } }
    );

    const xenditInvoice = response.data;
    const isPaidOrSettled = xenditInvoice.status === 'PAID' || xenditInvoice.status === 'SETTLED';
    if (isPaidOrSettled) {
      await db.query('UPDATE students SET iuran_bulanan = ?, updated_at = NOW() WHERE id = ?', [invoice.amount, invoice.student_id]);
    }
    await db.query('UPDATE xendit_invoices SET status = ?, paid_at = ? WHERE id = ?', [
      xenditInvoice.status,
      isPaidOrSettled ? (xenditInvoice.paid_at || new Date()) : null,
      invoiceId
    ]);

    res.json({ success: true, data: { status: xenditInvoice.status, paid_at: xenditInvoice.paid_at || null } });
  } catch (error) {
    console.error('Sync public xendit invoice error:', error);
    res.status(500).json({ success: false, message: 'Error syncing invoice' });
  }
});

// DELETE /api/xendit/public/invoices/:id - Delete/cancel Xendit invoice (testing, public)
router.delete('/xendit/public/invoices/:id', async (req, res) => {
  try {
    const invoiceId = req.params.id;
    const [invoice] = await db.query('SELECT * FROM xendit_invoices WHERE id = ?', [invoiceId]);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice tidak ditemukan' });
    }

    const config = await getTenantXenditConfig(invoice.tenant_id);
    if (!config || !config.xendit_api_key) {
      return res.status(400).json({ success: false, message: 'Xendit belum dikonfigurasi' });
    }

    if (invoice.status !== 'PAID') {
      try {
        await axios.post(
          `${XENDIT_API_BASE}/v2/invoices/${invoice.xendit_invoice_id}/expire`,
          {},
          { headers: { 'Authorization': `Basic ${getXenditAuth(config.xendit_api_key)}` } }
        );
      } catch (e) {
        console.warn('Expire invoice failed:', e.message);
      }
      await db.query('UPDATE xendit_invoices SET status = "EXPIRED", updated_at = NOW() WHERE id = ?', [invoiceId]);
    }

    res.json({ success: true, message: 'Invoice dihapus' });
  } catch (error) {
    console.error('Delete public xendit invoice error:', error);
    res.status(500).json({ success: false, message: 'Error deleting invoice' });
  }
});

// GET /api/xendit/invoices - List invoices
router.get('/xendit/invoices', authenticateOperator, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    const status = req.query.status;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'tenant_id required' });
    }

    if (!verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const isAll = isSuperAdminTenant(tenantId);
    let query = isAll ? 'SELECT * FROM xendit_invoices WHERE 1=1' : 'SELECT * FROM xendit_invoices WHERE tenant_id = ?';
    const params = isAll ? [] : [tenantId];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, (page - 1) * limit);

    const invoices = await db.query(query, params);

    const [countRow] = await db.query(isAll ? 'SELECT COUNT(*) as total FROM xendit_invoices' : 'SELECT COUNT(*) as total FROM xendit_invoices WHERE tenant_id = ?', isAll ? [] : [tenantId]);

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
    console.error('List xendit invoices error:', error);
    res.status(500).json({ success: false, message: 'Error fetching invoices' });
  }
});

// GET /api/xendit/invoices/:id - Get invoice detail
router.get('/xendit/invoices/:id', authenticateOperator, async (req, res) => {
  try {
    const invoiceId = req.params.id;

    const [invoice] = await db.query('SELECT * FROM xendit_invoices WHERE id = ?', [invoiceId]);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice tidak ditemukan' });
    }

    if (!verifyTenantAccess(req, invoice.tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    res.json({ success: true, data: invoice });
  } catch (error) {
    console.error('Get xendit invoice error:', error);
    res.status(500).json({ success: false, message: 'Error fetching invoice' });
  }
});

// GET /api/xendit/invoices/:id/sync - Sync invoice status with Xendit
router.get('/xendit/invoices/:id/sync', authenticateOperator, async (req, res) => {
  try {
    const invoiceId = req.params.id;
    const [invoice] = await db.query('SELECT * FROM xendit_invoices WHERE id = ?', [invoiceId]);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice tidak ditemukan' });
    }

    if (!verifyTenantAccess(req, invoice.tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const config = await getTenantXenditConfig(invoice.tenant_id);
    if (!config || !config.xendit_api_key) {
      return res.status(400).json({ success: false, message: 'Xendit belum dikonfigurasi' });
    }

    const response = await axios.get(
      `${XENDIT_API_BASE}/v2/invoices/${invoice.xendit_invoice_id}`,
      {
        headers: {
          'Authorization': `Basic ${getXenditAuth(config.xendit_api_key)}`
        }
      }
    );

const xenditInvoice = response.data;
     const isPaidOrSettled = xenditInvoice.status === 'PAID' || xenditInvoice.status === 'SETTLED';
     if (xenditInvoice.status === 'PAID' || xenditInvoice.status === 'SETTLED') {
       await db.query('UPDATE students SET iuran_bulanan = ?, updated_at = NOW() WHERE id = ?', [
         invoice.amount,
         invoice.student_id
       ]);
     }

     await db.query('UPDATE xendit_invoices SET status = ?, paid_at = ? WHERE id = ?', [
       xenditInvoice.status,
       isPaidOrSettled ? (xenditInvoice.paid_at || new Date()) : null,
       invoiceId
     ]);

     res.json({ success: true, data: { status: xenditInvoice.status, paid_at: isPaidOrSettled ? (xenditInvoice.paid_at || new Date()) : null } });
  } catch (error) {
    console.error('Sync xendit invoice error:', error);
    res.status(500).json({ success: false, message: 'Error syncing invoice' });
  }
});

// POST /api/xendit/webhook - Xendit callback / webhook
router.post('/xendit/webhook', async (req, res) => {
  try {
    const { event, data } = req.body;

    console.log('Xendit webhook received:', event, data?.id);

    if (event === 'invoice.paid' || event === 'invoice.settled') {
      const [invoice] = await db.query(
        'SELECT * FROM xendit_invoices WHERE xendit_invoice_id = ?',
        [data.id]
      );

      if (invoice) {
        await db.query('UPDATE xendit_invoices SET status = ?, paid_at = NOW() WHERE id = ?', ['PAID', invoice.id]);
        await db.query('UPDATE students SET iuran_bulanan = ?, updated_at = NOW() WHERE id = ?', [
          invoice.amount,
          invoice.student_id
        ]);
        console.log(`[WEBHOOK] Invoice ${invoice.id} marked as PAID, student ${invoice.student_id} updated`);
      } else {
        console.log(`[WEBHOOK] Invoice not found for xendit_invoice_id: ${data.id}`);
      }
    }

    if (event === 'invoice.expired') {
      await db.query('UPDATE xendit_invoices SET status = ? WHERE xendit_invoice_id = ?', ['EXPIRED', data.id]);
      console.log(`[WEBHOOK] Invoice ${data.id} marked as EXPIRED`);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Xendit webhook error:', error);
    res.status(500).json({ success: false, message: 'Webhook processing error' });
  }
});

// POST /api/xendit/webhook-fallback - Manual webhook verification for testing
router.post('/api/xendit/webhook-fallback', async (req, res) => {
  try {
    const { invoice_id } = req.body;
    const config = await getTenantXenditConfig('YPWILUTIM');
    if (!config || !config.xendit_api_key) {
      return res.status(400).json({ success: false, message: 'Xendit belum dikonfigurasi' });
    }

    const response = await axios.get(
      `${XENDIT_API_BASE}/v2/invoices/${invoice_id}`,
      {
        headers: { 'Authorization': `Basic ${getXenditAuth(config.xendit_api_key)}` }
      }
    );

    const xenditInvoice = response.data;
    const [invoice] = await db.query('SELECT * FROM xendit_invoices WHERE xendit_invoice_id = ?', [invoice_id]);

if (invoice) {
       await db.query('UPDATE xendit_invoices SET status = ?, updated_at = NOW() WHERE xendit_invoice_id = ?', [
         xenditInvoice.status,
         invoice_id
       ]);
       if (xenditInvoice.status === 'PAID' || xenditInvoice.status === 'SETTLED') {
         await db.query('UPDATE students SET iuran_bulanan = ?, updated_at = NOW() WHERE id = ?', [
           invoice.amount,
           invoice.student_id
         ]);
       }
     }

    res.json({ success: true, data: xenditInvoice });
  } catch (error) {
    console.error('Webhook fallback error:', error);
    res.status(500).json({ success: false, message: 'Error' });
  }
});

// GET /api/xendit/public/invoice-status - Public endpoint to check invoice status
router.get('/xendit/public/invoice-status', async (req, res) => {
  try {
    const externalId = req.query.external_id;
    if (!externalId) {
      return res.status(400).json({ success: false, message: 'external_id required' });
    }

    const [invoice] = await db.query('SELECT * FROM xendit_invoices WHERE external_id = ?', [externalId]);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice tidak ditemukan' });
    }

    if (!invoice.xendit_invoice_id) {
      return res.status(404).json({ success: false, message: 'Invoice Xendit belum terhubung' });
    }

    const config = await getTenantXenditConfig(invoice.tenant_id);
    if (!config || !config.xendit_api_key) {
      return res.status(400).json({ success: false, message: 'Pembayaran belum dikonfigurasi' });
    }

    const response = await axios.get(
      `${XENDIT_API_BASE}/v2/invoices/${invoice.xendit_invoice_id}`,
      {
        headers: { 'Authorization': `Basic ${getXenditAuth(config.xendit_api_key)}` }
      }
    );

    const xenditInvoice = response.data;

if ((xenditInvoice.status === 'PAID' || xenditInvoice.status === 'SETTLED') && (invoice.status !== 'PAID' && invoice.status !== 'SETTLED')) {
       await db.query('UPDATE xendit_invoices SET status = ?, paid_at = NOW() WHERE id = ?', ['PAID', invoice.id]);
       await db.query('UPDATE students SET iuran_bulanan = ?, updated_at = NOW() WHERE id = ?', [invoice.amount, invoice.student_id]);
     }

    res.json({
      success: true,
      data: {
        external_id: invoice.external_id,
        description: invoice.description,
        amount: parseFloat(invoice.amount),
        status: xenditInvoice.status,
        invoice_url: xenditInvoice.invoice_url,
        payment_methods: xenditInvoice.available_payment_methods || [],
        paid_at: xenditInvoice.paid_at || invoice.paid_at,
        expiry_date: xenditInvoice.expiry_date
      }
    });
  } catch (error) {
    console.error('Public invoice status error:', error);
    res.status(500).json({ success: false, message: 'Error fetching invoice status' });
  }
});

// GET /api/xendit/debug-invoices - Debug list all invoices with status
router.get('/xendit/debug-invoices', async (req, res) => {
  try {
    const tenant_id = req.query.tenant_id;
    let query = 'SELECT id, tenant_id, student_id, external_id, xendit_invoice_id, amount, status, created_at, paid_at FROM xendit_invoices';
    let params = [];
    if (tenant_id) {
      query += ' WHERE tenant_id = ?';
      params.push(tenant_id);
    }
    query += ' ORDER BY created_at DESC LIMIT 50';
    const invoices = await db.query(query, params);
    res.json({ success: true, data: invoices });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/xendit/sync-all-pending - Sync all pending invoices status from Xendit
router.get('/xendit/sync-all-pending', authenticateOperator, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;

    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'tenant_id required' });
    }

    if (!verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const config = await getTenantXenditConfig(tenantId);
    if (!config || !config.xendit_api_key) {
      return res.status(400).json({ success: false, message: 'Xendit belum dikonfigurasi' });
    }

    const invoices = await db.query(
      'SELECT id, student_id, xendit_invoice_id, amount FROM xendit_invoices WHERE tenant_id = ? AND status IN (\'PENDING\', \'OPEN\')',
      [tenantId]
    );

    if (!invoices || invoices.length === 0) {
      return res.json({ success: true, message: 'Tidak ada invoice PENDING/OPEN', data: { updated: 0, paid: 0, expired: 0 } });
    }

    let updated = 0, paid = 0, expired = 0, failed = 0;

    for (const inv of invoices) {
      try {
        const response = await axios.get(
          `${XENDIT_API_BASE}/v2/invoices/${inv.xendit_invoice_id}`,
          { headers: { 'Authorization': `Basic ${getXenditAuth(config.xendit_api_key)}` } }
        );

        const xenditInvoice = response.data;
        const isPaidOrSettled = xenditInvoice.status === 'PAID' || xenditInvoice.status === 'SETTLED';

        if (isPaidOrSettled) {
          await db.query('UPDATE xendit_invoices SET status = ?, paid_at = ? WHERE id = ?', [
            xenditInvoice.status,
            xenditInvoice.paid_at || new Date(),
            inv.id
          ]);
          await db.query('UPDATE students SET iuran_bulanan = ?, updated_at = NOW() WHERE id = ?', [
            inv.amount,
            inv.student_id
          ]);
          paid++;
        } else if (xenditInvoice.status === 'EXPIRED') {
          await db.query('UPDATE xendit_invoices SET status = "EXPIRED", updated_at = NOW() WHERE id = ?', [inv.id]);
          expired++;
        } else {
          await db.query('UPDATE xendit_invoices SET status = ?, updated_at = NOW() WHERE id = ?', [
            xenditInvoice.status,
            inv.id
          ]);
        }
        updated++;
      } catch (err) {
        console.error(`[SYNC-ALL] Failed to sync invoice ${inv.xendit_invoice_id}:`, err.response?.data || err.message);
        failed++;
      }
    }

    res.json({
      success: true,
      message: `Sinkronisasi selesai: ${updated} diperbarui, ${paid} paid, ${expired} expired, ${failed} gagal`,
      data: { updated, paid, expired, failed }
    });
  } catch (error) {
    console.error('Sync all pending invoices error:', error);
    res.status(500).json({ success: false, message: 'Error syncing pending invoices' });
  }
});

// POST /api/treasurer/public/create-concession-invoice - Create concession invoice (additional installment)
router.post('/treasurer/public/create-concession-invoice', async (req, res) => {
  try {
    const { student_id, amount, description, payment_method, redirect_url } = req.body;

    if (!student_id) {
      return res.status(400).json({ success: false, message: 'student_id wajib diisi' });
    }

    const [student] = await db.query(
      'SELECT s.*, tn.nama_sekolah, tn.tenant_id, p.no_wa as parent_wa FROM students s JOIN tenants tn ON s.tenant_id = tn.tenant_id LEFT JOIN parents p ON s.parent_id = p.id WHERE s.id = ?',
      [student_id]
    );
    if (!student) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }

    const config = await getTenantXenditConfig(student.tenant_id);
    if (!config || !config.xendit_api_key || config.xendit_enabled !== 1) {
      return res.status(400).json({ success: false, message: 'Xendit belum dikonfigurasi untuk tenant ini' });
    }

    let finalAmount;
    if (amount !== undefined && amount !== null && amount !== '' && !isNaN(parseFloat(amount))) {
      finalAmount = parseFloat(amount);
    } else {
      const [arrears] = await db.query(
        "SELECT COALESCE(SUM(amount),0) as total FROM xendit_invoices WHERE student_id = ? AND tenant_id = ? AND status NOT IN ('PAID','EXPIRED')",
        [student_id, student.tenant_id]
      );
      const [paymentArrears] = await db.query(
        "SELECT COALESCE(SUM(amount),0) as total FROM payment_invoices WHERE student_id = ? AND tenant_id = ? AND status NOT IN ('paid','cancelled')",
        [student_id, student.tenant_id]
      );
      finalAmount = (parseFloat(arrears && arrears.total) || 0) + (parseFloat(paymentArrears && paymentArrears.total) || 0);
    }

    if (finalAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Amount tidak valid' });
    }

    const periode = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

    const paymentMethods = payment_method === 'VIRTUAL_ACCOUNT'
      ? [{ type: 'VIRTUAL_ACCOUNT', virtual_account: { channel_code: ['MANDIRI', 'BNI', 'BRI', 'BSI', 'PERMATA', 'CIMB'] } }]
      : payment_method === 'QRIS'
        ? [{ type: 'QRIS' }]
        : [
            { type: 'VIRTUAL_ACCOUNT', virtual_account: { channel_code: ['MANDIRI', 'BNI', 'BRI', 'BSI', 'PERMATA', 'CIMB'] } },
            { type: 'QRIS' },
            { type: 'EWALLET', ewallet: { channel_code: ['SHOPEEPAY', 'LINKAJA', 'DANA', 'OVO'] } },
            { type: 'RETAIL_OUTLET', retail_outlet: { channel_code: ['ALFAMART', 'INDOMARET'] } }
          ];

    const externalId = `CONCESSION-${student.tenant_id}-${student_id}-${Date.now()}`;
    const callbackUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/api/xendit/webhook`;
    const successRedirect = redirect_url || `${process.env.BASE_URL || 'http://localhost:3000'}/xendit-payment.html?external_id=${externalId}`;
    const failureRedirect = redirect_url || `${process.env.BASE_URL || 'http://localhost:3000'}/xendit-payment.html?external_id=${externalId}`;

    const invoicePayload = {
      external_id: externalId,
      amount: finalAmount,
      description: description || `Cicilan tambahan ${student.nama_siswa} - ${student.nama_sekolah}`,
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

    console.log(`[CONCESSION] Invoice created: ${xenditInvoice.id} for student ${student_id}, tenant ${student.tenant_id}`);

    await db.query(
      `INSERT INTO xendit_invoices (tenant_id, student_id, xendit_invoice_id, external_id, amount, description, status, payment_method, callback_url, invoice_url, expiry_date, installment_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        student.tenant_id,
        student_id,
        xenditInvoice.id,
        externalId,
        finalAmount,
        invoicePayload.description,
        xenditInvoice.status,
        payment_method || 'MULTIPLE',
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

async function createVaPayment(opts) {
  const { tenant_id, student_id, amount, external_id } = opts
  const config = await getTenantXenditConfig(tenant_id)
  if (!config || !config.xendit_api_key) {
    throw { response: { data: { message: 'Xendit belum dikonfigurasi' } } }
  }
  const [student] = await db.query(
    'SELECT s.*, tn.nama_sekolah FROM students s JOIN tenants tn ON s.tenant_id = tn.tenant_id WHERE s.id = ?',
    [student_id]
  )
  if (!student) throw { response: { data: { message: 'Siswa tidak ditemukan' } } }
  let finalAmount = parseFloat(amount)
  if (!finalAmount) {
    const base = parseFloat(student.iuran_bulanan) || 0
    const [arrears] = await db.query(
      "SELECT COALESCE(SUM(amount),0) as total FROM xendit_invoices WHERE student_id = ? AND tenant_id = ? AND status NOT IN ('PAID','EXPIRED')",
      [student_id, tenant_id]
    )
    finalAmount = base + (parseFloat(arrears && arrears.total) || 0)
  }
  const extId = external_id || `SPP-${tenant_id}-${student_id}-${Date.now()}`
  const invoicePayload = {
    external_id: extId,
    amount: finalAmount,
    description: `SPP ${student.nama_siswa} - ${student.nama_sekolah}`,
    invoice_duration: 31536000,
    currency: 'IDR',
    success_redirect_url: `${process.env.BASE_URL || 'http://localhost:3000'}/xendit-payment.html?external_id=${extId}`,
    failure_redirect_url: `${process.env.BASE_URL || 'http://localhost:3000'}/xendit-payment.html?external_id=${extId}`
  }
  const response = await axios.post(
    `${XENDIT_API_BASE}/v2/invoices`,
    invoicePayload,
    { headers: { 'Authorization': `Basic ${getXenditAuth(config.xendit_api_key)}`, 'Content-Type': 'application/json' } }
  )
  return { invoice_id: response.data.id, external_id: extId, invoice_url: response.data.invoice_url, amount: finalAmount }
}

module.exports = router;
module.exports.createVaPayment = createVaPayment
module.exports.createVaPayment = createVaPayment
