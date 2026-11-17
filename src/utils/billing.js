const db = require('../../db');

async function ensureBillingTables() {
  await db.query(`DROP TABLE IF EXISTS payment_bsi_transactions`);
  await db.query(`
    CREATE TABLE payment_bsi_transactions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT DEFAULT NULL,
      transaction_id VARCHAR(100) UNIQUE NOT NULL,
      
      -- Hasil pemecahan Source Account (Nomor & Nama Pengirim)
      source_account VARCHAR(50),
      sender_name VARCHAR(150),
      
      -- Hasil pemecahan Beneficiary Account (Nomor VA & Nama Pemilik VA)
      beneficiary_va VARCHAR(50),
      va_name VARCHAR(150),
      
      -- Detail Transaksi & BSI
      billing_number VARCHAR(50),
      additional_info TEXT,
      remarks TEXT,
      transaction_date VARCHAR(50),
      periode VARCHAR(20),
      amount DECIMAL(15,2) DEFAULT 0,
      channel VARCHAR(100),
      transfer_type VARCHAR(50),
      status VARCHAR(30),
      
      -- Relasi & Status Sistem
      matched_student_id INT DEFAULT NULL,
      is_matched TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      
      INDEX idx_tenant (tenant_id),
      INDEX idx_transaction (transaction_id),
      INDEX idx_beneficiary_va (beneficiary_va),
      INDEX idx_matched_student (matched_student_id)
    )
  `);

  await db.query(`DROP TABLE IF EXISTS incoming_payments`);
  await db.query(`
    CREATE TABLE incoming_payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      transaction_id VARCHAR(100) UNIQUE,
      beneficiary_va VARCHAR(50),
      matched_student_id INT,
      periode VARCHAR(20),
      total_amount DECIMAL(12,2),
      channel VARCHAR(100),
      status VARCHAR(20),
      remarks TEXT,
      source_account VARCHAR(50),
      sender_name VARCHAR(100),
      va_name VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_matched_student (matched_student_id),
      INDEX idx_transaction (transaction_id),
      INDEX idx_beneficiary_va (beneficiary_va)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS saldo_siswa (
      student_id INT PRIMARY KEY,
      saldo DECIMAL(12,2) DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

function extractVA(str) {
  if (!str) return null;
  const digits = String(str).replace(/[^0-9]/g, '');
  return digits.length > 0 ? digits : null;
}

async function insertIncoming(rec) {
  const transactionId = rec['Transaction ID#'] || rec.transaction_id || '';
  const beneficiaryAccount = rec['Beneficiary Account'] || rec.beneficiary_account || rec['Beneficiary Account'] || '';
  const va = extractVA(beneficiaryAccount);
  
  if (!va) {
    return { duplicate: false, matchedStudentId: null };
  }

  let matchedStudentId = null;
  const studentResult = await db.query(
    'SELECT id FROM students WHERE REPLACE(REPLACE(REPLACE(va_number, "BSI ", ""), " ", ""), "-", "") = ? LIMIT 1',
    [va]
  );
  if (studentResult.length > 0) {
    matchedStudentId = studentResult[0].id;
  }

  const periode = rec['Transaction Date-Time'] || rec.tanggal_transaksi || '';
  let periodeFormatted = '';
  if (periode) {
    const match = periode.match(/(\d{2})\s+(\w{3})\s+(\d{4})/);
    if (match) {
      const monthMap = { 'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'Mei': '05', 'Jun': '06', 
                        'Jul': '07', 'Agu': '08', 'Sep': '09', 'Okt': '10', 'Nov': '11', 'Des': '12' };
      periodeFormatted = `${match[3]}-${monthMap[match[2]] || '01'}`;
    } else {
      const match2 = periode.match(/(\d{4})-(\d{2})/);
      if (match2) periodeFormatted = `${match2[1]}-${match2[2]}`;
    }
  }

  const totalAmount = parseFloat(rec['Total Amount'] || rec.nominal || 0);
  const channel = rec['Channel'] || rec.channel || '';
  const status = rec['Status'] || rec.status_bank || '';
  const remarks = rec['Remarks'] || rec.remarks || '';
  const sourceAccount = rec['Source Account'] || rec.source_account_no || '';
  const senderName = rec['Nama Pengirim'] || rec.nama_pengirim || '';
  const vaName = rec['Nama VA Siswa'] || rec.nama_va_siswa || '';
  const billingNumber = rec['Billing Number'] || rec.billing_number || '';
  const additionalInfo = [
    rec['Source Additional Info(1)'] || '',
    rec['Source Additional Info(2)'] || '',
    rec['Source Additional Info(3)'] || '',
    rec['Source Additional Info(4)'] || '',
    rec['Source Additional Info(5)'] || '',
    rec['Source Additional Info(6)'] || '',
    rec['Source Additional Info(7)'] || '',
    rec['Source Additional Info(8)'] || '',
    rec['Source Additional Info(9)'] || '',
    rec['Beneficiary Additional Info(1)'] || '',
    rec['Beneficiary Additional Info(2)'] || '',
    rec['Beneficiary Additional Info(3)'] || '',
    rec['Beneficiary Additional Info(4)'] || '',
    rec['Beneficiary Additional Info(5)'] || '',
    rec['Beneficiary Additional Info(6)'] || '',
    rec['Beneficiary Additional Info(7)'] || '',
    rec['Beneficiary Additional Info(8)'] || '',
    rec['Beneficiary Additional Info(9)'] || ''
  ].filter(x => x).join(' | ');
  const transferType = rec['Transfer Type'] || rec.transfer_type || '';

  // Insert raw transaction to payment_bsi_transactions (always saved)
  await db.query(
    `INSERT INTO payment_bsi_transactions 
     (tenant_id, transaction_id, source_account, sender_name, beneficiary_va, va_name,
      billing_number, additional_info, remarks, transaction_date, periode, amount,
      channel, transfer_type, status, matched_student_id, is_matched)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE 
       tenant_id=VALUES(tenant_id), source_account=VALUES(source_account), sender_name=VALUES(sender_name),
       beneficiary_va=VALUES(beneficiary_va), va_name=VALUES(va_name),
       billing_number=VALUES(billing_number), additional_info=VALUES(additional_info), remarks=VALUES(remarks),
       transaction_date=VALUES(transaction_date), periode=VALUES(periode), amount=VALUES(amount),
       channel=VALUES(channel), transfer_type=VALUES(transfer_type), status=VALUES(status),
       matched_student_id=VALUES(matched_student_id), is_matched=VALUES(is_matched)`,
    [null, transactionId, sourceAccount, senderName, va, vaName,
     billingNumber, additionalInfo, remarks, periode, periodeFormatted, totalAmount,
     channel, transferType, status, matchedStudentId, matchedStudentId ? 1 : 0]
  );

  // Check duplicate for incoming_payments (only insert if matched student)
  const existing = await db.query(
    'SELECT id FROM incoming_payments WHERE transaction_id = ? LIMIT 1',
    [transactionId]
  );
  if (existing.length > 0) {
    return { duplicate: true, matchedStudentId };
  }

  if (matchedStudentId) {
    await db.query(
      `INSERT INTO incoming_payments 
       (transaction_id, beneficiary_va, matched_student_id, periode, total_amount, channel, status, remarks, source_account, sender_name, va_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [transactionId, va, matchedStudentId, periodeFormatted, totalAmount, channel, status, remarks, sourceAccount, senderName, vaName]
    );
  }

  return { duplicate: false, matchedStudentId };
}

async function recalcStudent(studentId) {
  const billingPayments = await db.query(
    `SELECT 
       COALESCE(SUM(CASE WHEN status = 'lunas' THEN transaksi ELSE 0 END), 0) as total_lunas,
       COALESCE(SUM(CASE WHEN status = 'belum' THEN keterangan_spp ELSE 0 END), 0) as total_belum
     FROM billing_payment 
     WHERE student_id = ?`,
    [studentId]
  );

  const incomingPayments = await db.query(
    `SELECT COALESCE(SUM(total_amount), 0) as total_incoming
     FROM incoming_payments 
     WHERE matched_student_id = ?`,
    [studentId]
  );

  const bp = billingPayments[0] || { total_lunas: 0, total_belum: 0 };
  const ip = incomingPayments[0] || { total_incoming: 0 };

  const saldo = parseFloat(bp.total_lunas) + parseFloat(ip.total_incoming) - parseFloat(bp.total_belum);

  await db.query(
    `INSERT INTO saldo_siswa (student_id, saldo) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE saldo = VALUES(saldo)`,
    [studentId, saldo]
  );
}

module.exports = {
  ensureBillingTables,
  extractVA,
  insertIncoming,
  recalcStudent
};