const express = require('express');
const db = require('../../db');
const { authenticateBendahara } = require('../middleware/auth');
const billing = require('../utils/billing');

const router = express.Router();

router.post('/bsi/import-report', async (req, res) => {
    try {
      await billing.ensureBillingTables();

      let records = [];

      if (Array.isArray(req.body.records)) {
        records = req.body.records;
      } else if (typeof req.body.csv === 'string') {
        // Header BSI: kolom dipisahkan koma, field bisa quote berisi koma
        const lines = req.body.csv.split(/\r?\n/).filter(l => l.trim() && !l.includes('Transaction ID#'));
        records = lines.map(l => {
          const cols = l.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g).map(c => c.replace(/^"|"$/g, '').replace(/""/g, '"'));
          // Index: 0 Transaction ID#, 1 Source Account, 2 Beneficiary Account, 3 Billing Number,
          // 4..12 Source Additional Info(1..9), 13..21 Beneficiary Additional Info(1..9),
          // 22 Remarks, 23 Transaction Date-Time, 24 Total Amount, 25 Channel, 26 Transfer Type, 27 Status
          return {
            'Transaction ID#': cols[0] || '',
            'Source Account': cols[1] || '',
            'Beneficiary Account': cols[2] || '',
            'Billing Number': cols[3] || '',
            'Source Additional Info(1)': cols[4] || '',
            'Source Additional Info(2)': cols[5] || '',
            'Source Additional Info(3)': cols[6] || '',
            'Source Additional Info(4)': cols[7] || '',
            'Source Additional Info(5)': cols[8] || '',
            'Source Additional Info(6)': cols[9] || '',
            'Source Additional Info(7)': cols[10] || '',
            'Source Additional Info(8)': cols[11] || '',
            'Source Additional Info(9)': cols[12] || '',
            'Beneficiary Additional Info(1)': cols[13] || '',
            'Beneficiary Additional Info(2)': cols[14] || '',
            'Beneficiary Additional Info(3)': cols[15] || '',
            'Beneficiary Additional Info(4)': cols[16] || '',
            'Beneficiary Additional Info(5)': cols[17] || '',
            'Beneficiary Additional Info(6)': cols[18] || '',
            'Beneficiary Additional Info(7)': cols[19] || '',
            'Beneficiary Additional Info(8)': cols[20] || '',
            'Beneficiary Additional Info(9)': cols[21] || '',
            'Remarks': cols[22] || '',
            'Transaction Date-Time': cols[23] || '',
            'Total Amount': cols[24] || '',
            'Channel': cols[25] || '',
            'Transfer Type': cols[26] || '',
            'Status': cols[27] || ''
          };
        });
      }

      let inserted = 0, duplicated = 0;
      const matchedStudents = new Set();

      for (const rec of records) {
        // Normalize field names: support both CSV headers and JSON API fields
        const normalizedRec = {
          'Transaction ID#': rec['Transaction ID#'] || rec.transaction_id || '',
          'Beneficiary Account': rec['Beneficiary Account'] || rec.va_number || rec.beneficiary_account || '',
          'Source Account': rec['Source Account'] || rec.source_account_no || '',
          'Nama Pengirim': rec['Nama Pengirim'] || rec.nama_pengirim || '',
          'Total Amount': rec['Total Amount'] || rec.nominal || 0,
          'Channel': rec['Channel'] || rec.channel || '',
          'Status': rec['Status'] || rec.status_bank || '',
          'Remarks': rec['Remarks'] || rec.remarks || '',
          'Transaction Date-Time': rec['Transaction Date-Time'] || rec.tanggal_transaksi || '',
          'Nama VA Siswa': rec['Nama VA Siswa'] || rec.nama_va_siswa || ''
        };

        // Skip jika tidak ada VA number
        const va = billing.extractVA(normalizedRec['Beneficiary Account'] || '');
        if (!va) continue;

        try {
          const r = await billing.insertIncoming(normalizedRec);
          if (r.duplicate) {
            duplicated++;
          } else {
            inserted++;
          }
          if (r.matchedStudentId) matchedStudents.add(r.matchedStudentId);
        } catch (e) {
          console.error('insertIncoming error', e.message);
        }
      }

      // Hitung ulang saldo untuk tiap siswa yang cocok
      let recalced = 0;
      for (const sid of matchedStudents) {
        await billing.recalcStudent(sid);
        recalced++;
      }

      res.json({
        success: true,
        message: `${inserted} baris incoming disimpan, ${duplicated} duplikat dilewati, ${recalced} siswa dihitung ulang saldonya`,
        inserted,
        duplicated,
        recalced
      });
    } catch (error) {
      console.error('BSI import error:', error);
      res.status(500).json({ success: false, message: 'Gagal import laporan BSI' });
    }
  });

module.exports = router;