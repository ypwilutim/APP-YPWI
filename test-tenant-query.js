const db = require('./db');

async function test() {
  try {
    const rows = await db.query(
      'SELECT tenant_id, nama_sekolah, nomor_rekening, bank_account_number, bank_account_name FROM tenants WHERE tipe_unit = "sekolah" LIMIT 5'
    );
    console.log('Tenants with account info:');
    rows.forEach(r => console.log(`  ${r.tenant_id}: ${r.nama_sekolah} | rek="${r.nomor_rekening || ''}" | bank="${r.bank_account_number || ''}"`));

    const sditir = await db.query(
      'SELECT tenant_id, nama_sekolah, nomor_rekening, bank_account_number, bank_account_name FROM tenants WHERE tenant_id = ?',
      ['SDITIR']
    );
    console.log('\nSDITIR:', JSON.stringify(sditir));

    process.exit(0);
  } catch(e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

test();
