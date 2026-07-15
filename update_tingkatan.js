const db = require('./db');

(async () => {
  await db.query("UPDATE classes SET tingkatan = NULL");
  
  // TKIT: A/B
  await db.query("UPDATE classes SET tingkatan = 'A' WHERE tenant_id LIKE 'TKIT%' AND LEFT(nama_kelas, 1) = 'A'");
  await db.query("UPDATE classes SET tingkatan = 'B' WHERE tenant_id LIKE 'TKIT%' AND LEFT(nama_kelas, 1) = 'B'");
  
  // SDIT/SMPIT/SMAIT/PPTQ: ambil nomor awal nama_kelas
  const tenants = ['SDIT', 'SDITIR', 'SDITWI', 'SMPIT', 'SMAIT', 'PPTQ'];
  for (const tid of tenants) {
    await db.query(`UPDATE classes SET tingkatan = SUBSTRING(nama_kelas, 1, 2) WHERE tenant_id LIKE '${tid}%' AND nama_kelas REGEXP '^[0-9]' AND tingkatan IS NULL`);
    await db.query(`UPDATE classes SET tingkatan = SUBSTRING(nama_kelas, 1, 1) WHERE tenant_id LIKE '${tid}%' AND nama_kelas REGEXP '^[0-9][A-Z]' AND tingkatan IS NULL`);
  }
  
  console.log('Done');
  process.exit(0);
})();