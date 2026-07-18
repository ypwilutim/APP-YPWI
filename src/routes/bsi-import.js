const express = require('express');
const db = require('../../db');
const { authenticateBendahara } = require('../middleware/auth');

const router = express.Router();

const parseDateBSI = (dateStr) => {
  const months = { 'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12' };
  const parts = dateStr.split(' ');
  if (parts.length < 3) return new Date().toISOString().slice(0, 19).replace('T', ' ');

  const day = parts[0];
  const month = months[parts[1]] || '01';
  const year = parts[2];
  const time = parts[3] || '00:00';
  return `${year}-${month}-${day} ${time}:00`;
};

router.post('/bsi/import-report', authenticateBendahara, async (req, res) => {
  try {
    // Pastikan tabel saldo & mutasi ada
    await db.query(`
      CREATE TABLE IF NOT EXISTS saldo_siswa (
        id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
        student_id INT(11) NOT NULL,
        tenant_id VARCHAR(20) DEFAULT NULL,
        saldo DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '- = tunggakan, + = kelebihan',
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_student (student_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS mutasi_siswa (
        id BIGINT(20) NOT NULL AUTO_INCREMENT PRIMARY KEY,
        student_id INT(11) NOT NULL,
        tenant_id VARCHAR(20) DEFAULT NULL,
        transaction_id VARCHAR(100) DEFAULT NULL,
        va_number VARCHAR(50) DEFAULT NULL,
        periode VARCHAR(7) DEFAULT NULL,
        iuran DECIMAL(12,2) DEFAULT 0.00,
        bayar DECIMAL(12,2) DEFAULT 0.00,
        selisih DECIMAL(12,2) DEFAULT 0.00,
        saldo_after DECIMAL(12,2) DEFAULT 0.00,
        channel VARCHAR(50) DEFAULT NULL,
        status VARCHAR(20) DEFAULT NULL,
        transaction_date DATETIME DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    let records = [];

    if (Array.isArray(req.body.records)) {
      records = req.body.records;
    } else if (typeof req.body.csv === 'string') {
      const lines = req.body.csv.split('\n').filter(l => l.trim() && !l.includes('Transaction ID#'));
      records = lines.map(l => {
        const cols = l.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g).map(c => c.replace(/"/g, ''));
        return {
          'Transaction ID#': cols[0] || '',
          'Beneficiary Account': cols[2] || '',
          'Source Additional Info(1)': cols[4] || '',
          'Beneficiary Additional Info(1)': cols[13] || '',
          'Remarks': cols[22] || '',
          'Transaction Date-Time': cols[23] || '',
          'Total Amount': cols[24] || '',
          'Channel': cols[25] || '',
          'Status': cols[27] || ''
        };
      });
    }

    let paid = 0, unmatched = [], saldoUpdated = 0;

    const vaNumbers = records.map(r => {
      const m = (r['Beneficiary Account'] || '').match(/(\d{10,})/);
      return m ? m[1] : null;
    }).filter(Boolean);

    const studentMap = {};
    if (vaNumbers.length) {
      const placeholders = vaNumbers.map(() => '?').join(',');
      const students = await db.query(`SELECT id, tenant_id, va_number, iuran_bulanan FROM students WHERE va_number IN (${placeholders})`, vaNumbers);
      students.forEach(s => studentMap[s.va_number] = s);
    }

    for (const rec of records) {
      const vaMatch = (rec['Beneficiary Account'] || '').match(/(\d{10,})/);
      const vaNumber = vaMatch ? vaMatch[1] : '';
      const transactionId = rec['Transaction ID#'] || '';
      let amount = 0;
      const amt = rec['Total Amount'] || '0';
      amount = typeof amt === 'string' ? parseFloat(amt.replace(/[^0-9,]/g, '').replace(',', '.')) || 0 : parseFloat(amt) || 0;

      const status = rec.Status || '';
      const transactionDate = parseDateBSI(rec['Transaction Date-Time'] || '');

      const targetStr = [rec['Beneficiary Account'], rec['Beneficiary Additional Info(1)'], rec.Remarks, rec['Source Additional Info(1)']].filter(Boolean).join(' ');
      const periodeMatch = targetStr.match(/SPP Bulan ([A-Za-z]+)\s+(\d{4})/);

      const student = studentMap[vaNumber];

      if (!student && vaNumber) {
        unmatched.push({ va_number: vaNumber, amount, note: 'Siswa tidak ditemukan' });
        continue;
      }
      if (!student) continue;

      // Transaksi masuk (kredit ke VA sekolah) dihitung sebagai pembayaran SPP
      if (amount <= 0) continue;

      const iuran = parseFloat(student.iuran_bulanan) || 0;
      const selisih = amount - iuran;

      // Akumulasi saldo berjalan siswa (- tunggakan, + kelebihan)
      await db.query(
        `INSERT INTO saldo_siswa (student_id, tenant_id, saldo) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE saldo = saldo + VALUES(saldo), tenant_id = VALUES(tenant_id)`,
        [student.id, student.tenant_id, selisih]
      );
      const [saldoRow] = await db.query('SELECT saldo FROM saldo_siswa WHERE student_id = ?', [student.id]);

      await db.query(
        `INSERT INTO mutasi_siswa (student_id, tenant_id, transaction_id, va_number, periode, iuran, bayar, selisih, saldo_after, channel, status, transaction_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [student.id, student.tenant_id, transactionId, vaNumber, periodeMatch ? periodeMatch[2] + '-' + ({ Januari: '01', Februari: '02', Maret: '03', April: '04', Mei: '05', Juni: '06', Juli: '07', Agustus: '08', September: '09', Oktober: '10', November: '11', Desember: '12' }[periodeMatch[1]] || '') : null, iuran, amount, selisih, saldoRow ? saldoRow.saldo : selisih, rec.Channel, status || 'Success', transactionDate]
      );
      saldoUpdated++;

      // Pertahankan logika lama (payment_invoices) agar dashboard lain tetap jalan
      if (periodeMatch) {
        const monthNames = { Januari: '01', Februari: '02', Maret: '03', April: '04', Mei: '05', Juni: '06', Juli: '07', Agustus: '08', September: '09', Oktober: '10', November: '11', Desember: '12' };
        const periode = `${periodeMatch[2]}-${monthNames[periodeMatch[1]] || '01'}`;

        const result = await db.query(
          'UPDATE payment_invoices SET status = ?, paid_at = ?, paid_amount = ?, payment_channel = ?, invoice_number = ? WHERE student_id = ? AND periode = ? AND status IN (?, ?)',
          ['paid', transactionDate, amount, rec.Channel, transactionId, student.id, periode, 'unpaid', 'pending']
        );
        if (result.affectedRows > 0) {
          paid++;
        } else {
          await db.query(
            'INSERT IGNORE INTO payment_invoices (student_id, periode, status, paid_at, amount, paid_amount, payment_channel, invoice_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [student.id, periode, 'paid', transactionDate, amount, amount, rec.Channel, transactionId]
          );
          paid++;
        }
      }
    }

    res.json({ success: true, message: `${saldoUpdated} mutasi saldo diproses, ${paid} invoice diupdate`, paid, saldoUpdated, unmatched });
  } catch (error) {
    console.error('BSI import error:', error);
    res.status(500).json({ success: false, message: 'Gagal import laporan BSI' });
  }
});

module.exports = router;