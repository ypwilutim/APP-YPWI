#!/usr/bin/env node
/**
 * Test the new date logic for SK generation
 */

const idnMonths = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function calculateDates(tmtStr, todayStr, jabatan = '') {
  const tmt = new Date(tmtStr);
  const today = new Date(todayStr);
  
  // Calculate full years of service (TMT to today)
  let yearsOfService = today.getFullYear() - tmt.getFullYear();
  const monthDiff = today.getMonth() - tmt.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < tmt.getDate())) {
    yearsOfService--;
  }
  
  // Check if leader
  const leaderSource = jabatan.toLowerCase();
  const isLeader = ['pimpinan', 'kepala', 'ketua'].some(k => leaderSource.includes(k));
  
  let tglMulaiCalc, tglSelesaiCalc;
  
  if (isLeader) {
    tglMulaiCalc = '1 Januari ' + today.getFullYear() + ' M';
    const lastDayDec = new Date(today.getFullYear() + 3, 11, 31).getDate();
    tglSelesaiCalc = lastDayDec + ' Desember ' + (today.getFullYear() + 3) + ' M';
  } else if (yearsOfService < 1) {
    tglMulaiCalc = tmt.getDate() + ' ' + idnMonths[tmt.getMonth()] + ' ' + tmt.getFullYear() + ' M';
    const lastDayDec = new Date(tmt.getFullYear(), 11, 31).getDate();
    tglSelesaiCalc = lastDayDec + ' Desember ' + tmt.getFullYear() + ' M';
  } else {
    tglMulaiCalc = '1 Januari ' + today.getFullYear() + ' M';
    const lastDayDec = new Date(today.getFullYear(), 11, 31).getDate();
    tglSelesaiCalc = lastDayDec + ' Desember ' + today.getFullYear() + ' M';
  }
  
  return { tglMulai: tglMulaiCalc, tglSelesai: tglSelesaiCalc, yearsOfService, isLeader };
}

// Test cases
console.log('=== Test Cases ===\n');

// 1. TMT: 1 Oct 2026, Today: 9 Nov 2026 (Guru biasa, < 1 thn)
console.log('1. TMT 1 Okt 2026, Today 9 Nov 2026, Guru:');
console.log(calculateDates('2026-10-01', '2026-11-09', 'Guru Mapel'));
console.log('Expected: 1 Oktober 2026 - 31 Desember 2026\n');

// 2. TMT: 15 Jan 2025, Today: 9 Nov 2026 (Guru biasa, >= 1 thn)
console.log('2. TMT 15 Jan 2025, Today 9 Nov 2026, Guru:');
console.log(calculateDates('2025-01-15', '2026-11-09', 'Guru Mapel'));
console.log('Expected: 1 Januari 2026 - 31 Desember 2026\n');

// 3. TMT: 1 Feb 2027, Today: 9 Nov 2027 (Guru biasa, < 1 thn)
console.log('3. TMT 1 Feb 2027, Today 9 Nov 2027, Guru:');
console.log(calculateDates('2027-02-01', '2027-11-09', 'Guru Mapel'));
console.log('Expected: 1 Februari 2027 - 31 Desember 2027\n');

// 4. TMT: 1 Jan 2026, Today: 9 Nov 2026 (Kepala Sekolah)
console.log('4. TMT 1 Jan 2026, Today 9 Nov 2026, Kepala Sekolah:');
console.log(calculateDates('2026-01-01', '2026-11-09', 'Kepala Sekolah'));
console.log('Expected: 1 Januari 2026 - 31 Desember 2029\n');

// 5. TMT: 1 Jan 2026, Today: 9 Nov 2026 (Guru biasa, exactly 1 year edge)
console.log('5. TMT 1 Jan 2026, Today 9 Nov 2026, Guru (exact 1 year? No, < 1 yr from Jan to Nov):');
console.log(calculateDates('2026-01-01', '2026-11-09', 'Guru'));
console.log('Expected: 1 Januari 2026 - 31 Des 2026 (but wait, < 1 year from Jan 1 to Nov 9? No, it IS < 1 year)\n');

// 6. TMT: 1 Jan 2025, Today: 9 Nov 2026 (Guru biasa, >= 1 thn)
console.log('6. TMT 1 Jan 2025, Today 9 Nov 2026, Guru:');
console.log(calculateDates('2025-01-01', '2026-11-09', 'Guru'));
console.log('Expected: 1 Januari 2026 - 31 Des 2026\n');

// 7. TMT: 15 Mar 2026, Today: 9 Nov 2026 (Guru biasa, < 1 thn)
console.log('7. TMT 15 Mar 2026, Today 9 Nov 2026, Guru:');
console.log(calculateDates('2026-03-15', '2026-11-09', 'Guru'));
console.log('Expected: 15 Maret 2026 - 31 Des 2026\n');

// 8. TMT: 10 Nov 2026, Today: 9 Nov 2026 (Guru biasa, just 1 day before 1 year)
console.log('8. TMT 10 Nov 2026, Today 9 Nov 2026, Guru (1 day before 1 yr):');
console.log(calculateDates('2025-11-10', '2026-11-09', 'Guru'));
console.log('Expected: 1 Januari 2026 - 31 Des 2026 (exactly 1 year on Nov 10, so < 1 yr on Nov 9)\n');

// 9. TMT: 10 Nov 2025, Today: 10 Nov 2026 (Guru biasa, exactly 1 year)
console.log('9. TMT 10 Nov 2025, Today 10 Nov 2026, Guru (exactly 1 yr):');
console.log(calculateDates('2025-11-10', '2026-11-10', 'Guru'));
console.log('Expected: 1 Januari 2026 - 31 Des 2026 (exactly 1 year, so >= 1)\n');

console.log('=== All tests completed ===');