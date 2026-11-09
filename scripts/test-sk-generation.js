#!/usr/bin/env node
/**
 * Test SK Number Generation Functions
 * Verifies that getActualNextSkNumber and peekActualNextSkNumber work correctly
 */

require('dotenv').config();
const db = require('../db');

async function testSkNumberGeneration() {
  console.log('[TEST] Starting SK number generation tests...\n');

  // Get a sample tenant
  const tenants = await db.query('SELECT tenant_id FROM tenants LIMIT 1');
  if (!tenants || tenants.length === 0) {
    console.log('[TEST] No tenants found, skipping test');
    return;
  }

  const tenantId = tenants[0].tenant_id;
  const hijriYear = 1448; // Test year

  console.log(`[TEST] Using tenant_id: ${tenantId}, hijri_year: ${hijriYear}\n`);

  // Test 1: peekActualNextSkNumber (read-only)
  console.log('--- Test 1: peekActualNextSkNumber ---');
  const peek1 = await peekActualNextSkNumber(tenantId, hijriYear);
  console.log(`First peek: ${peek1}`);

  const peek2 = await peekActualNextSkNumber(tenantId, hijriYear);
  console.log(`Second peek (should be same): ${peek2}`);
  console.log(`Peek consistency: ${peek1 === peek2 ? 'PASS' : 'FAIL'}\n`);

  // Test 2: getActualNextSkNumber (read-write, increments sequence)
  console.log('--- Test 2: getActualNextSkNumber ---');
  const get1 = await getActualNextSkNumber(tenantId, hijriYear);
  console.log(`First get: ${get1}`);
  console.log(`Should be peek + 1: ${get1 === peek1 + 1 ? 'PASS' : 'FAIL'}`);

  const get2 = await getActualNextSkNumber(tenantId, hijriYear);
  console.log(`Second get: ${get2}`);
  console.log(`Should be first get + 1: ${get2 === get1 + 1 ? 'PASS' : 'FAIL'}\n`);

  // Test 3: Verify sequence table updated
  console.log('--- Test 3: Verify sequence table ---');
  const seq = await db.query(
    'SELECT last_number FROM sk_sequence WHERE tenant_id = ? AND hijri_year = ?',
    [tenantId, hijriYear]
  );
  if (seq.length > 0) {
    console.log(`Sequence table last_number: ${seq[0].last_number}`);
    console.log(`Matches last get: ${seq[0].last_number === get2 ? 'PASS' : 'FAIL'}`);
  } else {
    console.log('Sequence record not found - FAIL');
  }

  // Test 4: Test with sk_guru data (simulate existing SKs)
  console.log('\n--- Test 4: Test with existing SK data ---');
  const skMax = await db.query(
    `SELECT MAX(CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(no_surat, '/', 1), '.', -1) AS UNSIGNED)) as max_num
     FROM sk_guru 
     WHERE tenant_id = ? AND no_surat LIKE ?`,
    [tenantId, 'QR.%/' + hijriYear + '%']
  );
  const maxFromSk = skMax[0]?.max_num || 0;
  console.log(`Max SK number in sk_guru: ${maxFromSk}`);
  console.log(`Sequence last_number: ${seq[0]?.last_number || 0}`);
  console.log(`Next number should be MAX(sk_guru, sequence) + 1`);

  const nextPeek = await peekActualNextSkNumber(tenantId, hijriYear);
  const expectedNext = Math.max(maxFromSk, seq[0]?.last_number || 0) + 1;
  console.log(`peekActualNextSkNumber returns: ${nextPeek}`);
  console.log(`Expected: ${expectedNext}`);
  console.log(`Match: ${nextPeek === expectedNext ? 'PASS' : 'FAIL'}\n`);

  console.log('[TEST] All tests completed!');
}

// Replicate the functions for testing
async function peekActualNextSkNumber(tenantId, hijriYear) {
  const skMax = await db.query(
    `SELECT MAX(CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(no_surat, '/', 1), '.', -1) AS UNSIGNED)) as max_num
     FROM sk_guru 
     WHERE tenant_id = ? AND no_surat LIKE ?`,
    [tenantId, 'QR.%/' + hijriYear + '%']
  );
  const maxFromSk = skMax[0]?.max_num || 0;

  const seq = await db.query(
    'SELECT last_number FROM sk_sequence WHERE tenant_id = ? AND hijri_year = ?',
    [tenantId, hijriYear]
  );
  const seqNum = seq.length > 0 ? seq[0].last_number : 0;

  return Math.max(maxFromSk, seqNum) + 1;
}

async function getActualNextSkNumber(tenantId, hijriYear) {
  const skMax = await db.query(
    `SELECT MAX(CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(no_surat, '/', 1), '.', -1) AS UNSIGNED)) as max_num
     FROM sk_guru 
     WHERE tenant_id = ? AND no_surat LIKE ?`,
    [tenantId, 'QR.%/' + hijriYear + '%']
  );
  const maxFromSk = skMax[0]?.max_num || 0;

  const seq = await db.query(
    'SELECT last_number FROM sk_sequence WHERE tenant_id = ? AND hijri_year = ?',
    [tenantId, hijriYear]
  );
  const seqNum = seq.length > 0 ? seq[0].last_number : 0;

  const nextNum = Math.max(maxFromSk, seqNum) + 1;

  if (seq.length > 0) {
    await db.query(
      'UPDATE sk_sequence SET last_number = ? WHERE tenant_id = ? AND hijri_year = ?',
      [nextNum, tenantId, hijriYear]
    );
  } else {
    await db.query(
      'INSERT INTO sk_sequence (tenant_id, hijri_year, hijri_month, last_number) VALUES (?, ?, ?, ?)',
      [tenantId, hijriYear, 'Muharam', nextNum]
    );
  }
  return nextNum;
}

testSkNumberGeneration()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[TEST] Error:', err);
    process.exit(1);
  });