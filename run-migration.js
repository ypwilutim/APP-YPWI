#!/usr/bin/env node
// Manual migration runner - run without server restart
// Usage: node run-migration.js [migration-file.sql]

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const db = require('./db');

async function runMigration(filename) {
  const migrationsDir = path.join(process.cwd(), 'migrations');
  const filePath = path.join(migrationsDir, filename);
  
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }

  // Ensure migrations_history table exists
  await db.query(`
    CREATE TABLE IF NOT EXISTS migrations_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Check if already executed
  const executed = await db.query('SELECT filename FROM migrations_history WHERE filename = ?', [filename]);
  if (executed.length > 0) {
    console.log(`⏭️  Already executed: ${filename}`);
    return;
  }

  // Read and execute
  const sql = fs.readFileSync(filePath, 'utf8');
  console.log(`▶️  Executing: ${filename}`);
  
  try {
    await db.runMultiple(sql);
    await db.query('INSERT INTO migrations_history (filename) VALUES (?)', [filename]);
    console.log(`✅ Completed: ${filename}`);
  } catch (e) {
    console.error(`❌ Failed: ${filename}`, e.message);
    process.exit(1);
  }
}

async function runAll() {
  const migrationsDir = path.join(process.cwd(), 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  // Ensure history table
  await db.query(`
    CREATE TABLE IF NOT EXISTS migrations_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const executed = await db.query('SELECT filename FROM migrations_history');
  const executedSet = new Set((executed || []).map(r => r.filename));

  for (const file of files) {
    if (executedSet.has(file)) {
      console.log(`⏭️  Skipping (already done): ${file}`);
      continue;
    }
    await runMigration(file);
  }
  console.log('\n✅ All migrations completed');
}

// Run
const arg = process.argv[2];
if (arg) {
  runMigration(arg).then(() => process.exit(0));
} else {
  runAll().then(() => process.exit(0));
}