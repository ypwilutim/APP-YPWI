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
const { extractKTPFromImage } = require('../utils/geminiOcr');

// Helper: Normalize WhatsApp number (082... → 6282...)
function normalizeWhatsAppNumber(noWa) {
  if (!noWa) return noWa;
  let num = String(noWa).trim();
  // Remove spaces, dashes, dots
  num = num.replace(/[\s\-\.]/g, '');
  // Convert 08... to 628...
  if (num.startsWith('0')) {
    num = '62' + num.substring(1);
  }
  // Convert +62 to 62
  if (num.startsWith('+62')) {
    num = '62' + num.substring(3);
  }
  return num;
}

const router = express.Router();
const XLSX = require('xlsx');
const billing = require('../utils/billing');
const { monthList } = billing;

// Ensure students table has required columns (auto-migrate)
async function ensureStudentColumns() {
  const columns = [
    { name: 'ransportasi', type: 'decimal(10,2) DEFAULT 0.00', after: 'iuran_bulanan' },
    { name: 'subsidi', type: 'decimal(10,2) DEFAULT 0.00', after: 'ransportasi' },
    { name: 'privat', type: 'decimal(10,2) DEFAULT 0.00', after: 'subsidi' },
    { name: 'biaya_lain', type: 'decimal(10,2) DEFAULT 0.00', after: 'privat' },
    { name: 'biaya_lain_nama', type: 'varchar(255) DEFAULT NULL', after: 'biaya_lain' },
    { name: 'tahun_masuk', type: 'varchar(10) DEFAULT NULL', after: 'jenis_kelamin' },
    { name: 'status', type: "varchar(20) DEFAULT 'aktif'", after: 'tahun_masuk' }
  ];

  for (const col of columns) {
    try {
      await db.query(`ALTER TABLE students ADD COLUMN ${col.name} ${col.type}`);
    } catch (e) {
      // Column already exists, ignore error
      if (e.code !== 'ER_DUP_FIELDNAME') {
        // Try to add after specific column if it exists
        try {
          await db.query(`ALTER TABLE students ADD COLUMN ${col.name} ${col.type} AFTER ${col.after}`);
        } catch (e2) {
          // Ignore if column already exists in any position
          if (e2.code !== 'ER_DUP_FIELDNAME') {
            console.error(`[ensureStudentColumns] Error adding ${col.name}:`, e2.message);
          }
        }
      }
    }
  }
}

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

const accessRequestStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/access-requests/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'access-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const accessRequestUpload = multer({
  storage: accessRequestStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 2 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Hanya file gambar yang diperbolehkan'));
    }
    cb(null, true);
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

const berkasUpload = multer({
  storage: teacherStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 4 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.pdf'];
    const fileExtension = path.extname(file.originalname).toLowerCase();
    if (!allowedMimes.includes(file.mimetype) && !allowedExtensions.includes(fileExtension)) {
      return cb(new Error('Format file harus JPG, PNG, atau PDF'));
    }
    cb(null, true);
  }
});

const registrationStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/registrations/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'reg-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const registrationUpload = multer({
  storage: registrationStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 4 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.pdf'];
    const fileExtension = path.extname(file.originalname).toLowerCase();
    if (!allowedMimes.includes(file.mimetype) && !allowedExtensions.includes(fileExtension)) {
      return cb(new Error('Format file harus JPG, PNG, atau PDF'));
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
    let tenantId = req.query.tenant_id;
    // Jika tenant_id tidak diberikan, pakai dari user atau assignments
    if (!tenantId) {
      tenantId = req.user.tenant_id || (req.user.assignments && req.user.assignments[0] && req.user.assignments[0].tenant_id);
    }
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
    // Admin bisa lihat semua, guru hanya lihat tenant mereka
    if (tenantId && req.user.role !== 'admin') {
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

// GET /api/admin/rules - List attendance rules (tenant-specific or central)
router.get('/admin/rules', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    const central = req.query.central; // '1' untuk ambil aturan pusat

    // Ambil tipe_unit user (untuk aturan pusat)
    let userTipeUnit = null;
    if (req.user.assignments && req.user.assignments[0]) {
      userTipeUnit = req.user.assignments[0].tipe_unit || null;
    }

    let query = 'SELECT * FROM attendance_rules';
    let params = [];

    if (central === '1') {
      // Aturan pusat global (tenant_id IS NULL), filter berdasarkan tipe_unit user
      query += ' WHERE tenant_id IS NULL';
      if (userTipeUnit) {
        query += ' AND tipe_unit = ?';
        params.push(userTipeUnit);
      }
    } else if (tenantId) {
      // Aturan tenant spesifik
      query += ' WHERE tenant_id = ?';
      params.push(tenantId);
    } else {
      // Default: aturan tenant user (legacy)
      tenantId = req.user.tenant_id || (req.user.assignments && req.user.assignments[0] && req.user.assignments[0].tenant_id);
      if (tenantId) {
        query += ' WHERE tenant_id = ?';
        params.push(tenantId);
      } else if (req.user.role !== 'admin') {
        return res.status(400).json({ success: false, message: 'Tenant ID tidak ditemukan untuk user ini.' });
      }
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



















































































































































// POST /api/admin/rules - Create rule (tenant-specific or central)
router.post('/admin/rules', authenticateOperator, async (req, res) => {
  try {
    const { tenant_id, tipe_unit, tipe, jam_mulai, jam_selesai, keterangan, status_log, hari } = req.body;

    // Aturan pusat: tenant_id null + tipe_unit wajib
    if (!tenant_id && tipe_unit) {
      // Validasi akses: user harus punya akses pusat (YPWILUTIM)
      const hasCentralAccess = req.user.assignments?.some(a => a.tenant_id === 'YPWILUTIM');
      if (!hasCentralAccess) {
        return res.status(403).json({ success: false, message: 'Hanya admin pusat yang boleh membuat aturan global' });
      }
    } else if (!tenant_id && !tipe_unit) {
      return res.status(400).json({ success: false, message: 'tenant_id atau tipe_unit wajib diisi' });
    } else if (!verifyTenantAccess(req, tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    if (!tipe || !jam_mulai || !jam_selesai || !status_log) {
      return res.status(400).json({ success: false, message: 'Semua field wajib diisi' });
    }

    if (!['Datang', 'Pulang'].includes(tipe)) {
      return res.status(400).json({ success: false, message: 'Tipe harus Datang atau Pulang' });
    }
    if (!['tepat_waktu', 'terlambat', 'pulang_cepat', 'lembur'].includes(status_log)) {
      return res.status(400).json({ success: false, message: 'Status log tidak valid' });
    }

    await db.query(
      'INSERT INTO attendance_rules (tenant_id, tipe_unit, tipe, jam_mulai, jam_selesai, keterangan, status_log, hari) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [tenant_id || null, tipe_unit || null, tipe, jam_mulai, jam_selesai, keterangan || null, status_log, hari || null]
    );

    res.json({ success: true, message: 'Aturan berhasil dibuat' });
  } catch (error) {
    console.error('Create rule error:', error);
    res.status(500).json({ success: false, message: 'Error creating rule' });
  }
});

// PUT /api/admin/rules/:id - Update rule (tenant-specific or central)
router.put('/admin/rules/:id', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { tipe_unit, tipe, jam_mulai, jam_selesai, keterangan, status_log, hari } = req.body;

    // Get existing rule
    const [existingRule] = await db.query('SELECT tenant_id, tipe_unit FROM attendance_rules WHERE id = ?', [id]);
    if (!existingRule) {
      return res.status(404).json({ success: false, message: 'Rule tidak ditemukan' });
    }

    const isCentralRule = !existingRule.tenant_id;
    let targetTenantId = existingRule.tenant_id;

    if (isCentralRule) {
      // Central rule: user must have YPWILUTIM access
      const hasCentralAccess = req.user.assignments?.some(a => a.tenant_id === 'YPWILUTIM');
      if (!hasCentralAccess) {
        return res.status(403).json({ success: false, message: 'Hanya admin pusat yang boleh mengedit aturan global' });
      }
    } else {
      // Tenant rule: verify access
      if (!verifyTenantAccess(req, targetTenantId)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }
    }

    if (!tipe || !jam_mulai || !jam_selesai || !status_log) {
      return res.status(400).json({ success: false, message: 'Field tipe, jam_mulai, jam_selesai, status_log wajib diisi' });
    }

    const result = await db.query(
      'UPDATE attendance_rules SET tipe_unit = ?, tipe = ?, jam_mulai = ?, jam_selesai = ?, keterangan = ?, status_log = ?, hari = ? WHERE id = ?',
      [tipe_unit || null, tipe, jam_mulai, jam_selesai, keterangan || null, status_log, hari || null, id]
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

// PUT /api/admin/tenant-locations/:id - Update location
router.put('/admin/tenant-locations/:id', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { location_name, latitude, longitude, location_radius, is_active, use_central_rules } = req.body;

    const [existing] = await db.query('SELECT tenant_id FROM tenant_locations WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Lokasi tidak ditemukan' });
    }

    const tenantId = req.query.tenant_id || existing.tenant_id;
    if (!verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const updates = {};
    if (location_name !== undefined) updates.location_name = location_name;
    if (latitude !== undefined) updates.latitude = latitude;
    if (longitude !== undefined) updates.longitude = longitude;
    if (location_radius !== undefined) updates.location_radius = location_radius;
    if (is_active !== undefined) updates.is_active = is_active;
    if (use_central_rules !== undefined) updates.use_central_rules = use_central_rules;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'Tidak ada field yang diupdate' });
    }

    const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), id];
    await db.query(`UPDATE tenant_locations SET ${setClause} WHERE id = ?`, values);

    res.json({ success: true, message: 'Lokasi berhasil diperbarui' });
  } catch (error) {
    console.error('Update location error:', error.message);
    res.status(500).json({ success: false, message: 'Error updating location' });
  }
});

// GET /api/admin/tenant-locations/:id - Get single location
router.get('/admin/tenant-locations/:id', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const [location] = await db.query('SELECT * FROM tenant_locations WHERE id = ?', [id]);
    if (!location) {
      return res.status(404).json({ success: false, message: 'Lokasi tidak ditemukan' });
    }
    if (!verifyTenantAccess(req, location.tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
    res.json({ success: true, data: location });
  } catch (error) {
    console.error('Get location error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching location' });
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
// WHATSAPP NUMBER ROUTE (for QR sharing)
// ============================================================

// GET /api/admin/whatsapp-number - Get admin WhatsApp number for sharing QR
router.get('/admin/whatsapp-number', authenticateOperator, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id || req.user.tenant_id;

    // Get admin/bendahara/kepala_sekolah WhatsApp number for this tenant
    const admins = await db.query(`
      SELECT t.id, t.nama, t.no_wa, ta.jabatan_di_unit
      FROM teacher_assignments ta
      JOIN teachers t ON ta.teacher_id = t.id
      WHERE ta.tenant_id = ?
      AND ta.jabatan_di_unit IN ('bendahara', 'admin', 'kepala_sekolah', 'tata_usaha', 'operator')
      AND t.no_wa IS NOT NULL AND t.no_wa != ''
      ORDER BY
        CASE ta.jabatan_di_unit
          WHEN 'admin' THEN 1
          WHEN 'kepala_sekolah' THEN 2
          WHEN 'bendahara' THEN 3
          WHEN 'tata_usaha' THEN 4
          WHEN 'operator' THEN 5
          ELSE 6
        END
      LIMIT 1
    `, [tenantId]);

    if (admins.length > 0) {
      res.json({
        success: true,
        data: {
          no_wa: admins[0].no_wa,
          nama: admins[0].nama,
          jabatan: admins[0].jabatan_di_unit
        }
      });
    } else {
      // Fallback: get any teacher with WhatsApp number in this tenant
      const teachers = await db.query(`
        SELECT t.id, t.nama, t.no_wa, ta.jabatan_di_unit
        FROM teacher_assignments ta
        JOIN teachers t ON ta.teacher_id = t.id
        WHERE ta.tenant_id = ?
        AND t.no_wa IS NOT NULL AND t.no_wa != ''
        LIMIT 1
      `, [tenantId]);

      if (teachers.length > 0) {
        res.json({
          success: true,
          data: {
            no_wa: teachers[0].no_wa,
            nama: teachers[0].nama,
            jabatan: teachers[0].jabatan_di_unit
          }
        });
      } else {
        res.json({
          success: false,
          message: 'Tidak ditemukan nomor WhatsApp admin untuk sekolah ini'
        });
      }
    }
  } catch (error) {
    console.error('Error fetching admin WhatsApp number:', error);
    res.status(500).json({ success: false, message: 'Error mengambil nomor WhatsApp admin' });
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
      SELECT t.id, t.nama, t.nik, t.nip, t.email, t.status_kepegawaian, t.status_aktif, t.no_wa, t.scan_id, t.link_foto, t.link_ktp, t.link_kk, t.link_ijazah,
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
    const rows = await db.query(
      `SELECT t.*, GROUP_CONCAT(DISTINCT tn.nama_sekolah) as sekolah_list
       FROM teachers t
       LEFT JOIN teacher_assignments ta ON t.id = ta.teacher_id
       LEFT JOIN tenants tn ON ta.tenant_id = tn.tenant_id
       WHERE t.id = ? AND t.status_aktif = 1
       GROUP BY t.id`,
      [req.params.id]
    );
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
    }
    const teacher = rows[0];
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
    const {
      nama, tenant_id, jabatan_di_unit, nik, nip, status_kepegawaian, email,
      tempat_lahir, tanggal_lahir, jenis_kelamin, alamat, no_wa,
      status_perkawinan, jumlah_anak, pendidikan_terakhir, tmt,
      link_foto, link_ktp, link_kk, link_ijazah,
      gaji_pokok, tunj_kinerja, tunj_kehadiran,
      BANK, nomor_rekening
    } = req.body;

    if (!nama) {
      return res.status(400).json({ success: false, message: 'Nama wajib diisi' });
    }

    // Verify tenant if provided
    if (tenant_id) {
      const [tenant] = await db.query('SELECT tenant_id FROM tenants WHERE tenant_id = ?', [tenant_id]);
      if (!tenant) {
        return res.status(400).json({ success: false, message: 'Tenant tidak ditemukan' });
      }
    }

    // Check if teacher exists
    const [existing] = await db.query('SELECT id, tmt FROM teachers WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
    }

    // NIP validation: if TMT is 2+ years ago, NIP must be present
    const effectiveTmt = tmt || (existing.tmt ? new Date(existing.tmt).toISOString().slice(0, 10) : null);
    if (effectiveTmt && new Date(effectiveTmt) <= new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000)) {
      if (!nip || nip === '' || nip === '-') {
        return res.status(400).json({ success: false, message: 'NIP wajib diisi jika TMT sudah 2 tahun atau lebih' });
      }
    }

    // Build dynamic update for teacher
    const fields = [];
    const values = [];
    const setField = (col, val) => { fields.push(`${col} = ?`); values.push(val); };

    setField('nama', nama);
    if (nik !== undefined) setField('nik', nik || null);
    if (nip !== undefined) setField('nip', nip || null);
    if (status_kepegawaian !== undefined) setField('status_kepegawaian', status_kepegawaian || null);
    if (email !== undefined) setField('email', email || null);
    if (tempat_lahir !== undefined) setField('tempat_lahir', tempat_lahir || null);
    if (tanggal_lahir !== undefined) setField('tanggal_lahir', tanggal_lahir || null);
    if (jenis_kelamin !== undefined) setField('jenis_kelamin', jenis_kelamin || null);
    if (alamat !== undefined) setField('alamat', alamat || null);
    if (no_wa !== undefined) setField('no_wa', no_wa || null);
    if (status_perkawinan !== undefined) setField('status_perkawinan', status_perkawinan || null);
    if (jumlah_anak !== undefined) setField('jumlah_anak', jumlah_anak || 0);
    if (pendidikan_terakhir !== undefined) setField('pendidikan_terakhir', pendidikan_terakhir || null);
    if (tmt !== undefined) setField('tmt', tmt || null);
    if (link_foto !== undefined) setField('link_foto', link_foto || null);
    if (link_ktp !== undefined) setField('link_ktp', link_ktp || null);
    if (link_kk !== undefined) setField('link_kk', link_kk || null);
    if (link_ijazah !== undefined) setField('link_ijazah', link_ijazah || null);
    if (gaji_pokok !== undefined) setField('gaji_pokok', gaji_pokok || 0);
    if (tunj_kinerja !== undefined) setField('tunj_kinerja', tunj_kinerja || 0);
    if (tunj_kehadiran !== undefined) setField('tunj_kehadiran', tunj_kehadiran || 0);
    if (BANK !== undefined) setField('BANK', BANK || null);
    if (nomor_rekening !== undefined) setField('nomor_rekening', nomor_rekening || null);

    if (fields.length > 0) {
      values.push(id);
      await db.query(`UPDATE teachers SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    // Update or create assignment (only if tenant_id & jabatan provided)
    if (tenant_id) {
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

// ============================================================
// MANUAL ATTENDANCE - Admin entry for teachers who cannot scan/absen
// ============================================================
router.post('/admin/attendance/manual', authenticateOperator, async (req, res) => {
  try {
    console.log('[MANUAL_ATTENDANCE] Request received:', req.body);
    const { teacher_id, tenant_id, tanggal, jenis, jam } = req.body;

    if (!teacher_id || !tenant_id || !tanggal || !jenis || !jam) {
      console.log('[MANUAL_ATTENDANCE] Missing fields:', { teacher_id, tenant_id, tanggal, jenis, jam });
      return res.status(400).json({ success: false, message: 'Semua field wajib diisi: guru, sekolah, tanggal, jenis, jam' });
    }

    if (!['masuk', 'pulang'].includes(jenis)) {
      return res.status(400).json({ success: false, message: 'Jenis absen tidak valid' });
    }

    const [teacher] = await db.query('SELECT nama, email, no_wa FROM teachers WHERE id = ? AND status_aktif = 1', [teacher_id]);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan atau nonaktif' });
    }

    const [tenant] = await db.query('SELECT nama_sekolah FROM tenants WHERE tenant_id = ?', [tenant_id]);
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Sekolah/tenant tidak ditemukan' });
    }

    const scanDate = new Date(`${tanggal}T${jam}:00`);
    if (isNaN(scanDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Format tanggal/jam tidak valid' });
    }

    const userTimezone = 'Asia/Makassar';
    const dayName = scanDate.toLocaleDateString('id-ID', { weekday: 'long', timeZone: userTimezone });
    const timeOnly = String(scanDate.getHours()).padStart(2, '0') + ':' + String(scanDate.getMinutes()).padStart(2, '0');

    const tipeRule = jenis === 'masuk' ? 'Datang' : 'Pulang';

    const rules = await db.query(
      `SELECT status_log, hari, jam_mulai, jam_selesai FROM attendance_rules WHERE tenant_id = ? AND tipe = ? AND ? BETWEEN jam_mulai AND jam_selesai`,
      [tenant_id, tipeRule, timeOnly]
    );

    let status = 'terlambat';
    const matchingRules = rules.filter(rule => {
      if (!rule.hari || rule.hari.trim() === '') return true;
      const ruleDays = rule.hari.toLowerCase().split(',').map(d => d.trim());
      return ruleDays.includes(dayName);
    });

    if (matchingRules.length > 0) {
      status = matchingRules[0].status_log;
    }

    const waktuScan = `${tanggal} ${jam}:00`;

    const existingRecords = await db.query(
      'SELECT id FROM attendance_logs WHERE teacher_id = ? AND jenis = ? AND DATE(waktu_scan) = ?',
      [teacher_id, jenis, tanggal]
    );
    if (existingRecords && existingRecords.length > 0) {
      return res.status(409).json({ success: false, message: `Guru sudah absen ${jenis.toUpperCase()} pada tanggal ${tanggal}` });
    }

    await db.query(
      `INSERT INTO attendance_logs (teacher_id, tenant_id, waktu_scan, jenis, metode, status, keterangan, dinas_luar)
       VALUES (?, ?, ?, ?, 'manual', ?, ?, 0)`,
      [teacher_id, tenant_id, waktuScan, jenis, status, 'Absen manual oleh admin']
    );

    const subject = `Absensi Manual ${jenis.toUpperCase()} - ${tenant.nama_sekolah || tenant_id}`;
    const htmlMessage = `<!DOCTYPE html>
<html lang="id">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Absensi Manual</title></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background-color:#f5f5f5;">
  <div style="max-width:600px;margin:20px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
    <div style="background:linear-gradient(135deg,#2563eb,#1d4ed8);padding:30px;text-align:center;">
      <h1 style="margin:0;color:white;font-size:24px;">YPWI Lutim</h1>
      <p style="margin:5px 0 0 0;color:rgba(255,255,255,0.9);font-size:14px;">Notifikasi Absensi Manual</p>
    </div>
    <div style="padding:30px;">
      <h2 style="margin:0 0 20px 0;color:#333;font-size:20px;">📝 Absensi Manual Berhasil</h2>
      <p style="margin:0 0 15px 0;color:#555;font-size:16px;line-height:1.6;">
        Assalamu'alaikum <strong>${teacher.nama}</strong>,
      </p>
      <p style="margin:0 0 20px 0;color:#555;font-size:16px;line-height:1.6;">
        Anda telah diabsen secara manual oleh admin untuk absensi <strong>${jenis.toUpperCase()}</strong> pada tanggal <strong>${scanDate.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: userTimezone })}</strong>.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#666;">Sekolah</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600;">${tenant.nama_sekolah || tenant_id}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#666;">Jenis</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600;">${jenis.toUpperCase()}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#666;">Waktu</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600;">${timeOnly} WITA</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#666;">Status</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600;color:${status === 'tepat_waktu' ? '#16a34a' : '#d97706'};">${status === 'tepat_waktu' ? 'Tepat Waktu' : 'Terlambat'}</td></tr>
        <tr><td style="padding:8px 0;color:#666;">Metode</td><td style="padding:8px 0;font-weight:600;">Manual (Admin)</td></tr>
      </table>
      <p style="margin:20px 0 0 0;color:#888;font-size:14px;">Email ini dikirim otomatis oleh sistem.</p>
    </div>
  </div>
</body>
</html>`;

    if (typeof global.sendEmail === 'function') {
      try {
        await global.sendEmail(teacher.email, subject, htmlMessage, '', [], 'manual_attendance');
      } catch (emailErr) {
        console.error('[MANUAL_ATTENDANCE] Email send failed:', emailErr.message);
      }
    }

    res.json({ success: true, message: 'Absensi manual berhasil disimpan', data: { teacher_id, tenant_id, tanggal, jenis, jam, status, waktu_scan: waktuScan } });
  } catch (error) {
    console.error('Manual attendance error:', error);
    res.status(500).json({ success: false, message: 'Gagal menyimpan absensi manual' });
  }
});

// GET /api/admin/attendance/rules - Preview attendance rule status for manual attendance
router.get('/admin/attendance/rules', authenticateOperator, async (req, res) => {
  try {
    const { tenant_id, tipe, time, day } = req.query;

    if (!tenant_id || !tipe || !time || !day) {
      return res.status(400).json({ success: false, message: 'Parameter tidak lengkap' });
    }

    const [tenant] = await db.query('SELECT tenant_id FROM tenants WHERE tenant_id = ?', [tenant_id]);
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant tidak ditemukan' });
    }

    const rules = await db.query(
      `SELECT status_log, hari, jam_mulai, jam_selesai FROM attendance_rules WHERE tenant_id = ? AND tipe = ? AND ? BETWEEN jam_mulai AND jam_selesai`,
      [tenant_id, tipe, time]
    );

    const matchingRules = rules.filter(rule => {
      if (!rule.hari || rule.hari.trim() === '') return true;
      const ruleDays = rule.hari.toLowerCase().split(',').map(d => d.trim());
      return ruleDays.includes(day.toLowerCase());
    });

    res.json({ success: true, data: matchingRules });
  } catch (error) {
    console.error('Attendance rules preview error:', error);
    res.status(500).json({ success: false, message: 'Error fetching attendance rules' });
  }
});

// POST /api/admin/attendance/qr-decode - Decode problem attendance QR and return teacher info
router.post('/admin/attendance/qr-decode', authenticateOperator, async (req, res) => {
  try {
    const { qr_string } = req.body;

    if (!qr_string || typeof qr_string !== 'string') {
      return res.status(400).json({ success: false, message: 'QR string tidak valid' });
    }

    let payload;
    try {
      const decoded = Buffer.from(qr_string, 'base64').toString('utf-8');
      payload = JSON.parse(decoded);
    } catch (e) {
      return res.status(400).json({ success: false, message: 'Format QR tidak dikenali' });
    }

    const { scan_id, nama, email, no_wa, ts } = payload;

    if (!scan_id && !email) {
      return res.status(400).json({ success: false, message: 'QR tidak berisi data guru yang valid' });
    }

    let teacher = null;
    if (scan_id) {
      const results = await db.query('SELECT id, nama, email, no_wa, scan_id FROM teachers WHERE scan_id = ? AND status_aktif = 1', [scan_id]);
      teacher = results[0] || null;
    }
    if (!teacher && email) {
      const results = await db.query('SELECT id, nama, email, no_wa, scan_id FROM teachers WHERE email = ? AND status_aktif = 1', [email]);
      teacher = results[0] || null;
    }

    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan atau nonaktif' });
    }

    const assignments = await db.query(
      'SELECT tenant_id, jabatan_di_unit FROM teacher_assignments WHERE teacher_id = ? LIMIT 1',
      [teacher.id]
    );
    const firstTenant = assignments[0] || null;

    res.json({
      success: true,
      message: 'QR berhasil dibaca',
      data: {
        teacher_id: teacher.id,
        nama: teacher.nama,
        email: teacher.email,
        no_wa: teacher.no_wa,
        scan_id: teacher.scan_id,
        tenant_id: firstTenant ? firstTenant.tenant_id : null,
        original_payload: payload
      }
    });
  } catch (error) {
    console.error('QR decode error:', error);
    res.status(500).json({ success: false, message: 'Gagal membaca QR' });
  }
});

// ==========================================
// ASSIGNMENT ROUTES - Pembagian Tugas Guru/Staf
// ==========================================

// GET /api/admin/assignments - List teachers with their assignments (grouped by teacher)
router.get('/admin/assignments', authenticateOperator, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    const query = `
      SELECT t.id, t.nama, t.nik, t.nip, t.email, t.no_wa,
             ta.id as assignment_id, ta.tenant_id, ta.jabatan_di_unit, ta.class_id,
             c.nama_kelas as wali_kelas,
             tn.nama_sekolah
      FROM teachers t
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      LEFT JOIN classes c ON ta.class_id = c.id
      LEFT JOIN tenants tn ON ta.tenant_id = tn.tenant_id
      WHERE t.status_aktif = 1
      ${tenantId ? 'AND ta.tenant_id = ?' : ''}
      ORDER BY t.nama ASC, ta.jabatan_di_unit ASC
    `;
    const params = tenantId ? [tenantId] : [];
    const rows = await db.query(query, params);

    // Group by teacher
    const teacherMap = {};
    rows.forEach(row => {
      if (!teacherMap[row.id]) {
        teacherMap[row.id] = {
          id: row.id,
          nama: row.nama,
          nik: row.nik,
          nip: row.nip,
          email: row.email,
          no_wa: row.no_wa,
          assignments: []
        };
      }
      teacherMap[row.id].assignments.push({
        assignment_id: row.assignment_id,
        tenant_id: row.tenant_id,
        nama_sekolah: row.nama_sekolah,
        jabatan_di_unit: row.jabatan_di_unit,
        class_id: row.class_id,
        wali_kelas: row.wali_kelas
      });
    });

    const teachers = Object.values(teacherMap);
    res.json({ success: true, data: teachers });
  } catch (error) {
    console.error('Admin assignments error:', error);
    res.status(500).json({ success: false, message: 'Error fetching assignments' });
  }
});

// DELETE /api/admin/teachers/:id/assignment/:assignmentId - Delete a specific assignment
router.delete('/admin/teachers/:id/assignment/:assignmentId', authenticateOperator, async (req, res) => {
  try {
    const { id, assignmentId } = req.params;

    // Verify teacher exists
    const [teacher] = await db.query('SELECT id, nama FROM teachers WHERE id = ? AND status_aktif = 1', [id]);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
    }

    // Delete the assignment
    const result = await db.query('DELETE FROM teacher_assignments WHERE id = ? AND teacher_id = ?', [assignmentId, id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Assignment tidak ditemukan' });
    }

    res.json({ success: true, message: 'Jabatan berhasil dihapus' });
  } catch (error) {
    console.error('Delete assignment error:', error);
    res.status(500).json({ success: false, message: 'Error deleting assignment' });
  }
});

// POST /api/admin/teachers/:id/assignments/bulk - Save multiple assignments for a teacher
router.post('/admin/teachers/:id/assignments/bulk', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { assignments } = req.body;

    if (!assignments || !Array.isArray(assignments) || assignments.length === 0) {
      return res.status(400).json({ success: false, message: 'Minimal 1 jabatan wajib diisi' });
    }

    // Verify teacher exists
    const [teacher] = await db.query('SELECT id FROM teachers WHERE id = ? AND status_aktif = 1', [id]);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
    }

    // Delete existing assignments for this teacher
    await db.query('DELETE FROM teacher_assignments WHERE teacher_id = ?', [id]);

    // Insert new assignments
    for (const a of assignments) {
      const { tenant_id, jabatan_di_unit, class_id } = a;

      if (!tenant_id || !jabatan_di_unit) {
        continue;
      }

      // Verify tenant exists
      const [tenant] = await db.query('SELECT tenant_id FROM tenants WHERE tenant_id = ?', [tenant_id]);
      if (!tenant) {
        continue;
      }

      // If class_id provided, verify it belongs to the selected tenant
      let validClassId = class_id || null;
      if (class_id) {
        const [classCheck] = await db.query('SELECT id FROM classes WHERE id = ? AND tenant_id = ?', [class_id, tenant_id]);
        if (!classCheck) {
          validClassId = null;
        }
      }

      await db.query(
        'INSERT INTO teacher_assignments (teacher_id, tenant_id, jabatan_di_unit, class_id) VALUES (?, ?, ?, ?)',
        [id, tenant_id, jabatan_di_unit, validClassId]
      );
    }

    res.json({ success: true, message: `${assignments.length} jabatan berhasil disimpan` });
  } catch (error) {
    console.error('Bulk save assignments error:', error);
    res.status(500).json({ success: false, message: 'Error saving assignments' });
  }
});

// PUT /api/admin/teachers/:id/assignment - Update teacher assignment (tenant + jabatan + class_id)
router.put('/admin/teachers/:id/assignment', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { tenant_id, jabatan_di_unit, class_id } = req.body;

    if (!tenant_id) {
      return res.status(400).json({ success: false, message: 'Sekolah/tenant wajib diisi' });
    }

    // Verify teacher exists
    const [teacher] = await db.query('SELECT id FROM teachers WHERE id = ? AND status_aktif = 1', [id]);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
    }

    // Verify tenant exists
    const [tenant] = await db.query('SELECT tenant_id FROM tenants WHERE tenant_id = ?', [tenant_id]);
    if (!tenant) {
      return res.status(400).json({ success: false, message: 'Sekolah/tenant tidak ditemukan' });
    }

    // If class_id provided, verify it belongs to the selected tenant
    if (class_id) {
      const [classCheck] = await db.query('SELECT id FROM classes WHERE id = ? AND tenant_id = ?', [class_id, tenant_id]);
      if (!classCheck) {
        return res.status(400).json({ success: false, message: 'Kelas tidak valid untuk sekolah ini' });
      }
    }

    // Update or create assignment
    const existingAssignment = await db.query(
      'SELECT id FROM teacher_assignments WHERE teacher_id = ? AND tenant_id = ? AND jabatan_di_unit = ?',
      [id, tenant_id, jabatan_di_unit || 'Guru']
    );
    if (existingAssignment.length > 0) {
      await db.query(
        'UPDATE teacher_assignments SET class_id = ? WHERE id = ?',
        [class_id || null, existingAssignment[0].id]
      );
    } else {
      await db.query(
        'INSERT INTO teacher_assignments (teacher_id, tenant_id, jabatan_di_unit, class_id) VALUES (?, ?, ?, ?)',
        [id, tenant_id, jabatan_di_unit || 'Guru', class_id || null]
      );
    }

    res.json({ success: true, message: 'Penempatan dan jabatan guru berhasil diupdate' });
  } catch (error) {
    console.error('Update assignment error:', error);
    res.status(500).json({ success: false, message: 'Error updating assignment' });
  }
});

// });

// ==========================================
// TEACHER PROFILE SUMMARY ROUTES
// ==========================================

router.get('/admin/teacher-profile-summary', authenticateOperator, async (req, res) => {
  try {
    const result = await getTeacherProfileSummary();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Teacher profile summary error:', error);
    res.status(500).json({ success: false, message: 'Error fetching teacher profile summary', error: error.message });
  }
});

// GET /api/public/teacher-profile-summary - Public summary (no auth required)
router.get('/public/teacher-profile-summary', async (req, res) => {
  try {
    const result = await getTeacherProfileSummary();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Public teacher profile summary error:', error);
    res.status(500).json({ success: false, message: 'Error fetching teacher profile summary' });
  }
});

async function getTeacherProfileSummary() {
  const teachers = await db.query(`
    SELECT t.id, t.nama, t.pendidikan_terakhir, t.status_perkawinan, t.jumlah_anak
    FROM teachers t
    WHERE t.status_aktif = 1
  `);

  const requiredFields = ['nama', 'nik', 'nip', 'email', 'tempat_lahir', 'tanggal_lahir', 'jenis_kelamin', 'alamat', 'no_wa', 'status_kepegawaian', 'tmt', 'pendidikan_terakhir', 'status_perkawinan'];
  const teacherDetails = await db.query(`
    SELECT t.id, t.nama, t.nik, t.nip, t.email, t.tempat_lahir, t.tanggal_lahir,
      t.jenis_kelamin, t.alamat, t.no_wa, t.status_kepegawaian, t.tmt,
      t.pendidikan_terakhir, t.status_perkawinan, t.jumlah_anak,
      GROUP_CONCAT(DISTINCT tn.nama_sekolah) as sekolah_list
    FROM teachers t
    LEFT JOIN teacher_assignments ta ON t.id = ta.teacher_id
    LEFT JOIN tenants tn ON ta.tenant_id = tn.tenant_id
    WHERE t.status_aktif = 1
    GROUP BY t.id ORDER BY t.nama ASC
  `);

  let totalTeachers = teacherDetails.length;
  let completeProfileCount = 0;
  const educationStats = {};
  const maritalStatusStats = { 'Lajang': 0, 'Menikah': 0, 'Cerai Hidup': 0, 'Cerai Mati': 0, 'Tidak Diketahui': 0 };

  teacherDetails.forEach(teacher => {
    const filledFields = requiredFields.filter(f => teacher[f] && teacher[f].toString().trim() !== '').length;
    if (filledFields === requiredFields.length) completeProfileCount++;

    const pendidikan = (teacher.pendidikan_terakhir ? String(teacher.pendidikan_terakhir).split('/')[0] : '') || 'Tidak Diketahui';
    educationStats[pendidikan] = (educationStats[pendidikan] || 0) + 1;

    const statusPerkawinan = teacher.status_perkawinan || 'Tidak Diketahui';
    if (maritalStatusStats.hasOwnProperty(statusPerkawinan)) maritalStatusStats[statusPerkawinan]++;
    else maritalStatusStats['Tidak Diketahui']++;
  });

  return {
    data: {
      total_teachers: totalTeachers,
      complete_profile: completeProfileCount,
      incomplete_profile: totalTeachers - completeProfileCount,
      education_distribution: educationStats,
      marital_status_distribution: maritalStatusStats,
      average_completion: totalTeachers > 0 ? Math.round((completeProfileCount / totalTeachers) * 100) : 0
    },
    teachers: teacherDetails.map(t => ({
      id: t.id, nama: t.nama, pendidikan_terakhir: t.pendidikan_terakhir || null,
      status_perkawinan: t.status_perkawinan || null,
      completion_percentage: Math.round(requiredFields.filter(f => t[f] && t[f].toString().trim() !== '').length / requiredFields.length * 100)
    }))
  };
}

router.get('/admin/teacher-profile-detail', authenticateOperator, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Akses ditolak. Hanya admin yang dapat melihat detail kelengkapan profil guru.' });
    }

    const { pendidikan, status_perkawinan, search, tenant_id, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `SELECT t.id, t.nama, t.nik, t.nip, t.email, t.tempat_lahir, t.tanggal_lahir, t.jenis_kelamin, t.alamat, t.no_wa, t.status_kepegawaian, t.tmt, t.pendidikan_terakhir, t.status_perkawinan, t.jumlah_anak, t.link_foto, t.link_ktp, t.link_kk, t.link_ijazah, GROUP_CONCAT(DISTINCT tn.nama_sekolah) as sekolah_list FROM teachers t LEFT JOIN teacher_assignments ta ON t.id = ta.teacher_id LEFT JOIN tenants tn ON ta.tenant_id = tn.tenant_id WHERE t.status_aktif = 1`;
    const params = [];

    if (tenant_id) { query += ' AND EXISTS (SELECT 1 FROM teacher_assignments ta2 WHERE ta2.teacher_id = t.id AND ta2.tenant_id = ?)'; params.push(tenant_id); }
    if (pendidikan) { query += ' AND t.pendidikan_terakhir LIKE ?'; params.push(pendidikan + '/%'); }
    if (status_perkawinan) { query += ' AND t.status_perkawinan = ?'; params.push(status_perkawinan); }
    if (search) { query += ' AND (t.nama LIKE ? OR t.nik LIKE ? OR t.nip LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

    query += ' GROUP BY t.id ORDER BY t.nama ASC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const teachers = await db.query(query, params);
    const requiredFields = ['nama', 'nik', 'nip', 'email', 'tempat_lahir', 'tanggal_lahir', 'jenis_kelamin', 'alamat', 'no_wa', 'status_kepegawaian', 'tmt', 'pendidikan_terakhir', 'status_perkawinan'];
    const detailedTeachers = teachers.map(teacher => {
      const filledFields = requiredFields.filter(f => teacher[f] && teacher[f].toString().trim() !== '').length;
      return { ...teacher, completion_percentage: Math.round((filledFields / requiredFields.length) * 100), missing_fields: requiredFields.filter(f => !teacher[f] || teacher[f].toString().trim() === '') };
    });

    let countQuery = 'SELECT COUNT(*) as total FROM teachers t WHERE t.status_aktif = 1';
    const countParams = [];
    if (tenant_id) { countQuery += ' AND EXISTS (SELECT 1 FROM teacher_assignments ta2 WHERE ta2.teacher_id = t.id AND ta2.tenant_id = ?)'; countParams.push(tenant_id); }
    if (pendidikan) { countQuery += ' AND t.pendidikan_terakhir LIKE ?'; countParams.push(pendidikan + '/%'); }
    if (status_perkawinan) { countQuery += ' AND t.status_perkawinan = ?'; countParams.push(status_perkawinan); }
    if (search) { countQuery += ' AND (t.nama LIKE ? OR t.nik LIKE ? OR t.nip LIKE ?)'; countParams.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    const totalResult = await db.query(countQuery, countParams);

    res.json({ success: true, data: detailedTeachers, pagination: { page: parseInt(page), limit: parseInt(limit), total: totalResult[0]?.total || 0, totalPages: Math.ceil((totalResult[0]?.total || 0) / parseInt(limit)) } });
  } catch (error) {
    console.error('Teacher profile detail error:', error);
    res.status(500).json({ success: false, message: 'Error fetching teacher profile detail', error: error.message });
  }
});

// ==========================================
// GURU REGISTRATION ROUTES (Public)
// ==========================================

// POST /api/public/register-guru - Public registration for new teachers (pending status)
router.post('/public/register-guru', registrationUpload.fields([
  { name: 'foto', maxCount: 1 },
  { name: 'ktp', maxCount: 1 },
  { name: 'kk', maxCount: 1 },
  { name: 'ijazah', maxCount: 1 }
]), async (req, res) => {
  try {
    const { nama, nik, nip, email, no_wa, tempat_lahir, tanggal_lahir, jenis_kelamin, status_perkawinan, alamat, pendidikan_terakhir, jurusan, nama_sekolah_pendidikan, tahun_angkatan, tenant_id, jabatan_di_unit, bank, nomor_rekening } = req.body;

    if (!nama || !nik || !email || !no_wa || !tempat_lahir || !tanggal_lahir || !jenis_kelamin || !alamat || !pendidikan_terakhir || !jurusan || !nama_sekolah_pendidikan || !tahun_angkatan || !tenant_id || !jabatan_di_unit) {
      return res.status(400).json({ success: false, message: 'Semua field wajib diisi' });
    }

    if (!req.files || !req.files.foto || !req.files.ktp || !req.files.kk || !req.files.ijazah) {
      return res.status(400).json({ success: false, message: 'Semua berkas wajib diupload (Foto, KTP, KK, Ijazah)' });
    }

    const existingNikRecords = await db.query('SELECT id FROM teachers WHERE nik = ? AND status_aktif = 0', [nik]);
    if (existingNikRecords && existingNikRecords.length > 0) {
      return res.status(409).json({ success: false, message: 'Pendaftaran dengan NIK ini sedang menunggu persetujuan' });
    }

    const [tenant] = await db.query('SELECT tenant_id FROM tenants WHERE tenant_id = ?', [tenant_id]);
    if (!tenant) {
      return res.status(400).json({ success: false, message: 'Sekolah tidak ditemukan' });
    }

    const fotoPath = req.files.foto[0].path.replace(/\\/g, '/');
    const ktpPath = req.files.ktp[0].path.replace(/\\/g, '/');
    const kkPath = req.files.kk[0].path.replace(/\\/g, '/');
    const ijazahPath = req.files.ijazah[0].path.replace(/\\/g, '/');

    const result = await db.query(
      'INSERT INTO teachers (nama, nik, nip, email, no_wa, tempat_lahir, tanggal_lahir, jenis_kelamin, alamat, status_kepegawaian, pendidikan_terakhir, jurusan, nama_sekolah_pendidikan, tahun_angkatan, bank, nomor_rekening, link_foto, status_aktif) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)',
      [nama, nik, nip || null, email, no_wa, tempat_lahir, tanggal_lahir, jenis_kelamin, alamat, null, pendidikan_terakhir, jurusan, nama_sekolah_pendidikan, tahun_angkatan, bank || null, nomor_rekening || null, fotoPath]
    );

    const teacherId = result.insertId;

    await db.query(
      'INSERT INTO teacher_assignments (teacher_id, tenant_id, jabatan_di_unit) VALUES (?, ?, ?)',
      [teacherId, tenant_id, jabatan_di_unit]
    );

    res.json({ success: true, message: 'Pendaftaran berhasil. Silakan atur password Anda.', teacher_id: teacherId });
  } catch (error) {
    console.error('Guru registration error:', error);
    res.status(500).json({ success: false, message: 'Gagal mendaftar: ' + error.message });
  }
});

// POST /api/public/set-password/:teacherId - Set password for pending registration
router.post('/public/set-password/:teacherId', async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password minimal 6 karakter' });
    }

    const [teacher] = await db.query('SELECT id FROM teachers WHERE id = ? AND status_aktif = 0', [teacherId]);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Pendaftaran tidak ditemukan atau sudah disetujui' });
    }

    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(password, 10);

    await db.query(
      'UPDATE teachers SET pending_password_hash = ? WHERE id = ?',
      [hashedPassword, teacherId]
    );

    res.json({ success: true, message: 'Password berhasil disimpan' });
  } catch (error) {
    console.error('Set password error:', error);
    res.status(500).json({ success: false, message: 'Gagal menyimpan password' });
  }
});

// GET /api/admin/pending-registrations - List pending teacher registrations
router.get('/admin/pending-registrations', authenticateOperator, async (req, res) => {
  try {
    const teachers = await db.query(`
      SELECT t.id, t.nama, t.nik, t.email, t.no_wa, t.tempat_lahir, t.tanggal_lahir,
             t.jenis_kelamin, t.alamat, t.status_kepegawaian, t.pendidikan_terakhir,
             t.jurusan, t.nama_sekolah_pendidikan, t.tahun_angkatan, t.link_foto,
             ta.tenant_id, tn.nama_sekolah, ta.jabatan_di_unit, t.created_at
      FROM teachers t
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      JOIN tenants tn ON ta.tenant_id = tn.tenant_id
      WHERE t.status_aktif = 0
      ORDER BY t.created_at DESC
    `);
    res.json({ success: true, data: teachers });
  } catch (error) {
    console.error('Pending registrations error:', error);
    res.status(500).json({ success: false, message: 'Error fetching pending registrations' });
  }
});

// POST /api/admin/approve-registration/:id - Approve teacher registration
router.post('/admin/approve-registration/:id', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { status_kepegawaian, tmt, scan_id, tenant_id, jabatan_di_unit } = req.body;

    const [teacher] = await db.query('SELECT id, nama, email, pending_password_hash FROM teachers WHERE id = ? AND status_aktif = 0', [id]);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Pendaftaran tidak ditemukan' });
    }

    await db.query(
      'UPDATE teachers SET status_aktif = 1, status_kepegawaian = ?, tmt = ?, scan_id = ?, pending_password_hash = NULL WHERE id = ?',
      [status_kepegawaian || null, tmt || null, scan_id || null, id]
    );

    if (tenant_id && jabatan_di_unit) {
      const existingAssignmentRecords = await db.query('SELECT id FROM teacher_assignments WHERE teacher_id = ?', [id]);
      if (existingAssignmentRecords && existingAssignmentRecords.length > 0) {
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
    }

    const bcrypt = require('bcryptjs');
    const jwt = require('jsonwebtoken');
    const username = teacher.email || `guru-${id}`;
    const hashedPassword = teacher.pending_password_hash || await bcrypt.hash(username + '123', 10);

    const userResult = await db.query(
      'INSERT INTO users (username, email, password, role, guru_id, is_profile_complete, created_at) VALUES (?, ?, ?, ?, ?, 0, NOW())',
      [username, teacher.email, hashedPassword, 'guru', id]
    );

    if (typeof global.sendEmail === 'function') {
      const subject = 'Akun Guru YPWI Lutim - Pendaftaran Disetujui';
      const htmlMessage = `<!DOCTYPE html>
<html lang="id">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background-color:#f5f5f5;">
  <div style="max-width:600px;margin:20px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
    <div style="background:linear-gradient(135deg,#10b981,#059669);padding:30px;text-align:center;">
      <h1 style="margin:0;color:white;font-size:24px;">YPWI Lutim</h1>
      <p style="margin:5px 0 0 0;color:rgba(255,255,255,0.9);font-size:14px;">Pendaftaran Disetujui</p>
    </div>
    <div style="padding:30px;">
      <h2 style="margin:0 0 20px 0;color:#333;font-size:20px;">Selamat, ${teacher.nama}!</h2>
      <p style="margin:0 0 15px 0;color:#555;font-size:16px;line-height:1.6;">Pendaftaran Anda sebagai guru telah disetujui.</p>
      <p style="margin:0 0 10px 0;color:#555;font-size:16px;"><strong>Username:</strong> ${username}</p>
      <p style="margin:0 0 20px 0;color:#555;font-size:16px;"><strong>Password:</strong> ${teacher.pending_password_hash ? '(Password yang Anda buat)' : username + '123'}</p>
      <p style="margin:20px 0 0 0;color:#888;font-size:14px;">Silakan login dan lengkapi profil Anda.</p>
    </div>
  </div>
</body>
</html>`;
      await global.sendEmail(teacher.email, subject, htmlMessage, '', [], 'registration_approved');
    }

    res.json({ success: true, message: 'Pendaftaran berhasil disetujui', user_id: userResult.insertId });
  } catch (error) {
    console.error('Approve registration error:', error);
    res.status(500).json({ success: false, message: 'Gagal menyetujui pendaftaran' });
  }
});

// POST /api/admin/reject-registration/:id - Reject teacher registration
router.post('/admin/reject-registration/:id', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const [teacher] = await db.query('SELECT id, nama, email FROM teachers WHERE id = ? AND status_aktif = 0', [id]);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Pendaftaran tidak ditemukan' });
    }

    await db.query('DELETE FROM teacher_assignments WHERE teacher_id = ?', [id]);
    await db.query('DELETE FROM teachers WHERE id = ?', [id]);

    if (typeof global.sendEmail === 'function') {
      const subject = 'Pendaftaran Guru YPWI Lutim - Ditolak';
      const htmlMessage = `<!DOCTYPE html>
<html lang="id">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background-color:#f5f5f5;">
  <div style="max-width:600px;margin:20px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
    <div style="background:linear-gradient(135deg,#dc2626,#b91c1c);padding:30px;text-align:center;">
      <h1 style="margin:0;color:white;font-size:24px;">YPWI Lutim</h1>
      <p style="margin:5px 0 0 0;color:rgba(255,255,255,0.9);font-size:14px;">Pendaftaran Ditolak</p>
    </div>
    <div style="padding:30px;">
      <h2 style="margin:0 0 20px 0;color:#333;font-size:20px;">Mohon Maaf, ${teacher.nama}</h2>
      <p style="margin:0 0 15px 0;color:#555;font-size:16px;line-height:1.6;">Pendaftaran Anda sebagai guru belum dapat disetujui.</p>
      ${reason ? `<p style="margin:0 0 20px 0;color:#555;font-size:16px;"><strong>Alasan:</strong> ${reason}</p>` : ''}
      <p style="margin:20px 0 0 0;color:#888;font-size:14px;">Anda dapat mendaftar kembali dengan data yang lebih lengkap.</p>
    </div>
  </div>
</body>
</html>`;
      await global.sendEmail(teacher.email, subject, htmlMessage, '', [], 'registration_rejected');
    }

    res.json({ success: true, message: 'Pendaftaran berhasil ditolak' });
  } catch (error) {
    console.error('Reject registration error:', error);
    res.status(500).json({ success: false, message: 'Gagal menolak pendaftaran' });
  }
});

// ==========================================
// END OF GURU REGISTRATION ROUTES
// ==========================================

// GET /api/admin/teacher-profile-detail/export - Export teacher data as Excel (respects filters)
router.get('/admin/teacher-profile-detail/export', authenticateOperator, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Akses ditolak. Hanya admin yang dapat export data guru.' });
    }

    const { pendidikan, status_perkawinan, search, tenant_id } = req.query;

    let query = `
      SELECT t.*, GROUP_CONCAT(DISTINCT tn.nama_sekolah) as sekolah_list
      FROM teachers t
      LEFT JOIN teacher_assignments ta ON t.id = ta.teacher_id
      LEFT JOIN tenants tn ON ta.tenant_id = tn.tenant_id
      WHERE t.status_aktif = 1
    `;
    const params = [];
    if (tenant_id) { query += ' AND EXISTS (SELECT 1 FROM teacher_assignments ta2 WHERE ta2.teacher_id = t.id AND ta2.tenant_id = ?)'; params.push(tenant_id); }
    if (pendidikan) { query += ' AND t.pendidikan_terakhir LIKE ?'; params.push(pendidikan + '/%'); }
    if (status_perkawinan) { query += ' AND t.status_perkawinan = ?'; params.push(status_perkawinan); }
    if (search) { query += ' AND (t.nama LIKE ? OR t.nik LIKE ? OR t.nip LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    query += ' GROUP BY t.id ORDER BY t.nama ASC';

    const teachers = await db.query(query, params);

    const assignments = await db.query(`
      SELECT teacher_id, tenant_id, jabatan_di_unit FROM teacher_assignments
    `);
    const assignMap = {};
    assignments.forEach(a => {
      if (!assignMap[a.teacher_id]) assignMap[a.teacher_id] = [];
      assignMap[a.teacher_id].push(`${a.tenant_id} - ${a.jabatan_di_unit || '-'}`);
    });

    const fmtUang = (v) => (v === null || v === undefined || v === '') ? '' : Number(v);
    const jk = (v) => v === 'L' ? 'Laki-laki' : v === 'P' ? 'Perempuan' : '';
    const hitungMasaKerja = (tmt) => {
      if (!tmt) return '';
      const s = new Date(tmt);
      if (isNaN(s.getTime())) return '';
      const now = new Date();
      let years = now.getFullYear() - s.getFullYear();
      let months = now.getMonth() - s.getMonth();
      let days = now.getDate() - s.getDate();
      if (days < 0) {
        months--;
        const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
        days += prevMonth.getDate();
      }
      if (months < 0) { years--; months += 12; }
      return `${years} thn ${months} bln ${days} hari`;
    };

    const data = teachers.map(t => {
      const pend = (t.pendidikan_terakhir ? String(t.pendidikan_terakhir).split('/') : []);
      return {
        'ID': t.id,
        'Nama': t.nama || '',
        'NIK': t.nik || '',
        'NIY': t.nip || '',
        'Email': t.email || '',
        'Tempat Lahir': t.tempat_lahir || '',
        'Tanggal Lahir': t.tanggal_lahir || '',
        'Jenis Kelamin': jk(t.jenis_kelamin),
        'Alamat': t.alamat || '',
        'No WA': t.no_wa || '',
        'Scan ID': t.scan_id || '',
        'Foto': t.link_foto || '',
        'Pendidikan (Jenjang)': pend[0] || '',
        'Pendidikan (Sekolah/Univ)': pend[1] || '',
        'Pendidikan (Jurusan)': pend[2] || '',
        'Pendidikan (Tahun Lulus)': pend[3] || '',
        'Status Kepegawaian': t.status_kepegawaian || '',
        'TMT': t.tmt || '',
        'Masa Kerja': hitungMasaKerja(t.tmt),
        'Status Perkawinan': t.status_perkawinan || '',
        'Jumlah Anak': t.jumlah_anak ?? '',
        'Bank': t.BANK || '',
        'Nomor Rekening': t.nomor_rekening || '',
        'Sekolah': t.sekolah_list || '',
        'Penempatan & Jabatan': (assignMap[t.id] || []).join('; '),
        'Gaji Pokok': fmtUang(t.gaji_pokok),
        'Tunj. Kinerja': fmtUang(t.tunj_kinerja),
        'Tunj. Umum': fmtUang(t.tunj_umum),
        'Tunj. Istri': fmtUang(t.tunj_istri),
        'Tunj. Anak': fmtUang(t.tunj_anak),
        'Tunj. Kepala Sekolah': fmtUang(t.tunj_kepala_sekolah),
        'Tunj. Wali Kelas': fmtUang(t.tunj_wali_kelas),
        'Honor Bendahara': fmtUang(t.honor_bendahara),
        'Tunj. Kehadiran': fmtUang(t.tunj_kehadiran),
        'Potongan': fmtUang(t.potongan)
      };
    });

    const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ 'ID': '', 'Nama': '' }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data Guru');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const fileName = `data_guru_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (error) {
    console.error('Teacher profile export error:', error);
    res.status(500).json({ success: false, message: 'Error export data guru' });
  }
});

// ==========================================
// PROFILE ACCESS REQUEST ROUTES
// ==========================================

// GET /api/public/profile-access/check - Check if user has access to detail view
router.get('/public/profile-access/check', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.json({ success: true, has_access: false });
    }

    const request = await db.query(
      'SELECT id, status FROM profile_access_requests WHERE verification_token = ? AND status = ? ORDER BY created_at DESC LIMIT 1',
      [token, 'approved']
    );

    res.json({ 
      success: true, 
      has_access: request.length > 0,
      request_id: request[0]?.id || null
    });
  } catch (error) {
    console.error('Check profile access error:', error);
    res.json({ success: true, has_access: false });
  }
});

// POST /api/public/profile-access/request - Submit access request with file upload (public)
router.post('/public/profile-access/request', accessRequestUpload.fields([
  { name: 'selfie', maxCount: 1 },
  { name: 'ktp', maxCount: 1 }
]), async (req, res) => {
  try {
    const { session_id, requester_name, requester_email, reason, ktp_nik, ktp_nama, ktp_alamat, ktp_tempat_lahir, ktp_tanggal_lahir, ktp_jenis_kelamin } = req.body;

    if (!session_id || !requester_name) {
      return res.status(400).json({ success: false, message: 'Data permintaan tidak lengkap' });
    }

    // Check if there's already a pending or approved request
    const existing = await db.query(
      'SELECT id, status FROM profile_access_requests WHERE session_id = ? ORDER BY created_at DESC LIMIT 1',
      [session_id]
    );

    if (existing.length > 0) {
      const lastRequest = existing[0];
      if (lastRequest.status === 'approved') {
        return res.json({ success: true, message: 'Anda sudah memiliki akses', approved: true });
      } else if (lastRequest.status === 'pending') {
        return res.json({ success: true, message: 'Permintaan Anda sedang menunggu persetujuan admin.', pending: true });
      }
    }

    // Handle file uploads
    const selfieFile = req.files?.selfie?.[0];
    const ktpFile = req.files?.ktp?.[0];

    const selfieUrl = selfieFile ? `/uploads/access-requests/${selfieFile.filename}` : null;
    const ktpUrl = ktpFile ? `/uploads/access-requests/${ktpFile.filename}` : null;

    // Verify NIK if provided
    let matchedTeacherId = null;
    if (ktp_nik) {
      const teacherMatch = await db.query(
        'SELECT id FROM teachers WHERE nik = ? AND status_aktif = 1 LIMIT 1',
        [ktp_nik]
      );
      if (teacherMatch.length > 0) {
        matchedTeacherId = teacherMatch[0].id;
      }
    }

    // Create new request
    const result = await db.query(
      `INSERT INTO profile_access_requests 
       (session_id, requester_name, requester_email, reason, status, selfie_url, ktp_url, 
        ktp_nik, ktp_nama, ktp_alamat, ktp_tempat_lahir, ktp_tanggal_lahir, ktp_jenis_kelamin,
        verification_status, matched_teacher_id, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        session_id, requester_name, requester_email || null, reason || null, 'pending',
        selfieUrl, ktpUrl, ktp_nik || null, ktp_nama || null, ktp_alamat || null,
        ktp_tempat_lahir || null, ktp_tanggal_lahir || null, ktp_jenis_kelamin || null,
        ktp_nik ? (matchedTeacherId ? 'verified' : 'failed') : 'pending',
        matchedTeacherId
      ]
    );

    console.log(`[PROFILE ACCESS REQUEST] New request from ${requester_name} (${session_id}) - KTP NIK: ${ktp_nik || 'not provided'} - Matched: ${matchedTeacherId ? 'YES' : 'NO'}`);

    res.json({ 
      success: true, 
      message: matchedTeacherId 
        ? 'Permintaan akses berhasil dikirim. NIK terverifikasi, menunggu persetujuan admin.'
        : 'Permintaan akses berhasil dikirim. Menunggu persetujuan admin.',
      matched: !!matchedTeacherId
    });
  } catch (error) {
    console.error('Profile access request error:', error);
    res.status(500).json({ success: false, message: 'Gagal mengirim permintaan akses' });
  }
});

// GET /api/admin/profile-access/requests - List all access requests (admin only)
router.get('/admin/profile-access/requests', authenticateOperator, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const { status } = req.query;
    let query = `SELECT * FROM profile_access_requests`;
    const params = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const requests = await db.query(query, params);

    res.json({ success: true, data: requests });
  } catch (error) {
    console.error('List profile access requests error:', error);
    res.status(500).json({ success: false, message: 'Error fetching requests' });
  }
});

// POST /api/admin/profile-access/:id/approve - Approve access request (admin only)
router.post('/admin/profile-access/:id/approve', authenticateOperator, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const { id } = req.params;
    const { notes } = req.body;

    const result = await db.query(
      'UPDATE profile_access_requests SET status = ?, approved_by = ?, approved_at = NOW(), notes = ? WHERE id = ?',
      ['approved', req.user.id, notes || null, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Permintaan tidak ditemukan' });
    }

    console.log(`[PROFILE ACCESS REQUEST] Request ${id} approved by admin ${req.user.id}`);

    res.json({ success: true, message: 'Permintaan akses disetujui' });
  } catch (error) {
    console.error('Approve profile access error:', error);
    res.status(500).json({ success: false, message: 'Error approving request' });
  }
});

// POST /api/admin/profile-access/:id/deny - Deny access request (admin only)
router.post('/admin/profile-access/:id/deny', authenticateOperator, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const { id } = req.params;
    const { notes } = req.body;

    const result = await db.query(
      'UPDATE profile_access_requests SET status = ?, approved_by = ?, approved_at = NOW(), notes = ? WHERE id = ?',
      ['denied', req.user.id, notes || null, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Permintaan tidak ditemukan' });
    }

    console.log(`[PROFILE ACCESS REQUEST] Request ${id} denied by admin ${req.user.id}`);

    res.json({ success: true, message: 'Permintaan akses ditolak' });
  } catch (error) {
    console.error('Deny profile access error:', error);
    res.status(500).json({ success: false, message: 'Error denying request' });
  }
});

// POST /api/public/profile-access/ocr-ktp - Extract KTP fields via Gemini Vision API
router.post('/public/profile-access/ocr-ktp', accessRequestUpload.single('ktp'), async (req, res) => {
  try {
    const ktpFile = req.file;
    if (!ktpFile) {
      return res.status(400).json({ success: false, message: 'File KTP harus diupload' });
    }

    const parsed = await extractKTPFromImage(ktpFile.path);

    const ktpData = {
      nik: parsed.nik || '',
      nama: parsed.nama || '',
      alamat: parsed.alamat || '',
      tempat_lahir: parsed.tempat_lahir || '',
      tanggal_lahir: parsed.tanggal_lahir || '',
      jenis_kelamin: parsed.jenis_kelamin || '',
      gol_darah: parsed.gol_darah || '',
      agama: parsed.agama || '',
      status_perkawinan: parsed.status_perkawinan || '',
      pekerjaan: parsed.pekerjaan || '',
      kewarganegaraan: parsed.kewarganegaraan || '',
      berlaku_hingga: parsed.berlaku_hingga || '',
      rt_rw: parsed.rt_rw || '',
      kel_desa: parsed.kel_desa || '',
      kecamatan: parsed.kecamatan || ''
    };

    const isKtp = parsed.is_ktp === true && /^\d{16}$/.test((ktpData.nik || '').toString());

    res.json({
      success: true,
      ktp_data: ktpData,
      is_ktp: isKtp
    });
  } catch (error) {
    console.error('Gemini OCR error:', error);
    res.status(500).json({ success: false, message: error.message || 'Gagal memproses OCR KTP' });
  }
});

// POST /api/public/profile-access/verify - Submit verification with KTP and selfie
router.post('/public/profile-access/verify', accessRequestUpload.fields([
  { name: 'selfie', maxCount: 1 },
  { name: 'ktp', maxCount: 1 }
]), async (req, res) => {
  try {
    const { 
      ktp_nik, ktp_nama, ktp_alamat, ktp_tempat_lahir, ktp_tanggal_lahir, ktp_jenis_kelamin,
      ktp_golongan_darah, ktp_agama, ktp_status_perkawinan, ktp_pekerjaan, ktp_kewarganegaraan,
      ktp_berlaku_hingga, ktp_rt_rw, ktp_kel_desa, ktp_kecamatan,
      email, nomor_wa 
    } = req.body;

    if (!ktp_nik || !ktp_nama || !email || !nomor_wa) {
      return res.status(400).json({ success: false, message: 'Data verifikasi tidak lengkap' });
    }

    // Generate verification token
    const verificationToken = 'vrf_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);

    // Handle file uploads
    const selfieFile = req.files?.selfie?.[0];
    const ktpFile = req.files?.ktp?.[0];

    const selfieUrl = selfieFile ? `/uploads/access-requests/${selfieFile.filename}` : null;
    const ktpUrl = ktpFile ? `/uploads/access-requests/${ktpFile.filename}` : null;

    // Verify NIK if provided
    let matchedTeacherId = null;
    let matchedUserId = null;
    if (ktp_nik) {
      const teacherMatch = await db.query(
        'SELECT id FROM teachers WHERE nik = ? AND status_aktif = 1 LIMIT 1',
        [ktp_nik]
      );
      if (teacherMatch.length > 0) {
        matchedTeacherId = teacherMatch[0].id;
        
        // Check if teacher has user account
        const userMatch = await db.query(
          'SELECT id FROM users WHERE guru_id = ? LIMIT 1',
          [matchedTeacherId]
        );
        if (userMatch.length > 0) {
          matchedUserId = userMatch[0].id;
        }
      }
    }

    // Create access request
    const result = await db.query(
      `INSERT INTO profile_access_requests 
       (session_id, requester_name, requester_email, reason, status, selfie_url, ktp_url, 
        ktp_nik, ktp_nama, ktp_alamat, ktp_tempat_lahir, ktp_tanggal_lahir, ktp_jenis_kelamin,
        ktp_golongan_darah, ktp_agama, ktp_status_perkawinan, ktp_pekerjaan, ktp_kewarganegaraan,
        ktp_berlaku_hingga, ktp_rt_rw, ktp_kel_desa, ktp_kecamatan,
        verification_status, matched_teacher_id, matched_user_id, verification_token, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        verificationToken, ktp_nama, email, 'Verifikasi identitas untuk akses detail profil guru', 'pending',
        selfieUrl, ktpUrl, ktp_nik, ktp_nama, ktp_alamat,
        ktp_tempat_lahir || null, ktp_tanggal_lahir || null, ktp_jenis_kelamin || null,
        ktp_golongan_darah || null, ktp_agama || null, ktp_status_perkawinan || null,
        ktp_pekerjaan || null, ktp_kewarganegaraan || null, ktp_berlaku_hingga || null,
        ktp_rt_rw || null, ktp_kel_desa || null, ktp_kecamatan || null,
        ktp_nik ? (matchedTeacherId ? 'verified' : 'failed') : 'pending',
        matchedTeacherId, matchedUserId, verificationToken
      ]
    );

    console.log(`[PROFILE VERIFICATION] New verification from ${ktp_nama} (${ktp_nik}) - Matched Teacher: ${matchedTeacherId || 'NO'} - Matched User: ${matchedUserId || 'NO'}`);

    // If NIK matches teacher, auto-approve
    if (matchedTeacherId) {
      await db.query(
        'UPDATE profile_access_requests SET status = ?, approved_at = NOW() WHERE id = ?',
        ['approved', result.insertId]
      );
      
      // Generate JWT token for user
      const token = jwt.sign(
        { id: matchedUserId, username: ktp_nik, role: 'guru', guru_id: matchedTeacherId, is_profile_complete: 1 },
        process.env.JWT_SECRET || 'ypwi_lutim_secret_key',
        { expiresIn: '7d' }
      );

      return res.json({ 
        success: true, 
        status: 'approved',
        message: 'NIK terverifikasi. Akses diberikan.',
        verification_token: verificationToken,
        token: token,
        user: {
          id: matchedUserId,
          username: ktp_nik,
          role: 'guru',
          guru_id: matchedTeacherId
        }
      });
    }

    res.json({ 
      success: true, 
      status: 'pending',
      message: 'Permintaan verifikasi berhasil dikirim. Menunggu persetujuan admin.',
      verification_token: verificationToken
    });
  } catch (error) {
    console.error('Profile verification error:', error);
    res.status(500).json({ success: false, message: 'Gagal memproses verifikasi' });
  }
});

// POST /api/public/profile-access/login - Special login for verified users
router.post('/public/profile-access/login', async (req, res) => {
  try {
    const { identifier, password, token } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Email/NIK dan password wajib diisi' });
    }

    // Find user by email or NIK
    let user = await db.query(
      'SELECT u.*, t.nama as guru_nama FROM users u LEFT JOIN teachers t ON u.guru_id = t.id WHERE u.email = ? OR u.username = ? LIMIT 1',
      [identifier, identifier]
    );

    if (user.length === 0) {
      return res.status(401).json({ success: false, message: 'Akun tidak ditemukan' });
    }

    const userData = user[0];

    // Verify password
    const bcrypt = require('bcryptjs');
    const validPassword = await bcrypt.compare(password, userData.password);
    if (!validPassword) {
      return res.status(401).json({ success: false, message: 'Password salah' });
    }

    // Generate JWT token
    const jwt = require('jsonwebtoken');
    const jwtToken = jwt.sign(
      { id: userData.id, username: userData.username, role: userData.role, guru_id: userData.guru_id },
      process.env.JWT_SECRET || 'ypwi_lutim_secret_key',
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token: jwtToken,
      user: {
        id: userData.id,
        username: userData.username,
        email: userData.email,
        role: userData.role,
        guru_id: userData.guru_id,
        nama: userData.guru_nama
      }
    });
  } catch (error) {
    console.error('Special login error:', error);
    res.status(500).json({ success: false, message: 'Gagal login' });
  }
});

// POST /api/public/profile-access/create-account - Create new account for verified user
router.post('/public/profile-access/create-account', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ success: false, message: 'Token dan password wajib diisi' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password minimal 6 karakter' });
    }

    // Find verification request
    const request = await db.query(
      'SELECT * FROM profile_access_requests WHERE verification_token = ? AND status = ? LIMIT 1',
      [token, 'approved']
    );

    if (request.length === 0) {
      return res.status(404).json({ success: false, message: 'Token verifikasi tidak valid atau expired' });
    }

    const reqData = request[0];

    // Check if user already exists
    const existingUser = await db.query(
      'SELECT id FROM users WHERE email = ? OR username = ?',
      [reqData.requester_email, reqData.ktp_nik]
    );

    if (existingUser.length > 0) {
      return res.status(400).json({ success: false, message: 'Akun dengan email/NIK tersebut sudah ada' });
    }

    // If matched with teacher, create user for teacher
    if (reqData.matched_teacher_id) {
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash(password, 10);

      const result = await db.query(
        'INSERT INTO users (username, email, password, role, guru_id, is_profile_complete, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
        [reqData.ktp_nik, reqData.requester_email, hashedPassword, 'guru', reqData.matched_teacher_id, 1]
      );

      const jwt = require('jsonwebtoken');
      const jwtToken = jwt.sign(
        { id: result.insertId, username: reqData.ktp_nik, role: 'guru', guru_id: reqData.matched_teacher_id },
        process.env.JWT_SECRET || 'ypwi_lutim_secret_key',
        { expiresIn: '7d' }
      );

      // Update request with new user ID
      await db.query('UPDATE profile_access_requests SET matched_user_id = ? WHERE id = ?', [result.insertId, reqData.id]);

      return res.json({
        success: true,
        token: jwtToken,
        user: {
          id: result.insertId,
          username: reqData.ktp_nik,
          email: reqData.requester_email,
          role: 'guru',
          guru_id: reqData.matched_teacher_id,
          nama: reqData.ktp_nama
        }
      });
    }

    // If no matched teacher, create generic user with is_profile_complete = 0
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await db.query(
      'INSERT INTO users (username, email, password, role, is_profile_complete, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [reqData.ktp_nik, reqData.requester_email, hashedPassword, 'public', 0]
    );

    const jwt = require('jsonwebtoken');
    const jwtToken = jwt.sign(
      { id: result.insertId, username: reqData.ktp_nik, role: 'public', is_profile_complete: 0 },
      process.env.JWT_SECRET || 'ypwi_lutim_secret_key',
      { expiresIn: '7d' }
    );

    // Update request with new user ID
    await db.query('UPDATE profile_access_requests SET matched_user_id = ? WHERE id = ?', [result.insertId, reqData.id]);

    res.json({
      success: true,
      token: jwtToken,
      user: {
        id: result.insertId,
        username: reqData.ktp_nik,
        email: reqData.requester_email,
        role: 'public',
        is_profile_complete: 0,
        nama: reqData.ktp_nama
      }
    });
  } catch (error) {
    console.error('Create account error:', error);
    res.status(500).json({ success: false, message: 'Gagal membuat akun' });
  }
});

// ==========================================
// DASHBOARD ROUTES
// ============================================

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
          await global.sendEmail(teacher.email, 'Pemberitahuan Aktivasi Akun - YPWI Lutim', htmlMessage, '', [], 'account_activation');
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
      WHERE s.status != 'alumni'
    `;
    let countParams = [];

    if (tenantId) {
      countQuery += ' AND s.tenant_id = ?';
      countParams.push(tenantId);
    }

    const search = req.query.search;
    const classId = req.query.class_id;
    const jenisKelamin = req.query.jenis_kelamin;
    if (search) {
      countQuery += ' AND (s.nama_siswa LIKE ? OR s.nisn LIKE ? OR s.nis LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (classId) {
      countQuery += ' AND s.class_id = ?';
      countParams.push(classId);
    }
    if (jenisKelamin) {
      countQuery += ' AND s.jenis_kelamin = ?';
      countParams.push(jenisKelamin);
    }

    const [totalResult] = await db.query(countQuery, countParams);
    const total = totalResult.total;

    let query = `
 SELECT s.id, s.nama_siswa, s.nisn, s.nis, s.jenis_kelamin, s.iuran_bulanan,
        s.class_id, s.tenant_id, s.tahun_masuk,
        c.nama_kelas, c.tingkatan, tn.nama_sekolah, p.nama_orang_tua, p.no_wa as no_wa_ortu
        FROM students s
        LEFT JOIN classes c ON s.class_id = c.id
        LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id
        LEFT JOIN parents p ON s.parent_id = p.id
        WHERE s.status != 'alumni'
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

    if (jenisKelamin) {
      query += ' AND s.jenis_kelamin = ?';
      params.push(jenisKelamin);
    }

    const sortBy = req.query.sortBy || 'nama_siswa';
    const sortDir = req.query.sortDir === 'DESC' ? 'DESC' : 'ASC';
    const allowedSortFields = {
      'nama_siswa': 's.nama_siswa',
      'nisn': 's.nisn',
      'nis': 's.nis',
      'nama_kelas': 'c.nama_kelas',
      'nama_sekolah': 'tn.nama_sekolah',
      'iuran_bulanan': 's.iuran_bulanan',
      'jenis_kelamin': 's.jenis_kelamin'
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

// ==========================================
// ALUMNI ROUTES - Manajemen Alumni
// ==========================================

// GET /api/admin/alumni - List alumni for current tenant, grouped by graduation year
router.get('/admin/alumni', authenticateOperator, async (req, res) => {
  try {
    let tenantId = Array.isArray(req.query.tenant_id) ? req.query.tenant_id[0] : req.query.tenant_id;
    if (!tenantId) {
      tenantId = req.user.tenant_id || (req.user.assignments?.[0]?.tenant_id);
    }
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'tenant_id wajib diisi' });
    }
    if (req.user.role !== 'admin' && !verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
    }

    const year = Array.isArray(req.query.year) ? req.query.year[0] : req.query.year; // Optional filter by graduation year

    let query = `
      SELECT s.id, s.nama_siswa, s.nisn, s.nis, s.jenis_kelamin, s.iuran_bulanan,
             s.tenant_id, s.tahun_masuk,
             c.nama_kelas, c.tingkatan, tn.nama_sekolah,
             p.nama_orang_tua, p.no_wa as no_wa_ortu
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE s.tenant_id = ? AND s.status = 'alumni'
    `;
    let params = [tenantId];

    if (year) {
      query += ' AND (c.tingkatan = ? OR s.tahun_masuk = ?)';
      params.push(year, year);
    }

    query += ' ORDER BY s.tahun_masuk DESC, s.nama_siswa ASC';

    const alumni = await db.query(query, params);

    // Get education history for each alumni
    for (const a of alumni) {
      const history = await db.query(
        `SELECT id, nama_sekolah, tahun_masuk, tahun_lulus, status
         FROM student_education_history
         WHERE student_id = ?
         ORDER BY tahun_masuk ASC`,
        [a.id]
      );
      a.education_history = history;
    }

    // Group by graduation year
    const grouped = {};
    alumni.forEach(a => {
      const yearKey = a.tahun_masuk || 'Unknown';
      if (!grouped[yearKey]) {
        grouped[yearKey] = [];
      }
      grouped[yearKey].push(a);
    });

    res.json({
      success: true,
      data: alumni,
      grouped: grouped,
      years: Object.keys(grouped).sort((a, b) => b - a) // Descending years
    });
  } catch (error) {
    console.error('Admin alumni error:', error);
    res.status(500).json({ success: false, message: 'Error fetching alumni' });
  }
});

// GET /api/admin/alumni/pool - List alumni available for adoption (from other schools)
router.get('/admin/alumni/pool', authenticateOperator, async (req, res) => {
  try {
    let tenantId = Array.isArray(req.query.tenant_id) ? req.query.tenant_id[0] : req.query.tenant_id;
    if (!tenantId) {
      tenantId = req.user.tenant_id || (req.user.assignments?.[0]?.tenant_id);
    }
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'tenant_id wajib diisi' });
    }

    const year = Array.isArray(req.query.year) ? req.query.year[0] : req.query.year; // Optional filter by graduation year

    let query = `
      SELECT s.id, s.nama_siswa, s.nisn, s.nis, s.jenis_kelamin, s.iuran_bulanan,
             s.tenant_id, s.tahun_masuk,
             c.nama_kelas, c.tingkatan, tn.nama_sekolah,
             p.nama_orang_tua, p.no_wa as no_wa_ortu
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE s.status = 'alumni' AND s.tenant_id != ?
    `;
    let params = [tenantId];

    if (year) {
      query += ' AND (c.tingkatan = ? OR s.tahun_masuk = ?)';
      params.push(year, year);
    }

    query += ' ORDER BY tn.nama_sekolah ASC, s.tahun_masuk DESC, s.nama_siswa ASC';

    const alumni = await db.query(query, params);

    // Get education history for each alumni
    for (const a of alumni) {
      const history = await db.query(
        `SELECT id, nama_sekolah, tahun_masuk, tahun_lulus, status
         FROM student_education_history
         WHERE student_id = ?
         ORDER BY tahun_masuk ASC`,
        [a.id]
      );
      a.education_history = history;
    }

    // Group by school and year
    const grouped = {};
    alumni.forEach(a => {
      const schoolKey = a.nama_sekolah || a.tenant_id;
      const yearKey = a.tahun_masuk || 'Unknown';
      const groupKey = `${schoolKey}|${yearKey}`;
      if (!grouped[groupKey]) {
        grouped[groupKey] = {
          school: schoolKey,
          year: yearKey,
          alumni: []
        };
      }
      grouped[groupKey].alumni.push(a);
    });

    res.json({
      success: true,
      data: alumni,
      grouped: Object.values(grouped)
    });
  } catch (error) {
    console.error('Admin alumni pool error:', error);
    res.status(500).json({ success: false, message: 'Error fetching alumni pool' });
  }
});

// POST /api/admin/alumni/:id/adopt - Adopt an alumni from another school
router.post('/admin/alumni/:id/adopt', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { class_id } = req.body;
    let tenantId = req.body.tenant_id || req.user.tenant_id || (req.user.assignments?.[0]?.tenant_id);

    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'tenant_id wajib diisi' });
    }

    // Get alumni data with previous school info
    const [student] = await db.query(
      `SELECT s.*, c.tingkatan, tn.nama_sekolah as nama_sekolah_asal 
       FROM students s 
       LEFT JOIN classes c ON s.class_id = c.id 
       LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id
       WHERE s.id = ? AND s.status = 'alumni'`,
      [id]
    );

    if (!student) {
      return res.status(404).json({ success: false, message: 'Alumni tidak ditemukan' });
    }

    if (student.tenant_id === tenantId) {
      return res.status(400).json({ success: false, message: 'Alumni sudah berada di sekolah ini' });
    }

    // Verify class belongs to tenant if provided
    if (class_id) {
      const [classCheck] = await db.query('SELECT id FROM classes WHERE id = ? AND tenant_id = ?', [class_id, tenantId]);
      if (!classCheck) {
        return res.status(400).json({ success: false, message: 'Kelas tidak valid untuk sekolah ini' });
      }
    }

    // Record education history for the previous school
    await db.query(
      `INSERT INTO student_education_history (student_id, tenant_id, nama_sekolah, tahun_masuk, tahun_lulus, status) 
       VALUES (?, ?, ?, ?, ?, 'lulus')`,
      [id, student.tenant_id, student.nama_sekolah_asal || 'Sekolah Asal', student.tahun_masuk, new Date().getFullYear().toString()]
    );

    // Adopt: move alumni to new school, set status to aktif
    await db.query(
      'UPDATE students SET tenant_id = ?, class_id = COALESCE(?, class_id), status = "aktif" WHERE id = ?',
      [tenantId, class_id || null, id]
    );

    res.json({
      success: true,
      message: `${student.nama_siswa} berhasil diadopsi`,
      data: { id, nama_siswa: student.nama_siswa }
    });
  } catch (error) {
    console.error('Adopt alumni error:', error);
    res.status(500).json({ success: false, message: 'Error adopting alumni' });
  }
});

// GET /api/admin/students/:id/education-history - Get student's education history
router.get('/admin/students/:id/education-history', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;

    const history = await db.query(
      `SELECT seh.*, tn.nama_sekolah 
       FROM student_education_history seh
       LEFT JOIN tenants tn ON seh.tenant_id = tn.tenant_id
       WHERE seh.student_id = ? 
       ORDER BY seh.tahun_masuk ASC, seh.created_at ASC`,
      [id]
    );

    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    console.error('Education history error:', error);
    res.status(500).json({ success: false, message: 'Error fetching education history' });
  }
});

// POST /api/admin/students/:id/education-history - Add education history record
router.post('/admin/students/:id/education-history', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { tenant_id, nama_sekolah, tahun_masuk, tahun_lulus, status, keterangan } = req.body;

    if (!nama_sekolah) {
      return res.status(400).json({ success: false, message: 'Nama sekolah wajib diisi' });
    }

    await db.query(
      `INSERT INTO student_education_history (student_id, tenant_id, nama_sekolah, tahun_masuk, tahun_lulus, status, keterangan) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, tenant_id || null, nama_sekolah, tahun_masuk || null, tahun_lulus || null, status || 'lulus', keterangan || null]
    );

    res.json({
      success: true,
      message: 'Riwayat pendidikan berhasil ditambahkan'
    });
  } catch (error) {
    console.error('Add education history error:', error);
    res.status(500).json({ success: false, message: 'Error adding education history' });
  }
});

// PUT /api/admin/students/:id/education-history/:historyId - Update education history record
router.put('/admin/students/:id/education-history/:historyId', authenticateOperator, async (req, res) => {
  try {
    const { id, historyId } = req.params;
    const { tenant_id, nama_sekolah, tahun_masuk, tahun_lulus, status, keterangan } = req.body;

    await db.query(
      `UPDATE student_education_history 
       SET tenant_id = ?, nama_sekolah = ?, tahun_masuk = ?, tahun_lulus = ?, status = ?, keterangan = ?
       WHERE id = ? AND student_id = ?`,
      [tenant_id || null, nama_sekolah, tahun_masuk || null, tahun_lulus || null, status || 'lulus', keterangan || null, historyId, id]
    );

    res.json({
      success: true,
      message: 'Riwayat pendidikan berhasil diupdate'
    });
  } catch (error) {
    console.error('Update education history error:', error);
    res.status(500).json({ success: false, message: 'Error updating education history' });
  }
});

// DELETE /api/admin/students/:id/education-history/:historyId - Delete education history record
router.delete('/admin/students/:id/education-history/:historyId', authenticateOperator, async (req, res) => {
  try {
    const { id, historyId } = req.params;

    await db.query(
      'DELETE FROM student_education_history WHERE id = ? AND student_id = ?',
      [historyId, id]
    );

    res.json({
      success: true,
      message: 'Riwayat pendidikan berhasil dihapus'
    });
  } catch (error) {
    console.error('Delete education history error:', error);
    res.status(500).json({ success: false, message: 'Error deleting education history' });
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
      SELECT s.id, s.nama_siswa, s.nisn, s.nis, s.jenis_kelamin, s.iuran_bulanan, s.tahun_masuk,
             c.nama_kelas, c.tingkatan, tn.nama_sekolah,
             p.id as parent_id, p.nama_orang_tua, p.no_wa as no_wa_ortu
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE s.tenant_id = ?
        AND s.status != 'alumni'
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
      SELECT s.id, s.nama_siswa, s.nisn, s.jenis_kelamin, s.iuran_bulanan,
             s.ransportasi, s.subsidi, s.privat, s.biaya_lain, s.biaya_lain_nama,
             s.status, s.tahun_masuk, s.class_id, s.tenant_id,
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
          OR s.nama_siswa IS NULL OR s.nama_siswa = ''
          OR s.class_id IS NULL
          OR s.privat IS NULL
          OR s.biaya_lain IS NULL
          OR s.biaya_lain_nama IS NULL OR s.biaya_lain_nama = ''
          OR s.status IS NULL OR s.status = ''
          OR s.tahun_masuk IS NULL OR s.tahun_masuk = ''
        )
      ORDER BY c.nama_kelas ASC, s.nama_siswa ASC
    `, [tenantId]);

    const data = students.map(s => ({
      'ID Siswa': s.id,
      'NISN': s.nisn || '',
      'Nama Siswa': s.nama_siswa || '',
      'Nama Kelas': s.nama_kelas || '',
      'Jenis Kelamin': s.jenis_kelamin || '',
      'Nama Orang Tua': s.nama_orang_tua || '',
      'No. WhatsApp': normalizeWhatsAppNumber(s.no_wa_ortu) || '',
      'Iuran Bulanan': s.iuran_bulanan ?? '',
      'Transportasi': s.ransportasi ?? 0,
      'Subsidi': s.subsidi ?? 0,
      'Privat': s.privat ?? 0,
      'Biaya Lain': s.biaya_lain ?? 0,
      'Biaya Lain Nama': s.biaya_lain_nama || '',
      'Status': s.status || 'aktif',
      'Tahun Masuk': s.tahun_masuk || ''
    }));

    const ws = XLSX.utils.json_to_sheet(data.length ? data : [{
      'ID Siswa': '', 'NISN': '', 'Nama Siswa': '', 'Nama Kelas': '',
      'Jenis Kelamin': '', 'Nama Orang Tua': '', 'No. WhatsApp': '', 'Iuran Bulanan': '',
      'Transportasi': '', 'Subsidi': '', 'Privat': '', 'Biaya Lain': '',
      'Biaya Lain Nama': '', 'Status': 'aktif', 'Tahun Masuk': ''
    }]);

    // Set WhatsApp column as text format to prevent scientific notation
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let row = 1; row <= range.e.row; row++) {
      const cellRef = XLSX.utils.encode_cell({ r: row, c: 6 }); // Column G = No. WhatsApp
      if (ws[cellRef]) {
        ws[cellRef].t = 's'; // Force string type
      }
    }
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

// GET /api/admin/students/export - Export ALL students as Excel (ALL COLUMNS for bulk editing)
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
      SELECT s.id, s.nama_siswa, s.nisn, s.jenis_kelamin, s.iuran_bulanan,
             s.ransportasi, s.subsidi, s.privat, s.biaya_lain, s.biaya_lain_nama,
             s.status, s.tahun_masuk, s.class_id, s.tenant_id,
             c.nama_kelas, p.nama_orang_tua, p.no_wa as no_wa_ortu
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE s.tenant_id = ?
      ORDER BY c.nama_kelas ASC, s.nama_siswa ASC
    `, [tenantId]);

    const data = students.map(s => ({
      'ID Siswa': s.id,
      'NISN': s.nisn || '',
      'Nama Siswa': s.nama_siswa,
      'Nama Kelas': s.nama_kelas || '',
      'Jenis Kelamin': s.jenis_kelamin || '',
      'Nama Orang Tua': s.nama_orang_tua || '',
      'No. WhatsApp': normalizeWhatsAppNumber(s.no_wa_ortu) || '',
      'Iuran Bulanan': s.iuran_bulanan ?? '',
      'Transportasi': s.ransportasi ?? 0,
      'Subsidi': s.subsidi ?? 0,
      'Privat': s.privat ?? 0,
      'Biaya Lain': s.biaya_lain ?? 0,
      'Biaya Lain Nama': s.biaya_lain_nama || '',
      'Status': s.status || 'aktif',
      'Tahun Masuk': s.tahun_masuk || ''
    }));

    const ws = XLSX.utils.json_to_sheet(data.length ? data : [{
      'ID Siswa': '', 'NISN': '', 'Nama Siswa': '', 'Nama Kelas': '',
      'Jenis Kelamin': '', 'Nama Orang Tua': '', 'No. WhatsApp': '', 'Iuran Bulanan': '',
      'Transportasi': '', 'Subsidi': '', 'Privat': '', 'Biaya Lain': '',
      'Biaya Lain Nama': '', 'Status': 'aktif', 'Tahun Masuk': ''
    }]);

    // Set WhatsApp column as text format to prevent scientific notation
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let row = 1; row <= range.e.row; row++) {
      const cellRef = XLSX.utils.encode_cell({ r: row, c: 6 }); // Column G = No. WhatsApp
      if (ws[cellRef]) {
        ws[cellRef].t = 's'; // Force string type
      }
    }
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
      const namaKelas = String(r['Nama Kelas'] || '').trim();

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

      // Parse semua kolom
      const nisn = String(r['NISN'] || '').trim() || null;
      const jk = String(r['Jenis Kelamin'] || '').trim() || null;
      const namaOrangTua = String(r['Nama Orang Tua'] || '').trim() || null;
      const noWaRaw = r['No. WhatsApp'];
      let noWa = null;
      if (noWaRaw !== undefined && noWaRaw !== null && noWaRaw !== '') {
        // Handle scientific notation (e.g., 6.2824E+12) by converting to full number
        if (typeof noWaRaw === 'number' && String(noWaRaw).toUpperCase().includes('E')) {
          noWa = Math.round(noWaRaw).toString();
        } else {
          noWa = String(noWaRaw).trim();
        }
        // Normalize: 082... → 6282...
        noWa = normalizeWhatsAppNumber(noWa);
      }
      const iuranRaw = String(r['Iuran Bulanan'] || '').trim();
      const iuran = iuranRaw === '' ? null : parseFloat(iuranRaw);
      const transportasiRaw = String(r['Transportasi'] || '').trim();
      const transportasi = transportasiRaw === '' ? null : parseFloat(transportasiRaw);
      const subsidiRaw = String(r['Subsidi'] || '').trim();
      const subsidi = subsidiRaw === '' ? null : parseFloat(subsidiRaw);
      const privatRaw = String(r['Privat'] || '').trim();
      const privat = privatRaw === '' ? null : parseFloat(privatRaw);
      const biayaLainRaw = String(r['Biaya Lain'] || '').trim();
      const biayaLain = biayaLainRaw === '' ? null : parseFloat(biayaLainRaw);
      const biayaLainNama = String(r['Biaya Lain Nama'] || '').trim() || null;
      const status = String(r['Status'] || '').trim() || null;
      // Tahun Masuk: terima "Tahun Masuk" (baru) atau "Tanggal Masuk" (legacy)
      const tahunMasukRaw = String(r['Tahun Masuk'] || r['Tanggal Masuk'] || '').trim();
      let tahunMasuk = null;
      const yearMatch = tahunMasukRaw.match(/\d{4}/);
      if (yearMatch) {
        tahunMasuk = yearMatch[0];
      }

      // Validasi wajib (semua wajib kecuali Transportasi, Subsidi, NISN)
      if (!namaSiswaRaw) {
        errors.push(`Baris ${rowNo}: Nama Siswa wajib diisi`);
        continue;
      }
      if (!namaKelas) {
        errors.push(`Baris ${rowNo}: Nama Kelas wajib diisi`);
        continue;
      }
      if (!jk || !['L', 'P'].includes(jk.toUpperCase())) {
        errors.push(`Baris ${rowNo}: Jenis Kelamin wajib diisi (L atau P)`);
        continue;
      }
      if (!namaOrangTua) {
        errors.push(`Baris ${rowNo}: Nama Orang Tua wajib diisi`);
        continue;
      }
      if (!noWa) {
        errors.push(`Baris ${rowNo}: No. WhatsApp wajib diisi`);
        continue;
      }
      if (!iuranRaw || isNaN(iuran)) {
        errors.push(`Baris ${rowNo}: Iuran Bulanan wajib diisi (nominal)`);
        continue;
      }
      if (!status) {
        errors.push(`Baris ${rowNo}: Status wajib diisi (aktif / alumni / mutasi / keluar)`);
        continue;
      }
      if (!tahunMasuk) {
        errors.push(`Baris ${rowNo}: Tahun Masuk wajib diisi (format: 4 digit tahun, contoh: 2024)`);
        continue;
      }
      // Validate tahun_masuk is 4 digit year (e.g., 2020-2099)
      if (!/^\d{4}$/.test(tahunMasuk)) {
        errors.push(`Baris ${rowNo}: Tahun Masuk harus 4 digit tahun (contoh: 2024), dapat: "${tahunMasuk}"`);
        continue;
      }
      const tahunNum = parseInt(tahunMasuk);
      if (tahunNum < 1900 || tahunNum > 2100) {
        errors.push(`Baris ${rowNo}: Tahun Masuk tidak valid: ${tahunMasuk}`);
        continue;
      }

      // Cari class_id berdasarkan nama kelas
      let classId = null;
      const [classRow] = await db.query('SELECT id FROM classes WHERE nama_kelas = ? AND tenant_id = ?', [namaKelas, tenantId]);
      if (classRow) classId = classRow.id;
      else {
        errors.push(`Baris ${rowNo}: Kelas "${namaKelas}" tidak ditemukan di tenant ini`);
        continue;
      }

      // Update siswa
      await db.query(
        `UPDATE students SET
          nisn = COALESCE(?, nisn),
          nama_siswa = COALESCE(?, nama_siswa),
          jenis_kelamin = COALESCE(?, jenis_kelamin),
          class_id = COALESCE(?, class_id),
          iuran_bulanan = COALESCE(?, iuran_bulanan),
          ransportasi = COALESCE(?, ransportasi),
          subsidi = COALESCE(?, subsidi),
          privat = COALESCE(?, privat),
          biaya_lain = COALESCE(?, biaya_lain),
          biaya_lain_nama = COALESCE(?, biaya_lain_nama),
          status = COALESCE(?, status),
          tahun_masuk = COALESCE(?, tahun_masuk)
        WHERE id = ?`,
        [nisn, namaSiswaRaw, jk, classId, iuran, transportasi, subsidi, privat, biayaLain, biayaLainNama, status, tahunMasuk, stu.id]
      );

      // Update/create parent
      if (stu.parent_id) {
        await db.query(
          'UPDATE parents SET nama_orang_tua = COALESCE(?, nama_orang_tua), no_wa = COALESCE(?, no_wa) WHERE id = ?',
          [namaOrangTua, noWa, stu.parent_id]
        );
      } else if (namaOrangTua || noWa) {
        const ins = await db.query('INSERT INTO parents (nama_orang_tua, no_wa) VALUES (?, ?)', [namaOrangTua, noWa]);
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

// POST /api/admin/students/import - Import new students from Excel (ALL COLUMNS)
router.post('/admin/students/import', authenticateOperator, excelUpload.single('file'), async (req, res) => {
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

    // Opsi auto-generate billing setelah import
    // Default: bulan 7 (Juli) — overridable via req.body.billing_start (format "YYYY-MM")
    const billingStart = (req.body.billing_start || '7').toString().trim();
    const autoBilling = req.body.auto_billing !== 'false'; // default true

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    const errors = [];
    let created = 0;
    let updated = 0;
    const newStudentIds = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNo = i + 2;
      
      // Semua kolom dari tabel students
      const idSiswa = r['ID Siswa'] ? parseInt(r['ID Siswa']) : null;
      const nisn = String(r['NISN'] || '').trim() || null;
      const namaSiswa = String(r['Nama Siswa'] || '').trim();
      const jk = String(r['Jenis Kelamin'] || '').trim();
      const namaKelas = String(r['Nama Kelas'] || '').trim();
      const namaOrangTua = String(r['Nama Orang Tua'] || '').trim();
      const noWaRaw = r['No. WhatsApp'];
      let noWa = '';
      if (noWaRaw !== undefined && noWaRaw !== null && noWaRaw !== '') {
        // Handle scientific notation (e.g., 6.2824E+12) by converting to full number
        if (typeof noWaRaw === 'number' && String(noWaRaw).toUpperCase().includes('E')) {
          noWa = Math.round(noWaRaw).toString();
        } else {
          noWa = String(noWaRaw).trim();
        }
        // Normalize: 082... → 6282...
        noWa = normalizeWhatsAppNumber(noWa);
      }
      const iuranRaw = String(r['Iuran Bulanan'] || '').trim();
      const iuran = iuranRaw === '' ? 0 : parseFloat(iuranRaw);
      const transportasiRaw = String(r['Transportasi'] || '').trim();
      const transportasi = transportasiRaw === '' ? 0 : parseFloat(transportasiRaw);
      const subsidiRaw = String(r['Subsidi'] || '').trim();
      const subsidi = subsidiRaw === '' ? 0 : parseFloat(subsidiRaw);
      const privatRaw = String(r['Privat'] || '').trim();
      const privat = privatRaw === '' ? 0 : parseFloat(privatRaw);
      const biayaLainRaw = String(r['Biaya Lain'] || '').trim();
      const biayaLain = biayaLainRaw === '' ? 0 : parseFloat(biayaLainRaw);
      const biayaLainNama = String(r['Biaya Lain Nama'] || '').trim();
      const status = String(r['Status'] || '').trim();
      // Tahun Masuk: terima "Tahun Masuk" (baru) atau "Tanggal Masuk" (legacy)
      let tahunMasukRaw = String(r['Tahun Masuk'] || r['Tanggal Masuk'] || '').trim();
      // Extract 4 digit tahun dari string apapun (2011, 2024-07, 15/07/2024, dst)
      let tahunMasuk = '';
      const yearMatch = tahunMasukRaw.match(/\d{4}/);
      if (yearMatch) {
        tahunMasuk = yearMatch[0];
      }

      // Validasi wajib (semua wajib kecuali Transportasi, Subsidi, NISN)
      if (!namaSiswa) {
        errors.push(`Baris ${rowNo}: Nama Siswa wajib diisi`);
        continue;
      }
      if (!namaKelas) {
        errors.push(`Baris ${rowNo}: Nama Kelas wajib diisi`);
        continue;
      }
      if (!jk || !['L', 'P'].includes(jk.toUpperCase())) {
        errors.push(`Baris ${rowNo}: Jenis Kelamin wajib diisi (L atau P)`);
        continue;
      }
      if (!namaOrangTua) {
        errors.push(`Baris ${rowNo}: Nama Orang Tua wajib diisi`);
        continue;
      }
      if (!noWa) {
        errors.push(`Baris ${rowNo}: No. WhatsApp wajib diisi`);
        continue;
      }
      if (!iuranRaw || isNaN(iuran)) {
        errors.push(`Baris ${rowNo}: Iuran Bulanan wajib diisi (nominal)`);
        continue;
      }
      if (!status) {
        errors.push(`Baris ${rowNo}: Status wajib diisi (aktif / alumni / mutasi / keluar)`);
        continue;
      }
      if (!tahunMasuk) {
        errors.push(`Baris ${rowNo}: Tahun Masuk wajib diisi (format: 4 digit tahun, contoh: 2024)`);
        continue;
      }
      // Validate tahun_masuk is 4 digit year (e.g., 2020-2099)
      if (!/^\d{4}$/.test(tahunMasuk)) {
        errors.push(`Baris ${rowNo}: Tahun Masuk harus 4 digit tahun (contoh: 2024), dapat: "${tahunMasuk}"`);
        continue;
      }
      const tahunNum = parseInt(tahunMasuk);
      if (tahunNum < 1900 || tahunNum > 2100) {
        errors.push(`Baris ${rowNo}: Tahun Masuk tidak valid: ${tahunMasuk}`);
        continue;
      }

      // Cari class_id berdasarkan nama kelas
      let classId = null;
      const [classRow] = await db.query('SELECT id FROM classes WHERE nama_kelas = ? AND tenant_id = ?', [namaKelas, tenantId]);
      if (classRow) classId = classRow.id;
      else {
        errors.push(`Baris ${rowNo}: Kelas "${namaKelas}" tidak ditemukan di tenant ini`);
        continue;
      }

      // Buat/update parent jika ada data orang tua
      let parentId = null;
      if (namaOrangTua || noWa) {
        const ins = await db.query('INSERT INTO parents (nama_orang_tua, no_wa) VALUES (?, ?)', [namaOrangTua, noWa]);
        parentId = ins.insertId;
      }

      if (idSiswa) {
        // Update siswa yang sudah ada
        const [existing] = await db.query('SELECT id FROM students WHERE id = ? AND tenant_id = ?', [idSiswa, tenantId]);
        if (!existing) {
          errors.push(`Baris ${rowNo}: ID Siswa "${idSiswa}" tidak ditemukan`);
          continue;
        }
        await db.query(
          `UPDATE students SET 
            nisn = COALESCE(?, nisn),
            nama_siswa = COALESCE(?, nama_siswa),
            jenis_kelamin = COALESCE(?, jenis_kelamin),
            class_id = COALESCE(?, class_id),
            parent_id = COALESCE(?, parent_id),
            iuran_bulanan = COALESCE(?, iuran_bulanan),
            ransportasi = COALESCE(?, ransportasi),
            subsidi = COALESCE(?, subsidi),
            privat = COALESCE(?, privat),
            biaya_lain = COALESCE(?, biaya_lain),
            biaya_lain_nama = COALESCE(?, biaya_lain_nama),
            status = COALESCE(?, status),
            tahun_masuk = COALESCE(?, tahun_masuk)
          WHERE id = ?`,
          [nisn, namaSiswa || null, jk, classId, parentId, iuran, transportasi, subsidi, privat, biayaLain, biayaLainNama, status, tahunMasuk, idSiswa]
        );
        updated++;
      } else {
        // Insert siswa baru - NIS akan di-generate otomatis
        const result = await db.query(
          `INSERT INTO students (
            tenant_id, nisn, nama_siswa, jenis_kelamin, class_id, parent_id,
            iuran_bulanan, ransportasi, subsidi, privat, biaya_lain,
            biaya_lain_nama, status, tahun_masuk
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [tenantId, nisn, namaSiswa, jk, classId, parentId, iuran, transportasi, subsidi, privat, biayaLain, biayaLainNama, status, tahunMasuk]
        );

        // Validate required data for NIS generation
        const nisErrors = [];
        const hasTahunMasuk = tahunMasuk && String(tahunMasuk).trim() !== '';
        if (!hasTahunMasuk) {
          nisErrors.push('Tahun Masuk');
        }
        if (!tenantId) nisErrors.push('Sekolah (Tenant)');
        if (!parentId) nisErrors.push('Data Orang Tua (Parent)');

        if (nisErrors.length > 0) {
          errors.push(`Baris ${rowNo}: NIS tidak bisa di-generate. Data belum lengkap: ${nisErrors.join(', ')}`);
          continue;
        }

        // Auto-generate NIS
        let tahun = null;
        if (tahunMasuk) {
          // tahunMasuk sudah berupa 4 digit dari extract regex
          if (String(tahunMasuk).length === 4) {
            tahun = String(tahunMasuk);
          }
        }
        if (!tahun) tahun = String(new Date().getFullYear());
        tahun = String(tahun).padStart(4, '0');

        let tenantNumericId = '0';
        try {
          const tenantRes = await db.query('SELECT id FROM tenants WHERE tenant_id = ? LIMIT 1', [tenantId]);
          if (tenantRes.length > 0 && tenantRes[0].id) {
            tenantNumericId = String(tenantRes[0].id);
          }
        } catch (e) {}

        // Validate tenant has numeric ID
        if (tenantNumericId === '0') {
          errors.push(`Baris ${rowNo}: NIS tidak bisa di-generate. Tenant tidak memiliki ID numerik`);
          continue;
        }

        const tenantPart = tenantNumericId.padStart(2, '0');
        const parentPart = String(parentId).padStart(3, '0');
        const studentPart = String(result.insertId).padStart(4, '0');

        const nisValue = tahun + tenantPart + parentPart + studentPart;

        const [existingNis] = await db.query('SELECT id FROM students WHERE id != ? AND nis = ?', [result.insertId, nisValue]);
        if (existingNis) {
          errors.push(`Baris ${rowNo}: NIS "${nisValue}" sudah digunakan (konflik generate)`);
          continue;
        }

        await db.query('UPDATE students SET nis = ? WHERE id = ?', [nisValue, result.insertId]);
        newStudentIds.push(result.insertId);
        created++;
      }
    }

    // Auto-generate billing untuk siswa yang baru di-import
    let billingResult = null;
    if (autoBilling && newStudentIds.length > 0) {
      try {
        await billing.ensureBillingTables();
        // billing_start: "7" → Juli tahun ini; "2026-07" → explicit
        let startMonth;
        if (/^\d{4}-\d{2}$/.test(billingStart)) {
          startMonth = billingStart;
        } else {
          const m = parseInt(billingStart, 10) || 7;
          const y = new Date().getFullYear();
          startMonth = `${y}-${String(m).padStart(2, '0')}`;
        }
        const currentYear = new Date().getFullYear();
        const currentMonthNum = new Date().getMonth() + 1;
        const endMonth = `${currentYear}-${String(currentMonthNum).padStart(2, '0')}`;

        // Ambil iuran siswa yang baru di-import
        const placeholders = newStudentIds.map(() => '?').join(',');
        const importedStudents = await db.query(
          `SELECT id, tenant_id, iuran_bulanan, ransportasi, subsidi, va_number
           FROM students WHERE id IN (${placeholders})`,
          newStudentIds
        );

        // Biaya admin VA global
        const psResult = await db.query(
          `SELECT biaya_admin_va FROM payment_admin_settings WHERE subject_type = 'global' AND subject_id = 0 LIMIT 1`
        );
        const ps = Array.isArray(psResult) ? psResult[0] : psResult;
        const globalBiayaAdmin = ps ? (parseFloat(ps.biaya_admin_va) || 0) : 2000;

        let billingCreated = 0;
        const months = monthList(startMonth, endMonth);
        for (const s of importedStudents) {
          const spp = parseFloat(s.iuran_bulanan) || 0;
          if (spp <= 0) continue;
          const transport = parseFloat(s.ransportasi) || 0;
          const subsidi = parseFloat(s.subsidi) || 0;
          const biayaAdmin = s.va_number ? globalBiayaAdmin : 0;
          const totalTagihan = Math.max(0, spp + transport - subsidi + biayaAdmin);

          for (const m of months) {
            // Skip jika bulan sudah lewat dari tahun ajaran (mis. tahun ajaran 2026/2027 mulai Juli 2026)
            const [my, mm] = m.split('-').map(Number);
            // Tentukan tahunajaran: jika startMonth Juli 2026, maka bulan 7-12 = 2026, 1-6 = 2027
            const [sy, sm] = startMonth.split('-').map(Number);
            const isPast = (my < sy) || (my === sy && mm < sm);
            if (isPast) continue;
            // Skip jika bulan > endMonth
            if (m > endMonth) continue;

            const [existing] = await db.query(
              'SELECT id FROM billing_payment WHERE student_id = ? AND bulan = ?',
              [s.id, m]
            );
            if (existing) continue;
            await db.query(
              `INSERT INTO billing_payment
                (tenant_id, student_id, spp_bulanan, ransportasi, subsidi, biaya_admin_va, bulan, transaksi, keterangan_spp, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'belum')`,
              [s.tenant_id, s.id, spp, transport, subsidi, biayaAdmin, m, totalTagihan]
            );
            billingCreated++;
          }
        }
        billingResult = { created: billingCreated, start_month: startMonth, end_month: endMonth };
      } catch (billErr) {
        console.error('[IMPORT] Auto-billing error:', billErr.message);
        billingResult = { error: billErr.message };
      }
    }

    res.json({
      success: true,
      created, updated, errors,
      message: `${created} siswa ditambahkan, ${updated} siswa diperbarui${billingResult && billingResult.created ? `, ${billingResult.created} billing dibuat dari ${billingResult.start_month}` : ''}`,
      billing: billingResult
    });
  } catch (error) {
    console.error('Import students error:', error);
    res.status(500).json({ success: false, message: 'Error import siswa: ' + error.message });
  }
});

// GET /api/admin/students/import-template - Download template for student import (ALL COLUMNS)
router.get('/admin/students/import-template', authenticateOperator, async (req, res) => {
  try {
    console.log('[TEMPLATE] Downloading student import template, tenant:', req.query.tenant_id);
    
    const tenantId = req.query.tenant_id;

    // Ambil daftar kelas untuk referensi
    const classes = tenantId ? await db.query(
      'SELECT id, nama_kelas FROM classes WHERE tenant_id = ? ORDER BY nama_kelas ASC',
      [tenantId]
    ) : [];

    // Buat template dengan semua kolom
    const data = [{
      'ID Siswa': '',
      'NISN': '',
      'Nama Siswa': '',
      'Nama Kelas': '',
      'Jenis Kelamin': '',
      'Nama Orang Tua': '',
      'No. WhatsApp': '',
      'Iuran Bulanan': '',
      'Transportasi': '',
      'Subsidi': '',
      'Privat': '',
      'Biaya Lain': '',
      'Biaya Lain Nama': '',
      'Status': 'aktif',
      'Tahun Masuk': ''
    }];

    const ws = XLSX.utils.json_to_sheet(data);

    // Set WhatsApp column as text format to prevent scientific notation
    const waCellRef = XLSX.utils.encode_cell({ r: 1, c: 6 }); // Row 2 (data row), Column G = No. WhatsApp
    if (ws[waCellRef]) {
      ws[waCellRef].t = 's'; // Force string type
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Import Siswa');

    // Tambahkan sheet kelas sebagai referensi
    if (classes.length > 0) {
      const classData = classes.map(c => ({ 'ID Kelas': c.id, 'Nama Kelas': c.nama_kelas }));
      const classWs = XLSX.utils.json_to_sheet(classData);
      XLSX.utils.book_append_sheet(wb, classWs, 'Referensi Kelas');
    }

    // Tambahkan sheet keterangan
    const keterangan = [
      { 'Kolom': 'ID Siswa', 'Keterangan': 'Kosongkan untuk siswa baru, isi untuk update' },
      { 'Kolom': 'NISN', 'Keterangan': 'Opsional' },
      { 'Kolom': 'Nama Siswa', 'Keterangan': 'Wajib diisi' },
      { 'Kolom': 'Nama Kelas', 'Keterangan': 'Wajib diisi (sesuai nama kelas di sistem)' },
      { 'Kolom': 'Jenis Kelamin', 'Keterangan': 'Wajib diisi (L atau P)' },
      { 'Kolom': 'Nama Orang Tua', 'Keterangan': 'Wajib diisi' },
      { 'Kolom': 'No. WhatsApp', 'Keterangan': 'Wajib diisi. Format: 08xxx atau 628xxx. Otomatis dinormalisasi ke 628xxx' },
      { 'Kolom': 'Iuran Bulanan', 'Keterangan': 'Wajib diisi (nominal)' },
      { 'Kolom': 'Transportasi', 'Keterangan': 'Opsional (nominal, default 0)' },
      { 'Kolom': 'Subsidi', 'Keterangan': 'Opsional (nominal, default 0)' },
      { 'Kolom': 'Privat', 'Keterangan': 'Opsional (nominal, default 0)' },
      { 'Kolom': 'Biaya Lain', 'Keterangan': 'Opsional (nominal, default 0)' },
      { 'Kolom': 'Biaya Lain Nama', 'Keterangan': 'Opsional (keterangan biaya lain)' },
      { 'Kolom': 'Status', 'Keterangan': 'Wajib diisi (aktif / alumni / mutasi / keluar)' },
      { 'Kolom': 'Tahun Masuk', 'Keterangan': 'Wajib diisi (4 digit tahun, contoh: 2024). Untuk generate NIS otomatis.' }
    ];
    const ketWs = XLSX.utils.json_to_sheet(keterangan);
    XLSX.utils.book_append_sheet(wb, ketWs, 'Keterangan');

    // Tambahkan sheet contoh format
    const contohFormat = [
      { 'Format': 'MM-YYYY', 'Contoh': '07-2024', 'Hasil': '2024-07 → Tahun: 2024' },
      { 'Format': 'YYYY-MM', 'Contoh': '2024-07', 'Hasil': '2024-07 → Tahun: 2024' },
      { 'Format': 'YYYY-MM-DD', 'Contoh': '2024-07-15', 'Hasil': '2024-07-15 → Tahun: 2024' },
      { 'Format': 'DD/MM/YYYY', 'Contoh': '15/07/2024', 'Hasil': '15/07/2024 → Tahun: 2024' },
      { 'Format': 'DD-MM-YYYY', 'Contoh': '15-07-2024', 'Hasil': '15-07-2024 → Tahun: 2024' },
      { 'Format': 'YYYY', 'Contoh': '2024', 'Hasil': '2024 → Tahun: 2024' }
    ];
    const contohWs = XLSX.utils.json_to_sheet(contohFormat);
    XLSX.utils.book_append_sheet(wb, contohWs, 'Contoh Format Tanggal');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    console.log('[TEMPLATE] Template generated, size:', buf.length, 'bytes');

    res.setHeader('Content-Disposition', 'attachment; filename="template_import_siswa.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Length', buf.length);
    res.end(buf);
  } catch (error) {
    console.error('[TEMPLATE] Download error:', error);
    res.status(500).json({ success: false, message: 'Error download template: ' + error.message });
  }
});

// GET /api/admin/students/all - List all students (no pagination)
router.get('/admin/students/all', authenticateOperator, async (req, res) => {
  try {
    const params = [];

    let query = `
      SELECT s.id, s.nama_siswa, s.nisn, s.nis, s.jenis_kelamin, s.iuran_bulanan,
             s.class_id, s.tenant_id, s.tahun_masuk,
             c.nama_kelas, c.tingkatan, tn.nama_sekolah, p.no_wa as no_wa_ortu
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE s.status != 'alumni'
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
    let isSpecialExit = false;
    let statusText = 'dimutasi';

    // Handle special exit reasons: 'keluar' (leaving) and 'lulus' (graduating)
    if (target_tenant_id === 'keluar' || target_tenant_id === 'lulus') {
      isSpecialExit = true;
      statusText = target_tenant_id === 'keluar' ? 'dikeluarkan' : 'lulus';
      newTenantId = oldTenantId; // keep student in same tenant, just clear class
    }

    // Backward compat: "other" option with custom tenant name (admin-dashboard legacy)
    if (target_tenant_id === 'other' && target_tenant_name) {
      const [existingTenant] = await db.query('SELECT tenant_id FROM tenants WHERE tenant_id = ?', [target_tenant_name]);
      if (existingTenant) {
        newTenantId = existingTenant.tenant_id;
      } else {
        await db.query(
          'INSERT INTO tenants (tenant_id, nama_sekolah) VALUES (?, ?)',
          [target_tenant_name, target_tenant_name]
        );
        newTenantId = target_tenant_name;
      }
    }

    if (!isSpecialExit && !newTenantId) {
      return res.status(400).json({ success: false, message: 'Tujuan mutasi wajib diisi' });
    }

    // Get old school name for education history
    const [oldSchool] = await db.query('SELECT nama_sekolah FROM tenants WHERE tenant_id = ?', [oldTenantId]);

    // Record education history for the old school
    if (oldTenantId && oldSchool) {
      const historyStatus = isSpecialExit ? (target_tenant_id === 'lulus' ? 'lulus' : 'keluar') : 'pindah';
      await db.query(
        `INSERT INTO student_education_history (student_id, tenant_id, nama_sekolah, tahun_masuk, tahun_lulus, status, keterangan) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, oldTenantId, oldSchool.nama_sekolah, student.tahun_masuk, new Date().getFullYear().toString(), historyStatus, reason || null]
      );
    }

    // Record mutasi in mutasi_students table (for tracking)
    await db.query(
      'INSERT INTO mutasi_students (student_id, old_tenant_id, new_tenant_id, reason, created_at) VALUES (?, ?, ?, ?, NOW())',
      [id, oldTenantId, newTenantId, reason || null]
    );

    // Update student: clear class_id, set mutasi_status
    // For special exits (keluar/lulus), keep tenant_id unchanged
    try {
      if (isSpecialExit) {
        await db.query(
          'UPDATE students SET class_id = NULL, mutasi_status = ? WHERE id = ?',
          ['completed', id]
        );
      } else {
        await db.query(
          'UPDATE students SET tenant_id = ?, class_id = NULL, mutasi_status = ? WHERE id = ?',
          [newTenantId, 'completed', id]
        );
      }
    } catch (colError) {
      if (isSpecialExit) {
        await db.query(
          'UPDATE students SET class_id = NULL WHERE id = ?',
          [id]
        );
      } else {
        await db.query(
          'UPDATE students SET tenant_id = ?, class_id = NULL WHERE id = ?',
          [newTenantId, id]
        );
      }
    }

    const tujuanText = isSpecialExit ? statusText : newTenantId;
    res.json({ success: true, message: `${student.nama_siswa} berhasil ${statusText}${isSpecialExit ? '' : ' ke ' + tujuanText}` });
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
      'SELECT s.*, c.nama_kelas, c.tingkatan, tn.nama_sekolah, p.id as parent_id_ref, p.nama_orang_tua, p.no_wa as no_wa_ortu, p.nik as nik_orang_tua, p.email as email_orang_tua FROM students s LEFT JOIN classes c ON s.class_id = c.id LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id LEFT JOIN parents p ON s.parent_id = p.id WHERE s.id = ?',
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
    await ensureStudentColumns();
    const {
      tenant_id, nis, nisn, nama_siswa, jenis_kelamin, class_id, parent_id, iuran_bulanan,
      ransportasi, subsidi, privat, biaya_lain, biaya_lain_nama, status, tahun_masuk,
      nama_orang_tua, no_wa, email_orang_tua, nik_orang_tua
    } = req.body;

    const fields = {
      tenant_id: tenant_id,
      nis, nisn, nama_siswa, jenis_kelamin, class_id,
      iuran_bulanan: parseFloat(iuran_bulanan) || 0, ransportasi: parseFloat(ransportasi) || 0,
      subsidi: parseFloat(subsidi) || 0,
      privat: parseFloat(privat) || 0, biaya_lain: parseFloat(biaya_lain) || 0, biaya_lain_nama: biaya_lain_nama || null,
      tahun_masuk: tahun_masuk || null, status: status || 'aktif',
      nama_orang_tua, no_wa, email_orang_tua, nik_orang_tua
    };

    if (!fields.nama_siswa || !fields.tenant_id) {
      return res.status(400).json({ success: false, message: 'Nama siswa dan tenant_id wajib diisi' });
    }

    let nisValue = fields.nis || null;

    let resolvedParentId = parent_id || null;
    if (!resolvedParentId && (nama_orang_tua || no_wa)) {
      const ins = await db.query('INSERT INTO parents (nama_orang_tua, no_wa, email, nik) VALUES (?, ?, ?, ?)', [nama_orang_tua || null, no_wa || null, email_orang_tua || null, nik_orang_tua || null]);
      resolvedParentId = ins.insertId;
    }

    let studentCols = 'tenant_id, nis, nisn, nama_siswa, jenis_kelamin, class_id, parent_id, iuran_bulanan';
    let studentVals = [fields.tenant_id, nisValue, fields.nisn || null, fields.nama_siswa, fields.jenis_kelamin || null, fields.class_id || null, resolvedParentId, fields.iuran_bulanan];

    try { await db.query('SELECT ransportasi FROM students LIMIT 1'); studentCols += ', ransportasi'; studentVals.push(fields.ransportasi); } catch (e) {}
    try { await db.query('SELECT subsidi FROM students LIMIT 1'); studentCols += ', subsidi'; studentVals.push(fields.subsidi); } catch (e) {}
    try { await db.query('SELECT privat FROM students LIMIT 1'); studentCols += ', privat'; studentVals.push(fields.privat); } catch (e) {}
    try { await db.query('SELECT biaya_lain FROM students LIMIT 1'); studentCols += ', biaya_lain'; studentVals.push(fields.biaya_lain); } catch (e) {}
    try { await db.query('SELECT biaya_lain_nama FROM students LIMIT 1'); studentCols += ', biaya_lain_nama'; studentVals.push(fields.biaya_lain_nama); } catch (e) {}
    try { await db.query('SELECT tahun_masuk FROM students LIMIT 1'); studentCols += ', tahun_masuk'; studentVals.push(fields.tahun_masuk); } catch (e) {}
    try { await db.query('SELECT status FROM students LIMIT 1'); studentCols += ', status'; studentVals.push(fields.status); } catch (e) {}

    studentCols = studentCols + ', created_at, updated_at';
    studentVals.push(new Date(), new Date());

    const result = await db.query(
      'INSERT INTO students (' + studentCols + ') VALUES (' + studentVals.map(() => '?').join(', ') + ')',
      studentVals
    );

    if (!nisValue) {
      let tahun = fields.tahun_masuk || null;
      if (!tahun) {
        tahun = String(new Date().getFullYear());
      }
      tahun = String(tahun).padStart(4, '0');

      let tenantNumericId = '0';
      try {
        const tenantRes = await db.query('SELECT id FROM tenants WHERE tenant_id = ? LIMIT 1', [fields.tenant_id]);
        if (tenantRes.length > 0 && tenantRes[0].id) {
          tenantNumericId = String(tenantRes[0].id);
        }
      } catch (e) {}

      const tenantPart = tenantNumericId.padStart(2, '0');
      const parentPart = String(resolvedParentId || 0).padStart(3, '0');
      const studentPart = String(result.insertId).padStart(4, '0');

      nisValue = tahun + tenantPart + parentPart + studentPart;

      const existing = await db.query('SELECT id FROM students WHERE id != ? AND nis = ?', [result.insertId, nisValue]);
      if (existing.length > 0) {
        return res.status(400).json({ success: false, message: 'NIS sudah digunakan: ' + nisValue });
      }

      await db.query('UPDATE students SET nis = ? WHERE id = ?', [nisValue, result.insertId]);
    } else {
      const existing = await db.query('SELECT id FROM students WHERE id != ? AND nis = ?', [result.insertId, nisValue]);
      if (existing.length > 0) {
        return res.status(400).json({ success: false, message: 'NIS sudah digunakan: ' + nisValue });
      }
    }

    res.json({ success: true, message: 'Siswa berhasil ditambahkan', id: result.insertId, nis: nisValue });
  } catch (error) {
    console.error('Create student error:', { message: error.message, code: error.code, sqlMessage: error.sqlMessage });
    res.status(500).json({ success: false, message: error.sqlMessage || error.message || 'Error creating student' });
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
    const graduates = mappingList.filter(m => m.action === 'graduate' || !m.to_class_id);
    const moves = mappingList.filter(m => m.action !== 'graduate' && m.to_class_id);

    // Helper: dapatkan atau buat kelas Alumni
    async function getOrCreateAlumniClass(tenantId) {
      const year = new Date().getFullYear();
      let [alumniClass] = await db.query(
        'SELECT id FROM classes WHERE tenant_id = ? AND nama_kelas = ? AND tingkatan = ?',
        [tenantId, 'Alumni', String(year)]
      );
      if (!alumniClass) {
        const result = await db.query(
          'INSERT INTO classes (tenant_id, nama_kelas, tingkatan) VALUES (?, ?, ?)',
          [tenantId, 'Alumni', String(year)]
        );
        return result.insertId;
      }
      return alumniClass.id;
    }

    for (const mapping of graduates) {
      const { from_class_id: fromId } = mapping;

      if (!fromId) {
        results.push({ success: false, message: 'from_class_id wajib diisi' });
        continue;
      }

      const [fromClass] = await db.query('SELECT * FROM classes WHERE id = ? AND tenant_id = ?', [fromId, tenantId]);
      if (!fromClass) {
        results.push({ success: false, message: `Kelas asal (ID: ${fromId}) tidak ditemukan` });
        continue;
      }

      try {
        const alumniClassId = await getOrCreateAlumniClass(tenantId);
        
        // Get school name for education history
        const [school] = await db.query('SELECT nama_sekolah FROM tenants WHERE tenant_id = ?', [tenantId]);
        const schoolName = school?.nama_sekolah || fromClass.nama_kelas;
        
        // Get students being graduated for education history
        const graduatingStudents = await db.query(
          'SELECT id, nama_siswa, tahun_masuk FROM students WHERE class_id = ?',
          [fromId]
        );
        
        // Record education history for each graduating student
        for (const student of graduatingStudents) {
          await db.query(
            `INSERT INTO student_education_history (student_id, tenant_id, nama_sekolah, tahun_masuk, tahun_lulus, status, keterangan) 
             VALUES (?, ?, ?, ?, ?, 'lulus', ?)`,
            [student.id, tenantId, schoolName, student.tahun_masuk, new Date().getFullYear().toString(), `Lulus dari ${fromClass.nama_kelas}`]
          );
        }
        
        await db.query(
          'UPDATE students SET class_id = ?, status_lulus = 1, tanggal_lulus = NOW() WHERE class_id = ?',
          [alumniClassId, fromId]
        );
      } catch (colError) {
        const alumniClassId = await getOrCreateAlumniClass(tenantId);
        
        // Get school name for education history
        const [school] = await db.query('SELECT nama_sekolah FROM tenants WHERE tenant_id = ?', [tenantId]);
        const schoolName = school?.nama_sekolah || fromClass.nama_kelas;
        
        // Get students being graduated for education history
        const graduatingStudents = await db.query(
          'SELECT id, nama_siswa, tahun_masuk FROM students WHERE class_id = ?',
          [fromId]
        );
        
        // Record education history for each graduating student
        for (const student of graduatingStudents) {
          await db.query(
            `INSERT INTO student_education_history (student_id, tenant_id, nama_sekolah, tahun_masuk, tahun_lulus, status, keterangan) 
             VALUES (?, ?, ?, ?, ?, 'lulus', ?)`,
            [student.id, tenantId, schoolName, student.tahun_masuk, new Date().getFullYear().toString(), `Lulus dari ${fromClass.nama_kelas}`]
          );
        }
        
        await db.query(
          'UPDATE students SET class_id = ?, status = ? WHERE class_id = ?',
          [alumniClassId, 'alumni', fromId]
        );
      }
      results.push({ success: true, message: `${fromClass.nama_kelas} berhasil diluluskan` });
    }

    const graduateIds = graduates.map(g => Number(g.from_class_id));
    const moveFromIds = moves.map(m => Number(m.from_class_id));

    // Urutkan move agar kelas yang menjadi tujuan suatu move diproses lebih dulu.
    // Contoh: 5D->6D, 4D->5D  =>  5D->6D harus didulukan supaya 5D kosong dulu
    // sebelum 4D dipindah ke 5D.
    const orderedMoves = [];
    const pending = [...moves];
    const safeLimit = pending.length * pending.length + 10;
    let guard = 0;
    while (pending.length && guard++ < safeLimit) {
      // cari move yang to_class_id-nya TIDAK ada di from_class_id move yang masih pending
      const pendingFromIds = new Set(pending.map(m => Number(m.from_class_id)));
      const idx = pending.findIndex(m => !pendingFromIds.has(Number(m.to_class_id)));
      if (idx === -1) {
        // sisa adalah siklus murni (semua saling jadi tujuan) -> tangani di validasi sirkular
        orderedMoves.push(...pending);
        break;
      }
      orderedMoves.push(pending[idx]);
      pending.splice(idx, 1);
    }

    for (const mapping of orderedMoves) {
      const { from_class_id: fromId, to_class_id: toId, action: mapAction } = mapping;

      if (!fromId) {
        results.push({ success: false, message: 'from_class_id wajib diisi' });
        continue;
      }

      const [fromClass] = await db.query('SELECT * FROM classes WHERE id = ? AND tenant_id = ?', [fromId, tenantId]);
      if (!fromClass) {
        results.push({ success: false, message: `Kelas asal (ID: ${fromId}) tidak ditemukan` });
        continue;
      }

      const [toClass] = await db.query('SELECT * FROM classes WHERE id = ? AND tenant_id = ?', [toId, tenantId]);
      if (!toClass) {
        results.push({ success: false, message: `Kelas tujuan (ID: ${toId}) tidak ditemukan` });
        continue;
      }

      // Cek real-time: kelas tujuan harus benar-benar kosong SAAT ini
      // (sudah mencakup efek graduate maupun move sebelumnya di loop yang sama).
      const [targetCountRow] = await db.query('SELECT COUNT(*) as count FROM students WHERE class_id = ?', [toId]);
      if (targetCountRow.count > 0) {
        results.push({ success: false, message: `Kelas tujuan ${toClass.nama_kelas} masih memiliki siswa. Pindahkan ke kelas yang kosong.` });
        continue;
      }

      const result = await db.query(
        'UPDATE students SET class_id = ? WHERE class_id = ?',
        [toId, fromId]
      );
      const count = result.affectedRows;
      results.push({ success: true, message: `${count} siswa dipindahkan ${fromClass.nama_kelas} → ${toClass.nama_kelas}` });
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

// PUT /api/admin/students/:id - Update student (including parent data)
router.put('/admin/students/:id', authenticateOperator, async (req, res) => {
  try {
    await ensureStudentColumns();
    const { id } = req.params;
    const {
      tenant_id, nis, nisn, nama_siswa, jenis_kelamin, class_id,
      iuran_bulanan, nama_orang_tua, no_wa, nik_orang_tua, email_orang_tua,
      ransportasi, subsidi, privat, biaya_lain, biaya_lain_nama, status
    } = req.body;

    if (!nama_siswa) {
      return res.status(400).json({ success: false, message: 'Nama siswa wajib diisi' });
    }

    // Get current student data
    const [current] = await db.query('SELECT * FROM students WHERE id = ?', [id]);
    if (!current) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }

    // Resolve parent: use existing parent_id, or update/create parent
    let resolvedParentId = current.parent_id || null;
    if (nama_orang_tua || no_wa || nik_orang_tua || email_orang_tua) {
      if (resolvedParentId) {
        // Update existing parent
        await db.query(
          'UPDATE parents SET nama_orang_tua = COALESCE(?, nama_orang_tua), no_wa = COALESCE(?, no_wa), nik = COALESCE(?, nik), email = COALESCE(?, email) WHERE id = ?',
          [nama_orang_tua || null, no_wa || null, nik_orang_tua || null, email_orang_tua || null, resolvedParentId]
        );
      } else {
        // Create new parent
        const ins = await db.query(
          'INSERT INTO parents (nama_orang_tua, no_wa, nik, email) VALUES (?, ?, ?, ?)',
          [nama_orang_tua || null, no_wa || null, nik_orang_tua || null, email_orang_tua || null]
        );
        resolvedParentId = ins.insertId;
      }
    }

    // Build update query dynamically
    const updates = [];
    const values = [];

    if (tenant_id !== undefined) { updates.push('tenant_id = ?'); values.push(tenant_id); }
    if (nis !== undefined) { updates.push('nis = ?'); values.push(nis); }
    if (nisn !== undefined) { updates.push('nisn = ?'); values.push(nisn || null); }
    if (nama_siswa !== undefined) { updates.push('nama_siswa = ?'); values.push(nama_siswa); }
    if (jenis_kelamin !== undefined) { updates.push('jenis_kelamin = ?'); values.push(jenis_kelamin); }
    if (class_id !== undefined) { updates.push('class_id = ?'); values.push(class_id || null); }
    if (iuran_bulanan !== undefined) { updates.push('iuran_bulanan = ?'); values.push(iuran_bulanan || 0); }
    if (ransportasi !== undefined) { updates.push('ransportasi = ?'); values.push(ransportasi || 0); }
    if (subsidi !== undefined) { updates.push('subsidi = ?'); values.push(subsidi || 0); }
    if (privat !== undefined) { updates.push('privat = ?'); values.push(privat || 0); }
    if (biaya_lain !== undefined) { updates.push('biaya_lain = ?'); values.push(biaya_lain || 0); }
    if (biaya_lain_nama !== undefined) { updates.push('biaya_lain_nama = ?'); values.push(biaya_lain_nama || null); }
    if (req.body.tahun_masuk !== undefined) { updates.push('tahun_masuk = ?'); values.push(req.body.tahun_masuk || null); }
    if (status !== undefined) { updates.push('status = ?'); values.push(status); }
    if (resolvedParentId) {
      updates.push('parent_id = ?');
      values.push(resolvedParentId);
    }

    if (updates.length === 0) {
      return res.json({ success: true, message: 'Tidak ada perubahan' });
    }

    values.push(id);
    const result = await db.query(
      'UPDATE students SET ' + updates.join(', ') + ' WHERE id = ?',
      values
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

// POST /api/admin/students/:id/generate-nis - Generate NIS for student without NIS
router.post('/admin/students/:id/generate-nis', authenticateOperator, async (req, res) => {
  try {
    await ensureStudentColumns();
    const { id } = req.params;
    const { tahun_masuk: bodyTahunMasuk } = req.body || {};

    // Get student data
    const [student] = await db.query(
      'SELECT s.*, p.id as parent_id_ref FROM students s LEFT JOIN parents p ON s.parent_id = p.id WHERE s.id = ?',
      [id]
    );

    if (!student) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }

    // If student already has NIS, don't overwrite
    if (student.nis) {
      return res.status(400).json({ success: false, message: 'Siswa sudah punya NIS: ' + student.nis });
    }

    // Use tahun_masuk from body (form) if provided, otherwise from database
    const tahunMasukValue = bodyTahunMasuk || student.tahun_masuk;

    // Validate required data for NIS generation
    const errors = [];
    const hasTahunMasuk = tahunMasukValue && String(tahunMasukValue).trim() !== '';
    if (!hasTahunMasuk) {
      errors.push('Tahun Masuk');
    }
    if (!student.tenant_id || String(student.tenant_id).trim() === '') errors.push('Sekolah (Tenant)');
    if (!student.parent_id && !student.parent_id_ref) errors.push('Data Orang Tua (Parent)');
    if (!student.nama_siswa || String(student.nama_siswa).trim() === '') errors.push('Nama Siswa');

    // Additional validation: parent_id must be actual ID (not 0 or null)
    const actualParentId = student.parent_id_ref || student.parent_id;
    if (actualParentId === 0 || actualParentId === null || actualParentId === undefined) {
      errors.push('Data Orang Tua (Parent) - tidak boleh kosong');
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Data belum lengkap. Lengkapi: ' + errors.join(', ')
      });
    }

    // Tahun langsung dari tahun_masuk (4 digit)
    let tahun = String(tahunMasukValue).trim();
    console.log('[GEN NIS] tahun:', tahun);
    
    if (!tahun) {
      tahun = String(new Date().getFullYear());
      console.log('[GEN NIS] Using current year:', tahun);
    }
    tahun = String(tahun).padStart(4, '0');

    // Get tenant numeric ID
    let tenantNumericId = '0';
    try {
      const tenantRes = await db.query('SELECT id FROM tenants WHERE tenant_id = ? LIMIT 1', [student.tenant_id]);
      if (tenantRes.length > 0 && tenantRes[0].id) {
        tenantNumericId = String(tenantRes[0].id);
      }
    } catch (e) {}
    const tenantPart = tenantNumericId.padStart(2, '0');

    // Get parent ID (use parent_id_ref or 0)
    const parentId = student.parent_id_ref || student.parent_id || 0;
    const parentPart = String(parentId).padStart(3, '0');

    // Use student ID as the last part
    const studentPart = String(id).padStart(4, '0');

    // Compose NIS: YYYY + tenant(2) + parent(3) + student(4)
    const nisValue = tahun + tenantPart + parentPart + studentPart;

    // Check for uniqueness
    const existing = await db.query('SELECT id FROM students WHERE id != ? AND nis = ?', [id, nisValue]);
    if (existing.length > 0) {
      // If collision, append a random suffix
      const suffix = String(Math.floor(Math.random() * 100)).padStart(2, '0');
      const altNis = tahun + tenantPart + parentPart + suffix;
      await db.query('UPDATE students SET nis = ? WHERE id = ?', [altNis, id]);
      return res.json({ success: true, message: 'NIS berhasil dibuat', data: { nis: altNis, student_id: id } });
    }

    // Update student with new NIS
    await db.query('UPDATE students SET nis = ? WHERE id = ?', [nisValue, id]);

    res.json({ success: true, message: 'NIS berhasil dibuat', data: { nis: nisValue, student_id: id } });
  } catch (error) {
    console.error('Generate NIS error:', error);
    res.status(500).json({ success: false, message: 'Error generating NIS' });
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

// Endpoint update-tanggal-masuk dihapus - hanya gunakan tahun_masuk


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
      WHERE (s.status != 'alumni' OR s.tenant_id = ?)
    `;
    let params = [tenantId];

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

    // Get current student data before clearing tenant
    const [student] = await db.query(
      `SELECT s.tenant_id, s.nama_siswa, s.tahun_masuk, tn.nama_sekolah 
       FROM students s 
       LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id
       WHERE s.id = ?`,
      [id]
    );

    // Record education history before clearing tenant
    if (student && student.tenant_id && student.nama_sekolah) {
      await db.query(
        `INSERT INTO student_education_history (student_id, tenant_id, nama_sekolah, tahun_masuk, tahun_lulus, status, keterangan) 
         VALUES (?, ?, ?, ?, ?, 'pindah', ?)`,
        [id, student.tenant_id, student.nama_sekolah, student.tahun_masuk, new Date().getFullYear().toString(), 'Transfer ke mutasi pool']
      );
    }

    // Set mutasi_status to pending, clear tenant for adoption pool
    await db.query(
      'UPDATE students SET mutasi_status = "pending" WHERE id = ?',
      [id]
    );

    const [studentInfo] = await db.query('SELECT nama_siswa FROM students WHERE id = ?', [id]);
    res.json({ success: true, message: `${studentInfo.nama_siswa} siap diadopsi sekolah lain` });
  } catch (error) {
    console.error('Transfer student error:', error);
    res.status(500).json({ success: false, message: 'Error transferring student' });
  }
});

// ============================================================
// CROSS-TENANT TRANSFER ROUTES
// ============================================================

// POST /api/admin/mutasi/teachers/:id/initiate - Send teacher to mutasi pool or keluar/resign
router.post('/admin/mutasi/teachers/:id/initiate', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const isKeluar = String(reason || '').startsWith('Keluar/Resign:');
    const cleanReason = isKeluar ? String(reason || '').replace(/^Keluar\/Resign:\s*/, '') : reason;

    let updated = false;
    try {
      if (isKeluar) {
        const result = await db.query(
          'UPDATE teacher_assignments SET tenant_id = NULL, mutasi_status = ?, mutasi_reason = ?, mutasi_date = NOW() WHERE teacher_id = ?',
          ['keluar', cleanReason || null, id]
        );
        updated = result.affectedRows > 0;
      } else {
        const result = await db.query(
          'UPDATE teacher_assignments SET mutasi_status = ?, mutasi_reason = ?, mutasi_date = NOW() WHERE teacher_id = ?',
          ['pending', reason || null, id]
        );
        updated = result.affectedRows > 0;
      }
    } catch (colError) {
      console.warn('Mutasi columns not found in teacher_assignments, fallback to status-based marking');
      if (isKeluar) {
        await db.query('UPDATE teacher_assignments SET tenant_id = NULL WHERE teacher_id = ?', [id]);
      }
    }

    if (!updated) {
      const [existing] = await db.query('SELECT id FROM teacher_assignments WHERE teacher_id = ? LIMIT 1', [id]);
      if (!existing) {
        return res.status(400).json({ success: false, message: 'Guru belum memiliki penempatan sekolah' });
      }
    }

    const [teacher] = await db.query('SELECT nama FROM teachers WHERE id = ?', [id]);
    res.json({ success: true, message: `${teacher.nama} berhasil keluar dari sekolah` });
  } catch (error) {
    console.error('Initiate mutasi teacher error:', error);
    res.status(500).json({ success: false, message: 'Error initiating mutasi: ' + error.message });
  }
});

// POST /api/admin/mutasi/students/:id/initiate - Send student to mutasi pool (cross-tenant transfer)
router.post('/admin/mutasi/students/:id/initiate', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    // Get current student data before clearing tenant
    const [student] = await db.query(
      `SELECT s.tenant_id, s.nama_siswa, s.tahun_masuk, tn.nama_sekolah 
       FROM students s 
       LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id
       WHERE s.id = ?`,
      [id]
    );

    if (!student) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }

    // Record education history before clearing tenant
    if (student.tenant_id && student.nama_sekolah) {
      await db.query(
        `INSERT INTO student_education_history (student_id, tenant_id, nama_sekolah, tahun_masuk, tahun_lulus, status, keterangan) 
         VALUES (?, ?, ?, ?, ?, 'pindah', ?)`,
        [id, student.tenant_id, student.nama_sekolah, student.tahun_masuk, new Date().getFullYear().toString(), reason || 'Mutasi ke sekolah lain']
      );
    }

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

    // Get new school name for education history
    const [newSchool] = await db.query('SELECT nama_sekolah FROM tenants WHERE tenant_id = ?', [tenant_id]);

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

    // Record education history for the new school entry
    const [student] = await db.query('SELECT nama_siswa, tahun_masuk FROM students WHERE id = ?', [id]);
    await db.query(
      `INSERT INTO student_education_history (student_id, tenant_id, nama_sekolah, tahun_masuk, status, keterangan) 
       VALUES (?, ?, ?, ?, 'aktif', ?)`,
      [id, tenant_id, newSchool?.nama_sekolah || 'Sekolah Baru', new Date().getFullYear().toString(), 'Diadopsi dari mutasi pool']
    );

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
// Filter:
// 1. users.role = admin -> semua tenant, semua jabatan
// 2. assignment YPWILUTIM + jabatan ketua/kepala/pimpinan -> semua tenant, HANYA izin pengaju dengan jabatan ketua/kepala/pimpinan
// 3. assignment jabatan ketua/kepala/pimpinan (bukan YPWILUTIM) -> hanya tenant assignmentnya (tanpa filter jabatan pengaju)
router.get('/admin/leave-requests', authenticateOperator, async (req, res) => {
  try {
    let statusFilter = req.query.status;
    let principalOnly = req.query.principal_only === '1' || req.query.principal_only === 'true';

    // Tentukan tenant yang diizinkan berdasarkan role/jabatan (enforce server-side)
    // 1. users.role = admin + tenant_id = YPWILUTIM -> semua tenant, semua jabatan (LIHAT SEMUA)
    // 2. users.role = admin + tenant_id != YPWILUTIM -> hanya tenant_id user itu
    // 3. assignment YPWILUTIM + jabatan ketua/kepala/pimpinan -> semua tenant, HANYA izin pengaju dengan jabatan ketua/kepala/pimpinan
    // 4. assignment jabatan ketua/kepala/pimpinan (bukan YPWILUTIM) -> hanya tenant assignmentnya (tanpa filter jabatan pengaju)
    let allowedTenants = []; // default: tidak ada akses
    let filterPrincipalOnly = false;
    if (req.user.role === 'admin') {
      if (req.user.tenant_id === 'YPWILUTIM') {
        allowedTenants = null; // admin YPWILUTIM melihat SEMUA tenant
      } else {
        allowedTenants = [req.user.tenant_id]; // admin lain hanya lihat tenant-nya
      }
    } else {
      const assignments = req.user.assignments || [];
      const ketuaRoles = ['kepalasekolah', 'pimpinan', 'ketua', 'kepalapondok'];
      const isKetuaYpwilutim = assignments.some(a => {
        const jabatan = (a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, '');
        return a.tenant_id === 'YPWILUTIM' && ketuaRoles.includes(jabatan);
      });
      if (isKetuaYpwilutim) {
        filterPrincipalOnly = true;
        allowedTenants = null; // semua tenant
      } else {
        const allowed = assignments
          .filter(a => {
            const jabatan = (a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, '');
            return a.tenant_id !== 'YPWILUTIM' && ketuaRoles.includes(jabatan);
          })
          .map(a => a.tenant_id);
        allowedTenants = allowed.length > 0 ? allowed : [];
      }
    }

    // override dari client jika dikirim (untuk konsistensi)
    if (req.query.principal_only === '1' || req.query.principal_only === 'true') {
      filterPrincipalOnly = true;
    }

    let requestedTenants = req.query.tenant_id;
    if (requestedTenants && !Array.isArray(requestedTenants)) {
      requestedTenants = [requestedTenants];
    }
    requestedTenants = requestedTenants || [];

    let tenantFilter = null;
    if (allowedTenants === null) {
      tenantFilter = requestedTenants.length > 0 ? requestedTenants : null;
    } else {
      tenantFilter = allowedTenants.filter(t => requestedTenants.length === 0 || requestedTenants.includes(t));
    }

    let query = `
      SELECT lr.*, t.nama as teacher_name,
             lr.tenant_id,
             (SELECT GROUP_CONCAT(tn.nama_sekolah ORDER BY tn.nama_sekolah SEPARATOR ', ')
              FROM tenants tn
              WHERE FIND_IN_SET(tn.tenant_id, lr.tenant_id) > 0) as nama_sekolah
      FROM leave_requests lr
      JOIN teachers t ON lr.teacher_id = t.id
      WHERE 1=1
    `;
    let params = [];

    if (tenantFilter && tenantFilter.length > 0) {
      const cond = tenantFilter.map(() => 'FIND_IN_SET(?, lr.tenant_id) > 0').join(' OR ');
      query += ` AND (${cond})`;
      params.push(...tenantFilter);
    } else if (allowedTenants !== null && allowedTenants.length === 0) {
      query += ' AND 1=0';
    }

    if (filterPrincipalOnly) {
      query += ` AND EXISTS (
        SELECT 1 FROM teacher_assignments ta
        WHERE ta.teacher_id = t.id
          AND (ta.jabatan_di_unit REGEXP ?)
      )`;
      params.push('kepala|pimpinan|ketua');
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

// Helper: Display name for leave request jenis
function jenisDisplayName(jenis) {
  const map = { 'izin': 'Izin', 'sakit': 'Sakit', 'cuti': 'Cuti', 'dinas_luar': 'Dinas Luar' };
  return map[jenis] || jenis.toUpperCase();
}

// PUT /api/admin/leave-requests/:id/status - Approve or reject leave request
router.put('/admin/leave-requests/:id/status', authenticateOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, catatan } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status tidak valid' });
    }

    // Ambil nama penyetuju (approver)
    let approverName = req.user.nama || req.user.username || 'Admin';
    if (req.user.guru_id) {
      try {
        const [teacher] = await db.query('SELECT nama FROM teachers WHERE id = ?', [req.user.guru_id]);
        if (teacher && teacher.nama) approverName = teacher.nama;
      } catch (_) { /* fallback ke username */ }
    }

    const aksi = status === 'approved' ? 'Disetujui' : 'Ditolak';
    // Catatan otomatis + gabung catatan manual bila diisi
    let finalCatatan = `${aksi} oleh ${approverName}`;
    if (catatan && String(catatan).trim() !== '') {
      finalCatatan += ` - ${String(catatan).trim()}`;
    }

    const result = await db.query(
      'UPDATE leave_requests SET status = ?, catatan = ?, updated_at = NOW() WHERE id = ?',
      [status, finalCatatan, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Permohonan izin tidak ditemukan' });
    }

    const leaveRequest = await db.query(
      'SELECT * FROM leave_requests WHERE id = ?',
      [id]
    ).then(rows => rows[0] || null);

    if (leaveRequest) {
      const [teacher] = await db.query(
        'SELECT nama, email, no_wa FROM teachers WHERE id = ?',
        [leaveRequest.teacher_id]
      );

      if (teacher && teacher.email) {
        const statusText = status === 'approved' ? 'DISETUJUI' : 'DITOLAK';
        const statusColor = status === 'approved' ? '#10b981' : '#dc2626';
        const headerColor = status === 'approved'
          ? 'linear-gradient(135deg,#10b981,#059669)'
          : 'linear-gradient(135deg,#dc2626,#b91c1c)';
        const icon = status === 'approved' ? '✅' : '❌';

        const htmlMessage = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Status Pengajuan Izin - YPWI Lutim</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 20px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
    <div style="background: ${headerColor}; padding: 30px; text-align: center;">
      <h1 style="margin: 0; color: white; font-size: 24px;">YPWI LUTIM</h1>
      <p style="margin: 5px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">Notifikasi Perizinan ${icon}</p>
    </div>
    <div style="padding: 30px;">
      <h2 style="margin: 0 0 20px 0; color: #333; font-size: 20px;">Assalamu'alaikum <strong>${teacher.nama}</strong>,</h2>
      <p style="margin: 0 0 15px 0; color: #555; font-size: 16px; line-height: 1.6;">
        Pengajuan izin Anda telah <strong style="color: ${statusColor}">${statusText}</strong> oleh ${approverName}.
      </p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Jenis Izin:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: 600;">${leaveRequest.jenis.toUpperCase()}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Periode:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: 600;">${leaveRequest.tanggal_mulai} s/d ${leaveRequest.tanggal_selesai}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Keterangan:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: 600;">${leaveRequest.keterangan}</td></tr>
        ${catatan ? `<tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Catatan:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: 600; color: #dc2626;">${catatan}</td></tr>` : ''}
        <tr><td style="padding: 8px 0; color: #666;">Status:</td><td style="padding: 8px 0; font-weight: 600; color: ${statusColor}">${statusText}</td></tr>
      </table>
      <p style="margin: 20px 0 0 0; color: #888; font-size: 14px;">Email ini dikirim otomatis oleh sistem.</p>
    </div>
  </div>
</body>
</html>`;

        if (typeof global.sendEmail === 'function') {
          await global.sendEmail(
            teacher.email,
            `Status Pengajuan Izin ${jenisDisplayName(leaveRequest.jenis)} - ${statusText} - YPWI Lutim`,
            htmlMessage,
            '',
            [],
            'leave_approval'
          );
        }
      }

      if (teacher && teacher.no_wa) {
        const statusText = status === 'approved' ? 'DISETUJUI ✅' : 'DITOLAK ❌';
        const waMessage = `*STATUS PENGAJUAN IZIN YPWI*
Hai *${teacher.nama}*, 

Pengajuan izin Anda telah ${statusText} oleh ${approverName}.

*Detail:*
• Jenis: ${leaveRequest.jenis.toUpperCase()}
• Periode: ${leaveRequest.tanggal_mulai} s/d ${leaveRequest.tanggal_selesai}
• Status: ${statusText}

${catatan ? `• Catatan: ${catatan}\n\n` : ''}Pesan ini dikirim otomatis oleh sistem.`;

        if (typeof global.sendWhatsAppMessage === 'function') {
          await global.sendWhatsAppMessage(teacher.no_wa, waMessage);
        }
      }
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
      'SELECT t.id, t.nama, t.nik, t.nip, t.email, t.no_wa, t.scan_id, t.tempat_lahir, t.tanggal_lahir, t.jenis_kelamin, t.alamat, t.status_kepegawaian, t.status_aktif, t.tmt, t.pendidikan_terakhir, t.bank, t.nomor_rekening, t.link_foto, t.link_ktp, t.link_kk, t.link_ijazah FROM teachers t WHERE t.id = ?',
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

// GET /api/admin/email-logs - Get email sending history
router.get('/admin/email-logs', authenticateOperator, async (req, res) => {
  try {
    const { page = 1, limit = 50, status, category, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }
    if (category) {
      whereClause += ' AND category = ?';
      params.push(category);
    }
    if (search) {
      whereClause += ' AND (to_email LIKE ? OR subject LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    const [countResult] = await db.query(`SELECT COUNT(*) as total FROM email_logs ${whereClause}`, params);
    const total = countResult[0]?.total || 0;

    const logs = await db.query(
      `SELECT id, to_email, subject, category, related_id, status, message_id, error_message, sent_at, created_at
       FROM email_logs
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    res.json({
      success: true,
      data: logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)) || 1
      }
    });
  } catch (error) {
    console.error('Email logs error:', error);
    res.status(500).json({ success: false, message: 'Error fetching email logs' });
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

// POST /api/public/teachers/:teacherId/upload-document - Upload a single document directly to DB (no auth)
const docTypeMap = {
  foto: 'link_foto',
  ktp: 'link_ktp',
  kk: 'link_kk',
  ijazah: 'link_ijazah'
};
router.post('/public/teachers/:teacherId/upload-document', berkasUpload.single('file'), async (req, res) => {
  try {
    const teacherId = req.params.teacherId;
    const docType = req.body.doc_type;
    if (!docType || !docTypeMap[docType]) {
      return res.status(400).json({ success: false, message: 'doc_type tidak valid (foto/ktp/kk/ijazah)' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Tidak ada file yang diupload.' });
    }
    const fileUrl = `/uploads/${req.file.filename}`;
    await db.query(`UPDATE teachers SET ${docTypeMap[docType]} = ? WHERE id = ?`, [fileUrl, teacherId]);
    res.json({ success: true, url: fileUrl, field: docTypeMap[docType], message: 'Dokumen berhasil diupload' });
  } catch (error) {
    console.error('Upload document error:', error);
    res.status(500).json({ success: false, message: 'Gagal mengupload dokumen' });
  }
});

// PUT /api/public/teachers/:teacherId - Update teacher profile (no auth required, for complete-profile.html)
router.put('/public/teachers/:teacherId', berkasUpload.fields([
  { name: 'foto', maxCount: 1 },
  { name: 'ktp', maxCount: 1 },
  { name: 'kk', maxCount: 1 },
  { name: 'ijazah', maxCount: 1 }
]), async (req, res) => {
  try {
    const teacherId = req.params.teacherId;
    const { nama, nik, nip, email, tempat_lahir, tanggal_lahir, jenis_kelamin, alamat, no_wa, status_kepegawaian, status_aktif, tmt, pendidikan_terakhir, jurusan, nama_sekolah_pendidikan, tahun_angkatan, assignments_json, bank, nomor_rekening, status_perkawinan, jumlah_anak, data_keluarga } = req.body;
    const foto = req.files && req.files.foto && req.files.foto[0] ? `/uploads/${req.files.foto[0].filename}` : null;
    const ktp = req.files && req.files.ktp && req.files.ktp[0] ? `/uploads/${req.files.ktp[0].filename}` : null;
    const kk = req.files && req.files.kk && req.files.kk[0] ? `/uploads/${req.files.kk[0].filename}` : null;
    const ijazah = req.files && req.files.ijazah && req.files.ijazah[0] ? `/uploads/${req.files.ijazah[0].filename}` : null;

    // Get existing values if not provided (fields may be disabled in form)
    let selectQuery = 'SELECT nama, nik, nip, email, tempat_lahir, tanggal_lahir, jenis_kelamin, alamat, no_wa, status_kepegawaian, status_aktif, tmt, pendidikan_terakhir, pendidikan_kode';
    const selectParams = [];
    try {
      await db.query('SELECT bank, nomor_rekening FROM teachers LIMIT 1');
      selectQuery += ', bank, nomor_rekening';
    } catch (err) { }
    try {
      await db.query('SELECT status_perkawinan, jumlah_anak, data_keluarga FROM teachers LIMIT 1');
      selectQuery += ', status_perkawinan, jumlah_anak, data_keluarga';
    } catch (err) { }
    selectQuery += ' FROM teachers WHERE id = ?';
    selectParams.push(teacherId);
    const [existingTeacher] = await db.query(selectQuery, selectParams);

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
    const finalStatusPerkawinan = status_perkawinan || existingTeacher?.status_perkawinan || null;
    const finalJumlahAnak = jumlah_anak || existingTeacher?.jumlah_anak || 0;
    const finalDataKeluarga = data_keluarga || existingTeacher?.data_keluarga || null;

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

    // Pendidikan_kode: kolom standar untuk lookup (SD/SMP/SMA/SMK/D1/D2/D3/S1/S2/S3/Lainnya)
    const KODE_VALID = ['SD', 'SMP', 'SMA', 'SMK', 'D1', 'D2', 'D3', 'S1', 'S2', 'S3', 'Lainnya'];
    const finalPendidikanKode = (pendidikan_terakhir && KODE_VALID.includes(pendidikan_terakhir))
      ? pendidikan_terakhir
      : (existingTeacher?.pendidikan_kode || null);

    const safeParams = {
      nama: finalNama, nik: finalNik, nip: finalNip, email: finalEmail,
      tempat_lahir: finalTempatLahir, tanggal_lahir: finalTanggalLahir,
      jenis_kelamin: finalJenisKelamin, alamat: finalAlamat, no_wa: finalNoWa,
      status_kepegawaian: finalStatusKepegawaian, status_aktif: finalStatusAktif,
      tmt: finalTmt, pendidikan_terakhir: pendidikanFormatted,
      pendidikan_kode: finalPendidikanKode,
      bank: finalBank, nomor_rekening: finalNomorRekening,
      status_perkawinan: finalStatusPerkawinan, jumlah_anak: finalJumlahAnak,
      data_keluarga: finalDataKeluarga
    };

    let updateQuery = 'UPDATE teachers SET nama=?, nik=?, nip=?, email=?, tempat_lahir=?, tanggal_lahir=?, jenis_kelamin=?, alamat=?, no_wa=?, status_kepegawaian=?, status_aktif=?, tmt=?, pendidikan_terakhir=?';
    let updateParams = [safeParams.nama, safeParams.nik, safeParams.nip, safeParams.email, safeParams.tempat_lahir, safeParams.tanggal_lahir, safeParams.jenis_kelamin, safeParams.alamat, safeParams.no_wa, safeParams.status_kepegawaian, safeParams.status_aktif, safeParams.tmt, safeParams.pendidikan_terakhir];

    try {
      await db.query('SELECT pendidikan_kode FROM teachers LIMIT 1');
      updateQuery += ', pendidikan_kode=?';
      updateParams.push(safeParams.pendidikan_kode);
    } catch (err) { }

    try {
      await db.query('SELECT bank FROM teachers LIMIT 1');
      updateQuery += ', bank=?, nomor_rekening=?';
      updateParams.push(safeParams.bank, safeParams.nomor_rekening);
    } catch (err) { }

    try {
      await db.query('SELECT status_perkawinan, jumlah_anak, data_keluarga FROM teachers LIMIT 1');
      updateQuery += ', status_perkawinan=?, jumlah_anak=?, data_keluarga=?';
      updateParams.push(safeParams.status_perkawinan, safeParams.jumlah_anak, safeParams.data_keluarga);
    } catch (err) { }

    if (foto) {
      updateQuery += ', link_foto=?';
      updateParams.push(foto);
    }
    if (ktp) {
      updateQuery += ', link_ktp=?';
      updateParams.push(ktp);
    }
    if (kk) {
      updateQuery += ', link_kk=?';
      updateParams.push(kk);
    }
    if (ijazah) {
      updateQuery += ', link_ijazah=?';
      updateParams.push(ijazah);
    }
    updateQuery += ' WHERE id=?';
    updateParams.push(teacherId);

    await db.query(updateQuery, updateParams);

    // Save family data to teacher_family table
    await db.query('DELETE FROM teacher_family WHERE teacher_id = ?', [teacherId]);
    if (data_keluarga) {
      try {
        const keluarga = typeof data_keluarga === 'string' ? JSON.parse(data_keluarga) : data_keluarga;
        if (Array.isArray(keluarga)) {
          for (const item of keluarga) {
            let relatedTeacherId = null;
            if (item.nik) {
              const related = await db.query('SELECT id FROM teachers WHERE nik = ? AND id != ? LIMIT 1', [item.nik, teacherId]);
              if (related.length > 0) {
                relatedTeacherId = related[0].id;
              }
            }
            await db.query(
              'INSERT INTO teacher_family (teacher_id, nik, nama, tipe, related_teacher_id) VALUES (?, ?, ?, ?, ?)',
              [teacherId, item.nik || null, item.nama || null, item.tipe || null, relatedTeacherId]
            );
          }
        }
      } catch (parseErr) {
        console.error('Family data parse error:', parseErr);
      }
    }

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
        await global.sendEmail(email, 'Profil Akun Aktif - YPWI Lutim', htmlMessage, '', [], 'account_activation');
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
    const teacherId = req.params.teacherId;
    
    let selectQuery = 'SELECT t.id, t.nama, t.nik, t.nip, t.email, t.tempat_lahir, t.tanggal_lahir, t.jenis_kelamin, t.alamat, t.no_wa, t.status_kepegawaian, t.status_aktif, t.tmt, t.pendidikan_terakhir, t.BANK as bank, t.nomor_rekening, t.link_foto, t.link_ktp, t.link_kk, t.link_ijazah, GROUP_CONCAT(CONCAT(ta.tenant_id, ":", ta.jabatan_di_unit)) as assignments';
    const selectParams = [teacherId];
    
    try {
      await db.query('SELECT status_perkawinan, jumlah_anak FROM teachers LIMIT 1');
      selectQuery += ', t.status_perkawinan, t.jumlah_anak';
    } catch (err) { }
    
    selectQuery += ' FROM teachers t LEFT JOIN teacher_assignments ta ON t.id = ta.teacher_id WHERE t.id = ?';
    
    const [teacher] = await db.query(selectQuery, selectParams);

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

    // Fetch family data
    try {
      const family = await db.query('SELECT nik, nama, tipe FROM teacher_family WHERE teacher_id = ?', [teacherId]);
      formattedTeacher.data_keluarga = family;
    } catch (err) {
      formattedTeacher.data_keluarga = [];
    }

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
    
    // Get students with parent WA (include adopted alumni, exclude alumni from other schools)
    const students = await db.query(`
      SELECT s.id, s.nama_siswa, s.iuran_bulanan, p.no_wa as parent_wa
      FROM students s
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE s.tenant_id = ? AND (s.status != 'alumni' OR s.tenant_id = ?) AND p.no_wa IS NOT NULL AND p.no_wa != ''
    `, [tenantId, tenantId]);
    
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
    
    // Get students with parent WA (include adopted alumni, exclude alumni from other schools)
    const students = await db.query(`
      SELECT s.id, s.nama_siswa, s.iuran_bulanan, p.no_wa as parent_wa
      FROM students s
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE s.tenant_id = ? AND (s.status != 'alumni' OR s.tenant_id = ?) AND p.no_wa IS NOT NULL AND p.no_wa != ''
    `, [tenantId, tenantId]);
    
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

    // First get student's tenant_id
    const [studentInfo] = await db.query('SELECT tenant_id FROM students WHERE id = ?', [student_id]);
    if (!studentInfo) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }

    const [student] = await db.query(`
      SELECT s.nama_siswa, s.iuran_bulanan, p.no_wa as parent_wa, s.tenant_id
      FROM students s
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE s.id = ? AND (s.status != 'alumni' OR s.tenant_id = ?)
    `, [student_id, studentInfo.tenant_id]);

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
      // Include active students + adopted alumni (alumni whose tenant_id is in the selected list)
      query += ` AND s.tenant_id IN (${placeholders}) AND (s.status != 'alumni' OR s.tenant_id IN (${placeholders}))`;
      params = [...params, ...tenant_ids, ...tenant_ids];
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
     
     const activeWeekdays = new Set();
     logs.forEach(l => {
       const day = parseInt(l.hari);
       const date = new Date(tahun, bulan - 1, day);
       if (date.getDay() !== 0 && date.getDay() !== 6) activeWeekdays.add(day);
     });
     
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
         }
       });
       for (let d = 1; d <= daysInMonth; d++) {
         if (!row['tgl_' + d]) {
           const date = new Date(tahun, bulan - 1, d);
           const isWeekend = date.getDay() === 0 || date.getDay() === 6;
           if (isWeekend) {
             row['tgl_' + d] = '<span class="text-gray-400">-</span>';
           } else if (activeWeekdays.has(d)) {
             row['tgl_' + d] = '<span class="text-red-600 font-bold">TK</span>';
           } else {
             row['tgl_' + d] = '<span class="text-gray-400">-</span>';
           }
         }
       }
       row.hadir = hadir; row.terlambat = terlambat; row.izin = izin; row.cuti = cuti; row.dinas_luar = dinas_luar; row.sakit = sakit;
       row.weekendDays = weekendDays;
       row.holidayWeekdays = Array.from({length: daysInMonth}, (_, i) => i + 1).filter(d => !activeWeekdays.has(d) && (new Date(tahun, bulan - 1, d).getDay() !== 0 && new Date(tahun, bulan - 1, d).getDay() !== 6));
       const totalActiveDays = activeWeekdays.size;
       row.tanpa_keterangan = totalActiveDays - (hadir + terlambat + izin + cuti + dinas_luar + sakit);
       return row;
     });
    
    res.json({ success: true, data: result, daysInMonth });
  } catch (error) {
    console.error('Monthly attendance error:', error);
    res.status(500).json({ success: false, message: 'Error fetching monthly attendance' });
  }
});

// GET /api/admin/monthly-report/html - Monthly attendance HTML report
router.get('/admin/monthly-report/html', authenticateOperator, async (req, res) => {
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
    if (!tenantId) return res.status(400).json({ success: false, message: 'tenant_id diperlukan' });

    const tenant = await db.query('SELECT nama_sekolah FROM tenants WHERE tenant_id = ?', [tenantId]);
    const tenantName = tenant.length > 0 ? tenant[0].nama_sekolah : tenantId;

    const teachers = await db.query(
      'SELECT t.id, t.nama FROM teachers t WHERE t.id IN (SELECT teacher_id FROM teacher_assignments WHERE tenant_id = ?) ORDER BY t.nama ASC',
      [tenantId]
    );

    const logs = await db.query(
      'SELECT al.teacher_id, DAY(al.waktu_scan) as hari, al.status, al.dinas_luar, al.keterangan, al.waktu_scan FROM attendance_logs al WHERE MONTH(al.waktu_scan) = ? AND YEAR(al.waktu_scan) = ? AND al.teacher_id IN (SELECT teacher_id FROM teacher_assignments WHERE tenant_id = ?)',
      [bulan, tahun, tenantId]
    );
     
     const daysInMonth = new Date(tahun, bulan, 0).getDate();
     const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

     const weekendDays = [];
     for (let d = 1; d <= daysInMonth; d++) {
       const date = new Date(tahun, bulan - 1, d);
       if (date.getDay() === 0 || date.getDay() === 6) weekendDays.push(d);
     }

     const activeWeekdays = new Set();
     logs.forEach(l => {
       const day = parseInt(l.hari);
       const date = new Date(tahun, bulan - 1, day);
       if (date.getDay() !== 0 && date.getDay() !== 6) activeWeekdays.add(day);
     });

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
         }
       });
       for (let d = 1; d <= daysInMonth; d++) {
         if (!row['tgl_' + d]) {
           const date = new Date(tahun, bulan - 1, d);
           const isWeekend = date.getDay() === 0 || date.getDay() === 6;
           if (isWeekend) {
             row['tgl_' + d] = '<span class="text-gray-400">-</span>';
           } else if (activeWeekdays.has(d)) {
             row['tgl_' + d] = '<span class="text-red-600 font-bold">TK</span>';
           } else {
             row['tgl_' + d] = '<span class="text-gray-400">-</span>';
           }
         }
       }
       row.hadir = hadir; row.terlambat = terlambat; row.izin = izin; row.cuti = cuti; row.dinas_luar = dinas_luar; row.sakit = sakit;
       row.weekendDays = weekendDays;
       const totalActiveDays = activeWeekdays.size;
       row.tanpa_keterangan = totalActiveDays - (hadir + terlambat + izin + cuti + dinas_luar + sakit);
       return row;
     });

    let html = `
      <div class="p-4">
        <h3 class="text-lg font-semibold text-gray-900 mb-1">Rekap Absensi ${tenantName}</h3>
        <p class="text-sm text-gray-600 mb-4">${monthNames[bulan - 1]} ${tahun}</p>
        <div class="overflow-x-auto">
          <table class="w-full text-sm border border-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="border border-gray-200 px-2 py-2 text-left text-xs font-semibold text-gray-600">No</th>
                <th class="border border-gray-200 px-2 py-2 text-left text-xs font-semibold text-gray-600">Nama Guru</th>
                ${Array.from({length: daysInMonth}, (_, i) => i + 1).map(d => `<th class="border border-gray-200 px-1 py-2 text-center text-xs font-semibold text-gray-600 ${weekendDays.includes(d) ? 'bg-gray-100 text-gray-400' : ''}">${d}</th>`).join('')}
                <th class="border border-gray-200 px-2 py-2 text-center text-xs font-semibold text-gray-600">H</th>
                <th class="border border-gray-200 px-2 py-2 text-center text-xs font-semibold text-gray-600">T</th>
                <th class="border border-gray-200 px-2 py-2 text-center text-xs font-semibold text-gray-600">DL</th>
                <th class="border border-gray-200 px-2 py-2 text-center text-xs font-semibold text-gray-600">I</th>
                <th class="border border-gray-200 px-2 py-2 text-center text-xs font-semibold text-gray-600">C</th>
                <th class="border border-gray-200 px-2 py-2 text-center text-xs font-semibold text-gray-600">S</th>
                <th class="border border-gray-200 px-2 py-2 text-center text-xs font-semibold text-gray-600">TK</th>
              </tr>
            </thead>
            <tbody>
              ${result.map((r, idx) => `
                <tr class="hover:bg-gray-50">
                  <td class="border border-gray-200 px-2 py-2 text-center text-gray-900">${idx + 1}</td>
                  <td class="border border-gray-200 px-2 py-2 text-gray-900 font-medium">${r.nama}</td>
                  ${Array.from({length: daysInMonth}, (_, i) => i + 1).map(d => `<td class="border border-gray-200 px-1 py-2 text-center">${r['tgl_' + d] || ''}</td>`).join('')}
                  <td class="border border-gray-200 px-2 py-2 text-center text-green-600 font-semibold">${r.hadir}</td>
                  <td class="border border-gray-200 px-2 py-2 text-center text-yellow-600 font-semibold">${r.terlambat}</td>
                  <td class="border border-gray-200 px-2 py-2 text-center text-blue-600 font-semibold">${r.dinas_luar}</td>
                  <td class="border border-gray-200 px-2 py-2 text-center text-purple-600 font-semibold">${r.izin}</td>
                  <td class="border border-gray-200 px-2 py-2 text-center text-gray-600 font-semibold">${r.cuti}</td>
                  <td class="border border-gray-200 px-2 py-2 text-center text-red-600 font-semibold">${r.sakit}</td>
                  <td class="border border-gray-200 px-2 py-2 text-center text-red-800 font-semibold">${r.tanpa_keterangan}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="mt-4 flex flex-wrap gap-3 text-xs text-gray-600">
          <span><b>H</b>=Hadir <b>T</b>=Terlambat <b>DL</b>=Dinas Luar <b>I</b>=Izin <b>C</b>=Cuti <b>S</b>=Sakit <b>TK</b>=Tanpa Keterangan</span>
        </div>
      </div>
    `;

    res.send(html);
  } catch (error) {
    console.error('Monthly report HTML error:', error);
    res.status(500).send('<div class="p-4 text-red-500">Error memuat rekap</div>');
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

// GET /api/admin/emails - List emails
router.get('/admin/emails', authenticateOperator, async (req, res) => {
  try {
    const { folder = 'sent', page = 1, limit = 20, search, status, category } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (folder === 'drafts') {
      whereClause += ' AND status = ?';
      params.push('draft');
    } else if (folder === 'sent') {
      whereClause += ' AND status = ?';
      params.push('sent');
    } else if (folder === 'failed') {
      whereClause += ' AND status = ?';
      params.push('failed');
    }

    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }
    if (category) {
      whereClause += ' AND category = ?';
      params.push(category);
    }
    if (search) {
      whereClause += ' AND (to_email LIKE ? OR subject LIKE ? OR body_text LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [countResult] = await db.query(`SELECT COUNT(*) as total FROM email_logs ${whereClause}`, params);
    const total = countResult[0]?.total || 0;

    const emails = await db.query(
      `SELECT id, from_email, to_email, cc, bcc, subject, category, status, message_id, error_message,
              has_attachments, is_read, sent_at, created_at
       FROM email_logs
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    res.json({
      success: true,
      data: emails,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)) || 1
      }
    });
  } catch (error) {
    console.error('List emails error:', error);
    res.status(500).json({ success: false, message: 'Error fetching emails' });
  }
});

// GET /api/admin/emails/:id - View email detail
router.get('/admin/emails/:id', authenticateOperator, async (req, res) => {
  try {
    const email = await db.query('SELECT * FROM email_logs WHERE id = ?', [req.params.id]);
    if (!email.length) return res.status(404).json({ success: false, message: 'Email tidak ditemukan' });

    await db.query('UPDATE email_logs SET is_read = 1 WHERE id = ?', [req.params.id]);

    res.json({ success: true, data: email[0] });
  } catch (error) {
    console.error('View email error:', error);
    res.status(500).json({ success: false, message: 'Error fetching email detail' });
  }
});

// POST /api/admin/emails/send - Send new email
router.post('/admin/emails/send', authenticateOperator, async (req, res) => {
  try {
    const { to, cc, bcc, subject, body, category } = req.body;

    if (!to || !subject || !body) {
      return res.status(400).json({ success: false, message: 'Penerima, subjek, dan isi email diperlukan' });
    }

    const htmlBody = body.replace(/\n/g, '<br>');
    const result = await global.sendEmail(to, subject, htmlBody, body, [], category || 'system', null, cc, bcc);

    if (result.success) {
      res.json({ success: true, message: 'Email berhasil dikirim', logId: result.logId });
    } else {
      res.status(500).json({ success: false, message: result.message, logId: result.logId });
    }
  } catch (error) {
    console.error('Send email error:', error);
    res.status(500).json({ success: false, message: 'Error sending email: ' + error.message });
  }
});

// POST /api/admin/emails/draft - Save draft email
router.post('/admin/emails/draft', authenticateOperator, async (req, res) => {
  try {
    const { to, cc, bcc, subject, body } = req.body;

    const result = await db.query(
      'INSERT INTO email_logs (from_email, to_email, cc, bcc, subject, body_text, body_html, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        process.env.EMAIL_USER || 'noreply@ypwilutim.com',
        to || '',
        cc || null,
        bcc || null,
        subject || '(Tanpa Subjek)',
        body || null,
        body ? body.replace(/\n/g, '<br>') : null,
        'draft'
      ]
    );

    res.json({ success: true, message: 'Draft tersimpan', draftId: result.insertId });
  } catch (error) {
    console.error('Save draft error:', error);
    res.status(500).json({ success: false, message: 'Error saving draft' });
  }
});

// PUT /api/admin/emails/:id/read - Mark email as read
router.put('/admin/emails/:id/read', authenticateOperator, async (req, res) => {
  try {
    await db.query('UPDATE email_logs SET is_read = 1 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ success: false, message: 'Error marking email as read' });
  }
});

// GET /api/public/lookup-nik - Lookup NIK in teachers or parents table
router.get('/public/lookup-nik', async (req, res) => {
  try {
    const nik = req.query.nik;
    if (!nik) {
      return res.status(400).json({ success: false, message: 'NIK harus diisi' });
    }

    let result = await db.query('SELECT nama FROM teachers WHERE nik = ? LIMIT 1', [nik]);
    if (result.length > 0) {
      return res.json({ success: true, nama: result[0].nama });
    }

    result = await db.query('SELECT nama_orang_tua as nama FROM parents WHERE nik = ? LIMIT 1', [nik]);
    if (result.length > 0) {
      return res.json({ success: true, nama: result[0].nama });
    }

    res.json({ success: false, message: 'NIK tidak ditemukan' });
  } catch (error) {
    console.error('Lookup NIK error:', error);
    res.status(500).json({ success: false, message: 'Error looking up NIK' });
  }
});

module.exports = router;

