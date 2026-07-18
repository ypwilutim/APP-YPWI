const express = require('express');
const db = require('../../db');
const { authenticateToken, authenticateOperator } = require('../middleware/auth');

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

router.post('/bsi/import-report', authenticateToken, authenticateOperator, async (req, res) => {
  try {
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

    let paid = 0, unmatched = [];

    const vaNumbers = records.map(r => {
      const m = (r['Beneficiary Account'] || '').match(/(\d{10,})/);
      return m ? m[1] : null;
    }).filter(Boolean);

    const studentMap = {};
    if (vaNumbers.length) {
      const placeholders = vaNumbers.map(() => '?').join(',');
      const students = await db.query(`SELECT id, va_number FROM students WHERE va_number IN (${placeholders})`, vaNumbers);
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

      if (periodeMatch && student) {
        const monthNames = { Januari: '01', Februari: '02', Maret: '03', April: '04', Mei: '05', Juni: '06', Juli: '07', Agustus: '08', September: '09', Oktober: '10', November: '11', Desember: '12' };
        const periode = `${periodeMatch[2]}-${monthNames[periodeMatch[1]] || '01'}`;

        if (!student.id) continue;

        // 1. UPDATE: Tambahkan invoice_number ke dalam SET
        const result = await db.query(
          'UPDATE payment_invoices SET status = ?, paid_at = ?, paid_amount = ?, payment_channel = ?, invoice_number = ? WHERE student_id = ? AND periode = ? AND status IN (?, ?)',
          ['paid', transactionDate, amount, rec.Channel, transactionId, student.id, periode, 'unpaid', 'pending']
        );

        // 2. INSERT: Tambahkan invoice_number ke daftar kolom
        if (result.affectedRows > 0) {
          paid++;
        } else {
          // Menggunakan INSERT IGNORE agar tidak error jika Transaction ID tersebut sudah ada
          await db.query(
            'INSERT IGNORE INTO payment_invoices (student_id, periode, status, paid_at, amount, paid_amount, payment_channel, invoice_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [student.id, periode, 'paid', transactionDate, amount, amount, rec.Channel, transactionId]
          );
          paid++;
        }
      } else if (status === 'Success' && student) {
        unmatched.push({ va_number: vaNumber, amount, note: 'Gagal deteksi periode' });
      }
    }

    res.json({ success: true, message: `${paid} transaksi diproses`, paid, unmatched });
  } catch (error) {
    console.error('BSI import error:', error);
    res.status(500).json({ success: false, message: 'Gagal import laporan BSI' });
  }
});

module.exports = router;