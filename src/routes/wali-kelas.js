const express = require('express');
const db = require('../../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Helper: get wali kelas class assignments for current teacher
async function getWaliKelasClasses(teacherId) {
  const classes = await db.query(
    `SELECT ta.class_id, c.nama_kelas, c.tingkatan, ta.tenant_id, t.nama_sekolah
     FROM teacher_assignments ta
     JOIN classes c ON ta.class_id = c.id
     JOIN tenants t ON ta.tenant_id = t.tenant_id
     WHERE ta.teacher_id = ? AND ta.class_id IS NOT NULL`,
    [teacherId]
  );
  return classes;
}

// GET /api/wali-kelas/classes - List classes assigned to wali kelas
router.get('/wali-kelas/classes', authenticateToken, async (req, res) => {
  try {
    const teacherId = req.user.guru_id;
    const classes = await getWaliKelasClasses(teacherId);
    res.json({ success: true, data: classes });
  } catch (error) {
    console.error('Get wali kelas classes error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching classes' });
  }
});

// GET /api/wali-kelas/dashboard - Dashboard summary for selected class
router.get('/wali-kelas/dashboard', authenticateToken, async (req, res) => {
  try {
    const teacherId = req.user.guru_id;
    const classId = req.query.class_id;
    if (!classId) {
      return res.status(400).json({ success: false, message: 'class_id wajib diisi' });
    }

    const classes = await getWaliKelasClasses(teacherId);
    const allowedClassIds = classes.map(c => c.class_id);
    if (!allowedClassIds.includes(parseInt(classId))) {
      return res.status(403).json({ success: false, message: 'Akses ditolak ke kelas ini' });
    }

    const tenantId = classes.find(c => c.class_id === parseInt(classId))?.tenant_id;

    const totalSiswa = await db.query(
      'SELECT COUNT(*) as total FROM students WHERE class_id = ? AND status = "aktif"',
      [classId]
    );

    const hadir = await db.query(
      `SELECT COUNT(*) as total FROM student_attendance WHERE class_id = ? AND status = 'hadir' AND tanggal = CURDATE()`,
      [classId]
    );

    const izinPending = await db.query(
      `SELECT COUNT(*) as total FROM leave_requests lr
       JOIN teachers t ON lr.teacher_id = t.id
       JOIN teacher_assignments ta ON t.id = ta.teacher_id
       WHERE ta.class_id = ? AND lr.status = 'pending'`,
      [classId]
    );

    const sppTunggakan = await db.query(
      `SELECT COUNT(*) as total FROM students s
       LEFT JOIN billing_payment bp ON s.id = bp.student_id AND bp.status = 'belum'
       WHERE s.class_id = ? AND s.status = 'aktif' AND bp.id IS NOT NULL`,
      [classId]
    );

    const recentAttendance = await db.query(
      `SELECT sa.*, s.nama_siswa FROM student_attendance sa
       JOIN students s ON sa.student_id = s.id
       WHERE sa.class_id = ?
       ORDER BY sa.created_at DESC LIMIT 5`,
      [classId]
    );

    res.json({
      success: true,
      data: {
        total_siswa: totalSiswa[0]?.total || 0,
        hadir_hari_ini: hadir[0]?.total || 0,
        izin_pending: izinPending[0]?.total || 0,
        spp_tunggakan: sppTunggakan[0]?.total || 0,
        recent_attendance: recentAttendance
      }
    });
  } catch (error) {
    console.error('Wali kelas dashboard error:', error.message);
    res.status(500).json({ success: false, message: 'Error loading dashboard' });
  }
});

// GET /api/wali-kelas/siswa - List students in wali's class
router.get('/wali-kelas/siswa', authenticateToken, async (req, res) => {
  try {
    const teacherId = req.user.guru_id;
    const classId = req.query.class_id;
    const search = req.query.search || '';

    const classes = await getWaliKelasClasses(teacherId);
    const allowedClassIds = classes.map(c => c.class_id);

    if (!classId) {
      const [first] = classes;
      if (!first) {
        return res.json({ success: true, data: [] });
      }
      return res.json({ success: true, data: [], default_class_id: first.class_id, classes });
    }

    if (!allowedClassIds.includes(parseInt(classId))) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    let query = `
      SELECT s.id, s.nama_siswa, s.nisn, s.nis, s.jenis_kelamin, s.iuran_bulanan,
             s.class_id, s.tenant_id, c.nama_kelas, c.tingkatan, tn.nama_sekolah,
             p.nama_orang_tua, p.no_wa as no_wa_ortu
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE s.class_id = ? AND s.status = 'aktif'
    `;
    const params = [classId];

    if (search) {
      query += ' AND (s.nama_siswa LIKE ? OR s.nisn LIKE ? OR s.nis LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY s.nama_siswa ASC';

    const students = await db.query(query, params);
    res.json({ success: true, data: students, classes });
  } catch (error) {
    console.error('Wali kelas siswa error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching students' });
  }
});

// GET /api/wali-kelas/siswa/:id - Get single student
router.get('/wali-kelas/siswa/:id', authenticateToken, async (req, res) => {
  try {
    const teacherId = req.user.guru_id;
    const studentId = req.params.id;

    const classes = await getWaliKelasClasses(teacherId);
    const allowedClassIds = classes.map(c => c.class_id);

    const student = await db.query(
      `SELECT s.*, c.nama_kelas, c.tingkatan, tn.nama_sekolah, p.nama_orang_tua, p.no_wa as no_wa_ortu
       FROM students s
       LEFT JOIN classes c ON s.class_id = c.id
       LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id
       LEFT JOIN parents p ON s.parent_id = p.id
       WHERE s.id = ?`,
      [studentId]
    );

    if (!student || !student.length) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }

    if (!allowedClassIds.includes(student.class_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    res.json({ success: true, data: student });
  } catch (error) {
    console.error('Get student error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching student' });
  }
});

// PUT /api/wali-kelas/siswa/:id - Update student data
router.put('/wali-kelas/siswa/:id', authenticateToken, async (req, res) => {
  try {
    const teacherId = req.user.guru_id;
    const studentId = req.params.id;
    const { nama_siswa, nisn, jenis_kelamin, iuran_bulanan, nama_orang_tua, no_wa } = req.body;

    const classes = await getWaliKelasClasses(teacherId);
    const allowedClassIds = classes.map(c => c.class_id);

    const existing = await db.query('SELECT class_id, parent_id FROM students WHERE id = ?', [studentId]);
    if (!existing || !existing.length) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }
    if (!allowedClassIds.includes(existing.class_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    let resolvedParentId = existing.parent_id;
    if ((nama_orang_tua || no_wa) && resolvedParentId) {
      await db.query(
        'UPDATE parents SET nama_orang_tua = COALESCE(?, nama_orang_tua), no_wa = COALESCE(?, no_wa) WHERE id = ?',
        [nama_orang_tua || null, no_wa || null, resolvedParentId]
      );
    } else if (nama_orang_tua || no_wa) {
      const ins = await db.query('INSERT INTO parents (nama_orang_tua, no_wa) VALUES (?, ?)', [nama_orang_tua || null, no_wa || null]);
      resolvedParentId = ins.insertId;
      await db.query('UPDATE students SET parent_id = ? WHERE id = ?', [resolvedParentId, studentId]);
    }

    await db.query(
      'UPDATE students SET nama_siswa = ?, nisn = ?, jenis_kelamin = ?, iuran_bulanan = ? WHERE id = ?',
      [nama_siswa, nisn || null, jenis_kelamin, iuran_bulanan || 0, studentId]
    );

    res.json({ success: true, message: 'Data siswa berhasil diperbarui' });
  } catch (error) {
    console.error('Update student error:', error.message);
    res.status(500).json({ success: false, message: 'Error updating student' });
  }
});

// GET /api/wali-kelas/absensi - Get attendance for class on date
router.get('/wali-kelas/absensi', authenticateToken, async (req, res) => {
  try {
    const teacherId = req.user.guru_id;
    const classId = req.query.class_id;
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const classes = await getWaliKelasClasses(teacherId);
    const allowedClassIds = classes.map(c => c.class_id);
    if (!allowedClassIds.includes(parseInt(classId))) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const students = await db.query(
      `SELECT s.id, s.nama_siswa, s.nisn
       FROM students s
       WHERE s.class_id = ? AND s.status = 'aktif'
       ORDER BY s.nama_siswa ASC`,
      [classId]
    );

    const attendanceRecords = await db.query(
      `SELECT sa.student_id, sa.status, sa.keterangan, sa.created_at
       FROM student_attendance sa
       WHERE sa.class_id = ? AND sa.tanggal = ?`,
      [classId, date]
    );

    const attendanceMap = {};
    for (const record of attendanceRecords) {
      attendanceMap[record.student_id] = {
        status: record.status,
        keterangan: record.keterangan,
        created_at: record.created_at
      };
    }

    res.json({ success: true, data: students, attendance: attendanceMap, date });
  } catch (error) {
    console.error('Wali kelas absensi error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching attendance' });
  }
});

// POST /api/wali-kelas/absensi - Save attendance for class
router.post('/wali-kelas/absensi', authenticateToken, async (req, res) => {
  try {
    const teacherId = req.user.guru_id;
    const { class_id, date, attendances } = req.body;

    const classes = await getWaliKelasClasses(teacherId);
    const allowedClassIds = classes.map(c => c.class_id);
    if (!allowedClassIds.includes(parseInt(class_id))) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    if (!date || !attendances || !Array.isArray(attendances)) {
      return res.status(400).json({ success: false, message: 'Data tidak lengkap' });
    }

    const results = [];
    for (const att of attendances) {
      const { student_id, status, keterangan } = att;
      if (!student_id || !status) continue;

      await db.query(
        `INSERT INTO student_attendance (student_id, class_id, tenant_id, tanggal, status, keterangan, recorded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE status = VALUES(status), keterangan = VALUES(keterangan), recorded_by = VALUES(recorded_by), updated_at = NOW()`,
        [
          student_id,
          class_id,
          classes.find(c => c.class_id === parseInt(class_id))?.tenant_id,
          date,
          status,
          keterangan || null,
          teacherId,
          new Date()
        ]
      );
      results.push({ student_id, status });
    }

    res.json({ success: true, message: 'Absensi berhasil disimpan', data: results });
  } catch (error) {
    console.error('Save absensi error:', error.message);
    res.status(500).json({ success: false, message: 'Error saving attendance' });
  }
});

// GET /api/wali-kelas/rekap - Monthly attendance recap
router.get('/wali-kelas/rekap', authenticateToken, async (req, res) => {
  try {
    const teacherId = req.user.guru_id;
    const classId = req.query.class_id;
    const month = req.query.month || new Date().getMonth() + 1;
    const year = req.query.year || new Date().getFullYear();

    const classes = await getWaliKelasClasses(teacherId);
    const allowedClassIds = classes.map(c => c.class_id);
    if (!allowedClassIds.includes(parseInt(classId))) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const siswa = await db.query(
      'SELECT id, nama_siswa, nisn FROM students WHERE class_id = ? AND status = "aktif" ORDER BY nama_siswa ASC',
      [classId]
    );

    const rekap = [];
    for (const s of siswa) {
      const hadir = await db.query(
        `SELECT COUNT(*) as total FROM student_attendance WHERE class_id = ? AND student_id = ? AND status = 'hadir' AND MONTH(tanggal) = ? AND YEAR(tanggal) = ?`,
        [classId, s.id, month, year]
      );

      const izin = await db.query(
        `SELECT COUNT(*) as total FROM student_attendance WHERE class_id = ? AND student_id = ? AND status = 'izin' AND MONTH(tanggal) = ? AND YEAR(tanggal) = ?`,
        [classId, s.id, month, year]
      );

      const sakit = await db.query(
        `SELECT COUNT(*) as total FROM student_attendance WHERE class_id = ? AND student_id = ? AND status = 'sakit' AND MONTH(tanggal) = ? AND YEAR(tanggal) = ?`,
        [classId, s.id, month, year]
      );

      const alpha = await db.query(
        `SELECT COUNT(*) as total FROM student_attendance WHERE class_id = ? AND student_id = ? AND status = 'alpha' AND MONTH(tanggal) = ? AND YEAR(tanggal) = ?`,
        [classId, s.id, month, year]
      );

      rekap.push({
        id: s.id,
        nama_siswa: s.nama_siswa,
        nisn: s.nisn,
        hadir: hadir[0]?.total || 0,
        izin: izin[0]?.total || 0,
        sakit: sakit[0]?.total || 0,
        alpha: alpha[0]?.total || 0
      });
    }

    res.json({ success: true, data: rekap, month, year });
  } catch (error) {
    console.error('Wali kelas rekap error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching recap' });
  }
});

// GET /api/wali-kelas/izin - Leave requests for teachers in wali's school
router.get('/wali-kelas/izin', authenticateToken, async (req, res) => {
  try {
    const teacherId = req.user.guru_id;
    const status = req.query.status || 'pending';

    const classes = await getWaliKelasClasses(teacherId);
    const tenantIds = [...new Set(classes.map(c => c.tenant_id))];
    if (tenantIds.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const placeholders = tenantIds.map(() => '?').join(',');
    const params = [status, ...tenantIds];

    const izinList = await db.query(
      `SELECT lr.*, t.nama as teacher_name, t.nip, tn.nama_sekolah
       FROM leave_requests lr
       JOIN teachers t ON lr.teacher_id = t.id
       JOIN tenants tn ON lr.tenant_id = tn.tenant_id
       WHERE lr.status = ? AND FIND_IN_SET(tn.tenant_id, lr.tenant_id) > 0
       ORDER BY lr.created_at DESC`,
      params
    );

    res.json({ success: true, data: izinList });
  } catch (error) {
    console.error('Wali kelas izin error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching leave requests' });
  }
});

// POST /api/wali-kelas/izin/:id/approve - Approve leave request
router.post('/wali-kelas/izin/:id/approve', authenticateToken, async (req, res) => {
  try {
    const teacherId = req.user.guru_id;
    const izinId = req.params.id;
    const { catatan } = req.body;

    const classes = await getWaliKelasClasses(teacherId);
    const tenantIds = classes.map(c => c.tenant_id);

    const izin = await db.query('SELECT * FROM leave_requests WHERE id = ?', [izinId]);
    if (!izin || !izin.length) {
      return res.status(404).json({ success: false, message: 'Izin tidak ditemukan' });
    }

    const hasAccess = tenantIds.some(tid => izin.tenant_id && izin.tenant_id.split(',').includes(tid));
    if (!hasAccess) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    await db.query(
      'UPDATE leave_requests SET status = "approved", catatan = ?, updated_at = NOW() WHERE id = ?',
      [catatan || 'Disetujui oleh wali kelas', izinId]
    );

    res.json({ success: true, message: 'Izin berhasil disetujui' });
  } catch (error) {
    console.error('Approve izin error:', error.message);
    res.status(500).json({ success: false, message: 'Error approving leave request' });
  }
});

// POST /api/wali-kelas/izin/:id/reject - Reject leave request
router.post('/wali-kelas/izin/:id/reject', authenticateToken, async (req, res) => {
  try {
    const teacherId = req.user.guru_id;
    const izinId = req.params.id;
    const { catatan } = req.body;

    const classes = await getWaliKelasClasses(teacherId);
    const tenantIds = classes.map(c => c.tenant_id);

    const izin = await db.query('SELECT * FROM leave_requests WHERE id = ?', [izinId]);
    if (!izin || !izin.length) {
      return res.status(404).json({ success: false, message: 'Izin tidak ditemukan' });
    }

    const hasAccess = tenantIds.some(tid => izin.tenant_id && izin.tenant_id.split(',').includes(tid));
    if (!hasAccess) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    await db.query(
      'UPDATE leave_requests SET status = "rejected", catatan = ?, updated_at = NOW() WHERE id = ?',
      [catatan || 'Ditolak oleh wali kelas', izinId]
    );

    res.json({ success: true, message: 'Izin berhasil ditolak' });
  } catch (error) {
    console.error('Reject izin error:', error.message);
    res.status(500).json({ success: false, message: 'Error rejecting leave request' });
  }
});

// GET /api/wali-kelas/spp - SPP information for students in class
router.get('/wali-kelas/spp', authenticateToken, async (req, res) => {
  try {
    const teacherId = req.user.guru_id;
    const classId = req.query.class_id;
    const search = req.query.search || '';

    const classes = await getWaliKelasClasses(teacherId);
    const allowedClassIds = classes.map(c => c.class_id);
    if (!classId || !allowedClassIds.includes(parseInt(classId))) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    let query = `
      SELECT s.id, s.nama_siswa, s.nisn, s.iuran_bulanan, s.class_id, c.nama_kelas, tn.nama_sekolah
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id
      WHERE s.class_id = ? AND s.status = 'aktif'
    `;
    const params = [classId];

    if (search) {
      query += ' AND (s.nama_siswa LIKE ? OR s.nisn LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY s.nama_siswa ASC';

    const sppData = await db.query(query, params);

    // Optional enrichment from billing_payment / saldo_siswa if tables exist
    if (sppData.length) {
      const studentIds = sppData.map(s => s.id);
      const placeholders = studentIds.map(() => '?').join(',');
      try {
        const saldoRows = await db.query(
          `SELECT student_id, saldo FROM saldo_siswa WHERE student_id IN (${placeholders})`,
          studentIds
        );
        const saldoMap = {};
        for (const row of saldoRows) saldoMap[row.student_id] = row.saldo;
        for (const s of sppData) s.saldo = saldoMap[s.id] || 0;
      } catch (e) {
        for (const s of sppData) s.saldo = 0;
      }
      try {
        const billingRows = await db.query(
          `SELECT student_id, MAX(bulan) as bulan_terakhir, status as status_terakhir FROM billing_payment WHERE student_id IN (${placeholders}) GROUP BY student_id`,
          studentIds
        );
        const billingMap = {};
        for (const row of billingRows) billingMap[row.student_id] = row;
        for (const s of sppData) {
          const b = billingMap[s.id];
          s.bulan_terakhir = b ? b.bulan_terakhir : '-';
          s.status_terakhir = b ? b.status_terakhir : 'belum';
        }
      } catch (e) {
        for (const s of sppData) { s.bulan_terakhir = '-'; s.status_terakhir = 'belum'; }
      }
    }
    res.json({ success: true, data: sppData });
  } catch (error) {
    console.error('Wali kelas SPP error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching SPP info' });
  }
});

// GET /api/wali-kelas/jadwal - List class schedule
router.get('/wali-kelas/jadwal', authenticateToken, async (req, res) => {
  try {
    const teacherId = req.user.guru_id;
    const classId = req.query.class_id;
    const hari = req.query.hari || '';

    const classes = await getWaliKelasClasses(teacherId);
    const allowedClassIds = classes.map(c => c.class_id);
    if (!classId || !allowedClassIds.includes(parseInt(classId))) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    let query = `SELECT * FROM jadwal_pelajaran WHERE class_id = ?`;
    const params = [classId];
    if (hari) {
      query += ' AND hari = ?';
      params.push(hari);
    }
    query += ' ORDER BY hari, periode_ke ASC';

    const jadwal = await db.query(query, params);
    res.json({ success: true, data: jadwal });
  } catch (error) {
    console.error('Wali kelas jadwal error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching schedule' });
  }
});

// GET /api/wali-kelas/jadwal/:id - Get single schedule
router.get('/wali-kelas/jadwal/:id', authenticateToken, async (req, res) => {
  try {
    const teacherId = req.user.guru_id;
    const jadwalId = req.params.id;

    const classes = await getWaliKelasClasses(teacherId);
    const allowedClassIds = classes.map(c => c.class_id);

    const [jadwal] = await db.query('SELECT * FROM jadwal_pelajaran WHERE id = ?', [jadwalId]);
    if (!jadwal) {
      return res.status(404).json({ success: false, message: 'Jadwal tidak ditemukan' });
    }
    if (!allowedClassIds.includes(jadwal.class_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    res.json({ success: true, data: jadwal });
  } catch (error) {
    console.error('Get jadwal error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching schedule' });
  }
});

// POST /api/wali-kelas/jadwal - Create schedule
router.post('/wali-kelas/jadwal', authenticateToken, async (req, res) => {
  try {
    const teacherId = req.user.guru_id;
    const { class_id, hari, periode_ke, jam_mulai, jam_selesai, mata_pelajaran, guru, ruangan, keterangan } = req.body;

    const classes = await getWaliKelasClasses(teacherId);
    const allowedClassIds = classes.map(c => c.class_id);
    if (!classId || !allowedClassIds.includes(parseInt(classId))) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    if (!hari || !periode_ke || !jam_mulai || !jam_selesai) {
      return res.status(400).json({ success: false, message: 'Hari, periode, jam mulai dan jam selesai wajib diisi' });
    }

    const tenantId = classes.find(c => c.class_id === parseInt(classId))?.tenant_id;

    const result = await db.query(
      `INSERT INTO jadwal_pelajaran (tenant_id, class_id, hari, periode_ke, jam_mulai, jam_selesai, mata_pelajaran, guru, ruangan, keterangan)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, classId, hari, periode_ke, jam_mulai, jam_selesai, mata_pelajaran || null, guru || null, ruangan || null, keterangan || null]
    );

    res.json({ success: true, message: 'Jadwal berhasil ditambahkan', id: result.insertId });
  } catch (error) {
    console.error('Create jadwal error:', error.message);
    res.status(500).json({ success: false, message: 'Error creating schedule' });
  }
});

// PUT /api/wali-kelas/jadwal/:id - Update schedule
router.put('/wali-kelas/jadwal/:id', authenticateToken, async (req, res) => {
  try {
    const teacherId = req.user.guru_id;
    const jadwalId = req.params.id;
    const { class_id, hari, periode_ke, jam_mulai, jam_selesai, mata_pelajaran, guru, ruangan, keterangan } = req.body;

    const classes = await getWaliKelasClasses(teacherId);
    const allowedClassIds = classes.map(c => c.class_id);
    if (!classId || !allowedClassIds.includes(parseInt(classId))) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const [existing] = await db.query('SELECT id FROM jadwal_pelajaran WHERE id = ?', [jadwalId]);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Jadwal tidak ditemukan' });
    }

    await db.query(
      `UPDATE jadwal_pelajaran SET hari = ?, periode_ke = ?, jam_mulai = ?, jam_selesai = ?, mata_pelajaran = ?, guru = ?, ruangan = ?, keterangan = ? WHERE id = ?`,
      [hari, periode_ke, jam_mulai, jam_selesai, mata_pelajaran || null, guru || null, ruangan || null, keterangan || null, jadwalId]
    );

    res.json({ success: true, message: 'Jadwal berhasil diperbarui' });
  } catch (error) {
    console.error('Update jadwal error:', error.message);
    res.status(500).json({ success: false, message: 'Error updating schedule' });
  }
});

// DELETE /api/wali-kelas/jadwal/:id - Delete schedule
router.delete('/wali-kelas/jadwal/:id', authenticateToken, async (req, res) => {
  try {
    const teacherId = req.user.guru_id;
    const jadwalId = req.params.id;

    const classes = await getWaliKelasClasses(teacherId);
    const allowedClassIds = classes.map(c => c.class_id);

    const [existing] = await db.query('SELECT class_id FROM jadwal_pelajaran WHERE id = ?', [jadwalId]);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Jadwal tidak ditemukan' });
    }
    if (!allowedClassIds.includes(existing.class_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    await db.query('DELETE FROM jadwal_pelajaran WHERE id = ?', [jadwalId]);
    res.json({ success: true, message: 'Jadwal berhasil dihapus' });
  } catch (error) {
    console.error('Delete jadwal error:', error.message);
    res.status(500).json({ success: false, message: 'Error deleting schedule' });
  }
});

module.exports = router;
