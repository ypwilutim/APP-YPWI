#!/usr/bin/env node
/**
 * Cleanup Duplicate SK Numbers
 * 
 * Identifies and removes duplicate SK entries based on (tenant_id, no_surat)
 * Keeps the earliest created SK (by created_at) for each duplicate group.
 * 
 * Run BEFORE applying the unique constraint migration.
 */

require('dotenv').config();
const db = require('../db');

async function cleanupDuplicates() {
  console.log('[CLEANUP] Starting duplicate SK cleanup...\n');

  // Find all duplicate groups
  const duplicates = await db.query(`
    SELECT tenant_id, no_surat, COUNT(*) as cnt, GROUP_CONCAT(id ORDER BY created_at) as ids
    FROM sk_guru
    WHERE no_surat IS NOT NULL AND no_surat != ''
    GROUP BY tenant_id, no_surat
    HAVING COUNT(*) > 1
  `);

  if (duplicates.length === 0) {
    console.log('[CLEANUP] No duplicates found. Database is clean.');
    return;
  }

  console.log(`[CLEANUP] Found ${duplicates.length} duplicate groups:\n`);

  let totalToDelete = 0;
  let totalKept = 0;

  for (const dup of duplicates) {
    const ids = dup.ids.split(',').map(id => parseInt(id, 10));
    const keepId = ids[0]; // Keep the earliest (first created)
    const deleteIds = ids.slice(1);
    
    console.log(`  Tenant: ${dup.tenant_id}, No Surat: ${dup.no_surat}`);
    console.log(`    Keep: SK #${keepId}`);
    console.log(`    Delete: ${deleteIds.join(', ')} (${deleteIds.length} records)`);

    // Delete duplicates
    if (deleteIds.length > 0) {
      const placeholders = deleteIds.map(() => '?').join(',');
      await db.query(
        `DELETE FROM sk_guru WHERE id IN (${placeholders})`,
        deleteIds
      );
      totalToDelete += deleteIds.length;
    }
    totalKept++;
  }

  console.log(`\n[CLEANUP] Summary:`);
  console.log(`  Groups processed: ${duplicates.length}`);
  console.log(`  Records kept: ${totalKept}`);
  console.log(`  Records deleted: ${totalToDelete}`);

  // After cleanup, reset sequences to match actual max numbers
  console.log('\n[CLEANUP] Resetting sk_sequence to match actual max numbers...');
  
  const sequenceUpdates = await db.query(`
    SELECT 
      sg.tenant_id,
      YEAR(STR_TO_DATE(sg.bh, '%d %M %Y H')) as hijri_year,
      MAX(CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(sg.no_surat, '/', 1), '.', -1) AS UNSIGNED)) as max_num
    FROM sk_guru sg
    WHERE sg.no_surat IS NOT NULL AND sg.no_surat != ''
      AND sg.bh IS NOT NULL AND sg.bh != ''
    GROUP BY sg.tenant_id, hijri_year
  `);

  for (const seq of sequenceUpdates) {
    await db.query(
      `INSERT INTO sk_sequence (tenant_id, hijri_year, hijri_month, last_number)
       VALUES (?, ?, 'Muharam', ?)
       ON DUPLICATE KEY UPDATE last_number = ?`,
      [seq.tenant_id, seq.hijri_year, seq.max_num, seq.max_num]
    );
    console.log(`  Tenant ${seq.tenant_id}, Year ${seq.hijri_year}: sequence = ${seq.max_num}`);
  }

  console.log('\n[CLEANUP] Done. You can now apply the unique constraint migration.');
}

cleanupDuplicates()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[CLEANUP] Error:', err);
    process.exit(1);
  });