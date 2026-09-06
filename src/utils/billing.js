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
      ransportasi DECIMAL(12,2) DEFAULT 0,
      subsidi DECIMAL(12,2) DEFAULT 0,
      bulan VARCHAR(7) NOT NULL,
      transaksi DECIMAL(12,2) DEFAULT 0,
      keterangan_spp DECIMAL(12,2) DEFAULT 0,
      status ENUM('lunas','belum') DEFAULT 'belum',
      catatan TEXT DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_student_bulan (student_id, bulan),
      KEY idx_tenant (tenant_id),
      KEY idx_bulan (bulan)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Add missing columns if not exists (for existing tables)
  try {
    await db.query(`ALTER TABLE billing_payment ADD COLUMN IF NOT EXISTS ransportasi DECIMAL(12,2) DEFAULT 0 AFTER spp_bulanan`);
    await db.query(`ALTER TABLE billing_payment ADD COLUMN IF NOT EXISTS subsidi DECIMAL(12,2) DEFAULT 0 AFTER ransportasi`);
    await db.query(`ALTER TABLE billing_payment ADD COLUMN IF NOT EXISTS catatan TEXT DEFAULT NULL AFTER status`);
    await db.query(`ALTER TABLE billing_payment ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at`);
    await db.query(`ALTER TABLE billing_payment ADD INDEX IF NOT EXISTS idx_bulan (bulan)`);
    await db.query(`ALTER TABLE billing_payment ADD COLUMN IF NOT EXISTS metode_pembayaran ENUM('tunai','transfer_pusat','gateway','belum_bayar') DEFAULT NULL AFTER status`);
    await db.query(`ALTER TABLE billing_payment ADD COLUMN IF NOT EXISTS tanggal_bayar DATE DEFAULT NULL AFTER metode_pembayaran`);
    await db.query(`ALTER TABLE billing_payment ADD COLUMN IF NOT EXISTS dibayar_oleh VARCHAR(100) DEFAULT NULL AFTER tanggal_bayar`);
    await db.query(`ALTER TABLE billing_payment ADD COLUMN IF NOT EXISTS catatan_pelunasan TEXT DEFAULT NULL AFTER dibayar_oleh`);
    await db.query(`ALTER TABLE billing_payment ADD COLUMN IF NOT EXISTS biaya_admin_va DECIMAL(12,2) DEFAULT 0 AFTER subsidi`);
  } catch (e) {
    // Columns might already exist
  }

  // Payment admin settings table (per siswa/guru - biaya admin VA BSI)
  // Tabel ini berbeda dari payment_settings (auto-billing config)
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

  // Backfill default payment admin settings untuk siswa
  try {
    await db.query(`
      INSERT IGNORE INTO payment_admin_settings (subject_type, subject_id, tenant_id, biaya_admin_va, keterangan)
      SELECT 'student', s.id, s.tenant_id, 2000.00, 'Default biaya admin VA BSI'
      FROM students s
      WHERE NOT EXISTS (
        SELECT 1 FROM payment_admin_settings ps
        WHERE ps.subject_type = 'student' AND ps.subject_id = s.id
      )
    `);
  } catch (e) {
    // Tabel belum ada, skip
  }

  // Backfill default payment admin settings untuk guru
  try {
    await db.query(`
      INSERT IGNORE INTO payment_admin_settings (subject_type, subject_id, tenant_id, biaya_admin_va, keterangan)
      SELECT 'teacher', t.id, NULL, 2000.00, 'Default biaya admin VA BSI'
      FROM teachers t
      WHERE NOT EXISTS (
        SELECT 1 FROM payment_admin_settings ps
        WHERE ps.subject_type = 'teacher' AND ps.subject_id = t.id
      )
    `);
  } catch (e) {
    // Tabel belum ada, skip
  }

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
    CREATE TABLE IF NOT EXISTS billing_payment_allocations (
      id BIGINT(20) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      billing_id BIGINT(20) NOT NULL,
      incoming_payment_id BIGINT(20) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_billing (billing_id),
      KEY idx_incoming (incoming_payment_id),
      CONSTRAINT fk_alloc_billing FOREIGN KEY (billing_id) REFERENCES billing_payment(id) ON DELETE CASCADE,
      CONSTRAINT fk_alloc_incoming FOREIGN KEY (incoming_payment_id) REFERENCES incoming_payments(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Tambah kolom tahun_masuk di students (4 digit tahun, format YYYY)
  try {
    await db.query(`ALTER TABLE students ADD COLUMN tahun_masuk VARCHAR(10) DEFAULT NULL`);
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

// Generate billing_payment untuk satu tenant, per siswa dari tahun_masuk -> now
async function generateBilling(tenantId, fallbackStart) {
  const end = currentMonth();
  const students = await db.query(
    `SELECT s.id, s.tenant_id, s.iuran_bulanan, s.ransportasi, s.tahun_masuk, s.subsidi, s.va_number
     FROM students s
     WHERE s.tenant_id = ? AND (s.status = 'active' OR s.status = 'aktif' OR s.status IS NULL)
       AND COALESCE(s.iuran_bulanan, 0) > 0`,
    [tenantId]
  );

  // Get global biaya admin VA setting (single row)
  const psResult = await db.query(
    `SELECT biaya_admin_va FROM payment_admin_settings WHERE subject_type = 'global' AND subject_id = 0 LIMIT 1`
  );
  const ps = Array.isArray(psResult) ? psResult[0] : psResult;
  const globalBiayaAdmin = ps ? (parseFloat(ps.biaya_admin_va) || 0) : 2000;

  let created = 0, skipped = 0;
  for (const s of students) {
    // Check for existing bills to determine the real start
    const existingBills = await db.query('SELECT MIN(bulan) as min_bulan FROM billing_payment WHERE student_id = ? LIMIT 1', [s.id]);
    const billsArr = Array.isArray(existingBills) ? existingBills : [existingBills];
    const minBulan = billsArr[0]?.min_bulan;

    // Start from earliest existing bill, tahun_masuk (YYYY), or fallbackStart
    let start = minBulan;
    if (!start && s.tahun_masuk && /^\d{4}$/.test(s.tahun_masuk)) {
      start = s.tahun_masuk + '-01'; // Start from Januari tahun masuk
    }
    if (!start) {
      start = fallbackStart || end;
    }

    const months = monthList(start, end);
    const spp = parseFloat(s.iuran_bulanan) || 0;
    const transport = parseFloat(s.ransportasi) || 0;
    const subsidi = parseFloat(s.subsidi) || 0;
    // Biaya admin hanya untuk siswa yang punya VA
    const biayaAdmin = s.va_number ? globalBiayaAdmin : 0;
    // Total tagihan: SPP + Transport - Subsidi + Biaya Admin
    const totalTagihan = Math.max(0, spp + transport - subsidi + biayaAdmin);

    for (const m of months) {
      const existingResult = await db.query('SELECT id, bulan, status FROM billing_payment WHERE student_id = ? AND bulan = ?', [s.id, m]);
      const existing = Array.isArray(existingResult) ? existingResult[0] : existingResult;
      if (existing) {
        const isLunas = existing.status === 'lunas';
        if (isLunas) {
          skipped++;
          continue;
        }
        await db.query(
          'UPDATE billing_payment SET spp_bulanan = ?, ransportasi = ?, subsidi = ?, biaya_admin_va = ?, transaksi = 0, keterangan_spp = ?, status = "belum" WHERE id = ?',
          [spp, transport, subsidi, biayaAdmin, totalTagihan, existing.id]
        );
        created++;
      } else {
        await db.query(
          'INSERT INTO billing_payment (tenant_id, student_id, spp_bulanan, ransportasi, subsidi, biaya_admin_va, bulan, transaksi, keterangan_spp, status) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, "belum")',
          [s.tenant_id, s.id, spp, transport, subsidi, biayaAdmin, m, totalTagihan]
        );
        created++;
      }
    }
  }
  return { created, skipped, end };
}

// Hitung ulang keterangan_spp + saldo untuk 1 siswa
// Model: semua pembayaran dikumpulkan, lalu dialokasikan ke billing tertua dulu sampai lunas, sisanya jadi saldo positif
async function recalcStudent(studentId) {
  const [student] = await db.query('SELECT id, tenant_id FROM students WHERE id = ?', [studentId]);
  if (!student) return null;

  const bills = await db.query('SELECT * FROM billing_payment WHERE student_id = ? ORDER BY bulan ASC', [studentId]);
  const inc = await db.query(
    "SELECT id, periode, SUM(total_amount) as total FROM incoming_payments WHERE matched_student_id = ? AND status IN ('Success', 'SUCCESS', 'success', 'Sukses', 'Settlement', 'Paid', 'PAID', 'Referral') GROUP BY periode, id",
    [studentId]
  );

  const incByPeriode = {};
  inc.forEach(r => {
    if (!incByPeriode[r.periode]) incByPeriode[r.periode] = [];
    incByPeriode[r.periode].push({ id: r.id, total: parseFloat(r.total) || 0 });
  });

  await db.query('DELETE FROM billing_payment_allocations WHERE billing_id IN (SELECT id FROM billing_payment WHERE student_id = ?)', [studentId]);

  let pool = 0;
  let remainingKeterangan = 0;

  for (const key of Object.keys(incByPeriode)) {
    pool += incByPeriode[key].reduce((s, r) => s + r.total, 0);
  }

  for (const b of bills) {
    const spp = parseFloat(b.spp_bulanan) || 0;
    const transport = parseFloat(b.ransportasi) || 0;
    const subsidi = parseFloat(b.subsidi) || 0;
    const adminVa = parseFloat(b.biaya_admin_va) || 0;
    const totalTagihan = spp + transport - subsidi + adminVa;

    let keterangan, status;
    if (pool >= totalTagihan) {
      pool -= totalTagihan;
      keterangan = 0;
      status = 'lunas';
      remainingKeterangan = 0;
    } else {
      keterangan = totalTagihan - pool;
      status = 'belum';
      remainingKeterangan += keterangan;
      pool = 0;
    }

    const bulanTotal = incByPeriode[b.bulan] ? incByPeriode[b.bulan].reduce((s, r) => s + r.total, 0) : 0;
    await db.query(
      'UPDATE billing_payment SET transaksi = ?, keterangan_spp = ?, status = ? WHERE id = ?',
      [bulanTotal, keterangan, status, b.id]
    );

    if (status === 'lunas' && incByPeriode[b.bulan]) {
      let allocated = totalTagihan;
      for (const r of incByPeriode[b.bulan]) {
        if (allocated <= 0) break;
        const use = Math.min(r.total, allocated);
        await db.query(
          'INSERT INTO billing_payment_allocations (billing_id, incoming_payment_id, amount) VALUES (?, ?, ?)',
          [b.id, r.id, use]
        );
        r.total -= use;
        allocated -= use;
      }
    }
  }

  const saldo = pool - remainingKeterangan;
  await db.query(
    `INSERT INTO saldo_siswa (student_id, tenant_id, saldo) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE saldo = VALUES(saldo), tenant_id = VALUES(tenant_id)`,
    [studentId, student.tenant_id, saldo]
  );
  return { studentId, saldo, pool, remainingKeterangan };
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