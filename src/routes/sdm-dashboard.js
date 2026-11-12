// ============================================================
// SDM DASHBOARD ROUTES - Dashboard Direktur SDM
// ============================================================

const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const db = require('../../db');
const { authenticateOperator, verifyTenantAccess } = require('../middleware/auth');
const { logToFile } = require('../middlewares/logger');
const { getActiveTahunAjaran } = require('../utils/billing');

const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.xlsx', '.xls', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Format file harus .xlsx, .xls, atau .csv'));
  }
});

const router = express.Router();

// Helper: Verify SDM access and get allowed tenants
async function getSdmAllowedTenants(req) {
  if (req.user.role === 'admin') {
    const allTenants = await db.query('SELECT tenant_id FROM tenants');
    return allTenants.map(t => t.tenant_id);
  }

  const norm = (v) => (v || '').toLowerCase().replace(/[\s_]+/g, '');
  const isLeader = (a) => ['kepalasekolah', 'pimpinan', 'ketua'].includes(norm(a.jabatan_di_unit));

  const assignments = req.user.assignments || [];
  const sdmAssignments = assignments.filter(a =>
    (a.jabatan_di_unit || '').toLowerCase().includes('sdm')
  );
  const leaderAssignments = assignments.filter(isLeader);

  if (sdmAssignments.length === 0 && leaderAssignments.length === 0) {
    return [];
  }

  const isSdmPusat = sdmAssignments.some(a => a.tenant_id === 'YPWILUTIM');
  if (isSdmPusat) {
    const allTenants = await db.query('SELECT tenant_id FROM tenants');
    return allTenants.map(t => t.tenant_id);
  }

  const tenants = new Set();
  sdmAssignments.forEach(a => { if (a.tenant_id) tenants.add(a.tenant_id); });
  leaderAssignments.forEach(a => { if (a.tenant_id) tenants.add(a.tenant_id); });
  return [...tenants];
}

// Helper: Check if user is SDM Pusat
function isSdmPusat(req) {
  const sdmAssignments = (req.user.assignments || []).filter(a =>
    (a.jabatan_di_unit || '').toLowerCase().includes('sdm')
  );
  return sdmAssignments.some(a => a.tenant_id === 'YPWILUTIM');
}

// GET /api/sdm-dashboard/stats - Statistik ringkas untuk dashboard SDM
router.get('/sdm-dashboard/stats', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getSdmAllowedTenants(req);
    
    if (allowedTenants.length === 0) {
      return res.json({
        success: true,
        data: {
          total_teachers: 0,
          active_teachers: 0,
          today_attendance: 0,
          late_today: 0,
          on_leave_today: 0,
          kpi_summary: {
            total_templates: 0,
            active_period: null,
            completion_rate: 0,
            avg_score: 0
          },
          by_school: []
        }
      });
    }

    const tenantPlaceholders = allowedTenants.map(() => '?').join(',');
    const today = new Date().toISOString().split('T')[0];

    // Total & active teachers
    const teacherStats = await db.query(`
      SELECT 
        COUNT(DISTINCT t.id) as total_teachers,
        COUNT(DISTINCT CASE WHEN t.status_aktif = 1 THEN t.id END) as active_teachers
      FROM teachers t
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      WHERE ta.tenant_id IN (${tenantPlaceholders}) AND t.status_aktif = 1
    `, allowedTenants);

    // Today's attendance
    const attendanceStats = await db.query(`
      SELECT 
        COUNT(DISTINCT CASE WHEN jenis = 'masuk' THEN teacher_id END) as today_attendance,
        SUM(CASE WHEN jenis = 'masuk' AND status = 'terlambat' THEN 1 ELSE 0 END) as late_today
      FROM attendance_logs
      WHERE DATE(waktu_scan) = ? AND tenant_id IN (${tenantPlaceholders})
    `, [today, ...allowedTenants]);

    // On leave today
    const leaveStats = await db.query(`
      SELECT COUNT(DISTINCT lr.teacher_id) as on_leave_today
      FROM leave_requests lr
      JOIN teacher_assignments ta ON lr.teacher_id = ta.teacher_id
      WHERE lr.status = 'approved'
        AND ? BETWEEN lr.tanggal_mulai AND COALESCE(lr.tanggal_selesai, lr.tanggal_mulai)
        AND ta.tenant_id IN (${tenantPlaceholders})
    `, [today, ...allowedTenants]);

    // KPI Summary
    const kpiStats = await db.query(`
      SELECT 
        COUNT(DISTINCT ki.id) as total_templates,
        (SELECT nama FROM kpi_periods WHERE status = 'aktif' ORDER BY created_at DESC LIMIT 1) as active_period,
        COALESCE((
          SELECT AVG(ks.pencapaian) FROM kpi_scores ks
          JOIN kpi_periods kp ON ks.period_id = kp.id
          WHERE kp.status = 'aktif' AND ks.tenant_id IN (${tenantPlaceholders})
        ), 0) as completion_rate,
        COALESCE((
          SELECT AVG(ks.skor) FROM kpi_scores ks
          JOIN kpi_periods kp ON ks.period_id = kp.id
          WHERE kp.status = 'aktif' AND ks.tenant_id IN (${tenantPlaceholders})
        ), 0) as avg_score
      FROM kpi_indicators ki
      WHERE ki.aktif = 1
    `, [...allowedTenants, ...allowedTenants]);

    // By school
    const bySchool = await db.query(`
      SELECT 
        tn.tenant_id,
        tn.nama_sekolah,
        COUNT(DISTINCT t.id) as teachers,
        COALESCE((
          SELECT ROUND(
            SUM(CASE WHEN status = 'tepat_waktu' THEN 1 ELSE 0 END) / 
            COUNT(*) * 100, 1
          )
          FROM attendance_logs al
          WHERE al.tenant_id = tn.tenant_id
          AND DATE(al.waktu_scan) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
          AND al.jenis = 'masuk'
        ), 0) as attendance_rate
      FROM tenants tn
      LEFT JOIN teacher_assignments ta ON tn.tenant_id = ta.tenant_id
      LEFT JOIN teachers t ON ta.teacher_id = t.id AND t.status_aktif = 1
      WHERE tn.tenant_id IN (${tenantPlaceholders})
      GROUP BY tn.tenant_id, tn.nama_sekolah
      ORDER BY tn.nama_sekolah
    `, allowedTenants);

    res.json({
      success: true,
      data: {
        total_teachers: teacherStats[0]?.total_teachers || 0,
        active_teachers: teacherStats[0]?.active_teachers || 0,
        today_attendance: attendanceStats[0]?.today_attendance || 0,
        late_today: attendanceStats[0]?.late_today || 0,
        on_leave_today: leaveStats[0]?.on_leave_today || 0,
        kpi_summary: {
          total_templates: kpiStats[0]?.total_templates || 0,
          active_period: kpiStats[0]?.active_period || null,
          completion_rate: Math.round(kpiStats[0]?.completion_rate || 0),
          avg_score: Math.round((kpiStats[0]?.avg_score || 0) * 100) / 100
        },
        by_school: bySchool,
        is_sdm_pusat: isSdmPusat(req)
      }
    });
  } catch (error) {
    console.error('SDM Dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching SDM dashboard stats',
      error: error.message
    });
  }
});

// GET /api/sdm-dashboard/attendance-chart - Chart data kehadiran mingguan/bulanan
router.get('/sdm-dashboard/attendance-chart', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getSdmAllowedTenants(req);
    const { type = 'weekly' } = req.query; // weekly or monthly

    if (allowedTenants.length === 0) {
      return res.json({ success: true, data: { labels: [], datasets: [] } });
    }

    const tenantPlaceholders = allowedTenants.map(() => '?').join(',');

    if (type === 'weekly') {
      // Last 7 days
      const chartData = await db.query(`
        SELECT 
          DATE(waktu_scan) as date,
          SUM(CASE WHEN jenis = 'masuk' AND status = 'tepat_waktu' THEN 1 ELSE 0 END) as tepat_waktu,
          SUM(CASE WHEN jenis = 'masuk' AND status = 'terlambat' THEN 1 ELSE 0 END) as terlambat,
          SUM(CASE WHEN jenis = 'masuk' THEN 1 ELSE 0 END) as total_masuk
        FROM attendance_logs
        WHERE DATE(waktu_scan) >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
        AND tenant_id IN (${tenantPlaceholders})
        GROUP BY DATE(waktu_scan)
        ORDER BY DATE(waktu_scan)
      `, allowedTenants);

      const labels = [];
      const tepatWaktu = [];
      const terlambat = [];
      const totalMasuk = [];

      // Fill missing dates
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        const dayName = d.toLocaleDateString('id-ID', { weekday: 'short' });
        labels.push(dayName);
        
        const found = chartData.find(c => c.date === dateStr);
        tepatWaktu.push(found?.tepat_waktu || 0);
        terlambat.push(found?.terlambat || 0);
        totalMasuk.push(found?.total_masuk || 0);
      }

      res.json({
        success: true,
        data: {
          labels,
          datasets: [
            { label: 'Tepat Waktu', data: tepatWaktu, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)' },
            { label: 'Terlambat', data: terlambat, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)' },
            { label: 'Total Masuk', data: totalMasuk, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)' }
          ]
        }
      });
    } else {
      // Monthly - last 12 months
      const chartData = await db.query(`
        SELECT 
          DATE_FORMAT(waktu_scan, '%Y-%m') as month,
          SUM(CASE WHEN jenis = 'masuk' AND status = 'tepat_waktu' THEN 1 ELSE 0 END) as tepat_waktu,
          SUM(CASE WHEN jenis = 'masuk' AND status = 'terlambat' THEN 1 ELSE 0 END) as terlambat,
          SUM(CASE WHEN jenis = 'masuk' THEN 1 ELSE 0 END) as total_masuk
        FROM attendance_logs
        WHERE DATE(waktu_scan) >= DATE_SUB(CURDATE(), INTERVAL 11 MONTH)
        AND tenant_id IN (${tenantPlaceholders})
        GROUP BY DATE_FORMAT(waktu_scan, '%Y-%m')
        ORDER BY DATE_FORMAT(waktu_scan, '%Y-%m')
      `, allowedTenants);

      const labels = [];
      const tepatWaktu = [];
      const terlambat = [];
      const totalMasuk = [];

      for (let i = 11; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const monthStr = d.toISOString().slice(0, 7);
        const monthName = d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' });
        labels.push(monthName);
        
        const found = chartData.find(c => c.month === monthStr);
        tepatWaktu.push(found?.tepat_waktu || 0);
        terlambat.push(found?.terlambat || 0);
        totalMasuk.push(found?.total_masuk || 0);
      }

      res.json({
        success: true,
        data: {
          labels,
          datasets: [
            { label: 'Tepat Waktu', data: tepatWaktu, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)' },
            { label: 'Terlambat', data: terlambat, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)' },
            { label: 'Total Masuk', data: totalMasuk, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)' }
          ]
        }
      });
    }
  } catch (error) {
    console.error('SDM Dashboard attendance chart error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching attendance chart data',
      error: error.message
    });
  }
});

// GET /api/sdm-dashboard/kpi-summary - Ringkasan KPI per jabatan/sekolah
router.get('/sdm-dashboard/kpi-summary', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getSdmAllowedTenants(req);
    const { period_id, kategori } = req.query;

    if (allowedTenants.length === 0) {
      return res.json({ success: true, data: { by_jabatan: [], by_school: [], by_indicator: [] } });
    }

    const tenantPlaceholders = allowedTenants.map(() => '?').join(',');

    // Active period if not specified
    let periodId = period_id;
    if (!periodId) {
      const activePeriod = await db.query('SELECT id FROM kpi_periods WHERE status = "aktif" ORDER BY created_at DESC LIMIT 1');
      periodId = activePeriod[0]?.id || null;
    }

    // By jabatan (role) - tampilkan semua guru walau belum ada skor
    let byJabatanQuery = `
      SELECT 
        ta.jabatan_di_unit as jabatan,
        COUNT(DISTINCT t.id) as total_guru,
        COALESCE(AVG(ks.pencapaian), 0) as avg_achievement,
        COALESCE(AVG(ks.skor), 0) as avg_score
      FROM teachers t
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      LEFT JOIN kpi_scores ks ON t.id = ks.teacher_id
        AND ks.tenant_id IN (${tenantPlaceholders})
        ${periodId ? 'AND ks.period_id = ?' : ''}
      WHERE ta.tenant_id IN (${tenantPlaceholders}) AND t.status_aktif = 1
    `;
    let params = [...allowedTenants];
    if (periodId) params.push(periodId);
    params.push(...allowedTenants);

    if (kategori) {
      byJabatanQuery += ' AND (ks.indicator_id IS NULL OR ks.indicator_id IN (SELECT id FROM kpi_indicators WHERE kategori = ?))';
      params.push(kategori);
    }

    byJabatanQuery += ' GROUP BY ta.jabatan_di_unit ORDER BY avg_score DESC, total_guru DESC';

    const byJabatan = await db.query(byJabatanQuery, params);

    // By school - tampilkan semua sekolah walau belum ada skor
    let bySchoolQuery = `
      SELECT 
        tn.tenant_id,
        tn.nama_sekolah,
        COUNT(DISTINCT t.id) as total_guru,
        COALESCE(AVG(ks.pencapaian), 0) as avg_achievement,
        COALESCE(AVG(ks.skor), 0) as avg_score
      FROM tenants tn
      LEFT JOIN teacher_assignments ta ON tn.tenant_id = ta.tenant_id
      LEFT JOIN teachers t ON ta.teacher_id = t.id AND t.status_aktif = 1
      LEFT JOIN kpi_scores ks ON t.id = ks.teacher_id
        AND ks.tenant_id IN (${tenantPlaceholders})
        ${periodId ? 'AND ks.period_id = ?' : ''}
      WHERE tn.tenant_id IN (${tenantPlaceholders})
    `;
    params = [...allowedTenants];
    if (periodId) params.push(periodId);
    params.push(...allowedTenants);

    if (kategori) {
      bySchoolQuery += ' AND (ks.indicator_id IS NULL OR ks.indicator_id IN (SELECT id FROM kpi_indicators WHERE kategori = ?))';
      params.push(kategori);
    }

    bySchoolQuery += ' GROUP BY tn.tenant_id, tn.nama_sekolah ORDER BY avg_score DESC, tn.nama_sekolah';

    const bySchool = await db.query(bySchoolQuery, params);

    // By indicator - tampilkan semua indikator aktif walau belum ada nilai
    let byIndicatorQuery = `
      SELECT 
        ki.id,
        ki.nama,
        ki.kategori,
        ki.bobot,
        ki.target_default,
        COALESCE(AVG(ks.nilai_aktual), 0) as avg_actual,
        COALESCE(AVG(ks.pencapaian), 0) as avg_achievement,
        COALESCE(AVG(ks.skor), 0) as avg_score,
        COUNT(ks.id) as score_count
      FROM kpi_indicators ki
      LEFT JOIN kpi_scores ks ON ki.id = ks.indicator_id
        AND ks.tenant_id IN (${tenantPlaceholders})
        ${periodId ? 'AND ks.period_id = ?' : ''}
      WHERE ki.aktif = 1
    `;
    params = [...allowedTenants];
    if (periodId) params.push(periodId);

    if (kategori) {
      byIndicatorQuery += ' AND ki.kategori = ?';
      params.push(kategori);
    }

    byIndicatorQuery += ' GROUP BY ki.id, ki.nama, ki.kategori, ki.bobot, ki.target_default ORDER BY ki.kategori, ki.urutan';

    const byIndicator = await db.query(byIndicatorQuery, params);

    res.json({
      success: true,
      data: {
        period_id: periodId,
        by_jabatan: byJabatan.map(r => ({
          jabatan: r.jabatan || 'Tanpa Jabatan',
          total_guru: r.total_guru,
          avg_achievement: Math.round(r.avg_achievement * 100) / 100,
          avg_score: Math.round(r.avg_score * 100) / 100
        })),
        by_school: bySchool.map(r => ({
          tenant_id: r.tenant_id,
          nama_sekolah: r.nama_sekolah,
          total_guru: r.total_guru,
          avg_achievement: Math.round(r.avg_achievement * 100) / 100,
          avg_score: Math.round(r.avg_score * 100) / 100
        })),
        by_indicator: byIndicator.map(r => ({
          id: r.id,
          nama: r.nama,
          kategori: r.kategori,
          bobot: r.bobot,
          target_default: r.target_default,
          avg_actual: Math.round(r.avg_actual * 100) / 100,
          avg_achievement: Math.round(r.avg_achievement * 100) / 100,
          avg_score: Math.round(r.avg_score * 100) / 100
        }))
      }
    });
  } catch (error) {
    console.error('SDM Dashboard KPI summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching KPI summary',
      error: error.message
    });
  }
});

// GET /api/sdm-dashboard/teacher-list - List guru untuk SDM (dengan filter tenant/jabatan)
router.get('/sdm-dashboard/teacher-list', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getSdmAllowedTenants(req);
    const { tenant_id, jabatan, status_kepegawaian, search, page = 1, limit = 20 } = req.query;

    if (allowedTenants.length === 0) {
      return res.json({ success: true, data: { data: [], total: 0, page: 1, pages: 1 } });
    }

    let tenantFilter = allowedTenants;
    if (tenant_id && allowedTenants.includes(tenant_id)) {
      tenantFilter = [tenant_id];
    }

    const tenantPlaceholders = tenantFilter.map(() => '?').join(',');
    const safeLimit = Math.min(Math.max(parseInt(limit) || 20, 1), 200);
    const safeOffset = Math.max((parseInt(page) - 1) * safeLimit, 0);

    let query = `
      SELECT 
        t.id, t.nama, t.nik, t.nip, t.email, t.status_kepegawaian, t.status_aktif,
        t.no_wa, t.link_foto,
        ta.kpi_category,
        GROUP_CONCAT(DISTINCT ta.jabatan_di_unit SEPARATOR ', ') as jabatan_di_unit,
        t.tmt, t.gaji_pokok, t.tunj_kinerja, t.tunj_kehadiran,
        GROUP_CONCAT(DISTINCT ta.tenant_id SEPARATOR ', ') as tenant_ids,
        GROUP_CONCAT(DISTINCT tn.nama_sekolah SEPARATOR ', ') as nama_sekolah,
        (SELECT COUNT(*) FROM attendance_logs al WHERE al.teacher_id = t.id AND DATE(al.waktu_scan) = CURDATE() AND al.jenis = 'masuk' AND al.tenant_id IN (${tenantPlaceholders})) as today_present,
        (SELECT COUNT(*) FROM attendance_logs al WHERE al.teacher_id = t.id AND DATE(al.waktu_scan) = CURDATE() AND al.jenis = 'masuk' AND al.status = 'terlambat' AND al.tenant_id IN (${tenantPlaceholders})) as today_late
      FROM teachers t
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      JOIN tenants tn ON ta.tenant_id = tn.tenant_id
      WHERE ta.tenant_id IN (${tenantPlaceholders}) AND t.status_aktif = 1
      GROUP BY t.id, t.nama, t.nik, t.nip, t.email, t.status_kepegawaian, t.status_aktif, t.no_wa, t.link_foto, ta.kpi_category, t.tmt, t.gaji_pokok, t.tunj_kinerja, t.tunj_kehadiran
    `;
    // 3 kelompok placeholder tenant: 2 subquery SELECT (today_present, today_late) + 1 WHERE
    let params = [...tenantFilter, ...tenantFilter, ...tenantFilter];

    if (jabatan) {
      query += ' AND ta.jabatan_di_unit LIKE ?';
      params.push(`%${jabatan}%`);
    }
    if (status_kepegawaian) {
      query += ' AND t.status_kepegawaian = ?';
      params.push(status_kepegawaian);
    }
    if (search) {
      query += ' AND (t.nama LIKE ? OR t.nik LIKE ? OR t.nip LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY t.nama ASC LIMIT ${safeLimit} OFFSET ${safeOffset}`;

    const teachers = await db.query(query, params);

    // Count total
    let countQuery = `
      SELECT COUNT(DISTINCT t.id) as total
      FROM teachers t
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      WHERE ta.tenant_id IN (${tenantPlaceholders}) AND t.status_aktif = 1
    `;
    let countParams = [...tenantFilter];
    if (jabatan) {
      countQuery += ' AND ta.jabatan_di_unit LIKE ?';
      countParams.push(`%${jabatan}%`);
    }
    if (status_kepegawaian) {
      countQuery += ' AND t.status_kepegawaian = ?';
      countParams.push(status_kepegawaian);
    }
    if (search) {
      countQuery += ' AND (t.nama LIKE ? OR t.nik LIKE ? OR t.nip LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const totalResult = await db.query(countQuery, countParams);

    res.json({
      success: true,
      data: {
        data: teachers,
        total: totalResult[0]?.total || 0,
        page: parseInt(page),
        pages: Math.ceil((totalResult[0]?.total || 0) / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('SDM Dashboard teacher list error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching teacher list',
      error: error.message
    });
  }
});

// GET /api/sdm-dashboard/tenants - List tenants accessible by SDM
router.get('/sdm-dashboard/tenants', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getSdmAllowedTenants(req);
    
    if (allowedTenants.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const tenantPlaceholders = allowedTenants.map(() => '?').join(',');
    const tenants = await db.query(`
      SELECT tenant_id, nama_sekolah, tipe_unit
      FROM tenants
      WHERE tenant_id IN (${tenantPlaceholders})
      ORDER BY nama_sekolah
    `, allowedTenants);

    res.json({ success: true, data: tenants });
  } catch (error) {
    console.error('SDM Dashboard tenants error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching tenants',
      error: error.message
    });
  }
});

// GET /api/sdm-dashboard/jabatan-list - List jabatan available
router.get('/sdm-dashboard/jabatan-list', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getSdmAllowedTenants(req);
    
    if (allowedTenants.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const tenantPlaceholders = allowedTenants.map(() => '?').join(',');
    const jabatanList = await db.query(`
      SELECT DISTINCT ta.jabatan_di_unit as jabatan, COUNT(DISTINCT t.id) as count
      FROM teacher_assignments ta
      JOIN teachers t ON ta.teacher_id = t.id
      WHERE ta.tenant_id IN (${tenantPlaceholders}) AND t.status_aktif = 1
      GROUP BY ta.jabatan_di_unit
      ORDER BY ta.jabatan_di_unit
    `, allowedTenants);

    res.json({ success: true, data: jabatanList });
  } catch (error) {
    console.error('SDM Dashboard jabatan list error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching jabatan list',
      error: error.message
    });
  }
});

// GET /api/sdm-dashboard/attendance-logs - Log kehadiran dengan filter tenant SDM
router.get('/sdm-dashboard/attendance-logs', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getSdmAllowedTenants(req);
    const {
      date, status, jenis, teacher_id,
      page = 1, limit = 50
    } = req.query;

    let tenantFilter = allowedTenants;
    const requestedTenant = req.query.tenant_id;
    if (requestedTenant && allowedTenants.includes(requestedTenant)) {
      tenantFilter = [requestedTenant];
    }

    if (tenantFilter.length === 0) {
      return res.json({ success: true, data: [], pagination: { page: 1, limit: Math.min(Math.max(parseInt(limit) || 50, 1), 200), total: 0, totalPages: 0 } });
    }

    const tenantPlaceholders = tenantFilter.map(() => '?').join(',');
    const safeLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const safeOffset = Math.max((parseInt(page) - 1) * safeLimit, 0);

    const whereClauses = [];
    let params = [];

    whereClauses.push(`al.tenant_id IN (${tenantPlaceholders})`);
    params.push(...tenantFilter);

    if (date) {
      whereClauses.push('DATE(al.waktu_scan) = ?');
      params.push(date);
    }
    if (status) {
      whereClauses.push('al.status = ?');
      params.push(status);
    }
    if (jenis) {
      whereClauses.push('al.jenis = ?');
      params.push(jenis);
    }
    if (teacher_id) {
      whereClauses.push('al.teacher_id = ?');
      params.push(parseInt(teacher_id));
    }

    const whereSql = whereClauses.join(' AND ');

    const countRes = await db.query(
      `SELECT COUNT(*) as total FROM attendance_logs al WHERE ${whereSql}`,
      params
    );

    const logs = await db.query(
      `SELECT al.id, al.teacher_id, al.waktu_scan, al.jenis, al.status, al.metode, al.dinas_luar,
              al.tenant_id, t.nama, t.nip, ten.nama_sekolah
       FROM attendance_logs al
       JOIN teachers t ON al.teacher_id = t.id
       JOIN tenants ten ON al.tenant_id = ten.tenant_id
        WHERE ${whereSql}
        ORDER BY al.waktu_scan DESC
        LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params
    );

    res.json({
      success: true,
      data: logs.map(l => ({
        ...l,
        jenis: l.jenis ? (l.jenis.charAt(0).toUpperCase() + l.jenis.slice(1).toLowerCase()) : 'Masuk'
      })),
      pagination: {
        page: parseInt(page) || 1,
        limit: safeLimit,
        total: countRes[0]?.total || 0,
        totalPages: Math.ceil((countRes[0]?.total || 0) / safeLimit)
      }
    });
  } catch (error) {
    console.error('SDM Dashboard attendance logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching attendance logs',
      error: error.message
    });
  }
});

// ============================================================
// ATURAN JABATAN SDM
// Tenant YPWILUTIM = SDM Pusat (semua sekolah).
// Selain YPWILUTIM = SDM Sekolah (hanya unitnya).
// ============================================================
const TENANT_PUSAT = 'YPWILUTIM';
const JABATAN_SDM_PUSAT = 'SDM Pusat';
const JABATAN_SDM_SEKOLAH = 'SDM';

// Daftar guru yang bisa diberi akses SDM di sebuah tenant (SDM Pusat saja)
// Tenant determines whether SDM Pusat or SDM Sekolah jabatan can be assigned
router.get('/sdm-dashboard/access/candidates', authenticateOperator, async (req, res) => {
  try {
    if (!isSdmPusat(req)) {
      return res.status(403).json({
        success: false,
        message: `Hanya SDM Pusat (tenant ${TENANT_PUSAT}) yang boleh mengelola akses SDM`
      });
    }

    const { tenant_id, search, limit = 50 } = req.query;
    const safeLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const params = [];
    let where = ['t.status_aktif = 1'];

    if (search) {
      where.push('(t.nama LIKE ? OR t.nik LIKE ? OR t.nip LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    let joinClause = '';
    // Jika tenant dipilih, batasi ke guru yang sudah punya assignment di tenant itu.
    // Berlaku untuk tenant pusat maupun tenant sekolah.
    if (tenant_id) {
      joinClause = `JOIN teacher_assignments ta ON t.id = ta.teacher_id AND ta.tenant_id = ?`;
      params.unshift(tenant_id);
    }

    const rows = await db.query(`
      SELECT DISTINCT t.id, t.nama, t.nik, t.nip, t.email, t.status_kepegawaian, t.status_aktif
      FROM teachers t
      ${joinClause}
      WHERE ${where.join(' AND ')}
      ORDER BY t.nama ASC
      LIMIT ${safeLimit}
    `, params);

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('SDM access candidates error:', error);
    res.status(500).json({ success: false, message: 'Error fetching teacher candidates', error: error.message });
  }
});

// GET /api/sdm-dashboard/access/list - Daftar semua assignment SDM
router.get('/sdm-dashboard/access/list', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getSdmAllowedTenants(req);
    if (allowedTenants.length === 0) {
      return res.json({ success: true, data: [] });
    }
    const tenantPlaceholders = allowedTenants.map(() => '?').join(',');
    const rows = await db.query(`
      SELECT ta.id, ta.teacher_id, ta.tenant_id, ta.jabatan_di_unit,
             tn.nama_sekolah, t.nama, t.nik, t.nip, t.email, t.status_kepegawaian
      FROM teacher_assignments ta
      JOIN tenants tn ON ta.tenant_id = tn.tenant_id
      JOIN teachers t ON ta.teacher_id = t.id
      WHERE LOWER(REPLACE(ta.jabatan_di_unit, ' ', '')) IN ('sdm', 'sdmpusat', 'sdmsekolah')
        AND ta.tenant_id IN (${tenantPlaceholders})
        AND t.status_aktif = 1
      ORDER BY (ta.tenant_id = '${TENANT_PUSAT}') DESC, tn.nama_sekolah ASC, t.nama ASC
    `, allowedTenants);

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('SDM access list error:', error);
    res.status(500).json({ success: false, message: 'Error fetching SDM access list', error: error.message });
  }
});

// POST /api/sdm-dashboard/access - Berikan akses SDM ke seorang guru
router.post('/sdm-dashboard/access', authenticateOperator, async (req, res) => {
  try {
    if (!isSdmPusat(req)) {
      return res.status(403).json({
        success: false,
        message: `Hanya SDM Pusat (tenant ${TENANT_PUSAT}) yang boleh memberikan akses SDM`
      });
    }

    const { teacher_id, tenant_id } = req.body;

    if (!teacher_id || !tenant_id) {
      return res.status(400).json({ success: false, message: 'teacher_id dan tenant_id wajib diisi' });
    }

    // Tentukan jabatan berdasarkan tenant: YPWILUTIM = SDM Pusat, lainnya = SDM Sekolah
    const jabatan = tenant_id === TENANT_PUSAT ? JABATAN_SDM_PUSAT : JABATAN_SDM_SEKOLAH;

    // Verify teacher exists and active
    const teacherRows = await db.query('SELECT id, nama FROM teachers WHERE id = ? AND status_aktif = 1', [teacher_id]);
    if (!teacherRows.length) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan atau nonaktif' });
    }
    const teacher = teacherRows[0];

    // Verify tenant exists
    const tenantRows = await db.query('SELECT tenant_id, nama_sekolah FROM tenants WHERE tenant_id = ?', [tenant_id]);
    if (!tenantRows.length) {
      return res.status(400).json({ success: false, message: 'Sekolah/tenant tidak ditemukan' });
    }
    const tenant = tenantRows[0];

    // Pastikan guru sudah memiliki assignment di tenant target
    const hasAssignment = await db.query(
      'SELECT id FROM teacher_assignments WHERE teacher_id = ? AND tenant_id = ? LIMIT 1',
      [teacher_id, tenant_id]
    );
    if (!hasAssignment.length) {
      const tenantLabel = tenant_id === TENANT_PUSAT ? `pusat (${TENANT_PUSAT})` : tenant.nama_sekolah;
      return res.status(400).json({
        success: false,
        message: `${teacher.nama} belum terdaftar di ${tenantLabel}. Berikan assignment di tenant tersebut terlebih dahulu.`
      });
    }

    // Cek apakah assignment SDM sudah ada untuk tenant ini
    const existing = await db.query(
      `SELECT id FROM teacher_assignments
       WHERE teacher_id = ? AND tenant_id = ?
         AND LOWER(REPLACE(jabatan_di_unit, ' ', '')) IN ('sdm', 'sdmpusat', 'sdmsekolah')
       LIMIT 1`,
      [teacher_id, tenant_id]
    );

    if (existing.length > 0) {
      // Normalisasi penulisan jika perlu
      await db.query(
        'UPDATE teacher_assignments SET jabatan_di_unit = ? WHERE id = ?',
        [jabatan, existing[0].id]
      );
      return res.json({
        success: true,
        message: `${teacher.nama} sudah berjabatan SDM di ${tenant.nama_sekolah} (${jabatan})`,
        assignment_id: existing[0].id
      });
    }

    // Buat assignment SDM baru (jabatan existing di tenant tsb tetap dipertahankan)
    const insertResult = await db.query(
      'INSERT INTO teacher_assignments (teacher_id, tenant_id, jabatan_di_unit) VALUES (?, ?, ?)',
      [teacher_id, tenant_id, jabatan]
    );

    res.json({
      success: true,
      message: `Akses ${jabatan} diberikan kepada ${teacher.nama} di ${tenant.nama_sekolah}`,
      assignment_id: insertResult.insertId
    });
  } catch (error) {
    console.error('SDM access assign error:', error);
    res.status(500).json({ success: false, message: 'Error assigning SDM access', error: error.message });
  }
});

// DELETE /api/sdm-dashboard/access/:assignmentId - Cabut akses SDM
router.delete('/sdm-dashboard/access/:assignmentId', authenticateOperator, async (req, res) => {
  try {
    if (!isSdmPusat(req)) {
      return res.status(403).json({
        success: false,
        message: `Hanya SDM Pusat (tenant ${TENANT_PUSAT}) yang boleh mencabut akses SDM`
      });
    }

    const { assignmentId } = req.params;

    // Pastikan assignment benar-benar jabatan SDM
    const rows = await db.query(
      `SELECT id, teacher_id, tenant_id, jabatan_di_unit FROM teacher_assignments
       WHERE id = ? AND LOWER(REPLACE(jabatan_di_unit, ' ', '')) IN ('sdm', 'sdmpusat', 'sdmsekolah')`,
      [assignmentId]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Assignment SDM tidak ditemukan' });
    }

    await db.query('DELETE FROM teacher_assignments WHERE id = ?', [assignmentId]);

    res.json({ success: true, message: 'Akses SDM berhasil dicabut' });
  } catch (error) {
    console.error('SDM access revoke error:', error);
    res.status(500).json({ success: false, message: 'Error revoking SDM access', error: error.message });
  }
});

// POST /api/sdm-dashboard/teachers - Tambah guru baru (CRUD)
router.post('/sdm-dashboard/teachers', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getSdmAllowedTenants(req);
    const b = req.body || {};
    const { nama, nik, tenant_id } = b;
    const jabatanFinal = b.jabatan_di_unit || b.jabatan || null;
    const statusAktif = (b.status_aktif === undefined ? 1 : (Number(b.status_aktif) ? 1 : 0));
    const nn = v => (v === undefined || v === null || v === '') ? null : v;

    if (!nama || !nik || !tenant_id) {
      return res.status(400).json({ success: false, message: 'nama, nik, dan tenant_id wajib diisi' });
    }
    if (!allowedTenants.includes(tenant_id)) {
      return res.status(403).json({ success: false, message: 'Tenant tidak diizinkan' });
    }

    if (b.tmt) {
      const tmtDate = new Date(b.tmt);
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      if (tmtDate <= twoYearsAgo && (!b.nip || b.nip === '' || b.nip === '-')) {
        return res.status(400).json({ success: false, message: 'NIP wajib diisi jika TMT sudah 2 tahun atau lebih' });
      }
    }

    const result = await db.query(
      `INSERT INTO teachers
        (nama, nik, nip, tempat_lahir, tanggal_lahir, jenis_kelamin, alamat, no_wa, email,
         status_kepegawaian, tmt, status_aktif, link_foto, link_ktp, link_kk, link_ijazah,
         gaji_pokok, tunj_kinerja, tunj_umum, tunj_istri, tunj_anak, tunj_kepala_sekolah,
         tunj_wali_kelas, honor_bendahara, tunj_kehadiran, potongan)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        nama, nik, nn(b.nip), nn(b.tempat_lahir), nn(b.tanggal_lahir), nn(b.jenis_kelamin),
        nn(b.alamat), nn(b.no_wa), nn(b.email), nn(b.status_kepegawaian), nn(b.tmt), statusAktif,
        nn(b.link_foto), nn(b.link_ktp), nn(b.link_kk), nn(b.link_ijazah),
        nn(b.gaji_pokok) ?? 0, nn(b.tunj_kinerja) ?? 0, nn(b.tunj_umum) ?? 0, nn(b.tunj_istri) ?? 0,
        nn(b.tunj_anak) ?? 0, nn(b.tunj_kepala_sekolah) ?? 0, nn(b.tunj_wali_kelas) ?? 0,
        nn(b.honor_bendahara) ?? 0, nn(b.tunj_kehadiran) ?? 0, nn(b.potongan) ?? 0
      ]
    );
    const teacherId = result.insertId;

    await db.query(
      `INSERT INTO teacher_assignments (teacher_id, tenant_id, jabatan_di_unit)
       VALUES (?, ?, ?)`,
      [teacherId, tenant_id, jabatanFinal]
    );

    res.json({ success: true, message: 'Guru berhasil ditambahkan', data: { id: teacherId } });
  } catch (error) {
    console.error('SDM add teacher error:', error);
    res.status(500).json({ success: false, message: 'Gagal menambah guru', error: error.message });
  }
});

// PUT /api/sdm-dashboard/teachers/:id - Update guru
router.put('/sdm-dashboard/teachers/:id', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getSdmAllowedTenants(req);
    const teacherId = parseInt(req.params.id);
    const b = req.body || {};
    const tenant_id = b.tenant_id;
    const jabatanFinal = b.jabatan_di_unit || b.jabatan || null;
    const nn = v => (v === undefined || v === null || v === '') ? null : v;

    if (tenant_id && !allowedTenants.includes(tenant_id)) {
      return res.status(403).json({ success: false, message: 'Tenant tidak diizinkan' });
    }

    // Pastikan guru berada dalam tenant yang diizinkan
    const own = await db.query('SELECT tenant_id FROM teacher_assignments WHERE teacher_id = ? LIMIT 1', [teacherId]);
    if (!own.length || !allowedTenants.includes(own[0].tenant_id)) {
      return res.status(403).json({ success: false, message: 'Tenant tidak diizinkan' });
    }

    if (b.tmt) {
      const tmtDate = new Date(b.tmt);
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      if (tmtDate <= twoYearsAgo && (!b.nip || b.nip === '' || b.nip === '-')) {
        return res.status(400).json({ success: false, message: 'NIP wajib diisi jika TMT sudah 2 tahun atau lebih' });
      }
    }

    await db.query(
      `UPDATE teachers SET
        nama = COALESCE(?, nama),
        nik = COALESCE(?, nik),
        nip = COALESCE(?, nip),
        tempat_lahir = COALESCE(?, tempat_lahir),
        tanggal_lahir = COALESCE(?, tanggal_lahir),
        jenis_kelamin = COALESCE(?, jenis_kelamin),
        alamat = COALESCE(?, alamat),
        no_wa = COALESCE(?, no_wa),
        email = COALESCE(?, email),
        status_kepegawaian = COALESCE(?, status_kepegawaian),
        tmt = COALESCE(?, tmt),
        status_aktif = COALESCE(?, status_aktif),
        link_foto = COALESCE(?, link_foto),
        link_ktp = COALESCE(?, link_ktp),
        link_kk = COALESCE(?, link_kk),
        link_ijazah = COALESCE(?, link_ijazah),
        gaji_pokok = COALESCE(?, gaji_pokok),
        tunj_kinerja = COALESCE(?, tunj_kinerja),
        tunj_umum = COALESCE(?, tunj_umum),
        tunj_istri = COALESCE(?, tunj_istri),
        tunj_anak = COALESCE(?, tunj_anak),
        tunj_kepala_sekolah = COALESCE(?, tunj_kepala_sekolah),
        tunj_wali_kelas = COALESCE(?, tunj_wali_kelas),
        honor_bendahara = COALESCE(?, honor_bendahara),
        tunj_kehadiran = COALESCE(?, tunj_kehadiran),
        potongan = COALESCE(?, potongan)
       WHERE id = ?`,
      [
        nn(b.nama), nn(b.nik), nn(b.nip),
        nn(b.tempat_lahir), nn(b.tanggal_lahir), nn(b.jenis_kelamin),
        nn(b.alamat), nn(b.no_wa), nn(b.email),
        nn(b.status_kepegawaian), nn(b.tmt),
        (b.status_aktif === undefined ? null : (Number(b.status_aktif) ? 1 : 0)),
        nn(b.link_foto), nn(b.link_ktp), nn(b.link_kk), nn(b.link_ijazah),
        nn(b.gaji_pokok), nn(b.tunj_kinerja), nn(b.tunj_umum),
        nn(b.tunj_istri), nn(b.tunj_anak), nn(b.tunj_kepala_sekolah),
        nn(b.tunj_wali_kelas), nn(b.honor_bendahara), nn(b.tunj_kehadiran),
        nn(b.potongan),
        teacherId
      ]
    );

    if (tenant_id) {
      // Update assignment HANYA pada tenant yang dituju (bukan assignment tenant lain).
      const assign = await db.query(
        `SELECT id FROM teacher_assignments WHERE teacher_id = ? AND tenant_id = ? LIMIT 1`,
        [teacherId, tenant_id]
      );
      if (assign.length) {
        await db.query(
          'UPDATE teacher_assignments SET jabatan_di_unit = COALESCE(?, jabatan_di_unit) WHERE id = ?',
          [jabatanFinal, assign[0].id]
        );
      } else {
        await db.query(
          'INSERT INTO teacher_assignments (teacher_id, tenant_id, jabatan_di_unit) VALUES (?, ?, ?)',
          [teacherId, tenant_id, jabatanFinal]
        );
      }
    } else if (jabatanFinal) {
      const placeholders2 = allowedTenants.map(() => '?').join(',');
      await db.query(
        `UPDATE teacher_assignments SET jabatan_di_unit = ? WHERE teacher_id = ? AND tenant_id IN (${placeholders2})`,
        [jabatanFinal, teacherId, ...allowedTenants]
      );
    }

    res.json({ success: true, message: 'Guru berhasil diperbarui' });
  } catch (error) {
    console.error('SDM update teacher error:', error);
    res.status(500).json({ success: false, message: 'Gagal memperbarui guru', error: error.message });
  }
});

// DELETE (soft) /api/sdm-dashboard/teachers/:id
router.delete('/sdm-dashboard/teachers/:id', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getSdmAllowedTenants(req);
    const teacherId = parseInt(req.params.id);
    const assign = await db.query(
      'SELECT tenant_id FROM teacher_assignments WHERE teacher_id = ? LIMIT 1',
      [teacherId]
    );
    if (!assign.length || !allowedTenants.includes(assign[0].tenant_id)) {
      return res.status(403).json({ success: false, message: 'Tenant tidak diizinkan' });
    }
    await db.query('UPDATE teachers SET status_aktif = 0 WHERE id = ?', [teacherId]);
    res.json({ success: true, message: 'Guru dinonaktifkan' });
  } catch (error) {
    console.error('SDM delete teacher error:', error);
    res.status(500).json({ success: false, message: 'Gagal menonaktifkan guru', error: error.message });
  }
});

// GET /api/sdm-dashboard/manual-attendance-monthly
router.get('/sdm-dashboard/manual-attendance-monthly', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getSdmAllowedTenants(req);
    let tenantId = req.query.tenant_id;
    const bulan = parseInt(req.query.bulan || new Date().getMonth() + 1);
    const tahun = parseInt(req.query.tahun || new Date().getFullYear());

    if (!tenantId || !allowedTenants.includes(tenantId)) {
      // fallback first allowed
      tenantId = allowedTenants[0];
    }
    if (!tenantId) {
      return res.json({ success: true, data: [], daysInMonth: 0, activeDays: [], leave_requests: [] });
    }

    const teachers = await db.query(
      'SELECT t.id, t.nama FROM teachers t WHERE t.id IN (SELECT teacher_id FROM teacher_assignments WHERE tenant_id = ?) AND t.status_aktif = 1',
      [tenantId]
    );

    const logs = await db.query(
      'SELECT al.teacher_id, DAY(al.waktu_scan) as hari, al.status, al.dinas_luar, al.keterangan, al.waktu_scan, al.jenis, al.metode FROM attendance_logs al WHERE MONTH(al.waktu_scan) = ? AND YEAR(al.waktu_scan) = ? AND al.teacher_id IN (SELECT teacher_id FROM teacher_assignments WHERE tenant_id = ?)',
      [bulan, tahun, tenantId]
    );

    const daysInMonth = new Date(tahun, bulan, 0).getDate();
    const firstDayOfMonth = String(tahun).padStart(4, '0') + '-' + String(bulan).padStart(2, '0') + '-01';
    const lastDayOfMonth = String(tahun).padStart(4, '0') + '-' + String(bulan).padStart(2, '0') + '-' + String(daysInMonth).padStart(2, '0');

    const leaveLogs = await db.query(
      'SELECT lr.id, lr.teacher_id, lr.jenis, lr.keterangan, lr.tanggal_mulai, lr.tanggal_selesai, lr.status FROM leave_requests lr WHERE lr.teacher_id IN (SELECT teacher_id FROM teacher_assignments WHERE tenant_id = ?) AND ((MONTH(lr.tanggal_mulai) = ? AND YEAR(lr.tanggal_mulai) = ?) OR (MONTH(lr.tanggal_selesai) = ? AND YEAR(lr.tanggal_selesai) = ?) OR (lr.tanggal_mulai <= ? AND lr.tanggal_selesai >= ?))',
      [tenantId, bulan, tahun, bulan, tahun, firstDayOfMonth, lastDayOfMonth]
    );

    // activeDays hanya dari attendance_logs
    const dayRecordCount = {};
    logs.forEach(l => {
      const day = parseInt(l.hari);
      if (day >= 1 && day <= daysInMonth) dayRecordCount[day] = (dayRecordCount[day] || 0) + 1;
    });
    const activeDays = Object.keys(dayRecordCount).filter(d => dayRecordCount[d] > 0).map(d => parseInt(d));

    const weekendDays = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(tahun, bulan - 1, d);
      if (date.getDay() === 0 || date.getDay() === 6) weekendDays.push(d);
    }

    const result = teachers.map(t => {
      const row = { id: t.id, nama: t.nama };
      for (let d = 1; d <= daysInMonth; d++) { row['tgl_' + d] = ''; row['tgl_' + d + '_masuk'] = ''; row['tgl_' + d + '_pulang'] = ''; row['tgl_' + d + '_leave'] = null; }
      const allLogs = [
        ...logs.filter(l => l.teacher_id === t.id).map(l => ({
          teacher_id: l.teacher_id, hari: l.hari, status: l.status, dinas_luar: l.dinas_luar,
          keterangan: l.keterangan, waktu_scan: l.waktu_scan, jenis: l.jenis
        })),
        ...leaveLogs.filter(l => l.teacher_id === t.id).map(l => {
          const entries = [];
          const startDate = new Date(l.tanggal_mulai);
          const endDate = new Date(l.tanggal_selesai);
          // Cuti overlap bulan ini bila mulai <= akhir bulan DAN selesai >= awal bulan
          if (startDate <= new Date(lastDayOfMonth) && endDate >= new Date(firstDayOfMonth)) {
            let current = new Date(startDate);
            while (current <= endDate) {
              if (current.getMonth() === bulan - 1 && current.getFullYear() === tahun) {
                entries.push({
                  teacher_id: l.teacher_id, hari: current.getDate(), status: l.jenis,
                  dinas_luar: l.jenis === 'dinas_luar' ? 1 : 0, keterangan: l.keterangan,
                  waktu_scan: current, leave_id: l.id, leave_status: l.status
                });
              }
              current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
            }
          }
          return entries;
        }).flat()
      ];

      allLogs.sort((a, b) => {
        const timeA = a.waktu_scan ? new Date(a.waktu_scan).getTime() : 0;
        const timeB = b.waktu_scan ? new Date(b.waktu_scan).getTime() : 0;
        return timeA - timeB;
      });

      const dailyBest = {};
      allLogs.forEach(l => {
        const day = parseInt(l.hari);
        if (day < 1 || day > daysInMonth) return;
        if (!dailyBest[day]) dailyBest[day] = { masuk: null, pulang: null, masukStatus: null, leave: null };
        const waktu = l.waktu_scan ? new Date(l.waktu_scan) : null;
        const jam = waktu ? waktu.getHours() * 60 + waktu.getMinutes() : -1;
        if (l.leave_id) {
          dailyBest[day].leave = { id: l.leave_id, jenis: l.status, status: l.leave_status, keterangan: l.keterangan };
        }
        if (l.jenis === 'masuk') {
          // Pilih scan masuk: utamakan scan pagi normal (>=04:00) di atas scan dini hari,
          // lalu ambil yang paling awal pada kelas yang sama.
          const isEarly = jam >= 240;
          const stored = dailyBest[day].masuk;
          const storedIsEarly = stored !== null && stored < 240;
          if (stored === null || (isEarly && !storedIsEarly) || (isEarly === storedIsEarly && jam < stored)) {
            dailyBest[day].masuk = jam;
            dailyBest[day].masukStatus = l.status;
          }
        } else if (l.jenis === 'pulang') {
          if (!dailyBest[day].pulang || jam > dailyBest[day].pulang) {
            dailyBest[day].pulang = jam;
          }
        }
      });

      let hadir = 0, terlambat = 0, izin = 0, cuti = 0, dinas_luar = 0, sakit = 0, tanpa_keterangan = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const best = dailyBest[d];
        const date = new Date(tahun, bulan - 1, d);
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        if (isWeekend) continue;
        if (best && best.leave) {
          row['tgl_' + d] = best.leave.jenis === 'izin' ? 'I' : best.leave.jenis === 'sakit' ? 'S' : best.leave.jenis === 'cuti' ? 'C' : best.leave.jenis === 'dinas_luar' ? 'DL' : best.leave.jenis;
          row['tgl_' + d + '_leave'] = best.leave;
          if (best.leave.jenis === 'izin') izin++;
          else if (best.leave.jenis === 'sakit') sakit++;
          else if (best.leave.jenis === 'cuti') cuti++;
          else if (best.leave.jenis === 'dinas_luar') dinas_luar++;
        } else if (best && best.masuk !== null) {
          const h = Math.floor(best.masuk / 60).toString().padStart(2, '0');
          const m = (best.masuk % 60).toString().padStart(2, '0');
          row['tgl_' + d + '_masuk'] = h + ':' + m;
          if (best.masukStatus === 'tepat_waktu') { row['tgl_' + d] = 'H'; hadir++; }
          else if (best.masukStatus === 'terlambat') { row['tgl_' + d] = 'T'; terlambat++; }
          else if (best.masukStatus === 'dinas_luar') { row['tgl_' + d] = 'DL'; dinas_luar++; }
          else if (best.masukStatus === 'izin') { row['tgl_' + d] = 'I'; izin++; }
          else if (best.masukStatus === 'cuti') { row['tgl_' + d] = 'C'; cuti++; }
          else if (best.masukStatus === 'sakit') { row['tgl_' + d] = 'S'; sakit++; }
        }
      }
      for (let d = 1; d <= daysInMonth; d++) {
        if (!row['tgl_' + d]) {
          const date = new Date(tahun, bulan - 1, d);
          const isWeekend = date.getDay() === 0 || date.getDay() === 6;
          if (isWeekend || !activeDays.includes(d)) {
            row['tgl_' + d] = '';
          } else {
            row['tgl_' + d] = 'TK';
            tanpa_keterangan++;
          }
        }
      }
      row.hadir = hadir; row.terlambat = terlambat; row.izin = izin; row.cuti = cuti;
      row.dinas_luar = dinas_luar; row.sakit = sakit; row.tanpa_keterangan = tanpa_keterangan;
      row.weekendDays = weekendDays;
      return row;
    });

    res.json({ success: true, data: result, daysInMonth, activeDays, leave_requests: leaveLogs });
  } catch (error) {
    console.error('Manual attendance monthly error:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat absensi manual', error: error.message });
  }
});

// POST /api/sdm-dashboard/manual-attendance - Tambah absensi manual
router.post('/sdm-dashboard/manual-attendance', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getSdmAllowedTenants(req);
    const { teacher_id, tenant_id, tanggal, jenis, status, waktu, keterangan } = req.body || {};
    if (!teacher_id || !tenant_id || !tanggal || !jenis) {
      return res.status(400).json({ success: false, message: 'teacher_id, tenant_id, tanggal, jenis wajib diisi' });
    }
    if (!allowedTenants.includes(tenant_id)) {
      return res.status(403).json({ success: false, message: 'Tenant tidak diizinkan' });
    }
    const assign = await db.query(
      'SELECT id FROM teacher_assignments WHERE teacher_id = ? AND tenant_id = ? LIMIT 1',
      [teacher_id, tenant_id]
    );
    if (!assign.length) {
      return res.status(400).json({ success: false, message: 'Guru tidak terdaftar di tenant ini' });
    }

    const leaveTypes = ['izin', 'sakit', 'cuti', 'dinas_luar'];
    if (leaveTypes.includes(jenis)) {
      // create approved leave_request
      const lr = await db.query(
        `INSERT INTO leave_requests (teacher_id, jenis, keterangan, tanggal_mulai, tanggal_selesai, status, tenant_id, created_at)
         VALUES (?, ?, ?, ?, ?, 'approved', ?, NOW())`,
        [teacher_id, jenis, keterangan || '', tanggal, tanggal, tenant_id]
      );
      const leaveId = lr.insertId;
      // create attendance_logs
      const waktuScan = tanggal + ' ' + (waktu || '00:00:00');
      const note = (jenis.charAt(0).toUpperCase() + jenis.slice(1)) + ': ' + (keterangan || '');
      await db.query(
        `INSERT INTO attendance_logs (teacher_id, tenant_id, waktu_scan, waktu_absen, jenis, metode, status, keterangan, dinas_luar)
         VALUES (?, ?, ?, ?, 'masuk', 'dashboard', ?, ?, ?)`,
        [teacher_id, tenant_id, waktuScan, waktuScan, status || 'tepat_waktu', note, jenis === 'dinas_luar' ? 1 : 0]
      );
      return res.json({ success: true, message: 'Absensi manual (izin) tersimpan', data: { leave_id: leaveId } });
    }

    // masuk/pulang
    const jenisAbsen = (jenis === 'pulang') ? 'pulang' : 'masuk';
    const waktuScan = tanggal + ' ' + (waktu || (jenisAbsen === 'masuk' ? '07:00:00' : '15:00:00'));
    await db.query(
      `INSERT INTO attendance_logs (teacher_id, tenant_id, waktu_scan, waktu_absen, jenis, metode, status, keterangan, dinas_luar)
       VALUES (?, ?, ?, ?, ?, 'dashboard', ?, ?, 0)`,
      [teacher_id, tenant_id, waktuScan, waktuScan, jenisAbsen, status || 'tepat_waktu', keterangan || 'Input manual SDM']
    );
    res.json({ success: true, message: 'Absensi manual tersimpan' });
  } catch (error) {
    console.error('SDM manual attendance create error:', error);
    res.status(500).json({ success: false, message: 'Gagal menyimpan absensi manual', error: error.message });
  }
});

// DELETE /api/sdm-dashboard/manual-attendance/:id
router.delete('/sdm-dashboard/manual-attendance/:id', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getSdmAllowedTenants(req);
    const id = parseInt(req.params.id);
    const rows = await db.query(
      'SELECT id, tenant_id, metode FROM attendance_logs WHERE id = ?',
      [id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Record tidak ditemukan' });
    if (!allowedTenants.includes(rows[0].tenant_id)) {
      return res.status(403).json({ success: false, message: 'Tenant tidak diizinkan' });
    }
    if (rows[0].metode !== 'dashboard') {
      return res.status(400).json({ success: false, message: 'Hanya record manual (dashboard) yang bisa dihapus' });
    }
    await db.query('DELETE FROM attendance_logs WHERE id = ?', [id]);
    res.json({ success: true, message: 'Record dihapus' });
  } catch (error) {
    console.error('SDM manual attendance delete error:', error);
    res.status(500).json({ success: false, message: 'Gagal menghapus record', error: error.message });
  }
});

// GET /api/sdm-dashboard/school-detail
router.get('/sdm-dashboard/school-detail', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getSdmAllowedTenants(req);
    const tenantId = req.query.tenant_id;
    const days = parseInt(req.query.days || 7);
    if (!tenantId || !allowedTenants.includes(tenantId)) {
      return res.status(403).json({ success: false, message: 'Tenant tidak diizinkan' });
    }
    const tenantRows = await db.query('SELECT tenant_id, nama_sekolah, tipe_unit FROM tenants WHERE tenant_id = ?', [tenantId]);
    const tenant = tenantRows[0] || { tenant_id: tenantId, nama_sekolah: tenantId };

    const teachers = await db.query(
      `SELECT t.id, t.nama, t.nik, t.status_kepegawaian
       FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id
       WHERE ta.tenant_id = ? AND t.status_aktif = 1 ORDER BY t.nama`,
      [tenantId]
    );

    const since = new Date();
    since.setDate(since.getDate() - (days - 1));
    const sinceStr = since.toISOString().split('T')[0];

    const logs = await db.query(
      `SELECT teacher_id, DATE(waktu_scan) as tgl, status, jenis
       FROM attendance_logs
       WHERE tenant_id = ? AND DATE(waktu_scan) >= ?`,
      [tenantId, sinceStr]
    );

    const pendingLeaves = await db.query(
      `SELECT teacher_id, COUNT(*) as total FROM leave_requests
       WHERE tenant_id = ? AND status = 'pending'
       GROUP BY teacher_id`,
      [tenantId]
    );
    const pendingMap = {};
    pendingLeaves.forEach(r => { pendingMap[r.teacher_id] = r.total; });

    const teacherDetails = teachers.map(t => {
      const tLogs = logs.filter(l => l.teacher_id === t.id);
      const presentDays = new Set(tLogs.filter(l => l.jenis === 'masuk').map(l => l.tgl)).size;
      const lateCount = tLogs.filter(l => l.status === 'terlambat').length;
      return {
        id: t.id, nama: t.nama, nik: t.nik, status_kepegawaian: t.status_kepegawaian,
        present_days: presentDays, late_count: lateCount,
        pending_leaves: pendingMap[t.id] || 0
      };
    });

    res.json({
      success: true,
      data: { tenant, days, teachers: teacherDetails }
    });
  } catch (error) {
    console.error('SDM school detail error:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat detail sekolah', error: error.message });
  }
});

// ============================================================
// PAYROLL - GET /api/sdm-dashboard/payroll
// Sumber data: tabel payroll (jika ada), jika kosong dihitung dari data guru + absensi
// ============================================================
router.get('/sdm-dashboard/payroll', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getSdmAllowedTenants(req);
    let tenantId = req.query.tenant_id;
    if (!tenantId || !allowedTenants.includes(tenantId)) tenantId = allowedTenants[0];
    if (!tenantId) return res.json({ success: true, data: [] });

    const bulan = parseInt(req.query.bulan || new Date().getMonth() + 1);
    const tahun = parseInt(req.query.tahun || new Date().getFullYear());
    const periode = `${tahun}-${String(bulan).padStart(2, '0')}`;
    const N = v => Number(v) || 0;

    // 1) Utamakan tabel payroll
    const saved = await db.query(
      `SELECT p.teacher_id, t.nama as nama_guru, tn.nama_sekolah,
              p.gaji_pokok, p.tunj_kinerja, p.tunj_umum, p.tunj_istri, p.tunj_anak,
              p.tunj_kepala_sekolah, p.tunj_wali_kelas, p.honor_bendahara, p.tunj_kehadiran,
              p.potongan, p.total_gaji, p.hadir
       FROM payroll p
       JOIN teachers t ON p.teacher_id = t.id
       JOIN tenants tn ON p.tenant_id = tn.tenant_id
       WHERE p.tenant_id = ? AND p.periode = ?
       ORDER BY t.nama ASC`,
      [tenantId, periode]
    );

    if (saved.length) {
      const rows = saved.map(p => {
        const tunjangan = N(p.tunj_kinerja) + N(p.tunj_umum) + N(p.tunj_istri) + N(p.tunj_anak) +
          N(p.tunj_kepala_sekolah) + N(p.tunj_wali_kelas) + N(p.honor_bendahara) + N(p.tunj_kehadiran);
        return {
          teacher_id: p.teacher_id,
          nama_guru: p.nama_guru,
          nama_sekolah: p.nama_sekolah,
          gaji_pokok: N(p.gaji_pokok),
          tunjangan,
          potongan: N(p.potongan),
          total_gaji: N(p.total_gaji) || (N(p.gaji_pokok) + tunjangan - N(p.potongan)),
          kehadiran: p.hadir || 0
        };
      });
      return res.json({ success: true, data: rows });
    }

    // 2) Hitung dari data guru + absensi
    const teachers = await db.query(
      `SELECT DISTINCT t.id, t.nama,
              t.gaji_pokok, t.tunj_kinerja, t.tunj_umum, t.tunj_istri, t.tunj_anak,
              t.tunj_kepala_sekolah, t.tunj_wali_kelas, t.honor_bendahara, t.tunj_kehadiran, t.potongan
       FROM teachers t
       JOIN teacher_assignments ta ON t.id = ta.teacher_id
       WHERE ta.tenant_id = ? AND t.status_aktif = 1
       ORDER BY t.nama ASC`,
      [tenantId]
    );

    const att = await db.query(
      `SELECT teacher_id,
              COUNT(DISTINCT CASE WHEN status = 'tepat_waktu' AND dinas_luar = 0 THEN DATE(waktu_scan) END) as hadir
       FROM attendance_logs
       WHERE tenant_id = ? AND jenis = 'masuk' AND MONTH(waktu_scan) = ? AND YEAR(waktu_scan) = ?
       GROUP BY teacher_id`,
      [tenantId, bulan, tahun]
    );
    const attMap = {};
    att.forEach(a => { attMap[a.teacher_id] = a.hadir || 0; });

    const rows = teachers.map(t => {
      const tunjangan = N(t.tunj_kinerja) + N(t.tunj_umum) + N(t.tunj_istri) + N(t.tunj_anak) +
        N(t.tunj_kepala_sekolah) + N(t.tunj_wali_kelas) + N(t.honor_bendahara) + N(t.tunj_kehadiran);
      const gajiPokok = N(t.gaji_pokok);
      const potongan = N(t.potongan);
      return {
        teacher_id: t.id,
        nama_guru: t.nama,
        nama_sekolah: tenantId,
        gaji_pokok: gajiPokok,
        tunjangan,
        potongan,
        total_gaji: gajiPokok + tunjangan - potongan,
        kehadiran: attMap[t.id] || 0
      };
    });

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('SDM payroll error:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat penggajian', error: error.message });
  }
});

// ============================================================
// KAFALAH (read) - GET /api/sdm-dashboard/kafalah
// ============================================================
router.get('/sdm-dashboard/kafalah', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getSdmAllowedTenants(req);
    let tenantId = req.query.tenant_id;
    if (!tenantId || !allowedTenants.includes(tenantId)) tenantId = allowedTenants[0];
    if (!tenantId) return res.json({ success: true, data: [] });

    const periode = req.query.periode; // YYYY-MM (opsional)
    let where = 'WHERE tenant_id = ?';
    const params = [tenantId];
    if (periode) {
      where += ' AND DATE_FORMAT(periode_mulai, "%Y-%m") = ?';
      params.push(periode);
    }
    const rows = await db.query(`SELECT * FROM kafalah_payroll ${where} ORDER BY nama ASC`, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('SDM kafalah error:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat KAFALAH', error: error.message });
  }
});

// ============================================================
// KAFALAH SETTINGS - GET /api/sdm-dashboard/kafalah-settings
// ============================================================
router.get('/sdm-dashboard/kafalah-settings', authenticateOperator, async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM kafalah_settings ORDER BY id ASC');
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('SDM kafalah settings error:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat pengaturan KAFALAH', error: error.message });
  }
});

// ============================================================
// TEACHER DETAIL (full) - GET /api/sdm-dashboard/teachers/:id
// Dipakai modal edit & detail guru; mengembalikan seluruh kolom + penempatan
// ============================================================
router.get('/sdm-dashboard/teachers/:id', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getSdmAllowedTenants(req);
    const teacherId = parseInt(req.params.id);
    const rows = await db.query('SELECT * FROM teachers WHERE id = ?', [teacherId]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
    }
    const assigns = await db.query(
      `SELECT ta.tenant_id, ta.jabatan_di_unit, tn.nama_sekolah
       FROM teacher_assignments ta
       JOIN tenants tn ON ta.tenant_id = tn.tenant_id
       WHERE ta.teacher_id = ?`,
      [teacherId]
    );
    const allowed = assigns.filter(a => allowedTenants.includes(a.tenant_id));
    if (!allowed.length) {
      return res.status(403).json({ success: false, message: 'Tenant tidak diizinkan' });
    }
    const requested = req.query.tenant_id;
    const primary = (requested && allowed.find(a => a.tenant_id === requested)) || allowed[0];
    res.json({
      success: true,
      data: {
        ...rows[0],
        tenant_id: primary.tenant_id,
        jabatan: primary.jabatan_di_unit || '',
        nama_sekolah: primary.nama_sekolah || ''
      }
    });
  } catch (error) {
    console.error('SDM teacher detail error:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat data guru', error: error.message });
  }
});

// ============================================================
// ABSENSI MANUAL - TEMPLATE & IMPORT (spreadsheet per bulan per sekolah)
// ============================================================
async function insertAttendanceLogIfAbsent(teacherId, tenantId, waktuScan, jenis, status) {
  const date = waktuScan.slice(0, 10);
  const existing = await db.query(
    'SELECT id FROM attendance_logs WHERE teacher_id = ? AND tenant_id = ? AND jenis = ? AND DATE(waktu_scan) = ? LIMIT 1',
    [teacherId, tenantId, jenis, date]
  );
  if (existing.length) return false; // sudah ada -> abaikan
  await db.query(
    'INSERT INTO attendance_logs (teacher_id, tenant_id, waktu_scan, jenis, metode, status, keterangan, waktu_absen) VALUES (?,?,?,?,?,?,?,?)',
    [teacherId, tenantId, waktuScan, jenis, 'dashboard', status, 'import manual', waktuScan]
  );
  return true;
}

// GET /sdm-dashboard/manual-attendance/template?tenant_id=&bulan=&tahun=
router.get('/sdm-dashboard/manual-attendance/template', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getSdmAllowedTenants(req);
    let tenantId = req.query.tenant_id;
    if (!tenantId || !allowedTenants.includes(tenantId)) tenantId = allowedTenants[0];
    if (!tenantId) return res.status(400).json({ success: false, message: 'tenant_id wajib diisi' });

    const bulan = parseInt(req.query.bulan || new Date().getMonth() + 1);
    const tahun = parseInt(req.query.tahun || new Date().getFullYear());
    const daysInMonth = new Date(tahun, bulan, 0).getDate();
    const monthNames = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

    const tenantRows = await db.query('SELECT nama_sekolah FROM tenants WHERE tenant_id = ? LIMIT 1', [tenantId]);
    const tenantName = tenantRows[0]?.nama_sekolah || tenantId;

    const teachers = await db.query(
      `SELECT DISTINCT t.id, t.nama FROM teachers t
       JOIN teacher_assignments ta ON t.id = ta.teacher_id
       WHERE ta.tenant_id = ? AND t.status_aktif = 1
       ORDER BY t.nama ASC`,
      [tenantId]
    );

    // Data absensi yang sudah ada di DB -> di-prefill ke template
    const attLogs = await db.query(
      `SELECT teacher_id, DAY(waktu_scan) hari, jenis, TIME(waktu_scan) jam
       FROM attendance_logs
       WHERE tenant_id = ? AND MONTH(waktu_scan) = ? AND YEAR(waktu_scan) = ?
       ORDER BY waktu_scan ASC`,
      [tenantId, bulan, tahun]
    );
    const existingMap = {};
    attLogs.forEach(l => {
      const day = parseInt(l.hari);
      const tid = l.teacher_id;
      if (!existingMap[tid]) existingMap[tid] = {};
      if (!existingMap[tid][day]) existingMap[tid][day] = {};
      const jam = String(l.jam).slice(0, 5);
      if (l.jenis === 'masuk') {
        if (!existingMap[tid][day].masuk || jam < existingMap[tid][day].masuk) existingMap[tid][day].masuk = jam;
      } else if (l.jenis === 'pulang') {
        if (!existingMap[tid][day].pulang || jam > existingMap[tid][day].pulang) existingMap[tid][day].pulang = jam;
      }
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'SDM Dashboard';
    wb.created = new Date();

    const ws = wb.addWorksheet(`Absensi ${monthNames[bulan]} ${tahun}`, {
      views: [{ state: 'frozen', xSplit: 2, ySplit: 7 }],
      pageSetup: {
        orientation: 'landscape',
        paperSize: 9, // A4
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: true,
        margins: { left: 0.25, right: 0.25, top: 0.3, bottom: 0.3, header: 0.1, footer: 0.1 }
      }
    });

    const lastCol = 2 + daysInMonth * 2; // jumlah kolom (1-based)
    const nameWidth = Math.min(42, Math.max(18, ...teachers.map(t => String(t.nama || '').length + 2), 18));

    // Lebar kolom (auto-fit: No=5, Nama mengikuti teks terpanjang, hari=9)
    ws.getColumn(1).width = 5;
    ws.getColumn(2).width = nameWidth;
    for (let d = 1; d <= daysInMonth; d++) {
      ws.getColumn(2 + (d - 1) * 2 + 1).width = 9;
      ws.getColumn(2 + (d - 1) * 2 + 2).width = 9;
    }

    const thin = { style: 'thin', color: { argb: 'FF9CA3AF' } };
    const borderAll = { top: thin, left: thin, bottom: thin, right: thin };
    const fillDate = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
    const fillSub = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB8CCE4' } };
    const fillNo = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
    const fillGreen = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } }; // terisi
    const fillGray = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };  // kosong
    const fontGreen = { color: { argb: 'FF006100' } };

    // Row 1: merge penuh hingga kolom terakhir; gambar kop kecil & rata tengah
    const colPx = (w) => Math.round(w * 7 + 5);
    const colWidthsPx = [colPx(5), colPx(nameWidth)];
    for (let d = 0; d < daysInMonth * 2; d++) colWidthsPx.push(colPx(9));
    const totalPx = colWidthsPx.reduce((a, b) => a + b, 0);
    const imgW = 1134; // 30 cm (≈ 1134 px @96dpi)
    const imgH = Math.max(24, Math.round(imgW * 219 / 3654));
    ws.mergeCells(1, 1, 1, lastCol);
    ws.getRow(1).height = Math.round(imgH * 0.75) + 6;
    const imgPath = path.join(__dirname, '../../public/assets/images/header-yayasan-landscape.png');
    if (fs.existsSync(imgPath)) {
      const imgId = wb.addImage({ filename: imgPath, extension: 'png' });
      // Posisi kiri = tengah tabel - setengah lebar gambar
      const leftPx = Math.max(0, totalPx / 2 - imgW / 2);
      let acc = 0, idx = 0, offPx = 0;
      for (let i = 0; i < colWidthsPx.length; i++) {
        if (acc + colWidthsPx[i] > leftPx) { idx = i; offPx = leftPx - acc; break; }
        acc += colWidthsPx[i];
      }
      const tl = { nativeCol: idx, nativeColOff: Math.round(offPx * 9525), nativeRow: 0, nativeRowOff: 0 };
      ws.addImage(imgId, { tl, ext: { width: imgW, height: imgH }, editAs: 'oneCell' });
    }

    const mergeRow = (r, text, font, height) => {
      ws.mergeCells(r, 1, r, lastCol);
      const c = ws.getCell(r, 1);
      c.value = text;
      c.font = font;
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(r).height = height;
    };
    mergeRow(2, 'INPUT ABSENSI MANUAL GURU', { bold: true, size: 15, color: { argb: 'FF1F3864' } }, 24);
    mergeRow(3, `Sekolah: ${tenantName}`, { bold: true, size: 11, color: { argb: 'FF1F3864' } }, 19);
    mergeRow(4, `Periode: ${monthNames[bulan]} ${tahun}   |   Jumlah Guru: ${teachers.length}   |   ${daysInMonth} hari`, { size: 10, color: { argb: 'FF555555' } }, 17);
    ws.getRow(5).height = 6;

    // Row 6-7: header tabel
    ws.getRow(6).height = 18;
    ws.getRow(7).height = 16;

    // No & Nama Guru (merge 2 baris)
    ws.mergeCells(6, 1, 7, 1);
    const cNo = ws.getCell(6, 1); cNo.value = 'No'; cNo.font = { bold: true, size: 10 }; cNo.alignment = { horizontal: 'center', vertical: 'middle' }; cNo.fill = fillNo;
    ws.mergeCells(6, 2, 7, 2);
    const cNm = ws.getCell(6, 2); cNm.value = 'Nama Guru'; cNm.font = { bold: true, size: 10 }; cNm.alignment = { horizontal: 'center', vertical: 'middle' }; cNm.fill = fillNo;

    // Header tanggal (merge 2 kolom) + Datang/Pulang
    for (let d = 1; d <= daysInMonth; d++) {
      const startCol = 3 + (d - 1) * 2;
      ws.mergeCells(6, startCol, 6, startCol + 1);
      const c = ws.getCell(6, startCol);
      c.value = String(d); c.font = { bold: true, size: 10 }; c.alignment = { horizontal: 'center', vertical: 'middle' }; c.fill = fillDate;
      const cIn = ws.getCell(7, startCol); cIn.value = 'Datang'; cIn.font = { bold: true, size: 8 }; cIn.alignment = { horizontal: 'center', vertical: 'middle' }; cIn.fill = fillSub;
      const cOut = ws.getCell(7, startCol + 1); cOut.value = 'Pulang'; cOut.font = { bold: true, size: 8 }; cOut.alignment = { horizontal: 'center', vertical: 'middle' }; cOut.fill = fillSub;
    }

    // Baris data guru
    teachers.forEach((t, i) => {
      const r = 8 + i;
      ws.getRow(r).height = 16;
      const cNo = ws.getCell(r, 1); cNo.value = i + 1; cNo.alignment = { horizontal: 'center', vertical: 'middle' };
      const cNm = ws.getCell(r, 2); cNm.value = t.nama; cNm.alignment = { horizontal: 'left', vertical: 'middle' };
      for (let d = 1; d <= daysInMonth; d++) {
        const startCol = 3 + (d - 1) * 2;
        const rec = existingMap[t.id] && existingMap[t.id][d];
        const masukVal = rec && rec.masuk ? rec.masuk : '';
        const pulangVal = rec && rec.pulang ? rec.pulang : '';
        const c1 = ws.getCell(r, startCol); c1.value = masukVal; c1.alignment = { horizontal: 'center', vertical: 'middle' };
        const c2 = ws.getCell(r, startCol + 1); c2.value = pulangVal; c2.alignment = { horizontal: 'center', vertical: 'middle' };
        c1.fill = masukVal ? fillGreen : fillGray;
        c2.fill = pulangVal ? fillGreen : fillGray;
        if (masukVal) c1.font = fontGreen;
        if (pulangVal) c2.font = fontGreen;
      }
    });

    // Border seluruh area tabel (header + data)
    const lastRow = 7 + teachers.length;
    for (let r = 6; r <= lastRow; r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= lastCol; c++) {
        row.getCell(c).border = borderAll;
      }
    }

    // Sheet Keterangan
    const ws2 = wb.addWorksheet('Keterangan');
    ws2.getColumn(1).width = 20;
    ws2.getColumn(2).width = 85;
    const ket = [
      ['Item', 'Keterangan'],
      ['Dokumen', 'Template Input Absensi Manual'],
      ['Sekolah', tenantName],
      ['Periode', `${monthNames[bulan]} ${tahun} (${daysInMonth} hari)`],
      ['Cara Isi', 'Isi jam Datang & Pulang dengan format HH:MM (contoh: 07:00). Kosongkan bila tidak hadir.'],
      ['Cara Upload', 'Setelah diisi, upload kembali melalui tombol "Import Excel" pada menu Absensi Manual.'],
      ['Catatan', 'Jangan mengubah nama kolom/baris. Baris guru mengikuti daftar guru aktif pada sekolah ini.']
    ];
    ket.forEach((rowData, idx) => {
      const row = ws2.getRow(idx + 1);
      row.height = idx === 0 ? 18 : 20;
      rowData.forEach((v, ci) => {
        const c = row.getCell(ci + 1);
        c.value = v;
        c.alignment = { vertical: 'middle', wrapText: true, horizontal: 'left' };
        c.border = borderAll;
        if (idx === 0) { c.font = { bold: true, color: { argb: 'FF1F3864' } }; c.fill = fillDate; }
      });
    });

    const buffer = await wb.xlsx.writeBuffer();
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    res.setHeader('Content-Disposition', `attachment; filename="template_absensi_${tenantId}_${tahun}-${String(bulan).padStart(2, '0')}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Length', buf.length);
    res.end(buf);
  } catch (error) {
    console.error('SDM manual attendance template error:', error);
    res.status(500).json({ success: false, message: 'Gagal membuat template', error: error.message });
  }
});

// POST /sdm-dashboard/manual-attendance/import (multipart: file, tenant_id, bulan, tahun)
router.post('/sdm-dashboard/manual-attendance/import', authenticateOperator, excelUpload.single('file'), async (req, res) => {
  try {
    const allowedTenants = await getSdmAllowedTenants(req);
    let tenantId = req.body.tenant_id;
    if (!tenantId || !allowedTenants.includes(tenantId)) tenantId = allowedTenants[0];
    if (!tenantId) return res.status(400).json({ success: false, message: 'tenant_id wajib diisi' });
    if (!req.file) return res.status(400).json({ success: false, message: 'File excel wajib diupload' });

    const bulan = parseInt(req.body.bulan || new Date().getMonth() + 1);
    const tahun = parseInt(req.body.tahun || new Date().getFullYear());
    const daysInMonth = new Date(tahun, bulan, 0).getDate();

    const teachers = await db.query(
      `SELECT DISTINCT t.id, t.nama FROM teachers t
       JOIN teacher_assignments ta ON t.id = ta.teacher_id
       WHERE ta.tenant_id = ? AND t.status_aktif = 1`,
      [tenantId]
    );
    const byName = {};
    teachers.forEach(t => { byName[String(t.nama).trim().toLowerCase()] = t; });

    // Aturan kehadiran per tenant (sama seperti scanner) untuk klasifikasi status
    const rules = await db.query(
      'SELECT tipe, jam_mulai, jam_selesai, status_log FROM attendance_rules WHERE tenant_id = ?',
      [tenantId]
    );
    const jamToMin = (v) => { const m = String(v).match(/(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : -1; };
    const statusFor = (jenis, hhmm) => {
      const t = jamToMin(hhmm);
      const tipe = jenis === 'masuk' ? 'Datang' : 'Pulang';
      const cand = rules
        .filter(r => r.tipe === tipe)
        .map(r => ({ sm: jamToMin(r.jam_mulai), em: jamToMin(r.jam_selesai), s: r.status_log }))
        .filter(r => t >= r.sm && t <= r.em)
        .sort((a, b) => b.sm - a.sm);
      const s = cand.length ? cand[0].s : null;
      return (s === 'tepat_waktu' || s === 'terlambat') ? s : 'tepat_waktu';
    };

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    if (!aoa.length) return res.status(400).json({ success: false, message: 'File kosong' });

    // Deteksi baris header (baris yang memuat "Nama Guru"); data 2 baris setelahnya.
    // Mengakomodasi template lama (header di baris 1) maupun baru (ada judul di atas).
    let headerRow = -1;
    for (let i = 0; i < Math.min(aoa.length, 25); i++) {
      const row = aoa[i] || [];
      if (row.some(c => String(c).trim().toLowerCase() === 'nama guru')) { headerRow = i; break; }
    }
    const dataStart = headerRow >= 0 ? headerRow + 2 : 2;

    const parseTime = (v) => {
      if (v === '' || v === null || v === undefined) return '';
      if (typeof v === 'number') {
        const frac = v - Math.floor(v);
        const totalMin = Math.round(frac * 24 * 60);
        const hh = Math.floor(totalMin / 60) % 24;
        const mm = totalMin % 60;
        return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
      }
      const s = String(v).trim().replace(/\./g, ':');
      const m = s.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
      if (m) return String(Math.min(23, parseInt(m[1]))).padStart(2, '0') + ':' + String(Math.min(59, parseInt(m[2]))).padStart(2, '0');
      return '';
    };

    let saved = 0, skipped = 0;
    const errors = [];
    for (let r = dataStart; r < aoa.length; r++) {
      const row = aoa[r];
      if (!row || !row.length) continue;
      const nama = String(row[1] ?? '').trim();
      if (!nama) continue;
      const teacher = byName[nama.toLowerCase()];
      if (!teacher) { errors.push(`Baris ${r + 1}: guru "${nama}" tidak ditemukan`); continue; }

      for (let d = 1; d <= daysInMonth; d++) {
        const baseCol = 2 + (d - 1) * 2;
        const masukStr = parseTime(row[baseCol]);
        const pulangStr = parseTime(row[baseCol + 1]);
        if (!masukStr && !pulangStr) continue;
        const dateStr = `${tahun}-${String(bulan).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (masukStr) {
          const status = statusFor('masuk', masukStr);
          const ok = await insertAttendanceLogIfAbsent(teacher.id, tenantId, `${dateStr} ${masukStr}:00`, 'masuk', status);
          if (ok) saved++; else skipped++;
        }
        if (pulangStr) {
          const status = statusFor('pulang', pulangStr);
          const ok = await insertAttendanceLogIfAbsent(teacher.id, tenantId, `${dateStr} ${pulangStr}:00`, 'pulang', status);
          if (ok) saved++; else skipped++;
        }
      }
    }

    res.json({
      success: true,
      message: `Import selesai: ${saved} catatan baru disimpan, ${skipped} sudah ada (dilewati)`,
      saved,
      skipped,
      errorCount: errors.length,
      errors: errors.slice(0, 50)
    });
  } catch (error) {
    console.error('SDM manual attendance import error:', error);
    res.status(500).json({ success: false, message: 'Gagal import absensi', error: error.message });
  }
});

module.exports = router;