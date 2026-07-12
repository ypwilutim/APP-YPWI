const cron = require('node-cron');
const db = require('./db');
const { sendBillTemplate, formatPhoneNumber } = require('./src/utils/whatsappTemplate');
const axios = require('axios');

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

async function runAutoMonthlyInvoiceGeneration() {
  try {
    console.log('[MONTHLY_INVOICE] Starting auto invoice generation...');
    
    const now = new Date();
    const periode = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    const tenants = await db.query('SELECT tenant_id, nama_sekolah FROM tenants');
    if (!tenants || tenants.length === 0) {
      console.log('[MONTHLY_INVOICE] No tenants found');
      return;
    }

    let totalGenerated = 0;
    
    for (const tenant of tenants) {
      const settings = await db.query(
        'SELECT monthly_invoice_amount, bill_send_day, due_day FROM bill_settings WHERE tenant_id = ? LIMIT 1',
        [tenant.tenant_id]
      );
      const monthlyAmount = settings.length > 0 && settings[0].monthly_invoice_amount ? parseFloat(settings[0].monthly_invoice_amount) : 0;
      const dueDay = settings.length > 0 && settings[0].due_day ? settings[0].due_day : 10;
      const dueDate = new Date(now.getFullYear(), now.getMonth() + 1, dueDay);
      
      const students = await db.query(
        `SELECT s.id, s.nama_siswa, s.nis, s.parent_id, p.no_wa as parent_wa, p.nama_orang_tua, p.email as parent_email, tn.nama_sekolah
         FROM students s
         LEFT JOIN parents p ON s.parent_id = p.id
         JOIN tenants tn ON s.tenant_id = tn.tenant_id
         WHERE s.tenant_id = ?`,
        [tenant.tenant_id]
      );

      for (const student of students) {
        const [existing] = await db.query(
          'SELECT id FROM payment_invoices WHERE student_id = ? AND tenant_id = ? AND periode = ?',
          [student.id, tenant.tenant_id, periode]
        );

        if (existing) {
          continue;
        }

        const invoiceNumber = `INV-${tenant.tenant_id}-${periode}-${student.id}-${Date.now().toString(36).toUpperCase()}`;
        const description = `SPP ${student.nama_siswa} - ${student.nama_sekolah} - ${periode}`;
        const metadata = JSON.stringify({
          student_name: student.nama_siswa,
          school_name: student.nama_sekolah,
          parent_wa: student.parent_wa || null,
          parent_email: student.parent_email || null,
          parent_name: student.nama_orang_tua || null,
          type: 'SPP'
        });

        const [result] = await db.query(
          `INSERT INTO payment_invoices (tenant_id, student_id, invoice_number, amount, description, periode, status, due_date, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            tenant.tenant_id,
            student.id,
            invoiceNumber,
            monthlyAmount,
            description,
            periode,
            monthlyAmount > 0 ? 'pending' : 'paid',
            dueDate.toISOString().slice(0, 10),
            metadata
          ]
        );

        const invoiceId = result.insertId;

        await db.query(
          'INSERT INTO payment_status_history (invoice_id, old_status, new_status, changed_by, notes) VALUES (?, ?, ?, ?, ?)',
          [invoiceId, null, monthlyAmount > 0 ? 'pending' : 'paid', 0, 'Invoice bulanan otomatis']
        );

        totalGenerated++;

        const amountText = `Rp ${monthlyAmount.toLocaleString('id-ID')}`;
        const message = `Assalamu'alaikum Bapak/Ibu ${student.nama_orang_tua || 'Wali Murid'},

Tagihan SPP untuk:
- Siswa: ${student.nama_siswa} (${student.nis || '-'})
- Bulan: ${periode}
- Jumlah: ${amountText}
- No. Invoice: ${invoiceNumber}
- Jatuh Tempo: ${dueDate.toLocaleDateString('id-ID')}

Silakan lakukan pembayaran sebelum tanggal jatuh tempo.
Hubungi admin/bendahara jika ada kendala. Terima kasih.`;

        if (student.parent_wa) {
          const formatted = formatPhoneNumber(student.parent_wa);
          if (formatted) {
            try {
              await sendBillTemplate(formatted, {
                nama_siswa: student.nama_siswa,
                bulan: getIndonesianMonthName(now),
                jumlah_tagihan: amountText,
                tanggal_jatuh_tempo: dueDate.toLocaleDateString('id-ID')
              });
            } catch (err) {
              console.error('[MONTHLY_INVOICE] WA failed for', student.nama_siswa, err.message);
            }
          }
        }

        if (student.parent_email && process.env.EMAIL_ENABLED === 'true') {
          const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tagihan SPP - ${student.nama_siswa}</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 20px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
    <div style="background: linear-gradient(135deg, #066e3a 0%, #0a8a4a 100%); padding: 30px; text-align: center;">
      <h1 style="margin: 0; color: white; font-size: 24px;">YPWI Lutim</h1>
      <p style="margin: 5px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">Tagihan SPP</p>
    </div>
    <div style="padding: 30px;">
      <h2 style="margin: 0 0 20px 0; color: #333;">Assalamu'alaikum ${student.nama_orang_tua || 'Wali Murid'}</h2>
      <p style="color: #555; line-height: 1.6;">Berikut adalah tagihan SPP untuk:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Siswa</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: 600;">${student.nama_siswa} (${student.nis || '-'})</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Bulan</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: 600;">${periode}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Jumlah</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: 600; color: #d97706;">${amountText}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">No. Invoice</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: 600;">${invoiceNumber}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Jatuh Tempo</td><td style="padding: 8px 0; font-weight: 600; color: #dc2626;">${dueDate.toLocaleDateString('id-ID')}</td></tr>
      </table>
      <p style="color: #555; line-height: 1.6;">Silakan hubungi admin/bendahara untuk informasi pembayaran.</p>
      <p style="margin-top: 20px; color: #888; font-size: 14px;">Email ini dikirim otomatis oleh sistem.</p>
    </div>
  </div>
</body>
</html>`;
          try {
            await global.sendEmail(student.parent_email, `Tagihan SPP ${student.nama_siswa} - ${getIndonesianMonthName(now)}`, html);
          } catch (err) {
            console.error('[MONTHLY_INVOICE] Email failed for', student.nama_siswa, err.message);
          }
        }
      }
    }

    console.log(`[MONTHLY_INVOICE] Completed: ${totalGenerated} invoices generated`);
  } catch (err) {
    console.error('[MONTHLY_INVOICE] Error:', err);
  }
}

// Run on 1st day of every month at 08:00 AM
cron.schedule('0 8 1 * *', runAutoMonthlyInvoiceGeneration);

module.exports = { runAutoSkGeneration, runAutoBillReminder, runAutoMonthlyInvoiceGeneration };

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

module.exports = { runAutoSkGeneration, runAutoBillReminder, runAutoMonthlyInvoiceGeneration };