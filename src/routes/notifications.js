const express = require('express');
const db = require('../../db');
const webpush = require('../../src/notifications');
const { authenticateToken, authenticateAdmin } = require('../middleware/auth');
const { sendBillTemplate } = require('../utils/whatsappTemplate');

const router = express.Router();

const VAPID_PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || webpush?.vapidPublic || '');

router.get('/notifications/vapid-public-key', authenticateToken, (req, res) => {
  res.json({ success: true, publicKey: VAPID_PUBLIC_KEY });
});

router.post('/notifications/subscribe', authenticateToken, async (req, res) => {
  try {
    const subscription = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ success: false, message: 'Subscription tidak valid' });
    }
    await db.query(
      `CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        endpoint TEXT NOT NULL,
        keys_json JSON NOT NULL,
        user_agent TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_endpoint (user_id, endpoint(255)),
        INDEX idx_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    const keysJson = subscription.keys || {};
    await db.query(
      'INSERT INTO push_subscriptions (user_id, endpoint, keys_json, user_agent) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE keys_json = VALUES(keys_json), updated_at = NOW()',
      [req.user.id, subscription.endpoint, JSON.stringify(keysJson), req.get('user-agent') || '']
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({ success: false, message: 'Gagal menyimpan langganan notifikasi' });
  }
});

router.get('/notifications/subscriptions/me', authenticateToken, async (req, res) => {
  try {
    const rows = await db.query('SELECT id, endpoint, created_at FROM push_subscriptions WHERE user_id = ?', [req.user.id]);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal mengambil langganan' });
  }
});

router.delete('/notifications/subscriptions/:id', authenticateToken, async (req, res) => {
  try {
    await db.query('DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal menghapus langganan' });
  }
});

router.post('/notifications/whatsapp/bill-template', authenticateAdmin, async (req, res) => {
  try {
    const { phoneNumber, nama_siswa, bulan, jumlah_tagihan, tanggal_jatuh_tempo, nomor_rekening, nama_penerima } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ success: false, message: 'Nomor telepon wajib diisi' });
    }
    
    const result = await sendBillTemplate(phoneNumber, {
      nama_siswa,
      bulan,
      jumlah_tagihan,
      tanggal_jatuh_tempo,
      nomor_rekening,
      nama_penerima
    });
    
    res.json({
      success: true,
      message: 'Template tagihan SPP berhasil dikirim',
      messageId: result.messageId
    });
  } catch (error) {
    console.error('Send bill template error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/notifications/bill-status', authenticateAdmin, async (req, res) => {
  try {
    // Ensure table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS tagihan_siswa (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id INT NOT NULL,
        tenant_id INT NOT NULL,
        periode VARCHAR(20) NOT NULL,
        jumlah_tagihan DECIMAL(10,2) DEFAULT 0,
        status ENUM('terkirim', 'gagal', 'diterima') DEFAULT 'terkirim',
        message_id VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_tagihan (student_id, periode)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const now = new Date();
    const periode = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    const result = await db.query(
      `SELECT 
         COUNT(*) as total_sent,
         MAX(created_at) as last_run
       FROM tagihan_siswa 
       WHERE periode = ?`,
      [periode]
    );
    
    res.json({
      success: true,
      data: {
        total_sent: result[0].total_sent || 0,
        last_run: result[0].last_run ? new Date(result[0].last_run).toLocaleDateString('id-ID') : null
      }
    });
  } catch (error) {
    console.error('Bill status error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/notifications/whatsapp/bill-template/bulk', authenticateAdmin, async (req, res) => {
  try {
    const { bulan, tanggal_jatuh_tempo } = req.body;
    const tenantId = req.query.tenant_id || req.body.tenant_id;
    
    let query = `
      SELECT s.nama_siswa, s.iuran_bulanan, p.no_wa as parent_wa
      FROM students s
      LEFT JOIN parents p ON s.parent_id = p.id
      WHERE p.no_wa IS NOT NULL AND p.no_wa != ""
    `;
    let params = [];
    if (tenantId) {
      query += ' AND s.tenant_id = ?';
      params.push(tenantId);
    }
    
    const students = await db.query(query, params);
    
    let sentCount = 0;
    for (const student of students) {
      try {
        const wa = student.parent_wa || student.no_wa;
        if (!wa) continue;
        await sendBillTemplate(`62${wa.replace(/^0/, '')}`, {
          nama_siswa: student.nama_siswa,
          jumlah_tagihan: student.iuran_bulanan,
          bulan,
          tanggal_jatuh_tempo
        });
        sentCount++;
      } catch (err) {
        console.error(`Failed to send to ${student.parent_wa}:`, err.message);
      }
    }
    
    res.json({
      success: true,
      count: sentCount,
      message: `Template terkirim ke ${sentCount} siswa`
    });
  } catch (error) {
    console.error('Bulk bill template error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;