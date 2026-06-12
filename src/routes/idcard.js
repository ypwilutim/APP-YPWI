const express = require('express');
const db = require('../../db');
const { authenticateToken, authenticateOperator } = require('../middleware/auth');
const QRCode = require('qrcode');

const router = express.Router();

router.get('/teachers', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    
    if (req.user.role === 'guru' && !tenantId) {
      const adminAssignments = (req.user.assignments || []).filter(a => {
        const roles = ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (adminAssignments.length === 1) {
        tenantId = adminAssignments[0].tenant_id;
      }
    }

    let query = `
      SELECT t.id, t.nama, t.nik, t.nip, t.no_wa, t.link_foto, t.scan_id, 
             tn.nama_sekolah, ta.jabatan_di_unit
      FROM teachers t
      LEFT JOIN teacher_assignments ta ON t.id = ta.teacher_id
      LEFT JOIN tenants tn ON ta.tenant_id = tn.tenant_id
      WHERE t.status_aktif = 1
    `;
    let params = [];

    if (tenantId) {
      query += ' AND ta.tenant_id = ?';
      params.push(tenantId);
    }

    query += ' ORDER BY t.nama ASC LIMIT 100';
    const teachers = await db.query(query, params);
    
    res.json({ success: true, data: teachers });
  } catch (error) {
    console.error('ID Card teachers error:', error);
    res.status(500).json({ success: false, message: 'Error fetching teachers' });
  }
});

router.get('/teachers/:id', authenticateOperator, async (req, res) => {
  try {
    const [teacher] = await db.query(
      `SELECT t.id, t.nama, t.nik, t.nip, t.no_wa, t.email, t.link_foto, t.scan_id,
              tn.nama_sekolah, ta.jabatan_di_unit
       FROM teachers t
       JOIN teacher_assignments ta ON t.id = ta.teacher_id
       JOIN tenants tn ON ta.tenant_id = tn.tenant_id
       WHERE t.id = ? AND t.status_aktif = 1`,
      [req.params.id]
    );

    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
    }

    const qrCodeUrl = await QRCode.toDataURL(`${teacher.scan_id || teacher.id}`, {
      width: 150,
      margin: 1,
      color: { dark: '#066e3a', light: '#ffffff' }
    });

    res.json({ success: true, data: { ...teacher, qr_code: qrCodeUrl } });
  } catch (error) {
    console.error('ID Card teacher error:', error);
    res.status(500).json({ success: false, message: 'Error fetching teacher' });
  }
});

router.get('/teachers/:id/qr', async (req, res) => {
  try {
    const [teacher] = await db.query(
      'SELECT scan_id FROM teachers WHERE id = ? AND status_aktif = 1',
      [req.params.id]
    );

    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
    }

    const qrCodeUrl = await QRCode.toDataURL(`${teacher.scan_id || req.params.id}`, {
      width: 100,
      margin: 1
    });

    // Fallback ke QR server eksternal jika gagal
    res.json({ success: true, qr_code: qrCodeUrl, fallback: `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${teacher.scan_id || req.params.id}` });
  } catch (error) {
    console.error('QR teacher error:', error);
    res.status(500).json({ success: false, message: 'Error generating QR' });
  }
});

router.get('/students', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    
    if (req.user.role === 'guru' && !tenantId) {
      const adminAssignments = (req.user.assignments || []).filter(a => {
        const roles = ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (adminAssignments.length === 1) {
        tenantId = adminAssignments[0].tenant_id;
      }
    }

    let query = `
      SELECT s.id, s.nama_siswa, s.nisn, s.nis, s.jenis_kelamin, s.tenant_id,
             c.nama_kelas, tn.nama_sekolah
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id
      WHERE 1=1
    `;
    let params = [];

    if (tenantId) {
      query += ' AND s.tenant_id = ?';
      params.push(tenantId);
    }

    query += ' ORDER BY s.nama_siswa ASC LIMIT 100';
    const students = await db.query(query, params);
    
    res.json({ success: true, data: students });
  } catch (error) {
    console.error('ID Card students error:', error);
    res.status(500).json({ success: false, message: 'Error fetching students' });
  }
});

router.get('/students/:id', authenticateOperator, async (req, res) => {
  try {
    const [student] = await db.query(
      `SELECT s.id, s.nama_siswa, s.nisn, s.nis, s.jenis_kelamin, s.tenant_id,
              c.nama_kelas, tn.nama_sekolah
       FROM students s
       LEFT JOIN classes c ON s.class_id = c.id
       LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id
       WHERE s.id = ?`,
      [req.params.id]
    );

    if (!student) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }

    const qrCodeUrl = await QRCode.toDataURL(`${student.nis}`, {
      width: 150,
      margin: 1,
      color: { dark: '#066e3a', light: '#ffffff' }
    });

    res.json({ success: true, data: { ...student, qr_code: qrCodeUrl } });
  } catch (error) {
    console.error('ID Card student error:', error);
    res.status(500).json({ success: false, message: 'Error fetching student' });
  }
});

router.get('/students/:id/qr', async (req, res) => {
  try {
    const [student] = await db.query(
      'SELECT nis FROM students WHERE id = ?',
      [req.params.id]
    );

    if (!student) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
    }

    const qrCodeUrl = await QRCode.toDataURL(`${student.nis}`, {
      width: 100,
      margin: 1
    });

    res.json({ success: true, qr_code: qrCodeUrl });
  } catch (error) {
    console.error('QR student error:', error);
    res.status(500).json({ success: false, message: 'Error generating QR' });
  }
});

module.exports = router;