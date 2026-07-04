const express = require('express');
const db = require('../../db');
const { authenticateOperator, verifyTenantAccess } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const router = express.Router();

const hijriMonths = ['Muharam', 'Safar', 'Rabiul Awal', 'Rabiul Akhir', 'Jumadil Awal', 'Jumadil Akhir', 'Rajab', 'Syaban', 'Ramadhan', 'Syawal', 'Dzul Qaidah', 'Dzul Hijjah'];

const { toHijri } = require('hijri-converter');

function gregorianToHijri(date) {
   const h = toHijri(date.getFullYear(), date.getMonth() + 1, date.getDate());
   return {
     day: h.hd,
     month: hijriMonths[h.hm - 1] || 'Muharam',
     year: h.hy
   };
 }

function romanize(num) {
  const romans = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  return romans[num - 1] || String(num);
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    const parts = dateStr.split('-');
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof dateStr === 'string' && /^\d{4}-\d{2}$/.test(dateStr)) {
    const match = dateStr.match(/^(\d{4})-(\d{2})$/);
    if (match) {
      const d = new Date(parseInt(match[1]), parseInt(match[2]) - 1, 1);
      return isNaN(d.getTime()) ? null : d;
    }
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

router.get('/teachers/:id/data', authenticateOperator, async (req, res) => {
  try {
    const teacherId = req.params.id;
const [teacher] = await db.query(
      'SELECT t.id, t.nama, t.nik, t.nip, t.tempat_lahir, t.tanggal_lahir, t.status_kepegawaian, t.tmt, ta.tenant_id, ta.jabatan_di_unit as unit, tn.nama_sekolah, tn.id as tenant_pk FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id JOIN tenants tn ON ta.tenant_id = tn.tenant_id WHERE t.id = ? AND t.status_aktif = 1',
      [teacherId]
    );

    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
    }

    const [existingSk] = await db.query(
      'SELECT niy, tentang FROM sk_guru WHERE teacher_id = ? ORDER BY created_at DESC LIMIT 1',
      [teacherId]
    );
    const hasExistingSk = existingSk && existingSk.tentang && existingSk.tentang.includes('KEMBALI');
    const existingNiy = existingSk && existingSk.niy ? existingSk.niy : null;

    const today = new Date();
    const currentHijri = gregorianToHijri(today);
    const hijriMonthIndex = hijriMonths.indexOf(currentHijri.month);
    const romanMonth = hijriMonthIndex >= 0 ? romanize(hijriMonthIndex + 1) : 'VII';

    let tmtFormatted = '';
    const tmtDate = parseDate(teacher.tmt);
    if (tmtDate) {
      const month = String(tmtDate.getMonth() + 1).padStart(2, '0');
      tmtFormatted = tmtDate.getFullYear() + '-' + month;
    }

const result = {
       teacher_id: teacher.id,
       nama: teacher.nama,
       nik: teacher.nik,
       nip: teacher.nip,
       tenant_id: teacher.tenant_id,
       tenant_pk: teacher.tenant_pk,
       nama_sekolah: teacher.nama_sekolah,
       unit: teacher.unit || teacher.nama_sekolah || 'Guru',
       tmt_formatted: tmtFormatted,
       has_existing_sk: hasExistingSk,
       existing_niy: existingNiy,
       hijri_month_roman: romanMonth,
       hijri_year: currentHijri.year
     };

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get SK teacher data error:', error);
    res.status(500).json({ success: false, message: 'Error fetching teacher data' });
  }
});

async function getNextSkNumber(tenantId, hijriYear) {
  const existing = await db.query(
    'SELECT last_number FROM sk_sequence WHERE tenant_id = ? AND hijri_year = ?',
    [tenantId, hijriYear]
  );
  
  if (existing.length > 0) {
    const newNumber = existing[0].last_number + 1;
    await db.query(
      'UPDATE sk_sequence SET last_number = ? WHERE tenant_id = ? AND hijri_year = ?',
      [newNumber, tenantId, hijriYear]
    );
    return newNumber;
  } else {
    await db.query(
      'INSERT INTO sk_sequence (tenant_id, hijri_year, hijri_month, last_number) VALUES (?, ?, ?, 1)',
      [tenantId, hijriYear, hijriMonths[0]]
    );
    return 1;
  }
}

function getStatusKepegawaian(status) {
  const statusMap = {
    'Guru Tetap Yayasan': 'GTY',
    'Guru Tidak Tetap Yayasan': 'GTTY', 
    'Guru Kontrak Yayasan': 'GKY',
    'Tetap': 'GTY',
    'Tidak Tetap': 'GTTY',
    'Kontrak': 'GKY',
    'GTY': 'GTY',
    'GTTY': 'GTTY',
    'GKY': 'GKY'
  };
  return statusMap[status] || (status || 'GTY');
}

function buildSkData(teacher, tentang_type, pt, tmt_custom, nomorUrut, hijriYear) {
  const today = new Date();
  const birthDate = parseDate(teacher.tanggal_lahir) || today;
  const tmtDate = tmt_custom ? parseDate(tmt_custom) : (parseDate(teacher.tmt) || today);
  const hijriToday = gregorianToHijri(today);

  const romanMonth = romanize(hijriMonths.indexOf(hijriToday.month) + 1);
  const noSurat = 'QR.' + String(nomorUrut).padStart(3, '0') + '/02/YPWI-LT/' + romanMonth + '/' + hijriToday.year;

  const tentang = tentang_type === 'kembali' ? 'PENGANGKATAN KEMBALI GURU (' + teacher.nama_sekolah + ')' : 'PENGANGKATAN GURU (' + teacher.nama_sekolah + ')';

  const ttl = teacher.tempat_lahir ? teacher.tempat_lahir + ', ' + birthDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

  const tmtFormatted = tmtDate ? tmtDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }).toUpperCase() : '';

  const birthDay = String(birthDate.getDate()).padStart(2, '0');
  const birthMonth = String(birthDate.getMonth() + 1).padStart(2, '0');
  const birthYear = String(birthDate.getFullYear());
const tmtMonth = tmtDate ? String(tmtDate.getMonth() + 1).padStart(2, '0') : '01';
  const tmtYear = tmtDate ? tmtDate.getFullYear() : today.getFullYear();
  const tmtYear2digit = tmtDate ? String(tmtDate.getFullYear()).slice(-2) : String(today.getFullYear()).slice(-2);
  const tenantId2digit = teacher.tenant_pk ? String(teacher.tenant_pk).padStart(2, '0') : (teacher.tenant_id || '').slice(-2);
  const seq = String(nomorUrut).padStart(3, '0');
  const niy = teacher.nip || (birthDay + birthMonth + birthYear + tmtMonth + tmtYear2digit + tenantId2digit + seq);

  const ptFormatted = teacher.pt || pt || 'S1/PEND. SOSIOLOGI/UNM/2019';

const bhFormatted = hijriToday.day + ' ' + hijriToday.month + ' ' + hijriToday.year + ' H';
   const bmFormatted = today.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) + ' M';
   
   const tglMulai = '1 Januari ' + today.getFullYear() + ' M';
   const tglSelesai = '31 Desember ' + today.getFullYear() + ' M';

   return {
     noSurat,
     tentang,
     ttl,
     tmtFormatted,
     niy,
     ptFormatted,
     bhFormatted,
     bmFormatted,
     tglMulai,
     tglSelesai,
unit: teacher.nama_sekolah || teacher.unit || 'Guru',
      jabatan: teacher.unit || 'Guru ' + (teacher.status_kepegawaian || ''),
      status: getStatusKepegawaian(teacher.status_kepegawaian)
    };
  }

router.post('/generate', authenticateOperator, async (req, res) => {
   try {
     const { teacher_id, tentang_type, pt, tmt_custom } = req.body;

     if (!teacher_id) {
       return res.status(400).json({ success: false, message: 'teacher_id diperlukan' });
     }

     const [teacher] = await db.query(
       'SELECT t.id, t.nama, t.nik, t.nip, t.tempat_lahir, t.tanggal_lahir, t.status_kepegawaian, t.tmt, ta.tenant_id, ta.jabatan_di_unit as unit, tn.nama_sekolah, tn.id as tenant_pk FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id JOIN tenants tn ON ta.tenant_id = tn.tenant_id WHERE t.id = ? AND t.status_aktif = 1',
       [teacher_id]
     );

    if (!teacher) {
      return res.status(400).json({ success: false, message: 'Guru tidak ditemukan' });
    }

    if (!verifyTenantAccess(req, teacher.tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
    }

    const templatePath = path.join(__dirname, '../../SKTEMPLATE.docx');
    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({ success: false, message: 'Template SK tidak ditemukan' });
    }

    const templateContent = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(templateContent);
    
    const today = new Date();
    const hijriToday = gregorianToHijri(today);
    const nomorUrut = await getNextSkNumber(teacher.tenant_id, hijriToday.year);

    const skData = buildSkData(teacher, tentang_type, pt, tmt_custom, nomorUrut, hijriToday.year);
    
    // Template uses &lt;&lt;PLACEHOLDER&gt;&gt; format
    let docXml = zip.file('word/document.xml').asText();
docXml = docXml
       .replace(/&lt;&lt;NO SURAT&gt;&gt;/g, skData.noSurat || '')
       .replace(/<<NO SURAT>>/g, skData.noSurat || '')
       .replace(/&lt;&lt;TENTANG&gt;&gt;/g, skData.tentang || '')
       .replace(/<<TENTANG>>/g, skData.tentang || '')
       .replace(/&lt;&lt;NAMA&gt;&gt;/g, teacher.nama || '')
       .replace(/<<NAMA>>/g, teacher.nama || '')
       .replace(/&lt;&lt;TTL&gt;&gt;/g, skData.ttl || '')
       .replace(/<<TTL>>/g, skData.ttl || '')
       .replace(/&lt;&lt;TMT&gt;&gt;/g, skData.tmtFormatted || '')
       .replace(/<<TMT>>/g, skData.tmtFormatted || '')
       .replace(/&lt;&lt;PT&gt;&gt;/g, skData.ptFormatted || '')
       .replace(/<<PT>>/g, skData.ptFormatted || '')
       .replace(/&lt;&lt;NIY&gt;&gt;/g, skData.niy || '')
       .replace(/<<NIY>>/g, skData.niy || '')
.replace(/&lt;&lt;UNIT&gt;&gt;/g, skData.unit || '')
        .replace(/&lt;&lt;JABATAN&gt;&gt;/g, skData.jabatan || '')
        .replace(/&lt;&lt;TGL_MULAI&gt;&gt;/g, skData.tglMulai || '')
        .replace(/&lt;&lt;STATUS&gt;&gt;/g, skData.status || '')
       .replace(/&lt;&lt;TGL_SELESAI&gt;&gt;/g, skData.tglSelesai || '')
       .replace(/<<TGL_SELESAI>>/g, skData.tglSelesai || '')
       .replace(/&lt;&lt;BH&gt;&gt;/g, skData.bhFormatted || '')
       .replace(/<<BH>>/g, skData.bhFormatted || '')
.replace(/&lt;&lt;BM&gt;&gt;/g, skData.bmFormatted || '')
        .replace(/<<BM>>/g, skData.bmFormatted || '');

    zip.file('word/document.xml', docXml);

    const buf = zip.generate({ type: 'nodebuffer' });

    const downloadsDir = path.join(__dirname, '../../public/downloads');
    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir, { recursive: true });
    }

await db.query(
       'INSERT INTO sk_guru (teacher_id, tenant_id, no_surat, tentang, ttl, tmt, pt, niy, unit, bh, bm, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
       [teacher_id, teacher.tenant_id, skData.noSurat, skData.tentang, skData.ttl, skData.tmtFormatted, skData.ptFormatted, skData.niy, skData.unit, skData.bhFormatted, skData.bmFormatted]
     );

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="SK_Guru.docx"');
    res.setHeader('Content-Length', buf.length);

    return res.send(buf);
  } catch (error) {
    console.error('Generate SK error:', error);
    res.status(500).json({ success: false, message: 'Error generating SK: ' + error.message });
  }
});

router.get('/list', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id || null;

    if (req.user.role === 'guru' && !tenantId) {
      const adminAssignments = (req.user.assignments || []).filter(function(a) {
        const roles = ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (adminAssignments.length === 1) {
        tenantId = adminAssignments[0].tenant_id;
      }
    }

    let skList;
    if (tenantId) {
      if (!verifyTenantAccess(req, tenantId)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
      }
      skList = await db.query(
        'SELECT sg.*, t.nama as teacher_name FROM sk_guru sg JOIN teachers t ON sg.teacher_id = t.id WHERE sg.tenant_id = ? ORDER BY sg.created_at DESC LIMIT 100',
        [tenantId]
      );
    } else {
      skList = await db.query(
        'SELECT sg.*, t.nama as teacher_name, tn.nama_sekolah as tenant_name FROM sk_guru sg JOIN teachers t ON sg.teacher_id = t.id JOIN tenants tn ON sg.tenant_id = tn.tenant_id ORDER BY sg.created_at DESC LIMIT 100'
      );
    }

    res.json({ success: true, data: skList });
  } catch (error) {
    console.error('Get SK list error:', error);
    res.status(500).json({ success: false, message: 'Error fetching SK list' });
  }
});

router.post('/preview', authenticateOperator, async (req, res) => {
   try {
     const { teacher_id, tentang_type, pt, tmt_custom } = req.body;

     if (!teacher_id) {
       return res.status(400).json({ success: false, message: 'teacher_id diperlukan' });
     }

     const [teacher] = await db.query(
       'SELECT t.id, t.nama, t.nik, t.nip, t.tempat_lahir, t.tanggal_lahir, t.status_kepegawaian, t.tmt, ta.tenant_id, ta.jabatan_di_unit as unit, tn.nama_sekolah, tn.id as tenant_pk FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id JOIN tenants tn ON ta.tenant_id = tn.tenant_id WHERE t.id = ? AND t.status_aktif = 1',
       [teacher_id]
     );

    if (!teacher) {
      return res.status(400).json({ success: false, message: 'Guru tidak ditemukan' });
    }

    if (!verifyTenantAccess(req, teacher.tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
    }

    const today = new Date();
    const hijriToday = gregorianToHijri(today);
    const nomorUrut = await getNextSkNumber(teacher.tenant_id, hijriToday.year);

    const skData = buildSkData(teacher, tentang_type, pt, tmt_custom, nomorUrut, hijriToday.year);

res.json({
       success: true,
       data: {
         no_surat: skData.noSurat,
         tentang: skData.tentang,
         nama: teacher.nama,
         ttl: skData.ttl,
         tmt: skData.tmtFormatted,
         pt: skData.ptFormatted,
niy: skData.niy,
          unit: skData.unit,
          jabatan: skData.jabatan,
          status: skData.status,
          tglMulai: skData.tglMulai,
          tglSelesai: skData.tglSelesai,
          bh: skData.bhFormatted,
          bm: skData.bmFormatted
       }
     });
} catch (error) {
     console.error('Preview SK error:', error);
     res.status(500).json({ success: false, message: 'Error preview SK: ' + error.message });
   }
 });

router.delete('/:id', authenticateOperator, async (req, res) => {
   try {
     const skId = req.params.id;
     const [sk] = await db.query('SELECT tenant_id FROM sk_guru WHERE id = ?', [skId]);
     
     if (!sk) {
       return res.status(404).json({ success: false, message: 'SK tidak ditemukan' });
     }
     
     if (!verifyTenantAccess(req, sk.tenant_id)) {
       return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
     }
     
     await db.query('DELETE FROM sk_guru WHERE id = ?', [skId]);
     res.json({ success: true, message: 'SK berhasil dihapus' });
   } catch (error) {
     console.error('Delete SK error:', error);
     res.status(500).json({ success: false, message: 'Error menghapus SK' });
   }
 });


router.post('/bulk-generate', authenticateOperator, async (req, res) => {
  try {
    const { tenant_id, tentang_type, pt } = req.body;

    // Untuk admin, gunakan settings universal
    let targetTenantId = tenant_id;
    let teachers;
    
    if (!tenant_id && req.user.role === 'admin') {
      // Ambil semua tenant
      const allTenants = await db.query('SELECT tenant_id FROM tenants');
      
      // Query semua guru tanpa NIY
      const placeholders = allTenants.map(() => '?').join(',');
teachers = await db.query(
         'SELECT t.id as teacher_id, t.nama, t.nik, t.nip, t.tempat_lahir, t.tanggal_lahir, t.status_kepegawaian, t.tmt, ta.tenant_id, ta.jabatan_di_unit as unit, tn.nama_sekolah, tn.id as tenant_pk FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id JOIN tenants tn ON ta.tenant_id = tn.tenant_id WHERE t.status_aktif = 1 AND t.nip IS NULL AND tn.tenant_id IN (${placeholders})',
         allTenants.map(t => t.tenant_id)
       );
    } else {
       targetTenantId = tenant_id;
       
       if (!verifyTenantAccess(req, targetTenantId)) {
         return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
       }

      teachers = await db.query(
          'SELECT t.id as teacher_id, t.nama, t.nik, t.nip, t.tempat_lahir, t.tanggal_lahir, t.status_kepegawaian, t.tmt, ta.tenant_id, ta.jabatan_di_unit as unit, tn.nama_sekolah, tn.id as tenant_pk FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id JOIN tenants tn ON ta.tenant_id = tn.tenant_id WHERE ta.tenant_id = ? AND t.status_aktif = 1 AND t.nip IS NULL',
          [targetTenantId]
        );
    }

const hijriToday = gregorianToHijri(new Date());
     const results = [];
     const skipped = [];
     
    const employmentRules = await db.query('SELECT * FROM employment_rules');
    const statusRules = await db.query('SELECT * FROM employment_status_rules');

     for (const teacher of teachers) {
       const tmtDate = parseDate(teacher.tmt);
       const today = new Date();
       const yearsOfService = tmtDate ? (today.getFullYear() - tmtDate.getFullYear()) : 0;
       
       const teacherEmploymentType = getStatusKepegawaian(teacher.status_kepegawaian);
      const rule = employmentRules.find(r => teacher.jabatan_di_unit?.toLowerCase().includes(r.job_title_pattern.toLowerCase())) 
        || statusRules.find(r => r.employment_type === teacherEmploymentType);
       const minYearsRequired = rule ? rule.min_years : 2;
       
       if (yearsOfService < minYearsRequired) {
         skipped.push({ teacher_id: teacher.teacher_id, nama: teacher.nama, reason: 'Belum mencapai ' + minYearsRequired + ' tahun pengabdian' });
         continue;
       }
      
const nomorUrut = await getNextSkNumber(teacher.tenant_id, hijriToday.year);
       const skData = buildSkData(teacher, tentang_type, pt, null, nomorUrut, hijriToday.year);

       await db.query(
         'INSERT INTO sk_guru (teacher_id, tenant_id, no_surat, tentang, ttl, tmt, pt, niy, unit, bh, bm, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
         [teacher.teacher_id, teacher.tenant_id, skData.noSurat, skData.tentang, skData.ttl, skData.tmtFormatted, skData.ptFormatted, skData.niy, skData.unit, skData.bhFormatted, skData.bmFormatted]
       );

       await db.query('UPDATE teachers SET nip = ? WHERE id = ?', [skData.niy, teacher.teacher_id]);

      results.push({ teacher_id: teacher.teacher_id, nama: teacher.nama, niy: skData.niy });
    }

    res.json({ success: true, message: `Berhasil generate ${results.length} SK Guru`, data: results, skipped });
  } catch (error) {
    console.error('Bulk generate error:', error);
    res.status(500).json({ success: false, message: 'Error bulk generate: ' + error.message });
  }
});


router.post('/save-settings', authenticateOperator, async (req, res) => {
  try {
    const { min_service_years, auto_generate_enabled, auto_generate_date } = req.body;

    const existing = await db.query('SELECT id FROM sk_automation_settings LIMIT 1');

    if (existing.length > 0) {
      await db.query(
        'UPDATE sk_automation_settings SET min_service_years = ?, auto_generate_enabled = ?, auto_generate_date = ? WHERE id = ?',
        [min_service_years || 2, auto_generate_enabled ? 1 : 0, auto_generate_date || '01-01', existing[0].id]
      );
    } else {
      await db.query(
        'INSERT INTO sk_automation_settings (min_service_years, auto_generate_enabled, auto_generate_date) VALUES (?, ?, ?)',
        [min_service_years || 2, auto_generate_enabled ? 1 : 0, auto_generate_date || '01-01']
      );
    }

    res.json({ success: true, message: 'Pengaturan berhasil disimpan' });
  } catch (error) {
    console.error('Save settings error:', error);
    res.status(500).json({ success: false, message: 'Error menyimpan pengaturan' });
  }
});

module.exports = router;

