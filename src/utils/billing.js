// Billing & Saldo engine for manual BSI VA payments
// - incoming_payments : raw BSI mutation report (as-is)
// - billing_payment   : tagihan per siswa per bulan (snapshot iuran)
// - saldo_siswa       : saldo berjalan (- tunggakan, + kelebihan)
// Periode diambil dari Transaction Date-Time (bukan remarks).
// Kelebihan bulan ini mengurangi kewajiban bulan berikutnya (carry-over).

const db = require('../../db');

const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

function parseDateBSI(dateStr) {
  const parts = (dateStr || '').split(' ');
  if (parts.length < 3) return null;
  const day = parts[0];
  const month = MONTHS[parts[1]] || '01';
  const year = parts[2];
  const time = parts[3] || '00:00';
  return `${year}-${month}-${day} ${time}:00`;
}

function parsePeriode(dateStr) {
  const parts = (dateStr || '').split(' ');
  if (parts.length < 3) return null;
  const month = MONTHS[parts[1]] || '01';
  const year = parts[2];
  return `${year}-${month}`;
}

function monthList(start, end) {
  // start/end format YYYY-MM
  const out = [];
  let [y, m] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function stripDigits(v) {
  return (v || '').replace(/[^0-9]/g, '');
}

function extractVA(beneficiaryRaw) {
  const match = (beneficiaryRaw || '').match(/(\d{10,16})/);
  if (match) {
    const va = match[1];
    // BSI VA biasanya diawali 832231 (atau 172 untuk sandbox)
    // Terima semua VA dengan format 10-16 digit
    if (/^\d{10,16}$/.test(va)) return va;
  }
  return null;
}

async function ensureBillingTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS incoming_payments (
      id BIGINT(20) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      transaction_id VARCHAR(100) DEFAULT NULL,
      source_account VARCHAR(150) DEFAULT NULL,
      beneficiary_account VARCHAR(150) DEFAULT NULL,
      billing_number VARCHAR(100) DEFAULT NULL,
      source_additional_1 VARCHAR(255) DEFAULT NULL,
      source_additional_2 VARCHAR(255) DEFAULT NULL,
      source_additional_3 VARCHAR(255) DEFAULT NULL,
      source_additional_4 VARCHAR(255) DEFAULT NULL,
      source_additional_5 VARCHAR(255) DEFAULT NULL,
      source_additional_6 VARCHAR(255) DEFAULT NULL,
      source_additional_7 VARCHAR(255) DEFAULT NULL,
      source_additional_8 VARCHAR(255) DEFAULT NULL,
      source_additional_9 VARCHAR(255) DEFAULT NULL,
      beneficiary_additional_1 VARCHAR(255) DEFAULT NULL,
      beneficiary_additional_2 VARCHAR(255) DEFAULT NULL,
      beneficiary_additional_3 VARCHAR(255) DEFAULT NULL,
      beneficiary_additional_4 VARCHAR(255) DEFAULT NULL,
      beneficiary_additional_5 VARCHAR(255) DEFAULT NULL,
      beneficiary_additional_6 VARCHAR(255) DEFAULT NULL,
      beneficiary_additional_7 VARCHAR(255) DEFAULT NULL,
      beneficiary_additional_8 VARCHAR(255) DEFAULT NULL,
      beneficiary_additional_9 VARCHAR(255) DEFAULT NULL,
      remarks TEXT,
      transaction_date_time VARCHAR(50) DEFAULT NULL,
      transaction_datetime DATETIME DEFAULT NULL,
      total_amount DECIMAL(12,2) DEFAULT 0,
      channel VARCHAR(50) DEFAULT NULL,
      transfer_type VARCHAR(20) DEFAULT NULL,
      status VARCHAR(20) DEFAULT NULL,
      matched_student_id INT(11) DEFAULT NULL,
      periode VARCHAR(7) DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_benef (beneficiary_account),
      KEY idx_matched (matched_student_id),
      KEY idx_periode (periode)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS billing_payment (
      id BIGINT(20) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(20) DEFAULT NULL,
      student_id INT(11) NOT NULL,
      spp_bulanan DECIMAL(12,2) DEFAULT 0,
      bulan VARCHAR(7) NOT NULL,
      transaksi DECIMAL(12,2) DEFAULT 0,
      keterangan_spp DECIMAL(12,2) DEFAULT 0,
      status ENUM('lunas','belum') DEFAULT 'belum',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_student_bulan (student_id, bulan),
      KEY idx_tenant (tenant_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

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

  // Tambah kolom tanggal_masuk di students (bulan & tahun masuk, format YYYY-MM)
  try {
    await db.query(`ALTER TABLE students ADD COLUMN tanggal_masuk VARCHAR(7) DEFAULT NULL`);
  } catch (e) {
    // 1060 = duplicate column -> aman diabaikan
    if (e.code !== 'ER_DUP_FIELDNAME' && !/duplicate column/i.test(e.message)) throw e;
  }
}

// Insert satu baris incoming_payments dari record BSI (object key = header)
async function insertIncoming(rec) {
  const beneficiaryRaw = rec['Beneficiary Account'] || '';
  const beneficiaryDigits = extractVA(beneficiaryRaw);
  const tdt = rec['Transaction Date-Time'] || '';
  const transaction_datetime = parseDateBSI(tdt) || new Date().toISOString().slice(0, 19).replace('T', ' ');
  const periode = parsePeriode(tdt);

  let amount = 0;
  const amt = rec['Total Amount'] || '0';
  const amtClean = (typeof amt === 'string' ? amt : String(amt)).replace(/[^\d,]/g, '').replace(',', '.');
  amount = parseFloat(amtClean) || 0;

  // Cegah duplikat berdasarkan Transaction ID#
  const transactionId = rec['Transaction ID#'] || '';
  if (transactionId) {
    const [existing] = await db.query('SELECT id, matched_student_id FROM incoming_payments WHERE transaction_id = ? LIMIT 1', [transactionId]);
    if (existing) return { id: existing.id, matchedStudentId: existing.matched_student_id, periode, duplicate: true };
  }

  // Normalize status - BSI reports often use "Success", "SUCCESS", or other variations
  let rawStatus = (rec['Status'] || '').trim();
  const statusMap = {
    'Success': 'Success',
    'SUCCESS': 'Success',
    'success': 'Success',
    'Sukses': 'Success',
    'sukses': 'Success',
    'Settlement': 'Success',
    'SETTLEMENT': 'Success',
    'Paid': 'Success',
    'PAID': 'Success',
    'Referral': 'Success',
    'REFERRAL': 'Success'
  };
  const status = statusMap[rawStatus] || rawStatus;

  // Match siswa by VA (hanya 10-16 digit awal)
  let matchedStudentId = null;
  if (beneficiaryDigits) {
    // Try multiple matching patterns - VA in database may have different formats
    // Pattern 1: Exact match (with/without spaces)
    let [st] = await db.query('SELECT id FROM students WHERE REPLACE(va_number, " ", "") = ? OR va_number = ? LIMIT 1', [beneficiaryDigits, beneficiaryDigits]);
    
    // Pattern 2: Last 10-12 digits (VA prefix variations)
    if (!st && beneficiaryDigits.length > 10) {
      for (let len = 12; len >= 10; len--) {
        const suffix = beneficiaryDigits.slice(-len);
        [st] = await db.query('SELECT id FROM students WHERE REPLACE(va_number, " ", "") LIKE ? LIMIT 1', ['%' + suffix]);
        if (st) break;
      }
    }
    
    // Pattern 3: Remove BSI prefix (832231) if present
    if (!st) {
      const withoutPrefix = beneficiaryDigits.replace(/^832231/, '');
      if (withoutPrefix.length >= 10) {
        [st] = await db.query('SELECT id FROM students WHERE REPLACE(va_number, " ", "") = ? OR va_number = ? LIMIT 1', [withoutPrefix, withoutPrefix]);
      }
    }
    
    matchedStudentId = st ? st.id : null;
    if (!matchedStudentId) {
      console.log(`[VA_MATCH] Tidak ditemukan siswa untuk VA ${beneficiaryDigits}`);
    }
  }

  const columns = [
    'transaction_id', 'source_account', 'beneficiary_account', 'billing_number',
    'source_additional_1', 'source_additional_2', 'source_additional_3', 'source_additional_4', 'source_additional_5',
    'source_additional_6', 'source_additional_7', 'source_additional_8', 'source_additional_9',
    'beneficiary_additional_1', 'beneficiary_additional_2', 'beneficiary_additional_3', 'beneficiary_additional_4', 'beneficiary_additional_5',
    'beneficiary_additional_6', 'beneficiary_additional_7', 'beneficiary_additional_8', 'beneficiary_additional_9',
    'remarks', 'transaction_date_time', 'transaction_datetime', 'total_amount', 'channel', 'transfer_type', 'status', 'matched_student_id', 'periode'
  ];

  const values = [
    transactionId,
    rec['Source Account'] || '',
    beneficiaryRaw,
    rec['Billing Number'] || '',
    rec['Source Additional Info(1)'] || '',  rec['Source Additional Info(2)'] || '', rec['Source Additional Info(3)'] || '', rec['Source Additional Info(4)'] || '', rec['Source Additional Info(5)'] || '',
    rec['Source Additional Info(6)'] || '', rec['Source Additional Info(7)'] || '', rec['Source Additional Info(8)'] || '', rec['Source Additional Info(9)'] || '',
    rec['Beneficiary Additional Info(1)'] || '', rec['Beneficiary Additional Info(2)'] || '', rec['Beneficiary Additional Info(3)'] || '', rec['Beneficiary Additional Info(4)'] || '', rec['Beneficiary Additional Info(5)'] || '',
    rec['Beneficiary Additional Info(6)'] || '', rec['Beneficiary Additional Info(7)'] || '', rec['Beneficiary Additional Info(8)'] || '', rec['Beneficiary Additional Info(9)'] || '',
    rec['Remarks'] || '',
    tdt,
    transaction_datetime,
    amount,
    rec['Channel'] || '',
    rec['Transfer Type'] || '',
    status,
    matchedStudentId,
    periode
  ];

  const placeholders = values.map(() => '?').join(',');

  const res = await db.query(`
    INSERT INTO incoming_payments (${columns.join(',')})
    VALUES (${placeholders})
  `, values);

  return { id: res.insertId, matchedStudentId, periode };
}

// Generate billing_payment untuk satu tenant, per siswa dari tanggal_masuk -> now
async function generateBilling(tenantId, fallbackStart) {
  const end = currentMonth();
  const students = await db.query(
    `SELECT id, tenant_id, iuran_bulanan, tanggal_masuk FROM students
     WHERE tenant_id = ? AND (status = 'active' OR status = 'aktif' OR status IS NULL)`,
    [tenantId]
  );

  let created = 0, skipped = 0;
  for (const s of students) {
    // Check for existing bills to determine the real start
    const [existingBills] = await db.query('SELECT MIN(bulan) as min_bulan FROM billing_payment WHERE student_id = ? LIMIT 1', [s.id]);
    const minBulan = existingBills?.min_bulan;
    
    // Start from earliest existing bill, tanggal_masuk, or fallbackStart
    let start = minBulan;
    if (!start && s.tanggal_masuk && /^\d{4}-\d{2}$/.test(s.tanggal_masuk)) {
      start = s.tanggal_masuk;
    }
    if (!start) {
      start = fallbackStart || end;
    }
    
    const months = monthList(start, end);
    const spp = parseFloat(s.iuran_bulanan) || 0;
    for (const m of months) {
      const [existing] = await db.query('SELECT id, bulan FROM billing_payment WHERE student_id = ? AND bulan = ?', [s.id, m]);
      if (existing) {
        // Lock snapshot spp_bulanan for months already past
        if (m < end) { skipped++; continue; }
        await db.query('UPDATE billing_payment SET spp_bulanan = ?, transaksi = 0, keterangan_spp = ?, status = "belum" WHERE id = ?', [spp, spp, existing.id]);
        created++;
      } else {
        await db.query(
          'INSERT INTO billing_payment (tenant_id, student_id, spp_bulanan, bulan, transaksi, keterangan_spp, status) VALUES (?, ?, ?, ?, 0, ?, "belum")',
          [s.tenant_id, s.id, spp, m, spp]
        );
        created++;
      }
    }
  }
  return { created, skipped, end };
}

// Hitung ulang keterangan_spp + saldo untuk 1 siswa (dengan carry-over kelebihan)
async function recalcStudent(studentId) {
  const [student] = await db.query('SELECT id, tenant_id FROM students WHERE id = ?', [studentId]);
  if (!student) return null;

  const bills = await db.query('SELECT * FROM billing_payment WHERE student_id = ? ORDER BY bulan ASC', [studentId]);
  const inc = await db.query(
    "SELECT periode, SUM(total_amount) as total FROM incoming_payments WHERE matched_student_id = ? AND status IN ('Success', 'SUCCESS', 'success', 'Sukses', 'Settlement', 'Paid', 'PAID', 'Referral') GROUP BY periode",
    [studentId]
  );
  const incMap = {};
  inc.forEach(r => { incMap[r.periode] = parseFloat(r.total) || 0; });

  let carry = 0;
  let totalKeterangan = 0;
  for (const b of bills) {
    const spp = parseFloat(b.spp_bulanan) || 0;
    const trans = incMap[b.bulan] || 0;
    const available = trans + carry;
    let keterangan, status, newCarry;
    if (available >= spp) {
      keterangan = 0;
      status = 'lunas';
      newCarry = available - spp;
    } else {
      keterangan = spp - available;
      status = 'belum';
      newCarry = 0;
    }
    carry = newCarry;
    totalKeterangan += keterangan;
    await db.query(
      'UPDATE billing_payment SET transaksi = ?, keterangan_spp = ?, status = ? WHERE id = ?',
      [trans, keterangan, status, b.id]
    );
  }

  // saldo: + kelebihan (carry), - tunggakan (Σ keterangan)
  const saldo = carry - totalKeterangan;
  await db.query(
    `INSERT INTO saldo_siswa (student_id, tenant_id, saldo) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE saldo = VALUES(saldo), tenant_id = VALUES(tenant_id)`,
    [studentId, student.tenant_id, saldo]
  );
  return { studentId, saldo, carry, totalKeterangan };
}

async function recalcTenant(tenantId) {
  const students = await db.query('SELECT id FROM students WHERE tenant_id = ?', [tenantId]);
  let updated = 0;
  for (const s of students) {
    await recalcStudent(s.id);
    updated++;
  }
  return { updated };
}

module.exports = {
  MONTHS, parseDateBSI, parsePeriode, monthList, currentMonth,
  ensureBillingTables, stripDigits, extractVA, insertIncoming,
  generateBilling, recalcStudent, recalcTenant
};