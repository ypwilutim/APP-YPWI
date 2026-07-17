const express = require('express');
const db = require('../../db');

const router = express.Router();

// GET /api/public/catalog - Public list of YPWI Lutim units and SPP reference prices
// Used by the public "Produk & Harga" page (Midtrans verification requirement)
router.get('/public/catalog', async (req, res) => {
  try {
    const units = await db.query(
      `SELECT tenant_id, tipe_unit, nama_sekolah FROM tenants ORDER BY tipe_unit, nama_sekolah`
    );

    // Reference iuran diambil dari students (nilai bervariasi per siswa)
    let iuranMap = {};
    try {
      const rows = await db.query(
        `SELECT tenant_id, MIN(iuran_bulanan) as min_iuran FROM students WHERE iuran_bulanan > 0 GROUP BY tenant_id`
      );
      (rows || []).forEach(r => {
        const v = r.min_iuran ? String(r.min_iuran).replace(/[^0-9]/g, '') : '';
        iuranMap[r.tenant_id] = v ? parseInt(v, 10) : null;
      });
    } catch (e) {
      console.warn('Catalog iuran lookup skipped:', e.message);
    }

    const data = (units || []).map(r => ({
      tenant_id: r.tenant_id,
      tipe_unit: r.tipe_unit,
      nama: r.nama_sekolah,
      iuran_bulanan: iuranMap[r.tenant_id] || null
    }));

    res.json({ success: true, data });
  } catch (e) {
    console.error('Public catalog error:', e);
    res.status(500).json({ success: false, message: 'Gagal memuat katalog' });
  }
});

// GET /api/public/info - Public business identity & contact info
router.get('/public/info', (req, res) => {
  const phone = process.env.PUBLIC_BIZ_PHONE || ''
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
  })
})

router.get('/public/active-gateway/:tenant_id', async (req, res) => {
  try {
    const tenant_id = req.params.tenant_id.toUpperCase()
    const [gw] = await db.query('SELECT gateway, is_active, config FROM payment_gateways WHERE tenant_id = ? AND is_active = 1 LIMIT 1', [tenant_id])
    if (!gw) return res.status(404).json({ success: false, message: 'Tidak ada gateway aktif' })
    res.json({ success: true, data: { gateway: gw.gateway, config: gw.config } })
  } catch (e) {
    res.status(500).json({ success: false, message: 'Error fetching active gateway' })
  }
})

router.get('/public/student/:tenant_id/:nis', async (req, res) => {
  try {
    const tenant_id = req.params.tenant_id.toUpperCase()
    const nis = req.params.nis
    const [student] = await db.query('SELECT id, nisn, nama_siswa, iuran_bulanan FROM students WHERE tenant_id = ? AND nisn = ? LIMIT 1', [tenant_id, nis])
    if (!student) return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' })
    res.json({ success: true, data: student })
  } catch (e) {
    res.status(500).json({ success: false, message: 'Error fetching student' })
  }
})

module.exports = router
