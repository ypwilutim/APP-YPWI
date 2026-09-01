require('dotenv').config();
const db = require('./db');
(async () => {
  try {
    const cols = await db.query("SHOW COLUMNS FROM teacher_assignments");
    console.log("teacher_assignments columns:", cols.map(c => c.Field));
    const a = await db.query("SELECT ta.tenant_id AS tid, ta.jabatan_di_unit AS jab, t.nama_sekolah AS nm FROM teacher_assignments ta JOIN tenants t ON ta.tenant_id = t.tenant_id WHERE ta.teacher_id = 95");
    console.log("guru_id=95 assignments:", JSON.stringify(a, null, 2));
    const t = await db.query("SELECT id, nama, status_aktif FROM teachers WHERE id = 95");
    console.log("teacher 95:", JSON.stringify(t));
    // check xendit_invoices columns
    const xi = await db.query("SHOW COLUMNS FROM xendit_invoices");
    console.log("xendit_invoices columns:", xi.map(c => c.Field));
  } catch (e) {
    console.error("ERR", e.message);
  } finally {
    process.exit(0);
  }
})();
