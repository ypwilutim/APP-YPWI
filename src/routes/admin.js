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
const { fetchMetaTemplates } = require('../utils/whatsappTemplate');

const router = express.Router();
const XLSX = require('xlsx');

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

// POST /api/upload-profile-photo - Upload profile photo for logged-in guru (dashboard)
router.post('/upload-profile-photo', authenticateToken, teacherUpload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Tidak ada file foto yang diupload.' });
    }
    if (!req.user.guru_id) {
      return res.status(400).json({ success: false, message: 'User tidak valid.' });
    }

    const photoUrl = `/uploads/${req.file.filename}`;
    await db.query('UPDATE teachers SET link_foto = ? WHERE id = ?', [photoUrl, req.user.guru_id]);

    res.json({ success: true, photoUrl, message: 'Foto profil berhasil diperbarui' });
  } catch (error) {
    console.error('Upload profile photo error:', error);
    res.status(500).json({ success: false, message: 'Gagal mengupload foto profil.' });
  }
});

// ============================================================
// TENANTS ROUTES
// ============================================================

// GET /api/admin/tenants - List all tenants with tipe_unit
router.get('/admin/tenants', authenticateOperator, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    let query = 'SELECT tenant_id, nama_sekolah, absensi_method, use_central_rules, latitude, longitude, COALESCE(location_radius, 100) as location_radius, location_name, tipe_unit';
    // Add bank columns if they exist (graceful fallback)
    try {
      await db.query('SELECT bank_account_number, bank_account_name FROM tenants LIMIT 1');
      query += ', bank_account_number, bank_account_name';
    } catch (err) {
      query += ", '' as bank_account_number, '' as bank_account_name";
    }
    query += ' FROM tenants';
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
    let { tenant_id, tipe, jam_mulai, jam_selesai, keterangan, status_log, hari } = req.body;

    // Get existing rule to verify tenant access and use its tenant_id if not provided in body
    const [existingRule] = await db.query('SELECT tenant_id FROM attendance_rules WHERE id = ?', [id]);
    if (!existingRule) {
      return res.status(404).json({ success: false, message: 'Rule tidak ditemukan' });
    }

    // Use query tenant_id as fallback, then existing rule's tenant_id
    const targetTenantId = tenant_id || req.query.tenant_id || existingRule.tenant_id;

    if (!verifyTenantAccess(req, targetTenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    // Use existing rule's tenant_id if body tenant_id is empty but query or existing has it
    tenant_id = targetTenantId;

    if (!tipe || !jam_mulai || !jam_selesai || !status_log) {
      return res.status(400).json({ success: false, message: 'Field tipe, jam_mulai, jam_selesai, status_log wajib diisi' });
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

// DELETE /api/admin/tenant-locations/:id - Delete location
router.delete('/admin/tenant-locations/:id', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.query.tenant_id;
    const [location] = await db.query('SELECT tenant_id FROM tenant_locations WHERE id = ?', [id]);
    if (!location) {
      return res.status(404).json({ success: false, message: 'Lokasi tidak ditemukan' });
    }
    if (tenantId && !verifyTenantAccess(req, location.tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
    if (tenantId && location.tenant_id !== tenantId) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    await db.query('DELETE FROM tenant_locations WHERE id = ?', [id]);
    res.json({ success: true, message: 'Lokasi berhasil dihapus' });
  } catch (error) {
    console.error('Delete location error:', error);
    res.status(500).json({ success: false, message: 'Error deleting location' });
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

    if (req.user.role !== 'admin' && !tenantId) {
      const adminAssignments = (req.user.assignments || []).filter(a => {
        const roles = ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin', 'guru'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (adminAssignments.length === 1) {
        tenantId = adminAssignments[0].tenant_id;
      } else if (adminAssignments.length > 1) {
        tenantId = req.user.tenant_id || adminAssignments[0].tenant_id;
      }
    }

    // For 'guru' role, use their assigned tenant from assignments or user's primary tenant
    if (req.user.role === 'guru' && !tenantId) {
      tenantId = req.user.tenant_id || (req.user.assignments?.[0]?.tenant_id);
    }

    let query = `
      SELECT t.id, t.nama, t.nik, t.nip, t.email, t.status_kepegawaian, t.status_aktif, t.no_wa, t.scan_id, t.link_foto,
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

    query += ' GROUP BY t.id ORDER BY t.nama ASC';
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
    const { nama, tenant_id, jabatan_di_unit, nik, nip, status_kepegawaian, email } = req.body;

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
      'INSERT INTO teachers (nama, nik, nip, status_kepegawaian, email, status_aktif) VALUES (?, ?, ?, ?, ?, 1)',
      [nama, nik || null, nip || null, status_kepegawaian || null, email || null]
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
    const { nama, tenant_id, jabatan_di_unit, nik, nip, status_kepegawaian, email } = req.body;

    if (!nama || !tenant_id) {
      return res.status(400).json({ success: false, message: 'Nama dan penempatan sekolah wajib diisi' });
    }

    // Verify tenant exists
    const [tenant] = await db.query('SELECT tenant_id FROM tenants WHERE tenant_id = ?', [tenant_id]);
    if (!tenant) {
      return res.status(400).json({ success: false, message: 'Tenant tidak ditemukan' });
    }

    // Update teacher
    await db.query('UPDATE teachers SET nama = ?, nik = ?, nip = ?, status_kepegawaian = ?, email = ? WHERE id = ?', [nama, nik || null, nip || null, status_kepegawaian || null, email || null, id]);

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

// ==========================================
// ASSIGNMENT ROUTES - Pembagian Tugas Guru/Staf
// ==========================================

// GET /api/admin/assignments - List teachers with their assignments
router.get('/admin/assignments', authenticateOperator, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    const query = `
      SELECT t.id, t.nama, t.nik, t.nip, t.email, t.no_wa,
             ta.jabatan_di_unit,
             c.nama_kelas as wali_kelas
      FROM teachers t
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      LEFT JOIN classes c ON ta.class_id = c.id
      WHERE t.status_aktif = 1
      ${tenantId ? 'AND ta.tenant_id = ?' : ''}
      ORDER BY t.nama ASC
    `;
    const params = tenantId ? [tenantId] : [];
    const teachers = await db.query(query, params);
    res.json({ success: true, data: teachers });
  } catch (error) {
    console.error('Admin assignments error:', error);
    res.status(500).json({ success: false, message: 'Error fetching assignments' });
  }
});

// PUT /api/admin/teachers/:id/assignment - Update teacher assignment (jabatan + class_id)
router.put('/admin/teachers/:id/assignment', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { jabatan_di_unit, class_id } = req.body;

    // Verify teacher exists
    const [teacher] = await db.query('SELECT id FROM teachers WHERE id = ? AND status_aktif = 1', [id]);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
    }

    // If class_id provided, verify it belongs to the teacher's tenant
    if (class_id) {
      const [assignment] = await db.query('SELECT tenant_id FROM teacher_assignments WHERE teacher_id = ?', [id]);
      if (assignment) {
        const [classCheck] = await db.query('SELECT id FROM classes WHERE id = ? AND tenant_id = ?', [class_id, assignment.tenant_id]);
        if (!classCheck) {
          return res.status(400).json({ success: false, message: 'Kelas tidak valid untuk tenant ini' });
        }
      }
    }

    // Update assignment
    const existingAssignment = await db.query('SELECT id FROM teacher_assignments WHERE teacher_id = ?', [id]);
    if (existingAssignment.length > 0) {
      await db.query(
        'UPDATE teacher_assignments SET jabatan_di_unit = ?, class_id = ? WHERE teacher_id = ?',
        [jabatan_di_unit || 'Guru', class_id || null, id]
      );
    } else {
      const [teacherInfo] = await db.query('SELECT tenant_id FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id WHERE t.id = ?', [id]);
      if (teacherInfo) {
        await db.query(
          'INSERT INTO teacher_assignments (teacher_id, tenant_id, jabatan_di_unit, class_id) VALUES (?, ?, ?, ?)',
          [id, teacherInfo.tenant_id, jabatan_di_unit || 'Guru', class_id || null]
        );
      }
    }

    res.json({ success: true, message: 'Tugas guru berhasil diupdate' });
  } catch (error) {
    console.error('Update assignment error:', error);
    res.status(500).json({ success: false, message: 'Error updating assignment' });
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
      ${tenantId ? 'JOIN teacher_assignments ta ON t.id = ta.teacher_id' : ''}
      WHERE DATE(COALESCE(a.waktu_absen, a.waktu_scan)) = UTC_DATE() ${tenantId ? 'AND (a.tenant_id = ? OR a.dinas_luar = 1)' : ''}
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
      ${tenantId ? 'JOIN teacher_assignments ta ON t.id = ta.teacher_id' : ''}
      WHERE DATE(COALESCE(a.waktu_absen, a.waktu_scan)) = UTC_DATE() AND a.status = 'terlambat' ${tenantId ? 'AND (a.tenant_id = ? OR a.dinas_luar = 1)' : ''}
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

    let accountWithQuery = 'SELECT COUNT(DISTINCT t.id) as count FROM teachers t JOIN users u ON t.id = u.guru_id WHERE t.status_aktif = 1';
    let accountWithParams = [];
    if (tenantId) {
      accountWithQuery += ' AND EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.teacher_id = t.id AND ta.tenant_id = ?)';
      accountWithParams.push(tenantId);
    }
    const [teachersWithAccount] = await db.query(accountWithQuery, accountWithParams);

    let accountWithoutQuery = 'SELECT COUNT(DISTINCT t.id) as count FROM teachers t LEFT JOIN users u ON t.id = u.guru_id WHERE t.status_aktif = 1 AND u.id IS NULL';
    let accountWithoutParams = [];
    if (tenantId) {
      accountWithoutQuery += ' AND EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.teacher_id = t.id AND ta.tenant_id = ?)';
      accountWithoutParams.push(tenantId);
    }
    const [teachersWithoutAccount] = await db.query(accountWithoutQuery, accountWithoutParams);

    res.json({
      success: true,
      data: {
        totalTeachers: totalTeachers.count,
        activeToday: activeToday.count,
        lateToday: lateToday.count,
        totalLocations: totalLocations.count,
        teachersWithAccount: teachersWithAccount.count,
        teachersWithoutAccount: teachersWithoutAccount.count
      }
    });
  } catch (error) {
    console.error('Admin summary error:', error);
    res.status(500).json({ success: false, message: 'Error fetching summary' });
  }
});

// GET /api/admin/teacher-account-summary - Get list of teachers without accounts
router.get('/admin/teacher-account-summary', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;

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

    if (tenantId && !verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    let query = `
      SELECT t.id, t.nama, t.nik, t.nip, t.email, t.no_wa, t.status_kepegawaian,
             GROUP_CONCAT(DISTINCT CONCAT(ta.tenant_id, ':', ta.jabatan_di_unit, ':', tn.nama_sekolah)) as assignments
      FROM teachers t
      LEFT JOIN users u ON t.id = u.guru_id
      LEFT JOIN teacher_assignments ta ON t.id = ta.teacher_id
      LEFT JOIN tenants tn ON ta.tenant_id = tn.tenant_id
      WHERE t.status_aktif = 1 AND u.id IS NULL
    `;
    let params = [];

    if (tenantId) {
      query += ' AND EXISTS (SELECT 1 FROM teacher_assignments ta2 WHERE ta2.teacher_id = t.id AND ta2.tenant_id = ?)';
      params.push(tenantId);
    }

    query += ' GROUP BY t.id ORDER BY t.nama ASC';
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
    console.error('Teacher account summary error:', error);
    res.status(500).json({ success: false, message: 'Error fetching teacher account summary' });
  }
});

// POST /api/admin/send-email-no-account - Send email to teachers without accounts
router.post('/admin/send-email-no-account', authenticateOperator, async (req, res) => {
  try {
    const { teacher_ids, message } = req.body;

    if (!teacher_ids || !Array.isArray(teacher_ids) || teacher_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Pilih minimal satu guru' });
    }

    let tenantId = req.query.tenant_id;
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

    const placeholders = teacher_ids.map(() => '?').join(',');
    let query = `
      SELECT t.id, t.nama, t.email, t.no_wa
      FROM teachers t
      LEFT JOIN users u ON t.id = u.guru_id
      WHERE t.status_aktif = 1 AND u.id IS NULL AND t.id IN (${placeholders})
    `;
    let params = [...teacher_ids];

    if (tenantId) {
      query += ' AND EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.teacher_id = t.id AND ta.tenant_id = ?)';
      params.push(tenantId);
    }

    const teachers = await db.query(query, params);

    if (teachers.length === 0) {
      return res.status(404).json({ success: false, message: 'Tidak ada guru tanpa akun yang ditemukan' });
    }

    let sentCount = 0;
    let errorMessages = [];

    for (const teacher of teachers) {
      if (!teacher.email) {
        errorMessages.push(`${teacher.nama}: email tidak tersedia`);
        continue;
      }

      const customMessage = message || 'Akun sistem absensi Anda belum dibuat. Silakan hubungi admin untuk mengaktivasi akun Anda.';
      const htmlMessage = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aktivasi Akun - YPWI Lutim</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 20px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
    <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 30px; text-align: center;">
      <h1 style="margin: 0; color: white; font-size: 24px;">YPWI LUTIM</h1>
      <p style="margin: 5px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">Notifikasi Aktivasi Akun</p>
    </div>
    <div style="padding: 30px;">
      <h2 style="margin: 0 0 20px 0; color: #333; font-size: 20px;">⚠️ Akun Belum Aktif</h2>
      <p style="margin: 0 0 15px 0; color: #555; font-size: 16px; line-height: 1.6;">
        Assalamu'alaikum <strong>${teacher.nama}</strong>,
      </p>
      <p style="margin: 0 0 20px 0; color: #555; font-size: 16px; line-height: 1.6;">
        ${customMessage}
      </p>
      <p style="margin: 20px 0 0 0; color: #888; font-size: 14px;">Email ini dikirim otomatis oleh sistem. Silakan hubungi admin sekolah untuk proses aktivasi akun.</p>
    </div>
  </div>
</body>
</html>`;

      try {
        if (typeof global.sendEmail === 'function') {
          await global.sendEmail(teacher.email, 'Pemberitahuan Aktivasi Akun - YPWI Lutim', htmlMessage);
          sentCount++;
        } else {
          errorMessages.push(`${teacher.nama}: email tidak terkirim`);
        }
      } catch (emailError) {
        errorMessages.push(`${teacher.nama}: ${emailError.message}`);
      }
    }

    res.json({
      success: true,
      message: `Email berhasil dikirim ke ${sentCount} dari ${teachers.length} guru`,
      sentCount,
      totalCount: teachers.length,
      errors: errorMessages
    });
  } catch (error) {
    console.error('Send email no account error:', error);
    res.status(500).json({ success: false, message: 'Error sending email: ' + error.message });
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
        const roles = ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin', 'guru'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (adminAssignments.length === 1) {
        tenantId = adminAssignments[0].tenant_id;
      } else if (adminAssignments.length > 1) {
        tenantId = req.user.tenant_id || adminAssignments[0].tenant_id;
      }
    }

    // Fallback to user's primary tenant or first assignment
    if (!tenantId && req.user.role === 'guru') {
      tenantId = req.user.tenant_id || (req.user.assignments?.[0]?.tenant_id);
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
       s.class_id, s.tenant_id, c.nama_kelas, tn.nama_sekolah, p.nama_orang_tua, p.no_wa as no_wa_ortu
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

    query += ` ORDER BY (s.class_id IS NULL) DESC, ${sortField} ${sortDir} LIMIT ? OFFSET ?`;
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

// GET /api/admin/students/incomplete - Students with incomplete data (esp. parent data)
router.get('/admin/students/incomplete', authenticateOperator, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'tenant_id wajib diisi' });
    }
    if (req.user.role !== 'admin' && !verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
    }

    const query = `
      SELECT s.id, s.nama_siswa, s.nisn, s.nis, s.jenis_kelamin, s.iuran_bulanan,
             c.nama_kelas, tn.nama_sekolah,
             p.id as parent_id, p.nama_orang_tua, p.no_wa as no_wa_ortu
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE s.tenant_id = ?
        AND (
          s.parent_id IS NULL
          OR p.nama_orang_tua IS NULL OR p.nama_orang_tua = ''
          OR p.no_wa IS NULL OR p.no_wa = ''
          OR s.nisn IS NULL OR s.nisn = ''
          OR s.jenis_kelamin IS NULL OR s.jenis_kelamin = ''
          OR s.iuran_bulanan IS NULL
        )
      ORDER BY c.nama_kelas ASC, s.nama_siswa ASC
    `;
    const students = await db.query(query, [tenantId]);

    const formatted = students.map(s => {
      const missing = [];
      if (!s.parent_id || !s.nama_orang_tua) missing.push('Nama Orang Tua');
      if (!s.no_wa_ortu) missing.push('No. WA Orang Tua');
      if (!s.nisn) missing.push('NISN');
      if (!s.jenis_kelamin) missing.push('Jenis Kelamin');
      if (s.iuran_bulanan == null) missing.push('Iuran Bulanan');
      return { ...s, missing };
    });

    res.json({ success: true, data: formatted, total: formatted.length });
  } catch (error) {
    console.error('Admin incomplete students error:', error);
    res.status(500).json({ success: false, message: 'Error fetching incomplete students' });
  }
});

// GET /api/admin/students/incomplete/export - Export incomplete students as Excel
router.get('/admin/students/incomplete/export', authenticateOperator, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'tenant_id wajib diisi' });
    }
    if (req.user.role !== 'admin' && !verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
    }

    const students = await db.query(`
      SELECT s.id, s.nama_siswa, s.nisn, s.nis, s.jenis_kelamin, s.iuran_bulanan,
             c.nama_kelas, p.nama_orang_tua, p.no_wa as no_wa_ortu
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE s.tenant_id = ?
        AND (
          s.parent_id IS NULL
          OR p.nama_orang_tua IS NULL OR p.nama_orang_tua = ''
          OR p.no_wa IS NULL OR p.no_wa = ''
          OR s.nisn IS NULL OR s.nisn = ''
          OR s.jenis_kelamin IS NULL OR s.jenis_kelamin = ''
          OR s.iuran_bulanan IS NULL
        )
      ORDER BY c.nama_kelas ASC, s.nama_siswa ASC
    `, [tenantId]);

    const data = students.map(s => ({
      'ID Siswa': s.id,
      'Nama Siswa': s.nama_siswa || '',
      'NISN': s.nisn || '',
      'NIS': s.nis || '',
      'Kelas': s.nama_kelas || '',
      'Nama Orang Tua': s.nama_orang_tua || '',
      'No. WhatsApp': s.no_wa_ortu || '',
      'Jenis Kelamin': s.jenis_kelamin || '',
      'Iuran Bulanan': s.iuran_bulanan ?? ''
    }));

    const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ 'ID Siswa': '', 'Nama Siswa': '', 'NISN': '', 'NIS': '', 'Kelas': '', 'Nama Orang Tua': '', 'No. WhatsApp': '', 'Jenis Kelamin': '', 'Iuran Bulanan': '' }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Siswa Belum Lengkap');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const fileName = `siswa_belum_lengkap_${tenantId}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (error) {
    console.error('Export incomplete students error:', error);
    res.status(500).json({ success: false, message: 'Error export data siswa' });
  }
});

// GET /api/admin/students/export - Export ALL students as Excel for bulk editing
router.get('/admin/students/export', authenticateOperator, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'tenant_id wajib diisi' });
    }
    if (req.user.role !== 'admin' && !verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
    }

    const students = await db.query(`
      SELECT s.id, s.nama_siswa, s.nisn, s.nis, s.jenis_kelamin, s.iuran_bulanan,
             c.nama_kelas, p.nama_orang_tua, p.no_wa as no_wa_ortu
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE s.tenant_id = ?
      ORDER BY c.nama_kelas ASC, s.nama_siswa ASC
    `, [tenantId]);

    const data = students.map(s => ({
      'ID Siswa': s.id,
      'Nama Siswa': s.nama_siswa,
      'NISN': s.nisn || '',
      'NIS': s.nis || '',
      'Kelas': s.nama_kelas || '',
      'Nama Orang Tua': s.nama_orang_tua || '',
      'No. WhatsApp': s.no_wa_ortu || '',
      'Jenis Kelamin': s.jenis_kelamin || '',
      'Iuran Bulanan': s.iuran_bulanan ?? ''
    }));

    const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ 'ID Siswa': '', 'Nama Siswa': '', 'NISN': '', 'NIS': '', 'Kelas': '', 'Nama Orang Tua': '', 'No. WhatsApp': '', 'Jenis Kelamin': '', 'Iuran Bulanan': '' }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data Siswa');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const fileName = `data_siswa_${tenantId}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (error) {
    console.error('Export students error:', error);
    res.status(500).json({ success: false, message: 'Error export data siswa' });
  }
});

// POST /api/admin/students/incomplete/import - Import edited Excel to update students
router.post('/admin/students/incomplete/import', authenticateOperator, excelUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'File excel wajib diupload' });
    }
    const tenantId = req.body.tenant_id;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'tenant_id wajib diisi' });
    }
    if (req.user.role !== 'admin' && !verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    const errors = [];
    let updated = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNo = i + 2;
      const idVal = r['ID Siswa'];
      const id = parseInt(idVal);
      const namaSiswaRaw = String(r['Nama Siswa'] || '').trim();
      const noWa = String(r['No. WhatsApp'] || '').trim();

      let stu;
      if (id) {
        [stu] = await db.query('SELECT id, parent_id FROM students WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      } else if (namaSiswaRaw) {
        [stu] = await db.query('SELECT id, parent_id FROM students WHERE nama_siswa = ? AND tenant_id = ?', [namaSiswaRaw, tenantId]);
      }
      if (!stu) {
        const key = id || namaSiswaRaw;
        errors.push(`Baris ${rowNo}: Siswa "${key}" tidak ditemukan di tenant ini`);
        continue;
      }

      const namaOrangTua = String(r['Nama Orang Tua'] || '').trim() || null;
      const nisn = String(r['NISN'] || '').trim() || null;
      const nis = String(r['NIS'] || '').trim() || null;
      const jk = String(r['Jenis Kelamin'] || '').trim() || null;
      const iuranRaw = String(r['Iuran Bulanan'] || '').trim();
      const iuran = iuranRaw === '' ? null : parseFloat(iuranRaw);

      await db.query(
        'UPDATE students SET nisn = COALESCE(?, nisn), nis = COALESCE(?, nis), nama_siswa = COALESCE(?, nama_siswa), jenis_kelamin = COALESCE(?, jenis_kelamin), iuran_bulanan = COALESCE(?, iuran_bulanan) WHERE id = ?',
        [nisn, nis, namaSiswaRaw || null, jk, iuran, stu.id]
      );

      if (stu.parent_id) {
        await db.query(
          'UPDATE parents SET nama_orang_tua = COALESCE(?, nama_orang_tua), no_wa = COALESCE(?, no_wa) WHERE id = ?',
          [namaOrangTua, noWa || null, stu.parent_id]
        );
      } else {
        const ins = await db.query('INSERT INTO parents (nama_orang_tua, no_wa) VALUES (?, ?)', [namaOrangTua, noWa || null]);
        await db.query('UPDATE students SET parent_id = ? WHERE id = ?', [ins.insertId, stu.id]);
      }
      updated++;
    }

    res.json({ success: true, updated, errors, message: `${updated} siswa diperbarui` });
  } catch (error) {
    console.error('Import incomplete students error:', error);
    res.status(500).json({ success: false, message: 'Error import data siswa: ' + error.message });
  }
});

// GET /api/admin/students/all - List all students (no pagination)
router.get('/admin/students/all', authenticateOperator, async (req, res) => {
  try {
    const params = [];

    let query = `
      SELECT s.id, s.nama_siswa, s.nisn, s.nis, s.jenis_kelamin, s.iuran_bulanan,
             s.class_id, s.tenant_id, c.nama_kelas, tn.nama_sekolah, p.no_wa as no_wa_ortu
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE 1=1
    `;

    if (req.query.tenant_id) {
      query += ' AND s.tenant_id = ?';
      params.push(req.query.tenant_id);
    }
    
    query += ' ORDER BY tn.nama_sekolah ASC, s.nama_siswa ASC';
    
    const students = await db.query(query, params);
    res.json({ success: true, data: students });
  } catch (error) {
    console.error('Admin students all error:', error);
    res.status(500).json({ success: false, message: 'Error fetching students' });
  }
});

// POST /api/admin/students/:id/mutasi - Initiate student mutasi transfer
router.post('/admin/students/:id/mutasi', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { target_tenant_id, target_tenant_name, reason } = req.body;

    const [student] = await db.query('SELECT id, nama_siswa, tenant_id, class_id FROM students WHERE id = ?', [id]);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }

    const oldTenantId = student.tenant_id;
    let newTenantId = target_tenant_id;

    // If "Other" option selected with custom tenant name
    if (target_tenant_id === 'other' && target_tenant_name) {
      const [existingTenant] = await db.query('SELECT tenant_id FROM tenants WHERE tenant_id = ?', [target_tenant_name]);
      if (existingTenant) {
        newTenantId = existingTenant.tenant_id;
      } else {
        // Create new tenant
        await db.query(
          'INSERT INTO tenants (tenant_id, nama_sekolah) VALUES (?, ?)',
          [target_tenant_name, target_tenant_name]
        );
        newTenantId = target_tenant_name;
      }
    }

    if (!newTenantId) {
      return res.status(400).json({ success: false, message: 'Tujuan mutasi wajib diisi' });
    }

    // Record mutasi in mutasi_students table (for tracking)
    await db.query(
      'INSERT INTO mutasi_students (student_id, old_tenant_id, new_tenant_id, reason, created_at) VALUES (?, ?, ?, ?, NOW())',
      [id, oldTenantId, newTenantId, reason || null]
    );

    // Update student: set to new tenant, clear class_id
    // Try with mutasi_status column first, fallback without
    try {
      await db.query(
        'UPDATE students SET tenant_id = ?, class_id = NULL, mutasi_status = ? WHERE id = ?',
        [newTenantId, 'completed', id]
      );
    } catch (colError) {
      await db.query(
        'UPDATE students SET tenant_id = ?, class_id = NULL WHERE id = ?',
        [newTenantId, id]
      );
    }

    res.json({ success: true, message: `${student.nama_siswa} berhasil dimutasi ke ${newTenantId}` });
  } catch (error) {
    console.error('Student mutasi error:', error);
    res.status(500).json({ success: false, message: 'Error mutasi siswa: ' + error.message });
  }
});

// GET /api/admin/mutasi/students - List mutasi students (students with NULL class_id in this tenant)
router.get('/admin/mutasi/students', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    let query = `
      SELECT m.id as mutasi_id, m.student_id, m.old_tenant_id, m.new_tenant_id, m.reason, m.created_at,
             s.nama_siswa, s.nisn, s.nis, s.jenis_kelamin, s.iuran_bulanan, s.tenant_id,
             t.nama_sekolah as old_school, tn.nama_sekolah as new_school
      FROM mutasi_students m
      JOIN students s ON m.student_id = s.id
      LEFT JOIN tenants t ON m.old_tenant_id = t.tenant_id
      LEFT JOIN tenants tn ON m.new_tenant_id = tn.tenant_id
      WHERE s.class_id IS NULL
    `;
    let params = [];
    if (tenantId) {
      query += ' AND s.tenant_id = ?';
      params.push(tenantId);
    }
    query += ' ORDER BY m.created_at DESC';
    const mutasiList = await db.query(query, params);
    res.json({ success: true, data: mutasiList });
  } catch (error) {
    console.error('Get mutasi students error:', error);
    res.status(500).json({ success: false, message: 'Error fetching mutasi records' });
  }
});

// PUT /admin/students/:id/class - Assign class to mutasi student (finalize adoption)
router.put('/admin/students/:id/class', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { class_id } = req.body;
    if (!class_id) {
      return res.status(400).json({ success: false, message: 'class_id wajib diisi' });
    }
    await db.query('UPDATE students SET class_id = ? WHERE id = ?', [class_id, id]);
    await db.query('DELETE FROM mutasi_students WHERE student_id = ?', [id]);
    res.json({ success: true, message: 'Kelas siswa berhasil diset' });
  } catch (error) {
    console.error('Assign class error:', error);
    res.status(500).json({ success: false, message: 'Error assigning class' });
  }
});

// GET /api/admin/students/:id - Get single student by ID
router.get('/admin/students/:id', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const [student] = await db.query(
      'SELECT s.*, c.nama_kelas, tn.nama_sekolah, p.id as parent_id_ref, p.nama_orang_tua, p.no_wa as no_wa_ortu FROM students s LEFT JOIN classes c ON s.class_id = c.id LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id LEFT JOIN parents p ON s.parent_id = p.id WHERE s.id = ?',
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
    let query = 'SELECT id, tenant_id, nama_kelas, tingkatan FROM classes';
    let params = [];

    if (tenantId) {
      query += ' WHERE tenant_id = ?';
      params.push(tenantId);
    }

    query += ' ORDER BY CAST(tingkatan AS UNSIGNED) ASC, nama_kelas ASC';
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

// PUT /api/admin/students/:id - Update student (including parent data)
router.put('/admin/students/:id', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { tenant_id, nis, nisn, nama_siswa, jenis_kelamin, class_id, parent_id, iuran_bulanan, nama_orang_tua, no_wa } = req.body;

    if (!nis || !nama_siswa) {
      return res.status(400).json({ success: false, message: 'NIS dan nama siswa wajib diisi' });
    }

    // Resolve parent: use provided parent_id, or update/create parent from nama_orang_tua/no_wa
    let resolvedParentId = parent_id || null;
    if (!resolvedParentId && (nama_orang_tua || no_wa)) {
      const [existing] = await db.query('SELECT id FROM students WHERE id = ?', [id]);
      if (existing && existing.parent_id) {
        resolvedParentId = existing.parent_id;
        await db.query('UPDATE parents SET nama_orang_tua = COALESCE(?, nama_orang_tua), no_wa = COALESCE(?, no_wa) WHERE id = ?',
          [nama_orang_tua || null, no_wa || null, resolvedParentId]);
      } else {
        const ins = await db.query('INSERT INTO parents (nama_orang_tua, no_wa) VALUES (?, ?)', [nama_orang_tua || null, no_wa || null]);
        resolvedParentId = ins.insertId;
      }
    }

    const result = await db.query(
      'UPDATE students SET nis = ?, nisn = ?, nama_siswa = ?, jenis_kelamin = ?, class_id = ?, parent_id = ?, iuran_bulanan = ? WHERE id = ?',
      [nis, nisn || null, nama_siswa, jenis_kelamin, class_id || null, resolvedParentId, iuran_bulanan || 0, id]
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

// GET /api/admin/classes/:id - Get single class
router.get('/admin/classes/:id', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const [cls] = await db.query('SELECT * FROM classes WHERE id = ?', [id]);
    if (!cls) {
      return res.status(404).json({ success: false, message: 'Kelas tidak ditemukan' });
    }
    res.json({ success: true, data: cls });
  } catch (error) {
    console.error('Get class error:', error);
    res.status(500).json({ success: false, message: 'Error fetching class' });
  }
});

// PUT /api/admin/classes/:id - Update class
router.put('/admin/classes/:id', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { nama_kelas } = req.body;

    if (!nama_kelas) {
      return res.status(400).json({ success: false, message: 'nama_kelas wajib diisi' });
    }

    const result = await db.query('UPDATE classes SET nama_kelas = ? WHERE id = ?', [nama_kelas, id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Kelas tidak ditemukan' });
    }

    res.json({ success: true, message: 'Kelas berhasil diperbarui' });
  } catch (error) {
    console.error('Update class error:', error);
    res.status(500).json({ success: false, message: 'Error updating class' });
  }
});

// DELETE /api/admin/classes/:id - Delete class
router.delete('/admin/classes/:id', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if any students are in this class
    const students = await db.query('SELECT COUNT(*) as count FROM students WHERE class_id = ?', [id]);
    if (students[0].count > 0) {
      // Just remove class assignment from students instead of deleting
      await db.query('UPDATE students SET class_id = NULL WHERE class_id = ?', [id]);
    }

    const result = await db.query('DELETE FROM classes WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Kelas tidak ditemukan' });
    }

    res.json({ success: true, message: 'Kelas berhasil dihapus' });
  } catch (error) {
    console.error('Delete class error:', error);
    res.status(500).json({ success: false, message: 'Error deleting class' });
  }
});

// PUT /api/admin/students/bulk-promote - Bulk promote students to next class
router.put('/admin/students/bulk-promote', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    let { from_class_id, to_class_id, action, mappings } = req.body;

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

    // Support both single mapping and array of mappings
    let mappingList = [];
    if (mappings && Array.isArray(mappings) && mappings.length > 0) {
      mappingList = mappings;
    } else if (from_class_id && to_class_id) {
      mappingList = [{ from_class_id, to_class_id }];
    } else {
      return res.status(400).json({ success: false, message: 'from_class_id dan to_class_id wajib diisi, atau mappings harus berupa array' });
    }

    const results = [];
    for (const mapping of mappingList) {
      const { from_class_id: fromId, to_class_id: toId, action: mapAction } = mapping;

      if (!fromId) {
        results.push({ success: false, message: 'from_class_id wajib diisi' });
        continue;
      }

      // Verify source class belongs to the tenant
      const [fromClass] = await db.query('SELECT * FROM classes WHERE id = ? AND tenant_id = ?', [fromId, tenantId]);
      if (!fromClass) {
        results.push({ success: false, message: `Kelas asal (ID: ${fromId}) tidak ditemukan` });
        continue;
      }

      if (mapAction === 'graduate' || !toId) {
        // Graduate students (remove from active enrollment)
        try {
          await db.query(
            'UPDATE students SET class_id = NULL, status_lulus = 1, tanggal_lulus = NOW() WHERE class_id = ?',
            [fromId]
          );
        } catch (colError) {
          // Fallback: just remove class assignment
          await db.query(
            'UPDATE students SET class_id = NULL WHERE class_id = ?',
            [fromId]
          );
        }
        results.push({ success: true, message: `${fromClass.nama_kelas} berhasil diluluskan` });
      } else {
        // Verify target class belongs to the tenant
        const [toClass] = await db.query('SELECT * FROM classes WHERE id = ? AND tenant_id = ?', [toId, tenantId]);
        if (!toClass) {
          results.push({ success: false, message: `Kelas tujuan (ID: ${toId}) tidak ditemukan` });
          continue;
        }
        // Move students to target class
        const result = await db.query(
          'UPDATE students SET class_id = ? WHERE class_id = ?',
          [toId, fromId]
        );
        const count = result.affectedRows;
        results.push({ success: true, message: `${count} siswa dipindahkan ${fromClass.nama_kelas} → ${toClass.nama_kelas}` });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    const messages = results.map(r => r.message).join('; ');

    if (failCount === 0) {
      res.json({ success: true, message: messages });
    } else if (successCount > 0) {
      res.json({ success: true, message: `Sebagian berhasil: ${messages}` });
    } else {
      res.status(400).json({ success: false, message: messages });
    }
  } catch (error) {
    console.error('Bulk promote error:', error);
    res.status(500).json({ success: false, message: 'Error promoting students' });
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
    `;
    let params = [];

    if (searchTerm) {
      query += ' WHERE (t.nama LIKE ? OR t.nik LIKE ? OR t.nip LIKE ?)';
      params.push(`%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`);
    }

    query += ' GROUP BY t.id ORDER BY t.nama ASC';
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

// POST /api/search/teachers/:id/verify - Verify teacher identity before proceeding (public)
const normalizePhoneVerify = (val) => {
  if (!val) return '';
  let n = String(val).replace(/[^0-9]/g, '');
  if (n.startsWith('62')) n = '0' + n.slice(2);
  else if (n.startsWith('8')) n = '0' + n;
  return n;
};
router.post('/search/teachers/:id/verify', async (req, res) => {
  try {
    const { id } = req.params;
    const { type, value } = req.body;

    if (!type || !value) {
      return res.status(400).json({ success: false, message: 'Pilih jenis dan isi data verifikasi.' });
    }

    const [teacher] = await db.query(
      `SELECT t.id, t.nama, t.email, t.no_wa, t.nik, t.nip,
              EXISTS(SELECT 1 FROM users u WHERE u.guru_id = t.id) as has_user,
              (SELECT username FROM users u WHERE u.guru_id = t.id LIMIT 1) as user_email
       FROM teachers t WHERE t.id = ?`,
      [id]
    );

    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan.' });
    }

    const v = String(value).trim().toLowerCase();
    let match = false;
    if (type === 'email') {
      match = !!teacher.email && String(teacher.email).toLowerCase() === v;
    } else if (type === 'whatsapp') {
      match = !!teacher.no_wa && normalizePhoneVerify(teacher.no_wa) === normalizePhoneVerify(value);
    } else if (type === 'nik') {
      match = !!teacher.nik && String(teacher.nik).toLowerCase() === v;
    } else if (type === 'niy') {
      match = !!teacher.nip && String(teacher.nip).toLowerCase() === v;
    } else {
      return res.status(400).json({ success: false, message: 'Jenis verifikasi tidak valid.' });
    }

    if (!match) {
      return res.json({ success: false, message: 'Data yang Anda masukkan tidak cocok dengan data guru.' });
    }

    res.json({
      success: true,
      has_user: !!teacher.has_user,
      email: teacher.user_email || teacher.email,
      nama: teacher.nama
    });
  } catch (error) {
    console.error('Verify teacher error:', error);
    res.status(500).json({ success: false, message: 'Error verifikasi guru.' });
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

// ============================================================
// LEAVE REQUEST ADMIN ROUTES (for Ketua Yayasan / Kepala Sekolah)
// ============================================================

// GET /api/admin/leave-requests - List all leave requests with filtering
router.get('/admin/leave-requests', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    let statusFilter = req.query.status;
    
    // Operator: restrict to their tenant
    if (req.user.role !== 'admin' && !tenantId) {
      const adminAssignments = (req.user.assignments || []).filter(a => {
        const roles = ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin', 'kepala_sekolah'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (adminAssignments.length === 1) {
        tenantId = adminAssignments[0].tenant_id;
      }
    }
    
    let query = `
      SELECT lr.*, t.nama as teacher_name, ta.tenant_id, tn.nama_sekolah
      FROM leave_requests lr
      JOIN teachers t ON lr.teacher_id = t.id
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      JOIN tenants tn ON ta.tenant_id = tn.tenant_id
      WHERE 1=1
    `;
    let params = [];
    
    if (tenantId) {
      query += ' AND ta.tenant_id = ?';
      params.push(tenantId);
    }
    
    if (statusFilter && statusFilter !== 'all') {
      query += ' AND lr.status = ?';
      params.push(statusFilter);
    }
    
    query += ' ORDER BY lr.created_at DESC LIMIT 200';
    
    const requests = await db.query(query, params);
    res.json({ success: true, data: requests });
  } catch (error) {
    console.error('Admin leave requests error:', error);
    res.status(500).json({ success: false, message: 'Error fetching leave requests' });
  }
});

// PUT /api/admin/leave-requests/:id/status - Approve or reject leave request
router.put('/admin/leave-requests/:id/status', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, catatan } = req.body;
    
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status tidak valid' });
    }
    
    const result = await db.query(
      'UPDATE leave_requests SET status = ?, catatan = ?, updated_at = NOW() WHERE id = ?',
      [status, catatan || null, id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Permohonan izin tidak ditemukan' });
    }
    
    res.json({ success: true, message: `Permohonan izin berhasil ${status === 'approved' ? 'disetujui' : 'ditolak'}` });
  } catch (error) {
    console.error('Update leave request status error:', error);
    res.status(500).json({ success: false, message: 'Error updating leave request status' });
  }
});

// GET /api/teacher/info - Get current teacher info (nama, foto, assignments)
router.get('/teacher/info', authenticateToken, async (req, res) => {
  try {
    const [teacher] = await db.query(
      'SELECT t.id, t.nama, t.nik, t.nip, t.email, t.tempat_lahir, t.tanggal_lahir, t.jenis_kelamin, t.alamat, t.no_wa, t.status_kepegawaian, t.status_aktif, t.tmt, t.pendidikan_terakhir, t.bank, t.nomor_rekening, t.link_foto FROM teachers t WHERE t.id = ?',
      [req.user.guru_id]
    );

    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
    }

    const assignments = await db.query(
      'SELECT ta.tenant_id, ta.jabatan_di_unit, tn.nama_sekolah FROM teacher_assignments ta JOIN tenants tn ON ta.tenant_id = tn.tenant_id WHERE ta.teacher_id = ?',
      [req.user.guru_id]
    );

    res.json({
      success: true,
      teacher: {
        ...teacher,
        assignments: assignments || []
      },
      assignments: assignments || []
    });
  } catch (error) {
    console.error('Teacher info error:', error);
    res.status(500).json({ success: false, message: 'Error fetching teacher info' });
  }
});

// GET /api/admin/backup - Get backup history
router.get('/admin/backup', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const backups = await db.query(
      'SELECT id, filename, size, created_at, type FROM db_backups ORDER BY created_at DESC LIMIT 20'
    );
    res.json({ success: true, data: backups });
  } catch (error) {
    console.error('Backup history error:', error);
    res.status(500).json({ success: false, message: 'Error fetching backup history' });
  }
});

// POST /api/admin/backup - Create database backup
router.post('/admin/backup', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const fs = require('fs');
    const path = require('path');
    const { exec } = require('child_process');
    
    const backupDir = path.join(__dirname, '../../backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const filename = `backup-${Date.now()}.sql`;
    const filepath = path.join(backupDir, filename);
    
    const dbConfig = {
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD ? `-p${process.env.DB_PASSWORD}` : '',
      database: process.env.DB_NAME || 'ypwi_lutim'
    };

    const dumpCmd = `mysqldump -u${dbConfig.user} ${dbConfig.password} -h${dbConfig.host} ${dbConfig.database} > "${filepath}"`;
    
    exec(dumpCmd, (error) => {
      if (error) {
        // Fallback: generate simple SQL export for any environment
        const tables = ['teachers', 'tenants', 'attendance_logs', 'users', 'teacher_assignments', 'attendance_rules', 'leave_requests', 'evaluations', 'qr_attendance_logs', 'scanner_devices'];
        let sql = '-- YPWI Lutim Database Backup\n-- Generated: ' + new Date().toISOString() + '\n\n';
        
        tables.forEach(table => {
          sql += `-- Table: ${table}\nSELECT * FROM ${table};\n\n`;
        });
        
        fs.writeFileSync(filepath, sql);
      }
    });

    const stats = fs.statSync(filepath);
    
    await db.query(
      'INSERT INTO db_backups (filename, size, type, created_by) VALUES (?, ?, ?, ?)',
      [filename, stats.size, 'sql', req.user.id]
    );

    res.json({ 
      success: true, 
      message: 'Backup berhasil dibuat',
      downloadUrl: `/api/admin/backup/download/${filename}`
    });
  } catch (error) {
    console.error('Backup error:', error);
    res.status(500).json({ success: false, message: 'Error creating backup' });
  }
});

// GET /api/admin/backup/download/:filename - Download backup file
router.get('/admin/backup/download/:filename', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const fs = require('fs');
    const path = require('path');
    const filename = req.params.filename;
    const filepath = path.join(__dirname, '../../backups', filename);

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ success: false, message: 'File backup tidak ditemukan' });
    }

    res.download(filepath, filename);
  } catch (error) {
    console.error('Backup download error:', error);
    res.status(500).json({ success: false, message: 'Error downloading backup' });
  }
});

// POST /api/admin/restore - Restore database from backup
router.post('/admin/restore', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    res.json({ success: false, message: 'Restore manual via phpMyAdmin dianjurkan untuk keamanan data' });
  } catch (error) {
    console.error('Restore error:', error);
    res.status(500).json({ success: false, message: 'Error restoring backup' });
  }
});

// PUT /api/public/teachers/:teacherId - Update teacher profile (no auth required, for complete-profile.html)
router.put('/public/teachers/:teacherId', teacherUpload.single('foto'), async (req, res) => {
  try {
    const teacherId = req.params.teacherId;
    const { nama, nik, nip, email, tempat_lahir, tanggal_lahir, jenis_kelamin, alamat, no_wa, status_kepegawaian, status_aktif, tmt, pendidikan_terakhir, jurusan, nama_sekolah_pendidikan, tahun_angkatan, assignments_json, bank, nomor_rekening } = req.body;
    const foto = req.file ? `/uploads/${req.file.filename}` : null;

    // Get existing values if not provided (fields may be disabled in form)
    // Use graceful fallback for bank/nomor_rekening columns in case they don't exist yet
    let selectQuery = 'SELECT nama, nik, nip, email, tempat_lahir, tanggal_lahir, jenis_kelamin, alamat, no_wa, status_kepegawaian, status_aktif, tmt, pendidikan_terakhir';
    const selectParams = [];
    try {
      await db.query('SELECT bank, nomor_rekening FROM teachers LIMIT 1');
      selectQuery += ', bank, nomor_rekening';
    } catch (err) {
      // Columns don't exist, use fallback values
    }
    selectQuery += ' FROM teachers WHERE id = ?';
    selectParams.push(teacherId);
    const [existingTeacher] = await db.query(selectQuery, selectParams);

    // Use existing values as fallback
    const finalNama = nama || existingTeacher?.nama || null;
    const finalNik = nik || existingTeacher?.nik || null;
    const finalNip = nip || existingTeacher?.nip || null;
    const finalEmail = email || existingTeacher?.email || null;
    const finalTempatLahir = tempat_lahir || existingTeacher?.tempat_lahir || null;
    const finalTanggalLahir = tanggal_lahir || existingTeacher?.tanggal_lahir || null;
    const finalJenisKelamin = jenis_kelamin || existingTeacher?.jenis_kelamin || null;
    const finalAlamat = alamat || existingTeacher?.alamat || null;
    const finalNoWa = no_wa || existingTeacher?.no_wa || null;
    const finalStatusKepegawaian = status_kepegawaian || existingTeacher?.status_kepegawaian || null;
    const finalStatusAktif = status_aktif || existingTeacher?.status_aktif || null;
    const finalTmt = tmt || existingTeacher?.tmt || null;
    const finalBank = bank || existingTeacher?.bank || null;
    const finalNomorRekening = nomor_rekening || existingTeacher?.nomor_rekening || null;

    // Format pendidikan_terakhir string - handle all undefined
    let pendidikanFormatted = pendidikan_terakhir || null;
    if (pendidikan_terakhir && ['SMK', 'S1', 'S2', 'S3'].includes(pendidikan_terakhir)) {
      const parts = [pendidikan_terakhir];
      if (nama_sekolah_pendidikan) parts.push(nama_sekolah_pendidikan);
      if (jurusan) parts.push(jurusan);
      if (tahun_angkatan) parts.push(tahun_angkatan);
      pendidikanFormatted = parts.join('/') || null;
    } else if (pendidikan_terakhir && tahun_angkatan) {
      pendidikanFormatted = `${pendidikan_terakhir}/${tahun_angkatan}` || null;
    }

    // Ensure all params are not undefined
    const safeParams = {
      nama: finalNama,
      nik: finalNik,
      nip: finalNip,
      email: finalEmail,
      tempat_lahir: finalTempatLahir,
      tanggal_lahir: finalTanggalLahir,
      jenis_kelamin: finalJenisKelamin,
      alamat: finalAlamat,
      no_wa: finalNoWa,
      status_kepegawaian: finalStatusKepegawaian,
      status_aktif: finalStatusAktif,
      tmt: finalTmt,
      pendidikan_terakhir: pendidikanFormatted,
      bank: finalBank,
      nomor_rekening: finalNomorRekening
    };

    // Update teacher data - build query dynamically based on available columns
    let updateQuery = 'UPDATE teachers SET nama=?, nik=?, nip=?, email=?, tempat_lahir=?, tanggal_lahir=?, jenis_kelamin=?, alamat=?, no_wa=?, status_kepegawaian=?, status_aktif=?, tmt=?, pendidikan_terakhir=?';
    let updateParams = [safeParams.nama, safeParams.nik, safeParams.nip, safeParams.email, safeParams.tempat_lahir, safeParams.tanggal_lahir, safeParams.jenis_kelamin, safeParams.alamat, safeParams.no_wa, safeParams.status_kepegawaian, safeParams.status_aktif, safeParams.tmt, safeParams.pendidikan_terakhir];

    // Add bank and nomor_rekening if columns exist
    let bankExists = false;
    try {
      await db.query('SELECT bank FROM teachers LIMIT 1');
      bankExists = true;
      updateQuery += ', bank=?, nomor_rekening=?';
      updateParams.push(safeParams.bank, safeParams.nomor_rekening);
    } catch (err) {
      // Columns don't exist, skip
    }

    if (foto) {
      updateQuery += ', link_foto=?';
      updateParams.push(foto);
    }
    updateQuery += ' WHERE id=?';
    updateParams.push(teacherId);

    await db.query(updateQuery, updateParams);

    // Clear existing assignments
    await db.query('DELETE FROM teacher_assignments WHERE teacher_id = ?', [teacherId]);

    // Insert new assignments - only if assignments_json exists and has content
    if (assignments_json && assignments_json !== '') {
      try {
        const assignments = typeof assignments_json === 'string' ? JSON.parse(assignments_json) : assignments_json;
        if (Array.isArray(assignments)) {
          for (const a of assignments) {
            await db.query(
              'INSERT INTO teacher_assignments (teacher_id, tenant_id, jabatan_di_unit) VALUES (?, ?, ?)',
              [teacherId, a.tenant_id || null, a.jabatan_di_unit || null]
            );
          }
        }
      } catch (parseErr) {
        console.error('Assignments parse error:', parseErr);
      }
    }

    // Create user account if not exists
    const existingUser = await db.query('SELECT id FROM users WHERE guru_id = ?', [teacherId]);
    const isNewUser = existingUser.length === 0;
    if (isNewUser && email) {
      const defaultPassword = 'ypwi123';
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash(defaultPassword, 10);
      
      await db.query(
        'INSERT INTO users (username, password, guru_id, role, is_profile_complete, is_default_password) VALUES (?, ?, ?, ?, 1, 1)',
        [email, hashedPassword, teacherId, 'guru']
      );
    } else if (existingUser.length > 0) {
      // Update existing user to mark profile complete
      await db.query('UPDATE users SET is_profile_complete = 1 WHERE guru_id = ?', [teacherId]);
    }

    // Send email notification for profile completion
    if (email) {
      const passwordText = isNewUser ? 'ypwi123 (ganti segera)' : 'sesuai password sebelumnya';
      const htmlMessage = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Profil Selesai - YPWI Lutim</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 20px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
    <div style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); padding: 30px; text-align: center;">
      <h1 style="margin: 0; color: white; font-size: 24px;">YPWI LUTIM</h1>
      <p style="margin: 5px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">Notifikasi Profil</p>
    </div>
    <div style="padding: 30px;">
      <h2 style="margin: 0 0 20px 0; color: #333; font-size: 20px;">✅ Profil Akun Selesai Diisi</h2>
      <p style="margin: 0 0 15px 0; color: #555; font-size: 16px; line-height: 1.6;">
        Assalamu'alaikum <strong>${nama || 'Guru'}</strong>,
      </p>
      <p style="margin: 0 0 20px 0; color: #555; font-size: 16px; line-height: 1.6;">
        Profil akun YPWI Lutim Anda telah berhasil dilengkapi.
      </p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Username:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: 600;">${email}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Password:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: 600;">${passwordText}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Tanggal:</td><td style="padding: 8px 0; font-weight: 600;">${new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</td></tr>
      </table>
      <p style="margin: 20px 0 0 0; color: #888; font-size: 14px;">Email ini dikirim otomatis oleh sistem. Silakan login dengan password di atas.</p>
    </div>
  </div>
</body>
</html>`;

      if (typeof global.sendEmail === 'function') {
        await global.sendEmail(email, 'Profil Akun Aktif - YPWI Lutim', htmlMessage);
      }
    }

    // Return teacher data for WhatsApp notification (handled by frontend)
    res.json({ success: true, message: 'Profil berhasil diperbarui', email, nama, no_wa });
  } catch (error) {
    console.error('Public teacher update error:', error);
    res.status(500).json({ success: false, message: 'Error updating teacher profile' });
  }
});

router.get('/public/teachers/:teacherId', async (req, res) => {
  try {
    const [teacher] = await db.query(
      'SELECT t.id, t.nama, t.nik, t.nip, t.email, t.tempat_lahir, t.tanggal_lahir, t.jenis_kelamin, t.alamat, t.no_wa, t.status_kepegawaian, t.status_aktif, t.tmt, t.pendidikan_terakhir, t.BANK as bank, t.nomor_rekening, t.link_foto, GROUP_CONCAT(CONCAT(ta.tenant_id, ":", ta.jabatan_di_unit)) as assignments FROM teachers t LEFT JOIN teacher_assignments ta ON t.id = ta.teacher_id WHERE t.id = ?',
      [req.params.teacherId]
    );

    if (!teacher || teacher.length === 0) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
    }

    // Format assignments
    const formattedTeacher = {
      ...teacher,
      assignments: teacher.assignments ? teacher.assignments.split(',').map(a => {
        const [tenant_id, jabatan] = a.split(':');
        return { tenant_id, jabatan_di_unit: jabatan };
      }) : []
    };

    res.json({ success: true, data: formattedTeacher });
  } catch (error) {
    console.error('Public teacher error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/send-whatsapp-public - Send WhatsApp notification (public endpoint for complete-profile)
router.post('/send-whatsapp-public', async (req, res) => {
  try {
    const { number, message } = req.body;
    
    if (!number || !message) {
      return res.status(400).json({ success: false, message: 'Number and message required' });
    }
    
    if (typeof global.sendWhatsAppMessage === 'function') {
      await global.sendWhatsAppMessage(number, message);
    }
    
    res.json({ success: true, message: 'WhatsApp sent' });
  } catch (error) {
    console.error('WhatsApp public error:', error);
    res.status(500).json({ success: false, message: 'Error sending WhatsApp' });
  }
});

// PUT /api/admin/tenants/:tenantId/bank - Update bank account for tenant
router.put('/admin/tenants/:tenantId/bank', authenticateOperator, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { bank_account_number, bank_account_name } = req.body;
    
    // Verify tenant access for non-admin
    if (!verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
    
    await db.query(
      'UPDATE tenants SET bank_account_number = ?, bank_account_name = ? WHERE tenant_id = ?',
      [bank_account_number || null, bank_account_name || null, tenantId]
    );
    
    res.json({ success: true, message: 'Rekening bank berhasil disimpan' });
  } catch (error) {
    console.error('Update bank error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/admin/send-whatsapp-bill-bulk - Send bill template to all students in tenant
router.post('/admin/send-whatsapp-bill-bulk/:tenantId', authenticateOperator, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { bulan, tanggal_jatuh_tempo } = req.body;
    
    // Verify tenant access
    if (!verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
    
    // Get tenant bank info
    const [tenant] = await db.query('SELECT bank_account_number, bank_account_name FROM tenants WHERE tenant_id = ?', [tenantId]);
    
    // Get students with parent WA
    const students = await db.query(`
      SELECT s.id, s.nama_siswa, s.iuran_bulanan, p.no_wa as parent_wa
      FROM students s
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE s.tenant_id = ? AND p.no_wa IS NOT NULL AND p.no_wa != ''
    `, [tenantId]);
    
    const { sendBillTemplate } = require('../utils/whatsappTemplate');
    let success = 0, failed = 0;
    
    for (const student of students) {
      try {
        if (!student.parent_wa) continue;
        
        const result = await sendBillTemplate(student.parent_wa, {
          nama_siswa: student.nama_siswa,
          bulan: bulan || new Date().toLocaleString('id-ID', { month: 'long' }),
          jumlah_tagihan: `Rp ${(student.iuran_bulanan || 0).toLocaleString('id-ID')}`,
          tanggal_jatuh_tempo: tanggal_jatuh_tempo || '10',
          nomor_rekening: tenant?.bank_account_number || '',
          nama_penerima: tenant?.bank_account_name || ''
        });
        
        success++;
      } catch (err) {
        console.error('Bill send failed for', student.nama_siswa, err.message);
        failed++;
      }
    }
    
    res.json({ success: true, message: `Terkirim: ${success}, Gagal: ${failed}`, data: { success, failed } });
  } catch (error) {
    console.error('Bill bulk error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/admin/send-whatsapp-bill-bulk - Send bill template to all students in tenant
router.post('/admin/send-whatsapp-bill-bulk/:tenantId', authenticateOperator, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { bulan, tanggal_jatuh_tempo } = req.body;
    
    // Verify tenant access
    if (!verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
    
    // Get tenant bank info
    const [tenant] = await db.query('SELECT bank_account_number, bank_account_name FROM tenants WHERE tenant_id = ?', [tenantId]);
    
    // Get students with parent WA
    const students = await db.query(`
      SELECT s.id, s.nama_siswa, s.iuran_bulanan, p.no_wa as parent_wa
      FROM students s
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE s.tenant_id = ? AND p.no_wa IS NOT NULL AND p.no_wa != ''
    `, [tenantId]);
    
    const { sendBillTemplate } = require('../utils/whatsappTemplate');
    let success = 0, failed = 0;
    
    for (const student of students) {
      try {
        if (!student.parent_wa) continue;
        
        const result = await sendBillTemplate(student.parent_wa, {
          nama_siswa: student.nama_siswa,
          bulan: bulan || new Date().toLocaleString('id-ID', { month: 'long' }),
          jumlah_tagihan: `Rp ${(student.iuran_bulanan || 0).toLocaleString('id-ID')}`,
          tanggal_jatuh_tempo: tanggal_jatuh_tempo || '10',
          nomor_rekening: tenant?.bank_account_number || '',
          nama_penerima: tenant?.bank_account_name || ''
        });
        
        success++;
      } catch (err) {
        console.error('Bill send failed for', student.nama_siswa, err.message);
        failed++;
      }
    }
    
    res.json({ success: true, message: `Terkirim: ${success}, Gagal: ${failed}`, data: { success, failed } });
  } catch (error) {
    console.error('Bill bulk error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/bill-settings - Get bill notification settings
router.get('/admin/bill-settings', authenticateOperator, async (req, res) => {
  try {
    const settings = await db.query('SELECT send_day, due_day, is_enabled FROM bill_settings LIMIT 1');
    res.json({ success: true, data: settings[0] || { send_day: 1, due_day: 10, is_enabled: 0 } });
  } catch (error) {
    console.error('Bill settings error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/admin/bill-settings - Update bill notification settings
router.put('/admin/bill-settings', authenticateOperator, async (req, res) => {
  try {
    const { send_day, due_day, is_enabled } = req.body;
    
    await db.query(`
      CREATE TABLE IF NOT EXISTS bill_settings (
        id INT PRIMARY KEY,
        send_day INT DEFAULT 1,
        due_day INT DEFAULT 10,
        is_enabled TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    
    await db.query(
      'INSERT INTO bill_settings (id, send_day, due_day, is_enabled) VALUES (1, ?, ?, ?) ON DUPLICATE KEY UPDATE send_day = VALUES(send_day), due_day = VALUES(due_day), is_enabled = VALUES(is_enabled)',
      [send_day || 1, due_day || 10, is_enabled ? 1 : 0]
    );
    
    res.json({ success: true, message: 'Pengaturan berhasil disimpan' });
  } catch (error) {
    console.error('Bill settings update error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// WhatsApp Broadcast Messenger Routes
// POST /api/admin/send-bill-template - Send single bill template
router.post('/admin/send-bill-template', authenticateOperator, async (req, res) => {
  try {
    const { student_id, template_name, bulan, tanggal_jatuh_tempo } = req.body;
    
    if (!student_id) {
      return res.status(400).json({ success: false, message: 'Siswa wajib dipilih' });
    }

    const [student] = await db.query(`
      SELECT s.nama_siswa, s.iuran_bulanan, p.no_wa as parent_wa, s.tenant_id
      FROM students s
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE s.id = ?
    `, [student_id]);

    if (!student || !student.parent_wa) {
      return res.status(404).json({ success: false, message: 'Siswa atau nomor WA orang tua tidak ditemukan' });
    }

    const [tenant] = await db.query('SELECT bank_account_number, bank_account_name FROM tenants WHERE tenant_id = ?', [student.tenant_id]);

    // Cek invoice Xendit aktif untuk bulan ini
    const periode = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
    const [invoice] = await db.query(
      'SELECT external_id, invoice_url, description FROM xendit_invoices WHERE student_id = ? AND status = "PENDING" ORDER BY created_at DESC LIMIT 1',
      [student_id]
    );

    const { sendBillTemplate } = require('../utils/whatsappTemplate');
    const result = await sendBillTemplate(student.parent_wa, {
      nama_siswa: student.nama_siswa,
      bulan: bulan || new Date().toLocaleString('id-ID', { month: 'long' }),
      jumlah_tagihan: `Rp ${(student.iuran_bulanan || 0).toLocaleString('id-ID')}`,
      tanggal_jatuh_tempo: tanggal_jatuh_tempo || '10',
      nomor_rekening: tenant?.bank_account_number || '',
      nama_penerima: tenant?.bank_account_name || '',
      invoice_url: invoice?.invoice_url || '',
      nama_pembayaran: invoice?.description || ''
    }, template_name);

    res.json({ success: true, message: 'Tagihan terkirim', messageId: result.messageId });
  } catch (error) {
    console.error('Send bill template error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/admin/bulk-bill - Send bill template to all students in tenant
router.post('/admin/bulk-bill', authenticateOperator, async (req, res) => {
  try {
    const { bulan, tanggal_jatuh_tempo, tenant_ids, template_name } = req.body;
    
    let query = `
      SELECT s.id, s.nama_siswa, s.iuran_bulanan, p.no_wa as parent_wa, s.tenant_id
      FROM students s
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE p.no_wa IS NOT NULL AND p.no_wa != ''
    `;
    let params = [];
    
    if (tenant_ids && tenant_ids.length > 0) {
      const placeholders = tenant_ids.map(() => '?').join(',');
      query += ` AND s.tenant_id IN (${placeholders})`;
      params = [...params, ...tenant_ids];
    }

    const students = await db.query(query, params);
    
    const { sendBillTemplate } = require('../utils/whatsappTemplate');
    let success = 0, failed = 0;
    
    for (const student of students) {
      try {
        if (!student.parent_wa) continue;
        
        const [tenant] = await db.query('SELECT bank_account_number, bank_account_name FROM tenants WHERE tenant_id = ?', [student.tenant_id]);

        // cari invoice Xendit pending untuk siswa ini
        const [inv] = await db.query('SELECT external_id, invoice_url, description FROM xendit_invoices WHERE student_id = ? AND status = "PENDING" ORDER BY created_at DESC LIMIT 1', [student.id]);

        const result = await sendBillTemplate(student.parent_wa, {
          nama_siswa: student.nama_siswa,
          bulan: bulan || new Date().toLocaleString('id-ID', { month: 'long' }),
          jumlah_tagihan: `Rp ${(student.iuran_bulanan || 0).toLocaleString('id-ID')}`,
          tanggal_jatuh_tempo: tanggal_jatuh_tempo || '10',
          nomor_rekening: tenant?.bank_account_number || '',
          nama_penerima: tenant?.bank_account_name || '',
          invoice_url: inv?.invoice_url || '',
          nama_pembayaran: inv?.description || ''
        }, template_name);
        
        success++;
      } catch (err) {
        console.error('Bill send failed for', student.nama_siswa, err.message);
        failed++;
      }
    }
    
    res.json({ success: true, message: `Terkirim: ${success}, Gagal: ${failed}`, data: { success, failed } });
  } catch (error) {
    console.error('Bill bulk error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/admin/teachers/send-whatsapp - Send WhatsApp message to teachers (guru)
router.post('/admin/teachers/send-whatsapp', authenticateOperator, async (req, res) => {
  try {
    const { message, teacher_ids, all } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Pesan tidak boleh kosong' });
    }

    let teachers;
    if (all) {
      teachers = await db.query(
        "SELECT t.id, t.nama, t.no_wa FROM teachers t WHERE t.status_aktif = 1 AND t.no_wa IS NOT NULL AND t.no_wa != ''"
      );
    } else if (Array.isArray(teacher_ids) && teacher_ids.length > 0) {
      const placeholders = teacher_ids.map(() => '?').join(',');
      teachers = await db.query(
        `SELECT t.id, t.nama, t.no_wa FROM teachers t WHERE t.id IN (${placeholders}) AND t.no_wa IS NOT NULL AND t.no_wa != ''`,
        teacher_ids
      );
    } else {
      return res.status(400).json({ success: false, message: 'Pilih minimal satu guru' });
    }

    let success = 0, failed = 0, skipped = 0;
    const errors = [];
    for (const teacher of teachers) {
      if (!teacher.no_wa) { skipped++; continue; }
      try {
        const result = await global.sendWhatsAppMessage(teacher.no_wa, message);
        if (result && result.success) success++;
        else { failed++; errors.push(`${teacher.nama}: ${result?.message || 'gagal'}`); }
      } catch (err) {
        failed++; errors.push(`${teacher.nama}: ${err.message}`);
      }
    }

    res.json({
      success: true,
      message: `Terkirim: ${success}, Gagal: ${failed}, Dilewati: ${skipped}`,
      data: { success, failed, skipped, errors: errors.slice(0, 10) }
    });
  } catch (error) {
    console.error('Teacher WhatsApp error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/whatsapp-broadcast/status - Check WhatsApp connection status
router.get('/whatsapp-broadcast/status', authenticateOperator, async (req, res) => {
  try {
    // Check if Redis/MQ service exists
    const redisUrl = process.env.REDIS_URL || process.env.WAHA_API_URL;
    const connected = !!redisUrl;
    
    res.json({ 
      success: true, 
      connected: connected,
      service: redisUrl ? 'Waha/MQ' : 'Meta API'
    });
  } catch (error) {
    res.json({ success: true, connected: false, service: 'Meta API' });
  }
});

// GET /api/admin/whatsapp-meta-templates - Fetch WhatsApp templates from Meta API
router.get('/admin/whatsapp-meta-templates', authenticateOperator, async (req, res) => {
  try {
    const result = await fetchMetaTemplates();
    res.json(result);
  } catch (error) {
    console.error('Meta WhatsApp templates error:', error);
    res.status(500).json({ success: false, message: error.message || 'Gagal mengambil template dari Meta' });
  }
});

// GET /api/admin/attendance-monthly - Monthly attendance recap (pivoted by date)
router.get('/admin/attendance-monthly', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    const bulan = parseInt(req.query.bulan || new Date().getMonth() + 1);
    const tahun = parseInt(req.query.tahun || new Date().getFullYear());
    if (!tenantId && req.user.role !== 'admin') {
      const assignments = (req.user.assignments || []).filter(a =>
        ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'].includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''))
      );
      if (assignments.length >= 1) tenantId = assignments[0].tenant_id;
    }
    if (!tenantId) return res.json({ success: false, message: 'tenant_id diperlukan' });
    
    const teachers = await db.query(
      'SELECT t.id, t.nama FROM teachers t WHERE t.id IN (SELECT teacher_id FROM teacher_assignments WHERE tenant_id = ?)',
      [tenantId]
    );
    
    const logs = await db.query(
      'SELECT al.teacher_id, DAY(al.waktu_scan) as hari, al.status, al.dinas_luar, al.keterangan, al.waktu_scan FROM attendance_logs al WHERE MONTH(al.waktu_scan) = ? AND YEAR(al.waktu_scan) = ? AND al.teacher_id IN (SELECT teacher_id FROM teacher_assignments WHERE tenant_id = ?)',
      [bulan, tahun, tenantId]
    );
    
    const daysInMonth = new Date(tahun, bulan, 0).getDate();
    const weekendDays = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(tahun, bulan - 1, d);
      if (date.getDay() === 0 || date.getDay() === 6) weekendDays.push(d);
    }
    
    const result = teachers.map(t => {
      const row = { id: t.id, nama: t.nama };
      for (let d = 1; d <= daysInMonth; d++) row['tgl_' + d] = '';
      let hadir = 0, terlambat = 0, izin = 0, cuti = 0, dinas_luar = 0, sakit = 0;
      logs.filter(l => l.teacher_id === t.id).forEach(l => {
        const day = parseInt(l.hari);
        if (day >= 1 && day <= daysInMonth) {
          const date = new Date(tahun, bulan - 1, day);
          const isWeekend = date.getDay() === 0 || date.getDay() === 6;
          if (l.status === 'tepat_waktu') { row['tgl_' + day] = '<span class="text-green-600 font-bold">H</span>'; hadir++; }
          else if (l.status === 'terlambat') { row['tgl_' + day] = '<span class="text-yellow-600 font-bold">T</span>'; terlambat++; }
          else if (l.dinas_luar) { row['tgl_' + day] = '<span class="text-blue-600 font-bold">DL</span>'; dinas_luar++; }
          else if (l.keterangan && l.keterangan.toLowerCase().includes('izin')) { row['tgl_' + day] = '<span class="text-purple-600 font-bold">I</span>'; izin++; }
          else if (l.keterangan && l.keterangan.toLowerCase().includes('cuti')) { row['tgl_' + day] = '<span class="text-gray-600 font-bold">C</span>'; cuti++; }
          else if (l.keterangan && l.keterangan.toLowerCase().includes('sakit')) { row['tgl_' + day] = '<span class="text-red-600 font-bold">S</span>'; sakit++; }
          if (isWeekend && !row['tgl_' + day]) {
            row['tgl_' + day] = '<span class="text-gray-400">-</span>';
          }
        }
      });
      row.hadir = hadir; row.terlambat = terlambat; row.izin = izin; row.cuti = cuti; row.dinas_luar = dinas_luar; row.sakit = sakit;
      row.weekendDays = weekendDays;
      const totalActiveDays = daysInMonth - weekendDays.length;
      row.tanpa_keterangan = totalActiveDays - (hadir + terlambat + izin + cuti + dinas_luar + sakit);
      return row;
    });
    
    res.json({ success: true, data: result, daysInMonth });
  } catch (error) {
    console.error('Monthly attendance error:', error);
  }
});

// GET /api/admin/tenant-principal - Get principal name for tenant
router.get('/admin/tenant-principal', authenticateOperator, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    if (!tenantId) return res.json({ success: false, message: 'tenant_id required' });
    const principal = await db.query('SELECT t.nama, t.nik, ta.jabatan_di_unit FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id WHERE ta.tenant_id = ? AND LOWER(ta.jabatan_di_unit) LIKE ?', [tenantId, '%kepala sekolah%']);
    if (principal.length) return res.json({ success: true, nama: principal[0].nama, jabatan: principal[0].jabatan_di_unit, nik: principal[0].nik || '-' });
    const ketua = await db.query('SELECT t.nama, t.nik, ta.jabatan_di_unit FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id WHERE ta.tenant_id = ? AND LOWER(ta.jabatan_di_unit) LIKE ?', [tenantId, '%ketua%']);
    if (ketua.length) return res.json({ success: true, nama: ketua[0].nama, jabatan: ketua[0].jabatan_di_unit, nik: ketua[0].nik || '-' });
    return res.json({ success: true, nama: 'Pimpinan', jabatan: 'Pimpinan' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/admin/bendahara - Get bendahara name for tenant
router.get('/admin/bendahara', authenticateOperator, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    if (!tenantId) return res.json({ success: false, message: 'tenant_id required' });
    const bendahara = await db.query('SELECT t.nama, t.nik FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id WHERE ta.tenant_id = ? AND LOWER(ta.jabatan_di_unit) LIKE ?', [tenantId, '%bendahara%']);
    if (bendahara.length) return res.json({ success: true, nama: bendahara[0].nama, nik: bendahara[0].nik || '-' });
    return res.json({ success: true, nama: '-', nik: '-' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;