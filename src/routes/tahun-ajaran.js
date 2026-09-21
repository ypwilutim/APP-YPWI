const express = require('express');
const db = require('../../db');
const { authenticateToken, authenticateOperator } = require('../middleware/auth');
const { requireAcademicYear } = require('../middlewares/attachAcademicYear');

const router = express.Router();

// GET /api/admin/tahun-ajaran - List all tahun ajaran
router.get('/admin/tahun-ajaran', authenticateOperator, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const [rows] = await db.query(`
      SELECT ta.*, 
        (SELECT COUNT(*) FROM classes c WHERE c.tahun_ajaran_id = ta.id) as class_count,
        (SELECT COUNT(*) FROM students s WHERE s.tahun_ajaran_id = ta.id) as student_count
      FROM tahun_ajaran ta
      WHERE ta.tenant_id IS NULL OR ta.tenant_id = ?
      ORDER BY ta.tahun_mulai DESC, ta.bulan_mulai DESC
    `, [tenant_id || 'GLOBAL']);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List tahun ajaran error:', error);
    res.status(500).json({ success: false, message: 'Error fetching tahun ajaran' });
  }
});

// GET /api/admin/tahun-ajaran/:id - Get detail
router.get('/admin/tahun-ajaran/:id', authenticateOperator, requireAcademicYear, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM tahun_ajaran WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Tahun ajaran tidak ditemukan' });

    const [semesters] = await db.query('SELECT * FROM semester WHERE tahun_ajaran_id = ? ORDER BY tanggal_mulai', [req.params.id]);

    res.json({ success: true, data: { ...rows[0], semesters } });
  } catch (error) {
    console.error('Detail tahun ajaran error:', error);
    res.status(500).json({ success: false, message: 'Error fetching detail' });
  }
});

// POST /api/admin/tahun-ajaran - Create
router.post('/admin/tahun-ajaran', authenticateOperator, requireAcademicYear, async (req, res) => {
  try {
    const { nama, tahun_mulai, tahun_selesai, bulan_mulai, tanggal_mulai, tanggal_selesai, tenant_id } = req.body;

    if (!nama || !tahun_mulai || !tahun_selesai || !tanggal_mulai || !tanggal_selesai) {
      return res.status(400).json({ success: false, message: 'Nama, tahun mulai/selesai, dan tanggal wajib diisi' });
    }

    // Deactivate other active TA for same scope
    await db.query('UPDATE tahun_ajaran SET is_active = 0 WHERE tenant_id = ? AND is_active = 1', [tenant_id || null]);

    const [result] = await db.query(`
      INSERT INTO tahun_ajaran (nama, tahun_mulai, tahun_selesai, bulan_mulai, tanggal_mulai, tanggal_selesai, is_active, tenant_id)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `, [nama, tahun_mulai, tahun_selesai, bulan_mulai || 7, tanggal_mulai, tanggal_selesai, tenant_id || null]);

    res.json({ success: true, message: 'Tahun ajaran baru dibuat', id: result.insertId });
  } catch (error) {
    console.error('Create tahun ajaran error:', error);
    res.status(500).json({ success: false, message: 'Error creating tahun ajaran' });
  }
});

// PUT /api/admin/tahun-ajaran/:id - Update
router.put('/admin/tahun-ajaran/:id', authenticateOperator, requireAcademicYear, async (req, res) => {
  try {
    const { nama, tahun_mulai, tahun_selesai, bulan_mulai, tanggal_mulai, tanggal_selesai, is_active } = req.body;

    const [existing] = await db.query('SELECT * FROM tahun_ajaran WHERE id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Tahun ajaran tidak ditemukan' });

    const updates = [];
    const values = [];
    for (const [key, val] of Object.entries({ nama, tahun_mulai, tahun_selesai, bulan_mulai, tanggal_mulai, tanggal_selesai, is_active })) {
      if (val !== undefined) {
        updates.push(`${key} = ?`);
        values.push(val);
      }
    }
    values.push(req.params.id);

    await db.query(`UPDATE tahun_ajaran SET ${updates.join(', ')} WHERE id = ?`, values);

    // If activating, deactivate others
    if (is_active === 1) {
      await db.query('UPDATE tahun_ajaran SET is_active = 0 WHERE id != ? AND tenant_id = ?', [req.params.id, existing[0].tenant_id]);
    }

    res.json({ success: true, message: 'Tahun ajaran diperbarui' });
  } catch (error) {
    console.error('Update tahun ajaran error:', error);
    res.status(500).json({ success: false, message: 'Error updating tahun ajaran' });
  }
});

// DELETE /api/admin/tahun-ajaran/:id - Delete
router.delete('/admin/tahun-ajaran/:id', authenticateOperator, requireAcademicYear, async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM tahun_ajaran WHERE id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Tahun ajaran tidak ditemukan' });

    // Check if still used
    const [students] = await db.query('SELECT COUNT(*) as total FROM students WHERE tahun_ajaran_id = ?', [req.params.id]);
    const [classes] = await db.query('SELECT COUNT(*) as total FROM classes WHERE tahun_ajaran_id = ?', [req.params.id]);

    if (students[0].total > 0 || classes[0].total > 0) {
      return res.status(400).json({
        success: false,
        message: 'Tahun ajaran masih digunakan (siswa: ' + students[0].total + ', kelas: ' + classes[0].total + '). Hapus hubungan terlebih dahulu.'
      });
    }

    await db.query('DELETE FROM semester WHERE tahun_ajaran_id = ?', [req.params.id]);
    await db.query('DELETE FROM tahun_ajaran WHERE id = ?', [req.params.id]);

    res.json({ success: true, message: 'Tahun ajaran dihapus' });
  } catch (error) {
    console.error('Delete tahun ajaran error:', error);
    res.status(500).json({ success: false, message: 'Error deleting tahun ajaran' });
  }
});

// POST /api/admin/tahun-ajaran/semester - Create semester
router.post('/admin/tahun-ajaran/semester', authenticateOperator, requireAcademicYear, async (req, res) => {
  try {
    const { tahun_ajaran_id, nama, tanggal_mulai, tanggal_selesai } = req.body;

    if (!tahun_ajaran_id || !nama || !tanggal_mulai || !tanggal_selesai) {
      return res.status(400).json({ success: false, message: 'TA ID, nama, dan tanggal wajib diisi' });
    }

    const [ta] = await db.query('SELECT * FROM tahun_ajaran WHERE id = ?', [tahun_ajaran_id]);
    if (!ta.length) return res.status(404).json({ success: false, message: 'Tahun ajaran tidak ditemukan' });

    const [result] = await db.query(`
      INSERT INTO semester (tahun_ajaran_id, nama, tanggal_mulai, tanggal_selesai)
      VALUES (?, ?, ?, ?)
    `, [tahun_ajaran_id, nama, tanggal_mulai, tanggal_selesai]);

    res.json({ success: true, message: 'Semester baru dibuat', id: result.insertId });
  } catch (error) {
    console.error('Create semester error:', error);
    res.status(500).json({ success: false, message: 'Error creating semester' });
  }
});

// DELETE /api/admin/semester/:id - Delete semester
router.delete('/admin/semester/:id', authenticateOperator, requireAcademicYear, async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM semester WHERE id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Semester tidak ditemukan' });

    const [billing] = await db.query('SELECT COUNT(*) as total FROM billing_payment WHERE semester_id = ?', [req.params.id]);
    if (billing[0].total > 0) {
      return res.status(400).json({ success: false, message: 'Semester masih digunakan di billing. Hapus data billing terlebih dahulu.' });
    }

    await db.query('DELETE FROM semester WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Semester dihapus' });
  } catch (error) {
    console.error('Delete semester error:', error);
    res.status(500).json({ success: false, message: 'Error deleting semester' });
  }
});

// POST /api/admin/tahun-ajaran/:id/transition - Transisi siswa dari TA sebelumnya ke TA baru
router.post('/admin/tahun-ajaran/:id/transition', authenticateOperator, requireAcademicYear, async (req, res) => {
  try {
    const taId = req.params.id;
    const { previous_ta_id } = req.body;

    if (!previous_ta_id) {
      return res.status(400).json({ success: false, message: 'previous_ta_id wajib diisi' });
    }

    // Verify new TA exists and is active
    const [newTa] = await db.query('SELECT * FROM tahun_ajaran WHERE id = ? AND is_active = 1', [taId]);
    if (!newTa.length) {
      return res.status(404).json({ success: false, message: 'Tahun ajaran baru tidak ditemukan atau tidak aktif' });
    }

    // Verify previous TA exists
    const [prevTa] = await db.query('SELECT * FROM tahun_ajaran WHERE id = ?', [previous_ta_id]);
    if (!prevTa.length) {
      return res.status(404).json({ success: false, message: 'Tahun ajaran sebelumnya tidak ditemukan' });
    }

    // Get max tingkatan from classes
    const [maxClass] = await db.query('SELECT MAX(CAST(tingkatan AS UNSIGNED)) as max_tingkatan FROM classes WHERE tenant_id IS NULL OR tenant_id = ?', [newTa[0].tenant_id || null]);
    const maxTingkatan = maxClass[0]?.max_tingkatan || 6;

    // Get all students from previous TA
    const [prevStudents] = await db.query(`
      SELECT s.*, c.nama_kelas, c.tingkatan, c.id as class_id, tn.nama_sekolah
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id
      WHERE s.tahun_ajaran_id = ?
    `, [previous_ta_id]);

    const results = {
      total: prevStudents.length,
      promoted: 0,
      graduated: 0,
      alumni: 0,
      errors: []
    };

    for (const student of prevStudents) {
      try {
        const currentTingkatan = parseInt(student.tingkatan) || 1;

        if (currentTingkatan >= maxTingkatan) {
          // Graduate - student reached final level
          const schoolName = student.nama_sekolah || prevTa[0].nama || 'YPWI Lutim';
          await db.query(`
            INSERT INTO student_education_history (student_id, tenant_id, nama_sekolah, tahun_masuk, tahun_lulus, status, keterangan)
            VALUES (?, ?, ?, ?, ?, 'lulus', ?)
          `, [student.id, student.tenant_id || null, schoolName, student.tahun_masuk || null, new Date().getFullYear().toString(), `Lulus dari ${student.nama_kelas || 'Tidak Diketahui'} - ${prevTa[0].nama}`]);

          await db.query('UPDATE students SET status = ?, tahun_ajaran_id = ? WHERE id = ?', ['alumni', taId, student.id]);
          results.graduated++;
          results.alumni++;
        } else {
          // Promote - find next class (same prefix, tingkatan + 1)
          const currentKelas = student.nama_kelas || '';
          const prefix = currentKelas.replace(/[0-9]/g, '');
          const nextKelas = prefix + (currentTingkatan + 1);

          const [nextClass] = await db.query(
            'SELECT id FROM classes WHERE nama_kelas = ? AND (tenant_id IS NULL OR tenant_id = ?) LIMIT 1',
            [nextKelas, newTa[0].tenant_id || null]
          );

          if (nextClass.length > 0) {
            await db.query('UPDATE students SET class_id = ?, tahun_ajaran_id = ?, status = ? WHERE id = ?', [nextClass[0].id, taId, 'aktif', student.id]);
            results.promoted++;
          } else {
            // Kelas tujuan belum ada, create it
            const [newClass] = await db.query(
              'INSERT INTO classes (tenant_id, nama_kelas, tingkatan) VALUES (?, ?, ?)',
              [newTa[0].tenant_id || null, nextKelas, currentTingkatan + 1]
            );
            await db.query('UPDATE students SET class_id = ?, tahun_ajaran_id = ?, status = ? WHERE id = ?', [newClass.insertId, taId, 'aktif', student.id]);
            results.promoted++;
          }
        }
      } catch (err) {
        console.error(`Transition error for student ${student.id}:`, err.message);
        results.errors.push({ student_id: student.id, student_name: student.nama_siswa, error: err.message });
      }
    }

    res.json({
      success: true,
      message: `Transisi selesai: ${results.promoted} dipromosikan, ${results.graduated} diluluskan`,
      data: results
    });
  } catch (error) {
    console.error('Transition error:', error);
    res.status(500).json({ success: false, message: 'Error during transition' });
  }
});

// GET /api/admin/tahun-ajaran/current - Get current active TA
router.get('/admin/tahun-ajaran/current', authenticateOperator, async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const [rows] = await db.query(`
      SELECT * FROM tahun_ajaran 
      WHERE (tenant_id IS NULL OR tenant_id = ?) AND is_active = 1 LIMIT 1
    `, [tenant_id || 'GLOBAL']);
    res.json({ success: true, data: rows[0] || null });
  } catch (error) {
    console.error('Current TA error:', error);
    res.status(500).json({ success: false, message: 'Error fetching current TA' });
  }
});

module.exports = router;
