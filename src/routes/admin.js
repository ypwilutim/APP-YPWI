// ============================================================
// ADMIN ROUTES - Extracted from server.js for modular architecture
// Includes: tenants, teachers, rules, locations, reports
// ============================================================

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../../db');
const { authenticateToken, authenticateOperator, verifyTenantAccess } = require('../middleware/auth');
const { logToFile } = require('../middlewares/logger');

const router = express.Router();

// ============================================================
// MULTER CONFIG FOR TEACHER PHOTOS
// ============================================================

const teacherStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'teacher-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const teacherUpload = multer({
  storage: teacherStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Hanya file gambar yang diperbolehkan (JPG, PNG, GIF)'));
    }
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif'];
    const fileExtension = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.includes(fileExtension)) {
      return cb(new Error('Format file tidak didukung. Gunakan JPG, PNG, atau GIF'));
    }
    cb(null, true);
  }
});

// ============================================================
// TENANTS ROUTES
// ============================================================

// GET /api/admin/tenants - List all tenants with tipe_unit
router.get('/admin/tenants', authenticateOperator, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    let query = 'SELECT tenant_id, nama_sekolah, absensi_method, use_central_rules, latitude, longitude, COALESCE(location_radius, 100) as location_radius, location_name, tipe_unit FROM tenants';
    let params = [];
    if (tenantId) {
      query += ' WHERE tenant_id = ?';
      params.push(tenantId);
    }
    query += ' ORDER BY nama_sekolah ASC';
    const tenants = await db.query(query, params);
    res.json({ success: true, data: tenants });
  } catch (error) {
    console.error('Admin tenants error:', error);
    res.status(500).json({ success: false, message: 'Error fetching tenants' });
  }
});

// GET /api/admin/tenants/:tenantId - Get tenant by ID
router.get('/admin/tenants/:tenantId', authenticateOperator, async (req, res) => {
  try {
    if (req.user.role === 'guru' && req.user.assignments) {
      const allowedTenants = (req.user.assignments || []).map(a => a.tenant_id);
      if (!allowedTenants.includes(req.params.tenantId)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }
    }
    const [tenant] = await db.query('SELECT * FROM tenants WHERE tenant_id = ?', [req.params.tenantId]);
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }
    res.json({ success: true, data: tenant });
  } catch (error) {
    console.error('Admin tenant detail error:', error);
    res.status(500).json({ success: false, message: 'Error fetching tenant' });
  }
});

// POST /api/admin/tenants - Create new tenant
router.post('/admin/tenants', authenticateOperator, async (req, res) => {
  try {
    const { tenant_id, nama_sekolah, absensi_method, tipe_unit } = req.body;
    if (!tenant_id || !nama_sekolah) {
      return res.status(400).json({ success: false, message: 'tenant_id dan nama_sekolah wajib diisi' });
    }
    if (!/^[a-zA-Z0-9_]{1,20}$/.test(tenant_id)) {
      return res.status(400).json({ success: false, message: 'Format tenant_id tidak valid' });
    }
    const existing = await db.query('SELECT tenant_id FROM tenants WHERE tenant_id = ?', [tenant_id]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'Tenant ID sudah digunakan' });
    }
    await db.query(
      'INSERT INTO tenants (tenant_id, nama_sekolah, absensi_method, tipe_unit) VALUES (?, ?, ?, ?)',
      [tenant_id, nama_sekolah, absensi_method || 'personal', tipe_unit || 'sekolah']
    );
    res.json({ success: true, message: 'Tenant berhasil dibuat' });
  } catch (error) {
    console.error('Create tenant error:', error.message);
    res.status(500).json({ success: false, message: 'Error creating tenant' });
  }
});

// PUT /api/admin/tenants/:tenantId - Update tenant
router.put('/admin/tenants/:tenantId', authenticateOperator, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { latitude, longitude, location_radius, location_name, use_central_rules, tipe_unit } = req.body;

    if (req.user.role === 'guru' && req.user.assignments) {
      const allowedTenants = (req.user.assignments || []).map(a => a.tenant_id);
      if (!allowedTenants.includes(tenantId)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }
    }

    const updateFields = [];
    const updateValues = [];

    // --- BLOK PENYELAMAT KOORDINAT GEOFENCE ---
    if (latitude !== undefined && latitude !== null) {
      updateFields.push('latitude = ?');
      updateValues.push(latitude);
    }
    if (longitude !== undefined && longitude !== null) {
      updateFields.push('longitude = ?');
      updateValues.push(longitude);
    }
    if (location_radius !== undefined && location_radius !== null) {
      updateFields.push('location_radius = ?');
      updateValues.push(location_radius);
    }
    if (location_name !== undefined && location_name !== null) {
      updateFields.push('location_name = ?');
      updateValues.push(location_name);
    }
    // ------------------------------------------

    if (use_central_rules !== undefined) {
      updateFields.push('use_central_rules = ?');
      updateValues.push(use_central_rules ? 1 : 0);
    }
    if (tipe_unit !== undefined) {
      updateFields.push('tipe_unit = ?');
      updateValues.push(tipe_unit);
    }

    // Jika ada field yang dikirim untuk diupdate
    if (updateFields.length > 0) {
      updateValues.push(tenantId);
      const queryStr = `UPDATE tenants SET ${updateFields.join(', ')} WHERE tenant_id = ?`;
      console.log(`[SQL EXECUTE] ${queryStr} with values:`, updateValues); // Untuk mempermudah monitoring log Anda

      await db.query(queryStr, updateValues);
      res.json({ success: true, message: 'Tenant berhasil diupdate' });
    } else {
      res.json({ success: true, message: 'Tidak ada data baru yang diupdate' });
    }

  } catch (error) {
    console.error('Update tenant error:', error);
    res.status(500).json({ success: false, message: 'Error updating tenant' });
  }
});

// ============================================================
// RULES ROUTES (attendance_rules)
// ============================================================

// GET /api/admin/rules - List attendance rules
router.get('/admin/rules', authenticateOperator, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    let query = 'SELECT * FROM attendance_rules';
    let params = [];
    if (tenantId) {
      query += ' WHERE tenant_id = ?';
      params.push(tenantId);
    }
    query += ' ORDER BY tenant_id, tipe, jam_mulai';
    const rules = await db.query(query, params);
    res.json({ success: true, data: rules });
  } catch (error) {
    console.error('Admin rules error:', error);
    res.status(500).json({ success: false, message: 'Error fetching rules' });
  }
});

// GET /api/admin/rules/:id - Get single attendance rule by id
router.get('/admin/rules/:id', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const [rule] = await db.query('SELECT * FROM attendance_rules WHERE id = ?', [id]);
    if (!rule) {
      return res.status(404).json({ success: false, message: 'Rule not found' });
    }

    if (!verifyTenantAccess(req, rule.tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    res.json({ success: true, data: rule });
  } catch (error) {
    console.error('Get rule error:', error);
    res.status(500).json({ success: false, message: 'Error fetching rule' });
  }
});



















































































































































// POST /api/admin/rules - Create rule
router.post('/admin/rules', authenticateOperator, async (req, res) => {
  try {
    const { tenant_id, tipe, jam_mulai, jam_selesai, keterangan, status_log, hari } = req.body;

    if (!tenant_id || !tipe || !jam_mulai || !jam_selesai || !status_log) {
      return res.status(400).json({ success: false, message: 'Semua field wajib diisi' });
    }

    if (!verifyTenantAccess(req, tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    if (!['Datang', 'Pulang'].includes(tipe)) {
      return res.status(400).json({ success: false, message: 'Tipe harus Datang atau Pulang' });
    }
    if (!['tepat_waktu', 'terlambat'].includes(status_log)) {
      return res.status(400).json({ success: false, message: 'Status log tidak valid' });
    }

    await db.query(
      'INSERT INTO attendance_rules (tenant_id, tipe, jam_mulai, jam_selesai, keterangan, status_log, hari) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [tenant_id, tipe, jam_mulai, jam_selesai, keterangan || null, status_log, hari || null]
    );

    res.json({ success: true, message: 'Aturan berhasil dibuat' });
  } catch (error) {
    console.error('Create rule error:', error);
    res.status(500).json({ success: false, message: 'Error creating rule' });
  }
});

// PUT /api/admin/rules/:id - Update rule
router.put('/admin/rules/:id', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { tenant_id, tipe, jam_mulai, jam_selesai, keterangan, status_log, hari } = req.body;

    if (!tenant_id || !tipe || !jam_mulai || !jam_selesai || !status_log) {
      return res.status(400).json({ success: false, message: 'Semua field wajib diisi' });
    }

    if (!verifyTenantAccess(req, tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const result = await db.query(
      'UPDATE attendance_rules SET tenant_id = ?, tipe = ?, jam_mulai = ?, jam_selesai = ?, keterangan = ?, status_log = ?, hari = ? WHERE id = ?',
      [tenant_id, tipe, jam_mulai, jam_selesai, keterangan || null, status_log, hari || null, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Rule tidak ditemukan' });
    }

    res.json({ success: true, message: 'Aturan berhasil diupdate' });
  } catch (error) {
    console.error('Update rule error:', error);
    res.status(500).json({ success: false, message: 'Error updating rule' });
  }
});

// DELETE /api/admin/rules/:id - Delete rule
router.delete('/admin/rules/:id', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const [rule] = await db.query('SELECT tenant_id FROM attendance_rules WHERE id = ?', [id]);
    if (!rule) {
      return res.status(404).json({ success: false, message: 'Rule tidak ditemukan' });
    }
    if (!verifyTenantAccess(req, rule.tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    await db.query('DELETE FROM attendance_rules WHERE id = ?', [id]);
    res.json({ success: true, message: 'Aturan berhasil dihapus' });
  } catch (error) {
    console.error('Delete rule error:', error);
    res.status(500).json({ success: false, message: 'Error deleting rule' });
  }
});

// ============================================================
// LOCATIONS ROUTES
// ============================================================

// GET /api/admin/tenant-locations - List locations
router.get('/admin/tenant-locations', authenticateOperator, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    let query = 'SELECT tl.*, t.nama_sekolah, t.tipe_unit FROM tenant_locations tl JOIN tenants t ON tl.tenant_id = t.tenant_id';
    let params = [];
    if (tenantId) {
      query += ' WHERE tl.tenant_id = ?';
      params.push(tenantId);
    }
    query += ' ORDER BY tl.tenant_id, tl.location_name';
    const locations = await db.query(query, params);
    res.json({ success: true, data: locations });
  } catch (error) {
    console.error('Locations list error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching locations' });
  }
});

// POST /api/admin/tenant-locations - Create location
router.post('/admin/tenant-locations', authenticateOperator, async (req, res) => {
  try {
    let tenant_id = req.body.tenant_id;

    if (req.user.role === 'guru' && req.user.assignments) {
      const allowedTenants = (req.user.assignments || []).map(a => a.tenant_id);
      if (allowedTenants.length === 1) {
        tenant_id = allowedTenants[0];
      }
    }

    if (!verifyTenantAccess(req, tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const { location_name, latitude, longitude, location_radius } = req.body;

    if (!tenant_id || !location_name) {
      return res.status(400).json({ success: false, message: 'Field wajib diisi' });
    }

    await db.query(
      'INSERT INTO tenant_locations (tenant_id, location_name, latitude, longitude, location_radius, is_active) VALUES (?, ?, ?, ?, ?, 1)',
      [tenant_id, location_name, latitude || null, longitude || null, location_radius || 100]
    );

    res.json({ success: true, message: 'Lokasi berhasil dibuat' });
  } catch (error) {
    console.error('Create location error:', error.message);
    res.status(500).json({ success: false, message: 'Error creating location' });
  }
});

// ============================================================
// SCANNER DEVICES ROUTES (for school admin/operator)
// ============================================================

// GET /api/admin/scanner-devices - List scanner devices for school operator
router.get('/admin/scanner-devices', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;

    // Verify tenant access - only allow if user has access to this tenant (admin always allowed)
    if (tenantId && !verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
    }

    // Determine tenant_id from operator's assignments (jabatan_di_unit)
    if (req.user.role === 'guru' && !tenantId) {
      const operatorAssignments = (req.user.assignments || []).filter(a => {
        const roles = ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (operatorAssignments.length === 1) {
        tenantId = operatorAssignments[0].tenant_id;
      } else if (operatorAssignments.length > 1) {
        // If multiple assignments, use the tenant_id from URL params
        tenantId = req.query.tenant_id;
      }
    }

    let query = `
      SELECT 
        sd.*,
        COUNT(qal.id) as total_scans,
        MAX(qal.created_at) as last_scan
      FROM scanner_devices sd
      LEFT JOIN qr_attendance_logs qal ON sd.device_id = qal.device_id
    `;
    let params = [];

    if (tenantId) {
      query += ' WHERE sd.tenant_id = ?';
      params.push(tenantId);
    }

    query += ' GROUP BY sd.id ORDER BY sd.school_name ASC';

    const devices = await db.query(query, params);
    res.json({ success: true, data: devices });
  } catch (error) {
    console.error('[SCANNER DEVICES ERROR]', error.message);
    res.status(500).json({ success: false, message: 'Error fetching scanner devices' });
  }
});

// POST /api/admin/scanner-devices - Create scanner device
router.post('/admin/scanner-devices', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.body.tenant_id;
    const { registration_token } = req.body;

    // Verify tenant access - only allow if user has access to this tenant
    if (!verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
    }

    // Determine tenant_id from operator's assignments if not provided
    if (req.user.role === 'guru' && !tenantId) {
      const operatorAssignments = (req.user.assignments || []).filter(a => {
        const roles = ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      // Gunakan assignment pertama sebagai default
      if (operatorAssignments.length >= 1) {
        tenantId = operatorAssignments[0].tenant_id;
      }
    }

    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant ID diperlukan' });
    }

    // Get school name
    const tenantResult = await db.query('SELECT nama_sekolah FROM tenants WHERE tenant_id = ?', [tenantId]);
    const school_name = tenantResult.length > 0 ? tenantResult[0].nama_sekolah : 'Sekolah';

    // Generate device_id
    const device_id = `SCAN-${tenantId.toUpperCase()}-${Date.now()}`;

    // Use registration token from frontend or generate new if empty
    const final_token = registration_token || Math.floor(100000 + Math.random() * 900000).toString();

    const result = await db.query(
      'INSERT INTO scanner_devices (device_id, tenant_id, school_name, device_name, registration_token, status, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [device_id, tenantId, school_name, 'Scanner QR', final_token, 'inactive']
    );

    res.json({
      success: true,
      data: {
        device_id,
        tenant_id: tenantId,
        school_name,
        device_name: 'Scanner QR',
        registration_token: final_token,
        status: 'inactive'
      },
      message: 'Device scanner berhasil ditambahkan'
    });
  } catch (error) {
    console.error('[CREATE SCANNER DEVICE ERROR]', error.message);
    res.status(500).json({ success: false, message: 'Error creating scanner device' });
  }
});

// ============================================================
// TEACHERS ROUTES
// ============================================================

// GET /api/admin/teachers - List teachers with pagination
router.get('/admin/teachers', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;

    if (req.user.role === 'guru' && !tenantId) {
      const adminAssignments = (req.user.assignments || []).filter(a => {
        const roles = ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (adminAssignments.length === 1) {
        tenantId = adminAssignments[0].tenant_id;
      } else if (adminAssignments.length > 1) {
        return res.status(400).json({ success: false, message: 'Tentukan tenant_id' });
      }
    }

    let query = `
      SELECT t.id, t.nama, t.nik, t.nip, t.email, t.status_kepegawaian, t.status_aktif, t.no_wa,
             GROUP_CONCAT(DISTINCT CONCAT(ta.tenant_id, ':', ta.jabatan_di_unit, ':', tn.nama_sekolah)) as assignments
      FROM teachers t
      LEFT JOIN teacher_assignments ta ON t.id = ta.teacher_id
      LEFT JOIN tenants tn ON ta.tenant_id = tn.tenant_id
      WHERE t.status_aktif = 1
    `;
    let params = [];

    if (tenantId) {
      query += ' AND EXISTS (SELECT 1 FROM teacher_assignments ta2 WHERE ta2.teacher_id = t.id AND ta2.tenant_id = ?)';
      params.push(tenantId);
    }

    const statusKepegawaian = req.query.status_kepegawaian;
    if (statusKepegawaian) {
      query += ' AND t.status_kepegawaian = ?';
      params.push(statusKepegawaian);
    }

    const search = req.query.search;
    if (search) {
      query += ' AND (t.nama LIKE ? OR t.nik LIKE ? OR t.nip LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ' GROUP BY t.id ORDER BY t.nama ASC LIMIT 100';
    const teachers = await db.query(query, params);
    const formattedTeachers = teachers.map(teacher => ({
      ...teacher,
      assignments: teacher.assignments ? teacher.assignments.split(',').map(a => {
        const [tenant_id, jabatan, nama_sekolah] = a.split(':');
        return { tenant_id, jabatan_di_unit: jabatan, nama_sekolah };
      }) : []
    }));
    res.json({ success: true, data: formattedTeachers });
  } catch (error) {
    console.error('Admin teachers error:', error);
    res.status(500).json({ success: false, message: 'Error fetching teachers' });
  }
});

// // GET /api/admin/teachers/:id - Get teacher by ID
// router.get('/admin/teachers/:id', authenticateOperator, async (req, res) => {
//   try {
//     const [teacher] = await db.query(
//       'SELECT id, nama, nik, tempat_lahir, tanggal_lahir, jenis_kelamin, alamat, no_wa, email, status_kepegawaian, tmt, nip, scan_id, link_foto, status_aktif FROM teachers WHERE id = ? AND status_aktif = 1',
//       [req.params.id]
//     );
//     if (!teacher) {
//       return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
//     }
//     const assignmentRows = await db.query('SELECT tenant_id, jabatan_di_unit FROM teacher_assignments WHERE teacher_id = ?', [req.params.id]);
//     teacher.assignments = assignmentRows;
//     res.json({ success: true, data: teacher });
//   } catch (error) {
//     console.error('Get teacher error:', error.message);
//     res.status(500).json({ success: false, message: 'Error fetching teacher' });
//   }
// }

// POST /api/admin/teachers - Create teacher with assignment
router.post('/admin/teachers', authenticateOperator, async (req, res) => {
  try {
    const { nama, tenant_id, jabatan_di_unit } = req.body;

    if (!nama || !tenant_id) {
      return res.status(400).json({ success: false, message: 'Nama dan penempatan sekolah wajib diisi' });
    }

    // Verify tenant exists
    const [tenant] = await db.query('SELECT tenant_id FROM tenants WHERE tenant_id = ?', [tenant_id]);
    if (!tenant) {
      return res.status(400).json({ success: false, message: 'Tenant tidak ditemukan' });
    }

    // Create teacher
    const result = await db.query(
      'INSERT INTO teachers (nama, status_aktif) VALUES (?, 1)',
      [nama]
    );

    const teacherId = result.insertId;

    // Create assignment
    await db.query(
      'INSERT INTO teacher_assignments (teacher_id, tenant_id, jabatan_di_unit) VALUES (?, ?, ?)',
      [teacherId, tenant_id, jabatan_di_unit || 'Guru']
    );

    res.json({ success: true, message: 'Guru berhasil ditambahkan', id: teacherId });
  } catch (error) {
    console.error('Create teacher error:', error);
    res.status(500).json({ success: false, message: 'Error creating teacher' });
  }
});

// GET /api/admin/teachers/:id - Get teacher by ID with assignment
router.get('/admin/teachers/:id', authenticateOperator, async (req, res) => {
  try {
    const [teacher] = await db.query(
      'SELECT t.id, t.nama FROM teachers t WHERE t.id = ? AND t.status_aktif = 1',
      [req.params.id]
    );
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
    }
    const assignmentRows = await db.query('SELECT tenant_id, jabatan_di_unit FROM teacher_assignments WHERE teacher_id = ?', [req.params.id]);
    teacher.assignments = assignmentRows;
    res.json({ success: true, data: teacher });
  } catch (error) {
    console.error('Get teacher error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching teacher' });
  }
});

// PUT /api/admin/teachers/:id - Update teacher with assignment
router.put('/admin/teachers/:id', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { nama, tenant_id, jabatan_di_unit } = req.body;

    if (!nama || !tenant_id) {
      return res.status(400).json({ success: false, message: 'Nama dan penempatan sekolah wajib diisi' });
    }

    // Verify tenant exists
    const [tenant] = await db.query('SELECT tenant_id FROM tenants WHERE tenant_id = ?', [tenant_id]);
    if (!tenant) {
      return res.status(400).json({ success: false, message: 'Tenant tidak ditemukan' });
    }

    // Update teacher
    await db.query('UPDATE teachers SET nama = ? WHERE id = ?', [nama, id]);

    // Update or create assignment
    const existingAssignment = await db.query('SELECT id FROM teacher_assignments WHERE teacher_id = ?', [id]);
    if (existingAssignment.length > 0) {
      await db.query(
        'UPDATE teacher_assignments SET tenant_id = ?, jabatan_di_unit = ? WHERE teacher_id = ?',
        [tenant_id, jabatan_di_unit || 'Guru', id]
      );
    } else {
      await db.query(
        'INSERT INTO teacher_assignments (teacher_id, tenant_id, jabatan_di_unit) VALUES (?, ?, ?)',
        [id, tenant_id, jabatan_di_unit || 'Guru']
      );
    }

    res.json({ success: true, message: 'Data guru berhasil diupdate' });
  } catch (error) {
    console.error('Update teacher error:', error);
    res.status(500).json({ success: false, message: 'Error updating teacher' });
  }
});

// DELETE /api/admin/teachers/:id - Delete teacher (soft delete)
router.delete('/admin/teachers/:id', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query('UPDATE teachers SET status_aktif = 0 WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
    }

    res.json({ success: true, message: 'Guru berhasil dihapus' });
  } catch (error) {
    console.error('Delete teacher error:', error);
    res.status(500).json({ success: false, message: 'Error deleting teacher' });
  }
});

// });

// ============================================================
// DASHBOARD ROUTES
// ============================================================

// GET /api/dashboard - User dashboard
router.get('/dashboarda', authenticateToken, async (req, res) => {
  try {
    let attendanceQuery;
    if (req.user.role === 'admin') {
      attendanceQuery = await db.query('SELECT COUNT(*) as total FROM attendance_logs');
    } else {
      attendanceQuery = await db.query('SELECT COUNT(*) as total FROM attendance_logs WHERE teacher_id = ?', [req.user.guru_id]);
    }

    res.json({
      success: true,
      data: {
        totalAbsensi: attendanceQuery[0]?.total || 0,
        user: req.user
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching dashboard' });
  }
});

// GET /api/admin/summary - Admin dashboard summary
router.get('/admin/summary', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;

    // Operator: force tenant_id from assignment if not provided
    if (req.user.role !== 'admin' && !tenantId) {
      const adminAssignments = (req.user.assignments || []).filter(a => {
        const roles = ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (adminAssignments.length === 1) {
        tenantId = adminAssignments[0].tenant_id;
      } else if (adminAssignments.length > 1) {
        tenantId = adminAssignments[0].tenant_id;
      }
    }

    // Verify tenant access
    if (tenantId && !verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    let teacherQuery = 'SELECT COUNT(DISTINCT t.id) as count FROM teachers t';
    let teacherParams = [];
    if (tenantId) {
      teacherQuery += ' JOIN teacher_assignments ta ON t.id = ta.teacher_id AND ta.tenant_id = ?';
      teacherParams.push(tenantId);
    }
    teacherQuery += ' WHERE t.status_aktif = 1';
    const [totalTeachers] = await db.query(teacherQuery, teacherParams);

    let activeQuery = `
      SELECT COUNT(DISTINCT a.teacher_id) as count
      FROM attendance_logs a
      JOIN teachers t ON a.teacher_id = t.id
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      WHERE DATE(a.waktu_scan) = CURDATE() ${tenantId ? 'AND (a.tenant_id = ? OR a.dinas_luar = 1)' : ''}
    `;
    let activeParams = [];
    if (tenantId) {
      activeParams.push(tenantId);
    }
    const [activeToday] = await db.query(activeQuery, activeParams);

    let lateQuery = `
      SELECT COUNT(*) as count
      FROM attendance_logs a
      JOIN teachers t ON a.teacher_id = t.id
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      WHERE DATE(a.waktu_scan) = CURDATE() AND a.status = 'terlambat' ${tenantId ? 'AND (a.tenant_id = ? OR a.dinas_luar = 1)' : ''}
    `;
    let lateParams = [];
    if (tenantId) {
      lateParams.push(tenantId);
    }
    const [lateToday] = await db.query(lateQuery, lateParams);

    let locQuery = 'SELECT COUNT(*) as count FROM tenant_locations WHERE 1=1';
    let locParams = [];
    if (tenantId) {
      locQuery += ' AND tenant_id = ?';
      locParams = [tenantId];
    }
    const [totalLocations] = await db.query(locQuery, locParams);

    res.json({
      success: true,
      data: {
        totalTeachers: totalTeachers.count,
        activeToday: activeToday.count,
        lateToday: lateToday.count,
        totalLocations: totalLocations.count
      }
    });
  } catch (error) {
    console.error('Admin summary error:', error);
    res.status(500).json({ success: false, message: 'Error fetching summary' });
  }
});

// ============================================================
// STUDENTS ROUTES (Admin Management)
// ============================================================

// GET /api/admin/students - List students with pagination
router.get('/admin/students', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const offset = (page - 1) * limit;

    if (req.user.role !== 'admin' && !tenantId) {
      const adminAssignments = (req.user.assignments || []).filter(a => {
        const roles = ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (adminAssignments.length === 1) {
        tenantId = adminAssignments[0].tenant_id;
      }
    }

    let countQuery = `
      SELECT COUNT(*) as total
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE 1=1
    `;
    let countParams = [];

    if (tenantId) {
      countQuery += ' AND s.tenant_id = ?';
      countParams.push(tenantId);
    }

    const search = req.query.search;
    const classId = req.query.class_id;
    if (search) {
      countQuery += ' AND (s.nama_siswa LIKE ? OR s.nisn LIKE ? OR s.nis LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (classId) {
      countQuery += ' AND s.class_id = ?';
      countParams.push(classId);
    }

    const [totalResult] = await db.query(countQuery, countParams);
    const total = totalResult.total;

    let query = `
      SELECT s.id, s.nama_siswa, s.nisn, s.nis, s.jenis_kelamin, s.iuran_bulanan,
             c.nama_kelas, tn.nama_sekolah, p.nama_orang_tua, p.no_wa as no_wa_ortu
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE 1=1
    `;
    let params = [];

    if (tenantId) {
      query += ' AND s.tenant_id = ?';
      params.push(tenantId);
    }

    if (search) {
      query += ' AND (s.nama_siswa LIKE ? OR s.nisn LIKE ? OR s.nis LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (classId) {
      query += ' AND s.class_id = ?';
      params.push(classId);
    }

    const sortBy = req.query.sortBy || 'nama_siswa';
    const sortDir = req.query.sortDir === 'DESC' ? 'DESC' : 'ASC';
    const allowedSortFields = {
      'nama_siswa': 's.nama_siswa',
      'nisn': 's.nisn',
      'nis': 's.nis',
      'nama_kelas': 'c.nama_kelas',
      'nama_sekolah': 'tn.nama_sekolah',
      'iuran_bulanan': 's.iuran_bulanan'
    };
    const sortField = allowedSortFields[sortBy] || 's.nama_siswa';

    query += ` ORDER BY ${sortField} ${sortDir} LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const students = await db.query(query, params);

    res.json({
      success: true,
      data: students,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Admin students error:', error);
    res.status(500).json({ success: false, message: 'Error fetching students' });
  }
});

// GET /api/admin/students/:id - Get single student by ID
router.get('/admin/students/:id', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const [student] = await db.query(
      'SELECT s.*, c.nama_kelas, tn.nama_sekolah FROM students s LEFT JOIN classes c ON s.class_id = c.id LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id WHERE s.id = ?',
      [id]
    );

    if (!student) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }

    res.json({ success: true, data: student });
  } catch (error) {
    console.error('Get student error:', error);
    res.status(500).json({ success: false, message: 'Error fetching student' });
  }
});

// GET /api/admin/classes - List classes
router.get('/admin/classes', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    let query = 'SELECT id, tenant_id, nama_kelas FROM classes';
    let params = [];

    if (tenantId) {
      query += ' WHERE tenant_id = ?';
      params.push(tenantId);
    }

    query += ' ORDER BY nama_kelas ASC';
    const classes = await db.query(query, params);
    res.json({ success: true, data: classes });
  } catch (error) {
    console.error('Admin classes error:', error);
    res.status(500).json({ success: false, message: 'Error fetching classes' });
  }
});

// POST /api/admin/students - Create student
router.post('/admin/students', authenticateOperator, async (req, res) => {
  try {
    const { tenant_id, nis, nisn, nama_siswa, jenis_kelamin, class_id, parent_id, iuran_bulanan } = req.body;

    if (!nis || !nama_siswa || !tenant_id) {
      return res.status(400).json({ success: false, message: 'NIS, nama siswa, dan tenant_id wajib diisi' });
    }

    const existing = await db.query('SELECT id FROM students WHERE nis = ?', [nis]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'NIS sudah digunakan' });
    }

    const result = await db.query(
      'INSERT INTO students (tenant_id, nis, nisn, nama_siswa, jenis_kelamin, class_id, parent_id, iuran_bulanan) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [tenant_id, nis, nisn || null, nama_siswa, jenis_kelamin, class_id || null, parent_id || null, iuran_bulanan || 0]
    );

    res.json({ success: true, message: 'Siswa berhasil ditambahkan', id: result.insertId });
  } catch (error) {
    console.error('Create student error:', error);
    res.status(500).json({ success: false, message: 'Error creating student' });
  }
});

// PUT /api/admin/students/:id - Update student
router.put('/admin/students/:id', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { tenant_id, nis, nisn, nama_siswa, jenis_kelamin, class_id, parent_id, iuran_bulanan } = req.body;

    if (!nis || !nama_siswa) {
      return res.status(400).json({ success: false, message: 'NIS dan nama siswa wajib diisi' });
    }

    const result = await db.query(
      'UPDATE students SET nis = ?, nisn = ?, nama_siswa = ?, jenis_kelamin = ?, class_id = ?, parent_id = ?, iuran_bulanan = ? WHERE id = ?',
      [nis, nisn || null, nama_siswa, jenis_kelamin, class_id || null, parent_id || null, iuran_bulanan || 0, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }

    res.json({ success: true, message: 'Data siswa berhasil diupdate' });
  } catch (error) {
    console.error('Update student error:', error);
    res.status(500).json({ success: false, message: 'Error updating student' });
  }
});

// DELETE /api/admin/students/:id - Delete student
router.delete('/admin/students/:id', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query('DELETE FROM students WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }

    res.json({ success: true, message: 'Siswa berhasil dihapus' });
  } catch (error) {
    console.error('Delete student error:', error);
    res.status(500).json({ success: false, message: 'Error deleting student' });
  }
});

// POST /api/admin/classes - Create class
router.post('/admin/classes', authenticateOperator, async (req, res) => {
  try {
    const { tenant_id, nama_kelas } = req.body;

    if (!tenant_id || !nama_kelas) {
      return res.status(400).json({ success: false, message: 'tenant_id dan nama_kelas wajib diisi' });
    }

    const result = await db.query(
      'INSERT INTO classes (tenant_id, nama_kelas) VALUES (?, ?)',
      [tenant_id, nama_kelas]
    );

    res.json({ success: true, message: 'Kelas berhasil ditambahkan', id: result.insertId });
  } catch (error) {
    console.error('Create class error:', error);
    res.status(500).json({ success: false, message: 'Error creating class' });
  }
});

// POST /api/admin/parents - Create parent
router.post('/admin/parents', authenticateOperator, async (req, res) => {
  try {
    const { nama_orang_tua, no_wa } = req.body;

    if (!nama_orang_tua) {
      return res.status(400).json({ success: false, message: 'Nama orang tua wajib diisi' });
    }

    const result = await db.query(
      'INSERT INTO parents (nama_orang_tua, no_wa) VALUES (?, ?)',
      [nama_orang_tua, no_wa || null]
    );

    res.json({ success: true, message: 'Orang tua berhasil ditambahkan', id: result.insertId });
  } catch (error) {
    console.error('Create parent error:', error);
    res.status(500).json({ success: false, message: 'Error creating parent' });
  }
});

// GET /api/admin/student-payment-summary - Ringkasan pembayaran iuran per kelas
router.get('/admin/student-payment-summary', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    let classId = req.query.class_id;

    if (req.user.role !== 'admin' && !tenantId) {
      const adminAssignments = (req.user.assignments || []).filter(a => {
        const roles = ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (adminAssignments.length === 1) {
        tenantId = adminAssignments[0].tenant_id;
      }
    }

    let query = `
      SELECT 
        c.nama_kelas,
        COUNT(s.id) as total_siswa,
        SUM(CASE WHEN s.iuran_bulanan > 0 THEN 1 ELSE 0 END) as sudah_bayar,
        SUM(CASE WHEN s.iuran_bulanan = 0 OR s.iuran_bulanan IS NULL THEN 1 ELSE 0 END) as belum_bayar,
        SUM(s.iuran_bulanan) as total_pemasukan
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE 1=1
    `;
    let params = [];

    if (tenantId) {
      query += ' AND s.tenant_id = ?';
      params.push(tenantId);
    }

    if (classId) {
      query += ' AND s.class_id = ?';
      params.push(classId);
    }

    query += ' GROUP BY c.id, c.nama_kelas ORDER BY c.nama_kelas ASC';
    const summary = await db.query(query, params);
    res.json({ success: true, data: summary });
  } catch (error) {
    console.error('Student payment summary error:', error);
    res.status(500).json({ success: false, message: 'Error fetching payment summary' });
  }
});

// PUT /api/admin/students/:id/payment - Update iuran siswa
router.put('/admin/students/:id/payment', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { iuran_bulanan } = req.body;

    if (iuran_bulanan === undefined) {
      return res.status(400).json({ success: false, message: 'iuran_bulanan wajib diisi' });
    }

    const result = await db.query(
      'UPDATE students SET iuran_bulanan = ? WHERE id = ?',
      [iuran_bulanan, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }

    res.json({ success: true, message: 'Iuran berhasil diupdate' });
  } catch (error) {
    console.error('Update payment error:', error);
    res.status(500).json({ success: false, message: 'Error updating payment' });
  }
});

// GET /api/search/teachers - Search teachers (public endpoint)
router.get('/search/teachers', async (req, res) => {
  try {
    const searchTerm = req.query.q || '';

    let query = `
      SELECT t.id, t.nama, t.nik, t.nip, t.status_aktif,
             GROUP_CONCAT(CONCAT(ta.tenant_id, ':', tn.nama_sekolah)) as assignments,
             EXISTS(SELECT 1 FROM users u WHERE u.guru_id = t.id) as has_user
      FROM teachers t
      LEFT JOIN teacher_assignments ta ON t.id = ta.teacher_id
      LEFT JOIN tenants tn ON ta.tenant_id = tn.tenant_id
      WHERE t.status_aktif = 1
    `;
    let params = [];

    if (searchTerm) {
      query += ' AND (t.nama LIKE ? OR t.nik LIKE ? OR t.nip LIKE ?)';
      params.push(`%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`);
    }

    query += ' GROUP BY t.id ORDER BY t.nama ASC LIMIT 100';
    const teachers = await db.query(query, params);

    // Format assignments
    const formattedTeachers = teachers.map(teacher => ({
      ...teacher,
      assignments: teacher.assignments ? teacher.assignments.split(',').map(a => {
        const [tenant_id, nama_sekolah] = a.split(':');
        return { tenant_id, nama_sekolah };
      }) : []
    }));

    res.json({ success: true, data: formattedTeachers });
  } catch (error) {
    console.error('Search teachers error:', error);
    res.status(500).json({ success: false, message: 'Error searching teachers' });
  }
});

// PUT /api/admin/teachers/:id/transfer - Transfer teacher to different tenant (set to mutasi pool)
router.put('/admin/teachers/:id/transfer', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { tenant_id, jabatan_di_unit } = req.body;

    if (!tenant_id) {
      return res.status(400).json({ success: false, message: 'tenant_id wajib diisi' });
    }

    const [tenant] = await db.query('SELECT tenant_id FROM tenants WHERE tenant_id = ?', [tenant_id]);
    if (!tenant) {
      return res.status(400).json({ success: false, message: 'Tenant tidak ditemukan' });
    }

    const existingAssignment = await db.query('SELECT id FROM teacher_assignments WHERE teacher_id = ?', [id]);
    if (existingAssignment.length > 0) {
      // Set mutasi_status to pending for cross-tenant adoption
      await db.query(
        'UPDATE teacher_assignments SET tenant_id = NULL, jabatan_di_unit = ?, mutasi_status = "pending" WHERE teacher_id = ?',
        [jabatan_di_unit || 'Guru', id]
      );
    } else {
      await db.query(
        'INSERT INTO teacher_assignments (teacher_id, tenant_id, jabatan_di_unit, mutasi_status) VALUES (?, NULL, ?, "pending")',
        [id, jabatan_di_unit || 'Guru']
      );
    }

    const [teacher] = await db.query('SELECT nama FROM teachers WHERE id = ?', [id]);
    res.json({ success: true, message: `${teacher.nama} siap diadopsi sekolah lain` });
  } catch (error) {
    console.error('Transfer teacher error:', error);
    res.status(500).json({ success: false, message: 'Error transferring teacher' });
  }
});

// PUT /api/admin/students/:id/transfer - Put student into mutasi pool for adoption
router.put('/admin/students/:id/transfer', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { tenant_id, class_id } = req.body;

    // Set mutasi_status to pending, clear tenant for adoption pool
    await db.query(
      'UPDATE students SET mutasi_status = "pending" WHERE id = ?',
      [id]
    );

    const [student] = await db.query('SELECT nama_siswa FROM students WHERE id = ?', [id]);
    res.json({ success: true, message: `${student.nama_siswa} siap diadopsi sekolah lain` });
  } catch (error) {
    console.error('Transfer student error:', error);
    res.status(500).json({ success: false, message: 'Error transferring student' });
  }
});

// ============================================================
// CROSS-TENANT TRANSFER ROUTES
// ============================================================

// POST /api/admin/mutasi/teachers/:id/initiate - Send teacher to mutasi pool (cross-tenant transfer)
router.post('/admin/mutasi/teachers/:id/initiate', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    // Check if mutasi_status column exists, if not update all assignments to remove tenant
    try {
      // With mutasi_status column - set to pending and null tenant_id
      await db.query(
        'UPDATE teacher_assignments SET tenant_id = NULL, mutasi_status = ?, mutasi_reason = ?, mutasi_date = NOW() WHERE teacher_id = ?',
        ['pending', reason || null, id]
      );
    } catch (colError) {
      // Without mutasi_status - just null the tenant_id
      await db.query(
        'UPDATE teacher_assignments SET tenant_id = NULL WHERE teacher_id = ?',
        [id]
      );
    }

    const [teacher] = await db.query('SELECT nama FROM teachers WHERE id = ?', [id]);
    res.json({ success: true, message: `${teacher.nama} berhasil masuk daftar mutasi lintas sekolah` });
  } catch (error) {
    console.error('Initiate mutasi teacher error:', error);
    res.status(500).json({ success: false, message: 'Error initiating mutasi' });
  }
});

// POST /api/admin/mutasi/students/:id/initiate - Send student to mutasi pool (cross-tenant transfer)
router.post('/admin/mutasi/students/:id/initiate', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    // Check if mutasi_status column exists
    try {
      await db.query(
        'UPDATE students SET tenant_id = NULL, mutasi_status = ?, mutasi_reason = ?, mutasi_date = NOW() WHERE id = ?',
        ['pending', reason || null, id]
      );
    } catch (colError) {
      await db.query(
        'UPDATE students SET tenant_id = NULL WHERE id = ?',
        [id]
      );
    }

    const [student] = await db.query('SELECT nama_siswa FROM students WHERE id = ?', [id]);
    res.json({ success: true, message: `${student.nama_siswa} berhasil masuk daftar mutasi lintas sekolah` });
  } catch (error) {
    console.error('Initiate mutasi student error:', error);
    res.status(500).json({ success: false, message: 'Error initiating mutasi' });
  }
});

// GET /api/admin/mutasi/teachers - List teachers available for cross-tenant adoption
router.get('/admin/mutasi/teachers', authenticateOperator, async (req, res) => {
  try {
    logToFile(`MUTASI_TEACHERS_REQUEST: user=${req.user.username}, role=${req.user.role}, tenant=${req.query.tenant_id || 'all'}`);
    // Try with mutasi_status column first, fallback to teachers without active assignment
    try {
      const teachers = await db.query(`
         SELECT t.id, t.nama, t.nik, t.nip, t.no_wa, ta.tenant_id as old_tenant_id, tn.nama_sekolah as old_school
         FROM teachers t
         JOIN teacher_assignments ta ON t.id = ta.teacher_id
         JOIN tenants tn ON ta.tenant_id = tn.tenant_id
         WHERE ta.mutasi_status = 'pending'
         ORDER BY t.nama ASC
       `);

      logToFile(`MUTASI_TEACHERS_RESPONSE: count=${teachers.length}`);
      return res.json({ success: true, data: teachers });
    } catch (colError) {
      // Fallback: teachers with no active assignment (tenant_id is NULL)
      const teachers = await db.query(`
         SELECT t.id, t.nama, t.nik, t.nip, t.no_wa, NULL as old_tenant_id, NULL as old_school
         FROM teachers t
         LEFT JOIN teacher_assignments ta ON t.id = ta.teacher_id AND ta.tenant_id IS NOT NULL
         WHERE ta.id IS NULL
         ORDER BY t.nama ASC
       `);

      logToFile(`MUTASI_TEACHERS_RESPONSE_FALLBACK: count=${teachers.length}`);
      res.json({ success: true, data: teachers });
    }
  } catch (error) {
    logToFile(`MUTASI_TEACHERS_ERROR: ${error.message}`);
    console.error('Get mutasi teachers error:', error);
    res.status(500).json({ success: false, message: 'Error fetching mutasi teachers' });
  }
});

// GET /api/admin/mutasi/students - List students available for cross-tenant adoption
router.get('/admin/mutasi/students', authenticateOperator, async (req, res) => {
  try {
    logToFile(`MUTASI_STUDENTS_REQUEST: user=${req.user.username}, role=${req.user.role}, tenant=${req.query.tenant_id || 'all'}`);
    // Try with mutasi_status column first, fallback to students without tenant
    try {
      const students = await db.query(`
         SELECT s.id, s.nama_siswa, s.nisn, s.nis, s.tenant_id as old_tenant_id, tn.nama_sekolah as old_school, c.nama_kelas
         FROM students s
         LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id
         LEFT JOIN classes c ON s.class_id = c.id
         WHERE s.mutasi_status = 'pending'
         ORDER BY s.nama_siswa ASC
       `);

      logToFile(`MUTASI_STUDENTS_RESPONSE: count=${students.length}`);
      return res.json({ success: true, data: students });
    } catch (colError) {
      // Fallback: students without tenant assignment
      const students = await db.query(`
         SELECT s.id, s.nama_siswa, s.nisn, s.nis, NULL as old_tenant_id, NULL as old_school, NULL as nama_kelas
         FROM students s
         WHERE s.tenant_id IS NULL OR s.tenant_id = ''
         ORDER BY s.nama_siswa ASC
       `);

      logToFile(`MUTASI_STUDENTS_RESPONSE_FALLBACK: count=${students.length}`);
      res.json({ success: true, data: students });
    }
  } catch (error) {
    logToFile(`MUTASI_STUDENTS_ERROR: ${error.message}`);
    console.error('Get mutasi students error:', error);
    res.status(500).json({ success: false, message: 'Error fetching mutasi students' });
  }
});

// POST /api/admin/mutasi/teachers/:id/adopt - Adopt teacher from mutasi pool
router.post('/admin/mutasi/teachers/:id/adopt', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { tenant_id, jabatan_di_unit } = req.body;

    if (!tenant_id) {
      return res.status(400).json({ success: false, message: 'tenant_id wajib diisi' });
    }

    // Verify tenant exists
    const [tenant] = await db.query('SELECT tenant_id, nama_sekolah FROM tenants WHERE tenant_id = ?', [tenant_id]);
    if (!tenant) {
      return res.status(400).json({ success: false, message: 'Tenant tidak ditemukan' });
    }

    // Update teacher assignment - set mutasi_status to adopted and change tenant
    try {
      await db.query(
        'UPDATE teacher_assignments SET tenant_id = ?, mutasi_status = NULL, jabatan_di_unit = ? WHERE teacher_id = ?',
        [tenant_id, jabatan_di_unit || 'Guru', id]
      );
    } catch (colError) {
      // Fallback: just update the tenant without mutasi_status
      await db.query(
        'UPDATE teacher_assignments SET tenant_id = ?, jabatan_di_unit = ? WHERE teacher_id = ?',
        [tenant_id, jabatan_di_unit || 'Guru', id]
      );
    }

    const [teacher] = await db.query('SELECT nama FROM teachers WHERE id = ?', [id]);
    res.json({ success: true, message: `${teacher.nama} berhasil diadopsi ke ${tenant.nama_sekolah || tenant_id}` });
  } catch (error) {
    console.error('Adopt teacher error:', error);
    res.status(500).json({ success: false, message: 'Error adopting teacher' });
  }
});

// POST /api/admin/mutasi/students/:id/adopt - Adopt student from mutasi pool
router.post('/admin/mutasi/students/:id/adopt', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { tenant_id, class_id } = req.body;

    if (!tenant_id) {
      return res.status(400).json({ success: false, message: 'tenant_id wajib diisi' });
    }

    const [tenant] = await db.query('SELECT tenant_id FROM tenants WHERE tenant_id = ?', [tenant_id]);
    if (!tenant) {
      return res.status(400).json({ success: false, message: 'Tenant tidak ditemukan' });
    }

    try {
      await db.query(
        'UPDATE students SET tenant_id = ?, class_id = ?, mutasi_status = NULL WHERE id = ?',
        [tenant_id, class_id || null, id]
      );
    } catch (colError) {
      await db.query(
        'UPDATE students SET tenant_id = ?, class_id = ? WHERE id = ?',
        [tenant_id, class_id || null, id]
      );
    }

    const [student] = await db.query('SELECT nama_siswa FROM students WHERE id = ?', [id]);
    res.json({ success: true, message: `${student.nama_siswa} berhasil diadopsi` });
  } catch (error) {
    console.error('Adopt student error:', error);
    res.status(500).json({ success: false, message: 'Error adopting student' });
  }
});

module.exports = router;