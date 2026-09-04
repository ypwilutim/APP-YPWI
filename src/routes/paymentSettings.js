// =====================================================
// Payment Settings Routes
// Pengaturan biaya admin VA BSI per siswa/guru
// =====================================================

const express = require('express');
const router = express.Router();
const db = require('../../db');
const billing = require('../utils/billing');

// GET /api/payment-settings?subject_type=student|teacher&tenant_id=X
// List payment settings, filter by subject_type dan/atau tenant_id
router.get('/payment-settings', async (req, res) => {
  try {
    await billing.ensureBillingTables();
    const { subject_type, tenant_id, subject_id } = req.query;

    // Verify table exists by checking structure
    try {
      await db.query('SELECT 1 FROM payment_admin_settings LIMIT 1');
    } catch (tableErr) {
      // Force create table if missing
      console.warn('[payment_admin_settings] Table missing, recreating:', tableErr.message);
      await db.query(`
        CREATE TABLE IF NOT EXISTS payment_admin_settings (
          id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
          subject_type ENUM('student', 'teacher') NOT NULL,
          subject_id INT(11) NOT NULL,
          tenant_id VARCHAR(20) DEFAULT NULL,
          biaya_admin_va DECIMAL(12,2) NOT NULL DEFAULT 2000.00,
          keterangan TEXT DEFAULT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_subject (subject_type, subject_id),
          KEY idx_tenant (tenant_id),
          KEY idx_subject (subject_type, subject_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    }

    let query = `
      SELECT ps.*,
        CASE
          WHEN ps.subject_type = 'student' THEN s.nama_siswa
          WHEN ps.subject_type = 'teacher' THEN t.nama
        END as subject_name,
        CASE
          WHEN ps.subject_type = 'student' THEN s.nisn
          WHEN ps.subject_type = 'teacher' THEN t.nik
        END as subject_identifier,
        tn.nama_sekolah
      FROM payment_admin_settings ps
      LEFT JOIN students s ON ps.subject_type = 'student' AND ps.subject_id = s.id
      LEFT JOIN teachers t ON ps.subject_type = 'teacher' AND ps.subject_id = t.id
      LEFT JOIN tenants tn ON ps.tenant_id = tn.tenant_id
      WHERE 1=1
    `;
    const params = [];

    if (subject_type) {
      query += ' AND ps.subject_type = ?';
      params.push(subject_type);
    }
    if (tenant_id) {
      query += ' AND ps.tenant_id = ?';
      params.push(tenant_id);
    }
    if (subject_id) {
      query += ' AND ps.subject_id = ?';
      params.push(parseInt(subject_id));
    }

    query += ' ORDER BY ps.subject_type, subject_name ASC';
    const rows = await db.query(query, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Get payment settings error:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil pengaturan pembayaran' });
  }
});

// GET /api/payment-settings/:subject_type/:subject_id
// Get single payment setting
router.get('/payment-settings/:subject_type/:subject_id', async (req, res) => {
  try {
    const { subject_type, subject_id } = req.params;
    const row = await db.query(
      'SELECT * FROM payment_admin_settings WHERE subject_type = ? AND subject_id = ?',
      [subject_type, parseInt(subject_id)]
    );
    if (!row || row.length === 0) {
      return res.status(404).json({ success: false, message: 'Pengaturan tidak ditemukan' });
    }
    res.json({ success: true, data: row[0] });
  } catch (error) {
    console.error('Get payment setting error:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil pengaturan' });
  }
});

// POST /api/payment-settings
// Create or update payment setting (upsert)
router.post('/payment-settings', async (req, res) => {
  try {
    await billing.ensureBillingTables();
    const { subject_type, subject_id, tenant_id, biaya_admin_va, keterangan } = req.body;

    if (!['student', 'teacher'].includes(subject_type)) {
      return res.status(400).json({ success: false, message: 'subject_type harus student atau teacher' });
    }
    if (!subject_id) {
      return res.status(400).json({ success: false, message: 'subject_id wajib diisi' });
    }
    if (biaya_admin_va === undefined || biaya_admin_va === null || isNaN(parseFloat(biaya_admin_va))) {
      return res.status(400).json({ success: false, message: 'biaya_admin_va wajib diisi dan harus angka' });
    }

    const adminFee = parseFloat(biaya_admin_va);
    if (adminFee < 0) {
      return res.status(400).json({ success: false, message: 'biaya_admin_va tidak boleh negatif' });
    }

    await db.query(
      `INSERT INTO payment_admin_settings (subject_type, subject_id, tenant_id, biaya_admin_va, keterangan)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         tenant_id = VALUES(tenant_id),
         biaya_admin_va = VALUES(biaya_admin_va),
         keterangan = VALUES(keterangan)`,
      [subject_type, parseInt(subject_id), tenant_id || null, adminFee, keterangan || null]
    );

    const row = await db.query(
      'SELECT * FROM payment_admin_settings WHERE subject_type = ? AND subject_id = ?',
      [subject_type, parseInt(subject_id)]
    );

    res.json({
      success: true,
      message: 'Pengaturan pembayaran berhasil disimpan',
      data: row[0] || null
    });
  } catch (error) {
    console.error('Save payment setting error:', error);
    res.status(500).json({ success: false, message: 'Gagal menyimpan pengaturan' });
  }
});

// PUT /api/payment-settings/:subject_type/:subject_id
// Update specific payment setting
router.put('/payment-settings/:subject_type/:subject_id', async (req, res) => {
  try {
    const { subject_type, subject_id } = req.params;
    const { biaya_admin_va, keterangan, tenant_id } = req.body;

    if (!['student', 'teacher'].includes(subject_type)) {
      return res.status(400).json({ success: false, message: 'subject_type harus student atau teacher' });
    }

    const updates = [];
    const params = [];

    if (biaya_admin_va !== undefined) {
      const adminFee = parseFloat(biaya_admin_va);
      if (isNaN(adminFee) || adminFee < 0) {
        return res.status(400).json({ success: false, message: 'biaya_admin_va tidak valid' });
      }
      updates.push('biaya_admin_va = ?');
      params.push(adminFee);
    }
    if (keterangan !== undefined) {
      updates.push('keterangan = ?');
      params.push(keterangan || null);
    }
    if (tenant_id !== undefined) {
      updates.push('tenant_id = ?');
      params.push(tenant_id || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'Tidak ada field yang diupdate' });
    }

    params.push(subject_type, parseInt(subject_id));
    const result = await db.query(
      `UPDATE payment_admin_settings SET ${updates.join(', ')} WHERE subject_type = ? AND subject_id = ?`,
      params
    );

    if (!result || (result.affectedRows === 0 && subject_type && subject_id)) {
      // Insert new record if not exists
      await db.query(
        `INSERT IGNORE INTO payment_admin_settings (subject_type, subject_id, tenant_id, biaya_admin_va, keterangan)
         VALUES (?, ?, ?, ?, ?)`,
        [subject_type, parseInt(subject_id), tenant_id || null, parseFloat(biaya_admin_va) || 2000, keterangan || null]
      );
    }

    res.json({ success: true, message: 'Pengaturan berhasil diupdate' });
  } catch (error) {
    console.error('Update payment setting error:', error);
    res.status(500).json({ success: false, message: 'Gagal update pengaturan' });
  }
});

// DELETE /api/payment-settings/:subject_type/:subject_id
router.delete('/payment-settings/:subject_type/:subject_id', async (req, res) => {
  try {
    const { subject_type, subject_id } = req.params;
    await db.query(
      'DELETE FROM payment_admin_settings WHERE subject_type = ? AND subject_id = ?',
      [subject_type, parseInt(subject_id)]
    );
    res.json({ success: true, message: 'Pengaturan berhasil dihapus' });
  } catch (error) {
    console.error('Delete payment setting error:', error);
    res.status(500).json({ success: false, message: 'Gagal hapus pengaturan' });
  }
});

// POST /api/payment-settings/bulk
// Bulk update biaya admin untuk banyak siswa/guru sekaligus
router.post('/payment-settings/bulk', async (req, res) => {
  try {
    await billing.ensureBillingTables();
    const { subject_type, tenant_id, biaya_admin_va, subject_ids, keterangan } = req.body;

    if (!['student', 'teacher'].includes(subject_type)) {
      return res.status(400).json({ success: false, message: 'subject_type harus student atau teacher' });
    }
    if (biaya_admin_va === undefined || isNaN(parseFloat(biaya_admin_va))) {
      return res.status(400).json({ success: false, message: 'biaya_admin_va wajib diisi' });
    }
    if (!Array.isArray(subject_ids) || subject_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'subject_ids wajib array tidak kosong' });
    }

    let updated = 0, inserted = 0;
    for (const id of subject_ids) {
      const existing = await db.query(
        'SELECT id FROM payment_admin_settings WHERE subject_type = ? AND subject_id = ?',
        [subject_type, parseInt(id)]
      );
      const exists = Array.isArray(existing) ? existing[0] : existing;

      if (exists) {
        await db.query(
          `UPDATE payment_admin_settings SET biaya_admin_va = ?, keterangan = ?, tenant_id = ?
           WHERE subject_type = ? AND subject_id = ?`,
          [parseFloat(biaya_admin_va), keterangan || null, tenant_id || null, subject_type, parseInt(id)]
        );
        updated++;
      } else {
        await db.query(
          `INSERT INTO payment_admin_settings (subject_type, subject_id, tenant_id, biaya_admin_va, keterangan)
           VALUES (?, ?, ?, ?, ?)`,
          [subject_type, parseInt(id), tenant_id || null, parseFloat(biaya_admin_va), keterangan || null]
        );
        inserted++;
      }
    }

    res.json({
      success: true,
      message: `Berhasil: ${updated} diupdate, ${inserted} ditambahkan`,
      updated,
      inserted,
      total: subject_ids.length
    });
  } catch (error) {
    console.error('Bulk update payment settings error:', error);
    res.status(500).json({ success: false, message: 'Gagal bulk update' });
  }
});

// =====================================================
// GLOBAL SETTINGS (single row - applies to ALL students/teachers)
// =====================================================

// GET /api/payment-settings/global - Get global biaya_admin_va setting
router.get('/payment-settings/global', async (req, res) => {
  try {
    await billing.ensureBillingTables();

    // Ensure global row exists (singleton: subject_type='global', subject_id=0)
    await db.query(`
      INSERT IGNORE INTO payment_admin_settings (subject_type, subject_id, biaya_admin_va, keterangan)
      VALUES ('global', 0, 2000.00, 'Default biaya admin VA BSI - berlaku untuk semua')
    `);

    const rows = await db.query(
      `SELECT * FROM payment_admin_settings WHERE subject_type = 'global' AND subject_id = 0 LIMIT 1`
    );
    const row = Array.isArray(rows) ? rows[0] : rows;

    res.json({ success: true, data: row || null });
  } catch (error) {
    console.error('Get global payment settings error:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil pengaturan global' });
  }
});

// POST /api/payment-settings/global - Update global biaya_admin_va setting
router.post('/payment-settings/global', async (req, res) => {
  try {
    await billing.ensureBillingTables();
    const { biaya_admin_va, keterangan } = req.body;

    if (biaya_admin_va === undefined || biaya_admin_va === null || isNaN(parseFloat(biaya_admin_va))) {
      return res.status(400).json({ success: false, message: 'biaya_admin_va wajib diisi' });
    }
    const adminFee = parseFloat(biaya_admin_va);
    if (adminFee < 0) {
      return res.status(400).json({ success: false, message: 'biaya_admin_va tidak boleh negatif' });
    }

    await db.query(
      `INSERT INTO payment_admin_settings (subject_type, subject_id, biaya_admin_va, keterangan)
       VALUES ('global', 0, ?, ?)
       ON DUPLICATE KEY UPDATE
         biaya_admin_va = VALUES(biaya_admin_va),
         keterangan = VALUES(keterangan)`,
      [adminFee, keterangan || null]
    );

    const rows = await db.query(
      `SELECT * FROM payment_admin_settings WHERE subject_type = 'global' AND subject_id = 0 LIMIT 1`
    );
    const row = Array.isArray(rows) ? rows[0] : rows;

    res.json({
      success: true,
      message: 'Pengaturan global berhasil disimpan. Berlaku untuk semua siswa & guru.',
      data: row || null
    });
  } catch (error) {
    console.error('Save global payment settings error:', error);
    res.status(500).json({ success: false, message: 'Gagal menyimpan pengaturan global' });
  }
});

module.exports = router;
