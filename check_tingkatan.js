const db = require('./db');

(async () => {
  const r = await db.query("SELECT id, tenant_id, nama_kelas, tingkatan FROM classes WHERE tenant_id LIKE 'SDIT%' OR tenant_id LIKE 'TKIT%' OR tenant_id LIKE 'SMPIT%' OR tenant_id LIKE 'SMAIT%' LIMIT 30");
  console.table(r);
})();