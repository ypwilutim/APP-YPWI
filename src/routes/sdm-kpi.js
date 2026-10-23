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

  const sdmAssignments = (req.user.assignments || []).filter(a =>
    (a.jabatan_di_unit || '').toLowerCase().includes('sdm')
  );

  if (sdmAssignments.length === 0) {
    return [];
  }

  const isSdmPusat = sdmAssignments.some(a => a.tenant_id === 'YPWILUTIM');
  if (isSdmPusat) {
    const allTenants = await db.query('SELECT tenant_id FROM tenants');
    return allTenants.map(t => t.tenant_id);
  }

  return sdmAssignments.map(a => a.tenant_id);
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
      SELECT id, nama, kategori, bobot, satuan, target_default, sumber, urutan, aktif, keterangan
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

    const { id, nama, kategori, bobot, satuan, target_default, sumber, urutan, keterangan } = req.body;

    if (!nama || !kategori) {
      return res.status(400).json({ success: false, message: 'Nama dan kategori wajib diisi' });
    }

    // Normalisasi nilai opsional agar tidak mengirim undefined ke MySQL
    const safeBobot = (bobot === undefined || bobot === null || bobot === '') ? 0 : parseFloat(bobot);
    const safeSatuan = satuan || '%';
    const safeTarget = (target_default === undefined || target_default === null || target_default === '') ? 100 : parseFloat(target_default);
    const safeSumber = sumber || 'manual';
    const safeUrutan = (urutan === undefined || urutan === null || urutan === '') ? 0 : parseInt(urutan);
    const safeKeterangan = (keterangan === undefined || keterangan === '') ? null : keterangan;

    if (id) {
      // Update existing
      await db.query(`
        UPDATE kpi_indicators SET 
          nama = ?, kategori = ?, bobot = ?, satuan = ?, target_default = ?, sumber = ?, urutan = ?, keterangan = ?
        WHERE id = ?
      `, [nama, kategori, safeBobot, safeSatuan, safeTarget, safeSumber, safeUrutan, safeKeterangan, id]);
    } else {
      // Insert new
      const insertResult = await db.query(`
        INSERT INTO kpi_indicators (nama, kategori, bobot, satuan, target_default, sumber, urutan, keterangan, aktif)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)
      `, [nama, kategori, safeBobot, safeSatuan, safeTarget, safeSumber, safeUrutan, safeKeterangan]);
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
        ks.tenant_id, kp.nama as period_name, kp.jenis as period_jenis, kp.tahun as period_tahun,
        ki.nama as indicator_name, ki.id as indicator_id,
        ki.kategori,
        ki.bobot,
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

    const { teacher_ids, period_id, indicator_ids } = req.body;

    if (!period_id || !teacher_ids || !indicator_ids || !Array.isArray(teacher_ids) || !Array.isArray(indicator_ids)) {
      return res.status(400).json({ success: false, message: 'period_id, teacher_ids (array), dan indicator_ids (array) wajib diisi' });
    }

    // Cek periode aktif
    const periodRows = await db.query('SELECT id, status FROM kpi_periods WHERE id = ?', [period_id]);
    if (!periodRows.length || periodRows[0].status !== 'aktif') {
      return res.status(400).json({ success: false, message: 'Periode penilaian KPI tidak aktif' });
    }

    const allowedTenants = await getSdmAllowedTenants(req);
    const providedAssessments = Array.isArray(req.body.assessments) ? req.body.assessments : [];
    const results = [];
    const skipped = [];

    for (const teacherId of teacher_ids) {
      const teacherTenantId = await getTeacherTenantId(parseInt(teacherId), req.user.tenant_id);

      // Skip guru di luar tenant yang diizinkan
      if (!allowedTenants.includes(teacherTenantId)) {
        skipped.push({ teacher_id: teacherId, reason: 'guru di luar unit Anda' });
        continue;
      }

      for (const indicatorId of indicator_ids) {
        // Cek indicator
        const indicatorRows = await db.query('SELECT id, kategori, target_default FROM kpi_indicators WHERE id = ?', [indicatorId]);
        if (!indicatorRows.length) continue;
        const indicator = indicatorRows[0];

        const found = providedAssessments.find(a =>
          parseInt(a.teacher_id) === parseInt(teacherId) && parseInt(a.indicator_id) === parseInt(indicatorId)
        );

        const parsedTarget = parseFloat(found?.target);
        const defaultTarget = parseFloat(indicator.target_default) || 100;
        const target = (!isNaN(parsedTarget) && found?.target !== undefined && found?.target !== null && found?.target !== '')
          ? parsedTarget
          : defaultTarget;
        const parsedNilai = parseFloat(found?.nilai_aktual);
        const nilaiAktual = (!isNaN(parsedNilai) && found?.nilai_aktual !== undefined && found?.nilai_aktual !== null && found?.nilai_aktual !== '')
          ? parsedNilai
          : null;
        const parsedSkor = parseFloat(found?.skor);
        const skor = (!isNaN(parsedSkor) && found?.skor !== undefined && found?.skor !== null && found?.skor !== '')
          ? Math.round(parsedSkor * 100) / 100
          : computeSkor(nilaiAktual, target, found?.pencapaian);
        const parsedPencapaian = parseFloat(found?.pencapaian);
        const pencapaian = (!isNaN(parsedPencapaian) && found?.pencapaian !== undefined && found?.pencapaian !== null && found?.pencapaian !== '')
          ? parsedPencapaian
          : skor;
        const safeNilai = nilaiAktual === null ? 0 : nilaiAktual;

        // Cek apakah sudah ada
        const existingRows = await db.query(
          'SELECT id FROM kpi_scores WHERE teacher_id = ? AND period_id = ? AND indicator_id = ?',
          [teacherId, period_id, indicatorId]
        );

        if (existingRows.length > 0) {
          await db.query(`
            UPDATE kpi_scores SET
              nilai_aktual = ?, target = ?, pencapaian = ?, skor = ?, catatan = ?, penilai_id = ?, updated_at = NOW()
            WHERE id = ?
          `, [safeNilai, target, pencapaian, skor, found ? (found.catatan || null) : null, req.user.id, existingRows[0].id]);
        } else {
          await db.query(`
            INSERT INTO kpi_scores (teacher_id, period_id, indicator_id, tenant_id, nilai_aktual, target, pencapaian, skor, penilai_id, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NOW())
          `, [teacherId, period_id, indicatorId, teacherTenantId, safeNilai, target, pencapaian, skor, req.user.id]);
        }

        results.push({ teacher_id: parseInt(teacherId), indicator_id: parseInt(indicatorId), skor });
      }
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