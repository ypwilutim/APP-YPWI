const db = require('../../db');

async function attachAcademicYear(req, res, next) {
  try {
    const tenantId = req.user?.tenant_id || null;
    const [rows] = await db.query(`
      SELECT * FROM tahun_ajaran
      WHERE (tenant_id IS NULL OR tenant_id = ?)
        AND is_active = 1
      ORDER BY tenant_id DESC LIMIT 1
    `, [tenantId]);

    if (rows.length > 0) {
      req.activeTahunAjaran = {
        id: rows[0].id,
        nama: rows[0].nama,
        tahun_mulai: rows[0].tahun_mulai,
        tahun_selesai: rows[0].tahun_selesai,
        bulan_mulai: rows[0].bulan_mulai,
        tanggal_mulai: rows[0].tanggal_mulai,
        tanggal_selesai: rows[0].tanggal_selesai,
        is_active: rows[0].is_active,
        tenant_id: rows[0].tenant_id
      };
    } else {
      req.activeTahunAjaran = null;
    }
    next();
  } catch (error) {
    console.error('[attachAcademicYear] Error:', error.message);
    req.activeTahunAjaran = null;
    next();
  }
}

function requireAcademicYear(req, res, next) {
  if (!req.activeTahunAjaran) {
    return res.status(400).json({
      success: false,
      message: 'Tahun ajaran aktif belum ditentukan. Silakan buat tahun ajaran terlebih dahulu.'
    });
  }
  next();
}

module.exports = { attachAcademicYear, requireAcademicYear };
