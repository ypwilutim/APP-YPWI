// ============================================================
// SDM KPI ROUTES - Custom KPI Management for SDM Director
// ============================================================

const express = require('express');
const db = require('../../db');
const { authenticateOperator, verifyTenantAccess } = require('../middleware/auth');
const { logToFile } = require('../middlewares/logger');

const router = express.Router();

// Helper: Get allowed tenants for user
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

// GET /api/sdm/kpi/templates - List KPI templates (filtered by role/tenant)
router.get('/sdm/kpi/templates', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getSdmAllowedTenants(req);
    const { kategori } = req.query;

    if (allowedTenants.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const params = [];
    let query = `
      SELECT id, nama, kategori, bobot, satuan, target_default, sumber, scoring_method, score_min, score_max, urutan, aktif, keterangan
      FROM kpi_indicators
      WHERE aktif = TRUE
    `;

    if (kategori) {
      query += ' AND kategori = ?';
      params.push(kategori);
    }

    query += ' ORDER BY kategori, urutan';

    const kpiTemplates = await db.query(query, params);

    res.json({ success: true, data: kpiTemplates });
  } catch (error) {
    console.error('KPI templates error:', error);
    res.status(500).json({ success: false, message: 'Error fetching KPI templates', error: error.message });
  }
});

// POST /api/sdm/kpi/templates - Create/update KPI template (SDM Pusat only)
router.post('/sdm/kpi/templates', authenticateOperator, async (req, res) => {
  try {
    if (!isSdmPusat(req)) {
      return res.status(403).json({ success: false, message: 'Hanya SDM Pusat yang boleh membuat/ mengubah template KPI' });
    }

    const { id, nama, kategori, bobot, satuan, target_default, sumber, scoring_method, score_min, score_max, urutan, keterangan } = req.body;

    if (!nama || !kategori) {
      return res.status(400).json({ success: false, message: 'Nama dan kategori wajib diisi' });
    }

    // Validasi scoring_method
    const validMethods = ['discrete_1_4', 'percent_0_100', 'scale_1_5', 'custom'];
    const safeMethod = validMethods.includes(scoring_method) ? scoring_method : 'discrete_1_4';

    // Normalisasi nilai opsional agar tidak mengirim undefined ke MySQL
    const safeBobot = (bobot === undefined || bobot === null || bobot === '') ? 0 : parseFloat(bobot);
    const safeSatuan = satuan || '%';
    const safeTarget = (target_default === undefined || target_default === null || target_default === '') ? 100 : parseFloat(target_default);
    const safeSumber = sumber || 'manual';
    const safeUrutan = (urutan === undefined || urutan === null || urutan === '') ? 0 : parseInt(urutan);
    const safeKeterangan = (keterangan === undefined || keterangan === '') ? null : keterangan;
    const safeScoreMin = (score_min === undefined || score_min === null || score_min === '') ? 0 : parseFloat(score_min);
    const safeScoreMax = (score_max === undefined || score_max === null || score_max === '') ? 100 : parseFloat(score_max);

    if (id) {
      // Update existing
      await db.query(`
        UPDATE kpi_indicators SET 
          nama = ?, kategori = ?, bobot = ?, satuan = ?, target_default = ?, sumber = ?, scoring_method = ?, score_min = ?, score_max = ?, urutan = ?, keterangan = ?
        WHERE id = ?
      `, [nama, kategori, safeBobot, safeSatuan, safeTarget, safeSumber, safeMethod, safeScoreMin, safeScoreMax, safeUrutan, safeKeterangan, id]);
    } else {
      // Insert new
      const insertResult = await db.query(`
        INSERT INTO kpi_indicators (nama, kategori, bobot, satuan, target_default, sumber, scoring_method, score_min, score_max, urutan, keterangan, aktif)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)
      `, [nama, kategori, safeBobot, safeSatuan, safeTarget, safeSumber, safeMethod, safeScoreMin, safeScoreMax, safeUrutan, safeKeterangan]);
      var newTemplateId = insertResult.insertId || null;
    }

    res.json({ success: true, message: 'Template KPI berhasil disimpan', id: id || newTemplateId || null });
  } catch (error) {
    console.error('KPI template error:', error);
    res.status(500).json({ success: false, message: 'Error KPI template', error: error.message });
  }
});

// DELETE /api/sdm/kpi/templates/:id - Hapus template KPI
router.delete('/sdm/kpi/templates/:id', authenticateOperator, async (req, res) => {
  try {
    if (!isSdmPusat(req)) {
      return res.status(403).json({ success: false, message: 'Hanya SDM Pusat yang boleh menghapus template KPI' });
    }

    await db.query('UPDATE kpi_indicators SET aktif = FALSE WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Template KPI nonaktifkan berhasil' });
  } catch (error) {
    console.error('KPI delete error:', error);
    res.status(500).json({ success: false, message: 'Error deleting KPI template', error: error.message });
  }
});

// GET /api/sdm/kpi/periods - List KPI periods
router.get('/sdm/kpi/periods', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getSdmAllowedTenants(req);
    const { status } = req.query;

    if (allowedTenants.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const params = [];
    let query = 'SELECT id, nama, jenis, bulan, tahun, status, tanggal_mulai, tanggal_selesai, created_at FROM kpi_periods WHERE 1=1';

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const periods = await db.query(query, params);

    res.json({ success: true, data: periods });
  } catch (error) {
    console.error('KPI periods error:', error);
    res.status(500).json({ success: false, message: 'Error fetching KPI periods', error: error.message });
  }
});

// POST /api/sdm/kpi/periods - Create KPI period (SDM Pusat only)
router.post('/sdm/kpi/periods', authenticateOperator, async (req, res) => {
  try {
    if (!isSdmPusat(req)) {
      return res.status(403).json({ success: false, message: 'Hanya SDM Pusat yang boleh membuat periode penilaian KPI' });
    }

    const { nama, jenis, bulan, tahun, tanggal_mulai, tanggal_selesai } = req.body;

    if (!nama || !jenis || !tahun) {
      return res.status(400).json({ success: false, message: 'Nama, jenis, dan tahun wajib diisi' });
    }

    const statusPeriode = req.body.status || (req.body.is_active === false ? 'draft' : 'aktif');

    await db.query(`
      INSERT INTO kpi_periods (nama, jenis, bulan, tahun, tanggal_mulai, tanggal_selesai, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
    `, [nama, jenis, parseInt(bulan) || null, parseInt(tahun), tanggal_mulai || null, tanggal_selesai || null, statusPeriode]);

    res.json({ success: true, message: 'Periode penilaian KPI berhasil dibuat' });
  } catch (error) {
    console.error('KPI period error:', error);
    res.status(500).json({ success: false, message: 'Error creating KPI period', error: error.message });
  }
});

// PUT /api/sdm/kpi/periods/:id - Update KPI period
router.put('/sdm/kpi/periods/:id', authenticateOperator, async (req, res) => {
  try {
    if (!isSdmPusat(req)) {
      return res.status(403).json({ success: false, message: 'Hanya SDM Pusat yang boleh mengubah periode KPI' });
    }

    const { id } = req.params;
    const { nama, jenis, bulan, tahun, tanggal_mulai, tanggal_selesai, status } = req.body;

    const updates = [];
    const values = [];

    if (nama) { updates.push('nama = ?'); values.push(nama); }
    if (jenis) { updates.push('jenis = ?'); values.push(jenis); }
    if (bulan) { updates.push('bulan = ?'); values.push(parseInt(bulan)); }
    if (tahun) { updates.push('tahun = ?'); values.push(parseInt(tahun)); }
    if (tanggal_mulai) { updates.push('tanggal_mulai = ?'); values.push(tanggal_mulai); }
    if (tanggal_selesai) { updates.push('tanggal_selesai = ?'); values.push(tanggal_selesai); }
    if (status) { updates.push('status = ?'); values.push(status); }

    if (updates.length === 0) {
      return res.json({ success: true, message: 'Tidak ada perubahan' });
    }

    values.push(id);
    await db.query(`UPDATE kpi_periods SET ${updates.join(', ')} WHERE id = ?`, values);

    res.json({ success: true, message: 'Periode penilaian KPI berhasil diupdate' });
  } catch (error) {
    console.error('KPI period update error:', error);
    res.status(500).json({ success: false, message: 'Error updating KPI period', error: error.message });
  }
});

// DELETE /api/sdm/kpi/periods/:id - Hapus KPI period (soft: jadi draft)
router.delete('/sdm/kpi/periods/:id', authenticateOperator, async (req, res) => {
  try {
    if (!isSdmPusat(req)) {
      return res.status(403).json({ success: false, message: 'Hanya SDM Pusat yang boleh menghapus periode KPI' });
    }

    await db.query("UPDATE kpi_periods SET status = 'draft' WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: 'Periode penilaian KPI berhasil dinonaktifkan' });
  } catch (error) {
    console.error('KPI period delete error:', error);
    res.status(500).json({ success: false, message: 'Error deleting KPI period', error: error.message });
  }
});

// GET /api/sdm/kpi/assessments - List KPI assessments
router.get('/sdm/kpi/assessments', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getSdmAllowedTenants(req);
    const { teacher_id, tenant_id, period_id, status = 'all' } = req.query;

    if (allowedTenants.length === 0) {
      return res.json({ success: true, data: { data: [], total: 0, page: 1, pages: 1 } });
    }

    const tenantPlaceholders = allowedTenants.map(() => '?').join(',');
    let params = [];

    let query = `
      SELECT 
        ks.id, ks.teacher_id, t.nama as teacher_name, 
        t.nik, t.nip, t.link_foto,
        (SELECT GROUP_CONCAT(DISTINCT ta.jabatan_di_unit ORDER BY ta.id SEPARATOR ', ')
         FROM teacher_assignments ta 
         WHERE ta.teacher_id = ks.teacher_id AND ta.tenant_id = ks.tenant_id) as jabatan_di_unit,
        ks.tenant_id, kp.nama as period_name, kp.jenis as period_jenis, kp.tahun as period_tahun,
         ki.nama as indicator_name, ki.id as indicator_id, ki.sumber,
         ki.kategori,
         ki.bobot,
         ki.scoring_method, ki.score_min, ki.score_max,
        ks.nilai_aktual, ks.target, ks.pencapaian, ks.skor,
        ks.penilai_id, ks.catatan, ks.status,
        kpen.nama as penilai_name
      FROM kpi_scores ks
      JOIN teachers t ON ks.teacher_id = t.id
      JOIN kpi_periods kp ON ks.period_id = kp.id
      JOIN kpi_indicators ki ON ks.indicator_id = ki.id
      LEFT JOIN teachers kpen ON ks.penilai_id = kpen.id
      WHERE ks.tenant_id IN (${tenantPlaceholders})
    `;
    params.push(...allowedTenants);

    if (period_id) {
      query += ' AND ks.period_id = ?';
      params.push(parseInt(period_id));
    }
    if (teacher_id) {
      query += ' AND ks.teacher_id = ?';
      params.push(parseInt(teacher_id));
    }
    if (tenant_id && allowedTenants.includes(tenant_id)) {
      query += ' AND ks.tenant_id = ?';
      params.push(tenant_id);
    }

    // Filter by status
    if (status !== 'all') {
      query += ' AND ks.status = ?';
      params.push(status);
    }

    query += ' ORDER BY kp.nama, t.nama, ki.urutan';

    const assessments = await db.query(query, params);

    // Count total
    let countQuery = `
      SELECT COUNT(*) as total
      FROM kpi_scores ks
      WHERE ks.tenant_id IN (${tenantPlaceholders})
    `;
    let countParams = [...allowedTenants];

    if (period_id) {
      countQuery += ' AND ks.period_id = ?';
      countParams.push(parseInt(period_id));
    }
    if (teacher_id) {
      countQuery += ' AND ks.teacher_id = ?';
      countParams.push(parseInt(teacher_id));
    }
    if (status !== 'all') {
      countQuery += ' AND ks.status = ?';
      countParams.push(status);
    }

    const totalResult = await db.query(countQuery, countParams);

    res.json({
      success: true,
      data: {
        data: assessments,
        total: totalResult[0]?.total || 0,
        page: req.query.page || 1,
        pages: Math.ceil((totalResult[0]?.total || 0) / parseInt(req.query.limit || 20))
      }
    });
  } catch (error) {
    console.error('KPI assessments error:', error);
    res.status(500).json({ success: false, message: 'Error fetching KPI assessments', error: error.message });
  }
});

// GET /api/sdm/kpi/auto-values - Compute auto indicator values from source tables
// Returns attendance % (from attendance_logs) and evaluation avg (from evaluations)
// filtered by the KPI period's date range, for all active teachers in allowed tenants.
router.get('/sdm/kpi/auto-values', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getSdmAllowedTenants(req);
    const { tenant_id, period_id, teacher_id } = req.query;

    if (allowedTenants.length === 0) {
      return res.json({ success: true, data: {} });
    }

    let dateFilterClause = '';
    let dateParams = [];
    let tanggal_mulai, tanggal_selesai;
    if (period_id) {
      const periodRows = await db.query(
        'SELECT tanggal_mulai, tanggal_selesai FROM kpi_periods WHERE id = ?',
        [parseInt(period_id)]
      );
      if (periodRows.length === 0) {
        return res.json({ success: true, data: {} });
      }
      tanggal_mulai = periodRows[0].tanggal_mulai;
      tanggal_selesai = periodRows[0].tanggal_selesai;
      dateFilterClause = 'AND DATE(al.waktu_scan) >= ? AND DATE(al.waktu_scan) <= ?';
      dateParams = [tanggal_mulai, tanggal_selesai];
    } else {
      const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      tanggal_mulai = oneMonthAgo.toISOString().split('T')[0];
      tanggal_selesai = new Date().toISOString().split('T')[0];
      dateFilterClause = 'AND al.waktu_scan >= DATE_SUB(NOW(), INTERVAL 1 MONTH)';
    }

    const tenantPlaceholders = allowedTenants.map(() => '?').join(',');
    let tenantFilter = `ta.tenant_id IN (${tenantPlaceholders})`;
    let tenantParams = [...allowedTenants];

    if (tenant_id && allowedTenants.includes(tenant_id)) {
      tenantFilter = 'ta.tenant_id = ?';
      tenantParams = [tenant_id];
    }

    let teacherFilter = '';
    let teacherParams = [];
    if (teacher_id) {
      teacherFilter = 'AND t.id = ?';
      teacherParams = [parseInt(teacher_id)];
    }

    // Compute attendance breakdown per category (COUNT DISTINCT dates per category)
    // kehadiran_pct computed in JS after tanpa_keterangan is determined
    const attendanceQuery = `
      SELECT 
        t.id as teacher_id,
        ta.tenant_id,
        COUNT(DISTINCT CASE WHEN al.status = 'tepat_waktu' AND al.dinas_luar = 0 THEN DATE(al.waktu_scan) END) as hadir,
        COUNT(DISTINCT CASE WHEN al.status = 'terlambat' AND al.dinas_luar = 0 THEN DATE(al.waktu_scan) END) as terlambat,
        COUNT(DISTINCT CASE WHEN al.dinas_luar = 1 THEN DATE(al.waktu_scan) END) as dinas_luar_attendance,
        COUNT(DISTINCT CASE WHEN al.jenis = 'masuk' THEN DATE(al.waktu_scan) END) as total_masuk_days
      FROM teachers t
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      LEFT JOIN attendance_logs al ON al.teacher_id = t.id 
        AND al.tenant_id = ta.tenant_id 
        AND al.jenis = 'masuk' 
        ${dateFilterClause}
      WHERE ${tenantFilter} AND t.status_aktif = 1
        ${teacherFilter}
      GROUP BY t.id, ta.tenant_id
    `;

    const attendanceResults = await db.query(attendanceQuery, [...dateParams, ...tenantParams, ...teacherParams]);

    // Compute evaluation avg (AVG(score)/5*100)
    // Uses the same period date range
    let evalDateFilter = '';
    let evalDateParams = [];
    if (period_id) {
      evalDateFilter = 'AND e.evaluation_date >= ? AND e.evaluation_date <= ?';
      evalDateParams = [...dateParams];
    } else {
      evalDateFilter = 'AND e.evaluation_date >= DATE_SUB(NOW(), INTERVAL 1 MONTH)';
    }

    const evaluationQuery = `
      SELECT 
        t.id as teacher_id,
        ta.tenant_id,
        ROUND(COALESCE(AVG(e.score), 0) / 5 * 100, 2) as evaluasi_pct
      FROM teachers t
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      LEFT JOIN evaluations e ON e.teacher_id = t.id 
        AND e.tenant_id = ta.tenant_id
        ${evalDateFilter}
      WHERE ${tenantFilter} AND t.status_aktif = 1
        ${teacherFilter}
      GROUP BY t.id, ta.tenant_id
    `;

    const evaluationResults = await db.query(evaluationQuery, [...evalDateParams, ...tenantParams, ...teacherParams]);

    // Fetch approved leave_requests for breakdown (izin, sakit, cuti, dinas_luar)
    let leaveDateFilter = '';
    let leaveDateParams = [];
    if (period_id) {
      leaveDateFilter = 'AND lr.tanggal_selesai >= ? AND lr.tanggal_mulai <= ?';
      leaveDateParams = [tanggal_mulai, tanggal_selesai];
    } else {
      leaveDateFilter = 'AND lr.tanggal_selesai >= DATE_SUB(NOW(), INTERVAL 1 MONTH)';
    }

    const leaveQuery = `
      SELECT 
        lr.teacher_id,
        lr.jenis,
        lr.tanggal_mulai,
        lr.tanggal_selesai
      FROM leave_requests lr
      WHERE lr.status = 'approved'
        ${leaveDateFilter}
        AND (lr.tenant_id IN (${tenantParams.map(() => '?').join(',')}) OR lr.tenant_id = '' OR lr.tenant_id IS NULL)
        ${teacherFilter ? 'AND lr.teacher_id = ?' : ''}
    `;
    const leaveParams = [...leaveDateParams, ...tenantParams];
    if (teacherFilter) {
      leaveParams.push(...teacherParams);
    }

    const leaveResults = await db.query(leaveQuery, leaveParams);

    // Query all distinct dates in the period (from attendance_logs)
    // Leave request date ranges are expanded in JavaScript (below) after fetching leave results
    const allDatesQuery = `
      SELECT DISTINCT DATE(waktu_scan) as record_date FROM attendance_logs
      WHERE tenant_id IN (${tenantParams.map(() => '?').join(',')})
        AND DATE(waktu_scan) >= ? AND DATE(waktu_scan) <= ?
    `;
    const allDatesParams = [...tenantParams, tanggal_mulai, tanggal_selesai];
    const allDatesResults = await db.query(allDatesQuery, allDatesParams);
    const allTenantDates = allDatesResults.map(function(r) { return r.record_date; });
    const tenantDatesSet = new Set(allTenantDates);

    // Build leave breakdown per teacher (expand date ranges to distinct dates)
    // Leave dates do NOT expand tenantDatesSet — only attendance_logs dates define effective days
    const leaveBreakdown = {};
    leaveResults.forEach(function(row) {
      var key = String(row.teacher_id);
      if (!leaveBreakdown[key]) {
        leaveBreakdown[key] = { izin: new Set(), sakit: new Set(), cuti: new Set(), dinas_luar: new Set() };
      }
      var start = new Date(row.tanggal_mulai);
      var end = new Date(row.tanggal_selesai);
      for (var d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        var dayKey = d.toISOString().split('T')[0];
        var jenisKey = row.jenis;
        if (leaveBreakdown[key][jenisKey]) {
          leaveBreakdown[key][jenisKey].add(dayKey);
        }
      }
    });
    const totalTenantDays = tenantDatesSet.size;

    // Merge results into a lookup: { teacher_id: { tenant_id, kehadiran_pct, evaluasi_pct } }
    const autoValues = {};

    attendanceResults.forEach(row => {
      const key = String(row.teacher_id);
      if (!autoValues[key]) {
        autoValues[key] = { teacher_id: row.teacher_id, tenant_id: row.tenant_id, kehadiran_pct: 0, evaluasi_pct: 0, breakdown: {} };
      }
      var lb = leaveBreakdown[key];
      var totalRecorded = (row.hadir || 0) + (row.terlambat || 0) + (lb ? (lb.izin.size + lb.sakit.size + lb.cuti.size + lb.dinas_luar.size) : 0) + (row.dinas_luar_attendance || 0);
      var tanpaKeterangan = totalTenantDays > 0 ? Math.max(0, totalTenantDays - totalRecorded) : 0;
      // New formula: 100 - (total_penalty / total_hari_efektif)
      // Penalty: terlambat × 3 pts, tanpa_keterangan × 100 pts
      // total_hari_efektif includes ALL active days: hadir + terlambat + izin + sakit + cuti + dinas_luar + tanpa_keterangan
      var totalHariEfektif = (row.hadir || 0) + (row.terlambat || 0) + (lb ? (lb.izin.size + lb.sakit.size + lb.cuti.size + lb.dinas_luar.size) : 0) + (row.dinas_luar_attendance || 0) + tanpaKeterangan;
      var totalPenalty = ((row.terlambat || 0) * 3) + (tanpaKeterangan * 100);
      var kehadiranPct = totalHariEfektif > 0 ? Math.max(0, Math.round((100 - (totalPenalty / totalHariEfektif)) * 100) / 100) : 100;
      autoValues[key].kehadiran_pct = kehadiranPct;
      autoValues[key].breakdown = {
        hadir: row.hadir || 0,
        terlambat: row.terlambat || 0,
        izin: lb ? lb.izin.size : 0,
        sakit: lb ? lb.sakit.size : 0,
        cuti: lb ? lb.cuti.size : 0,
        dinas_luar: (row.dinas_luar_attendance || 0) + (lb ? lb.dinas_luar.size : 0),
        tanpa_keterangan: tanpaKeterangan,
        total_hari_efektif: totalHariEfektif,
        total_penalty: totalPenalty
      };
    });

    evaluationResults.forEach(row => {
      const key = String(row.teacher_id);
      if (!autoValues[key]) {
        autoValues[key] = { teacher_id: row.teacher_id, tenant_id: row.tenant_id, kehadiran_pct: 0, evaluasi_pct: 0, breakdown: {} };
      }
      autoValues[key].evaluasi_pct = row.evaluasi_pct || 0;
    });

    res.json({
      success: true,
      data: autoValues,
      debug: {
        totalTenantDays: tenantDatesSet.size,
        tenantDates: allTenantDates,
        allowedTenants: allowedTenants,
        requestedTenant: tenant_id || null,
        tenantParams: tenantParams,
        periodId: period_id || null,
        periodDateRange: tanggal_mulai ? { tanggal_mulai, tanggal_selesai } : null
      }
    });
  } catch (error) {
    console.error('KPI auto-values error:', error);
    res.status(500).json({ success: false, message: 'Error fetching KPI auto values', error: error.message });
  }
});

// GET /api/sdm/kpi/detail-logs - Detailed source logs for auto indicator verification
// Returns attendance_logs and evaluations entries filtered by period date range.
// Query: ?tenant_id=<unit>&period_id=<id>&teacher_id=<id>
router.get('/sdm/kpi/detail-logs', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getSdmAllowedTenants(req);
    const { tenant_id, period_id, teacher_id, jenis } = req.query;

    if (allowedTenants.length === 0) {
      return res.json({ success: true, data: {} });
    }

    // Get period date range
    if (!period_id) {
      return res.status(400).json({ success: false, message: 'period_id wajib diisi' });
    }

    const periodRows = await db.query(
      'SELECT tanggal_mulai, tanggal_selesai FROM kpi_periods WHERE id = ?',
      [parseInt(period_id)]
    );
    if (periodRows.length === 0) {
      return res.json({ success: true, data: { kehadiran: [], evaluasi: [] } });
    }
    const { tanggal_mulai, tanggal_selesai } = periodRows[0];

    // Determine effective tenant: if tenant_id provided and allowed, use it; else use first allowed
    const effectiveTenant = (tenant_id && allowedTenants.includes(tenant_id)) ? tenant_id : allowedTenants[0];

    // Fetch attendance logs (filtered by period dates)
    // jenis parameter: 'masuk' (default) or 'pulang' or 'all'
    const jenisFilter = (jenis && jenis !== 'all') ? jenis : 'masuk';
    let atQuery = `
      SELECT 
        al.id,
        al.waktu_scan,
        al.jenis,
        al.status,
        al.metode,
        al.dinas_luar,
        al.keterangan,
        t.nama as teacher_name
      FROM attendance_logs al
      JOIN teachers t ON al.teacher_id = t.id
      WHERE al.tenant_id = ?
        AND DATE(al.waktu_scan) >= ?
        AND DATE(al.waktu_scan) <= ?
    `;
    let atParams = [effectiveTenant, tanggal_mulai, tanggal_selesai];
    if (jenisFilter) {
      atQuery += ' AND al.jenis = ?';
      atParams.push(jenisFilter);
    }
    if (teacher_id) {
      atQuery += ' AND al.teacher_id = ?';
      atParams.push(parseInt(teacher_id));
    }
    atQuery += ' ORDER BY al.waktu_scan DESC';

    const attendanceLogs = await db.query(atQuery, atParams);

    // Fetch evaluation logs (filtered by period dates)
    let evQuery = `
      SELECT 
        e.id,
        e.score,
        e.category,
        e.notes,
        e.evaluation_date,
        t.nama as teacher_name
      FROM evaluations e
      JOIN teachers t ON e.teacher_id = t.id
      WHERE e.tenant_id = ?
        AND e.evaluation_date >= ?
        AND e.evaluation_date <= ?
    `;
    let evParams = [effectiveTenant, tanggal_mulai, tanggal_selesai];
    if (teacher_id) {
      evQuery += ' AND e.teacher_id = ?';
      evParams.push(parseInt(teacher_id));
    }
    evQuery += ' ORDER BY e.evaluation_date DESC';

    const evaluationLogs = await db.query(evQuery, evParams);

    // Fetch ALL leave_requests for the detail modal (all statuses: pending/approved/rejected)
    // Handle empty/NULL tenant_id by using OR condition
    let lrQuery = `
      SELECT 
        lr.id,
        lr.teacher_id,
        lr.jenis,
        lr.keterangan,
        lr.tanggal_mulai,
        lr.tanggal_selesai,
        lr.status,
        t.nama as teacher_name
      FROM leave_requests lr
      JOIN teachers t ON lr.teacher_id = t.id
      WHERE (lr.tenant_id = ? OR lr.tenant_id = '' OR lr.tenant_id IS NULL)
        AND lr.tanggal_selesai >= ?
        AND lr.tanggal_mulai <= ?
    `;
    let lrParams = [effectiveTenant, tanggal_mulai, tanggal_selesai];
    if (teacher_id) {
      lrQuery += ' AND lr.teacher_id = ?';
      lrParams.push(parseInt(teacher_id));
    }
    lrQuery += ' ORDER BY lr.tanggal_mulai DESC';

    const leaveRequests = await db.query(lrQuery, lrParams);

    // Query all distinct dates in the tenant during the period (from attendance_logs)
    // Leave request date ranges are expanded in JavaScript (below)
    // Used to distinguish: null (no records at all) vs tanpa_keterangan (other teachers have records)
    const tenantDatesQuery = `
      SELECT DISTINCT DATE(waktu_scan) as record_date FROM attendance_logs
      WHERE tenant_id = ?
        AND DATE(waktu_scan) >= ?
        AND DATE(waktu_scan) <= ?
    `;
    const tenantDatesResults = await db.query(tenantDatesQuery, [
        effectiveTenant, tanggal_mulai, tanggal_selesai
    ]);
    const tenantDatesSet = new Set();
    tenantDatesResults.forEach(function(r) {
      tenantDatesSet.add(r.record_date);
    });

    // Generate full calendar for the period (only when teacher_id is provided)
    // Each date is categorized: hadir, terlambat, izin, sakit, cuti, dinas_luar, tanpa_keterangan, or null
    // - null: no records exist for this date in the tenant (weekend/holiday/boundary)
    // - tanpa_keterangan: other teachers have records but this teacher doesn't (absent without permission)
    let calendar = [];
    if (teacher_id) {
        const calStart = new Date(tanggal_mulai);
        const calEnd = new Date(tanggal_selesai);
        for (let d = new Date(calStart); d <= calEnd; d.setDate(d.getDate() + 1)) {
            const dayKey = d.toISOString().split('T')[0];
            const dayEntry = { date: dayKey };

            // Priority 1: Check leave_requests for a leave covering this date (all statuses)
            const matchingLeave = leaveRequests.find(function(lr) {
                const lrStart = new Date(lr.tanggal_mulai).toISOString().split('T')[0];
                const lrEnd = new Date(lr.tanggal_selesai).toISOString().split('T')[0];
                return dayKey >= lrStart && dayKey <= lrEnd;
            });

            if (matchingLeave) {
                dayEntry.status = matchingLeave.jenis;
                dayEntry.source = 'leave';
                dayEntry.approved = matchingLeave.status === 'approved';
                dayEntry.leave_status = matchingLeave.status;
                dayEntry.details = matchingLeave;
            } else {
                // Priority 2: Check attendance_logs for masuk scan on this date
                const matchingAttendance = attendanceLogs.find(function(al) {
                    const alDate = new Date(al.waktu_scan).toISOString().split('T')[0];
                    return alDate === dayKey && al.jenis === 'masuk';
                });

                if (matchingAttendance) {
                    dayEntry.status = matchingAttendance.status;
                    dayEntry.source = 'attendance';
                    dayEntry.details = matchingAttendance;
                } else {
                    // Check if dinas_luar flag exists for this date (any jenis)
                    const dinasLuarMatch = attendanceLogs.find(function(al) {
                        const alDate = new Date(al.waktu_scan).toISOString().split('T')[0];
                        return alDate === dayKey && al.dinas_luar == 1;
                    });
                    if (dinasLuarMatch) {
                        dayEntry.status = 'dinas_luar';
                        dayEntry.source = 'attendance';
                        dayEntry.details = dinasLuarMatch;
                    } else {
                        // Distinguish null vs tanpa_keterangan
                        if (tenantDatesSet.has(dayKey)) {
                            dayEntry.status = 'tanpa_keterangan';
                            dayEntry.source = 'none';
                        } else {
                            dayEntry.status = null;
                            dayEntry.source = 'none';
                        }
                        dayEntry.details = null;
                    }
                }
            }
            calendar.push(dayEntry);
        }
    }

    res.json({
      success: true,
      data: {
        kehadiran: attendanceLogs,
        evaluasi: evaluationLogs,
        leave_requests: leaveRequests,
        calendar: calendar
      },
      debug: {
        effectiveTenant: effectiveTenant,
        requestedTenant: tenant_id || null,
        periodDateRange: { tanggal_mulai, tanggal_selesai },
        tenantDatesSetSize: tenantDatesSet.size
      }
    });
  } catch (error) {
    console.error('KPI detail-logs error:', error);
    res.status(500).json({ success: false, message: 'Error fetching KPI detail logs', error: error.message });
  }
});

// Helper: Ambil tenant_id penempatan guru (assignment pertama)
async function getTeacherTenantId(teacherId, fallbackTenantId) {
  const rows = await db.query(
    'SELECT tenant_id FROM teacher_assignments WHERE teacher_id = ? ORDER BY id ASC LIMIT 1',
    [teacherId]
  );
  return rows[0]?.tenant_id || fallbackTenantId || null;
}

// Helper: Hitung skor dari pencapaian terhadap target
function computeSkor(nilaiAktual, target, pencapaian) {
  const t = parseFloat(target) || 100;
  if (pencapaian !== undefined && pencapaian !== null && pencapaian !== '') {
    return Math.round((parseFloat(pencapaian) || 0) * 100) / 100;
  }
  const actual = parseFloat(nilaiAktual);
  if (isNaN(actual) || t <= 0) return 0;
  return Math.round((actual / t) * 100 * 100) / 100;
}

// Helper: Konversi skor input ke persentase 0-100 berdasarkan scoring_method
function convertScoreToPercent(score, method, min, max) {
  const s = parseFloat(score);
  if (isNaN(s)) return 0;
  switch (method) {
    case 'discrete_1_4':
      return Math.min(100, Math.max(0, s * 25));
    case 'scale_1_5':
      return Math.min(100, Math.max(0, s * 20));
    case 'percent_0_100':
      return Math.min(100, Math.max(0, s));
    case 'custom': {
      const mn = parseFloat(min) || 0;
      const mx = parseFloat(max) || 100;
      const range = mx - mn;
      if (range <= 0) return 0;
      return Math.min(100, Math.max(0, ((s - mn) / range) * 100));
    }
    default:
      return Math.min(100, Math.max(0, s * 25));
  }
}

// POST /api/sdm/kpi/assessments - Input/Update KPI assessment per guru
router.post('/sdm/kpi/assessments', authenticateOperator, async (req, res) => {
  try {
    if (!isSdmPusat(req)) {
      return res.status(403).json({ success: false, message: 'Hanya SDM Pusat yang boleh menginput nilai KPI' });
    }

    const { teacher_id, period_id, indicator_id, nilai_aktual, target, pencapaian, skor, catatan } = req.body;

    if (!teacher_id || !period_id || !indicator_id) {
      return res.status(400).json({ success: false, message: 'teacher_id, period_id, dan indicator_id wajib diisi' });
    }

    // Cek periode aktif
    const periodRows = await db.query('SELECT status FROM kpi_periods WHERE id = ?', [period_id]);
    if (!periodRows.length || periodRows[0].status !== 'aktif') {
      return res.status(400).json({ success: false, message: 'Periode penilaian KPI tidak aktif' });
    }

    // Cek indicator
    const indicatorRows = await db.query('SELECT id, kategori, target_default FROM kpi_indicators WHERE id = ?', [indicator_id]);
    if (!indicatorRows.length) {
      return res.status(400).json({ success: false, message: 'Indikator KPI tidak ditemukan' });
    }
    const indicator = indicatorRows[0];

    // Verifikasi guru ada & ambil tenant penempatannya
    const teacherRows = await db.query(
      'SELECT id FROM teachers WHERE id = ? AND status_aktif = 1',
      [teacher_id]
    );
    if (!teacherRows.length) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan atau nonaktif' });
    }
    const tenantId = await getTeacherTenantId(teacher_id, req.user.tenant_id);

    // Pastikan SDM hanya boleh menilai guru di tenant yang diizinkan
    const allowedTenants = await getSdmAllowedTenants(req);
    if (!allowedTenants.includes(tenantId)) {
      return res.status(403).json({ success: false, message: 'Guru tidak berada di unit yang Anda kelola' });
    }

    const parsedTarget = parseFloat(target);
    const parsedDefaultTarget = parseFloat(indicator.target_default) || 100;
    const targetValue = (!isNaN(parsedTarget) && target !== undefined && target !== null && target !== '')
      ? parsedTarget
      : parsedDefaultTarget;
    const parsedSkor = parseFloat(skor);
    const parsedPencapaian = parseFloat(pencapaian);
    const finalSkor = (!isNaN(parsedSkor) && skor !== undefined && skor !== null && skor !== '')
      ? Math.round(parsedSkor * 100) / 100
      : computeSkor(nilai_aktual, targetValue, pencapaian);
    const finalPencapaian = (!isNaN(parsedPencapaian) && pencapaian !== undefined && pencapaian !== null && pencapaian !== '')
      ? parsedPencapaian
      : finalSkor;
    const finalNilaiAktual = (!isNaN(parseFloat(nilai_aktual)) && nilai_aktual !== undefined && nilai_aktual !== null && nilai_aktual !== '')
      ? parseFloat(nilai_aktual)
      : 0;

    // Cek apakah assessment sudah ada (untuk periode & teacher & indicator)
    const existingRows = await db.query(
      'SELECT id FROM kpi_scores WHERE teacher_id = ? AND period_id = ? AND indicator_id = ?',
      [teacher_id, period_id, indicator_id]
    );

    if (existingRows.length > 0) {
      // Update
      await db.query(`
        UPDATE kpi_scores SET
          nilai_aktual = ?, target = ?, pencapaian = ?, skor = ?, catatan = ?, penilai_id = ?, updated_at = NOW()
        WHERE id = ?
      `, [finalNilaiAktual, targetValue, finalPencapaian, finalSkor, catatan || null, req.user.id, existingRows[0].id]);
    } else {
      // Insert
      await db.query(`
        INSERT INTO kpi_scores (teacher_id, period_id, indicator_id, tenant_id, nilai_aktual, target, pencapaian, skor, penilai_id, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NOW())
      `, [teacher_id, period_id, indicator_id, tenantId, finalNilaiAktual, targetValue, finalPencapaian, finalSkor, req.user.id]);
    }

    res.json({ success: true, message: 'Nilai KPI berhasil disimpan', skor: finalSkor });
  } catch (error) {
    console.error('KPI assessment error:', error);
    res.status(500).json({ success: false, message: 'Error input KPI assessment', error: error.message });
  }
});

// GET /api/sdm/kpi/assessment-detail - Detail assessment per guru
router.get('/sdm/kpi/assessment-detail', authenticateOperator, async (req, res) => {
  try {
    const { teacher_id, period_id, indicator_id } = req.query;

    if (!teacher_id) {
      return res.status(400).json({ success: false, message: 'teacher_id wajib diisi' });
    }

    const allowedTenants = await getSdmAllowedTenants(req);
    const tenantPlaceholders = allowedTenants.map(() => '?').join(',');

    let query = `
      SELECT 
        ks.id, ks.teacher_id, t.nama as teacher_name, t.nik, t.nip,
        ks.period_id, kp.nama as period_name, kp.jenis, kp.tahun,
        ki.nama as indicator_name, ki.id as indicator_id, ki.kategori, ki.bobot, ki.satuan, ki.target_default,
        ks.nilai_aktual, ks.target, ks.pencapaian, ks.skor,
        ks.skor as calculated_skor,
        ks.status, ks.catatan, ks.penilai_id,
        kpen.nama as penilai_name, ktap.jabatan_di_unit as penilai_jabatan,
        (CASE WHEN ks.skor >= 95 THEN 5.0 WHEN ks.skor >= 90 THEN 4.5 WHEN ks.skor >= 85 THEN 4.0 WHEN ks.skor >= 80 THEN 3.5 WHEN ks.skor >= 75 THEN 3.0 WHEN ks.skor >= 70 THEN 2.5 WHEN ks.skor >= 65 THEN 2.0 ELSE 1.0 END) as skor_terbilang
      FROM kpi_scores ks
      JOIN teachers t ON ks.teacher_id = t.id
      JOIN kpi_periods kp ON ks.period_id = kp.id
      JOIN kpi_indicators ki ON ks.indicator_id = ki.id
      LEFT JOIN teachers kpen ON ks.penilai_id = kpen.id
      LEFT JOIN teacher_assignments ktap ON kpen.id = ktap.teacher_id
      WHERE ks.teacher_id = ? AND ks.tenant_id IN (${tenantPlaceholders})
    `;
    let params = [teacher_id, ...allowedTenants];

    if (period_id) {
      query += ' AND ks.period_id = ?';
      params.push(parseInt(period_id));
    }
    if (indicator_id) {
      query += ' AND ks.indicator_id = ?';
      params.push(parseInt(indicator_id));
    }

    query += ' ORDER BY ki.urutan';

    const detail = await db.query(query, params);

    res.json({ success: true, data: detail });
  } catch (error) {
    console.error('KPI assessment detail error:', error);
    res.status(500).json({ success: false, message: 'Error fetching KPI assessment detail', error: error.message });
  }
});

// POST /api/sdm/kpi/assessments/bulk - Bulk input KPI assessments
router.post('/sdm/kpi/assessments/bulk', authenticateOperator, async (req, res) => {
  try {
    if (!isSdmPusat(req)) {
      return res.status(403).json({ success: false, message: 'Hanya SDM Pusat yang boleh melakukan bulk input KPI' });
    }

    const providedAssessments = Array.isArray(req.body.assessments) ? req.body.assessments : [];

    if (!providedAssessments.length) {
      return res.status(400).json({ success: false, message: 'assessments array wajib diisi' });
    }

    // Get period_id from first assessment (all should have same period)
    const periodId = providedAssessments[0]?.period_id;
    if (!periodId) {
      return res.status(400).json({ success: false, message: 'period_id wajib diisi di setiap assessment' });
    }

    // Cek periode aktif
    const periodRows = await db.query('SELECT id, status FROM kpi_periods WHERE id = ?', [periodId]);
    if (!periodRows.length || periodRows[0].status !== 'aktif') {
      return res.status(400).json({ success: false, message: 'Periode penilaian KPI tidak aktif' });
    }

    const allowedTenants = await getSdmAllowedTenants(req);
    const results = [];
    const skipped = [];

    for (const assessment of providedAssessments) {
      const teacherId = parseInt(assessment.teacher_id);
      const indicatorId = parseInt(assessment.indicator_id);
      const periodIdAssessment = assessment.period_id;

      if (!teacherId || !indicatorId || !periodIdAssessment) {
        skipped.push({ assessment, reason: 'field wajib (teacher_id, indicator_id, period_id) kosong' });
        continue;
      }

      // Verify period matches
      if (parseInt(periodIdAssessment) !== parseInt(periodId)) {
        skipped.push({ assessment, reason: 'period_id tidak konsisten' });
        continue;
      }

      // Tentukan tenant: dari assessment, atau turunan dari penempatan guru
      let tenantId = assessment.tenant_id;
      if (!tenantId) {
        tenantId = await getTeacherTenantId(teacherId, req.user.tenant_id);
      }

      // Verify teacher is in allowed tenant
      if (!tenantId || !allowedTenants.includes(tenantId)) {
        skipped.push({ assessment, reason: 'guru di luar unit Anda' });
        continue;
      }

      // Cek indicator
      const indicatorRows = await db.query('SELECT id, kategori, target_default FROM kpi_indicators WHERE id = ?', [indicatorId]);
      if (!indicatorRows.length) {
        skipped.push({ assessment, reason: 'indikator tidak ditemukan' });
        continue;
      }
      const indicator = indicatorRows[0];

      const parsedTarget = parseFloat(assessment.target);
      const defaultTarget = parseFloat(indicator.target_default) || 100;
      const target = (!isNaN(parsedTarget) && assessment.target !== undefined && assessment.target !== null && assessment.target !== '')
        ? parsedTarget
        : defaultTarget;
      const parsedNilai = parseFloat(assessment.nilai_aktual);
      const nilaiAktual = (!isNaN(parsedNilai) && assessment.nilai_aktual !== undefined && assessment.nilai_aktual !== null && assessment.nilai_aktual !== '')
        ? parsedNilai
        : 0;
      const parsedSkor = parseFloat(assessment.skor);
      const skor = (!isNaN(parsedSkor) && assessment.skor !== undefined && assessment.skor !== null && assessment.skor !== '')
        ? Math.round(parsedSkor * 100) / 100
        : computeSkor(nilaiAktual, target, assessment.pencapaian);
      const parsedPencapaian = parseFloat(assessment.pencapaian);
      const pencapaian = (!isNaN(parsedPencapaian) && assessment.pencapaian !== undefined && assessment.pencapaian !== null && assessment.pencapaian !== '')
        ? parsedPencapaian
        : skor;
      const safeNilai = nilaiAktual === null ? 0 : nilaiAktual;

      // Cek apakah sudah ada
      const existingRows = await db.query(
        'SELECT id FROM kpi_scores WHERE teacher_id = ? AND period_id = ? AND indicator_id = ?',
        [teacherId, periodId, indicatorId]
      );

      if (existingRows.length > 0) {
        await db.query(`
          UPDATE kpi_scores SET
            nilai_aktual = ?, target = ?, pencapaian = ?, skor = ?, catatan = ?, penilai_id = ?, updated_at = NOW()
          WHERE id = ?
        `, [safeNilai, target, pencapaian, skor, assessment.catatan || null, req.user.id, existingRows[0].id]);
      } else {
        await db.query(`
          INSERT INTO kpi_scores (teacher_id, period_id, indicator_id, tenant_id, nilai_aktual, target, pencapaian, skor, penilai_id, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NOW())
        `, [teacherId, periodId, indicatorId, tenantId, safeNilai, target, pencapaian, skor, req.user.id]);
      }

      results.push({ teacher_id: teacherId, indicator_id: indicatorId, skor });
    }

    res.json({
      success: true,
      message: `Bulk KPI assessment selesai: ${results.length} tersimpan${skipped.length ? `, ${skipped.length} dilewati` : ''}`,
      data: results,
      skipped
    });
  } catch (error) {
    console.error('KPI bulk assessment error:', error);
    res.status(500).json({ success: false, message: 'Error bulk KPI assessment', error: error.message });
  }
});

module.exports = router;