// Simple migration script for KAFALAH level column and override_note
const db = require('./db');

async function runMigration() {
  await db.initializeDatabase();
  
  console.log('Running KAFALAH migration...');
  
  // 1. Add level column to kafalah_settings if not exists
  try {
    await db.query(`ALTER TABLE kafalah_settings ADD COLUMN level ENUM('global','school') DEFAULT 'global' AFTER tenant_id`);
    console.log('Added level column to kafalah_settings');
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME') {
      console.log('level column already exists in kafalah_settings');
    } else {
      console.log('Error adding level column:', e.message);
    }
  }
  
  // 2. Add override_note column to kafalah_payroll if not exists
  try {
    await db.query(`ALTER TABLE kafalah_payroll ADD COLUMN override_note TEXT DEFAULT NULL COMMENT 'JSON/notes: which components used custom override' AFTER base_mode_used`);
    console.log('Added override_note column to kafalah_payroll');
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME') {
      console.log('override_note column already exists in kafalah_payroll');
    } else {
      console.log('Error adding override_note column:', e.message);
    }
  }
  
  // 3. Seed default level for existing schools
  try {
    await db.query(`UPDATE kafalah_settings SET level = 'global' WHERE level IS NULL`);
    console.log('Seeded default level for existing schools');
  } catch (e) {
    console.log('Error seeding default level:', e.message);
  }
  
  // 4. Add index for level column
  try {
    const [idx] = await db.query(`SELECT COUNT(*) as cnt FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kafalah_settings' AND INDEX_NAME = 'idx_level'`);
    if (idx.cnt === 0) {
      await db.query(`ALTER TABLE kafalah_settings ADD INDEX idx_level (level)`);
      console.log('Added idx_level index');
    } else {
      console.log('idx_level index already exists');
    }
  } catch (e) {
    console.log('Error adding index:', e.message);
  }
  
  console.log('Migration completed!');
  process.exit(0);
}

runMigration().catch(e => { console.error(e); process.exit(1); });