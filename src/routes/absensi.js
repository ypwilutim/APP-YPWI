// ============================================================
// ABSENSI ROUTES - Extracted from server.js for modular architecture
// Version: 2.0.0 (Post-Migration with attendance_rules support)
// ============================================================

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../../db');
const { authenticateToken, authenticateOperator, isDayMatch, calculateDistance, verifyTenantAccess } = require('../middleware/auth');

const router = express.Router();

// ============================================================
// HELPER FUNCTIONS - Imported from middleware/auth.js
// ============================================================

// Multer config for selfie uploads
const selfieStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'selfie/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'selfie-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const selfieUpload = multer({ storage: selfieStorage });

// ============================================================
// ROUTES
// ============================================================

router.post('/attendance', authenticateToken, selfieUpload.single('selfie'), async (req, res) => {
  try {
    const { jenis, metode, latitude, longitude, waktu_absen, waktu_scan, rule_id, status, kegiatan_dinas } = req.body;
    let selfie_url = req.file ? req.file.path : null;
    
    // Deteksi tenant_id dari lokasi GPS (jika guru multi-tenant)
    let detected_tenant_id = req.body.tenant_id || req.user.tenant_id;
    if (latitude && longitude && !req.body.tenant_id) {
      const userLat = parseFloat(latitude);
      const userLng = parseFloat(longitude);
      
      // Ambil semua tenant dengan lokasi
      const tenants = await db.query(
        `SELECT tenant_id, latitude, longitude, location_radius 
         FROM tenants 
         WHERE latitude IS NOT NULL AND longitude IS NOT NULL`
      );
      
      // Cari tenant mana yang mencakup lokasi user
      for (const t of tenants) {
        const dist = Math.sqrt(
          Math.pow((t.latitude - userLat), 2) + Math.pow((t.longitude - userLng), 2)
        );
        const radiusKm = (t.location_radius || 200) / 111000; // Convert meter to km approximation
        if (dist <= radiusKm) {
          detected_tenant_id = t.tenant_id;
          break;
        }
      }
    }

    if (!jenis || !waktu_scan) {
      return res.status(400).json({ success: false, message: 'jenis dan waktu_scan wajib diisi' });
    }

    // Cek duplikat absen dalam 1 menit terakhir
    const [existing] = await db.query(
      'SELECT id FROM attendance_logs WHERE teacher_id = ? AND jenis = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 1 MINUTE)',
      [req.user.guru_id, jenis]
    );
    if (existing && existing.length > 0) {
      return res.status(400).json({ success: false, message: 'Absen sudah dilakukan beberapa detik lalu' });
    }

    // Cek absen masuk/pulang hari ini di unit yang sama
    const today = new Date().toISOString().split('T')[0];
    const [todayLog] = await db.query(
      'SELECT jenis, tenant_id FROM attendance_logs WHERE teacher_id = ? AND DATE(created_at) = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 1',
      [req.user.guru_id, today, detected_tenant_id]
    );
    if (todayLog && todayLog.jenis === jenis) {
      return res.status(400).json({ success: false, message: `Anda sudah absen ${jenis} hari ini di unit ini` });
    }

    // 1. Simpan ke Database
    const insertQuery = `
      INSERT INTO attendance_logs 
      (teacher_id, tenant_id, waktu_scan, created_at, jenis, metode, status, kegiatan_dinas, selfie_url, latitude, longitude, rule_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await db.query(insertQuery, [
      req.user.guru_id, detected_tenant_id,
      waktu_scan,    // Jam lokal (HH:mm:ss) dari Frontend
      waktu_absen,   // ISO String (UTC) untuk audit
      jenis, metode || 'dashboard', status, kegiatan_dinas || null,
      selfie_url, latitude, longitude, rule_id
    ]);

    // 2. Notifikasi WhatsApp
    try {
      const [teacher] = await db.query('SELECT nama, no_hp FROM teachers WHERE id = ?', [req.user.guru_id]);
      const [tenant] = await db.query('SELECT nama_sekolah FROM tenants WHERE tenant_id = ?', [detected_tenant_id]);

      if (teacher && teacher.no_hp) {
        const waktuAbsenObj = new Date(waktu_absen);
        const tanggalSekarang = waktuAbsenObj.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

        const waMessage = `*NOTIFIKASI PRESENSI YPWI*
Halo *${teacher.nama}*,
Laporan absensi Anda berhasil direkam.

*Detail:*
• Jenis: Absen ${jenis.toUpperCase()}
• Instansi: ${tenant ? tenant.nama_sekolah : tenant_id}
• Hari/Tgl: ${tanggalSekarang}
• Jam Log: ${waktu_scan} (Waktu Lokal)

Terima kasih.`;

        if (typeof global.sendWhatsAppMessage === 'function') {
          await global.sendWhatsAppMessage(teacher.no_hp, waMessage);
        }
      }
    } catch (waError) {
      console.error('WA Error:', waError.message);
    }

    return res.json({ success: true, message: 'Absensi berhasil' });
  } catch (error) {
    console.error('Attendance error:', error);
    return res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
});

// Admin tenants list
router.get('/api/admin/tenants', authenticateOperator, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    console.log('Fetching tenants...', tenantId ? 'tenant=' + tenantId : 'all');
    var query = 'SELECT tenant_id, nama_sekolah, absensi_method, use_central_rules, latitude, longitude, COALESCE(location_radius, 100) as location_radius, location_name FROM tenants';
    var params = [];
    if (tenantId) {
      query += ' WHERE tenant_id = ? ';
      params.push(tenantId);
    }
    query += ' ORDER BY nama_sekolah ASC';
    var tenants = await db.query(query, params);
    console.log('Tenants fetched:', tenants.length);

    // Format data for frontend
    const result = tenants.map(tenant => ({
      tenant_id: tenant.tenant_id,
      nama_sekolah: tenant.nama_sekolah,
      absensi_method: tenant.absensi_method,
      use_central_rules: tenant.use_central_rules,
      latitude: tenant.latitude,
      longitude: tenant.longitude,
      location_radius: tenant.location_radius,
      location_name: tenant.location_name,
      has_location: !!(tenant.latitude && tenant.longitude)
    }));

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Admin tenants error:', error);
    res.status(500).json({ success: false, message: 'Error fetching tenants' });
  }
});

// Admin summary endpoint
router.get('/api/admin/summary', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;

    // Operator: force tenant_id dari assignment jika tidak disediakan
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
      return res.status(403).json({ success: false, message: 'Akses ditolak: Anda tidak berwenang mengakses data sekolah ini' });
    }

    // Get total teachers
    let teacherQuery = 'SELECT COUNT(DISTINCT t.id) as count FROM teachers t';
    let teacherParams = [];
    if (tenantId) {
      teacherQuery += ' JOIN teacher_assignments ta ON t.id = ta.teacher_id AND ta.tenant_id = ? ';
      teacherParams.push(tenantId);
    }
    teacherQuery += ' WHERE t.status_aktif = 1';
    const [totalTeachersResult] = await db.query(teacherQuery, teacherParams);
    const totalTeachers = totalTeachersResult.count;

    // Get active today (teachers who have attendance today)
    // Include dinas luar records so they appear in all connected units
    let activeQuery = `
      SELECT COUNT(DISTINCT a.teacher_id) as count
      FROM attendance_logs a
      JOIN teachers t ON a.teacher_id = t.id
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      WHERE DATE(a.waktu_scan) = CURDATE() AND (a.tenant_id = ? OR a.dinas_luar = 1)
    `;
    let activeParams = [];
    if (tenantId) {
      activeParams.push(tenantId, tenantId);
    }
    const [activeTodayResult] = await db.query(activeQuery, activeParams);
    const activeToday = activeTodayResult.count;

    // Get late today
    let lateQuery = `
      SELECT COUNT(*) as count
      FROM attendance_logs a
      JOIN teachers t ON a.teacher_id = t.id
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      WHERE DATE(a.waktu_scan) = CURDATE() AND a.status = 'terlambat' AND (a.tenant_id = ? OR a.dinas_luar = 1)
    `;
    let lateParams = [];
    if (tenantId) {
      lateParams.push(tenantId, tenantId);
    }
    const [lateTodayResult] = await db.query(lateQuery, lateParams);
    const lateToday = lateTodayResult.count;

    // Get total locations for this tenant
    let locQuery = 'SELECT COUNT(*) as count FROM tenant_locations WHERE 1=1';
    let locParams = [];
    if (tenantId) {
      locQuery += ' AND tenant_id = ? ';
      locParams = [tenantId];
    }
    const [totalLocationsResult] = await db.query(locQuery, locParams);
    const totalLocations = totalLocationsResult.count;

    res.json({
      success: true,
      data: {
        totalTeachers,
        activeToday,
        lateToday,
        totalLocations
      }
    });
  } catch (error) {
    console.error('Admin summary error:', error);
    res.status(500).json({ success: false, message: 'Error fetching admin summary' });
  }
});

// GANTI KODE RUTE DI src/routes/absensi.js DENGAN INI
router.get('/attendance-rules', authenticateToken, async (req, res) => {
  try {
    // Mengubah db.execute menjadi db.query agar sesuai dengan driver MySQL proyek Anda
    const rules = await db.query(
      'SELECT id, tenant_id, tipe, jam_mulai, jam_selesai, status_log FROM attendance_rules'
    );

    // Beberapa driver mengembalikan data langsung, beberapa mengembalikan array dalam array ([rules])
    // Kita pastikan data yang dikirim adalah array utuh
    const dataRules = Array.isArray(rules) ? rules : (rules.rows || rules[0] || []);

    return res.status(200).json({
      success: true,
      rules: dataRules
    });
  } catch (error) {
    console.error('Error fetching attendance rules:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal mengambil data aturan absensi internal server.'
    });
  }
});


// Admin attendance logs
router.get('/api/admin/attendance-logs', authenticateOperator, async (req, res) => {
  try {
    const dateFilter = req.query.date;
    const statusFilter = req.query.status;
    let tenantId = req.query.tenant_id;

    // Operator: force tenant_id dari assignment jika tidak disediakan
    if (req.user.role !== 'admin' && !tenantId) {
      const adminAssignments = (req.user.assignments || []).filter(a => {
        const roles = ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (adminAssignments.length === 1) {
        tenantId = adminAssignments[0].tenant_id;
      }
    }

    // Verify tenant access jika tenantId ada
    if (tenantId && !verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak: Anda tidak berwenang mengakses data kehadiran sekolah ini' });
    }

    let query = '';
    let params = [];

    if (tenantId) {
      query = `
        SELECT
          al.id, al.teacher_id, al.tenant_id, al.waktu_scan, al.jenis, al.status, al.metode,
          t.nama, t.nip
        FROM attendance_logs al
        JOIN teachers t ON al.teacher_id = t.id
        JOIN teacher_assignments ta ON t.id = ta.teacher_id
        WHERE ta.tenant_id = ? AND (al.tenant_id = ? OR al.dinas_luar = 1)
      `;
      params.push(tenantId, tenantId);
    } else {
      query = `
        SELECT
          al.id, al.teacher_id, al.tenant_id, al.waktu_scan, al.jenis, al.status, al.metode,
          t.nama, t.nip
        FROM attendance_logs al
        JOIN teachers t ON al.teacher_id = t.id
        WHERE 1=1
      `;
    }

    if (dateFilter) {
      query += ' AND DATE(al.waktu_scan) = ?';
      params.push(dateFilter);
    }

    if (statusFilter && statusFilter !== '') {
      query += ' AND al.status = ?';
      params.push(statusFilter);
    }

    query += ' ORDER BY al.waktu_scan DESC LIMIT 100';

    const logs = await db.query(query, params);

    res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    console.error('Admin attendance logs error:', error);
    res.status(500).json({ success: false, message: 'Error fetching attendance logs', error: error.message });
  }
});

router.get('/attendance-history', authenticateToken, async (req, res) => {
  try {
    const attendance = await db.query(
      `SELECT al.id, al.jenis, al.waktu_scan, al.status, al.tenant_id, t.nama_sekolah, al.rule_id, ar.keterangan as rule_keterangan
       FROM attendance_logs al
       JOIN tenants t ON al.tenant_id = t.tenant_id
       LEFT JOIN attendance_rules ar ON al.rule_id = ar.id
       WHERE al.teacher_id = ? ORDER BY al.waktu_scan DESC LIMIT 50`,
      [req.user.guru_id]
    );

    // Kirim waktu_scan yang disimpan (lokal string) bersama info rule/keterangan
    res.json({ success: true, data: attendance });

  } catch (error) {
    console.error('[SERVER ERROR]', error.message);
    res.status(500).json({ success: false, message: 'Error fetching attendance history' });
  }
});

// GET /api/admin/attendance-logs - Admin attendance logs with rule info
router.get('/admin/attendance-logs', authenticateOperator, async (req, res) => {
  try {
    const dateFilter = req.query.date;
    const statusFilter = req.query.status;
    let tenantId = req.query.tenant_id;

    // Operator: force tenant_id from assignment if not provided
    if (req.user.role !== 'admin' && !tenantId) {
      const adminAssignments = (req.user.assignments || []).filter(a => {
        const roles = ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (adminAssignments.length === 1) {
        tenantId = adminAssignments[0].tenant_id;
      }
    }

    // KODE PERBAIKAN: Filter berdasarkan teacher_assignments dengan logika:
    // - Absen di unit tempat scan (al.tenant_id = tenantId): hanya muncul di unit itu
    // - Absen dinas luar (al.dinas_luar = 1): muncul di SEMUA unit guru
    let query = `
      SELECT al.id, al.teacher_id, al.waktu_scan, al.jenis, al.status, al.metode,
             t.nama, t.nip, ten.nama_sekolah, ar.keterangan AS nama_aturan,
             al.tenant_id as scan_tenant_id, al.dinas_luar
      FROM attendance_logs al
      JOIN teachers t ON al.teacher_id = t.id
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      JOIN tenants ten ON al.tenant_id = ten.tenant_id
      LEFT JOIN attendance_rules ar ON al.rule_id = ar.id
    `;
    let params = [];

    if (tenantId) {
      query += ` WHERE ta.tenant_id = ? 
                 AND (al.tenant_id = ? OR al.dinas_luar = 1)`;
      params.push(tenantId, tenantId);
    }

    if (dateFilter) {
      query += (tenantId ? ' AND' : ' WHERE') + ' DATE(al.waktu_scan) = ?';
      params.push(dateFilter);
    }

    if (statusFilter && statusFilter !== '') {
      query += (tenantId || dateFilter ? ' AND' : ' WHERE') + ' al.status = ?';
      params.push(statusFilter);
    }

    query += ' ORDER BY al.waktu_scan DESC LIMIT 100';

    const logs = await db.query(query, params);

    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('Admin attendance logs error:', error);
    res.status(500).json({ success: false, message: 'Error fetching attendance logs' });
  }
});

// GET /api/units/nearby - Find nearest units with tipe_unit awareness (includes tenant_locations)
router.get('/units/nearby', authenticateToken, async (req, res) => {
  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ success: false, message: 'Latitude and longitude required' });
    }

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);

    // Ambil data dari tabel tenants utama
    const tenantsData = await db.query(
      `SELECT tenant_id, nama_sekolah, latitude, longitude, location_radius, tipe_unit
       FROM tenants
       WHERE latitude IS NOT NULL AND longitude IS NOT NULL`
    );

    // Ambil data dari tabel tenant_locations (cabang/sub-lokasi)
    const subLocationsData = await db.query(
      `SELECT tl.tenant_id, t.nama_sekolah, tl.latitude, tl.longitude,
              tl.location_radius, t.tipe_unit
       FROM tenant_locations tl
       JOIN tenants t ON tl.tenant_id = t.tenant_id
       WHERE tl.latitude IS NOT NULL AND tl.longitude IS NOT NULL AND tl.is_active = 1`
    );

    // Gabungkan kedua array
    const allUnits = [...tenantsData, ...subLocationsData];

    if (allUnits.length === 0) {
      return res.json({
        success: true,
        currentLocation: { lat: userLat, lng: userLng },
        units: [],
        nearestUnit: null
      });
    }

    // Calculate distances for all units
    const unitsWithDistance = allUnits.map(unit => ({
      tenant_id: unit.tenant_id,
      nama_sekolah: unit.nama_sekolah,
      latitude: unit.latitude,
      longitude: unit.longitude,
      location_radius: unit.location_radius,
      tipe_unit: unit.tipe_unit,
      distance: calculateDistance(userLat, userLng, parseFloat(unit.latitude), parseFloat(unit.longitude)),
      isNearest: false
    }));

    // Sort by distance
    unitsWithDistance.sort((a, b) => a.distance - b.distance);

    // Mark actual nearest
    if (unitsWithDistance.length > 0) {
      unitsWithDistance[0].isNearest = true;
    }

    res.json({
      success: true,
      currentLocation: { lat: userLat, lng: userLng },
      units: unitsWithDistance,
      nearestUnit: unitsWithDistance.find(u => u.isNearest) || null
    });
  } catch (error) {
    console.error('Error fetching nearby units:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch nearby units' });
  }
});

// GET /api/units/all - Get all units (tenants + tenant_locations sub-locations) with tipe_unit
router.get('/units/all', authenticateToken, async (req, res) => {
  try {
    // Ambil data dari tabel tenants utama
    const tenantsData = await db.query(
      `SELECT tenant_id, nama_sekolah, latitude, longitude, location_radius, tipe_unit
       FROM tenants
       WHERE latitude IS NOT NULL AND longitude IS NOT NULL`
    );

    // Ambil data dari tabel tenant_locations (cabang/sub-lokasi)
    const subLocationsData = await db.query(
      `SELECT tl.tenant_id, t.nama_sekolah, tl.latitude, tl.longitude,
              tl.location_radius, t.tipe_unit
       FROM tenant_locations tl
       JOIN tenants t ON tl.tenant_id = t.tenant_id
       WHERE tl.latitude IS NOT NULL AND tl.longitude IS NOT NULL AND tl.is_active = 1`
    );

    // Gabungkan kedua array (jika ada tenant_id yang sama di kedua tabel, tetap tampilkan keduanya)
    const allUnits = [...tenantsData, ...subLocationsData];

    res.json({
      success: true,
      units: allUnits
    });
  } catch (error) {
    console.error('Error fetching all units:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch units' });
  }
});

// POST /api/evaluations/auto-calculate - Auto-calculate evaluations from attendance
router.post('/evaluations/auto-calculate', authenticateToken, async (req, res) => {
  try {
    const evaluator_id = req.user.id;

    // Get all teachers with their assignments and tenant info (with tipe_unit)
    const teachers = await db.query(`
      SELECT DISTINCT t.id, t.nama, ta.tenant_id, tn.tipe_unit, tn.nama_sekolah
      FROM teachers t 
      JOIN teacher_assignments ta ON t.id = ta.teacher_id 
      JOIN tenants tn ON ta.tenant_id = tn.tenant_id
      WHERE t.status_aktif = 1 AND ta.tenant_id IS NOT NULL
    `);

    // Calculate attendance rate per teacher for current month
    const stats = await db.query(`
      SELECT 
        teacher_id,
        tenant_id,
        COUNT(DISTINCT DATE(waktu_scan)) as total_days,
        SUM(CASE WHEN status = 'tepat_waktu' THEN 1 ELSE 0 END) as present_days,
        SUM(CASE WHEN status = 'terlambat' THEN 1 ELSE 0 END) as late_days
      FROM attendance_logs 
      WHERE DATE_FORMAT(waktu_scan, '%Y-%m') = DATE_FORMAT(NOW(), '%Y-%m')
      GROUP BY teacher_id, tenant_id
    `);

    const results = [];

    for (const teacher of teachers) {
      const teacherStat = stats.find(s => s.teacher_id === teacher.id) || { total_days: 0, present_days: 0 };

      let score = 0;
      if (teacherStat.total_days > 0 && teacherStat.present_days > 0) {
        const rate = (teacherStat.present_days / teacherStat.total_days) * 100;
        if (rate >= 95) score = 5.0;
        else if (rate >= 90) score = 4.5;
        else if (rate >= 85) score = 4.0;
        else if (rate >= 80) score = 3.5;
        else if (rate >= 75) score = 3.0;
        else if (rate >= 70) score = 2.5;
        else if (rate >= 65) score = 2.0;
        else score = 1.0;
      }

      if (teacherStat.total_days > 0 && score > 0) {
        await db.query(`
          INSERT INTO evaluations (teacher_id, evaluator_id, tenant_id, score, category, notes, evaluation_date)
          VALUES (?, ?, ?, ?, 'kehadiran', ?, CURDATE())
          ON DUPLICATE KEY UPDATE score = VALUES(score), notes = VALUES(notes)
        `, [teacher.id, evaluator_id, teacher.tenant_id, score, `Otomatis: ${teacherStat.present_days}/${teacherStat.total_days} hari hadir (${teacher.nama_sekolah})`]);

        results.push({ id: teacher.id, score, nama: teacher.nama, sekolah: teacher.nama_sekolah });
      }
    }

    res.json({ success: true, message: `Berhasil menilai ${results.length} guru`, data: results });
  } catch (error) {
    console.error('Auto calculate error:', error);
    res.status(500).json({ success: false, message: 'Error auto calculating evaluations' });
  }
});

// GET /api/tenants - Public route for tenant list (for dropdowns)
router.get('/tenants', async (req, res) => {
  try {
    const rows = await db.query('SELECT tenant_id, nama_sekolah, tipe_unit FROM tenants ORDER BY nama_sekolah ASC');
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('[SERVER ERROR]', error.message);
    res.status(500).json({ success: false, message: 'Error fetching tenants' });
  }
});

// GET /api/tenants/:id - Get tenant by ID with full info
router.get('/tenants/:id', authenticateToken, async (req, res) => {
  try {
    const [tenant] = await db.query(
      'SELECT *, tipe_unit FROM tenants WHERE tenant_id = ?',
      [req.params.id]
    );
    if (tenant) {
      res.json({ success: true, tenant: tenant });
    } else {
      res.status(404).json({ success: false, message: 'Tenant not found' });
    }
  } catch (error) {
    console.error('[SERVER ERROR]', error.message);
    res.status(500).json({ success: false, message: 'Error fetching tenant' });
  }
});

// ============================================================
// EXPORT ROUTER
// ============================================================

module.exports = router;