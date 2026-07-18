require('../db').initializeDatabase().then(async () => {
  const db = require('../db');
  
  // Insert April billing manually
  await db.query('INSERT IGNORE INTO billing_payment (tenant_id, student_id, spp_bulanan, bulan, transaksi, keterangan_spp, status) VALUES (?, ?, ?, ?, 0, ?, "belum")', ['SDITIR', 588, 500000, '2026-04', 500000]);
  
  // Recalc student
  const billing = require('../src/utils/billing');
  await billing.recalcStudent(588);
  
  // Check result
  const bill = await db.query('SELECT bulan, spp_bulanan, transaksi, keterangan_spp, status FROM billing_payment WHERE student_id = 588 ORDER BY bulan DESC');
  console.log('Billing:', bill);
  
  const saldo = await db.query('SELECT saldo FROM saldo_siswa WHERE student_id = 588');
  console.log('Saldo:', saldo);
  
  process.exit(0);
});