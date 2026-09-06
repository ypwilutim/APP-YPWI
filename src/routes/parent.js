const express = require('express');
const db = require('../../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Helper: Verify that the authenticated user is a parent and has access to the student
async function verifyParentStudentAccess(req, studentId) {
  // Check if user is a parent
  if (!req.user || req.user.role !== 'parent') {
    return false;
  }
  
  // Check if the student ID is in the parent's students list from the token
  const studentIds = req.user.students.map(s => s.id);
  return studentIds.includes(parseInt(studentId));
}

// GET /api/parent/students - Get list of students for the logged-in parent
router.get('/students', authenticateToken, async (req, res) => {
  try {
    // Check if user is a parent
    if (!req.user || req.user.role !== 'parent') {
      return res.status(403).json({ 
        success: false, 
        message: 'Akses ditolak. Hanya orang tua yang dapat mengakses endpoint ini.' 
      });
    }
    
    // Return students from token (already fetched during login)
    res.json({
      success: true,
      data: req.user.students || []
    });
  } catch (error) {
    console.error('Get parent students error:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Terjadi kesalahan saat mengambil data siswa' 
    });
  }
});

// GET /api/parent/student-attendance/:student_id - Get attendance for a specific student
router.get('/student-attendance/:student_id', authenticateToken, async (req, res) => {
  try {
    // Check if user is a parent
    if (!req.user || req.user.role !== 'parent') {
      return res.status(403).json({ 
        success: false, 
        message: 'Akses ditolak. Hanya orang tua yang dapat mengakses endpoint ini.' 
      });
    }
    
    const studentId = req.params.student_id;
    
    // Verify parent has access to this student
    const hasAccess = await verifyParentStudentAccess(req, studentId);
    if (!hasAccess) {
      return res.status(403).json({ 
        success: false, 
        message: 'Akses ditolak. Anda tidak memiliki akses ke data siswa ini.' 
      });
    }
    
    // Get student info
    const [student] = await db.query(
      'SELECT s.*, tn.nama_sekolah FROM students s JOIN tenants tn ON s.tenant_id = tn.tenant_id WHERE s.id = ?',
      [studentId]
    );
    
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Siswa tidak ditemukan' 
      });
    }
    
    // Get attendance records for the past 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const attendanceRecords = await db.query(
      `SELECT tanggal, status, keterangan, created_at 
       FROM student_attendance 
       WHERE student_id = ? AND tanggal >= ? 
       ORDER BY tanggal DESC`,
      [studentId, thirtyDaysAgo.toISOString().slice(0, 10)]
    );
    
    // Calculate summary statistics
    const totalRecords = attendanceRecords.length;
    const hadirCount = attendanceRecords.filter(r => r.status === 'hadir').length;
    const izinCount = attendanceRecords.filter(r => r.status === 'izin').length;
    const sakitCount = attendanceRecords.filter(r => r.status === 'sakit').length;
    const alphaCount = attendanceRecords.filter(r => r.status === 'alpha').length;
    
    const attendanceRate = totalRecords > 0 ? Math.round((hadirCount / totalRecords) * 100) : 0;
    
    res.json({
      success: true,
      data: {
        student: {
          id: student.id,
          nama_siswa: student.nama_siswa,
          nisn: student.nisn,
          nis: student.nis,
          nama_sekolah: student.nama_sekolah,
          kelas: `${student.tingkatan}${student.nama_kelas}`
        },
        attendance: {
          records: attendanceRecords.map(record => ({
            tanggal: record.tanggal,
            status: record.status,
            keterangan: record.keterangan,
            created_at: record.created_at
          })),
          summary: {
            total_hari: totalRecords,
            hadir: hadirCount,
            izin: izinCount,
            sakit: sakitCount,
            alpha: alphaCount,
            kehadiran_persentase: attendanceRate
          }
        }
      }
    });
  } catch (error) {
    console.error('Get parent student attendance error:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Terjadi kesalahan saat mengambil data kehadiran siswa' 
    });
  }
});

// GET /api/parent/billing-summary - Get billing and payment summary for parent's children
router.get('/billing-summary', authenticateToken, async (req, res) => {
  try {
    // Check if user is a parent
    if (!req.user || req.user.role !== 'parent') {
      return res.status(403).json({ 
        success: false, 
        message: 'Akses ditolak. Hanya orang tua yang dapat mengakses endpoint ini.' 
      });
    }
    
    const studentIds = req.user.students.map(s => s.id);
    
    if (studentIds.length === 0) {
      return res.json({
        success: true,
        data: {
          students: [],
          totalTagihan: 0,
          totalPembayaran: 0,
          totalTunggakan: 0
        }
      });
    }
    
    // Get billing information for all children
    const placeholders = studentIds.map(() => '?').join(',');
    const billingData = await db.query(
      `SELECT s.id as student_id, s.nama_siswa, s.nisn, 
              pi.periode, pi.amount as tagihan, pi.status, pi.due_date, pi.paid_at
       FROM students s
       LEFT JOIN payment_invoices pi ON s.id = pi.student_id 
       WHERE s.id IN (${placeholders}) 
       ORDER BY s.nama_siswa, pi.periode DESC`,
      [...studentIds]
    );
    
    // Get payment transactions for all children
    const paymentData = await db.query(
      `SELECT pt.student_id, pt.amount as pembayaran, pt.status as pembayaran_status, 
              pt.created_at as tanggal_pembayaran, pt.gateway
       FROM payment_transactions pt
       WHERE pt.student_id IN (${placeholders}) 
       ORDER BY pt.created_at DESC`,
      [...studentIds]
    );
    
    // Process data per student
    const studentsSummary = {};
    
    req.user.students.forEach(student => {
      studentsSummary[student.id] = {
        studentInfo: {
          id: student.id,
          nama_siswa: student.nama_siswa,
          nisn: student.nisn,
          nis: student.nis,
          kelas: `${student.tingkatan}${student.nama_kelas}`
        },
        tagihan: [],
        pembayaran: [],
        totalTagihan: 0,
        totalPembayaran: 0,
        totalTunggakan: 0
      };
    });
    
    // Process billing data
    billingData.forEach(bill => {
      if (studentsSummary[bill.student_id]) {
        const tagihanEntry = {
          periode: bill.periode,
          jumlah: parseFloat(bill.tagihan) || 0,
          status: bill.status || 'belum_dibayar',
          due_date: bill.due_date,
          paid_at: bill.paid_at
        };
        
        studentsSummary[bill.student_id].tagihan.push(tagihanEntry);
        
        if (bill.status !== 'paid' && bill.status !== 'lunas') {
          studentsSummary[bill.student_id].totalTunggakan += parseFloat(bill.tagihan) || 0;
        }
        
        studentsSummary[bill.student_id].totalTagihan += parseFloat(bill.tagihan) || 0;
      }
    });
    
    // Process payment data
    paymentData.forEach(payment => {
      if (studentsSummary[payment.student_id]) {
        const pembayaranEntry = {
          jumlah: parseFloat(payment.pembayaran) || 0,
          status: payment.pembayaran_status,
          tanggal: payment.tanggal_pembayaran,
          gateway: payment.gateway
        };
        
        studentsSummary[payment.student_id].pembayaran.push(pembayaranEntry);
        studentsSummary[payment.student_id].totalPembayaran += parseFloat(payment.pembayaran) || 0;
      }
    });
    
    // Calculate overall totals
    let totalTagihan = 0;
    let totalPembayaran = 0;
    let totalTunggakan = 0;
    
    Object.values(studentsSummary).forEach(student => {
      totalTagihan += student.totalTagihan;
      totalPembayaran += student.totalPembayaran;
      totalTunggakan += student.totalTunggakan;
    });
    
    res.json({
      success: true,
      data: {
        students: Object.values(studentsSummary),
        totalTagihan,
        totalPembayaran,
        totalTunggakan
      }
    });
  } catch (error) {
    console.error('Get parent billing summary error:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Terjadi kesalahan saat mengambil ringkasan tagihan dan pembayaran' 
    });
  }
});

// GET /api/parent/payment-history/:student_id - Get payment history for a specific student
router.get('/payment-history/:student_id', authenticateToken, async (req, res) => {
  try {
    // Check if user is a parent
    if (!req.user || req.user.role !== 'parent') {
      return res.status(403).json({ 
        success: false, 
        message: 'Akses ditolak. Hanya orang tua yang dapat mengakses endpoint ini.' 
      });
    }
    
    const studentId = req.params.student_id;
    
    // Verify parent has access to this student
    const hasAccess = await verifyParentStudentAccess(req, studentId);
    if (!hasAccess) {
      return res.status(403).json({ 
        success: false, 
        message: 'Akses ditolak. Anda tidak memiliki akses ke data siswa ini.' 
      });
    }
    
    // Get payment invoices and transactions for the student
    const [student] = await db.query(
      'SELECT s.nama_siswa, s.nisn FROM students s WHERE s.id = ?',
      [studentId]
    );
    
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Siswa tidak ditemukan' 
      });
    }
    
    // Get invoices
    const invoices = await db.query(
      `SELECT periode, amount as tagihan, status, due_date, paid_at, 
              created_at, updated_at
       FROM payment_invoices 
       WHERE student_id = ? 
       ORDER BY periode DESC`,
      [studentId]
    );
    
    // Get payment transactions
    const payments = await db.query(
      `SELECT amount as pembayaran, status, created_at as tanggal_pembayaran, 
              gateway, external_id
       FROM payment_transactions 
       WHERE student_id = ? 
       ORDER BY created_at DESC`,
      [studentId]
    );
    
    res.json({
      success: true,
      data: {
        student: {
          nama_siswa: student.nama_siswa,
          nisn: student.nisn
        },
        tagihan: invoices.map(inv => ({
          periode: inv.periode,
          jumlah: parseFloat(inv.tagihan) || 0,
          status: inv.status,
          due_date: inv.due_date,
          paid_at: inv.paid_at,
          created_at: inv.created_at,
          updated_at: inv.updated_at
        })),
        pembayaran: payments.map(pay => ({
          jumlah: parseFloat(pay.pembayaran) || 0,
          status: pay.status,
          tanggal: pay.tanggal_pembayaran,
          gateway: pay.gateway,
          external_id: pay.external_id
        }))
      }
    });
  } catch (error) {
    console.error('Get parent payment history error:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Terjadi kesalahan saat mengambil riwayat pembayaran siswa' 
    });
  }
});

module.exports = router;