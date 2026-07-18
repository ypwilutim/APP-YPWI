const express = require('express');
const db = require('../../db');
const { authenticateToken, authenticateOperator, verifyTenantAccess } = require('../middleware/auth');

const router = express.Router();

router.get('/treasurer/spp-summary', authenticateToken, authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    const month = req.query.month;

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

    if (month) {
      query += ' AND pi.periode = ?';
      params.push(month);
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
    console.error('SPP summary error:', error);
    res.status(500).json({ success: false, message: 'Error fetching SPP summary' });
  }
});

module.exports = router;