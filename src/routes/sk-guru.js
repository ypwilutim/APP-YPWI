const express = require('express');
const db = require('../../db');
const { authenticateOperator, verifyTenantAccess } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const { execFileSync } = require('child_process');

const router = express.Router();

const hijriMonths = ['Muharam', 'Safar', 'Rabiul Awal', 'Rabiul Akhir', 'Jumadil Awal', 'Jumadil Akhir', 'Rajab', 'Syaban', 'Ramadhan', 'Syawal', 'Dzul Qaidah', 'Dzul Hijjah'];

const idnMonths = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

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

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildHtmlSk(htmlTemplate, data) {
  var html = htmlTemplate
    .replace(/&lt;&lt;/g, '<<')
    .replace(/&gt;&gt;/g, '>>')
    .replace(/&lt;BH>>/g, '<<BH>>');
  html = html
    .replace(/<<NO SURAT>>/g, escapeHtml(data.noSurat))
    .replace(/<<TNTANG>>/g, escapeHtml(data.tentang))
    .replace(/<<TENTANG>>/g, escapeHtml(data.tentang))
    .replace(/<<NAMA>>/g, escapeHtml(data.nama))
    .replace(/<<TTL>>/g, escapeHtml(data.ttl))
    .replace(/<<TMT>>/g, escapeHtml(data.tmtFormatted))
    .replace(/<<PT>>/g, escapeHtml(data.ptFormatted))
    .replace(/<<NIY>>/g, escapeHtml(data.niy))
    .replace(/<<UNIT>>/g, escapeHtml(data.unit))
    .replace(/<<JABATAN>>/g, escapeHtml(data.jabatan))
    .replace(/<<TGL_MULAI>>/g, escapeHtml(data.tglMulai))
    .replace(/<<STATUS>>/g, escapeHtml(data.status))
    .replace(/<<TGL_SELESAI>>/g, escapeHtml(data.tglSelesai))
    .replace(/<<BH>>/g, escapeHtml(data.bhFormatted))
    .replace(/<<BM>>/g, escapeHtml(data.bmFormatted))
    .replace(/<<PERIODE>>/g, escapeHtml(data.periode));
  return html;
}

router.get('/teachers/:id/data', authenticateOperator, async (req, res) => {
   try {
     const teacherId = req.params.id;
  const [teacher] = await db.query(
       'SELECT t.id, t.nama, t.nik, t.nip, t.tempat_lahir, t.tanggal_lahir, t.status_kepegawaian, t.tmt, t.pendidikan_terakhir as pt, ta.tenant_id, ta.jabatan_di_unit as unit, tn.nama_sekolah, tn.id as tenant_pk FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id JOIN tenants tn ON ta.tenant_id = tn.tenant_id WHERE t.id = ? AND t.status_aktif = 1',
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
     
     const nextSkNumber = await peekNextSkNumber(teacher.tenant_id, currentHijri.year);
     const noSurat = 'QR.' + String(nextSkNumber).padStart(3, '0') + '/02/YPWI-LT/' + romanMonth + '/' + currentHijri.year;

     let tmtFormatted = '';
     const tmtDate = parseDate(teacher.tmt);
     if (tmtDate) {
       const month = String(tmtDate.getMonth() + 1).padStart(2, '0');
       tmtFormatted = tmtDate.getFullYear() + '-' + month;
     }
     
     const currMonthIdx = today.getMonth();
     const currYear = today.getFullYear();
     const decMonthIdx = idnMonths.indexOf('Desember');
     const lastDayDec = new Date(currYear, decMonthIdx + 1, 0).getDate();
     const tglSelesai = lastDayDec + ' ' + idnMonths[decMonthIdx] + ' ' + currYear + ' M';
     let tglMulai;
     if (currMonthIdx === 0) {
        tglMulai = '1 ' + idnMonths[0] + ' ' + currYear + ' M';
     } else {
        tglMulai = today.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) + ' M';
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
         pt: teacher.pt || null,
         tmt_formatted: tmtFormatted,
         has_existing_sk: hasExistingSk,
         existing_niy: existingNiy,
         hijri_month_roman: romanMonth,
         hijri_year: currentHijri.year,
         no_surat: noSurat,
         tentang: existingSk?.tentang || ('PENGANGKATAN GURU (' + teacher.nama_sekolah + ')'),
         tgl_mulai: tglMulai,
         tgl_selesai: tglSelesai,
       };

     res.json({ success: true, data: result });
   } catch (error) {
     console.error('Get SK teacher data error:', error);
     res.status(500).json({ success: false, message: 'Error fetching teacher data' });
   }
 });

async function peekNextSkNumber(tenantId, hijriYear) {
  const existing = await db.query(
    'SELECT last_number FROM sk_sequence WHERE tenant_id = ? AND hijri_year = ?',
    [tenantId, hijriYear]
  );

  if (existing.length > 0) {
    return existing[0].last_number + 1;
  }
  return 1;
}

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

function formatJabatan(jabatanDiUnit) {
  if (!jabatanDiUnit) return 'Guru';
  const lower = (jabatanDiUnit || '').toLowerCase();
  const guruKeywords = ['walikelas', 'guru mapel', 'guru', 'wakasek'];
  if (guruKeywords.some(kw => lower.includes(kw))) {
    return 'GURU';
  }
  return jabatanDiUnit;
}

function parseIndoDate(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.trim().split(' ');
  if (parts.length < 3) return null;
  const day = parseInt(parts[0], 10);
  const month = idnMonths.indexOf(parts[1]) + 1;
  const year = parseInt(parts[2], 10);
  if (!day || !month || !year) return null;
  return new Date(year, month - 1, day);
}

function computePeriode(tglMulaiStr, tglSelesaiStr) {
  const startDate = parseIndoDate(tglMulaiStr);
  const endDate = parseIndoDate(tglSelesaiStr);
  if (!startDate || !endDate) return '';

  let totalMonths = (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth());
  if (endDate.getDate() < startDate.getDate()) totalMonths--;

  if (totalMonths < 0) totalMonths = 0;

  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;

  if (years >= 1) {
    return years + ' Tahun' + (months > 0 ? ' ' + months + ' Bulan' : '');
  }
  return months + ' Bulan';
}

function buildSkData(teacher, tentang_type, pt, tmt_custom, nomorUrut, hijriYear, noSuratCustom, tglMulaiCustom, tglSelesaiCustom, tentangCustom) {
   const today = new Date();
   const birthDate = parseDate(teacher.tanggal_lahir) || today;
   const tmtDate = tmt_custom ? parseDate(tmt_custom) : (parseDate(teacher.tmt) || today);
   const hijriToday = gregorianToHijri(today);

   const romanMonth = romanize(hijriMonths.indexOf(hijriToday.month) + 1);
    const noSurat = noSuratCustom || ('QR.' + String(nomorUrut).padStart(3, '0') + '/02/YPWI-LT/' + romanMonth + '/' + hijriToday.year);
    console.log('[SK GURU NO_SURAT]', { noSuratCustom, nomorUrut, noSurat });

   const tentag_map = {
     'baru': 'PENGANGKATAN GURU',
     'kembali': 'PENGANGKATAN KEMBALI GURU',
     'honorer_guru': 'PENGANGKATAN GURU HONOR',
     'honorer_pegawai': 'PENGANGKATAN PEGAWAI HONOR',
     'kontrak_guru': 'PENGANGKATAN GURU KONTRAK',
'kontrak_pegawai': 'PENGANGKATAN PEGAWAI KONTRAK',
    'tetap_guru': 'PENGANGKATAN GURU TETAP',
    'tetap_pegawai': 'PENGANGKATAN PEGAWAI TETAP',
    'pimpinan': 'PENGANGKATAN PIMPINAN'
  };
   const tentag_label = tentag_map[tentang_type] || 'PENGANGKATAN GURU';
   const tentang = tentangCustom ? tentag_label + ' (' + teacher.nama_sekolah + ') - ' + tentangCustom : tentag_label + ' (' + teacher.nama_sekolah + ')';

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
   const niy = (teacher.nip && teacher.nip !== '-' && teacher.nip !== '') ? teacher.nip : (birthDay + birthMonth + birthYear + tmtMonth + tmtYear2digit + tenantId2digit + seq);

   const ptFormatted = teacher.pt || pt || 'S1/PEND. SOSIOLOGI/UNM/2019';

 const bhFormatted = hijriToday.day + ' ' + hijriToday.month + ' ' + hijriToday.year + ' H';
    const bmFormatted = today.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) + ' M';
  
    const currMonthIdx = today.getMonth();
    const currYear = today.getFullYear();
    const decMonthIdx = idnMonths.indexOf('Desember');
    const lastDayDec = new Date(currYear, decMonthIdx + 1, 0).getDate();

    let tglMulai, tglSelesai;
    
    if (tglMulaiCustom) {
      const customStartDate = parseDate(tglMulaiCustom);
      const customEndInput = tglSelesaiCustom || '';
      
      if (customEndInput) {
        tglSelesai = customEndInput;
      } else {
        const endYear = customStartDate.getFullYear();
        const lastDayDecEnd = new Date(endYear, decMonthIdx + 1, 0).getDate();
        tglSelesai = lastDayDecEnd + ' ' + idnMonths[decMonthIdx] + ' ' + endYear + ' M';
      }
      
      tglMulai = customStartDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) + ' M';
    } else if (tglSelesaiCustom) {
      const customEndDate = parseDate(tglSelesaiCustom);
      const startYear = customEndDate.getFullYear();
      const startMonthIdx = customEndDate.getMonth();
      
      const daysInStartMonth = new Date(startYear, startMonthIdx + 1, 0).getDate();
      if (startMonthIdx === decMonthIdx && daysInStartMonth === lastDayDec) {
        tglSelesai = daysInStartMonth + ' ' + idnMonths[decMonthIdx] + ' ' + startYear + ' M';
        tglMulai = '1 Januari ' + startYear + ' M';
      } else {
        const oneYearLater = new Date(startYear, startMonthIdx, daysInStartMonth);
        if (oneYearLater.getMonth() !== startMonthIdx) {
          const prevMonthLastDay = new Date(startYear, startMonthIdx, 0).getDate();
          tglSelesai = prevMonthLastDay + ' ' + idnMonths[startMonthIdx - 1] + ' ' + startYear + ' M';
        } else {
          tglSelesai = daysInStartMonth + ' ' + idnMonths[startMonthIdx] + ' ' + startYear + ' M';
        }
        tglMulai = '1 ' + idnMonths[startMonthIdx] + ' ' + startYear + ' M';
      }
    } else {
      const isPimpinan = tentang_type === 'pimpinan';
      const periodYears = isPimpinan ? 4 : 1;
      const tglSelesaiCalculated = lastDayDec + ' ' + idnMonths[decMonthIdx] + ' ' + (currYear + periodYears - 1) + ' M';
      let tglMulaiCalculated;
      if (currMonthIdx === 0) {
        tglMulaiCalculated = '1 ' + idnMonths[0] + ' ' + currYear + ' M';
      } else {
        tglMulaiCalculated = today.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) + ' M';
      }
      
     tglMulai = tglMulaiCalculated;
       tglSelesai = tglSelesaiCalculated;
     }

    const periode = computePeriode(tglMulai, tglSelesai);

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
        jabatan: formatJabatan(teacher.unit),
        status: getStatusKepegawaian(teacher.status_kepegawaian),
        periode
     };
  }

router.post('/generate', authenticateOperator, async (req, res) => {
    try {
       const { teacher_id, tentang_type, pt, tmt_custom, format, no_surat, tgl_mulai_custom, tgl_selesai_custom, tentang } = req.body;
       console.log('[SK GURU GENERATE INPUT]', { no_surat, tgl_mulai_custom, tgl_selesai_custom, tentang_type });

       if (!teacher_id) {
        return res.status(400).json({ success: false, message: 'teacher_id diperlukan' });
      }

     const [teacher] = await db.query(
       'SELECT t.id, t.nama, t.nik, t.nip, t.tempat_lahir, t.tanggal_lahir, t.status_kepegawaian, t.tmt, t.pendidikan_terakhir as pt, ta.tenant_id, ta.jabatan_di_unit as unit, tn.nama_sekolah, tn.id as tenant_pk FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id JOIN tenants tn ON ta.tenant_id = tn.tenant_id WHERE t.id = ? AND t.status_aktif = 1',
       [teacher_id]
     );

     if (!teacher) {
       return res.status(400).json({ success: false, message: 'Guru tidak ditemukan' });
     }

     if (!verifyTenantAccess(req, teacher.tenant_id)) {
       return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
     }

     const htmlTemplatePath = path.join(__dirname, '../../SKTEMPLATE/test.html');
     if (!fs.existsSync(htmlTemplatePath)) {
       return res.status(404).json({ success: false, message: 'Template SK tidak ditemukan' });
     }

     
     
     const docxTemplatePath = path.join(__dirname, '../../SKTEMPLATE.docx');
     let docxBuf = null;
     
     const today = new Date();
     const hijriToday = gregorianToHijri(today);
     const nomorUrut = await getNextSkNumber(teacher.tenant_id, hijriToday.year);

     const skData = buildSkData(teacher, tentang_type, pt, tmt_custom, nomorUrut, hijriToday.year, no_surat, tgl_mulai_custom, tgl_selesai_custom, tentang);

    console.log('[SK GURU PREVIEW DEBUG]', {
      teacher_nip: teacher.nip,
      tenant_pk: teacher.tenant_pk,
      tenant_id: teacher.tenant_id,
      tanggal_lahir: teacher.tanggal_lahir,
      tmt: teacher.tmt,
      tmt_custom: tmt_custom,
      tentag_type: tentang_type,
      nomorUrut: nomorUrut,
      skData_niy: skData.niy,
      skData_keys: Object.keys(skData)
    });
    
    var htmlTemplate = fs.readFileSync(htmlTemplatePath, 'utf8');
    var htmlData = {
      noSurat: skData.noSurat,
      tentang: skData.tentang,
      nama: teacher.nama,
      ttl: skData.ttl,
      tmtFormatted: skData.tmtFormatted,
      ptFormatted: skData.ptFormatted,
      niy: skData.niy,
      unit: skData.unit,
      jabatan: skData.jabatan,
      tglMulai: skData.tglMulai,
      status: skData.status,
      tglSelesai: skData.tglSelesai,
      bhFormatted: skData.bhFormatted,
      bmFormatted: skData.bmFormatted,
      periode: skData.periode
    };
    var renderedHtml = buildHtmlSk(htmlTemplate, htmlData);
    
    if (fs.existsSync(docxTemplatePath)) {
      const templateContent = fs.readFileSync(docxTemplatePath, 'binary');
      const zip = new PizZip(templateContent);
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
        .replace(/<<UNIT>>/g, skData.unit || '')
        .replace(/&lt;&lt;JABATAN&gt;&gt;/g, skData.jabatan || '')
        .replace(/<<JABATAN>>/g, skData.jabatan || '')
        .replace(/&lt;&lt;TGL_MULAI&gt;&gt;/g, skData.tglMulai || '')
        .replace(/<<TGL_MULAI>>/g, skData.tglMulai || '')
        .replace(/&lt;&lt;STATUS&gt;&gt;/g, skData.status || '')
        .replace(/<<STATUS>>/g, skData.status || '')
        .replace(/&lt;&lt;TGL_SELESAI&gt;&gt;/g, skData.tglSelesai || '')
        .replace(/<<TGL_SELESAI>>/g, skData.tglSelesai || '')
        .replace(/&lt;&lt;BH&gt;&gt;/g, skData.bhFormatted || '')
        .replace(/<<BH>>/g, skData.bhFormatted || '')
        .replace(/&lt;&lt;BM&gt;&gt;/g, skData.bmFormatted || '')
        .replace(/<<BM>>/g, skData.bmFormatted || '')
        .replace(/&lt;&lt;PERIODE&gt;&gt;/g, skData.periode || '')
        .replace(/<<PERIODE>>/g, skData.periode || '');
      zip.file('word/document.xml', docXml);
      docxBuf = zip.generate({ type: 'nodebuffer' });
    }


    const downloadsDir = path.join(__dirname, '../../public/downloads');
    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir, { recursive: true });
    }
 
      const conflict = await db.query('SELECT id FROM teachers WHERE nip = ? AND id != ? AND (nip IS NOT NULL AND nip != \'-\' AND nip != \'\')', [skData.niy, teacher_id]);
      if (conflict.length > 0) {
        return res.status(409).json({ success: false, message: 'NIY sudah digunakan guru lain. Hubungi administrator.' });
      }

      await db.query(
        'INSERT INTO sk_guru (teacher_id, tenant_id, tahun_ajaran_id, no_surat, tentang, ttl, tmt, pt, niy, unit, bh, bm, jabatan, status, tentag_type, tgl_mulai, tgl_selesai, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
        [teacher_id, teacher.tenant_id, req.activeTahunAjaran?.id || null, skData.noSurat, skData.tentang, skData.ttl, skData.tmtFormatted, skData.ptFormatted, skData.niy, skData.unit, skData.bhFormatted, skData.bmFormatted, skData.jabatan, skData.status, tentang_type || 'baru', skData.tglMulai, skData.tglSelesai]
      );

        if ((!teacher.nip || teacher.nip === '-' || teacher.nip === '') && skData.niy) {
          await db.query('UPDATE teachers SET nip = ? WHERE id = ?', [skData.niy, teacher_id]);
        }

      if (format === 'docx' && docxBuf) {
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', 'attachment; filename="SK_Guru.docx"');
        res.setHeader('Content-Length', docxBuf.length);
        return res.send(docxBuf);
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="SK_Guru.pdf"');

      try {
        const skTemplateDir = path.join(__dirname, '../../SKTEMPLATE');
        const tmpHtml = path.join(skTemplateDir, 'sk_guru_' + Date.now() + '.html');
        const tmpPdf = path.join(skTemplateDir, 'sk_guru_' + Date.now() + '.pdf');
        fs.writeFileSync(tmpHtml, renderedHtml);

        execFileSync('google-chrome', [
          '--headless',
          '--disable-gpu',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--print-to-pdf=' + tmpPdf,
          '--default-print-margin-type=NONE',
          '--virtual-time-budget=5000',
          'file://' + tmpHtml
        ], { timeout: 30000, stdio: 'pipe' });

        if (fs.existsSync(tmpPdf)) {
          const pdfBuf = fs.readFileSync(tmpPdf);
          res.setHeader('Content-Length', pdfBuf.length);
          fs.unlinkSync(tmpHtml);
          fs.unlinkSync(tmpPdf);
          return res.send(pdfBuf);
        } else {
          console.warn('PDF conversion failed, falling back to DOCX');
        }
      } catch (convErr) {
        console.error('PDF conversion error:', convErr.message);
      }

      if (docxBuf) {
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', 'attachment; filename="SK_Guru.docx"');
        res.setHeader('Content-Length', docxBuf.length);
        return res.send(docxBuf);
      }

      return res.status(500).json({ success: false, message: 'Gagal generate SK dalam format apapun' });
  } catch (error) {
    console.error('Generate SK error:', error);
    res.status(500).json({ success: false, message: 'Error generating SK: ' + error.message });
  }
});

router.get('/last-number', authenticateOperator, async (req, res) => {
  try {
    const lastSk = await db.query(
      'SELECT no_surat, bm FROM sk_guru ORDER BY created_at DESC LIMIT 1'
    );
    if (!lastSk || lastSk.length === 0) {
      return res.json({ success: true, data: null });
    }
    res.json({ success: true, data: { no_surat: lastSk[0].no_surat || null, bm: lastSk[0].bm || null } });
  } catch (error) {
    console.error('Get last number error:', error);
    res.status(500).json({ success: false, message: 'Error fetching last number' });
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

router.get('/file/:skId', authenticateOperator, async (req, res) => {
  try {
    const skId = req.params.skId;
    const format = req.query.format || 'pdf';

    const [sk] = await db.query('SELECT * FROM sk_guru WHERE id = ?', [skId]);
    if (!sk) {
      return res.status(404).json({ success: false, message: 'SK tidak ditemukan' });
    }

    if (!verifyTenantAccess(req, sk.tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
    }

    const [teacher] = await db.query(
      'SELECT t.id, t.nama, t.nik, t.nip, t.tempat_lahir, t.tanggal_lahir, t.status_kepegawaian, t.tmt, t.pendidikan_terakhir as pt, ta.tenant_id, ta.jabatan_di_unit as unit, tn.nama_sekolah, tn.id as tenant_pk FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id JOIN tenants tn ON ta.tenant_id = tn.tenant_id WHERE t.id = ? AND t.status_aktif = 1',
      [sk.teacher_id]
    );

    const htmlTemplatePath = path.join(__dirname, '../../SKTEMPLATE/test.html');
    const htmlTemplate = fs.readFileSync(htmlTemplatePath, 'utf8');

    const skYear = sk.bm ? parseInt(sk.bm.match(/(\d{4})/)?.[1] || new Date(sk.created_at).getFullYear()) : new Date(sk.created_at).getFullYear();
    const skMonthName = sk.bm ? sk.bm.match(/(\w+)/)?.[1] : idnMonths[new Date(sk.created_at).getMonth()];
    const skMonthIdx = skMonthName ? idnMonths.findIndex(m => m === skMonthName) : new Date(sk.created_at).getMonth();
    const lastDayDec = new Date(skYear, idnMonths.indexOf('Desember') + 1, 0).getDate();
    const tglSelesai = lastDayDec + ' ' + idnMonths[idnMonths.indexOf('Desember')] + ' ' + skYear + ' M';
    let tglMulai;
    if (skMonthIdx === 0 || (skMonthIdx >= 0 && idnMonths[skMonthIdx] === 'Januari')) {
      tglMulai = '1 Januari ' + skYear + ' M';
    } else {
      const dayMatch = sk.bm ? sk.bm.match(/^(\d+)/)?.[1] : null;
      const dayNum = dayMatch ? parseInt(dayMatch) : new Date(sk.created_at).getDate();
      tglMulai = dayNum + ' ' + idnMonths[skMonthIdx >= 0 ? skMonthIdx : 0] + ' ' + skYear + ' M';
    }
    var htmlData = {
      noSurat: sk.no_surat || '',
      tentang: sk.tentang || '',
      nama: teacher ? (teacher.nama || '') : (sk.niy || ''),
      ttl: sk.ttl || '',
      tmtFormatted: sk.tmt || '',
      ptFormatted: sk.pt || '',
      niy: sk.niy || '',
      unit: sk.unit || '',
      jabatan: sk.jabatan || (teacher ? formatJabatan(teacher.unit) : 'Guru'),
      tglMulai: tglMulai,
      status: sk.status || (teacher ? getStatusKepegawaian(teacher.status_kepegawaian) : ''),
      tglSelesai: tglSelesai,
      bhFormatted: sk.bh || '',
      bmFormatted: sk.bm || '',
      periode: computePeriode(tglMulai, tglSelesai)
    };
    var renderedHtml = buildHtmlSk(htmlTemplate, htmlData);

    if (format === 'docx') {
      const docxTemplatePath = path.join(__dirname, '../../SKTEMPLATE.docx');
      if (fs.existsSync(docxTemplatePath)) {
        const templateContent = fs.readFileSync(docxTemplatePath, 'binary');
        const zip = new PizZip(templateContent);
        let docXml = zip.file('word/document.xml').asText();
        docXml = docXml
          .replace(/&lt;&lt;NO SURAT&gt;&gt;/g, sk.no_surat || '')
          .replace(/<<NO SURAT>>/g, sk.no_surat || '')
          .replace(/&lt;&lt;TENTANG&gt;&gt;/g, sk.tentang || '')
          .replace(/<<TENTANG>>/g, sk.tentang || '')
          .replace(/&lt;&lt;NAMA&gt;&gt;/g, teacher ? (teacher.nama || '') : '')
          .replace(/<<NAMA>>/g, teacher ? (teacher.nama || '') : '')
          .replace(/&lt;&lt;TTL&gt;&gt;/g, sk.ttl || '')
          .replace(/<<TTL>>/g, sk.ttl || '')
          .replace(/&lt;&lt;TMT&gt;&gt;/g, sk.tmt || '')
          .replace(/<<TMT>>/g, sk.tmt || '')
          .replace(/&lt;&lt;PT&gt;&gt;/g, sk.pt || '')
          .replace(/<<PT>>/g, sk.pt || '')
          .replace(/&lt;&lt;NIY&gt;&gt;/g, sk.niy || '')
          .replace(/<<NIY>>/g, sk.niy || '')
          .replace(/&lt;&lt;UNIT&gt;&gt;/g, sk.unit || '')
          .replace(/<<UNIT>>/g, sk.unit || '')
          .replace(/&lt;&lt;JABATAN&gt;&gt;/g, sk.jabatan || (teacher ? formatJabatan(teacher.unit) : 'Guru'))
          .replace(/<<JABATAN>>/g, sk.jabatan || (teacher ? formatJabatan(teacher.unit) : 'Guru'))
          .replace(/&lt;&lt;TGL_MULAI&gt;&gt;/g, tglMulai)
          .replace(/<<TGL_MULAI>>/g, tglMulai)
          .replace(/&lt;&lt;STATUS&gt;&gt;/g, sk.status || (teacher ? getStatusKepegawaian(teacher.status_kepegawaian) : ''))
          .replace(/<<STATUS>>/g, sk.status || (teacher ? getStatusKepegawaian(teacher.status_kepegawaian) : ''))
          .replace(/&lt;&lt;TGL_SELESAI&gt;&gt;/g, tglSelesai)
          .replace(/<<TGL_SELESAI>>/g, tglSelesai)
          .replace(/&lt;&lt;BH&gt;&gt;/g, sk.bh || '')
          .replace(/<<BH>>/g, sk.bh || '')
          .replace(/&lt;&lt;BM&gt;&gt;/g, sk.bm || '')
          .replace(/<<BM>>/g, sk.bm || '')
          .replace(/&lt;&lt;PERIODE&gt;&gt;/g, htmlData.periode || '')
          .replace(/<<PERIODE>>/g, htmlData.periode || '');
        zip.file('word/document.xml', docXml);
        const docxBuf = zip.generate({ type: 'nodebuffer' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', 'attachment; filename="SK_Guru.docx"');
        res.setHeader('Content-Length', docxBuf.length);
        return res.send(docxBuf);
      }
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="SK_Guru.pdf"');

    try {
      const skTemplateDir = path.join(__dirname, '../../SKTEMPLATE');
      const tmpHtmlPath = path.join(skTemplateDir, 'sk_' + Date.now() + '.html');
      const tmpPdfPath = path.join(skTemplateDir, 'sk_' + Date.now() + '.pdf');
      fs.writeFileSync(tmpHtmlPath, renderedHtml);

      execFileSync('google-chrome', [
        '--headless', '--disable-gpu', '--no-sandbox',
        '--disable-dev-shm-usage',
        '--print-to-pdf=' + tmpPdfPath,
        '--default-print-margin-type=NONE',
        '--virtual-time-budget=5000',
        'file://' + tmpHtmlPath
      ], { timeout: 30000, stdio: 'pipe' });

      if (fs.existsSync(tmpPdfPath)) {
        const pdfBuf = fs.readFileSync(tmpPdfPath);
        res.setHeader('Content-Length', pdfBuf.length);
        fs.unlinkSync(tmpHtmlPath);
        fs.unlinkSync(tmpPdfPath);
        return res.send(pdfBuf);
      }
      console.warn('PDF conversion failed for download');
      fs.unlinkSync(tmpHtmlPath);
    } catch (convErr) {
      console.error('PDF conversion error:', convErr.message);
    }

    const docxTemplatePath = path.join(__dirname, '../../SKTEMPLATE.docx');
    if (fs.existsSync(docxTemplatePath)) {
      const skYear = sk.bm ? parseInt(sk.bm.match(/(\d{4})/)?.[1] || new Date(sk.created_at).getFullYear()) : new Date(sk.created_at).getFullYear();
      const skMonthName = sk.bm ? sk.bm.match(/(\w+)/)?.[1] : idnMonths[new Date(sk.created_at).getMonth()];
      const skMonthIdx = skMonthName ? idnMonths.findIndex(m => m === skMonthName) : new Date(sk.created_at).getMonth();
      const lastDayDec = new Date(skYear, idnMonths.indexOf('Desember') + 1, 0).getDate();
      const docxTglSelesai = lastDayDec + ' ' + idnMonths[idnMonths.indexOf('Desember')] + ' ' + skYear + ' M';
      let docxTglMulai;
      if (skMonthIdx === 0 || (skMonthIdx >= 0 && idnMonths[skMonthIdx] === 'Januari')) {
        docxTglMulai = '1 Januari ' + skYear + ' M';
      } else {
        const dayMatch = sk.bm ? sk.bm.match(/^(\d+)/)?.[1] : null;
        const dayNum = dayMatch ? parseInt(dayMatch) : new Date(sk.created_at).getDate();
        docxTglMulai = dayNum + ' ' + idnMonths[skMonthIdx >= 0 ? skMonthIdx : 0] + ' ' + skYear + ' M';
      }
      
      const templateContent = fs.readFileSync(docxTemplatePath, 'binary');
      const zip = new PizZip(templateContent);
      let docXml = zip.file('word/document.xml').asText();
      docXml = docXml
        .replace(/&lt;&lt;NO SURAT&gt;&gt;/g, sk.no_surat || '')
        .replace(/<<NO SURAT>>/g, sk.no_surat || '')
        .replace(/&lt;&lt;TENTANG&gt;&gt;/g, sk.tentang || '')
        .replace(/<<TENTANG>>/g, sk.tentang || '')
        .replace(/&lt;&lt;NAMA&gt;&gt;/g, teacher ? (teacher.nama || '') : '')
        .replace(/<<NAMA>>/g, teacher ? (teacher.nama || '') : '')
        .replace(/&lt;&lt;TTL&gt;&gt;/g, sk.ttl || '')
        .replace(/<<TTL>>/g, sk.ttl || '')
        .replace(/&lt;&lt;TMT&gt;&gt;/g, sk.tmt || '')
        .replace(/<<TMT>>/g, sk.tmt || '')
        .replace(/&lt;&lt;PT&gt;&gt;/g, sk.pt || '')
        .replace(/<<PT>>/g, sk.pt || '')
        .replace(/&lt;&lt;NIY&gt;&gt;/g, sk.niy || '')
        .replace(/<<NIY>>/g, sk.niy || '')
        .replace(/&lt;&lt;UNIT&gt;&gt;/g, sk.unit || '')
        .replace(/<<UNIT>>/g, sk.unit || '')
        .replace(/&lt;&lt;JABATAN&gt;&gt;/g, sk.jabatan || (teacher ? teacher.unit || 'Guru' : 'Guru'))
        .replace(/<<JABATAN>>/g, sk.jabatan || (teacher ? teacher.unit || 'Guru' : 'Guru'))
        .replace(/&lt;&lt;TGL_MULAI&gt;&gt;/g, docxTglMulai)
        .replace(/<<TGL_MULAI>>/g, docxTglMulai)
        .replace(/&lt;&lt;STATUS&gt;&gt;/g, sk.status || '')
        .replace(/<<STATUS>>/g, sk.status || '')
        .replace(/&lt;&lt;TGL_SELESAI&gt;&gt;/g, docxTglSelesai)
        .replace(/<<TGL_SELESAI>>/g, docxTglSelesai)
        .replace(/&lt;&lt;BH&gt;&gt;/g, sk.bh || '')
        .replace(/<<BH>>/g, sk.bh || '')
        .replace(/&lt;&lt;BM&gt;&gt;/g, sk.bm || '')
        .replace(/<<BM>>/g, sk.bm || '');
      zip.file('word/document.xml', docXml);
      const docxBuf = zip.generate({ type: 'nodebuffer' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', 'attachment; filename="SK_Guru.docx"');
      res.setHeader('Content-Length', docxBuf.length);
      return res.send(docxBuf);
    }

    return res.status(500).json({ success: false, message: 'Tidak dapat generate file SK' });
  } catch (error) {
    console.error('Download SK error:', error);
    res.status(500).json({ success: false, message: 'Error generating SK file: ' + error.message });
  }
});

router.post('/preview', authenticateOperator, async (req, res) => {
   try {
      const { teacher_id, tentang_type, pt, tmt_custom, no_surat, tgl_mulai_custom, tgl_selesai_custom, tentang } = req.body;

      if (!teacher_id) {
        return res.status(400).json({ success: false, message: 'teacher_id diperlukan' });
      }

     const [teacher] = await db.query(
       'SELECT t.id, t.nama, t.nik, t.nip, t.tempat_lahir, t.tanggal_lahir, t.status_kepegawaian, t.tmt, t.pendidikan_terakhir as pt, ta.tenant_id, ta.jabatan_di_unit as unit, tn.nama_sekolah, tn.id as tenant_pk FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id JOIN tenants tn ON ta.tenant_id = tn.tenant_id WHERE t.id = ? AND t.status_aktif = 1',
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
     const nomorUrut = await peekNextSkNumber(teacher.tenant_id, hijriToday.year);

     const skData = buildSkData(teacher, tentang_type, pt, tmt_custom, nomorUrut, hijriToday.year, no_surat, tgl_mulai_custom, tgl_selesai_custom, tentang);

    console.log('[SK GURU PREVIEW DEBUG]', {
      teacher_nip: teacher.nip,
      tenant_pk: teacher.tenant_pk,
      tenant_id: teacher.tenant_id,
      tanggal_lahir: teacher.tanggal_lahir,
      tmt: teacher.tmt,
      tmt_custom: tmt_custom,
      tentag_type: tentang_type,
      nomorUrut: nomorUrut,
      skData_niy: skData.niy,
      skData_keys: Object.keys(skData)
    });

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
          'INSERT INTO sk_guru (teacher_id, tenant_id, tahun_ajaran_id, no_surat, tentang, ttl, tmt, pt, niy, unit, bh, bm, jabatan, status, tentag_type, tgl_mulai, tgl_selesai, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
          [teacher.teacher_id, teacher.tenant_id, req.activeTahunAjaran?.id || null, skData.noSurat, skData.tentang, skData.ttl, skData.tmtFormatted, skData.ptFormatted, skData.niy, skData.unit, skData.bhFormatted, skData.bmFormatted, skData.jabatan, skData.status, tentang_type || 'baru', skData.tglMulai, skData.tglSelesai]
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

/**
 * GET /api/sk-guru/settings
 * Get automation settings (toggle state, min_service_years, auto_generate_date)
 */
router.get('/settings', authenticateOperator, async (req, res) => {
  try {
    const settings = await db.query('SELECT * FROM sk_automation_settings LIMIT 1');
    if (!settings.length) {
      await db.query(
        'INSERT INTO sk_automation_settings (min_service_years, auto_generate_enabled, auto_generate_date) VALUES (?, ?, ?)',
        [2, 1, '01-01']
      );
      const fresh = await db.query('SELECT * FROM sk_automation_settings LIMIT 1');
      return res.json({ success: true, data: fresh[0] });
    }
    res.json({ success: true, data: settings[0] });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ success: false, message: 'Error mengambil pengaturan' });
  }
});

/**
 * GET /api/sk-guru/approval
 * List teachers pending approval (December flow)
 */
router.get('/approval', authenticateOperator, async (req, res) => {
  try {
    const today = new Date();
    const currentMonth = today.getMonth() + 1;

    let teachers;
    if (req.user.role === 'admin') {
      const allTenants = await db.query('SELECT tenant_id FROM tenants');
      const placeholders = allTenants.map(() => '?').join(',');
      teachers = await db.query(
        `SELECT t.id as teacher_id, t.nama, t.tanggal_lahir, t.tmt, t.status_kepegawaian,
         t.tempat_lahir, t.pendidikan_terakhir as pt, ta.tenant_id, ta.jabatan_di_unit as unit,
         tn.nama_sekolah, tn.id as tenant_pk
         FROM teachers t
         JOIN teacher_assignments ta ON t.id = ta.teacher_id
         JOIN tenants tn ON ta.tenant_id = tn.tenant_id
         WHERE t.status_aktif = 1 AND t.nip IS NULL AND tn.tenant_id IN (${placeholders})
         ORDER BY tn.nama_sekolah, t.nama`,
        allTenants.map(t => t.tenant_id)
      );
    } else {
      let tenantId = req.query.tenant_id || null;
      if (!tenantId && req.user.role === 'guru') {
        const adminAssignments = (req.user.assignments || []).filter(function(a) {
          const roles = ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
          return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
        });
        if (adminAssignments.length === 1) {
          tenantId = adminAssignments[0].tenant_id;
        }
      }
      if (!tenantId || !verifyTenantAccess(req, tenantId)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }
      teachers = await db.query(
        `SELECT t.id as teacher_id, t.nama, t.tanggal_lahir, t.tmt, t.status_kepegawaian,
         t.tempat_lahir, t.pendidikan_terakhir as pt, ta.tenant_id, ta.jabatan_di_unit as unit,
         tn.nama_sekolah, tn.id as tenant_pk
         FROM teachers t
         JOIN teacher_assignments ta ON t.id = ta.teacher_id
         JOIN tenants tn ON ta.tenant_id = tn.tenant_id
         WHERE ta.tenant_id = ? AND t.status_aktif = 1 AND t.nip IS NULL
         ORDER BY t.nama`,
        [tenantId]
      );
    }

    const existingSettings = await db.query('SELECT min_service_years FROM sk_automation_settings LIMIT 1');
    const minYears = existingSettings.length ? existingSettings[0].min_service_years : 2;

    const results = [];
    for (const teacher of teachers) {
      const tmtDate = parseDate(teacher.tmt);
      const yearsOfService = tmtDate ? (today.getFullYear() - tmtDate.getFullYear()) : 0;
      const qualified = yearsOfService >= minYears;
      const existingApproval = await db.query(
        'SELECT status FROM sk_approval_queue WHERE teacher_id = ? AND tenant_id = ? AND tentang_type = ? ORDER BY created_at DESC LIMIT 1',
        [teacher.teacher_id, teacher.tenant_id || teacher.tenant_id, 'baru']
      );
      const alreadyGenerated = await db.query(
        'SELECT id FROM sk_guru WHERE teacher_id = ? AND tentag_type = ? LIMIT 1',
        [teacher.teacher_id, 'baru']
      );
      results.push({
        teacher_id: teacher.teacher_id,
        nama: teacher.nama,
        tmt: teacher.tmt || '',
        years_of_service: yearsOfService,
        qualified: qualified,
        already_generated: alreadyGenerated.length > 0,
        approval_status: existingApproval.length ? existingApproval[0].status : null,
        tenant_name: teacher.nama_sekolah,
        unit: teacher.unit,
        pendidikan: teacher.pt
      });
    }

    res.json({ success: true, data: results, current_month: currentMonth });
  } catch (error) {
    console.error('Get approval list error:', error);
    res.status(500).json({ success: false, message: 'Error mengambil daftar persetujuan' });
  }
});

/**
 * POST /api/sk-guru/approve
 * Approve selected teachers for Jan 1st auto-generation
 */
router.post('/approve', authenticateOperator, async (req, res) => {
  try {
    const { teacher_ids, tentang_type, tenant_id } = req.body;

    if (!Array.isArray(teacher_ids) || teacher_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'teacher_ids diperlukan' });
    }

    let targetTenantId = tenant_id;
    if (!tenant_id && req.user.role === 'admin') {
      targetTenantId = null;
    } else {
      if (!verifyTenantAccess(req, targetTenantId)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
      }
    }

    const today = new Date();
    const tmtMonth = today.getMonth() + 1;

    const results = [];
    for (const teacherId of teacher_ids) {
      const teacher = await db.query(
        'SELECT t.id, t.nip, ta.tenant_id FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id WHERE t.id = ?',
        [teacherId]
      );

      if (!teacher || !teacher[0]) {
        results.push({ teacher_id: teacherId, status: 'not_found' });
        continue;
      }

      if (targetTenantId && teacher[0].tenant_id !== targetTenantId) {
        results.push({ teacher_id: teacherId, status: 'wrong_tenant' });
        continue;
      }

      if (teacher[0].nip && teacher[0].nip !== '-') {
        results.push({ teacher_id: teacherId, status: 'existing_nip' });
        continue;
      }

      await db.query(
        'INSERT INTO sk_approval_queue (teacher_id, tenant_id, status, tentang_type) VALUES (?, ?, ?, ?)',
        [teacherId, teacher[0].tenant_id, 'approved', tentang_type || 'baru']
      );

      results.push({ teacher_id: teacherId, status: 'approved' });
    }

    res.json({ success: true, message: `${results.filter(r => r.status === 'approved').length} guru disetujui`, data: results });
  } catch (error) {
    console.error('Approve SK error:', error);
    res.status(500).json({ success: false, message: 'Error menyetujui guru: ' + error.message });
  }
});

module.exports = router;

