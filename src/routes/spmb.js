const express = require('express');
const db = require('../../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateOperator } = require('../middleware/auth');

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
      `INSERT INTO spmb_settings (tenant_id, is_open, judul_flyer, keterangan_flyer, no_wa, primary_color, accent_color, school_name, school_tagline)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, data.is_open ?? 0, data.judul_flyer || null, data.keterangan_flyer || null, data.no_wa || null, data.primary_color || '#066e3a', data.accent_color || '#f59e0b', data.school_name || null, data.school_tagline || null]
    );
  } else {
    await db.query(
      `UPDATE spmb_settings SET is_open = ?, judul_flyer = ?, keterangan_flyer = ?, no_wa = ?, primary_color = ?, accent_color = ?, school_name = ?, school_tagline = ?, updated_at = NOW() WHERE tenant_id = ?`,
      [data.is_open ?? existing.is_open, data.judul_flyer ?? existing.judul_flyer, data.keterangan_flyer ?? existing.keterangan_flyer, data.no_wa ?? existing.no_wa, data.primary_color || existing.primary_color, data.accent_color || existing.accent_color, data.school_name || existing.school_name, data.school_tagline || existing.school_tagline, tenantId]
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
    const schoolResult = await db.query('SELECT nama_sekolah, tagline, alamat, telepon, email, website, logo_url FROM tenants WHERE tenant_id = ?', [tenantId]);
    const school = Array.isArray(schoolResult) && schoolResult.length > 0 ? schoolResult : [];
    const settings = await getSettings(tenantId);

    const programsResult = await db.query('SELECT program_name as name, program_name, description, quota, is_active, tanggal_buka, tanggal_tutup FROM spmb_programs WHERE tenant_id = ? AND is_active = 1 ORDER BY id ASC', [tenantId]);
    const programs = Array.isArray(programsResult) ? programsResult : [];
    const wavesResult = await db.query('SELECT wave_number, wave_name as name, wave_name, registration_start as start_date, registration_end as end_date, max_participants, is_active, CASE WHEN registration_start <= CURDATE() AND registration_end >= CURDATE() THEN "open" WHEN registration_start > CURDATE() THEN "upcoming" ELSE "closed" END as status FROM spmb_waves WHERE tenant_id = ? AND is_active = 1 ORDER BY wave_number ASC', [tenantId]);
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
          tagline: settings?.school_tagline || (school && school.length > 0 ? school[0].tagline : 'Portal Resmi Pendaftaran'),
          alamat: school && school.length > 0 ? school[0].alamat : '',
          telepon: school && school.length > 0 ? school[0].telepon : (settings?.no_wa || ''),
          email: school && school.length > 0 ? school[0].email : '',
          website: school && school.length > 0 ? school[0].website : '',
          logo_url: school && school.length > 0 ? school[0].logo_url : '',
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
          accent_color: settings?.accent_color || '#f59e0b'
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

    await upsertSettings(tenantId, {
      is_open: data.is_open,
      judul_flyer: data.judul_flyer,
      keterangan_flyer: data.keterangan_flyer,
      no_wa: data.no_wa,
      school_name: data.school_name,
      school_tagline: data.school_tagline,
      primary_color: data.primary_color,
      accent_color: data.accent_color
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

router.post('/api/spmb/register', spmbRegistrationUpload, async (req, res) => {
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

router.post('/api/spmb/auth/login', async (req, res) => {
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

router.get('/api/spmb/me', authenticateSpmbPanitia, async (req, res) => {
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

module.exports = router;