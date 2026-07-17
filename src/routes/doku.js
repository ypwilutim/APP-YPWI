const express = require('express');
const db = require('../../db');
const axios = require('axios');
const { authenticateOperator } = require('../middleware/auth');

const router = express.Router();

const DOKU_API_BASE = 'https://api.doku.com';
const DOKU_CLIENT_ID = process.env.DOKU_CLIENT_ID;
const DOKU_SECRET_KEY = process.env.DOKU_SECRET_KEY;

async function getTenantDokuConfig(tenantId) {
  try {
    const [gw] = await db.query(
      'SELECT api_key, api_secret, config FROM payment_gateways WHERE tenant_id = ? AND gateway = ? AND is_active = 1',
      [tenantId, 'doku']
    );
    return gw || null;
  } catch (e) {
    return null;
  }
}

router.post('/doku/create-invoice', async (req, res) => {
  try {
    const { tenant_id, student_id, amount } = req.body;
    if (!tenant_id || !student_id) {
      return res.status(400).json({ success: false, message: 'tenant_id dan student_id required' });
    }

    const [student] = await db.query(
      'SELECT id, nama_siswa, iuran_bulanan FROM students WHERE tenant_id = ? AND id = ?',
      [tenant_id, student_id]
    );
    if (!student) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }

    const gw = await getTenantDokuConfig(tenant_id);
    const clientId = gw?.api_key || DOKU_CLIENT_ID;
    const secretKey = gw?.api_secret || DOKU_SECRET_KEY;

    const invoiceAmount = amount || student.iuran_bulanan || 500000;
    const invoiceId = 'SPP-' + tenant_id + '-' + student_id + '-' + Date.now();

    const response = await axios.post(
      `${DOKU_API_BASE}/checkout/v1/payment`,
      {
        invoice_id: invoiceId,
        amount: invoiceAmount,
        currency: 'IDR',
        description: `SPP ${student.nama_siswa}`,
        callback_url: `${process.env.BASE_URL || 'http://localhost:3000'}/api/doku/callback`,
        redirect_url: `${process.env.BASE_URL || 'http://localhost:3000'}/success.html`
      },
      {
        headers: {
          'Client-Id': clientId,
          'Secret-Key': secretKey,
          'Content-Type': 'application/json'
        }
      }
    );

    await db.query(
      'INSERT INTO payment_transactions (tenant_id, student_id, gateway, external_id, amount, status, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [tenant_id, student_id, 'doku', invoiceId, invoiceAmount, 'pending', 'Invoice DOKU created']
    );

    const invoice_url = response.data?.redirect_url || response.data?.invoice_url;
    if (invoice_url) {
      res.json({ success: true, invoice_url });
    } else {
      res.json({ success: true, invoice_url: `${process.env.BASE_URL || 'http://localhost:3000'}/mock-payment.html?invoice=${invoiceId}` });
    }
  } catch (error) {
    console.error('DOKU create invoice error:', error.response?.data || error.message);
    const invoiceId = 'SPP-' + (req.body.tenant_id || 'demo') + '-' + (req.body.student_id || Date.now());
    const fallback_url = `${process.env.BASE_URL || 'http://localhost:3000'}/mock-payment.html?invoice=${invoiceId}`;
    res.json({ success: true, invoice_url: fallback_url });
  }
});

router.post('/doku/callback', async (req, res) => {
  try {
    const { invoice_id, status, amount } = req.body;
    
    if (status === 'success' || status === 'paid') {
      await db.query(
        'UPDATE payment_transactions SET status = ?, paid_at = NOW() WHERE external_id = ?',
        ['paid', invoice_id]
      );
    }
    
    res.json({ received: true });
  } catch (error) {
    console.error('DOKU callback error:', error);
    res.status(500).json({ received: false });
  }
});

module.exports = router;