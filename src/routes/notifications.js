const express = require('express');
const db = require('../../db');
const webpush = require('../../src/notifications');
const { authenticateToken } = require('../middleware/auth');

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

module.exports = router;
