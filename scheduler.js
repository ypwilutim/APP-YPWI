const cron = require('node-cron');
const db = require('./db');
const { sendBillTemplate, formatPhoneNumber } = require('./src/utils/whatsappTemplate');

// Ensure settings table exists on startup
async function initBillSettings() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS bill_settings (
      id INT PRIMARY KEY DEFAULT 1,
      send_day INT DEFAULT 1,
      due_day INT DEFAULT 10,
      is_enabled TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  
  // Insert default if not exists
  const existing = await db.query('SELECT id FROM bill_settings LIMIT 1');
  if (existing.length === 0) {
    await db.query('INSERT INTO bill_settings (send_day, due_day, is_enabled) VALUES (1, 10, 0)');
  }
}

function getIndonesianMonthName(date) {
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  return months[date.getMonth()];
}

function getCurrentPeriode() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function runAutoBillReminder() {
  try {
    // Ensure tables exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS tagihan_siswa (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id INT NOT NULL,
        tenant_id INT NOT NULL,
        periode VARCHAR(20) NOT NULL,
        jumlah_tagihan DECIMAL(10,2) DEFAULT 0,
        status ENUM('terkirim', 'gagal', 'diterima') DEFAULT 'terkirim',
        message_id VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_tagihan (student_id, periode)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    
    // Get settings
    const settings = await db.query('SELECT send_day, due_day, is_enabled FROM bill_settings LIMIT 1');
    if (!settings.length || !settings[0].is_enabled) {
      console.log('[BILL_REMINDER] Auto bill sending is disabled, skipping...');
      return;
    }
    
    const now = new Date();
    const today = now.getDate();
    const sendDay = settings[0].send_day;
    
    // Only run on send day
    if (today !== sendDay) {
      console.log(`[BILL_REMINDER] Today is ${today}, scheduled day is ${sendDay}, skipping...`);
      return;
    }
    
    const periode = getCurrentPeriode();
    const dueDate = settings[0].due_day;
    const jatuhTempo = `${String(dueDate).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    
    // Check if already sent this month
    const alreadySent = await db.query(
      'SELECT COUNT(*) as count FROM tagihan_siswa WHERE periode = ?',
      [periode]
    );
    
    if (alreadySent[0].count > 0) {
      console.log('[BILL_REMINDER] Bill already sent this month, skipping...');
      return;
    }
    
    // Get all students with parent WA numbers
    let students;
    try {
      students = await db.query(`
        SELECT s.id, s.nama_siswa, s.iuran_bulanan, s.tenant_id, s.parent_id, p.no_wa as parent_wa
        FROM students s
        LEFT JOIN parents p ON s.parent_id = p.id
        WHERE p.no_wa IS NOT NULL AND p.no_wa != ''
      `);
    } catch (err) {
      console.log('[BILL_REMINDER] Query error, using empty list:', err.message);
      students = [];
    }
    
    let successCount = 0;
    let failCount = 0;
    
    for (const student of students) {
      try {
        const formattedPhone = formatPhoneNumber(student.parent_wa);
        if (!formattedPhone) {
          console.log('[BILL_REMINDER] Invalid WA for student', student.nama_siswa);
          failCount++;
          continue;
        }
        
        // Get tenant bank account info
        let tenant;
        try {
          const tenantRows = await db.query(
            'SELECT bank_account_number, bank_account_name FROM tenants WHERE tenant_id = ?',
            [student.tenant_id]
          );
          tenant = tenantRows[0] || {};
        } catch (err) {
          tenant = {};
        }
        
        const result = await sendBillTemplate(formattedPhone, {
          nama_siswa: student.nama_siswa,
          bulan: getIndonesianMonthName(now),
          jumlah_tagihan: `Rp ${(student.iuran_bulanan || 0).toLocaleString('id-ID')}`,
          tanggal_jatuh_tempo: jatuhTempo,
          nomor_rekening: tenant?.bank_account_number || '-',
          nama_penerima: tenant?.bank_account_name || '-'
        });
        
        await db.query(
          'INSERT INTO tagihan_siswa (student_id, tenant_id, periode, jumlah_tagihan, status, message_id) VALUES (?, ?, ?, ?, ?, ?)',
          [student.id, student.tenant_id, periode, student.iuran_bulanan || 0, 'terkirim', result.messageId]
        );
        
        successCount++;
      } catch (error) {
        console.error('[BILL_REMINDER] Failed for', student.nama_siswa, ':', error.message);
        failCount++;
      }
    }
    
    console.log(`[BILL_REMINDER] Completed: ${successCount} sent, ${failCount} failed`);
  } catch (err) {
    console.error('[BILL_REMINDER] Error:', err.message);
  }
}

cron.schedule('0 9 * * *', runAutoBillReminder);

initBillSettings(); // Initialize on startup

async function runAutoSkGeneration() {
  try {
    const settings = await db.query('SELECT auto_generate_date, auto_generate_enabled, min_service_years FROM sk_automation_settings LIMIT 1');
    
    if (!settings.length || !settings[0].auto_generate_enabled) return;
    
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayMM = `${mm}-${dd}`;
    
    if (settings[0].auto_generate_date && settings[0].auto_generate_date === todayMM) {
      console.log('Running auto SK generation...');
      
      const allTenants = await db.query('SELECT tenant_id FROM tenants');
      const placeholders = allTenants.map(() => '?').join(',');
      const teachers = await db.query(
        `SELECT t.id as teacher_id, t.nama, t.nik, t.nip, t.tempat_lahir, t.tanggal_lahir, t.status_kepegawaian, t.tmt, t.pendidikan_terakhir, ta.jabatan_di_unit as unit, tn.nama_sekolah, tn.id as tenant_pk FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id JOIN tenants tn ON ta.tenant_id = tn.tenant_id WHERE (t.status_aktif = 1 OR t.status_aktif IS NULL) AND t.nip IS NULL AND tn.tenant_id IN (${placeholders})`,
        allTenants.map(t => t.tenant_id)
      );
      
      const hijriMonths = ['Muharam', 'Safar', 'Rabiul Awal', 'Rabiul Akhir', 'Jumadil Awal', 'Jumadil Akhir', 'Rajab', 'Syaban', 'Ramadhan', 'Syawal', 'Dzul Qaidah', 'Dzul Hijjah'];
      
      function gregorianToHijri(gregorianDate) {
        const hijriYear = gregorianDate.getFullYear() - 622;
        const hijriMonth = hijriMonths[gregorianDate.getMonth()] || '';
        const hijriDay = gregorianDate.getDate();
        return { day: hijriDay, month: hijriMonth, year: hijriYear };
      }
      
      function parseDate(dateStr) {
        if (!dateStr) return null;
        const parts = typeof dateStr === 'string' ? dateStr.split('-') : null;
        if (parts && parts.length >= 1) {
          return new Date(parts[0], parts[1] ? parseInt(parts[1]) - 1 : 0, parts[2] ? parseInt(parts[2]) : 1);
        }
        return null;
      }
      
      function buildSkData(teacher, tentangType, pt, hijriYear) {
        const now = new Date();
        const hijriToday = gregorianToHijri(now);
        const tmtDate = parseDate(teacher.tmt);
        
        let tentang = 'PENGANGKATAN GURU';
        if (tentangType === 'kembali') {
          tentang = 'PENGANGKATAN KEMBALI GURU';
        }
        
        const nomorUrut = hijriToday.year * 100 + now.getDate();
        const nomorUrutFormatted = String(nomorUrut).padStart(3, '0');
        const noSurat = `QR.${nomorUrutFormatted}/02/YPWI-LT/${hijriMonths[now.getMonth()]}/${hijriYear}`;
        
        const tmtFormatted = tmtDate ? `${String(tmtDate.getDate()).padStart(2, '0')}-${String(tmtDate.getMonth() + 1).padStart(2, '0')}-${tmtDate.getFullYear()}` : '';
        
        const ttlFormatted = teacher.tempat_lahir ? (teacher.tanggal_lahir ? `${teacher.tempat_lahir}, ${teacher.tanggal_lahir}` : teacher.tempat_lahir) : '-';
        const pendidikanFormatted = teacher.pendidikan_terakhir || '-';
        
        const tmtMonth = tmtDate ? tmtDate.getMonth() + 1 : now.getMonth() + 1;
        const tmtYear = tmtDate ? String(tmtDate.getFullYear()).slice(-2) : String(now.getFullYear()).slice(-2);
        const tenantPkFormatted = String(teacher.tenant_pk).padStart(2, '0');
        const niy = `${teacher.tanggal_lahir ? String(teacher.tanggal_lahir).replace(/-/g, '').slice(-8) : '20240101'}${String(tmtMonth).padStart(2, '0')}${tmtYear}${teacher.nik ? String(teacher.nik).slice(-4) : '2024'}${tenantPkFormatted}${String(nomorUrut).padStart(4, '0')}`;
        
        const masaKerjaMonths = tmtDate ? (now.getFullYear() - tmtDate.getFullYear()) * 12 + now.getMonth() - tmtDate.getMonth() : 0;
        const masaKerjaYears = Math.floor(masaKerjaMonths / 12);
        const masaKerjaRemainingMonths = masaKerjaMonths % 12;
        
        return {
          noSurat, tentang, ttl: ttlFormatted, tmtFormatted, niy,
          unit: teacher.nama_sekolah || '-', bhFormatted: `${masaKerjaYears} Tahun`, bmFormatted: `${masaKerjaRemainingMonths} Bulan`
        };
      }
      
      const minYears = settings[0].min_service_years || 2;
      const hijriToday = gregorianToHijri(today);
      const results = [];
      const skipped = [];
      
      for (const teacher of teachers) {
        const tmtDate = parseDate(teacher.tmt);
        const yearsOfService = tmtDate ? (today.getFullYear() - tmtDate.getFullYear()) : 0;
        
        if (yearsOfService < minYears) {
          skipped.push({ teacher_id: teacher.teacher_id, nama: teacher.nama, reason: 'Belum mencapai ' + minYears + ' tahun pengabdian' });
          continue;
        }
        
        const skData = buildSkData(teacher, 'baru', 'Ya', hijriToday.year);
        
        await db.query(
          'INSERT INTO sk_guru (teacher_id, no_surat, tentang, ttl, tmt, niy, unit, bh, bm, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
          [teacher.teacher_id, skData.noSurat, skData.tentang, skData.ttl, skData.tmtFormatted, skData.niy, skData.unit, skData.bhFormatted, skData.bmFormatted]
        );
        
        await db.query('UPDATE teachers SET nip = ? WHERE id = ?', [skData.niy, teacher.teacher_id]);
        results.push({ teacher_id: teacher.teacher_id, nama: teacher.nama, niy: skData.niy });
      }
      
      console.log(`Auto SK generation: ${results.length} SK generated, ${skipped.length} skipped`);
    }
  } catch (err) {
    console.error('Scheduler error:', err.message);
  }
}

cron.schedule('0 0 * * *', runAutoSkGeneration);

function gregorianToHijri(gregorianDate) {
  const hijriYear = gregorianDate.getFullYear() - 622;
  const hijriMonths = ['Muharam', 'Safar', 'Rabiul Awal', 'Rabiul Akhir', 'Jumadil Awal', 'Jumadil Akhir', 'Rajab', 'Syaban', 'Ramadhan', 'Syawal', 'Dzul Qaidah', 'Dzul Hijjah'];
  const hijriMonth = hijriMonths[gregorianDate.getMonth()] || '';
  const hijriDay = gregorianDate.getDate();
  return { day: hijriDay, month: hijriMonth, year: hijriYear };
}

module.exports = { runAutoSkGeneration, runAutoBillReminder };