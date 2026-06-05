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
    const { jenis, metode, latitude, longitude, waktu_absen, waktu_scan, rule_id, status, kegiatan_dinas, client_timezone } = req.body;
    let selfie_url = req.file ? req.file.path : null;
    const userTimezone = client_timezone || 'Asia/Makassar';

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

    // Frontend sudah menangani validasi duplikat dan aturan waktu
    // Backend hanya menerima dan menyimpan data ke database

    // Simpan ke Database
    const insertQuery = `
      INSERT INTO attendance_logs 
      (teacher_id, tenant_id, waktu_scan, waktu_absen, jenis, metode, status, dinas_luar, kegiatan_dinas, selfie_url, latitude, longitude, rule_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const is_dinas_luar = kegiatan_dinas ? 1 : 0;
    await db.query(insertQuery, [
      req.user.guru_id, detected_tenant_id,
      waktu_scan,    // Jam lokal (HH:mm:ss) dari Frontend
      waktu_absen,   // ISO String (UTC) untuk audit
      jenis, metode || 'dashboard', status, is_dinas_luar,
      kegiatan_dinas || null, selfie_url, latitude, longitude, rule_id
    ]);

// Email notification for scanner attendance (non-blocking)
    setImmediate(async () => {
      try {
        const [teacher] = await db.query('SELECT nama, no_wa, email FROM teachers WHERE id = ?', [req.user.guru_id]);
        const [tenant] = await db.query('SELECT nama_sekolah FROM tenants WHERE tenant_id = ?', [detected_tenant_id]);

        if (teacher && teacher.no_wa) {
          const [datePart, timePart] = (waktu_scan || '').split(' ');
          const tanggalSekarang = datePart || new Date().toISOString().split('T')[0];
          const jamLokal = timePart ? timePart.slice(0, 5) : '';

          const waMessage = `*PRESENSI BERHASIL ✅*\n\nالسَّلامُ عَلَيْكُمْ وَرَحْمَةُ اللهِ وَبَرَكَاتُهُ\n(Assalamu'alaikum Warahmatullahi Wabarakatuh)\n\nHalo *${teacher.nama}*,\nAlhamdulillah, data presensi *${jenis.toUpperCase()}* Anda telah tersimpan dengan baik.\n\n📌 *Detail Presensi:*\n• Unit: ${tenant ? tenant.nama_sekolah : detected_tenant_id}\n• Tgl : ${tanggalSekarang}\n• Jam : ${jamLokal}\n\nTerima kasih atas dedikasi dan kedisiplinan Anda.`;

          if (typeof global.sendWhatsAppMessage === 'function') {
            global.sendWhatsAppMessage(teacher.no_wa, waMessage).catch(err => console.warn('WA Error:', err.message));
          }
        }

        if (teacher && teacher.email) {
          const [datePart, timePart] = (waktu_scan || '').split(' ');
          const tanggalSekarang = datePart || new Date().toISOString().split('T')[0];
          const jamLokal = timePart ? timePart.slice(0, 5) : '';

          const htmlMessage = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Notifikasi Absensi - YPWI Lutim</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 20px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
    <div style="background: linear-gradient(135deg, #066e3a 0%, #0a8a4a 100%); padding: 30px; text-align: center;">
      <h1 style="margin: 0; color: white; font-size: 24px;">YPWI LUTIM</h1>
      <p style="margin: 5px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">Notifikasi Absensi Digital</p>
    </div>
    <div style="padding: 30px;">
      <h2 style="margin: 0 0 20px 0; color: #333; font-size: 20px;">✅ Presensi ${jenis.toUpperCase()} Berhasil</h2>
      <p style="margin: 0 0 15px 0; color: #555; font-size: 16px; line-height: 1.6;">
        Assalamu'alaikum <strong>${teacher.nama}</strong>,
      </p>
      <p style="margin: 0 0 20px 0; color: #555; font-size: 16px; line-height: 1.6;">
        Presensi ${jenis} Anda telah berhasil direkam di sistem.
      </p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Unit Sekolah:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: 600;">${tenant ? tenant.nama_sekolah : detected_tenant_id}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Tanggal:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: 600;">${tanggalSekarang}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Waktu:</td><td style="padding: 8px 0; font-weight: 600;">${jamLokal} (WITA)</td></tr>
      </table>
      <p style="margin: 20px 0 0 0; color: #888; font-size: 14px;">Email ini dikirim otomatis oleh sistem.</p>
    </div>
  </div>
</body>
</html>`;

          if (typeof global.sendEmail === 'function') {
            global.sendEmail(teacher.email, `Presensi ${jenis.toUpperCase()} Berhasil - YPWI Lutim`, htmlMessage).catch(err => console.warn('Email Error:', err.message));
          }
        }
      } catch (waError) {
        console.error('WA/Email Error:', waError.message);
      }
    });

    return res.json({ success: true, message: 'Absensi berhasil' });
  } catch (error) {
    console.error('Attendance error:', error);
    return res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
});

// Removed duplicate routes - handled by admin.js

router.get('/attendance-rules', authenticateToken, async (req, res) => {
  try {
    const { lat, lng, tenant_id } = req.query;
    let targetTenantId = tenant_id;
    let useCentral = false;

    // Jika ada lat/lng, deteksi tenant otomatis berdasarkan lokasi GPS
    if (lat && lng && !targetTenantId) {
      const userLat = parseFloat(lat);
      const userLng = parseFloat(lng);

      if (!isNaN(userLat) && !isNaN(userLng)) {
        const tenants = await db.query(
          `SELECT tenant_id, latitude, longitude, location_radius 
           FROM tenants 
           WHERE latitude IS NOT NULL AND longitude IS NOT NULL`
        );

        const subLocations = await db.query(
          `SELECT tl.tenant_id, tl.latitude, tl.longitude, tl.location_radius
           FROM tenant_locations tl
           JOIN tenants t ON tl.tenant_id = t.tenant_id
           WHERE tl.latitude IS NOT NULL AND tl.longitude IS NOT NULL AND tl.is_active = 1`
        );

        const allLocations = [...tenants, ...subLocations];

        // Cari semua tenant assignment user yang dalam radius, urutkan berdasarkan jarak
        const userAssignments = req.user?.assignments || [];
        const userHomeTenantIds = [...new Set(userAssignments.map(a => a.tenant_id))];

        const homeTenantsInRadius = userHomeTenantIds
          .map(tenantId => {
            const loc = allLocations.find(l => l.tenant_id === tenantId);
            if (!loc) return null;

            const dist = Math.sqrt(
              Math.pow(parseFloat(loc.latitude) - userLat, 2) +
              Math.pow(parseFloat(loc.longitude) - userLng, 2)
            );
            const radiusKm = (loc.location_radius || 200) / 111000;

            return dist <= radiusKm ? { tenant_id: loc.tenant_id, distance: dist * 1000 } : null;
          })
          .filter(Boolean)
          .sort((a, b) => a.distance - b.distance);

        // Jika ada assignment dalam radius, pilih yang terdekat
        // Jika tidak ada, cari tenant mana saja yang dalam radius (dinas luar)
        targetTenantId = homeTenantsInRadius.length > 0
          ? homeTenantsInRadius[0].tenant_id
          : allLocations
            .map(loc => {
              const dist = Math.sqrt(
                Math.pow(parseFloat(loc.latitude) - userLat, 2) +
                Math.pow(parseFloat(loc.longitude) - userLng, 2)
              );
              const radiusKm = (loc.location_radius || 200) / 111000;

              return dist <= radiusKm ? { tenant_id: loc.tenant_id, distance: dist * 1000 } : null;
            })
            .filter(Boolean)
            .sort((a, b) => a.distance - b.distance)[0]?.tenant_id;

        console.log('[ATTENDANCE-RULES] Home tenants in radius:', homeTenantsInRadius, 'Selected:', targetTenantId);
      }
    }

    // Cek apakah tenant menggunakan aturan pusat
    if (targetTenantId) {
      const [tenantInfo] = await db.query(
        'SELECT use_central_rules FROM tenants WHERE tenant_id = ?',
        [targetTenantId]
      );

      if (tenantInfo && tenantInfo.use_central_rules === 1) {
        targetTenantId = 'YPWILUTIM';
        useCentral = true;
      }
    }

    // Query rules berdasarkan tenant_id
    let query = 'SELECT id, tenant_id, tipe, jam_mulai, jam_selesai, status_log, hari FROM attendance_rules';
    let params = [];

    if (targetTenantId) {
      query += ' WHERE tenant_id = ?';
      params.push(targetTenantId);
    }

    query += ' ORDER BY tipe, jam_mulai';

    const rules = await db.query(query, params);

    const dataRules = Array.isArray(rules) ? rules : (rules.rows || rules[0] || []);

    return res.status(200).json({
      success: true,
      rules: dataRules,
      source_tenant: targetTenantId || 'universal',
      use_central: useCentral
    });
  } catch (error) {
    console.error('Error fetching attendance rules:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal mengambil data aturan absensi internal server.'
    });
  }
});


router.get('/attendance-history', authenticateToken, async (req, res) => {
  try {
    const attendance = await db.query(
      `SELECT al.id, al.jenis, al.waktu_scan, al.waktu_absen, al.status, al.tenant_id, t.nama_sekolah, al.rule_id, ar.keterangan as rule_keterangan
       FROM attendance_logs al
       JOIN tenants t ON al.tenant_id = t.tenant_id
       LEFT JOIN attendance_rules ar ON al.rule_id = ar.id
       WHERE al.teacher_id = ? ORDER BY al.waktu_scan DESC LIMIT 50`,
      [req.user.guru_id]
    );

    // Kirim waktu_scan dan waktu_absen untuk konsistensi timezone
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
    // BARIS 401-409 - DIPERBAIKI
    const stats = await db.query(`
  SELECT 
    teacher_id,
    tenant_id,
    COUNT(DISTINCT DATE(
      CASE 
        WHEN waktu_absen IS NOT NULL AND waktu_absen != '' THEN waktu_absen 
        ELSE CONVERT_TZ(waktu_scan, '+08:00', '+00:00') 
      END
    )) as total_days,
    SUM(CASE WHEN status = 'tepat_waktu' THEN 1 ELSE 0 END) as present_days,
    SUM(CASE WHEN status = 'terlambat' THEN 1 ELSE 0 END) as late_days
  FROM attendance_logs 
  WHERE DATE_FORMAT(
    CASE 
      WHEN waktu_absen IS NOT NULL AND waktu_absen != '' THEN waktu_absen 
      ELSE CONVERT_TZ(waktu_scan, '+08:00', '+00:00') 
    END, '%Y-%m') = DATE_FORMAT(UTC_DATE(), '%Y-%m')
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
          VALUES (?, ?, ?, ?, 'kehadiran', ?, UTC_DATE())
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
// LEAVE REQUEST ROUTES
// ============================================================
router.post('/leave-request', authenticateToken, async (req, res) => {
  try {
    const { jenis, keterangan, tanggal_mulai, tanggal_selesai, tenant_id } = req.body;

    if (!jenis || !keterangan || !tanggal_mulai) {
      return res.status(400).json({ success: false, message: 'Jenis, keterangan, dan tanggal mulai wajib diisi' });
    }

    const validTypes = ['izin', 'sakit', 'cuti', 'dinas_luar'];
    if (!validTypes.includes(jenis)) {
      return res.status(400).json({ success: false, message: 'Jenis izin tidak valid' });
    }

    // Cek duplikasi izin pada hari yang sama atau dalam rentang (semua status kecuali rejected)
    const existing = await db.query(
      `SELECT id, status FROM leave_requests 
             WHERE teacher_id = ? AND jenis = ? AND status != 'rejected'
             AND (
                (? BETWEEN tanggal_mulai AND tanggal_selesai) OR
                (? BETWEEN tanggal_mulai AND tanggal_selesai) OR
                (tanggal_mulai BETWEEN ? AND ? AND tanggal_selesai BETWEEN ? AND ?)
             )`,
      [req.user.guru_id, jenis, tanggal_mulai, tanggal_selesai || tanggal_mulai, tanggal_mulai, tanggal_selesai || tanggal_mulai, tanggal_mulai, tanggal_selesai || tanggal_mulai]
    );

    // Cek juga apakah sudah ada izin di tanggal yang sama (approved)
    const today = new Date().toISOString().split('T')[0];
    const sameDayLeave = await db.query(
      `SELECT id FROM leave_requests 
             WHERE teacher_id = ? AND status = 'approved'
             AND ? BETWEEN tanggal_mulai AND tanggal_selesai`,
      [req.user.guru_id, today]
    );

    if (existing && existing.length > 0) {
      return res.status(400).json({ success: false, message: 'Anda sudah mengajukan ' + jenis + ' pada rentang tanggal ini' });
    }

    if (sameDayLeave && sameDayLeave.length > 0) {
      return res.status(400).json({ success: false, message: 'Anda sudah memiliki izin aktif pada hari ini' });
    }

    // Simpan ke tabel leave_requests
    const result = await db.query(
      `INSERT INTO leave_requests (teacher_id, jenis, keterangan, tanggal_mulai, tanggal_selesai, status, created_at) 
             VALUES (?, ?, ?, ?, ?, 'pending', NOW())`,
      [req.user.guru_id, jenis, keterangan, tanggal_mulai, tanggal_selesai || tanggal_mulai]
    );

    // Notifikasi WhatsApp untuk pengajuan izin
    try {
      const [teacher] = await db.query('SELECT nama, no_wa, email FROM teachers WHERE id = ?', [req.user.guru_id]);
      if (teacher && teacher.no_wa) {
        const waMessage = `*PENGAJUAN IZIN YPWI*
Hai *${teacher.nama}*, pengajuan izin Anda telah diterima sistem.

*Detail:*
• Jenis: ${jenis.toUpperCase()}
• Periode: ${tanggal_mulai} s/d ${tanggal_selesai || tanggal_mulai}
• Keterangan: ${keterangan}
• Status: *PENDING* - Menunggu persetujuan

Pesan akan otomatis terkirim ke admin untuk review.`;

        if (typeof global.sendWhatsAppMessage === 'function') {
          await global.sendWhatsAppMessage(teacher.no_wa, waMessage);
        }
      }

      // Send email notification for leave request
      if (teacher && teacher.email) {
        const htmlMessage = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pengajuan Izin - YPWI Lutim</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 20px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
    <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 30px; text-align: center;">
      <h1 style="margin: 0; color: white; font-size: 24px;">YPWI LUTIM</h1>
      <p style="margin: 5px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">Notifikasi Pengajuan Izin</p>
    </div>
    <div style="padding: 30px;">
      <h2 style="margin: 0 0 20px 0; color: #333; font-size: 20px;">📝 Pengajuan Izin Terkirim</h2>
      <p style="margin: 0 0 15px 0; color: #555; font-size: 16px; line-height: 1.6;">
        Assalamu'alaikum <strong>${teacher.nama}</strong>,
      </p>
      <p style="margin: 0 0 20px 0; color: #555; font-size: 16px; line-height: 1.6;">
        Pengajuan izin Anda telah diterima sistem dan menunggu persetujuan admin.
      </p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Jenis Izin:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: 600;">${jenis.toUpperCase()}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Periode:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: 600;">${tanggal_mulai} s/d ${tanggal_selesai || tanggal_mulai}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Keterangan:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: 600;">${keterangan}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Status:</td><td style="padding: 8px 0; font-weight: 600; color: #d97706;">PENDING - Menunggu Persetujuan</td></tr>
      </table>
      <p style="margin: 20px 0 0 0; color: #888; font-size: 14px;">Email ini dikirim otomatis oleh sistem.</p>
    </div>
  </div>
</body>
</html>`;

        if (typeof global.sendEmail === 'function') {
          await global.sendEmail(teacher.email, `Pengajuan Izin ${jenis.toUpperCase()} - YPWI Lutim`, htmlMessage);
        }
      }
    } catch (waError) {
      console.error('WA Error for leave request:', waError.message);
    }

    res.json({ success: true, message: 'Pengajuan izin berhasil dikirim', id: result.insertId });
  } catch (error) {
    console.error('Leave request error:', error);
    res.status(500).json({ success: false, message: 'Gagal mengajukan izin' });
  }
});

// GET /api/dashboard - Get dashboard summary for teacher
router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const guruId = req.user.guru_id;
    const today = new Date().toISOString().split('T')[0];

    const totalResult = await db.query(
      'SELECT COUNT(*) as total FROM attendance_logs WHERE teacher_id = ?',
      [guruId]
    );

    const todayResult = await db.query(
      'SELECT jenis, status FROM attendance_logs WHERE teacher_id = ? AND DATE(created_at) = ? ORDER BY created_at DESC LIMIT 1',
      [guruId, today]
    );

    const userCheck = await db.query(
      'SELECT is_default_password FROM teachers WHERE id = ?',
      [guruId]
    );

    res.json({
      success: true,
      data: {
        totalAbsensi: totalResult?.total || 0,
        absensiToday: todayResult ? (todayResult.jenis === 'masuk' ? 'Sudah Masuk' : 'Sudah Pulang') : 'Belum absen',
        user: {
          is_default_password: userCheck?.is_default_password || 0
        }
      }
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ success: false, message: 'Error loading dashboard data' });
  }
});

// GET /api/leave-requests - List leave requests for teacher
router.get('/leave-requests', authenticateToken, async (req, res) => {
  try {
    const { status, month } = req.query;
    let query = `SELECT lr.* FROM leave_requests lr`;
    let params = [req.user.guru_id];

    query += ` WHERE lr.teacher_id = ?`;

    if (month) {
      query += ` AND MONTH(lr.tanggal_mulai) = ?`;
      params.push(month);
    }

    if (status && status !== 'all') {
      query += ` AND lr.status = ?`;
      params.push(status);
    }

    query += ' ORDER BY lr.created_at DESC';

    const requests = await db.query(query, params);
    res.json({ success: true, data: requests });
  } catch (error) {
    console.error('Leave requests error:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambir data izin', error: error.message });
  }
});

// ============================================================
// EXPORT ROUTER
// ============================================================

module.exports = router;