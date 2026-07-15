const express = require('express');
const db = require('../../db');
const axios = require('axios');
const crypto = require('crypto');
const { authenticateOperator, verifyTenantAccess } = require('../middleware/auth');

const router = express.Router();

function snapBase(isProduction) {
  return isProduction ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com';
}
function apiBase(isProduction) {
  return isProduction ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';
}
function snapJsUrl(isProduction) {
  return isProduction ? 'https://app.midtrans.com/snap/snap.js' : 'https://app.sandbox.midtrans.com/snap/snap.js';
}
function authHeader(serverKey) {
  return 'Basic ' + Buffer.from(serverKey + ':').toString('base64');
}

async function getMidtransConfig(tenantId) {
  try {
    const [tenant] = await db.query(
      'SELECT midtrans_server_key, midtrans_client_key, midtrans_enabled, midtrans_is_production FROM tenants WHERE tenant_id = ?',
      [tenantId]
    );
    if (tenant && tenant.midtrans_server_key) {
      return {
        serverKey: tenant.midtrans_server_key,
        clientKey: tenant.midtrans_client_key,
        enabled: tenant.midtrans_enabled === 1,
        isProduction: tenant.midtrans_is_production === 1
      };
    }
  } catch (e) {
    console.error('Get midtrans config error:', e.message);
  }
  return {
    serverKey: process.env.MIDTRANS_SERVER_KEY || null,
    clientKey: process.env.MIDTRANS_CLIENT_KEY || null,
    enabled: process.env.MIDTRANS_ENABLED === 'true',
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true'
  };
}

async function computeAmount(studentId, tenantId, override) {
  if (override !== undefined && override !== null && override !== '' && !isNaN(parseFloat(override))) {
    return Math.round(parseFloat(override));
  }
  const [student] = await db.query('SELECT iuran_bulanan FROM students WHERE id = ? AND tenant_id = ?', [studentId, tenantId]);
  const base = parseFloat(student && student.iuran_bulanan) || 0;
  const [arrears] = await db.query(
    "SELECT COALESCE(SUM(amount),0) as total FROM payment_invoices WHERE student_id = ? AND tenant_id = ? AND status NOT IN ('paid','cancelled')",
    [studentId, tenantId]
  );
  return Math.round(base + (parseFloat(arrears && arrears.total) || 0));
}

function mapStatus(transactionStatus, fraudStatus) {
  if (transactionStatus === 'capture') {
    return fraudStatus === 'challenge' ? 'pending' : 'paid';
  }
  if (transactionStatus === 'settlement') return 'paid';
  if (transactionStatus === 'pending') return 'pending';
  if (transactionStatus === 'deny' || transactionStatus === 'cancel') return 'failed';
  if (transactionStatus === 'expire') return 'expired';
  return 'pending';
}

// Self-healing schema: create table + columns if missing (no manual migration needed)
let schemaReady = false;
async function ensureMidtransSchema() {
  if (schemaReady) return;
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS midtrans_transactions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(20),
      student_id INT,
      order_id VARCHAR(100) NOT NULL,
      gross_amount DECIMAL(12,2) DEFAULT 0,
      transaction_status VARCHAR(50),
      payment_type VARCHAR(50),
      status VARCHAR(30),
      snap_token VARCHAR(255),
      redirect_url VARCHAR(512),
      raw TEXT,
      paid_at DATETIME,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_order (order_id),
      INDEX idx_tenant (tenant_id),
      INDEX idx_student (student_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    const cols = await db.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tenants'`,
      [process.env.DB_NAME]
    );
    const existing = new Set((cols || []).map(c => c.COLUMN_NAME));
    const want = {
      midtrans_server_key: 'VARCHAR(255) NULL',
      midtrans_client_key: 'VARCHAR(255) NULL',
      midtrans_enabled: 'TINYINT(1) DEFAULT 0',
      midtrans_is_production: 'TINYINT(1) DEFAULT 0'
    };
    for (const [name, def] of Object.entries(want)) {
      if (!existing.has(name)) {
        try {
          await db.query(`ALTER TABLE tenants ADD COLUMN ${name} ${def}`);
        } catch (e) {
          console.error(`[MIDTRANS] add column ${name} failed:`, e.message);
        }
      }
    }
    schemaReady = true;
    console.log('[MIDTRANS] schema ensured');
  } catch (e) {
    console.error('[MIDTRANS] ensureMidtransSchema error:', e.message);
  }
}
ensureMidtransSchema().catch(() => {});

async function buildAndCreate({ tenantId, studentId, amount, description, redirectUrl, req }) {
  const config = await getMidtransConfig(tenantId);
  if (!config.serverKey || !config.enabled) {
    throw new Error('Midtrans belum dikonfigurasi untuk tenant ini');
  }

  const [student] = await db.query(
    `SELECT s.*, tn.nama_sekolah, p.no_wa as parent_wa, p.email as parent_email
     FROM students s JOIN tenants tn ON s.tenant_id = tn.tenant_id
     LEFT JOIN parents p ON s.parent_id = p.id WHERE s.id = ?`,
    [studentId]
  );
  if (!student) throw new Error('Siswa tidak ditemukan');

  const grossAmount = await computeAmount(studentId, tenantId, amount);
  if (grossAmount <= 0) throw new Error('Amount tidak valid');

  const periode = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const orderId = `SPP-${tenantId}-${studentId}-${periode}-${Date.now()}`;
  const base = `${req.protocol}://${req.get('host')}`;
  const finishUrl = redirectUrl || `${base}/midtrans-payment.html?order_id=${encodeURIComponent(orderId)}`;

  const itemName = (description || `SPP ${student.nama_siswa} - ${student.nama_sekolah}`).slice(0, 50);
  const emailValid = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e || '');
  const customer = { first_name: (student.nama_siswa || 'Siswa').slice(0, 20), phone: student.parent_wa || '' };
  if (emailValid(student.parent_email)) customer.email = student.parent_email;

  const payload = {
    transaction_details: { order_id: orderId, gross_amount: grossAmount },
    item_details: [{
      id: 'SPP',
      name: itemName,
      price: grossAmount,
      quantity: 1
    }],
    customer_details: customer,
    callbacks: {
      finish: finishUrl,
      error: finishUrl,
      pending: finishUrl,
      notification: `${base}/api/midtrans/notification`
    }
  };

  const response = await axios.post(
    `${snapBase(config.isProduction)}/snap/v1/transactions`,
    payload,
    { headers: { Authorization: authHeader(config.serverKey), 'Content-Type': 'application/json' } }
  );

  await db.query(
    `INSERT INTO midtrans_transactions (tenant_id, student_id, order_id, gross_amount, status, snap_token, redirect_url, transaction_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [tenantId, studentId, orderId, grossAmount, 'pending', response.data.token, response.data.redirect_url, 'pending']
  );

  return {
    order_id: orderId,
    token: response.data.token,
    redirect_url: response.data.redirect_url,
    amount: grossAmount,
    client_key: config.clientKey,
    snap_js_url: snapJsUrl(config.isProduction),
    finish_url: finishUrl
  };
}

async function applyNotification(notif) {
  const orderId = notif.order_id;
  const [tx] = await db.query('SELECT * FROM midtrans_transactions WHERE order_id = ?', [orderId]);
  if (!tx) return null;

  const config = await getMidtransConfig(tx.tenant_id);
  if (notif.signature_key) {
    const expected = crypto.createHash('sha512')
      .update(orderId + notif.status_code + notif.gross_amount + config.serverKey)
      .digest('hex');
    if (expected !== notif.signature_key) {
      throw new Error('invalid signature');
    }
  }

  const status = mapStatus(notif.transaction_status, notif.fraud_status);
  const isPaid = status === 'paid';
  if (isPaid) {
    await db.query('UPDATE students SET iuran_bulanan = ? WHERE id = ?', [tx.gross_amount, tx.student_id]);
  }
  await db.query(
    'UPDATE midtrans_transactions SET transaction_status = ?, payment_type = ?, status = ?, raw = ?, paid_at = ? WHERE order_id = ?',
    [notif.transaction_status, notif.payment_type || null, status, JSON.stringify(notif), isPaid ? new Date() : null, orderId]
  );
  return { order_id: orderId, status, transaction_status: notif.transaction_status };
}

// GET /api/midtrans/settings
router.get('/midtrans/settings', authenticateOperator, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    if (!tenantId) return res.status(400).json({ success: false, message: 'tenant_id required' });
    if (!verifyTenantAccess(req, tenantId)) return res.status(403).json({ success: false, message: 'Akses ditolak' });

    const config = await getMidtransConfig(tenantId);
    res.json({
      success: true,
      data: {
        tenant_id: tenantId,
        midtrans_server_key: config.serverKey ? '••••••••' : null,
        midtrans_client_key: config.clientKey ? '••••••••' : null,
        midtrans_enabled: config.enabled,
        midtrans_is_production: config.isProduction
      }
    });
  } catch (e) {
    console.error('Get midtrans settings error:', e);
    res.status(500).json({ success: false, message: 'Error fetching midtrans settings' });
  }
});

// PUT /api/midtrans/settings (admin only)
router.put('/midtrans/settings', authenticateOperator, async (req, res) => {
  try {
    const { tenant_id, midtrans_server_key, midtrans_client_key, midtrans_enabled, midtrans_is_production } = req.body;
    if (!tenant_id) return res.status(400).json({ success: false, message: 'tenant_id required' });
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Hanya admin yang dapat mengubah pengaturan Midtrans' });
    if (!verifyTenantAccess(req, tenant_id)) return res.status(403).json({ success: false, message: 'Akses ditolak' });

    const fields = [];
    const values = [];
    if (midtrans_server_key !== undefined) { fields.push('midtrans_server_key = ?'); values.push(midtrans_server_key || null); }
    if (midtrans_client_key !== undefined) { fields.push('midtrans_client_key = ?'); values.push(midtrans_client_key || null); }
    if (midtrans_enabled !== undefined) { fields.push('midtrans_enabled = ?'); values.push(midtrans_enabled ? 1 : 0); }
    if (midtrans_is_production !== undefined) { fields.push('midtrans_is_production = ?'); values.push(midtrans_is_production ? 1 : 0); }

    if (fields.length) {
      values.push(tenant_id);
      await db.query(`UPDATE tenants SET ${fields.join(', ')} WHERE tenant_id = ?`, values);
    }
    res.json({ success: true, message: 'Pengaturan Midtrans berhasil disimpan' });
  } catch (e) {
    console.error('Update midtrans settings error:', e);
    res.status(500).json({ success: false, message: 'Error saving midtrans settings' });
  }
});

// POST /api/midtrans/create-transaction (operator)
router.post('/midtrans/create-transaction', authenticateOperator, async (req, res) => {
  try {
    const { tenant_id, student_id, amount, description, redirect_url } = req.body;
    if (!tenant_id || !student_id) return res.status(400).json({ success: false, message: 'tenant_id dan student_id wajib diisi' });
    if (!verifyTenantAccess(req, tenant_id)) return res.status(403).json({ success: false, message: 'Akses ditolak' });
    await ensureMidtransSchema();
    const data = await buildAndCreate({ tenantId: tenant_id, studentId: student_id, amount, description, redirectUrl: redirect_url, req });
    res.json({ success: true, message: 'Transaksi Midtrans berhasil dibuat', data });
  } catch (e) {
    console.error('Create midtrans transaction error:', e.response?.data || e.message);
    res.status(500).json({ success: false, message: e.response?.data?.error_messages?.[0] || e.message });
  }
});

// POST /api/midtrans/public/create-transaction (public, mirrors Xendit)
router.post('/midtrans/public/create-transaction', async (req, res) => {
  try {
    const { tenant_id, student_id, amount, description, redirect_url } = req.body;
    if (!tenant_id || !student_id) return res.status(400).json({ success: false, message: 'tenant_id dan student_id wajib diisi' });
    await ensureMidtransSchema();
    const data = await buildAndCreate({ tenantId: tenant_id, studentId: student_id, amount, description, redirectUrl: redirect_url, req });
    res.json({ success: true, message: 'Transaksi Midtrans berhasil dibuat', data });
  } catch (e) {
    console.error('Public create midtrans transaction error:', e.response?.data || e.message);
    res.status(500).json({ success: false, message: e.response?.data?.error_messages?.[0] || e.message });
  }
});

// POST /api/midtrans/notification (webhook from Midtrans)
router.post('/midtrans/notification', async (req, res) => {
  try {
    const result = await applyNotification(req.body);
    if (!result) return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });
    res.json({ success: true });
  } catch (e) {
    console.error('Midtrans notification error:', e);
    res.status(500).json({ success: false, message: 'Webhook processing error' });
  }
});

// GET /api/midtrans/status/:orderId and /api/midtrans/public/status/:orderId
async function handleStatus(req, res) {
  try {
    const orderId = req.params.orderId;
    const [tx] = await db.query('SELECT * FROM midtrans_transactions WHERE order_id = ?', [orderId]);
    if (!tx) return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });

    const config = await getMidtransConfig(tx.tenant_id);
    if (!config.serverKey) return res.status(400).json({ success: false, message: 'Midtrans belum dikonfigurasi' });

    const response = await axios.get(`${apiBase(config.isProduction)}/v2/${orderId}/status`, {
      headers: { Authorization: authHeader(config.serverKey) }
    });
    const notif = response.data;
    if (!notif || !notif.transaction_status) {
      return res.status(404).json({ success: false, message: notif?.status_message || 'Transaksi tidak ditemukan di Midtrans' });
    }
    const status = mapStatus(notif.transaction_status, notif.fraud_status);
    const isPaid = status === 'paid';
    if (isPaid && tx.status !== 'paid') {
      await db.query('UPDATE students SET iuran_bulanan = ? WHERE id = ?', [tx.gross_amount, tx.student_id]);
    }
    await db.query(
      'UPDATE midtrans_transactions SET transaction_status = ?, payment_type = ?, status = ?, raw = ?, paid_at = ? WHERE order_id = ?',
      [notif.transaction_status, notif.payment_type || null, status, JSON.stringify(notif), isPaid ? new Date() : null, orderId]
    );

    res.json({
      success: true,
      data: {
        order_id: orderId,
        transaction_status: notif.transaction_status,
        payment_type: notif.payment_type,
        gross_amount: parseFloat(notif.gross_amount),
        status,
        paid_at: isPaid ? new Date() : null
      }
    });
  } catch (e) {
    console.error('Midtrans status error:', e.response?.data || e.message);
    res.status(500).json({ success: false, message: 'Error checking midtrans status' });
  }
}
router.get('/midtrans/status/:orderId', handleStatus);
router.get('/midtrans/public/status/:orderId', handleStatus);

// GET /api/midtrans/sync-all-pending (operator) - reconcile pending transactions
router.get('/midtrans/sync-all-pending', authenticateOperator, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    if (!tenantId) return res.status(400).json({ success: false, message: 'tenant_id required' });
    if (!verifyTenantAccess(req, tenantId)) return res.status(403).json({ success: false, message: 'Akses ditolak' });

    const config = await getMidtransConfig(tenantId);
    if (!config.serverKey) return res.status(400).json({ success: false, message: 'Midtrans belum dikonfigurasi' });

    const invoices = await db.query(
      "SELECT id, student_id, order_id, gross_amount FROM midtrans_transactions WHERE tenant_id = ? AND status = 'pending'",
      [tenantId]
    );
    if (!invoices || invoices.length === 0) {
      return res.json({ success: true, message: 'Tidak ada transaksi pending', data: { updated: 0, paid: 0, expired: 0, failed: 0 } });
    }

    let updated = 0, paid = 0, expired = 0, failed = 0;
    for (const inv of invoices) {
      try {
        const response = await axios.get(`${apiBase(config.isProduction)}/v2/${inv.order_id}/status`, {
          headers: { Authorization: authHeader(config.serverKey) }
        });
        const notif = response.data;
        const status = mapStatus(notif.transaction_status, notif.fraud_status);
        if (status === 'paid') {
          await db.query('UPDATE students SET iuran_bulanan = ? WHERE id = ?', [inv.gross_amount, inv.student_id]);
          paid++;
        } else if (status === 'expired') expired++;
        else if (status === 'failed') failed++;
        else updated++;
        await db.query(
          'UPDATE midtrans_transactions SET transaction_status = ?, payment_type = ?, status = ?, raw = ? WHERE order_id = ?',
          [notif.transaction_status, notif.payment_type || null, status, JSON.stringify(notif), inv.order_id]
        );
      } catch (err) {
        console.error('[SYNC] failed', inv.order_id, err.message);
      }
    }
    res.json({ success: true, message: `Sinkron selesai: ${updated} updated, ${paid} paid, ${expired} expired, ${failed} failed`, data: { updated, paid, expired, failed } });
  } catch (e) {
    console.error('Sync all pending error:', e);
    res.status(500).json({ success: false, message: 'Error syncing' });
  }
});

module.exports = router;
