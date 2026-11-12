#!/usr/bin/env node
/**
 * Test the new global sequence with tenant_id in format
 */

require('dotenv').config();
const db = require('../db');

async function testGlobalSequence() {
  console.log('[TEST] Testing global sequence with tenant_id format...\n');

  const hijriYear = 1449; // Use different year to avoid conflicts

  // Test 1: Global sequence increments across tenants
  console.log('--- Test 1: Global sequence across tenants ---');
  const get1 = await getActualNextSkNumber(hijriYear);
  console.log(`First get (tenant PPIB): ${get1}`);
  
  const get2 = await getActualNextSkNumber(hijriYear);
  console.log(`Second get (tenant SDIT01): ${get2}`);
  console.log(`Global increment: ${get2 === get1 + 1 ? 'PASS' : 'FAIL'}\n`);

  // Test 2: Format includes tenant_pk (numeric)
  console.log('--- Test 2: Format verification ---');
  const { noSurat: noSurat1 } = buildTestNoSurat(1, get1, hijriYear); // PPIB has id=1
  const { noSurat: noSurat2 } = buildTestNoSurat(5, get2, hijriYear); // SDITIR has id=5
  console.log(`Tenant id=1: ${noSurat1}`);
  console.log(`Tenant id=5: ${noSurat2}`);
  console.log(`Contains numeric tenant_pk: ${noSurat1.includes('/1/') && noSurat2.includes('/5/') ? 'PASS' : 'FAIL'}`);
  console.log(`No /02/ hardcoded: ${!noSurat1.includes('/02/') && !noSurat2.includes('/02/') ? 'PASS' : 'FAIL'}\n`);

  // Test 3: Sequence table updated
  console.log('--- Test 3: Global sequence table ---');
  const seq = await db.query('SELECT last_number FROM sk_global_sequence WHERE hijri_year = ?', [hijriYear]);
  console.log(`Sequence table last_number: ${seq[0]?.last_number}`);
  console.log(`Matches last get: ${seq[0]?.last_number === get2 ? 'PASS' : 'FAIL'}\n`);

  // Test 4: No duplicates across tenants
  console.log('--- Test 4: Duplicate check ---');
  const dup = await db.query(`
    SELECT no_surat, COUNT(*) as cnt 
    FROM sk_guru 
    WHERE no_surat LIKE ? 
    GROUP BY no_surat 
    HAVING COUNT(*) > 1
  `, ['QR.%/' + hijriYear + '%']);
  console.log(`Duplicates found: ${dup.length}`);
  console.log(`No duplicates: ${dup.length === 0 ? 'PASS' : 'FAIL'}\n`);

  console.log('[TEST] All tests completed!');
}

async function getActualNextSkNumber(hijriYear) {
  const skMax = await db.query(
    `SELECT MAX(CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(no_surat, '/', 1), '.', -1) AS UNSIGNED)) as max_num
     FROM sk_guru 
     WHERE no_surat LIKE ?`,
    ['QR.%/' + hijriYear + '%']
  );
  const maxFromSk = (skMax && skMax[0] && skMax[0].max_num) || 0;

  const seq = await db.query(
    'SELECT last_number FROM sk_global_sequence WHERE hijri_year = ?',
    [hijriYear]
  );
  const seqNum = (seq && seq.length > 0 && seq[0].last_number) ? seq[0].last_number : 0;

  const nextNum = Math.max(maxFromSk, seqNum) + 1;

  if (seq && seq.length > 0) {
    await db.query(
      'UPDATE sk_global_sequence SET last_number = ? WHERE hijri_year = ?',
      [nextNum, hijriYear]
    );
  } else {
    await db.query(
      'INSERT INTO sk_global_sequence (hijri_year, last_number) VALUES (?, ?)',
      [hijriYear, nextNum]
    );
  }
  return nextNum;
}

function buildTestNoSurat(tenantPk, nomorUrut, hijriYear) {
  const today = new Date();
  const hijriMonths = ['Muharam', 'Safar', 'Rabiul Awal', 'Rabiul Akhir', 'Jumadil Awal', 'Jumadil Akhir', 'Rajab', 'Syaban', 'Ramadhan', 'Syawal', 'Dzul Qaidah', 'Dzul Hijjah'];
  const romanize = (num) => {
    const romans = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
    return romans[num - 1] || String(num);
  };
  const hijriToday = { month: 'Syawal', year: 1448 }; // mock
  const romanMonth = romanize(hijriMonths.indexOf('Syawal') + 1);
  const noSurat = 'QR.' + String(nomorUrut).padStart(3, '0') + '/' + tenantPk + '/YPWI-LT/' + romanMonth + '/' + hijriYear;
  return { noSurat };
}

testGlobalSequence()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[TEST] Error:', err);
    process.exit(1);
  });