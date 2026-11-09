const express = require('express');
const db = require('../../db');
const { authenticateToken, authenticateOperator, verifyTenantAccess, isPrivilegedOperator } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const { generateSkPdf } = require('../utils/generateSkPdf');
const {
  isDriveEnabled,
  createDriveClient,
  ensureFolderPath,
  uploadBuffer
} = require('../utils/googleDrive');

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
  // Handle DD/MM/YYYY or MM/DD/YYYY or DD-MM-YYYY or MM-DD-YYYY
  if (typeof dateStr === 'string' && /^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/.test(dateStr)) {
    const parts = dateStr.split(/[\/\-]/);
    const a = parseInt(parts[0], 10);
    const b = parseInt(parts[1], 10);
    const year = parseInt(parts[2], 10);
    // If a > 12, it's DD/MM/YYYY (day first, Indonesian)
    if (a > 12) {
      const d = new Date(year, b - 1, a);
      return isNaN(d.getTime()) ? null : d;
    }
    // If b > 12, it's MM/DD/YYYY (month first, US)
    if (b > 12) {
      const d = new Date(year, a - 1, b);
      return isNaN(d.getTime()) ? null : d;
    }
    // Both <= 12: ambiguous, assume DD/MM/YYYY (Indonesian default)
    const d = new Date(year, b - 1, a);
    return isNaN(d.getTime()) ? null : d;
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
       'SELECT t.id, t.nama, t.nik, t.nip, t.tempat_lahir, t.tanggal_lahir, t.status_kepegawaian, t.tmt, t.pendidikan_terakhir as pt, ta.id as assignment_id, ta.created_at as assignment_created_at, ta.tenant_id, ta.jabatan_di_unit as unit, tn.nama_sekolah, tn.id as tenant_pk FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id JOIN tenants tn ON ta.tenant_id = tn.tenant_id WHERE t.id = ? AND t.status_aktif = 1 ORDER BY ta.created_at ASC, ta.id ASC LIMIT 1',
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
          tgl_mulai_month: currYear + '-' + String(currMonthIdx + 1).padStart(2, '0'),
          tgl_selesai_month: currYear + '-12',
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

function getSkStatusLabel(tentangType) {
  const map = {
    'baru': 'Guru',
    'kembali': 'Guru Kembali',
    'honorer_guru': 'Guru Honor',
    'honorer_pegawai': 'Pegawai Honor',
    'kontrak_guru': 'Guru Kontrak',
    'kontrak_pegawai': 'Pegawai Kontrak',
    'tetap_guru': 'Guru Tetap',
    'tetap_pegawai': 'Pegawai Tetap',
    'pimpinan': 'Pimpinan'
  };
  return map[tentangType] || 'Guru';
}

async function archiveSkPdfToDrive(teacher, skData, pdfBuf, tentangType) {
  if (!isDriveEnabled()) return null;
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!rootFolderId) {
    console.warn('[GOOGLE DRIVE] GOOGLE_DRIVE_ROOT_FOLDER_ID is not set');
    return null;
  }
  try {
    const drive = createDriveClient();
    const year = String(new Date().getFullYear());
    const folderId = await ensureFolderPath(drive, rootFolderId, [
      teacher.nama_sekolah || 'Tenant',
      teacher.nama || 'Guru',
      year
    ]);
    const statusLabel = getSkStatusLabel(tentangType);
    const periodeLower = (skData.periode || '').toLowerCase();
    const fileName = `SK ${teacher.nama} ${statusLabel} Periode ${periodeLower} tahun ${year}.pdf`;
    const upload = await uploadBuffer({
      buffer: pdfBuf,
      name: fileName,
      mimeType: 'application/pdf',
      parentId: folderId
    });
    if (!upload || !upload.ok) return null;
    return {
      drive_file_id: upload.id,
      drive_file_name: upload.name,
      drive_folder_id: folderId,
      drive_web_view_link: upload.webViewLink
    };
  } catch (error) {
    console.error('[GOOGLE DRIVE] archive error:', error.message);
    return null;
  }
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
  const startDate = parseIndoDate(tglMulaiStr) || parseDate(tglMulaiStr);
  const endDate = parseIndoDate(tglSelesaiStr) || parseDate(tglSelesaiStr);
  if (!startDate || !endDate) return '';

  let years = endDate.getFullYear() - startDate.getFullYear();
  let months = endDate.getMonth() - startDate.getMonth();
  let days = endDate.getDate() - startDate.getDate();

  // Jika hari akhir kurang dari hari mulai, kurangi 1 bulan
  if (days < 0) {
    months--;
  }

  let totalMonths = (years * 12) + months;

  // Penyesuaian agar tanggal 1 Januari s.d 31 Desember terbaca genap 1 Tahun / 12 Bulan
  if (days >= -1 && startDate.getDate() === 1 && endDate.getDate() === 31 && startDate.getMonth() === 0 && endDate.getMonth() === 11) {
    totalMonths = 12;
  } else {
    totalMonths += 1; // Inklusif masa kerja
  }

  if (totalMonths < 0) totalMonths = 0;

  const calcYears = Math.floor(totalMonths / 12);
  const calcMonths = totalMonths % 12;

  if (calcYears >= 1) {
    return calcYears + ' Tahun' + (calcMonths > 0 ? ' ' + calcMonths + ' Bulan' : '');
  }
  return calcMonths + ' Bulan';
}

function pickPrimaryAssignment(rows) {
  if (!rows || !rows.length) return null;
  let primary = rows[0];
  for (let i = 1; i < rows.length; i++) {
    const cur = rows[i];
    const curCreated = new Date(cur.assignment_created_at || 0).getTime();
    const priCreated = new Date(primary.assignment_created_at || 0).getTime();
    if (curCreated < priCreated || (curCreated === priCreated && (cur.assignment_id || 0) < (primary.assignment_id || 0))) {
      primary = cur;
    }
  }
  return primary;
}

function formatJabatanList(str) {
  if (!str) return '';
  const parts = str.split(' / ').map(s => s.trim()).filter(Boolean);
  const formatted = parts.map(p => formatJabatan(p));
  const seen = new Set();
  const out = [];
  for (const f of formatted) {
    if (f && !seen.has(f)) {
      seen.add(f);
      out.push(f);
    }
  }
  return out.join(' / ');
}

async function buildSkData(teacher, tentang_type, pt, tmt_custom, nomorUrut, hijriYear, noSuratCustom, tglMulaiCustom, tglSelesaiCustom, tentangCustom, periodeCustom, jabatanCustom) {
   const today = new Date();
   const birthDate = parseDate(teacher.tanggal_lahir) || today;
   const tmtDate = tmt_custom ? parseDate(tmt_custom) : (parseDate(teacher.tmt) || today);
    let allJabatan = teacher.jabatan_di_unit || teacher.unit || '';
    if (teacher.id) {
      try {
        const assigns = await db.query('SELECT jabatan_di_unit FROM teacher_assignments WHERE teacher_id = ?', [teacher.id]);
        if (assigns && assigns.length) allJabatan = assigns.map(a => a.jabatan_di_unit).filter(Boolean).join(' / ');
      } catch (e) {}
    }
   const hijriToday = gregorianToHijri(today);

   const romanMonth = romanize(hijriMonths.indexOf(hijriToday.month) + 1);
    const noSurat = noSuratCustom || ('QR.' + String(nomorUrut).padStart(3, '0') + '/02/YPWI-LT/' + romanMonth + '/' + hijriToday.year);
    console.log('[SK GURU NO_SURAT]', { noSuratCustom, nomorUrut, noSurat });

    const tentag_map = {
      'baru': 'PENGANGKATAN GURU',
      'guru': 'PENGANGKATAN GURU',
      'jabatan': 'PENGANGKATAN JABATAN',
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
    const tentang = tentangCustom ? tentangCustom : tentag_label + ' (' + teacher.nama_sekolah + ')';

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

    const ptFormatted = pt || teacher.pt || 'S1/PEND. SOSIOLOGI/UNM/2019';

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
        const parsedEnd = parseDate(customEndInput);
        tglSelesai = parsedEnd
          ? parsedEnd.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) + ' M'
          : customEndInput;
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
    const leaderSource = allJabatan.toLowerCase();
    const isLeader = ['pimpinan', 'kepala', 'ketua'].some(k => leaderSource.includes(k));
      const periodYears = isLeader ? 4 : 1;
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

    const periode = (periodeCustom && String(periodeCustom).trim()) ? String(periodeCustom).trim() : computePeriode(tglMulai, tglSelesai);

    const tglMulaiDate = parseIndoDate(tglMulai) || parseDate(tglMulai);
    const tglSelesaiDate = parseIndoDate(tglSelesai) || parseDate(tglSelesai);
    const tglMulaiMonth = tglMulaiDate ? tglMulaiDate.getFullYear() + '-' + String(tglMulaiDate.getMonth() + 1).padStart(2, '0') : '';
    const tglSelesaiMonth = tglSelesaiDate ? tglSelesaiDate.getFullYear() + '-' + String(tglSelesaiDate.getMonth() + 1).padStart(2, '0') : '';
    const tmtMonthValue = tmtDate ? tmtDate.getFullYear() + '-' + String(tmtDate.getMonth() + 1).padStart(2, '0') : '';

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
         jabatan: (tentang_type === 'baru' || tentang_type === 'guru') ? 'GURU' : (jabatanCustom ? jabatanCustom : formatJabatanList(teacher.unit)),
        status: getStatusKepegawaian(teacher.status_kepegawaian),
        periode,
        tglMulaiMonth,
        tglSelesaiMonth,
        tmtMonth: tmtMonthValue
      };
  }

router.post('/generate', authenticateToken, async (req, res) => {
    try {
       const { teacher_id, tentang_type, pt, tmt_custom, format, no_surat, tgl_mulai_custom, tgl_selesai_custom, tentang, periode_custom, periodeCustom } = req.body;
       // Support both snake_case and camelCase
       const periodeCustomValue = periode_custom || periodeCustom;
       console.log('[SK GURU GENERATE INPUT]', { no_surat, tgl_mulai_custom, tgl_selesai_custom, tentang_type, periode_custom: periodeCustomValue });

       if (!teacher_id) {
        return res.status(400).json({ success: false, message: 'teacher_id diperlukan' });
      }

     const [teacher] = await db.query(
       'SELECT t.id, t.nama, t.nik, t.nip, t.tempat_lahir, t.tanggal_lahir, t.status_kepegawaian, t.tmt, t.pendidikan_terakhir as pt, ta.id as assignment_id, ta.created_at as assignment_created_at, ta.tenant_id, ta.jabatan_di_unit as unit, tn.nama_sekolah, tn.id as tenant_pk FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id JOIN tenants tn ON ta.tenant_id = tn.tenant_id WHERE t.id = ? AND t.status_aktif = 1 ORDER BY ta.created_at ASC, ta.id ASC LIMIT 1',
       [teacher_id]
     );

     if (!teacher) {
       return res.status(400).json({ success: false, message: 'Guru tidak ditemukan' });
     }

      if (!isPrivilegedOperator(req.user)) {
        if (parseInt(teacher_id, 10) !== parseInt(req.user.guru_id, 10)) {
          return res.status(403).json({ success: false, message: 'Akses ditolak untuk guru ini' });
        }
      } else if (!verifyTenantAccess(req, teacher.tenant_id)) {
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

      const skData = await buildSkData(teacher, tentang_type, pt, tmt_custom, nomorUrut, hijriToday.year, no_surat, tgl_mulai_custom, tgl_selesai_custom, tentang, periodeCustomValue, undefined);

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

      const insertResult = await db.query(
        'INSERT INTO sk_guru (teacher_id, tenant_id, tahun_ajaran_id, no_surat, tentang, ttl, tmt, pt, niy, unit, bh, bm, jabatan, status, tentag_type, tgl_mulai, tgl_selesai, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
        [teacher_id, teacher.tenant_id, req.activeTahunAjaran?.id || null, skData.noSurat, skData.tentang, skData.ttl, skData.tmtFormatted, skData.ptFormatted, skData.niy, skData.unit, skData.bhFormatted, skData.bmFormatted, skData.jabatan, skData.status, tentang_type || 'baru', skData.tglMulai, skData.tglSelesai]
      );
      const newSkId = insertResult && insertResult.insertId ? insertResult.insertId : null;

        if ((!teacher.nip || teacher.nip === '-' || teacher.nip === '') && skData.niy) {
          await db.query('UPDATE teachers SET nip = ? WHERE id = ?', [skData.niy, teacher_id]);
        }

      let pdfBuf = null;
      try {
        pdfBuf = await generateSkPdf(htmlData);
      } catch (pdfErr) {
        console.error('PDF generation error:', pdfErr.message);
      }

      // Archive generated PDF to Google Drive (if configured)
      if (pdfBuf) {
        try {
          const driveMeta = await archiveSkPdfToDrive(teacher, skData, pdfBuf, tentang_type || 'baru');
          if (driveMeta && newSkId) {
            await db.query(
              'UPDATE sk_guru SET drive_file_id = ?, drive_file_name = ?, drive_folder_id = ?, drive_web_view_link = ?, drive_uploaded_at = NOW() WHERE id = ?',
              [driveMeta.drive_file_id, driveMeta.drive_file_name, driveMeta.drive_folder_id, driveMeta.drive_web_view_link, newSkId]
            );
          }
        } catch (driveErr) {
          console.error('Drive archive error:', driveErr.message);
        }
      }

      if (format === 'docx' && docxBuf) {
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', 'attachment; filename="SK_Guru.docx"');
        res.setHeader('Content-Length', docxBuf.length);
        return res.send(docxBuf);
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="SK_Guru.pdf"');

      if (pdfBuf) {
        res.setHeader('Content-Length', pdfBuf.length);
        res.end(pdfBuf);
        return;
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

router.get('/file/:skId', authenticateToken, async (req, res) => {
  try {
    const skId = req.params.skId;
    const format = req.query.format || 'pdf';
    const viewMode = req.query.view === '1' || req.query.view === 'true';

    const [sk] = await db.query('SELECT * FROM sk_guru WHERE id = ?', [skId]);
    if (!sk) {
      return res.status(404).json({ success: false, message: 'SK tidak ditemukan' });
    }

    if (!isPrivilegedOperator(req.user)) {
      const teacherId = req.user.guru_id || (req.user.assignments?.[0]?.teacher_id);
      if (!teacherId || parseInt(sk.teacher_id, 10) !== parseInt(teacherId, 10)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak untuk SK ini' });
      }
    } else if (!verifyTenantAccess(req, sk.tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
    }

    const [teacher] = await db.query(
      'SELECT t.id, t.nama, t.nik, t.nip, t.tempat_lahir, t.tanggal_lahir, t.status_kepegawaian, t.tmt, t.pendidikan_terakhir as pt, ta.id as assignment_id, ta.created_at as assignment_created_at, ta.tenant_id, ta.jabatan_di_unit as unit, tn.nama_sekolah, tn.id as tenant_pk FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id JOIN tenants tn ON ta.tenant_id = tn.tenant_id WHERE t.id = ? AND t.status_aktif = 1 ORDER BY ta.created_at ASC, ta.id ASC LIMIT 1',
      [sk.teacher_id]
    );

    const htmlTemplatePath = path.join(__dirname, '../../SKTEMPLATE/test.html');
    const htmlTemplate = fs.readFileSync(htmlTemplatePath, 'utf8');

    // Use stored custom dates from DB (tgl_mulai, tgl_selesai) instead of recomputing from hijri date
    const tglMulai = sk.tgl_mulai || '1 Januari ' + new Date(sk.created_at).getFullYear() + ' M';
    const tglSelesai = sk.tgl_selesai || '31 Desember ' + new Date(sk.created_at).getFullYear() + ' M';

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
      periode: sk.periode || computePeriode(tglMulai, tglSelesai)
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
    res.setHeader('Content-Disposition', `${viewMode ? 'inline' : 'attachment'}; filename="SK_Guru.pdf"`);

    // Generate PDF using pdfkit (no Chrome dependency)
    try {
      const pdfBuf = await generateSkPdf(htmlData);
      res.setHeader('Content-Length', pdfBuf.length);
      res.end(pdfBuf);
      return;
    } catch (pdfErr) {
      console.error('PDF generation error:', pdfErr.message);
    }

  } catch (error) {
    console.error('Download SK error:', error);
    res.status(500).json({ success: false, message: 'Error generating SK file: ' + error.message });
  }
});

router.post('/preview', authenticateToken, async (req, res) => {
   try {
       const { teacher_id, tentang_type, pt, tmt_custom, no_surat, tgl_mulai_custom, tgl_selesai_custom, tentang, periode_custom, periodeCustom } = req.body;
       const periodeCustomValue = periode_custom || periodeCustom;

  if (!teacher_id) {
        return res.status(400).json({ success: false, message: 'teacher_id diperlukan' });
      }

     const [teacher] = await db.query(
       'SELECT t.id, t.nama, t.nik, t.nip, t.tempat_lahir, t.tanggal_lahir, t.status_kepegawaian, t.tmt, t.pendidikan_terakhir as pt, ta.id as assignment_id, ta.created_at as assignment_created_at, ta.tenant_id, ta.jabatan_di_unit as unit, tn.nama_sekolah, tn.id as tenant_pk FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id JOIN tenants tn ON ta.tenant_id = tn.tenant_id WHERE t.id = ? AND t.status_aktif = 1 ORDER BY ta.created_at ASC, ta.id ASC LIMIT 1',
       [teacher_id]
     );

      if (!teacher) {
       return res.status(400).json({ success: false, message: 'Guru tidak ditemukan' });
     }

      if (!isPrivilegedOperator(req.user)) {
        if (parseInt(teacher_id, 10) !== parseInt(req.user.guru_id, 10)) {
          return res.status(403).json({ success: false, message: 'Akses ditolak untuk guru ini' });
        }
      } else if (!verifyTenantAccess(req, teacher.tenant_id)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
      }

const today = new Date();
      const hijriToday = gregorianToHijri(today);
      const nomorUrut = await peekNextSkNumber(teacher.tenant_id, hijriToday.year);

      const skData = await buildSkData(teacher, tentang_type, pt, tmt_custom, nomorUrut, hijriToday.year, no_surat, tgl_mulai_custom, tgl_selesai_custom, tentang, periodeCustomValue, undefined);

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

module.exports = router;
} catch (error) {
     console.error('Preview SK error:', error);
     res.status(500).json({ success: false, message: 'Error preview SK: ' + error.message });
   }
 });

router.delete('/:id', authenticateOperator, async (req, res) => {
  try {
    const skId = req.params.id;
    const [sk] = await db.query('SELECT * FROM sk_guru WHERE id = ?', [skId]);
    
    if (!sk) {
      return res.status(404).json({ success: false, message: 'SK tidak ditemukan' });
    }
    
    if (!verifyTenantAccess(req, sk.tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
    }

    // Get hijri year from SK (from bh field which is hijri date like "23 Jumadil Awal 1448 H")
    const hijriYearMatch = sk.bh ? sk.bh.match(/(\d{4})\s*H$/i) : null;
    const hijriYear = hijriYearMatch ? parseInt(hijriYearMatch[1], 10) : (sk.bm ? parseInt(sk.bm.match(/(\d{4})/)?.[1], 10) : new Date(sk.created_at).getFullYear());

    // Delete the SK
    await db.query('DELETE FROM sk_guru WHERE id = ?', [skId]);

    // Check if this was the last SK for this tenant and hijri year
    const [remaining] = await db.query(
      'SELECT COUNT(*) as count, MAX(CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(no_surat, "/", 1), ".", -1) AS UNSIGNED)) as max_num FROM sk_guru WHERE tenant_id = ? AND no_surat LIKE ?',
      [sk.tenant_id, 'QR.%/' + hijriYear + '%']
    );

    if (remaining.count === 0) {
      // No more SKs for this tenant/year - reset sequence
      await db.query('DELETE FROM sk_sequence WHERE tenant_id = ? AND hijri_year = ?', [sk.tenant_id, hijriYear]);
    } else if (remaining.max_num !== null) {
      // Update sequence to the highest existing number
      await db.query(
        'UPDATE sk_sequence SET last_number = ? WHERE tenant_id = ? AND hijri_year = ?',
        [remaining.max_num, sk.tenant_id, hijriYear]
      );
    }

    res.json({ success: true, message: 'SK berhasil dihapus dan nomor surat direset' });
  } catch (error) {
    console.error('Delete SK error:', error);
    res.status(500).json({ success: false, message: 'Error menghapus SK: ' + error.message });
  }
});


// GET /bulk-candidates - List guru aktif dengan detail SK preview untuk bulk generate
router.get('/bulk-candidates', authenticateOperator, async (req, res) => {
  try {
    let tenantId = req.query.tenant_id || null;
    let allTenants = false;

    if (req.user.role === 'admin' && (!tenantId || tenantId === 'all')) {
      allTenants = true;
      tenantId = null;
    }

    if (!allTenants) {
      if (!tenantId && req.user.role === 'guru') {
        const adminAssignments = (req.user.assignments || []).filter(a => {
          const roles = ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin', 'guru'];
          return roles.includes((a.jabatan_di_unit || '').toLowerCase());
        });
        if (adminAssignments.length === 1) {
          tenantId = adminAssignments[0].tenant_id;
        }
      }
      if (!tenantId) {
        return res.status(400).json({ success: false, message: 'Silakan pilih sekolah tertentu (scope semua sekolah hanya untuk admin)' });
      }
      if (!verifyTenantAccess(req, tenantId)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
      }
    }

    const employmentRules = await db.query('SELECT * FROM employment_rules');
    const statusRules = await db.query('SELECT * FROM employment_status_rules');
    const hijriToday = gregorianToHijri(new Date());

    const baseQuery = 'SELECT t.id as teacher_id, t.nama, t.nik, t.nip, t.tempat_lahir, t.tanggal_lahir, t.status_kepegawaian, t.tmt, t.pendidikan_terakhir as pt, ta.id as assignment_id, ta.created_at as assignment_created_at, ta.jabatan_di_unit as jabatan_di_unit, ta.tenant_id, tn.nama_sekolah, tn.id as tenant_pk FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id JOIN tenants tn ON ta.tenant_id = tn.tenant_id';
    let teachers;
    if (allTenants) {
      teachers = await db.query(baseQuery + ' WHERE t.status_aktif = 1 ORDER BY tn.nama_sekolah ASC, t.nama ASC, ta.created_at ASC, ta.id ASC LIMIT 500');
    } else {
      teachers = await db.query(baseQuery + ' WHERE ta.tenant_id = ? AND t.status_aktif = 1 ORDER BY t.nama ASC, ta.created_at ASC, ta.id ASC LIMIT 500', [tenantId]);
    }

    const existingSkRows = await db.query('SELECT DISTINCT teacher_id, tenant_id FROM sk_guru');
    const existingSkSet = new Set(existingSkRows.map(r => (r.teacher_id || '') + '|' + (r.tenant_id || '')));

    const tenantPeekBase = {};
    const tenantSeqCounter = {};
    const results = [];

    const teacherMap = new Map();
    for (const t of teachers) {
      const key = (t.teacher_id || '') + '|' + (t.tenant_id || '');
      let g = teacherMap.get(key);
      if (!g) {
        g = { rows: [], jabatan: [] };
        teacherMap.set(key, g);
      }
      g.rows.push(t);
      if (t.jabatan_di_unit && !g.jabatan.includes(t.jabatan_di_unit)) {
        g.jabatan.push(t.jabatan_di_unit);
      }
    }

    for (const [, g] of teacherMap) {
      const primary = pickPrimaryAssignment(g.rows);
      const teacher = Object.assign({}, primary, {
        unit: formatJabatanList(g.jabatan.join(' / ')),
        jabatan_di_unit: primary.jabatan_di_unit
      });
      const tId = teacher.tenant_id || 'unknown';
      if (!(tId in tenantPeekBase)) {
        tenantPeekBase[tId] = await peekNextSkNumber(tId, hijriToday.year);
        tenantSeqCounter[tId] = 0;
      }
      tenantSeqCounter[tId] += 1;
      const nomorUrut = tenantPeekBase[tId] + tenantSeqCounter[tId] - 1;

      const skData = await buildSkData(teacher, 'baru', teacher.pt, null, nomorUrut, hijriToday.year, undefined, undefined, undefined, undefined, undefined, undefined);

      const tmtDate = parseDate(teacher.tmt);
      const today = new Date();
      const yearsOfService = tmtDate ? (today.getFullYear() - tmtDate.getFullYear()) : 0;
      const teacherEmploymentType = getStatusKepegawaian(teacher.status_kepegawaian);
      const rule = employmentRules.find(r => (teacher.jabatan_di_unit || '').toLowerCase().includes((r.job_title_pattern || '').toLowerCase()))
        || statusRules.find(r => r.employment_type === teacherEmploymentType);
      const minYearsRequired = rule ? rule.min_years : 2;
      const qualified = yearsOfService >= minYearsRequired;

      results.push({
        teacher_id: teacher.teacher_id,
        nama: teacher.nama,
        nik: teacher.nik,
        nip: teacher.nip,
        tenant_id: teacher.tenant_id,
        nama_sekolah: teacher.nama_sekolah,
        unit: teacher.unit,
        jabatan: teacher.jabatan_di_unit,
        status_kepegawaian: teacher.status_kepegawaian,
        tmt: teacher.tmt,
        pt: teacher.pt,
        ttl: teacher.tempat_lahir && teacher.tanggal_lahir ? teacher.tempat_lahir + ', ' + teacher.tanggal_lahir : '',
        qualified,
        years_of_service: yearsOfService,
        min_years: minYearsRequired,
        already_has_sk: existingSkSet.has((teacher.teacher_id || '') + '|' + (teacher.tenant_id || '')),
        sk: {
          tentang_type: 'baru',
          no_surat: skData.noSurat,
          tentang: skData.tentang,
          tgl_mulai: skData.tglMulai,
          tgl_selesai: skData.tglSelesai,
          tgl_mulai_month: skData.tglMulaiMonth,
          tgl_selesai_month: skData.tglSelesaiMonth,
          periode: skData.periode,
          tmt: skData.tmtFormatted,
          tmt_month: skData.tmtMonth,
          pt: skData.ptFormatted,
          niy: skData.niy,
          unit: skData.unit,
          jabatan: skData.jabatan,
          status: skData.status,
          bh: skData.bhFormatted,
          bm: skData.bmFormatted
        }
      });
    }

    const response = { success: true, data: results, hijri_year: hijriToday.year };
    if (teachers.length >= 500) {
      response.note = 'Hasil dibatasi 500 baris, gunakan scope sekolah tertentu';
    }
    res.json(response);
  } catch (error) {
    console.error('Bulk candidates error:', error);
    res.status(500).json({ success: false, message: 'Error mengambil kandidat bulk: ' + error.message });
  }
});

router.post('/bulk-generate', authenticateOperator, async (req, res) => {
  try {
    const { rows, preview_only } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Tidak ada guru yang dipilih' });
    }

    const hijriToday = gregorianToHijri(new Date());
    const employmentRules = await db.query('SELECT * FROM employment_rules');
    const statusRules = await db.query('SELECT * FROM employment_status_rules');
    const generated = [];
    const skipped = [];
    const errors = [];
    const usedNoSurat = new Set();
    const usedTeacherKey = new Set();

    // Pass 1: Validate all rows, collect valid rows for generation
    const validRows = [];

    for (const row of rows) {
      const teacher_id = row?.teacher_id;
      const tentang_type = row?.tentang_type || 'baru';
      const pt = row?.pt || '';
      const tmt_custom = row?.tmt_custom || '';
      const no_surat = (row?.no_surat || '').trim();
      const tgl_mulai_custom = row?.tgl_mulai_custom || '';
      const tgl_selesai_custom = row?.tgl_selesai_custom || '';
      const periode_custom = row?.periode_custom || row?.periodeCustom || '';
      const tentang = row?.tentang || '';
      const jabatan = row?.jabatan || '';

      try {
        if (!teacher_id) {
          errors.push({ teacher_id: null, nama: row?.nama || '-', reason: 'teacher_id hilang' });
          continue;
        }

        const teacherKey = (teacher_id || '') + '|' + (row.tenant_id || '');
        if (usedTeacherKey.has(teacherKey)) {
          skipped.push({ teacher_id, nama: row?.nama || '-', reason: 'Duplikat guru dalam batch' });
          continue;
        }
        usedTeacherKey.add(teacherKey);

        const teacherRows = await db.query(
          'SELECT t.id as teacher_id, t.nama, t.nik, t.nip, t.tempat_lahir, t.tanggal_lahir, t.status_kepegawaian, t.tmt, t.pendidikan_terakhir as pt, ta.id as assignment_id, ta.created_at as assignment_created_at, ta.jabatan_di_unit as jabatan_di_unit, ta.tenant_id, tn.nama_sekolah, tn.id as tenant_pk FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id JOIN tenants tn ON ta.tenant_id = tn.tenant_id WHERE t.id = ? AND ta.tenant_id = ? AND t.status_aktif = 1 ORDER BY ta.created_at ASC, ta.id ASC',
          [teacher_id, row.tenant_id || null]
        );
        if (!teacherRows.length) {
          errors.push({ teacher_id, nama: row?.nama || '-', reason: 'Guru tidak ditemukan atau tidak aktif' });
          continue;
        }
        const primary = pickPrimaryAssignment(teacherRows);
        const teacher = Object.assign({}, primary, {
          unit: formatJabatanList(teacherRows.map(r => r.jabatan_di_unit).filter(Boolean).join(' / ')),
          jabatan_di_unit: primary.jabatan_di_unit
        });

        if (!verifyTenantAccess(req, teacher.tenant_id)) {
          return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
          continue;
        }

        // Gate kelayakan: guru dengan masa kerja di bawah syarat hanya di-generate jika diverifikasi manual
        const manualVerified = row.manual_verified === true || row.manual_verified === 1;
        const tmtDate = parseDate(teacher.tmt);
        const yearsOfService = tmtDate ? (new Date().getFullYear() - tmtDate.getFullYear()) : 0;
        const teacherEmploymentType = getStatusKepegawaian(teacher.status_kepegawaian);
        const rule = employmentRules.find(r => (teacher.jabatan_di_unit || '').toLowerCase().includes((r.job_title_pattern || '').toLowerCase()))
          || statusRules.find(r => r.employment_type === teacherEmploymentType);
        const minYearsRequired = rule ? rule.min_years : 2;
        const qualified = yearsOfService >= minYearsRequired;
        const manualOverride = !qualified && manualVerified;
        if (!qualified && !manualVerified) {
          skipped.push({ teacher_id, nama: teacher.nama, reason: 'Belum layak: masa kerja ' + yearsOfService + ' thn < syarat ' + minYearsRequired + ' thn. Centang verifikasi manual untuk tetap generate.' });
          continue;
        }

        if (no_surat) {
          if (usedNoSurat.has(no_surat)) {
            skipped.push({ teacher_id, nama: teacher.nama, reason: 'Nomor surat duplikat dalam batch' });
            continue;
          }
          const existingNo = await db.query('SELECT id FROM sk_guru WHERE no_surat = ? AND tenant_id = ? LIMIT 1', [no_surat, teacher.tenant_id]);
          if (existingNo.length) {
            skipped.push({ teacher_id, nama: teacher.nama, reason: 'Nomor surat sudah digunakan SK lain' });
            continue;
          }
          usedNoSurat.add(no_surat);
        }

        // NIY conflict check (without nomorUrut)
        const tempSkData = await buildSkData(teacher, tentang_type, pt, tmt_custom, 0, hijriToday.year, no_surat, tgl_mulai_custom, tgl_selesai_custom, tentang, periode_custom, jabatan);
        if (tempSkData.niy) {
          const conflict = await db.query(
            'SELECT id FROM teachers WHERE nip = ? AND id != ?',
            [tempSkData.niy, teacher_id]
          );
          if (conflict.length > 0) {
            skipped.push({ teacher_id, nama: teacher.nama, reason: 'NIY sudah digunakan guru lain' });
            continue;
          }
        }

        // Row is valid - store for pass 2
        validRows.push({
          row,
          teacher,
          teacher_id,
          tentang_type,
          pt,
          tmt_custom,
          no_surat,
          tgl_mulai_custom,
          tgl_selesai_custom,
          periode_custom,
          tentang,
          jabatan,
          manualOverride,
          manualVerified
        });

      } catch (rowErr) {
        console.error('[SK BULK] error per baris:', rowErr);
        errors.push({ teacher_id, nama: row?.nama || '-', reason: rowErr.message });
      }
    }

    // Pass 2: Assign nomorUrut and insert for valid rows only
    const previewCounters = {};
    for (const v of validRows) {
      try {
        let nomorUrut;
        if (preview_only) {
          const tId = v.teacher.tenant_id;
          if (!(tId in previewCounters)) {
            previewCounters[tId] = await peekNextSkNumber(tId, hijriToday.year) - 1;
          }
          previewCounters[tId] += 1;
          nomorUrut = previewCounters[tId];
        } else {
          nomorUrut = await getNextSkNumber(v.teacher.tenant_id, hijriToday.year);
        }
        const skData = await buildSkData(v.teacher, v.tentang_type, v.pt, v.tmt_custom, nomorUrut, hijriToday.year, v.no_surat, v.tgl_mulai_custom, v.tgl_selesai_custom, v.tentang, v.periode_custom, v.jabatan);

        if (preview_only) {
          // Store proposed surat number in the valid row for response
          v.proposed_no_surat = skData.noSurat;
          continue;
        }

        const insertResult = await db.query(
          'INSERT INTO sk_guru (teacher_id, tenant_id, tahun_ajaran_id, no_surat, tentang, ttl, tmt, pt, niy, unit, bh, bm, jabatan, status, tentag_type, tgl_mulai, tgl_selesai, manual_verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
          [v.teacher_id, v.teacher.tenant_id, req.activeTahunAjaran?.id || null, skData.noSurat, skData.tentang, skData.ttl, skData.tmtFormatted, skData.ptFormatted, skData.niy, skData.unit, skData.bhFormatted, skData.bmFormatted, skData.jabatan, skData.status, v.tentang_type, skData.tglMulai, skData.tglSelesai, v.manualOverride ? 1 : 0]
        );
        const newSkId = insertResult && insertResult.insertId ? insertResult.insertId : null;

        if ((!v.teacher.nip || v.teacher.nip === '-' || v.teacher.nip === '') && skData.niy) {
          await db.query('UPDATE teachers SET nip = ? WHERE id = ?', [skData.niy, v.teacher_id]);
        }

        let driveMeta = null;
        try {
          const htmlData = {
            noSurat: skData.noSurat,
            tentang: skData.tentang,
            nama: v.teacher.nama,
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
          const pdfBuf = await generateSkPdf(htmlData);
          driveMeta = await archiveSkPdfToDrive(v.teacher, skData, pdfBuf, v.tentang_type);
          if (driveMeta && newSkId) {
            await db.query(
              'UPDATE sk_guru SET drive_file_id = ?, drive_file_name = ?, drive_folder_id = ?, drive_web_view_link = ?, drive_uploaded_at = NOW() WHERE id = ?',
              [driveMeta.drive_file_id, driveMeta.drive_file_name, driveMeta.drive_folder_id, driveMeta.drive_web_view_link, newSkId]
            );
          }
        } catch (driveErr) {
          console.error('[SK BULK] Drive archive error:', driveErr.message);
        }

        generated.push({
          teacher_id: v.teacher_id,
          nama: v.teacher.nama,
          no_surat: skData.noSurat,
          niy: skData.niy,
          manual_verified: v.manualOverride,
          drive_file_id: driveMeta ? driveMeta.drive_file_id : null,
          drive_web_view_link: driveMeta ? driveMeta.drive_web_view_link : null
        });
      } catch (insertErr) {
        console.error('[SK BULK] insert error:', insertErr);
        errors.push({ teacher_id: v.teacher_id, nama: v.teacher.nama, reason: insertErr.message });
      }
    }

    if (preview_only) {
      // Return proposed surat numbers without generating
      const proposed = validRows.map(v => ({
        teacher_id: v.teacher_id,
        nama: v.teacher.nama,
        no_surat: v.proposed_no_surat || v.no_surat || '-'
      }));
      res.json({
        success: true,
        message: `Preview: ${proposed.length} guru akan di-generate`,
        data: { proposed, skipped, errors, preview: true }
      });
      return;
    }

    res.json({
      success: true,
      message: `Bulk generate selesai: ${generated.length} berhasil, ${skipped.length} dilewati, ${errors.length} gagal`,
      data: { generated, skipped, errors }
    });
  } catch (error) {
    console.error('Bulk generate error:', error);
    res.status(500).json({ success: false, message: 'Error bulk generate: ' + error.message });
  }
});


// POST /api/sk-guru/bulk-download - Download multiple SKs as ZIP
router.post('/bulk-download', authenticateOperator, async (req, res) => {
  try {
    const { sk_ids } = req.body;
    if (!Array.isArray(sk_ids) || sk_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Tidak ada SK yang dipilih untuk diunduh' });
    }

    // Fetch SKs and verify access
    const placeholders = sk_ids.map(() => '?').join(',');
    const sks = await db.query(
      `SELECT * FROM sk_guru WHERE id IN (${placeholders})`,
      sk_ids
    );

    if (!sks.length) {
      return res.status(404).json({ success: false, message: 'SK tidak ditemukan' });
}

// Verify tenant access for all SKs
    for (const sk of sks) {
      if (!verifyTenantAccess(req, sk.tenant_id)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak untuk salah satu tenant' });
      }
    }

    // Dynamic import for archiver (ES module) - use ZipArchive directly
    const archiverModule = await import('archiver');
    const ZipArchive = archiverModule.ZipArchive;
    if (!ZipArchive) {
      return res.status(500).json({ success: false, message: 'Archiver ZipArchive not available' });
    }

    // Set up ZIP response
    const archive = new ZipArchive({ zlib: { level: 9 } });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="SK_Bulk_${Date.now()}.zip"`);
    archive.pipe(res);

    // Generate PDF for each SK and add to ZIP
    for (const sk of sks) {
      try {
        // Get teacher data
        const [teacher] = await db.query(
          'SELECT t.id, t.nama, t.nik, t.nip, t.tempat_lahir, t.tanggal_lahir, t.status_kepegawaian, t.tmt, t.pendidikan_terakhir as pt, ta.id as assignment_id, ta.created_at as assignment_created_at, ta.tenant_id, ta.jabatan_di_unit as unit, tn.nama_sekolah, tn.id as tenant_pk FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id JOIN tenants tn ON ta.tenant_id = tn.tenant_id WHERE t.id = ? AND t.status_aktif = 1 ORDER BY ta.created_at ASC, ta.id ASC LIMIT 1',
          [sk.teacher_id]
        );

// Use stored custom dates from DB (tgl_mulai, tgl_selesai, periode) instead of recomputing
        const tglMulai = sk.tgl_mulai || '1 Januari ' + new Date(sk.created_at).getFullYear() + ' M';
        const tglSelesai = sk.tgl_selesai || '31 Desember ' + new Date(sk.created_at).getFullYear() + ' M';

        var htmlData = {
          noSurat: sk.no_surat || '',
          tentang: sk.tentang || '',
          nama: teacher ? (teacher.nama || '') : (sk.niy || ''),
          ttl: sk.ttl || '',
          tmtFormatted: sk.tmt || '',
          ptFormatted: sk.pt || '',
          niy: sk.niy || '',
          unit: sk.unit || '',
          jabatan: sk.jabatan || (teacher ? formatJabatanList(teacher.unit) : 'Guru'),
          tglMulai: tglMulai,
          status: sk.status || (teacher ? getStatusKepegawaian(teacher.status_kepegawaian) : ''),
          tglSelesai: tglSelesai,
          bhFormatted: sk.bh || '',
          bmFormatted: sk.bm || '',
          periode: sk.periode || computePeriode(tglMulai, tglSelesai)
        };

        // Generate PDF using pdfkit (no Chrome dependency)
        const pdfBuf = await generateSkPdf(htmlData);
        const safeName = (sk.no_surat || 'SK_' + sk.id).replace(/[^a-zA-Z0-9._-]/g, '_');
        archive.append(pdfBuf, { name: `${safeName}.pdf` });

      } catch (err) {
        console.error(`[BULK DOWNLOAD] Error generating PDF for SK ${sk.id}:`, err.message);
        // Continue with other SKs
      }
    }

    await archive.finalize();

  } catch (error) {
    console.error('Bulk download error:', error);
    res.status(500).json({ success: false, message: 'Error bulk download: ' + error.message });
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

    const approvalMap = new Map();
    for (const t of teachers) {
      const key = (t.teacher_id || '') + '|' + (t.tenant_id || '');
      let g = approvalMap.get(key);
      if (!g) {
        g = { rows: [], jabatan: [] };
        approvalMap.set(key, g);
      }
      g.rows.push(t);
      if (t.jabatan_di_unit && !g.jabatan.includes(t.jabatan_di_unit)) {
        g.jabatan.push(t.jabatan_di_unit);
      }
    }
    const dedupedTeachers = [];
    for (const [, g] of approvalMap) {
      const primary = pickPrimaryAssignment(g.rows);
      dedupedTeachers.push(Object.assign({}, primary, {
        unit: formatJabatanList(g.jabatan.join(' / ')),
        jabatan_di_unit: primary.jabatan_di_unit
      }));
    }

    const results = [];
    for (const teacher of dedupedTeachers) {
      const tmtDate = parseDate(teacher.tmt);
      const yearsOfService = tmtDate ? (today.getFullYear() - tmtDate.getFullYear()) : 0;
      const qualified = yearsOfService >= minYears;
      const existingApproval = await db.query(
        'SELECT status FROM sk_approval_queue WHERE teacher_id = ? AND tenant_id = ? AND tentang_type = ? ORDER BY created_at DESC LIMIT 1',
        [teacher.teacher_id, teacher.tenant_id || teacher.tenant_id, 'baru']
      );
      const alreadyGenerated = await db.query(
        'SELECT id FROM sk_guru WHERE teacher_id = ? AND tenant_id = ? AND tentag_type = ? LIMIT 1',
        [teacher.teacher_id, teacher.tenant_id, 'baru']
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

/**
 * POST /api/sk-guru/sync-drive/:skId
 * Regenerate PDF for an existing SK and archive/update Google Drive metadata.
 */
router.post('/sync-drive/:skId', authenticateOperator, async (req, res) => {
  try {
    const skId = req.params.skId;
    const [sk] = await db.query('SELECT * FROM sk_guru WHERE id = ?', [skId]);
    if (!sk) {
      return res.status(404).json({ success: false, message: 'SK tidak ditemukan' });
    }
    if (!verifyTenantAccess(req, sk.tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
    }

    const [teacher] = await db.query(
      'SELECT t.id, t.nama, t.nik, t.nip, t.tempat_lahir, t.tanggal_lahir, t.status_kepegawaian, t.tmt, t.pendidikan_terakhir as pt, ta.id as assignment_id, ta.created_at as assignment_created_at, ta.tenant_id, ta.jabatan_di_unit as unit, tn.nama_sekolah, tn.id as tenant_pk FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id JOIN tenants tn ON ta.tenant_id = tn.tenant_id WHERE t.id = ? AND t.status_aktif = 1 ORDER BY ta.created_at ASC, ta.id ASC LIMIT 1',
      [sk.teacher_id]
    );

    const tglMulai = sk.tgl_mulai || '1 Januari ' + new Date(sk.created_at).getFullYear() + ' M';
    const tglSelesai = sk.tgl_selesai || '31 Desember ' + new Date(sk.created_at).getFullYear() + ' M';
    const periode = sk.periode || computePeriode(tglMulai, tglSelesai);

    const htmlData = {
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
      periode: periode
    };

    const pdfBuf = await generateSkPdf(htmlData);
    const driveMeta = await archiveSkPdfToDrive(
      teacher || { nama: sk.niy, nama_sekolah: 'Tenant' },
      { periode },
      pdfBuf,
      sk.tentag_type || 'baru'
    );

    if (!driveMeta) {
      return res.status(500).json({ success: false, message: 'Gagal upload ke Google Drive' });
    }

    await db.query(
      'UPDATE sk_guru SET drive_file_id = ?, drive_file_name = ?, drive_folder_id = ?, drive_web_view_link = ?, drive_uploaded_at = NOW() WHERE id = ?',
      [driveMeta.drive_file_id, driveMeta.drive_file_name, driveMeta.drive_folder_id, driveMeta.drive_web_view_link, skId]
    );

    res.json({ success: true, data: driveMeta });
  } catch (error) {
    console.error('Sync SK to Drive error:', error);
    res.status(500).json({ success: false, message: 'Error sync SK ke Drive: ' + error.message });
  }
});

/**
 * GET /api/sk-guru/pending-requests
 * List pending SK requests from teachers
 */
router.get('/pending-requests', authenticateOperator, async (req, res) => {
  try {
    let sql = `SELECT q.id, q.teacher_id, q.tenant_id, q.status, q.tentang_type, q.created_at, t.nama, tn.nama_sekolah
      FROM sk_approval_queue q
      JOIN teachers t ON q.teacher_id = t.id
      JOIN tenants tn ON q.tenant_id COLLATE utf8mb4_unicode_ci = tn.tenant_id COLLATE utf8mb4_unicode_ci
      WHERE q.status = 'pending'`;
    const params = [];
    if (req.user.role !== 'admin') {
      const tenantIds = (req.user.assignments || []).map(a => a.tenant_id);
      if (tenantIds.length) {
        sql += ' AND q.tenant_id IN (' + tenantIds.map(() => '?').join(',') + ')';
        params.push(...tenantIds);
      }
    }
    sql += ' ORDER BY q.created_at ASC';
    const rows = await db.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Pending SK requests error:', error);
    res.status(500).json({ success: false, message: 'Error mengambil pengajuan SK: ' + error.message });
  }
});

/**
 * POST /api/sk-guru/approve-request
 * Approve a pending SK request and generate the SK
 */
router.post('/approve-request', authenticateOperator, async (req, res) => {
  try {
    const { request_id } = req.body;
    if (!request_id) return res.status(400).json({ success: false, message: 'request_id diperlukan' });

    const [request] = await db.query('SELECT * FROM sk_approval_queue WHERE id = ? AND status = "pending"', [request_id]);
    if (!request) return res.status(404).json({ success: false, message: 'Pengajuan tidak ditemukan atau sudah diproses' });

    if (!verifyTenantAccess(req, request.tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
    }

    const teacherId = request.teacher_id;
    const tenantId = request.tenant_id;
    const tentang_type = request.tentang_type || 'baru';

    const [teacher] = await db.query(
      'SELECT t.id, t.nama, t.nik, t.nip, t.tempat_lahir, t.tanggal_lahir, t.status_kepegawaian, t.tmt, t.pendidikan_terakhir as pt, ta.id as assignment_id, ta.created_at as assignment_created_at, ta.tenant_id, ta.jabatan_di_unit as unit, tn.nama_sekolah, tn.id as tenant_pk FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id JOIN tenants tn ON ta.tenant_id = tn.tenant_id WHERE t.id = ? AND ta.tenant_id = ? AND t.status_aktif = 1 LIMIT 1',
      [teacherId, tenantId]
    );

    if (!teacher) return res.status(404).json({ success: false, message: 'Data guru tidak ditemukan' });

    const today = new Date();
    const hijriToday = gregorianToHijri(today);
    const nomorUrut = await getNextSkNumber(teacher.tenant_id, hijriToday.year);
    const pt = teacher.pt;
    const skData = await buildSkData(teacher, tentang_type, pt, null, nomorUrut, hijriToday.year, undefined, undefined, undefined, undefined, undefined, undefined);

    await db.query(
      'INSERT INTO sk_guru (teacher_id, tenant_id, tahun_ajaran_id, no_surat, tentang, ttl, tmt, pt, niy, unit, bh, bm, jabatan, status, tentag_type, tgl_mulai, tgl_selesai, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [teacherId, teacher.tenant_id, null, skData.noSurat, skData.tentang, skData.ttl, skData.tmtFormatted, skData.ptFormatted, skData.niy, skData.unit, skData.bhFormatted, skData.bmFormatted, skData.jabatan, skData.status, tentang_type, skData.tglMulai, skData.tglSelesai]
    );

    await db.query('UPDATE sk_approval_queue SET status = "approved" WHERE id = ?', [request_id]);

    res.json({ success: true, message: 'Pengajuan disetujui dan SK berhasil dibuat' });
  } catch (error) {
    console.error('Approve SK request error:', error);
    res.status(500).json({ success: false, message: 'Error menyetujui pengajuan: ' + error.message });
  }
});


module.exports = router;
