// ============================================================
// SDM (Human Resources Department) Module Routes
// ============================================================

const express = require('express');
const router = express.Router();
const { authenticateOperator, getAllowedTenants } = require('../middleware/auth');
const { logToFile } = require('../middlewares/logger');
const { getActiveTahunAjaran } = require('../utils/billing');

// Helper: Calculate SDM summary metrics
async function getSdMSummary() {
  try {
    // Total SDM employees: JOIN assignments untuk dapatkan jabatan & tenant
    const totalEmployees = await db.query(
      `SELECT COUNT(DISTINCT t.id) as total FROM teachers t
       JOIN teacher_assignments ta ON ta.teacher_id = t.id
       WHERE t.status_aktif = 1 AND ta.jabatan_di_unit LIKE '%SDM%'`
    );
    const totalCount = totalEmployees[0]?.total || 0;

    // Active SDM employees
    const activeSDM = await db.query(
      `SELECT COUNT(DISTINCT t.id) as active_count FROM teachers t
       JOIN teacher_assignments ta ON ta.teacher_id = t.id
       WHERE t.status_aktif = 1 AND ta.jabatan_di_unit LIKE '%SDM%' AND t.status_kepegawaian = 'aktif'`
    );
    const activeCount = activeSDM[0]?.active_count || 0;

    // SDM by role (dari assignment)
    const sdmByRole = await db.query(
      `SELECT
         ta.jabatan_di_unit,
         COUNT(DISTINCT t.id) as count,
         SUM(CASE WHEN t.status_kepegawaian = 'aktif' THEN 1 ELSE 0 END) as active_count
       FROM teachers t
       JOIN teacher_assignments ta ON ta.teacher_id = t.id
       WHERE t.status_aktif = 1 AND ta.jabatan_di_unit LIKE '%SDM%'
       GROUP BY ta.jabatan_di_unit`
    );

    // SDM by school (dari assignment tenant)
    const sdmBySchool = await db.query(
      `SELECT
         ta.tenant_id as school_id,
         te.nama_sekolah,
         COUNT(DISTINCT t.id) as employee_count,
         SUM(CASE WHEN t.status_kepegawaian = 'aktif' THEN 1 ELSE 0 END) as active_employee
       FROM teachers t
       JOIN teacher_assignments ta ON ta.teacher_id = t.id
       LEFT JOIN tenants te ON te.tenant_id = ta.tenant_id
       WHERE t.status_aktif = 1 AND ta.jabatan_di_unit LIKE '%SDM%'
       GROUP BY ta.tenant_id, te.nama_sekolah`
    );

    return {
      total: totalCount,
      active: activeCount,
      byRole: sdmByRole,
      bySchool: sdmBySchool
    };
  } catch (error) {
    console.error('SDM summary error:', error);
    throw error;
  }
}

// GET /sdm/summary - Summary of SDM (Human Resources Department)
router.get('/sdm/summary', authenticateOperator, async (req, res) => {
  try {
    const summary = await getSdMSummary();
    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('SDM summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching SDM summary',
      error: error.message
    });
  }
});

// GET /sdm/employees - List SDM employees with filtering
router.get('/sdm/employees', authenticateOperator, async (req, res) => {
  try {
    const {
      tenantId,
      role,
      status,
      search,
      page,
      limit
    } = req.query;

    // GROUP BY guru — setiap guru SDM hanya muncul 1x
    let query = `
      SELECT
        t.id,
        t.nama,
        t.nik,
        t.nip,
        t.email,
        t.status_kepegawaian,
        t.status_aktif,
        t.no_wa,
        GROUP_CONCAT(DISTINCT ta.jabatan_di_unit SEPARATOR ', ') as jabatan_di_unit,
        GROUP_CONCAT(DISTINCT ta.tenant_id SEPARATOR ', ') as tenant_ids,
        GROUP_CONCAT(DISTINCT te.nama_sekolah SEPARATOR ', ') as nama_sekolah,
        t.scan_id,
        t.link_foto,
        t.gaji_pokok,
        t.tunj_kinerja,
        t.tunj_kehadiran
      FROM teachers t
      JOIN teacher_assignments ta ON ta.teacher_id = t.id
      LEFT JOIN tenants te ON te.tenant_id = ta.tenant_id
      WHERE t.status_aktif = 1 AND ta.jabatan_di_unit LIKE '%SDM%'
      GROUP BY t.id, t.nama, t.nik, t.nip, t.email, t.status_kepegawaian, t.status_aktif, t.no_wa, t.scan_id, t.link_foto, t.gaji_pokok, t.tunj_kinerja, t.tunj_kehadiran
    `;

    // Authorize: non-central callers may only list employees for their units.
    const allowedTenants = getAllowedTenants(req);
    if (allowedTenants !== null) {
      if (tenantId && !allowedTenants.includes(tenantId)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
      }
      if (!tenantId && allowedTenants.length === 0) {
        return res.json({ success: true, data: { total: 0, page: 0, pages: 0, data: [] } });
      }
    }

    // Build dynamic params array
    const params = [];
    if (tenantId) {
      query += ' AND ta.tenant_id = ?';
      params.push(tenantId);
    } else if (allowedTenants !== null) {
      query += ` AND ta.tenant_id IN (${allowedTenants.map(() => '?').join(',')})`;
      params.push(...allowedTenants);
    }
    if (role) {
      query += ' AND ta.jabatan_di_unit LIKE ?';
      params.push('%' + role + '%');
    }
    if (status) {
      query += ' AND t.status_kepegawaian = ?';
      params.push(status);
    }
    if (search) {
      query += ' AND (t.nama LIKE ? OR t.nik LIKE ? OR t.nip LIKE ?)';
      params.push('%' + search + '%', '%' + search + '%', '%' + search + '%');
    }

    const queryLimit = parseInt(req.query.limit) || 20;
    const queryPage = parseInt(req.query.page) || 0;
    const offset = queryPage * queryLimit;

    query += ' LIMIT ? OFFSET ?';
    params.push(queryLimit, offset);

    const result = await db.query(query, params);

    const totalPages = Math.ceil(result.length / queryLimit);

    res.json({
      success: true,
      data: {
        total: result.length,
        page: queryPage,
        pages: totalPages,
        data: result
      }
    });
  } catch (error) {
    console.error('SDM employees error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching SDM employees',
      error: error.message
    });
  }
});

module.exports = router;
