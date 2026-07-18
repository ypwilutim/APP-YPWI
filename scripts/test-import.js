require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function test() {
  const rec1 = {
    'Transaction ID#': 'VA2604161058280000004C',
    'Source Account': '8322311234567890 (IDR) / YAYASAN PESANTREN WAHDAH ISLAMIYAH',
    'Beneficiary Account': 'IDR1729400010001 (IDR) / CA Bulk Multi Service',
    'Billing Number': "'-",
    'Source Additional Info(1)': 'Label = Pembayaran - Value = SPP Bulan April 2026',
    'Source Additional Info(2)': "'-",
    'Source Additional Info(3)': "'-",
    'Source Additional Info(4)': "'-",
    'Source Additional Info(5)': "'-",
    'Source Additional Info(6)': "'-",
    'Source Additional Info(7)': "'-",
    'Source Additional Info(8)': "'-",
    'Source Additional Info(9)': "'-",
    'Beneficiary Additional Info(1)': "'-",
    'Beneficiary Additional Info(2)': "'-",
    'Beneficiary Additional Info(3)': "'-",
    'Beneficiary Additional Info(4)': "'-",
    'Beneficiary Additional Info(5)': "'-",
    'Beneficiary Additional Info(6)': "'-",
    'Beneficiary Additional Info(7)': "'-",
    'Beneficiary Additional Info(8)': "'-",
    'Beneficiary Additional Info(9)': "'-",
    'Remarks': '8322311234567890.VA2604161058280000004C.VA Credit.Credit Fee',
    'Transaction Date-Time': '16 Apr 2026 10:58',
    'Total Amount': 'IDR 2.000,00',
    'Channel': 'Mobile Banking (Super Apps)',
    'Transfer Type': 'PB',
    'Status': 'Success'
  };

  const rec2 = {
    'Transaction ID#': 'VA260416105828000000LG',
    'Source Account': '9110721530 (IDR) / AKBAR IRWANSYA',
    'Beneficiary Account': '8322317710469959 (IDR) / SPP Bulan April 2026',
    'Billing Number': "'-",
    'Source Additional Info(1)': "'-",
    'Source Additional Info(2)': "'-",
    'Source Additional Info(3)': "'-",
    'Source Additional Info(4)': "'-",
    'Source Additional Info(5)': "'-",
    'Source Additional Info(6)': "'-",
    'Source Additional Info(7)': "'-",
    'Source Additional Info(8)': "'-",
    'Source Additional Info(9)': "'-",
    'Beneficiary Additional Info(1)': 'Label = Pembayaran - Value = SPP Bulan April 2026',
    'Beneficiary Additional Info(2)': "'-",
    'Beneficiary Additional Info(3)': "'-",
    'Beneficiary Additional Info(4)': "'-",
    'Beneficiary Additional Info(5)': "'-",
    'Beneficiary Additional Info(6)': "'-",
    'Beneficiary Additional Info(7)': "'-",
    'Beneficiary Additional Info(8)': "'-",
    'Beneficiary Additional Info(9)': "'-",
    'Remarks': "'-",
    'Transaction Date-Time': '16 Apr 2026 10:58',
    'Total Amount': 'IDR 50.000,00',
    'Channel': 'Mobile Banking (Super Apps)',
    'Transfer Type': 'PB',
    'Status': 'Success'
  };

  console.log('Testing rec1 (beneficiary: IDR1729400010001 - no student match)...');
  console.log('VA extracted:', require('../src/utils/billing').extractVA(rec1['Beneficiary Account']));

  console.log('\\nTesting rec2 (beneficiary: 8322317710469959 - should match student 588)...');
  console.log('VA extracted:', require('../src/utils/billing').extractVA(rec2['Beneficiary Account']));

  // Simulasi import (tanpa auth)
  const res = await fetch('http://localhost:3000/api/bsi/import-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [rec1, rec2] })
  });
  const data = await res.json();
  console.log('\\nAPI Response:', data);

  process.exit(0);
}

test().catch(e => { console.error('Error:', e); process.exit(1); });