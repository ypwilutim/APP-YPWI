const express = require('express');
const db = require('../../db');
const nodemailer = require('nodemailer');
const { authenticateToken, authenticateOperator, verifyTenantAccess } = require('../middleware/auth');

const router = express.Router();

// Public endpoints for development/testing (no auth required)
// GET /api/treasurer/public/spp-summary - Ringkasan pembayaran SPP
router.get('/treasurer/public/spp-summary', async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;

    let query = `
      SELECT 
        tn.tenant_id,
        tn.nama_sekolah,
        COUNT(s.id) as total_siswa,
        SUM(s.iuran_bulanan) as total_pemasukan,
        SUM(CASE WHEN s.iuran_bulanan > 0 THEN 1 ELSE 0 END) as sudah_bayar,
        SUM(CASE WHEN s.iuran_bulanan = 0 OR s.iuran_bulanan IS NULL THEN 1 ELSE 0 END) as belum_bayar
      FROM tenants tn
      LEFT JOIN students s ON tn.tenant_id = s.tenant_id
      WHERE 1=1
    `;
    let params = [];

    if (tenantId) {
      query += ' AND tn.tenant_id = ?';
      params.push(tenantId);
    }

    query += ' GROUP BY tn.tenant_id, tn.nama_sekolah ORDER BY tn.nama_sekolah ASC';
    const summary = await db.query(query, params);

    res.json({
      success: true,
      data: summary.map(s => ({
        tenant_id: s.tenant_id,
        nama_sekolah: s.nama_sekolah,
        total_siswa: s.total_siswa || 0,
        total_pemasukan: s.total_pemasukan || 0,
        sudah_bayar: s.sudah_bayar || 0,
        belum_bayar: s.belum_bayar || 0
      }))
    });
  } catch (error) {
    console.error('Public SPP summary error:', error);
    res.status(500).json({ success: false, message: 'Error fetching SPP summary' });
  }
});

// Public salary summary endpoint
router.get('/treasurer/public/salary-summary', async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    const month = req.query.month || new Date().toISOString().slice(0, 7);

    let query = `
      SELECT 
        t.id as teacher_id,
        t.nama,
        t.nip,
        ta.jabatan_di_unit,
        tn.nama_sekolah,
        tt.Gaji_Pokok,
        tt.Tunj_Kinerja,
        tt.Tunj_Umum,
        tt.Tunj_Istri,
        tt.Tunj_Anak,
        tt.Tunj_Kepala_Sekolah,
        tt.Tunj_Wali_Kelas,
        tt.Honor_Bendahara
      FROM teachers t
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      JOIN tenants tn ON ta.tenant_id = tn.tenant_id
      LEFT JOIN temp_teachers tt ON t.nama = tt.Nama
      WHERE t.status_aktif = 1
    `;
    let params = [];

    if (tenantId) {
      query += ' AND ta.tenant_id = ?';
      params.push(tenantId);
    }

    query += ' ORDER BY t.nama ASC';
    const teachers = await db.query(query, params);

    let totalGajiPokok = 0, totalTunjangan = 0, totalHonor = 0;
    const results = teachers.map(t => {
      const gaji = parseFloat(t.Gaji_Pokok) || 0;
      const tunjangan = (
        (parseFloat(t.Tunj_Kinerja) || 0) +
        (parseFloat(t.Tunj_Umum) || 0) +
        (parseFloat(t.Tunj_Istri) || 0) +
        (parseFloat(t.Tunj_Anak) || 0) +
        (parseFloat(t.Tunj_Kepala_Sekolah) || 0) +
        (parseFloat(t.Tunj_Wali_Kelas) || 0)
      );
      const honor = parseFloat(t.Honor_Bendahara) || 0;
      const total = gaji + tunjangan;

      totalGajiPokok += gaji;
      totalTunjangan += tunjangan;
      totalHonor += honor;

      return {
        teacher_id: t.teacher_id,
        nama: t.nama,
        nip: t.nip,
        jabatan: t.jabatan_di_unit,
        sekolah: t.nama_sekolah,
        gaji_pokok: gaji,
        tunjangan: tunjangan,
        honor_bendahara: honor,
        total_gaji: total
      };
    });

    res.json({
      success: true,
      month,
      data: results,
      summary: {
        total_guru: results.length,
        total_gaji_pokok: totalGajiPokok,
        total_tunjangan: totalTunjangan,
        total_honor: totalHonor,
        grand_total: totalGajiPokok + totalTunjangan + totalHonor
      }
    });
  } catch (error) {
    console.error('Public salary summary error:', error);
    res.status(500).json({ success: false, message: 'Error fetching salary summary' });
  }
});

// Public payment defaulters endpoint
router.get('/treasurer/public/payment-defaulters', async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;

    let query = `
      SELECT s.id, s.nama_siswa, s.nisn, s.iuran_bulanan, tn.nama_sekolah, p.no_wa
      FROM students s
      JOIN tenants tn ON s.tenant_id = tn.tenant_id
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE s.iuran_bulanan = 0 OR s.iuran_bulanan IS NULL
    `;
    let params = [];

    if (tenantId) {
      query += ' AND s.tenant_id = ?';
      params.push(tenantId);
    }

    query += ' ORDER BY tn.nama_sekolah ASC, s.nama_siswa ASC';
    const defaulters = await db.query(query, params);

    res.json({
      success: true,
      data: defaulters
    });
  } catch (error) {
    console.error('Public payment defaulters error:', error);
    res.status(500).json({ success: false, message: 'Error fetching payment defaulters' });
  }
});

// Public endpoint to check BSI payment by virtual account
router.get('/treasurer/public/check-bsi-payment', async (req, res) => {
  try {
    const { va_number } = req.query;
    if (!va_number) {
      return res.json({ success: true, data: null });
    }

    const query = `
      SELECT s.id, s.nama_siswa, s.nisn, s.iuran_bulanan, s.tenant_id, tn.nama_sekolah
      FROM students s
      JOIN tenants tn ON s.tenant_id = tn.tenant_id
      WHERE s.virtual_account = ?
    `;
    const [student] = await db.query(query, [va_number]);

    res.json({
      success: true,
      data: student || null
    });
  } catch (error) {
    console.error('Check BSI payment error:', error);
    res.status(500).json({ success: false, message: 'Error checking BSI payment' });
  }
});

// Public endpoint to update student payment
router.post('/treasurer/public/update-payment', async (req, res) => {
  try {
    const { student_id, amount, payment_date, va_number } = req.body;

    if (!student_id || !amount) {
      return res.status(400).json({ success: false, message: 'student_id dan amount required' });
    }

    const query = `
      UPDATE students 
      SET iuran_bulanan = ?, updated_at = NOW()
      WHERE id = ?
    `;
    await db.query(query, [amount, student_id]);

    res.json({
      success: true,
      message: 'Pembayaran berhasil diupdate',
      data: { student_id, amount, payment_date }
    });
  } catch (error) {
    console.error('Update payment error:', error);
    res.status(500).json({ success: false, message: 'Error updating payment' });
  }
});

// Public endpoint for CSV payment upload (BSI format)
router.post('/treasurer/public/upload-payments', async (req, res) => {
  try {
    const payments = req.body.payments || [];
    let updated = 0, not_found = 0;

    for (const payment of payments) {
      const { va_number, amount, payment_date, description } = payment;

      if (!va_number || !amount) continue;

      const query = `
        UPDATE students 
        SET iuran_bulanan = ?, updated_at = NOW()
        WHERE virtual_account = ? OR nisn = ?
      `;
      const result = await db.query(query, [amount, va_number, va_number]);

      if (result.affectedRows > 0) {
        updated++;
      } else {
        not_found++;
      }
    }

    res.json({
      success: true,
      message: `Berhasil update ${updated} pembayaran, ${not_found} tidak ditemukan`,
      updated,
      not_found
    });
  } catch (error) {
    console.error('Upload payments error:', error);
    res.status(500).json({ success: false, message: 'Error uploading payments' });
  }
});

// Public endpoint to export VA for Cuz BSI
router.get('/treasurer/public/export-va', async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    const parentAccount = req.query.parent_account || '1029129123';

    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 1);
    const expiryStr = expiry.toLocaleDateString('id-ID').replace(/\//g, '/');

    let query = `
      SELECT s.id, s.nama_siswa, s.nisn, s.iuran_bulanan, tn.nama_sekolah, tn.nomor_rekening, p.no_wa
      FROM students s
      JOIN tenants tn ON s.tenant_id = tn.tenant_id
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE 1=1
    `;
    let params = [];

    if (tenantId) {
      query += ' AND s.tenant_id = ?';
      params.push(tenantId);
    }

    query += ' ORDER BY tn.nama_sekolah ASC, s.nama_siswa ASC';
    const students = await db.query(query, params);

    let csv = `Type;Parent Account;Virtual Account Number (Prefix VA + Number);Virtual Account Name;Virtual Account Scheme;Limit Debit;Limit Credit;Limit Transaction;Physical Card;Auto Renewal Limit;;Expire Date;KYC;;;;;Additional Info\n`;
    csv += `;;;;;;;;Every;Date / Day;15/06/2024;Name;Mobile Phone;ID Type;ID Number;Address;Label1\n`;

    students.forEach(s => {
      const va = s.nis; // Gunakan NIS sebagai VA
      const limit = parseFloat(s.iuran_bulanan) || 150000;
      const wa = s.no_wa || '';
      csv += `Debit;${parentAccount};${va};A/N ${s.nama_siswa};Open Limit;${limit};;;;No;;;${expiryStr};${s.nama_siswa};${wa};KTP;;;;;;;;\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=va_export_bsi.csv');
    res.send(csv);
  } catch (error) {
    console.error('Export VA error:', error);
    res.status(500).json({ success: false, message: 'Error exporting VA data' });
  }
});

// Public endpoint to check BSI payment by virtual account

// Public financial report endpoint
router.get('/treasurer/public/financial-report', async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    const month = req.query.month || new Date().toISOString().slice(0, 7);

    let incomeQuery = `
      SELECT SUM(s.iuran_bulanan) as total_income
      FROM students s
      WHERE 1=1
    `;
    let incomeParams = [];

    if (tenantId) {
      incomeQuery += ' AND s.tenant_id = ?';
      incomeParams.push(tenantId);
    }

    const incomeResult = await db.query(incomeQuery, incomeParams);

    let expenseQuery = `
      SELECT 
        SUM(CAST(tt.Gaji_Pokok AS DECIMAL(10,2)) +
            CAST(tt.Tunj_Kinerja AS DECIMAL(10,2)) +
            CAST(tt.Tunj_Umum AS DECIMAL(10,2)) +
            CAST(tt.Tunj_Istri AS DECIMAL(10,2)) +
            CAST(tt.Tunj_Anak AS DECIMAL(10,2)) +
            CAST(tt.Tunj_Kepala_Sekolah AS DECIMAL(10,2)) +
            CAST(tt.Tunj_Wali_Kelas AS DECIMAL(10,2))) as total_expense
      FROM teachers t
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      LEFT JOIN temp_teachers tt ON t.nama = tt.Nama
      WHERE t.status_aktif = 1
    `;
    let expenseParams = [];

    if (tenantId) {
      expenseQuery += ' AND ta.tenant_id = ?';
      expenseParams.push(tenantId);
    }

    const expenseResult = await db.query(expenseQuery, expenseParams);

    const totalIncome = parseFloat(incomeResult[0]?.total_income) || 0;
    const totalExpense = parseFloat(expenseResult[0]?.total_expense) || 0;

    res.json({
      success: true,
      month,
      report: {
        total_pemasukan: totalIncome,
        total_pengeluaran: totalExpense,
        saldo: totalIncome - totalExpense,
        breakdown: {
          spp_masuk: totalIncome,
          gaji_guru: totalExpense,
          honor_bendahara: 0
        }
      }
    });
  } catch (error) {
    console.error('Public financial report error:', error);
    res.status(500).json({ success: false, message: 'Error fetching financial report' });
  }
});

// Protected endpoints (require authentication)
// GET /api/treasurer/salary-summary - Ringkasan gaji guru
router.get('/treasurer/salary-summary', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;

    if (req.user.role !== 'admin' && !tenantId) {
      const treasurerAssignments = (req.user.assignments || []).filter(a => {
        const roles = ['bendahara', 'tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (treasurerAssignments.length === 1) {
        tenantId = treasurerAssignments[0].tenant_id;
      }
    }

    if (tenantId && !verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const month = req.query.month || new Date().toISOString().slice(0, 7);

    let query = `
      SELECT 
        t.id as teacher_id,
        t.nama,
        t.nip,
        ta.jabatan_di_unit,
        tn.nama_sekolah,
        tt.Gaji_Pokok,
        tt.Tunj_Kinerja,
        tt.Tunj_Umum,
        tt.Tunj_Istri,
        tt.Tunj_Anak,
        tt.Tunj_Kepala_Sekolah,
        tt.Tunj_Wali_Kelas,
        tt.Honor_Bendahara
      FROM teachers t
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      JOIN tenants tn ON ta.tenant_id = tn.tenant_id
      LEFT JOIN temp_teachers tt ON t.nama = tt.Nama
      WHERE t.status_aktif = 1
    `;
    let params = [];

    if (tenantId) {
      query += ' AND ta.tenant_id = ?';
      params.push(tenantId);
    }

    query += ' ORDER BY t.nama ASC';
    const teachers = await db.query(query, params);

    let totalGajiPokok = 0, totalTunjangan = 0, totalHonor = 0;
    const results = teachers.map(t => {
      const gaji = parseFloat(t.Gaji_Pokok) || 0;
      const tunjangan = (
        (parseFloat(t.Tunj_Kinerja) || 0) +
        (parseFloat(t.Tunj_Umum) || 0) +
        (parseFloat(t.Tunj_Istri) || 0) +
        (parseFloat(t.Tunj_Anak) || 0) +
        (parseFloat(t.Tunj_Kepala_Sekolah) || 0) +
        (parseFloat(t.Tunj_Wali_Kelas) || 0)
      );
      const honor = parseFloat(t.Honor_Bendahara) || 0;
      const total = gaji + tunjangan;

      totalGajiPokok += gaji;
      totalTunjangan += tunjangan;
      totalHonor += honor;

      return {
        teacher_id: t.teacher_id,
        nama: t.nama,
        nip: t.nip,
        jabatan: t.jabatan_di_unit,
        sekolah: t.nama_sekolah,
        gaji_pokok: gaji,
        tunjangan: tunjangan,
        honor_bendahara: honor,
        total_gaji: total
      };
    });

    res.json({
      success: true,
      month,
      data: results,
      summary: {
        total_guru: results.length,
        total_gaji_pokok: totalGajiPokok,
        total_tunjangan: totalTunjangan,
        total_honor: totalHonor,
        grand_total: totalGajiPokok + totalTunjangan + totalHonor
      }
    });
  } catch (error) {
    console.error('Treasurer salary summary error:', error);
    res.status(500).json({ success: false, message: 'Error fetching salary summary' });
  }
});

// GET /api/treasurer/spp-summary - Ringkasan pembayaran SPP
router.get('/treasurer/spp-summary', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;

    if (req.user.role !== 'admin' && !tenantId) {
      const treasurerAssignments = (req.user.assignments || []).filter(a => {
        const roles = ['bendahara', 'tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (treasurerAssignments.length === 1) {
        tenantId = treasurerAssignments[0].tenant_id;
      }
    }

    if (tenantId && !verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    let query = `
      SELECT 
        tn.tenant_id,
        tn.nama_sekolah,
        COUNT(s.id) as total_siswa,
        SUM(s.iuran_bulanan) as total_pemasukan,
        SUM(CASE WHEN s.iuran_bulanan > 0 THEN 1 ELSE 0 END) as sudah_bayar,
        SUM(CASE WHEN s.iuran_bulanan = 0 OR s.iuran_bulanan IS NULL THEN 1 ELSE 0 END) as belum_bayar
      FROM tenants tn
      LEFT JOIN students s ON tn.tenant_id = s.tenant_id
      WHERE 1=1
    `;
    let params = [];

    if (tenantId) {
      query += ' AND tn.tenant_id = ?';
      params.push(tenantId);
    }

    query += ' GROUP BY tn.tenant_id, tn.nama_sekolah ORDER BY tn.nama_sekolah ASC';
    const summary = await db.query(query, params);

    res.json({
      success: true,
      data: summary.map(s => ({
        tenant_id: s.tenant_id,
        nama_sekolah: s.nama_sekolah,
        total_siswa: s.total_siswa || 0,
        total_pemasukan: s.total_pemasukan || 0,
        sudah_bayar: s.sudah_bayar || 0,
        belum_bayar: s.belum_bayar || 0
      }))
    });
  } catch (error) {
    console.error('Treasurer SPP summary error:', error);
    res.status(500).json({ success: false, message: 'Error fetching SPP summary' });
  }
});

// GET /api/treasurer/financial-report - Laporan keuangan
router.get('/treasurer/financial-report', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    const month = req.query.month || new Date().toISOString().slice(0, 7);

    if (req.user.role !== 'admin' && !tenantId) {
      const treasurerAssignments = (req.user.assignments || []).filter(a => {
        const roles = ['bendahara', 'tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (treasurerAssignments.length === 1) {
        tenantId = treasurerAssignments[0].tenant_id;
      }
    }

    if (tenantId && !verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    let incomeQuery = `
      SELECT SUM(s.iuran_bulanan) as total_income
      FROM students s
      WHERE 1=1
    `;
    let incomeParams = [];

    if (tenantId) {
      incomeQuery += ' AND s.tenant_id = ?';
      incomeParams.push(tenantId);
    }

    const incomeResult = await db.query(incomeQuery, incomeParams);

    let expenseQuery = `
      SELECT 
        SUM(CAST(tt.Gaji_Pokok AS DECIMAL(10,2)) +
            CAST(tt.Tunj_Kinerja AS DECIMAL(10,2)) +
            CAST(tt.Tunj_Umum AS DECIMAL(10,2)) +
            CAST(tt.Tunj_Istri AS DECIMAL(10,2)) +
            CAST(tt.Tunj_Anak AS DECIMAL(10,2)) +
            CAST(tt.Tunj_Kepala_Sekolah AS DECIMAL(10,2)) +
            CAST(tt.Tunj_Wali_Kelas AS DECIMAL(10,2))) as total_expense
      FROM teachers t
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      LEFT JOIN temp_teachers tt ON t.nama = tt.Nama
      WHERE t.status_aktif = 1
    `;
    let expenseParams = [];

    if (tenantId) {
      expenseQuery += ' AND ta.tenant_id = ?';
      expenseParams.push(tenantId);
    }

    const expenseResult = await db.query(expenseQuery, expenseParams);

    const totalIncome = parseFloat(incomeResult[0]?.total_income) || 0;
    const totalExpense = parseFloat(expenseResult[0]?.total_expense) || 0;

    res.json({
      success: true,
      month,
      report: {
        total_pemasukan: totalIncome,
        total_pengeluaran: totalExpense,
        saldo: totalIncome - totalExpense,
        breakdown: {
          spp_masuk: totalIncome,
          gaji_guru: totalExpense,
          honor_bendahara: 0
        }
      }
    });
  } catch (error) {
    console.error('Treasurer financial report error:', error);
    res.status(500).json({ success: false, message: 'Error fetching financial report' });
  }
});

// GET /api/treasurer/teachers-with-evaluation - Guru dengan nilai evaluasi untuk tunjangan
router.get('/treasurer/teachers-with-evaluation', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;
    const month = req.query.month || new Date().toISOString().slice(0, 7);

    if (req.user.role !== 'admin' && !tenantId) {
      const treasurerAssignments = (req.user.assignments || []).filter(a => {
        const roles = ['bendahara', 'tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (treasurerAssignments.length === 1) {
        tenantId = treasurerAssignments[0].tenant_id;
      }
    }

    if (tenantId && !verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    let query = `
      SELECT 
        t.id,
        t.nama,
        t.nip,
        ta.jabatan_di_unit,
        tn.nama_sekolah,
        tt.Gaji_Pokok,
        tt.Tunj_Kinerja,
        e.score,
        e.category,
        e.evaluation_date
      FROM teachers t
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      JOIN tenants tn ON ta.tenant_id = tn.tenant_id
      LEFT JOIN temp_teachers tt ON t.nama = tt.Nama
      LEFT JOIN evaluations e ON t.id = e.teacher_id 
        AND e.category IN ('kehadiran', 'disiplin', 'profesionalisme', 'komunikasi', 'kepemimpinan')
      WHERE t.status_aktif = 1
    `;
    let params = [];

    if (tenantId) {
      query += ' AND ta.tenant_id = ?';
      params.push(tenantId);
    }

    query += ' ORDER BY t.nama ASC';
    const teachers = await db.query(query, params);

    res.json({
      success: true,
      month,
      data: teachers.map(t => {
        const baseTunjangan = (
          (parseFloat(t.Tunj_Kinerja) || 0) *
          (t.score ? (t.score / 5) : 1)
        );
        return {
          teacher_id: t.id,
          nama: t.nama,
          nip: t.nip,
          jabatan: t.jabatan_di_unit,
          sekolah: t.nama_sekolah,
          gaji_pokok: parseFloat(t.Gaji_Pokok) || 0,
          tunjangan_kinerja_base: parseFloat(t.Tunj_Kinerja) || 0,
          tunjangan_kinerja_aktual: Math.round(baseTunjangan),
          score: t.score || null,
          evaluation_category: t.category || null
        };
      })
    });
  } catch (error) {
    console.error('Treasurer teachers with evaluation error:', error);
    res.status(500).json({ success: false, message: 'Error fetching teachers data' });
  }
});

// GET /api/treasurer/payment-defaulters - Siswa yang belum bayar SPP
router.get('/treasurer/payment-defaulters', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id;

    if (req.user.role !== 'admin' && !tenantId) {
      const treasurerAssignments = (req.user.assignments || []).filter(a => {
        const roles = ['bendahara', 'tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (treasurerAssignments.length === 1) {
        tenantId = treasurerAssignments[0].tenant_id;
      }
    }

    if (tenantId && !verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    let query = `
      SELECT s.id, s.nama_siswa, s.nisn, s.iuran_bulanan, tn.nama_sekolah, p.no_wa
      FROM students s
      JOIN tenants tn ON s.tenant_id = tn.tenant_id
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE s.iuran_bulanan = 0 OR s.iuran_bulanan IS NULL
    `;
    let params = [];

    if (tenantId) {
      query += ' AND s.tenant_id = ?';
      params.push(tenantId);
    }

    query += ' ORDER BY tn.nama_sekolah ASC, s.nama_siswa ASC';
    const defaulters = await db.query(query, params);

    res.json({
      success: true,
      data: defaulters
    });
  } catch (error) {
    console.error('Treasurer payment defaulters error:', error);
    res.status(500).json({ success: false, message: 'Error fetching payment defaulters' });
  }
});

// PDF Slip Gaji
router.get('/treasurer/public/salary-slip-pdf/:teacherId', async (req, res) => {
  try {
    const teacherId = req.params.teacherId;
    const month = req.query.month || new Date().toISOString().slice(0, 7);

    const query = `
      SELECT t.id, t.nama, t.nip, ta.jabatan_di_unit, tn.nama_sekolah, tn.tenant_id,
        tt.Gaji_Pokok, tt.Tunj_Kinerja, tt.Tunj_Umum, tt.Tunj_Istri, tt.Tunj_Anak,
        tt.Tunj_Kepala_Sekolah, tt.Tunj_Wali_Kelas, tt.Honor_Bendahara
      FROM teachers t
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      JOIN tenants tn ON ta.tenant_id = tn.tenant_id
      LEFT JOIN temp_teachers tt ON t.nama = tt.Nama
      WHERE t.id = ?
    `;
    const [teacher] = await db.query(query, [teacherId]);

    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
    }

    const gaji = parseFloat(teacher.Gaji_Pokok) || 0;
    const tunjangan = (
      (parseFloat(teacher.Tunj_Kinerja) || 0) +
      (parseFloat(teacher.Tunj_Umum) || 0) +
      (parseFloat(teacher.Tunj_Istri) || 0) +
      (parseFloat(teacher.Tunj_Anak) || 0) +
      (parseFloat(teacher.Tunj_Kepala_Sekolah) || 0) +
      (parseFloat(teacher.Tunj_Wali_Kelas) || 0)
    );
    const honor = parseFloat(teacher.Honor_Bendahara) || 0;
    const total = gaji + tunjangan;

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=slip_gaji_${teacher.nama}_${month}.pdf`);

    doc.pipe(res);

    doc.fontSize(20).text('Slip Gaji Guru', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).text(`Nama: ${teacher.nama}`);
    doc.text(`NIP: ${teacher.nip || '-'}`);
    doc.text(`Jabatan: ${teacher.jabatan_di_unit}`);
    doc.text(`Sekolah: ${teacher.nama_sekolah}`);
    doc.moveDown();

    doc.text('Rincian Gaji:', { underline: true });
    doc.text(`Gaji Pokok: Rp ${(gaji || 0).toLocaleString('id-ID')}`);
    doc.text(`Tunjangan: Rp ${(tunjangan || 0).toLocaleString('id-ID')}`);
    doc.text(`Honor Bendahara: Rp ${(honor || 0).toLocaleString('id-ID')}`);
    doc.moveDown();

    doc.fontSize(14).text(`Total Gaji: Rp ${(total || 0).toLocaleString('id-ID')}`, { align: 'right' });
    doc.moveDown(2);
    doc.text(`Bulan: ${month}`, { align: 'right' });
    doc.text(`Tanggal: ${new Date().toLocaleDateString('id-ID')}`, { align: 'right' });

    doc.end();
  } catch (error) {
    console.error('PDF slip error:', error);
    res.status(500).json({ success: false, message: 'Error generating PDF' });
  }
});

// Send salary slip email
router.post('/treasurer/public/send-salary-slip-email', async (req, res) => {
  try {
    const { teacherId, month } = req.body;

    if (!teacherId) {
      return res.status(400).json({ success: false, message: 'teacherId required' });
    }

    const nodemailer = require('nodemailer');

    const query = `
      SELECT t.id, t.nama, t.nip, t.email, ta.jabatan_di_unit, tn.nama_sekolah,
        tt.Gaji_Pokok, tt.Tunj_Kinerja, tt.Tunj_Umum, tt.Tunj_Istri, tt.Tunj_Anak,
        tt.Tunj_Kepala_Sekolah, tt.Tunj_Wali_Kelas, tt.Honor_Bendahara
      FROM teachers t
      JOIN teacher_assignments ta ON t.id = ta.teacher_id
      JOIN tenants tn ON ta.tenant_id = tn.tenant_id
      LEFT JOIN temp_teachers tt ON t.nama = tt.Nama
      WHERE t.id = ?
    `;
    const [teacher] = await db.query(query, [teacherId]);

    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
    }

    const gaji = parseFloat(teacher.Gaji_Pokok) || 0;
    const tunjangan = (
      (parseFloat(teacher.Tunj_Kinerja) || 0) +
      (parseFloat(teacher.Tunj_Umum) || 0) +
      (parseFloat(teacher.Tunj_Istri) || 0) +
      (parseFloat(teacher.Tunj_Anak) || 0) +
      (parseFloat(teacher.Tunj_Kepala_Sekolah) || 0) +
      (parseFloat(teacher.Tunj_Wali_Kelas) || 0)
    );
    const honor = parseFloat(teacher.Honor_Bendahara) || 0;
    const total = gaji + tunjangan;

    console.log('Processing salary slip for:', teacher.nama, 'Email:', teacher.email);

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="https://app.ypwilutim.com/assets/images/header-yayasan.png" width="500" style="max-width: 100%;">
        </div>
        <h2 style="color: #059669; text-align: center;">Slip Gaji Guru</h2>
        <p>Assalamu'alaikum Bapak/Ibu ${teacher.nama},</p>
        <p>Berikut slip gaji untuk bulan ${month || new Date().toISOString().slice(0, 7)}:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0; border: 2px solid #059669;">
          <tr style="background: #f3f4f6;">
            <td style="padding: 10px; border: 1px solid #ddd;">Keterangan</td>
            <td style="padding: 10px; border: 1px solid #ddd; text-align: right;">Jumlah</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">Gaji Pokok</td>
            <td style="padding: 10px; border: 1px solid #ddd; text-align: right;">Rp ${(gaji || 0).toLocaleString('id-ID')}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">Tunjangan</td>
            <td style="padding: 10px; border: 1px solid #ddd; text-align: right;">Rp ${(tunjangan || 0).toLocaleString('id-ID')}</td>
          </tr>
          ${honor > 0 ? `<tr><td style="padding: 10px; border: 1px solid #ddd;">Honor Bendahara</td><td style="padding: 10px; border: 1px solid #ddd; text-align: right;">Rp ${honor.toLocaleString('id-ID')}</td></tr>` : ''}
          <tr style="background: #dcfce7;">
            <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Total Gaji</td>
            <td style="padding: 10px; border: 1px solid #ddd; text-align: right; font-weight: bold; color: #059669;">Rp ${(total || 0).toLocaleString('id-ID')}</td>
          </tr>
        </table>
        <hr style="border: 1px solid #ddd; margin: 20px 0;">
        <p style="font-size: 12px; color: #666;">Hormat kami,<br><strong>Yayasan Pendidikan Wahdah Islamiyah Luwu Timur</strong></p>
      </div>
    `;

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50 });
    const pdfChunks = [];

    doc.on('data', chunk => pdfChunks.push(chunk));
    doc.on('end', () => { });

    // Header image
    const fs = require('fs');
    const path = require('path');
    try {
      const headerPath = path.join(__dirname, '../../template/header-yayasan.png');
      if (fs.existsSync(headerPath)) {
        doc.image(headerPath, 50, 30, { width: 500 });
        doc.moveDown(4);
      }
    } catch (e) { }

    doc.fontSize(16).fillColor('#059669').text('SLIP GAJI GURU', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Nama: ${teacher.nama}`);
    doc.text(`NIP: ${teacher.nip || '-'}`);
    doc.text(`Jabatan: ${teacher.jabatan_di_unit}`);
    doc.text(`Sekolah: ${teacher.nama_sekolah}`);
    doc.moveDown();
    doc.text('Rincian Gaji:');
    doc.text(`Gaji Pokok: Rp ${(gaji || 0).toLocaleString('id-ID')}`);
    doc.text(`Tunjangan: Rp ${(tunjangan || 0).toLocaleString('id-ID')}`);
    if (honor > 0) doc.text(`Honor: Rp ${honor.toLocaleString('id-ID')}`);
    doc.moveDown();
    doc.fontSize(14).text(`Total: Rp ${(total || 0).toLocaleString('id-ID')}`, { align: 'right' });

    doc.end();

    await new Promise(resolve => doc.on('end', resolve));

    const pdfBuffer = Buffer.concat(pdfChunks);
    console.log('PDF size:', pdfBuffer.length);

    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'mail.ypwilutim.com',
      port: parseInt(process.env.EMAIL_PORT) || 465,
      secure: true,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });

    try {
      const info = await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: teacher.email,
        subject: `Slip Gaji ${month || new Date().toISOString().slice(0, 7)}`,
        html: htmlBody,
        attachments: [{
          filename: `slip_gaji_${teacher.nama.replace(/\s+/g, '_')}.pdf`,
          content: pdfBuffer
        }]
      });
      console.log('Email terkirim, messageId:', info.messageId);
      res.json({ success: true, message: 'Email terkirim ke ' + teacher.email });
    } catch (emailError) {
      console.error('Email send error:', emailError);
      return res.status(500).json({ success: false, message: 'Gagal kirim email: ' + emailError.message });
    }
  } catch (error) {
    console.error('Email slip error:', error);
    res.status(500).json({ success: false, message: 'Error sending email' });
  }
});

// Test email endpoint
router.get('/treasurer/public/test-email', async (req, res) => {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'mail.ypwilutim.com',
      port: parseInt(process.env.EMAIL_PORT) || 465,
      secure: true,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });

    const testResult = await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: 'test@example.com',
      subject: 'Test Email',
      text: 'Test SMTP connection'
    });

    res.json({ success: true, messageId: testResult.messageId });
  } catch (error) {
    console.error('Test email error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;