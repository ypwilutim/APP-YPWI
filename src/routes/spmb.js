const express = require('express');
const db = require('../../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateOperator } = require('../middleware/auth');
const { createDriveClient, ensureFolderPath, uploadBuffer } = require('../utils/googleDrive');

const router = express.Router();
const SPMB_SECRET = process.env.JWT_SECRET || 'ypwi-secret-key-2026';

function getTenant(req) {
  return req.query.tenant_id || req.params.tenantId || req.user?.tenant_id || null;
}

async function getSettings(tenantId) {
  const result = await db.query('SELECT * FROM spmb_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
  if (!Array.isArray(result)) {
    return null;
  }
  return result.length > 0 ? result[0] : null;
}

async function upsertSettings(tenantId, data) {
  const existing = await getSettings(tenantId);
  if (!existing) {
    await db.query(
      `INSERT INTO spmb_settings (tenant_id, is_open, judul_flyer, keterangan_flyer, no_wa, primary_color, accent_color, school_name, school_tagline, logo_url, flyer_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, data.is_open ?? 0, data.judul_flyer || null, data.keterangan_flyer || null, data.no_wa || null, data.primary_color || '#066e3a', data.accent_color || '#f59e0b', data.school_name || null, data.school_tagline || null, data.logo_url || null, data.flyer_url || null]
    );
  } else {
    await db.query(
      `UPDATE spmb_settings SET is_open = ?, judul_flyer = ?, keterangan_flyer = ?, no_wa = ?, primary_color = ?, accent_color = ?, school_name = ?, school_tagline = ?, logo_url = ?, flyer_url = ?, updated_at = NOW() WHERE tenant_id = ?`,
      [data.is_open ?? existing.is_open, data.judul_flyer ?? existing.judul_flyer, data.keterangan_flyer ?? existing.keterangan_flyer, data.no_wa ?? existing.no_wa, data.primary_color || existing.primary_color, data.accent_color || existing.accent_color, data.school_name || existing.school_name, data.school_tagline || existing.school_tagline, data.logo_url || existing.logo_url, data.flyer_url || existing.flyer_url, tenantId]
    );
  }
  return getSettings(tenantId);
}

const spmbStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../public/uploads/spmb');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'spmb-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const spmbUpload = multer({
  storage: spmbStorage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 4
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/') && file.mimetype !== 'application/pdf') {
      return cb(new Error('Hanya file gambar (JPG, PNG, GIF) atau PDF yang diperbolehkan'));
    }
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.pdf'];
    const fileExtension = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.includes(fileExtension)) {
      return cb(new Error('Format file tidak didukung. Gunakan JPG, PNG, GIF, atau PDF'));
    }
    cb(null, true);
  }
});

const spmbRegistrationUpload = spmbUpload.fields([
  { name: 'foto', maxCount: 1 },
  { name: 'ktp', maxCount: 1 },
  { name: 'kk', maxCount: 1 },
  { name: 'ijazah', maxCount: 1 }
]);

const authenticateSpmbPanitia = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, message: 'Token tidak ditemukan' });
  }
  jwt.verify(token, SPMB_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'Token tidak valid' });
    }
    if (user.role !== 'spmb_panitia') {
      return res.status(403).json({ success: false, message: 'Akses ditolak. Peran panitia SPMB diperlukan.' });
    }
    req.user = user;
    next();
  });
};

router.get('/spmb/landing/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const schoolResult = await db.query('SELECT nama_sekolah FROM tenants WHERE tenant_id = ?', [tenantId]);
    const school = Array.isArray(schoolResult) && schoolResult.length > 0 ? schoolResult : [];
    const settings = await getSettings(tenantId);

    const programsResult = await db.query('SELECT id, program_name as name, program_name, description, quota, is_active, tanggal_buka, tanggal_tutup FROM spmb_programs WHERE tenant_id = ? AND is_active = 1 ORDER BY id ASC', [tenantId]);
    const programs = Array.isArray(programsResult) ? programsResult : [];
    const wavesResult = await db.query('SELECT id, wave_number, wave_name as name, wave_name, registration_start as start_date, registration_end as end_date, max_participants, is_active, CASE WHEN registration_start <= CURDATE() AND registration_end >= CURDATE() THEN "open" WHEN registration_start > CURDATE() THEN "upcoming" ELSE "closed" END as status FROM spmb_waves WHERE tenant_id = ? AND is_active = 1 ORDER BY wave_number ASC', [tenantId]);
    const waves = Array.isArray(wavesResult) ? wavesResult : [];

    const faqsResult = await db.query('SELECT question, answer FROM spmb_faqs WHERE tenant_id = ? ORDER BY sort_order ASC LIMIT 20', [tenantId]);
    const faqs = Array.isArray(faqsResult) ? faqsResult : [];

    const statsResult = await db.query('SELECT label, value FROM spmb_stats WHERE tenant_id = ? ORDER BY sort_order ASC', [tenantId]);
    const stats = Array.isArray(statsResult) ? statsResult : [];

    const isOpen = settings ? !!settings.is_open : false;
    res.json({
      success: true,
      data: {
        school: {
          name: settings?.school_name || (school && school.length > 0 ? school[0].nama_sekolah : tenantId),
          tagline: settings?.school_tagline || 'Portal Resmi Pendaftaran',
          alamat: '',
          telepon: settings?.no_wa || '',
          email: '',
          website: '',
          logo_url: '',
          primary_color: settings?.primary_color || '#066e3a',
          accent_color: settings?.accent_color || '#f59e0b'
        },
        config: {
          is_open: isOpen,
          no_wa: settings?.no_wa || ''
        },
        programs: programs || [],
        waves: waves || [],
        faqs: faqs || [],
        stats: stats || []
      }
    });
  } catch (error) {
    console.error('SPMB landing error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching SPMB data: ' + error.message });
  }
});

router.get('/admin/spmb/summary', authenticateOperator, async (req, res) => {
  try {
    const tenantId = getTenant(req);
    if (!tenantId) return res.status(400).json({ success: false, message: 'tenant_id wajib diisi' });

    const summaryResult = await db.query(
      `SELECT 
        (SELECT COUNT(*) FROM spmb_committees WHERE tenant_id = ?) as total_panitia,
        (SELECT COUNT(*) FROM spmb_committees WHERE tenant_id = ? AND is_active = 1) as aktif,
        (SELECT COUNT(*) FROM spmb_registrations WHERE tenant_id = ?) as total_pendaftar`,
      [tenantId, tenantId, tenantId]
    );

    const summaryData = Array.isArray(summaryResult) && summaryResult.length > 0 ? summaryResult[0] : { total_panitia: 0, aktif: 0, total_pendaftar: 0 };
    res.json({ success: true, data: [summaryData] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/admin/spmb/committees/active', authenticateOperator, async (req, res) => {
  try {
    const tenantId = getTenant(req);
    const teacherId = req.query.teacher_id;
    if (!tenantId) return res.status(400).json({ success: false, message: 'tenant_id wajib diisi' });

    let query = 'SELECT sc.*, t.nama as nama_guru FROM spmb_committees sc LEFT JOIN teachers t ON sc.teacher_id = t.id WHERE sc.tenant_id = ?';
    const params = [tenantId];
    if (teacherId) {
      query += ' AND sc.teacher_id = ?';
      params.push(teacherId);
    }
    query += ' ORDER BY sc.is_active DESC, sc.created_at DESC LIMIT 100';

    const committeesResult = await db.query(query, params);
    res.json({ success: true, data: committeesResult });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/admin/spmb/public-info', authenticateOperator, async (req, res) => {
  try {
    const tenantId = getTenant(req);
    if (!tenantId) return res.status(400).json({ success: false, message: 'tenant_id wajib diisi' });

    const settings = await getSettings(tenantId);
    res.json({ success: true, data: settings || {} });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/admin/spmb/config/:tenantId', authenticateOperator, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const settings = await getSettings(tenantId);
    res.json({ success: true, data: settings || {} });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/admin/spmb/config/:tenantId', authenticateOperator, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const body = req.body || {};
    const result = await upsertSettings(tenantId, body);
    res.json({ success: true, message: 'Pengaturan SPMB tersimpan', data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/admin/spmb/landing/:tenantId', authenticateOperator, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const programsResult = await db.query('SELECT * FROM spmb_programs WHERE tenant_id = ? ORDER BY id ASC', [tenantId]);
    const programs = Array.isArray(programsResult) ? programsResult : [];

    const wavesResult = await db.query('SELECT * FROM spmb_waves WHERE tenant_id = ? ORDER BY wave_number ASC', [tenantId]);
    const waves = Array.isArray(wavesResult) ? wavesResult : [];

    const faqsResult = await db.query('SELECT * FROM spmb_faqs WHERE tenant_id = ? ORDER BY sort_order ASC, id ASC', [tenantId]);
    const faqs = Array.isArray(faqsResult) ? faqsResult : [];

    const statsResult = await db.query('SELECT * FROM spmb_stats WHERE tenant_id = ? ORDER BY sort_order ASC, id ASC', [tenantId]);
    const stats = Array.isArray(statsResult) ? statsResult : [];

    const settings = await getSettings(tenantId);

    res.json({
      success: true,
      data: {
        school: {
          name: settings?.school_name || '',
          tagline: settings?.school_tagline || '',
          primary_color: settings?.primary_color || '#066e3a',
          accent_color: settings?.accent_color || '#f59e0b',
          logo_url: settings?.logo_url || '',
          flyer_url: settings?.flyer_url || ''
        },
        programs: programs || [],
        waves: waves || [],
        faqs: faqs || [],
        stats: stats || []
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/admin/spmb/landing/:tenantId', authenticateOperator, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const data = req.body || {};
    const school = data.school || {};

    await upsertSettings(tenantId, {
      is_open: data.is_open,
      judul_flyer: data.judul_flyer,
      keterangan_flyer: data.keterangan_flyer,
      no_wa: data.no_wa,
      school_name: school.name || data.school_name,
      school_tagline: school.tagline || data.school_tagline,
      primary_color: school.primary_color || data.primary_color,
      accent_color: school.accent_color || data.accent_color
    });

    if (Array.isArray(data.programs)) {
      await db.query('DELETE FROM spmb_programs WHERE tenant_id = ?', [tenantId]);
      for (const prog of data.programs) {
        await db.query('INSERT INTO spmb_programs (tenant_id, program_name, description, quota, is_active) VALUES (?, ?, ?, ?, ?)', [tenantId, prog.name || prog.program_name || '', prog.description || '', prog.quota || 0, prog.is_active ?? 1]);
      }
    }

    if (Array.isArray(data.waves)) {
      await db.query('DELETE FROM spmb_waves WHERE tenant_id = ?', [tenantId]);
      for (const wave of data.waves) {
        await db.query('INSERT INTO spmb_waves (tenant_id, wave_number, wave_name, registration_start, registration_end, max_participants, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)', [tenantId, wave.wave_number || null, wave.name || wave.wave_name || '', wave.registration_start || wave.start_date || null, wave.registration_end || wave.end_date || null, wave.max_participants || 0, wave.is_active ?? 1]);
      }
    }

    if (Array.isArray(data.faqs)) {
      await db.query('DELETE FROM spmb_faqs WHERE tenant_id = ?', [tenantId]);
      for (const faq of data.faqs) {
        await db.query('INSERT INTO spmb_faqs (tenant_id, question, answer, sort_order) VALUES (?, ?, ?, ?)', [tenantId, faq.question || '', faq.answer || '', faq.sort_order || 0]);
      }
    }

    if (Array.isArray(data.stats)) {
      await db.query('DELETE FROM spmb_stats WHERE tenant_id = ?', [tenantId]);
      for (const stat of data.stats) {
        await db.query('INSERT INTO spmb_stats (tenant_id, label, value, sort_order) VALUES (?, ?, ?, ?)', [tenantId, stat.label || '', stat.value || 0, stat.sort_order || 0]);
      }
    }

    const updated = await db.query('SELECT * FROM spmb_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
    res.json({ success: true, message: 'Halaman publik SPMB disimpan', data: Array.isArray(updated) && updated.length > 0 ? updated[0] : {} });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/spmb/register', spmbRegistrationUpload, async (req, res) => {
  try {
    const body = req.body || {};
    const files = req.files || {};

    const required = ['nama', 'nik', 'email', 'no_wa', 'tempat_lahir', 'tanggal_lahir', 'jenis_kelamin', 'alamat', 'pendidikan_terakhir', 'jurusan', 'nama_sekolah_pendidikan', 'tahun_angkatan', 'tenant_id', 'jabatan_di_unit'];
    const missing = required.filter(f => !body[f] && body[f] !== 0);
    if (missing.length) return res.status(400).json({ success: false, message: 'Field wajib: ' + missing.join(', ') });

    const requiredFiles = ['foto', 'ktp', 'kk', 'ijazah'];
    const missingFiles = requiredFiles.filter(f => !files[f] || !files[f][0]);
    if (missingFiles.length) return res.status(400).json({ success: false, message: 'File wajib diupload: ' + missingFiles.join(', ') });

    const fotoPath = files.foto ? files.foto[0].path.replace(/\\/g, '/') : null;
    const ktpPath = files.ktp ? files.ktp[0].path.replace(/\\/g, '/') : null;
    const kkPath = files.kk ? files.kk[0].path.replace(/\\/g, '/') : null;
    const ijazahPath = files.ijazah ? files.ijazah[0].path.replace(/\\/g, '/') : null;

    const passwordHash = body.password ? bcrypt.hashSync(body.password, 10) : null;

    await db.query(
      `INSERT INTO spmb_registrations (tenant_id, nama, nik, email, no_wa, tempat_lahir, tanggal_lahir, jenis_kelamin, alamat, pendidikan_terakhir, jurusan, nama_sekolah_pendidikan, tahun_angkatan, tenant_id_sekolah, jabatan_di_unit, status, password_hash, foto_path, ktp_path, kk_path, ijazah_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      [body.tenant_id, body.nama, body.nik, body.email, body.no_wa, body.tempat_lahir, body.tanggal_lahir, body.jenis_kelamin, body.alamat, body.pendidikan_terakhir, body.jurusan, body.nama_sekolah_pendidikan, body.tahun_angkatan, body.tenant_id, body.jabatan_di_unit, passwordHash, fotoPath, ktpPath, kkPath, ijazahPath]
    );

    res.json({ success: true, message: 'Pendaftaran panitia berhasil dikirim' });
  } catch (error) {
    console.error('SPMB register error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/spmb/auth/login', async (req, res) => {
  try {
    const { email, password, tenant_id } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email dan password wajib diisi' });
    }

    let query = 'SELECT * FROM spmb_registrations WHERE email = ? AND status = "approved"';
    const params = [email];
    if (tenant_id) {
      query += ' AND tenant_id = ?';
      params.push(tenant_id);
    }
    query += ' LIMIT 1';

    const [rows] = await db.query(query, params);
    const user = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ success: false, message: 'Email atau password salah' });
    }

    const committeeResult = await db.query('SELECT teacher_id FROM spmb_committees WHERE nama = ? AND tenant_id = ? AND is_active = 1 LIMIT 1', [user.nama, user.tenant_id]);
    const committee = Array.isArray(committeeResult) && committeeResult.length > 0 ? committeeResult[0] : null;

    const token = jwt.sign(
      { id: user.id, email: user.email, nama: user.nama, role: 'spmb_panitia', tenant_id: user.tenant_id, teacher_id: committee?.teacher_id || null },
      SPMB_SECRET,
      { expiresIn: '7d' }
    );

    const tenantResult = await db.query('SELECT nama_sekolah FROM tenants WHERE tenant_id = ?', [user.tenant_id]);
    const tenantName = Array.isArray(tenantResult) && tenantResult.length > 0 ? tenantResult[0].nama_sekolah : null;

    res.json({
      success: true,
      token,
      user: { id: user.id, nama: user.nama, email: user.email, role: 'spmb_panitia', tenant_id: user.tenant_id, tenant_name: tenantName, jabatan_di_unit: user.jabatan_di_unit, teacher_id: committee?.teacher_id || null }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/spmb/me', authenticateSpmbPanitia, async (req, res) => {
  try {
    const meResult = await db.query('SELECT id, nama, email, no_wa, jabatan_di_unit, tenant_id FROM spmb_registrations WHERE id = ? AND status = "approved" LIMIT 1', [req.user.id]);
    if (!Array.isArray(meResult) || !meResult.length) return res.status(404).json({ success: false, message: 'Panitia tidak ditemukan' });

    const tenantResult = await db.query('SELECT nama_sekolah FROM tenants WHERE tenant_id = ?', [req.user.tenant_id]);
    const tenantName = Array.isArray(tenantResult) && tenantResult.length > 0 ? tenantResult[0].nama_sekolah : null;

    res.json({ 
      success: true, 
      data: { 
        ...meResult[0], 
        teacher_id: req.user.teacher_id,
        tenant_name: tenantName
      } 
    });
  } catch (error) {
    res.status(401).json({ success: false, message: 'Token tidak valid' });
  }
});

router.get('/spmb/committees/active', authenticateSpmbPanitia, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    const teacherId = req.user.teacher_id;

    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'tenant_id tidak ditemukan di token' });
    }
    if (!teacherId) {
      return res.status(400).json({ success: false, message: 'teacher_id tidak ditemukan di token. Panitia belum terhubung ke akun user.' });
    }

    const query = 'SELECT sc.*, t.nama as nama_guru FROM spmb_committees sc LEFT JOIN teachers t ON sc.teacher_id = t.id WHERE sc.tenant_id = ? AND sc.teacher_id = ? ORDER BY sc.is_active DESC, sc.created_at DESC LIMIT 100';
    const params = [tenantId, teacherId];

    const committeesResult = await db.query(query, params);
    res.json({ success: true, data: committeesResult });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/admin/spmb/registrations', authenticateOperator, async (req, res) => {
  try {
    const tenantId = getTenant(req);
    if (!tenantId) return res.status(400).json({ success: false, message: 'tenant_id wajib diisi' });
    const registrationsResult = await db.query('SELECT * FROM spmb_registrations WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 200', [tenantId]);
    res.json({ success: true, data: registrationsResult });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/admin/spmb/registrations/:id/approve', authenticateOperator, async (req, res) => {
  try {
    const regResult = await db.query('SELECT * FROM spmb_registrations WHERE id = ? LIMIT 1', [req.params.id]);
    const reg = Array.isArray(regResult) && regResult.length > 0 ? regResult[0] : null;
    if (!reg) return res.status(404).json({ success: false, message: 'Pendaftaran tidak ditemukan' });

    await db.query("UPDATE spmb_registrations SET status = 'approved' WHERE id = ?", [req.params.id]);

    const userResult = await db.query(
      'INSERT INTO users (username, email, password, role, guru_id, tenant_id, is_profile_complete, is_default_password) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [reg.email, reg.email, reg.password_hash || bcrypt.hashSync('changeme123', 10), 'spmb_panitia', null, reg.tenant_id, 1, reg.password_hash ? 0 : 1]
    );
    const userId = userResult.insertId;

    await db.query('INSERT INTO spmb_committees (tenant_id, teacher_id, nama, spmb_role, is_active) VALUES (?, ?, ?, ?, 1)', [reg.tenant_id, userId, reg.nama, reg.jabatan_di_unit]);

    await db.query('UPDATE spmb_registrations SET user_id = ? WHERE id = ?', [userId, req.params.id]);

    res.json({ success: true, message: 'Pendaftaran disetujui dan akun panitia dibuat' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/admin/spmb/registrations/:id/reject', authenticateOperator, async (req, res) => {
  try {
    await db.query("UPDATE spmb_registrations SET status = 'rejected' WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: 'Pendaftaran ditolak' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

const spmbStudentUpload = spmbUpload.fields([
  { name: 'foto', maxCount: 1 },
  { name: 'kk', maxCount: 1 },
  { name: 'akta', maxCount: 1 },
  { name: 'ijazah', maxCount: 1 },
  { name: 'rapor', maxCount: 1 }
]);

// POST /api/spmb/student/apply - public student application
router.post('/spmb/student/apply', spmbStudentUpload, async (req, res) => {
  try {
    const body = req.body || {};
    const files = req.files || {};
    const tenantId = body.tenant_id;
    if (!tenantId) return res.status(400).json({ success: false, message: 'tenant_id wajib diisi' });
    if (!body.nama) return res.status(400).json({ success: false, message: 'Nama wajib diisi' });
    if (!files.foto || !files.foto[0]) return res.status(400).json({ success: false, message: 'File foto wajib diupload' });
    if (!files.kk || !files.kk[0]) return res.status(400).json({ success: false, message: 'File KK wajib diupload' });
    if (!files.ijazah || !files.ijazah[0]) return res.status(400).json({ success: false, message: 'File ijazah wajib diupload' });

    const fotoPath = files.foto[0].path.replace(/\\/g, '/');
    const kkPath = files.kk[0].path.replace(/\\/g, '/');
    const aktaPath = files.akta && files.akta[0] ? files.akta[0].path.replace(/\\/g, '/') : null;
    const ijazahPath = files.ijazah[0].path.replace(/\\/g, '/');
    const raporPath = files.rapor && files.rapor[0] ? files.rapor[0].path.replace(/\\/g, '/') : null;

    // duplicate nisn check
    if (body.nisn) {
      const dup = await db.query('SELECT id FROM spmb_student_applications WHERE tenant_id = ? AND nisn = ? LIMIT 1', [tenantId, body.nisn]);
      if (Array.isArray(dup) && dup.length > 0) {
        return res.status(409).json({ success: false, message: 'NISN sudah terdaftar' });
      }
    }

    const result = await db.query(
      `INSERT INTO spmb_student_applications (tenant_id, program_id, wave_id, nama, nik, nisn, tempat_lahir, tanggal_lahir, jenis_kelamin, alamat, nama_orang_tua, no_wa_ortu, email_ortu, pendidikan_terakhir, nama_sekolah_asal, tahun_lulus, payment_amount, foto_path, kk_path, akta_path, ijazah_path, rapor_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, body.program_id || null, body.wave_id || null, body.nama, body.nik || null, body.nisn || null, body.tempat_lahir || null, body.tanggal_lahir || null, body.jenis_kelamin || null, body.alamat || null, body.nama_orang_tua || null, body.no_wa_ortu || null, body.email_ortu || null, body.pendidikan_terakhir || null, body.nama_sekolah_asal || null, body.tahun_lulus || null, body.payment_amount || 0, fotoPath, kkPath, aktaPath, ijazahPath, raporPath]
    );
    res.json({ success: true, message: 'Pendaftaran siswa berhasil dikirim', data: { id: result.insertId } });
  } catch (error) {
    console.error('SPMB student apply error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/spmb/student/status/:id - check application status
router.get('/spmb/student/status/:id', async (req, res) => {
  try {
    const rows = await db.query('SELECT id, nama, status, payment_status, payment_amount, created_at, tenant_id FROM spmb_student_applications WHERE id = ? LIMIT 1', [req.params.id]);
    const app = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!app) return res.status(404).json({ success: false, message: 'Pendaftaran tidak ditemukan' });
    const phone = req.query.phone;
    if (phone) {
      const full = await db.query('SELECT no_wa_ortu FROM spmb_student_applications WHERE id = ? LIMIT 1', [req.params.id]);
      if (!full || !full[0] || full[0].no_wa_ortu !== phone) {
        return res.status(403).json({ success: false, message: 'Nomor WA tidak cocok' });
      }
    }
    res.json({ success: true, data: app });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Admin: list student applications
router.get('/admin/spmb/students', authenticateOperator, async (req, res) => {
  try {
    const tenantId = getTenant(req);
    if (!tenantId) return res.status(400).json({ success: false, message: 'tenant_id wajib diisi' });
    let query = 'SELECT sa.*, p.program_name, w.wave_name FROM spmb_student_applications sa LEFT JOIN spmb_programs p ON sa.program_id = p.id LEFT JOIN spmb_waves w ON sa.wave_id = w.id WHERE sa.tenant_id = ?';
    const params = [tenantId];
    if (req.query.status) { query += ' AND sa.status = ?'; params.push(req.query.status); }
    if (req.query.wave_id) { query += ' AND sa.wave_id = ?'; params.push(req.query.wave_id); }
    query += ' ORDER BY sa.created_at DESC LIMIT 500';
    const rows = await db.query(query, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Admin: detail
router.get('/admin/spmb/students/:id', authenticateOperator, async (req, res) => {
  try {
    const rows = await db.query('SELECT sa.*, p.program_name, w.wave_name FROM spmb_student_applications sa LEFT JOIN spmb_programs p ON sa.program_id = p.id LEFT JOIN spmb_waves w ON sa.wave_id = w.id WHERE sa.id = ? LIMIT 1', [req.params.id]);
    const app = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!app) return res.status(404).json({ success: false, message: 'Pendaftaran tidak ditemukan' });
    const tenantId = getTenant(req);
    if (tenantId && app.tenant_id !== tenantId) return res.status(403).json({ success: false, message: 'Akses ditolak' });
    res.json({ success: true, data: app });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Admin: verify
router.post('/admin/spmb/students/:id/verify', authenticateOperator, async (req, res) => {
  try {
    await db.query("UPDATE spmb_student_applications SET status = 'verified', reviewed_by = ?, reviewed_at = NOW() WHERE id = ? AND status = 'pending'", [req.user?.id || null, req.params.id]);
    res.json({ success: true, message: 'Pendaftaran diverifikasi' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Admin: accept + auto enroll
router.post('/admin/spmb/students/:id/accept', authenticateOperator, async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM spmb_student_applications WHERE id = ? LIMIT 1', [req.params.id]);
    const app = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!app) return res.status(404).json({ success: false, message: 'Pendaftaran tidak ditemukan' });
    if (app.status !== 'verified' && app.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Status tidak valid untuk diterima' });
    }
    const tenantId = getTenant(req) || app.tenant_id;
    if (tenantId && app.tenant_id !== tenantId) return res.status(403).json({ success: false, message: 'Akses ditolak' });

    await db.transaction(async (conn) => {
      const [studentResult] = await conn.execute(
        `INSERT INTO students (tenant_id, nama_siswa, nisn, jenis_kelamin, tahun_masuk) VALUES (?, ?, ?, ?, ?)`,
        [app.tenant_id, app.nama, app.nisn || null, app.jenis_kelamin || null, new Date().getFullYear().toString()]
      );
      const studentId = studentResult.insertId;
      await conn.execute(
        "UPDATE spmb_student_applications SET status = 'enrolled', student_id = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?",
        [studentId, req.user?.id || null, req.params.id]
      );
    });

    res.json({ success: true, message: 'Pendaftaran diterima dan siswa dibuat' });
  } catch (error) {
    console.error('SPMB accept error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Admin: reject
router.post('/admin/spmb/students/:id/reject', authenticateOperator, async (req, res) => {
  try {
    const notes = (req.body && req.body.notes) || null;
    await db.query("UPDATE spmb_student_applications SET status = 'rejected', notes = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?", [notes, req.user?.id || null, req.params.id]);
    res.json({ success: true, message: 'Pendaftaran ditolak' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});


// Upload logo (local + optional Drive)
router.post('/admin/spmb/upload-logo/:tenantId', authenticateOperator, spmbUpload.single('file'), async (req, res) => {
  try {
    const { tenantId } = req.params;
    if (!req.file) return res.status(400).json({ success: false, message: 'File tidak ditemukan' });
    const localUrl = '/uploads/spmb/' + req.file.filename;

    let finalUrl = localUrl;
    const drive = createDriveClient();
    if (drive) {
      try {
        const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
        if (rootFolderId) {
          const folderId = await ensureFolderPath(drive, rootFolderId, ['SPMB', tenantId, 'Logo']);
          const fs = require('fs');
          const buffer = fs.readFileSync(req.file.path);
          const upload = await uploadBuffer({ buffer, name: req.file.originalname, mimeType: req.file.mimetype, parentId: folderId });
          if (upload && upload.ok && upload.webViewLink) finalUrl = upload.webViewLink;
        }
      } catch (e) { console.error('Drive logo upload error:', e.message); }
    }

    await db.query('UPDATE spmb_settings SET logo_url = ?, updated_at = NOW() WHERE tenant_id = ?', [finalUrl, tenantId]);
    // if no row, insert
    const existing = await db.query('SELECT id FROM spmb_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
    if (!existing || existing.length === 0) {
      await db.query('INSERT INTO spmb_settings (tenant_id, logo_url) VALUES (?, ?)', [tenantId, finalUrl]);
    }

    res.json({ success: true, url: finalUrl });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Upload flyer (local + optional Drive)
router.post('/admin/spmb/upload-flyer/:tenantId', authenticateOperator, spmbUpload.single('file'), async (req, res) => {
  try {
    const { tenantId } = req.params;
    if (!req.file) return res.status(400).json({ success: false, message: 'File tidak ditemukan' });
    const localUrl = '/uploads/spmb/' + req.file.filename;

    let finalUrl = localUrl;
    const drive = createDriveClient();
    if (drive) {
      try {
        const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
        if (rootFolderId) {
          const folderId = await ensureFolderPath(drive, rootFolderId, ['SPMB', tenantId, 'Flyer']);
          const fs = require('fs');
          const buffer = fs.readFileSync(req.file.path);
          const upload = await uploadBuffer({ buffer, name: req.file.originalname, mimeType: req.file.mimetype, parentId: folderId });
          if (upload && upload.ok && upload.webViewLink) finalUrl = upload.webViewLink;
        }
      } catch (e) { console.error('Drive flyer upload error:', e.message); }
    }

    await db.query('UPDATE spmb_settings SET flyer_url = ?, updated_at = NOW() WHERE tenant_id = ?', [finalUrl, tenantId]);
    const existing = await db.query('SELECT id FROM spmb_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
    if (!existing || existing.length === 0) {
      await db.query('INSERT INTO spmb_settings (tenant_id, flyer_url) VALUES (?, ?)', [tenantId, finalUrl]);
    }

    res.json({ success: true, url: finalUrl });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});


// Check if current user is active SPMB panitia
router.get('/spmb/panitia-status', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Token tidak ditemukan' });
    const decoded = jwt.verify(token, SPMB_SECRET);
    const teacherId = decoded.guru_id || decoded.teacher_id || null;
    if (!teacherId) return res.json({ success: true, is_panitia: false });

    const rows = await db.query('SELECT tenant_id, spmb_role FROM spmb_committees WHERE teacher_id = ? AND is_active = 1 LIMIT 1', [teacherId]);
    if (rows && rows.length > 0) {
      return res.json({ success: true, is_panitia: true, tenant_id: rows[0].tenant_id, role: rows[0].spmb_role });
    }
    return res.json({ success: true, is_panitia: false });
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Token tidak valid' });
  }
});

module.exports = router;
