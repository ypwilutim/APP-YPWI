require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

(async () => {
  const NEW_PASSWORD = 'Ypwilutim13';
  const hash = await bcrypt.hash(NEW_PASSWORD, 10);
  console.log('Generated bcrypt hash:', hash);

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  const [admins] = await conn.execute(
    "SELECT id, username, role FROM users WHERE role IN ('admin','super_admin') ORDER BY id"
  );
  console.log('Admin users found:', admins);

  const [r] = await conn.execute(
    "UPDATE users SET password = ?, is_default_password = 0, updated_at = NOW() WHERE role IN ('admin','super_admin')",
    [hash]
  );
  console.log('Rows updated:', r.affectedRows);

  const [verify] = await conn.execute(
    "SELECT id, username, role, LEFT(password, 7) AS hash_prefix FROM users WHERE role IN ('admin','super_admin')"
  );
  console.log('After update:', verify);

  await conn.end();
  console.log('Done.');
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});