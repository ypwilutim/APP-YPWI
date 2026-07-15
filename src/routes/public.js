const express = require('express');
const db = require('../../db');

const router = express.Router();

// GET /api/public/catalog - Public list of YPWI Lutim units and SPP prices
// Used by the public "Produk & Harga" page (Midtrans verification requirement)
router.get('/public/catalog', async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT tenant_id, tipe_unit, nama_sekolah, iuran_bulanan
       FROM tenants
       ORDER BY tipe_unit, nama_sekolah`
    );

    const units = (rows || []).map(r => {
      const raw = r.iuran_bulanan ? String(r.iuran_bulanan).replace(/[^0-9]/g, '') : '';
      return {
        tenant_id: r.tenant_id,
        tipe_unit: r.tipe_unit,
        nama: r.nama_sekolah,
        iuran_bulanan: raw ? parseInt(raw, 10) : null
      };
    });

    res.json({ success: true, data: units });
  } catch (e) {
    console.error('Public catalog error:', e);
    res.status(500).json({ success: false, message: 'Gagal memuat katalog' });
  }
});

// GET /api/public/info - Public business identity & contact info
router.get('/public/info', (req, res) => {
  const phone = process.env.PUBLIC_BIZ_PHONE || '';
  res.json({
    success: true,
    data: {
      name: process.env.PUBLIC_BIZ_NAME || 'YPWI Lutim',
      legal_name: process.env.PUBLIC_BIZ_LEGAL || process.env.PUBLIC_BIZ_NAME || 'YPWI Lutim',
      address: process.env.PUBLIC_BIZ_ADDRESS || '',
      phone: phone,
      whatsapp: phone ? '62' + phone.replace(/^0+/, '') : '',
      email: process.env.PUBLIC_BIZ_EMAIL || process.env.EMAIL_USER || 'admin@ypwilutim.com',
      domain: `${req.protocol}://${req.get('host')}`
    }
  });
});

module.exports = router;
