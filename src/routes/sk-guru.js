const express = require('express');
const db = require('../../db');
const { authenticateToken, authenticateOperator, verifyTenantAccess, isPrivilegedOperator, getUserTeacherIds } = require('../middleware/auth');
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


// Progress tracking for bulk generate
const bulkProgress = new Map();
const MAX_PROGRESS_ENTRIES = 100;
const PROGRESS_TTL_MS = 60 * 60 * 1000; // 1 hour

function createProgressJob(total) {
  const jobId = 'sk-bulk-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  const progress = {
    jobId,
    total,
    processed: 0,
    percentage: 0,
    current: '',
    status: 'processing',
    startedAt: Date.now(),
    completedAt: null,
    generated: [],
    skipped: [],
    errors: []
  };
  
  // Cleanup old entries if over limit
  if (bulkProgress.size >= MAX_PROGRESS_ENTRIES) {
    const oldestKey = bulkProgress.keys().next().value;
    bulkProgress.delete(oldestKey);
  }
  
  bulkProgress.set(jobId, progress);
  
  // Auto-cleanup after TTL
  setTimeout(() => bulkProgress.delete(jobId), PROGRESS_TTL_MS);
  
  return jobId;
}

function updateProgress(jobId, updates) {
  const progress = bulkProgress.get(jobId);
  if (!progress) return;
  Object.assign(progress, updates);
  if (progress.total > 0) {
    progress.percentage = Math.round((progress.processed / progress.total) * 100);
  }
}

function getProgress(jobId) {
  return bulkProgress.get(jobId) || null;
}


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
     
     const nextSkNumber = await peekActualNextSkNumber(currentHijri.year);
     const tenantCode = teacher.tenant_pk || 'UNKNOWN';
      const noSurat = 'QR.' + String(nextSkNumber).padStart(3, '0') + '/' + tenantCode + '/YPWI-LT/' + romanMonth + '/' + currentHijri.year;

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

async function peekActualNextSkNumber(hijriYear) {
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

  return Math.max(maxFromSk, seqNum) + 1;
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

async function getActualNextSkNumberWithLock(hijriYear, connection) {
  const [skRows] = await connection.query(
    `SELECT MAX(CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(no_surat, '/', 1), '.', -1) AS UNSIGNED)) as max_num
     FROM sk_guru
     WHERE no_surat LIKE ?`,
    ['QR.%/' + hijriYear + '%']
  );
  const maxFromSk = (skRows && skRows[0] && skRows[0].max_num) || 0;

  const [seqRows] = await connection.query(
    'SELECT last_number FROM sk_global_sequence WHERE hijri_year = ? FOR UPDATE',
    [hijriYear]
  );
  const seqNum = (seqRows && seqRows.length > 0 && seqRows[0].last_number) ? seqRows[0].last_number : 0;

  const nextNum = Math.max(maxFromSk, seqNum) + 1;

  if (seqRows && seqRows.length > 0) {
    await connection.query(
      'UPDATE sk_global_sequence SET last_number = ? WHERE hijri_year = ?',
      [nextNum, hijriYear]
    );
  } else {
    await connection.query(
      'INSERT INTO sk_global_sequence (hijri_year, last_number) VALUES (?, ?)',
      [hijriYear, nextNum]
    );
  }

  return nextNum;
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
    'pimpinan': 'Pimpinan',
    'jabatan': 'Jabatan'
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
    const tenantCode = teacher.tenant_pk || 'UNKNOWN';
    const noSurat = noSuratCustom || ('QR.' + String(nomorUrut).padStart(3, '0') + '/' + tenantCode + '/YPWI-LT/' + romanMonth + '/' + hijriToday.year);
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
    const tmtYear = tmtDate ? String(tmtDate.getFullYear()) : String(today.getFullYear());
    const tenantId2digit = teacher.tenant_pk ? String(teacher.tenant_pk).padStart(2, '0') : (teacher.tenant_id || '').slice(-2);
    const seq = String(nomorUrut).padStart(3, '0');
    const niy = (teacher.nip && teacher.nip !== '-' && teacher.nip !== '') ? teacher.nip : (birthDay + birthMonth + birthYear + tmtMonth + tmtYear + tenantId2digit + seq);

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
      // === NEW DEFAULT LOGIC BASED ON TMT ===
      const tmt = tmtDate; // already parsed from teacher.tmt or tmt_custom
      const today = new Date();
      
      // Calculate full years of service (TMT to today)
      let yearsOfService = today.getFullYear() - tmt.getFullYear();
      const monthDiff = today.getMonth() - tmt.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < tmt.getDate())) {
        yearsOfService--;
      }
      
      // Check if leader
      const leaderSource = allJabatan.toLowerCase();
      const isLeader = ['pimpinan', 'kepala', 'ketua'].some(k => leaderSource.includes(k));
      
      let tglMulaiCalc, tglSelesaiCalc;
      
      if (isLeader) {
        // Leader: 4 years from Jan 1 current year
        tglMulaiCalc = '1 Januari ' + today.getFullYear() + ' M';
        const lastDayDec = new Date(today.getFullYear() + 3, 11, 31).getDate();
        tglSelesaiCalc = lastDayDec + ' Desember ' + (today.getFullYear() + 3) + ' M';
      } else if (yearsOfService < 1) {
        // Less than 1 year: start from TMT, end Dec 31 of TMT year
        tglMulaiCalc = tmt.getDate() + ' ' + idnMonths[tmt.getMonth()] + ' ' + tmt.getFullYear() + ' M';
        const lastDayDec = new Date(tmt.getFullYear(), 11, 31).getDate();
        tglSelesaiCalc = lastDayDec + ' Desember ' + tmt.getFullYear() + ' M';
      } else {
        // 1+ years: Jan 1 - Dec 31 current year
        tglMulaiCalc = '1 Januari ' + today.getFullYear() + ' M';
        const lastDayDec = new Date(today.getFullYear(), 11, 31).getDate();
        tglSelesaiCalc = lastDayDec + ' Desember ' + today.getFullYear() + ' M';
      }
      
      tglMulai = tglMulaiCalc;
      tglSelesai = tglSelesaiCalc;
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
const nomorUrut = await getActualNextSkNumber(teacher.tenant_id, hijriToday.year);

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
    
    // Pagination params
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const offset = (page - 1) * limit;
    
    // Search & filter params
    const search = req.query.q ? req.query.q.trim() : '';
    const dateFrom = req.query.date_from || '';
    const dateTo = req.query.date_to || '';
    const sortBy = req.query.sort_by || 'created_at';
    const sortOrder = (req.query.sort_order || 'DESC').toUpperCase();

    if (req.user.role === 'guru' && !tenantId) {
      const adminAssignments = (req.user.assignments || []).filter(function(a) {
        const roles = ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
        return roles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));
      });
      if (adminAssignments.length === 1) {
        tenantId = adminAssignments[0].tenant_id;
      }
    }

    // Build WHERE clause
    const whereConditions = [];
    const queryParams = [];

    if (tenantId) {
      if (!verifyTenantAccess(req, tenantId)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
      }
      whereConditions.push('sg.tenant_id = ?');
      queryParams.push(tenantId);
    }

    if (search) {
      whereConditions.push('(sg.no_surat LIKE ? OR t.nama LIKE ? OR sg.tentang LIKE ?)');
      const searchTerm = `%${search}%`;
      queryParams.push(searchTerm, searchTerm, searchTerm);
    }

    if (dateFrom) {
      whereConditions.push('DATE(sg.created_at) >= ?');
      queryParams.push(dateFrom);
    }
    if (dateTo) {
      whereConditions.push('DATE(sg.created_at) <= ?');
      queryParams.push(dateTo);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    // Validate sort
    const allowedSort = ['created_at', 'no_surat', 'tentang', 'niy', 'tmt'];
    const safeSortBy = allowedSort.includes(sortBy) ? sortBy : 'created_at';
    const safeSortOrder = sortOrder === 'ASC' ? 'ASC' : 'DESC';

    // Count total
    let countQuery, countParams;
    if (tenantId) {
      countQuery = `SELECT COUNT(*) as total FROM sk_guru sg JOIN teachers t ON sg.teacher_id = t.id ${whereClause}`;
      countParams = [...queryParams];
    } else {
      countQuery = `SELECT COUNT(*) as total FROM sk_guru sg JOIN teachers t ON sg.teacher_id = t.id JOIN tenants tn ON sg.tenant_id = tn.tenant_id ${whereClause}`;
      countParams = [...queryParams];
    }
    const [countResult] = await db.query(countQuery, countParams);
    const total = countResult[0]?.total || 0;
    const totalPages = Math.ceil(total / limit);

    // Get paginated data
    let dataQuery, dataParams;
    if (tenantId) {
      dataQuery = `SELECT sg.*, t.nama as teacher_name FROM sk_guru sg JOIN teachers t ON sg.teacher_id = t.id ${whereClause} ORDER BY sg.${safeSortBy} ${safeSortOrder} LIMIT ? OFFSET ?`;
      dataParams = [...queryParams, limit, offset];
    } else {
      dataQuery = `SELECT sg.*, t.nama as teacher_name, tn.nama_sekolah as tenant_name FROM sk_guru sg JOIN teachers t ON sg.teacher_id = t.id JOIN tenants tn ON sg.tenant_id = tn.tenant_id ${whereClause} ORDER BY sg.${safeSortBy} ${safeSortOrder} LIMIT ? OFFSET ?`;
      dataParams = [...queryParams, limit, offset];
    }
    const skList = await db.query(dataQuery, dataParams);

    res.json({ 
      success: true, 
      data: skList,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
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

    // Allow privileged operators (admin, operator, TU) to access any SK in their tenant
    if (isPrivilegedOperator(req.user)) {
      if (!verifyTenantAccess(req, sk.tenant_id)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
      }
    } else {
      // Regular guru: only access their own SK
      const userTeacherIds = getUserTeacherIds(req.user);

      if (!userTeacherIds.length) {
        return res.status(400).json({ success: false, message: 'Teacher ID tidak ditemukan di token' });
      }

      if (!userTeacherIds.includes(sk.teacher_id)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak untuk SK ini' });
      }

      if (!verifyTenantAccess(req, sk.tenant_id)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak untuk tenant ini' });
      }
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
      const nomorUrut = await peekActualNextSkNumber(hijriToday.year);

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

    const employmentRulesRaw = await db.query('SELECT * FROM employment_rules');
    const employmentRules = Array.isArray(employmentRulesRaw) ? employmentRulesRaw : [];
    const statusRulesRaw = await db.query('SELECT * FROM employment_status_rules');
    const statusRules = Array.isArray(statusRulesRaw) ? statusRulesRaw : [];
    const hijriToday = gregorianToHijri(new Date());

    const baseQuery = 'SELECT t.id as teacher_id, t.nama, t.nik, t.nip, t.tempat_lahir, t.tanggal_lahir, t.status_kepegawaian, t.tmt, t.pendidikan_terakhir as pt, ta.id as assignment_id, ta.created_at as assignment_created_at, ta.jabatan_di_unit as jabatan_di_unit, ta.tenant_id, tn.nama_sekolah, tn.id as tenant_pk FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id JOIN tenants tn ON ta.tenant_id = tn.tenant_id';
    let teachers;
    if (allTenants) {
      teachers = await db.query(baseQuery + ' WHERE t.status_aktif = 1 ORDER BY tn.nama_sekolah ASC, t.nama ASC, ta.created_at ASC, ta.id ASC LIMIT 500');
    } else {
      teachers = await db.query(baseQuery + ' WHERE ta.tenant_id = ? AND t.status_aktif = 1 ORDER BY t.nama ASC, ta.created_at ASC, ta.id ASC LIMIT 500', [tenantId]);
    }
    // Defensive: ensure teachers is always an array
    if (!Array.isArray(teachers)) {
      console.error('[BULK CANDIDATES] teachers query returned non-array:', teachers);
      teachers = [];
    }

    const existingSkRows = await db.query('SELECT DISTINCT teacher_id, tenant_id FROM sk_guru');
    const existingSkRowsArr = Array.isArray(existingSkRows) ? existingSkRows : [];
    const existingSkSet = new Set(existingSkRowsArr.map(r => (r.teacher_id || '') + '|' + (r.tenant_id || '')));

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
      // Skip teachers without valid tenant_id
      if (!teacher.tenant_id) {
        continue;
      }
      // Global sequence: single counter for all tenants
      if (!('global' in tenantPeekBase)) {
        tenantPeekBase['global'] = await peekActualNextSkNumber(hijriToday.year);
        tenantSeqCounter['global'] = 0;
      }
      tenantSeqCounter['global'] += 1;
      const nomorUrut = tenantPeekBase['global'] + tenantSeqCounter['global'] - 1;

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
    const { rows, preview_only, jobId: clientJobId } = req.body;
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

    if (preview_only) {
      // Global sequence for preview
      if (!('global' in previewCounters)) {
        previewCounters['global'] = await peekActualNextSkNumber(hijriToday.year) - 1;
      }
      for (const v of validRows) {
        try {
          previewCounters['global'] += 1;
          const nomorUrut = previewCounters['global'];
          const skData = await buildSkData(v.teacher, v.tentang_type, v.pt, v.tmt_custom, nomorUrut, hijriToday.year, v.no_surat, v.tgl_mulai_custom, v.tgl_selesai_custom, v.tentang, v.periode_custom, v.jabatan);
          v.proposed_no_surat = skData.noSurat;
        } catch (err) {
          console.error('[SK BULK PREVIEW] error:', err);
          errors.push({ teacher_id: v.teacher_id, nama: v.teacher.nama, reason: err.message });
        }
      }

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
    } else {
      // Create progress job for async processing
      const jobId = clientJobId || createProgressJob(validRows.length);
      const progress = getProgress(jobId);
      
      // Return jobId immediately, process in background
      res.json({
        success: true,
        jobId,
        message: `Bulk generate started for ${validRows.length} guru. Poll /api/sk-guru/bulk-progress/${jobId} for progress.`,
        data: { jobId, total: validRows.length }
      });

      // Process in background (non-blocking)
      processBulkGenerateBackground(jobId, validRows, hijriToday, req, generated, skipped, errors);
      return;
    }
  } catch (error) {
    console.error('Bulk generate error:', error);
    res.status(500).json({ success: false, message: 'Error bulk generate: ' + error.message });
  }
});

// Background processing function
async function processBulkGenerateBackground(jobId, validRows, hijriToday, req, generated, skipped, errors) {
  const progress = getProgress(jobId);
  if (!progress) return;

  try {
    // Global sequence: single transaction for ALL tenants with ONE global lock
    let connection = null;
    const allSkData = []; // Store skData for later PDF generation

    try {
      connection = await db.getConnection();
      await connection.beginTransaction();

      // Lock the GLOBAL sequence row for this hijri year (held until commit)
      for (const v of validRows) {
        try {
          const nomorUrut = await getActualNextSkNumberWithLock(hijriToday.year, connection);
          const skData = await buildSkData(v.teacher, v.tentang_type, v.pt, v.tmt_custom, nomorUrut, hijriToday.year, v.no_surat, v.tgl_mulai_custom, v.tgl_selesai_custom, v.tentang, v.periode_custom, v.jabatan);

          const insertResult = await connection.query(
            'INSERT INTO sk_guru (teacher_id, tenant_id, tahun_ajaran_id, no_surat, tentang, ttl, tmt, pt, niy, unit, bh, bm, jabatan, status, tentag_type, tgl_mulai, tgl_selesai, manual_verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [v.teacher_id, v.teacher.tenant_id, req.activeTahunAjaran?.id || null, skData.noSurat, skData.tentang, skData.ttl, skData.tmtFormatted, skData.ptFormatted, skData.niy, skData.unit, skData.bhFormatted, skData.bmFormatted, skData.jabatan, skData.status, v.tentang_type, skData.tglMulai, skData.tglSelesai, v.manualOverride ? 1 : 0]
          );
          const newSkId = insertResult && insertResult.insertId ? insertResult.insertId : null;

          if ((!v.teacher.nip || v.teacher.nip === '-' || v.teacher.nip === '') && skData.niy) {
            await connection.query('UPDATE teachers SET nip = ? WHERE id = ?', [skData.niy, v.teacher_id]);
          }

          // Store for PDF/Drive after commit (no lock held)
          allSkData.push({ v, skData, newSkId, teacher: v.teacher });
        } catch (insertErr) {
          console.error('[SK BULK] insert error:', insertErr);
          errors.push({ teacher_id: v.teacher_id, nama: v.teacher.nama, reason: insertErr.message });
        }
      }

      // Commit ALL inserts at once (global lock released)
      await connection.commit();
      connection.release();
      connection = null;

      // Now generate PDFs and upload to Drive (outside transaction, no lock)
      for (let i = 0; i < allSkData.length; i++) {
        const { v, skData, newSkId, teacher } = allSkData[i];
        let driveMeta = null;
        try {
          // Update progress before each PDF
          progress.current = teacher?.nama || v.teacher?.nama || 'Processing...';
          progress.processed = i + 1;
          
          const htmlData = {
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
          const pdfBuf = await generateSkPdf(htmlData);
          driveMeta = await archiveSkPdfToDrive(teacher, skData, pdfBuf, v.tentang_type);
          if (driveMeta && newSkId) {
            // Quick separate query for drive meta update
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
          nama: teacher.nama,
          no_surat: skData.noSurat,
          niy: skData.niy,
          manual_verified: v.manualOverride,
          drive_file_id: driveMeta ? driveMeta.drive_file_id : null,
          drive_web_view_link: driveMeta ? driveMeta.drive_web_view_link : null
        });
      }

      progress.status = 'completed';
      progress.completedAt = Date.now();
      progress.generated = generated;
      progress.skipped = skipped;
      progress.errors = errors;
      progress.current = 'Selesai';

    } catch (err) {
      console.error('[SK BULK] batch error:', err);
      if (connection) {
        try { await connection.rollback(); } catch (_) {}
        try { connection.release(); } catch (_) {}
      }
      // Mark all rows as errors
      for (const v of validRows) {
        if (!errors.some(e => e.teacher_id === v.teacher_id)) {
          errors.push({ teacher_id: v.teacher_id, nama: v.teacher.nama, reason: err.message });
        }
      }
      progress.status = 'failed';
      progress.completedAt = Date.now();
      progress.generated = generated;
      progress.skipped = skipped;
      progress.errors = errors;
    }
  } catch (error) {
    console.error('[SK BULK] background error:', error);
    const progress = getProgress(jobId);
    if (progress) {
      progress.status = 'failed';
      progress.completedAt = Date.now();
      progress.errors.push({ reason: error.message });
    }
  }
}

// GET /api/sk-guru/bulk-progress/:jobId - Get progress of bulk generate
router.get('/bulk-progress/:jobId', authenticateOperator, async (req, res) => {
  try {
    const { jobId } = req.params;
    const progress = getProgress(jobId);
    
    if (!progress) {
      return res.status(404).json({ success: false, message: 'Job tidak ditemukan atau sudah expired' });
    }
    
    res.json({ success: true, data: progress });
  } catch (error) {
    console.error('Get bulk progress error:', error);
    res.status(500).json({ success: false, message: 'Error getting progress: ' + error.message });
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
const nomorUrut = await getActualNextSkNumber(hijriToday.year);
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


// ============================================================
// PENUGASAN GURU
// ============================================================

function normalizeJabatan(str) {
  return String(str || '').toLowerCase().replace(/[\s_]+/g, '');
}

function isPenugasanManagerAssignment(a) {
  const j = normalizeJabatan(a.jabatan_di_unit);
  return j.includes('sdm') || ['kepalasekolah', 'kepala', 'pimpinan', 'ketua'].includes(j);
}

async function getPenugasanAllowedTenants(req) {
  const getAllTenants = async () => {
    const rows = await db.query('SELECT tenant_id FROM tenants');
    return rows.map(t => t.tenant_id);
  };

  if (req.user.role === 'admin') return getAllTenants();

  const assignments = req.user.assignments || [];
  const isSdmPusat = assignments.some(a =>
    a.tenant_id === 'YPWILUTIM' && normalizeJabatan(a.jabatan_di_unit).includes('sdm')
  );
  if (isSdmPusat) return getAllTenants();

  return [...new Set(
    assignments
      .filter(isPenugasanManagerAssignment)
      .map(a => a.tenant_id)
      .filter(Boolean)
  )];
}

function formatISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function getJabatanTunjanganMap() {
  try {
    const rows = await db.query('SELECT jabatan_key, jabatan_label, nominal FROM kafalah_jabatan_tunjangan');
    const map = {};
    (rows || []).forEach(r => {
      map[normalizeJabatan(r.jabatan_key)] = Number(r.nominal) || 0;
    });
    return map;
  } catch (error) {
    console.warn('[PENUGASAN] Gagal memuat default tunjangan jabatan:', error.message);
    return {};
  }
}

function resolveTunjanganJabatan(jabatan, map) {
  const key = normalizeJabatan(jabatan);
  const result = {
    tunj_kepala_sekolah: 0,
    tunj_wali_kelas: 0,
    honor_bendahara: 0
  };
  if (!key) return result;

  const hasKey = Object.prototype.hasOwnProperty.call(map, key);
  const nominal = hasKey ? (Number(map[key]) || 0) : 0;

  if (key.includes('kepalasekolah') || key.includes('kepsek') || key.includes('wakasek') || key.includes('pimpinan') || key.includes('ketua')) {
    result.tunj_kepala_sekolah = nominal;
  } else if (key.includes('bendahara')) {
    result.honor_bendahara = nominal;
  } else if (key.includes('walikelas')) {
    result.tunj_wali_kelas = nominal;
  }
  return result;
}

async function getPenugasanTeacher(teacherId) {
  const rows = await db.query(
    `SELECT id, nama, nik, nip, tempat_lahir, tanggal_lahir, status_kepegawaian, tmt,
            pendidikan_terakhir as pt, status_aktif,
            gaji_pokok, tunj_kinerja, tunj_umum, tunj_istri, tunj_anak,
            tunj_kepala_sekolah, tunj_wali_kelas, honor_bendahara, tunj_kehadiran, potongan
     FROM teachers WHERE id = ?`,
    [teacherId]
  );
  return rows[0] || null;
}

async function getPenugasanAssignments(teacherId) {
  return db.query(
    `SELECT ta.*, tn.nama_sekolah, tn.id as tenant_pk
     FROM teacher_assignments ta
     LEFT JOIN tenants tn ON ta.tenant_id = tn.tenant_id
     WHERE ta.teacher_id = ?
     ORDER BY ta.is_paid DESC, ta.created_at ASC, ta.id ASC`,
    [teacherId]
  );
}

async function getPenugasanTenant(tenantId) {
  const rows = await db.query(
    'SELECT tenant_id, nama_sekolah, id FROM tenants WHERE tenant_id = ?',
    [tenantId]
  );
  return rows[0] || null;
}

async function preparePenugasan(req) {
  const b = req.body || {};
  const teacherId = parseInt(b.teacher_id);
  if (!teacherId) {
    const err = new Error('teacher_id wajib diisi');
    err.status = 400;
    throw err;
  }

  const toTenantId = b.to_tenant_id;
  const toJabatan = String(b.to_jabatan || '').trim();
  if (!toTenantId || !toJabatan) {
    const err = new Error('Sekolah tujuan dan jabatan baru wajib diisi');
    err.status = 400;
    throw err;
  }
  if (toJabatan.length > 100) {
    const err = new Error('Jabatan baru maksimal 100 karakter');
    err.status = 400;
    throw err;
  }

  const startDate = parseDate(b.tanggal_mulai) || new Date();
  let endDate = parseDate(b.tanggal_selesai);
  if (!endDate) endDate = new Date(startDate.getFullYear(), 11, 31);
  if (endDate.getTime() < startDate.getTime()) {
    const err = new Error('Tanggal selesai tidak boleh sebelum tanggal mulai');
    err.status = 400;
    throw err;
  }

  const allowedTenants = await getPenugasanAllowedTenants(req);
  if (!allowedTenants.includes(toTenantId)) {
    const err = new Error('Akses ditolak untuk sekolah tujuan');
    err.status = 403;
    throw err;
  }

  const teacher = await getPenugasanTeacher(teacherId);
  if (!teacher || !teacher.status_aktif) {
    const err = new Error('Guru tidak ditemukan atau nonaktif');
    err.status = 404;
    throw err;
  }

  const assignments = await getPenugasanAssignments(teacherId);
  const activeAssignments = assignments.filter(a => a.is_paid);

  let fromAssignment = null;
  if (b.from_assignment_id) {
    fromAssignment = assignments.find(a => a.id === parseInt(b.from_assignment_id));
    if (!fromAssignment) {
      const err = new Error('Assignment asal tidak ditemukan');
      err.status = 400;
      throw err;
    }
    if (!fromAssignment.is_paid) {
      const err = new Error('Assignment asal sudah tidak aktif');
      err.status = 400;
      throw err;
    }
    if (!allowedTenants.includes(fromAssignment.tenant_id)) {
      const err = new Error('Akses ditolak untuk sekolah asal');
      err.status = 403;
      throw err;
    }
  } else if (activeAssignments.length > 0) {
    const err = new Error('Pilih assignment asal terlebih dahulu');
    err.status = 400;
    throw err;
  }

  const toTenant = await getPenugasanTenant(toTenantId);
  if (!toTenant) {
    const err = new Error('Sekolah tujuan tidak ditemukan');
    err.status = 400;
    throw err;
  }

  let jenis;
  if (!fromAssignment) {
    jenis = 'baru';
  } else if (fromAssignment.tenant_id !== toTenantId) {
    jenis = 'mutasi';
  } else if (normalizeJabatan(fromAssignment.jabatan_di_unit) !== normalizeJabatan(toJabatan)) {
    jenis = 'beralih';
  } else {
    const err = new Error('Jabatan tidak berubah');
    err.status = 400;
    throw err;
  }

  const targetAssignment = assignments.find(a =>
    a.tenant_id === toTenantId && normalizeJabatan(a.jabatan_di_unit) === normalizeJabatan(toJabatan)
  );
  if (targetAssignment && targetAssignment.is_paid) {
    const err = new Error('Guru sudah memiliki jabatan aktif tersebut di sekolah tujuan');
    err.status = 400;
    throw err;
  }

  const tentangFinal = String(b.tentang || '').trim() || ('PENUGASAN JABATAN (' + toTenant.nama_sekolah + ')');
  if (tentangFinal.length > 255) {
    const err = new Error('Tentang SK maksimal 255 karakter');
    err.status = 400;
    throw err;
  }

  return {
    b,
    teacher,
    assignments,
    fromAssignment,
    toTenant,
    toJabatan,
    jenis,
    targetAssignment,
    tentangFinal,
    startDate,
    endDate,
    tanggalMulaiISO: formatISODate(startDate),
    tanggalSelesaiISO: formatISODate(endDate)
  };
}

router.get('/penugasan/jabatan-tunjangan', authenticateOperator, async (req, res) => {
  try {
    const rows = await db.query(
      'SELECT id, jabatan_key, jabatan_label, nominal FROM kafalah_jabatan_tunjangan ORDER BY nominal DESC, jabatan_label'
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Get penugasan jabatan tunjangan error:', error);
    res.status(500).json({ success: false, message: 'Error mengambil tunjangan jabatan', error: error.message });
  }
});

router.get('/penugasan/candidates', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getPenugasanAllowedTenants(req);
    if (!allowedTenants.length) {
      return res.json({ success: true, data: [] });
    }

    const q = String(req.query.q || '').trim();
    const tenantFilter = req.query.tenant_id || '';
    const where = ['t.status_aktif = 1'];
    const params = [];

    if (tenantFilter && allowedTenants.includes(tenantFilter)) {
      where.push('ta.tenant_id = ?');
      params.push(tenantFilter);
    } else {
      const placeholders = allowedTenants.map(() => '?').join(',');
      where.push(`(ta.tenant_id IN (${placeholders}) OR ta.tenant_id IS NULL)`);
      params.push(...allowedTenants);
    }

    if (q) {
      where.push('(t.nama LIKE ? OR t.nik LIKE ? OR t.nip LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const rows = await db.query(
      `SELECT t.id as teacher_id, t.nama, t.nik, t.nip, t.status_kepegawaian, t.tmt,
              t.pendidikan_terakhir as pt,
              ta.id as assignment_id, ta.tenant_id, ta.jabatan_di_unit, ta.is_paid,
              tn.nama_sekolah, tn.id as tenant_pk
       FROM teachers t
       LEFT JOIN teacher_assignments ta ON t.id = ta.teacher_id
       LEFT JOIN tenants tn ON ta.tenant_id = tn.tenant_id
       WHERE ${where.join(' AND ')}
       ORDER BY t.nama ASC, ta.is_paid DESC, ta.id ASC
       LIMIT 500`,
      params
    );

    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.teacher_id)) {
        map.set(r.teacher_id, {
          teacher_id: r.teacher_id,
          nama: r.nama,
          nik: r.nik,
          nip: r.nip,
          status_kepegawaian: r.status_kepegawaian,
          tmt: r.tmt,
          pt: r.pt,
          assignments: []
        });
      }
      if (r.assignment_id) {
        map.get(r.teacher_id).assignments.push({
          id: r.assignment_id,
          tenant_id: r.tenant_id,
          nama_sekolah: r.nama_sekolah,
          tenant_pk: r.tenant_pk,
          jabatan_di_unit: r.jabatan_di_unit,
          is_paid: r.is_paid
        });
      }
    }

    res.json({ success: true, data: Array.from(map.values()) });
  } catch (error) {
    console.error('Get penugasan candidates error:', error);
    res.status(500).json({ success: false, message: 'Error mengambil kandidat penugasan', error: error.message });
  }
});

router.get('/penugasan', authenticateOperator, async (req, res) => {
  try {
    const allowedTenants = await getPenugasanAllowedTenants(req);
    if (!allowedTenants.length) {
      return res.json({ success: true, data: { data: [], total: 0, page: 1, pages: 1 } });
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 15));
    const offset = (page - 1) * limit;
    const q = String(req.query.q || '').trim();
    const tenantId = String(req.query.tenant_id || '');
    const jenis = String(req.query.jenis || '');
    const status = String(req.query.status || '');

    const placeholders = allowedTenants.map(() => '?').join(',');

    // ---- Branch 1: riwayat penugasan (ada SK) ----
    const where1 = [];
    const params1 = [];
    where1.push(`tp.to_tenant_id IN (${placeholders})`);
    params1.push(...allowedTenants);
    if (tenantId && allowedTenants.includes(tenantId)) {
      where1.push('tp.to_tenant_id = ?');
      params1.push(tenantId);
    }
    if (jenis) { where1.push('tp.jenis = ?'); params1.push(jenis); }
    if (status) { where1.push('tp.status = ?'); params1.push(status); }
    if (q) {
      where1.push('(t.\`nama\` LIKE ? OR tp.no_surat LIKE ? OR tp.to_jabatan LIKE ? OR tp.from_jabatan LIKE ? OR ta.jabatan_di_unit LIKE ? OR tcr.jabatan_di_unit LIKE ?)');
      params1.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    const whereClause1 = 'WHERE ' + where1.join(' AND ');

    const sql1 = `SELECT tp.id as id, tp.id as pk, 1 as is_penugasan, t.id as teacher_id,
              tp.from_assignment_id as from_assignment_id,
              tp.from_tenant_id, tp.to_tenant_id, tp.from_jabatan, tp.to_jabatan,
              tp.jenis, tp.tanggal_mulai, tp.tanggal_selesai, tp.periode,
              tp.tentang, tp.no_surat, tp.sk_guru_id, tp.keterangan,
              tp.status, tp.replaced_by_id, tp.created_by, tp.created_at, tp.updated_at,
              t.\`nama\` as nama, t.nik, t.nip,
              tf.id as from_tenant_pk, tf.tenant_id as from_tenant_id_raw, tf.nama_sekolah as from_unit,
              tt.id as to_tenant_pk, tt.tenant_id as to_tenant_id_raw, tt.nama_sekolah as to_unit,
              sg.no_surat as sk_no_surat, sg.tentang as sk_tentang,
              sg.jabatan as sk_jabatan, sg.tgl_mulai as sk_tgl_mulai, sg.tgl_selesai as sk_tgl_selesai,
              sg.drive_web_view_link
       FROM teacher_penugasan tp
       JOIN teachers t ON tp.teacher_id = t.id
       LEFT JOIN tenants tf ON tp.from_tenant_id = tf.tenant_id
       LEFT JOIN tenants tt ON tp.to_tenant_id = tt.tenant_id
       LEFT JOIN sk_guru sg ON tp.sk_guru_id = sg.id
       LEFT JOIN teacher_assignments ta ON ta.id = tp.to_assignment_id
       LEFT JOIN teacher_assignments tcr ON tcr.id = tp.from_assignment_id
       ${whereClause1}`;

    // ---- Branch 2: assignment aktif yang belum punya riwayat penugasan ----
    const where2 = [];
    const params2 = [];
    where2.push(`ta.tenant_id IN (${placeholders})`);
    params2.push(...allowedTenants);
    if (tenantId && allowedTenants.includes(tenantId)) {
      where2.push('ta.tenant_id = ?');
      params2.push(tenantId);
    }
    if (q) {
      where2.push('(t.\`nama\` LIKE ? OR ta.jabatan_di_unit LIKE ? OR tn.\`nama_sekolah\` LIKE ?)');
      params2.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const whereClause2 = 'WHERE ta.is_paid = 1 AND NOT EXISTS (SELECT 1 FROM teacher_penugasan tp WHERE tp.to_assignment_id = ta.id) AND ' + where2.join(' AND ');

    const sql2 = `SELECT ta.id as id, ta.id as pk, 0 as is_penugasan, t.id as teacher_id,
              NULL as from_assignment_id,
              NULL as from_tenant_id, ta.tenant_id as to_tenant_id, NULL as from_jabatan,
              ta.jabatan_di_unit as to_jabatan, NULL as jenis, NULL as tanggal_mulai,
              NULL as tanggal_selesai, NULL as periode, NULL as tentang, NULL as no_surat,
              NULL as sk_guru_id, NULL as keterangan, 'aktif' as status, NULL as replaced_by_id,
              NULL as created_by, NULL as created_at, NULL as updated_at,
              t.\`nama\` as nama, t.nik, t.nip,
              NULL as from_tenant_pk, NULL as from_tenant_id_raw, NULL as from_unit,
              tn.id as to_tenant_pk, tn.tenant_id as to_tenant_id_raw, tn.nama_sekolah as to_unit,
              NULL as sk_no_surat, NULL as sk_tentang, NULL as sk_jabatan,
              NULL as sk_tgl_mulai, NULL as sk_tgl_selesai, NULL as drive_web_view_link
       FROM teacher_assignments ta
       JOIN teachers t ON ta.teacher_id = t.id
       JOIN tenants tn ON ta.tenant_id = tn.tenant_id
       ${whereClause2}`;

    const union = `(${sql1}) UNION ALL (${sql2})`;
    const countRows = await db.query(
      `SELECT COUNT(*) as total FROM (${union}) sub`,
      [...params1, ...params2]
    );
    const total = countRows[0]?.total || 0;
    const pages = Math.max(1, Math.ceil(total / limit));

    const rows = await db.query(
      `SELECT sub.* FROM (${union}) sub
       ORDER BY sub.created_at IS NULL ASC, sub.created_at DESC, sub.pk DESC
       LIMIT ${limit} OFFSET ${offset}`,
      [...params1, ...params2]
    );

    res.json({ success: true, data: { data: rows, total, page, pages } });
  } catch (error) {
    console.error('Get penugasan list error:', error);
    res.status(500).json({ success: false, message: 'Error mengambil daftar penugasan', error: error.message });
  }
});

router.get('/penugasan/:id', authenticateOperator, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const rows = await db.query(
      `SELECT tp.*, t.nama, t.nik, t.nip, t.status_kepegawaian, t.tmt,
              t.pendidikan_terakhir as pt,
              tf.nama_sekolah as from_unit, tt.nama_sekolah as to_unit,
              sg.no_surat as sk_no_surat, sg.tentang as sk_tentang,
              sg.jabatan as sk_jabatan, sg.tgl_mulai as sk_tgl_mulai, sg.tgl_selesai as sk_tgl_selesai,
              sg.drive_web_view_link
       FROM teacher_penugasan tp
       JOIN teachers t ON tp.teacher_id = t.id
       LEFT JOIN tenants tf ON tp.from_tenant_id = tf.tenant_id
       LEFT JOIN tenants tt ON tp.to_tenant_id = tt.tenant_id
       LEFT JOIN sk_guru sg ON tp.sk_guru_id = sg.id
       WHERE tp.id = ?`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Penugasan tidak ditemukan' });
    }

    const allowedTenants = await getPenugasanAllowedTenants(req);
    if (!allowedTenants.includes(rows[0].to_tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak untuk sekolah ini' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Get penugasan detail error:', error);
    res.status(500).json({ success: false, message: 'Error mengambil detail penugasan', error: error.message });
  }
});

router.get('/penugasan/:id/sk', authenticateOperator, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const rows = await db.query(
      'SELECT to_tenant_id, sk_guru_id FROM teacher_penugasan WHERE id = ?',
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Penugasan tidak ditemukan' });
    }

    const allowedTenants = await getPenugasanAllowedTenants(req);
    if (!allowedTenants.includes(rows[0].to_tenant_id)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak untuk sekolah ini' });
    }
    if (!rows[0].sk_guru_id) {
      return res.status(404).json({ success: false, message: 'SK belum tersedia' });
    }

    return res.redirect(`/api/sk-guru/file/${rows[0].sk_guru_id}?view=1`);
  } catch (error) {
    console.error('Redirect penugasan SK error:', error);
    res.status(500).json({ success: false, message: 'Error membuka SK penugasan', error: error.message });
  }
});

router.post('/penugasan/preview', authenticateOperator, async (req, res) => {
  try {
    const prep = await preparePenugasan(req);
    const { teacher, fromAssignment, toTenant, toJabatan, jenis, tentangFinal, tanggalMulaiISO, tanggalSelesaiISO } = prep;

    const hijriToday = gregorianToHijri(new Date());
    const nomorUrut = await peekActualNextSkNumber(hijriToday.year);

    const teacherSynthetic = Object.assign({}, teacher, {
      nama_sekolah: toTenant.nama_sekolah,
      tenant_id: toTenant.tenant_id,
      tenant_pk: toTenant.id,
      unit: toJabatan,
      jabatan_di_unit: toJabatan
    });

    const skData = await buildSkData(
      teacherSynthetic,
      'jabatan',
      teacher.pt,
      null,
      nomorUrut,
      hijriToday.year,
      null,
      tanggalMulaiISO,
      tanggalSelesaiISO,
      tentangFinal,
      null,
      toJabatan
    );

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
        tgl_mulai: skData.tglMulai,
        tgl_selesai: skData.tglSelesai,
        periode: skData.periode,
        bh: skData.bhFormatted,
        bm: skData.bmFormatted,
        jenis,
        tanggal_mulai: tanggalMulaiISO,
        tanggal_selesai: tanggalSelesaiISO,
        from: fromAssignment ? {
          assignment_id: fromAssignment.id,
          tenant_id: fromAssignment.tenant_id,
          nama_sekolah: fromAssignment.nama_sekolah,
          jabatan: fromAssignment.jabatan_di_unit
        } : null,
        to: {
          tenant_id: toTenant.tenant_id,
          nama_sekolah: toTenant.nama_sekolah,
          jabatan: toJabatan
        }
      }
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error('Preview penugasan error:', error);
    res.status(500).json({ success: false, message: 'Error preview penugasan: ' + error.message });
  }
});

router.post('/penugasan', authenticateOperator, async (req, res) => {
  try {
    const prep = await preparePenugasan(req);
    const { b, teacher, fromAssignment, toTenant, toJabatan, jenis, targetAssignment, tentangFinal, tanggalMulaiISO, tanggalSelesaiISO } = prep;

    const jabatanMap = await getJabatanTunjanganMap();
    const tunj = resolveTunjanganJabatan(toJabatan, jabatanMap);
    const base = fromAssignment || teacher;

    const tunjKepalaSekolah = (b.tunj_kepala_sekolah !== undefined && b.tunj_kepala_sekolah !== '')
      ? (Number(b.tunj_kepala_sekolah) || 0)
      : tunj.tunj_kepala_sekolah;
    const tunjWaliKelas = (b.tunj_wali_kelas !== undefined && b.tunj_wali_kelas !== '')
      ? (Number(b.tunj_wali_kelas) || 0)
      : tunj.tunj_wali_kelas;
    const honorBendahara = (b.honor_bendahara !== undefined && b.honor_bendahara !== '')
      ? (Number(b.honor_bendahara) || 0)
      : tunj.honor_bendahara;

    const gajiPokok = Number(base.gaji_pokok) || 0;
    const tunjKinerja = Number(base.tunj_kinerja) || 0;
    const tunjUmum = Number(base.tunj_umum) || 0;
    const tunjIstri = Number(base.tunj_istri) || 0;
    const tunjAnak = Number(base.tunj_anak) || 0;
    const tunjKehadiran = Number(base.tunj_kehadiran) || 0;
    const potongan = Number(base.potongan) || 0;
    const kpiCategory = base.kpi_category
      || (normalizeJabatan(toJabatan).includes('guru') || normalizeJabatan(toJabatan).includes('walikelas') ? 'guru' : 'staf');

    const result = await db.transaction(async (connection) => {
      const [teacherRows] = await connection.query(
        'SELECT id, nama, nip FROM teachers WHERE id = ? FOR UPDATE',
        [teacher.id]
      );
      if (!teacherRows || !teacherRows.length) {
        const err = new Error('Guru tidak ditemukan');
        err.status = 404;
        throw err;
      }
      const lockedTeacher = teacherRows[0];

      const prevCondition = fromAssignment
        ? 'teacher_id = ? AND status = "aktif" AND (from_assignment_id = ? OR to_assignment_id = ?)'
        : 'teacher_id = ? AND status = "aktif"';
      const prevParams = fromAssignment
        ? [teacher.id, fromAssignment.id, fromAssignment.id]
        : [teacher.id];

      await connection.query(
        `UPDATE teacher_penugasan SET status = "digantikan" WHERE ${prevCondition}`,
        prevParams
      );

      const [insertTp] = await connection.query(
        `INSERT INTO teacher_penugasan
          (teacher_id, from_assignment_id, from_tenant_id, to_tenant_id, from_jabatan,
           to_jabatan, jenis, tanggal_mulai, tanggal_selesai, tentang, keterangan, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "aktif", ?)`,
        [
          teacher.id,
          fromAssignment ? fromAssignment.id : null,
          fromAssignment ? fromAssignment.tenant_id : null,
          toTenant.tenant_id,
          fromAssignment ? fromAssignment.jabatan_di_unit : null,
          toJabatan,
          jenis,
          tanggalMulaiISO,
          tanggalSelesaiISO,
          tentangFinal,
          b.keterangan || null,
          req.user.id || req.user.guru_id || null
        ]
      );
      const penugasanId = insertTp.insertId;

      if (fromAssignment) {
        const crossTenant = fromAssignment.tenant_id !== toTenant.tenant_id;
        await connection.query(
          `UPDATE teacher_assignments
           SET is_paid = 0, mutasi_status = NULL, mutasi_reason = ?, mutasi_date = NOW()
           WHERE id = ? AND teacher_id = ?`,
          [
            crossTenant
              ? ('Mutasi ke ' + toTenant.nama_sekolah + ' sebagai ' + toJabatan)
              : ('Beralih jabatan: ' + (fromAssignment.jabatan_di_unit || '-') + ' -> ' + toJabatan),
            fromAssignment.id,
            teacher.id
          ]
        );
      }

      let toAssignmentId;
      try {
        if (targetAssignment) {
          toAssignmentId = targetAssignment.id;
          await connection.query(
            `UPDATE teacher_assignments
             SET tenant_id = ?, jabatan_di_unit = ?, is_paid = 1,
                 gaji_pokok = ?, tunj_kinerja = ?, tunj_umum = ?, tunj_istri = ?, tunj_anak = ?,
                 tunj_kepala_sekolah = ?, tunj_wali_kelas = ?, honor_bendahara = ?, tunj_kehadiran = ?, potongan = ?,
                 kpi_category = ?, class_id = NULL,
                 mutasi_status = NULL, mutasi_reason = NULL, mutasi_date = NULL
             WHERE id = ?`,
            [
              toTenant.tenant_id, toJabatan,
              gajiPokok, tunjKinerja, tunjUmum, tunjIstri, tunjAnak,
              tunjKepalaSekolah, tunjWaliKelas, honorBendahara, tunjKehadiran, potongan,
              kpiCategory, toAssignmentId
            ]
          );
        } else {
          const [insertTa] = await connection.query(
            `INSERT INTO teacher_assignments
              (teacher_id, tenant_id, jabatan_di_unit, class_id, is_paid,
               gaji_pokok, tunj_kinerja, tunj_umum, tunj_istri, tunj_anak,
               tunj_kepala_sekolah, tunj_wali_kelas, honor_bendahara, tunj_kehadiran, potongan, kpi_category)
             VALUES (?, ?, ?, NULL, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              teacher.id, toTenant.tenant_id, toJabatan,
              gajiPokok, tunjKinerja, tunjUmum, tunjIstri, tunjAnak,
              tunjKepalaSekolah, tunjWaliKelas, honorBendahara, tunjKehadiran, potongan,
              kpiCategory
            ]
          );
          toAssignmentId = insertTa.insertId;
        }
      } catch (assignErr) {
        if (assignErr.code === 'ER_DUP_ENTRY') {
          const err = new Error('Guru sudah memiliki assignment tersebut di sekolah tujuan');
          err.status = 409;
          throw err;
        }
        throw assignErr;
      }

      await connection.query(
        'UPDATE teacher_penugasan SET to_assignment_id = ? WHERE id = ?',
        [toAssignmentId, penugasanId]
      );

      const hijriToday = gregorianToHijri(new Date());
      const nomorUrut = await getActualNextSkNumberWithLock(hijriToday.year, connection);

      const teacherSynthetic = Object.assign({}, teacher, {
        nama_sekolah: toTenant.nama_sekolah,
        tenant_id: toTenant.tenant_id,
        tenant_pk: toTenant.id,
        unit: toJabatan,
        jabatan_di_unit: toJabatan
      });

      const skData = await buildSkData(
        teacherSynthetic,
        'jabatan',
        teacher.pt,
        null,
        nomorUrut,
        hijriToday.year,
        null,
        tanggalMulaiISO,
        tanggalSelesaiISO,
        tentangFinal,
        null,
        toJabatan
      );

      if (skData.niy) {
        const [conflictRows] = await connection.query(
          'SELECT id FROM teachers WHERE nip = ? AND id != ?',
          [skData.niy, teacher.id]
        );
        if (conflictRows && conflictRows.length) {
          const err = new Error('NIY sudah digunakan guru lain. Hubungi administrator.');
          err.status = 409;
          throw err;
        }
      }

      let insertSk;
      try {
        [insertSk] = await connection.query(
          `INSERT INTO sk_guru
            (teacher_id, tenant_id, tahun_ajaran_id, no_surat, tentang, ttl, tmt, pt, niy,
             unit, bh, bm, jabatan, status, tentag_type, tgl_mulai, tgl_selesai, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "jabatan", ?, ?, NOW())`,
          [
            teacher.id, toTenant.tenant_id, req.activeTahunAjaran?.id || null,
            skData.noSurat, skData.tentang, skData.ttl, skData.tmtFormatted, skData.ptFormatted,
            skData.niy, skData.unit, skData.bhFormatted, skData.bmFormatted,
            skData.jabatan, skData.status, skData.tglMulai, skData.tglSelesai
          ]
        );
      } catch (skErr) {
        if (skErr.code === 'ER_DUP_ENTRY') {
          const err = new Error('Nomor surat sudah digunakan. Silakan coba lagi.');
          err.status = 409;
          throw err;
        }
        throw skErr;
      }
      const skId = insertSk.insertId;

      await connection.query(
        'UPDATE teacher_penugasan SET sk_guru_id = ?, no_surat = ?, periode = ? WHERE id = ?',
        [skId, skData.noSurat, skData.periode, penugasanId]
      );

      await connection.query(
        `UPDATE teacher_penugasan SET replaced_by_id = ? WHERE ${prevCondition} AND replaced_by_id IS NULL`,
        [penugasanId, ...prevParams]
      );

      if ((!lockedTeacher.nip || lockedTeacher.nip === '-' || lockedTeacher.nip === '') && skData.niy) {
        await connection.query('UPDATE teachers SET nip = ? WHERE id = ?', [skData.niy, teacher.id]);
      }

      return {
        penugasanId,
        skId,
        noSurat: skData.noSurat,
        skData,
        teacherSynthetic
      };
    });

    let warning = null;
    try {
      const htmlData = {
        noSurat: result.skData.noSurat,
        tentang: result.skData.tentang,
        nama: result.teacherSynthetic.nama,
        ttl: result.skData.ttl,
        tmtFormatted: result.skData.tmtFormatted,
        ptFormatted: result.skData.ptFormatted,
        niy: result.skData.niy,
        unit: result.skData.unit,
        jabatan: result.skData.jabatan,
        tglMulai: result.skData.tglMulai,
        status: result.skData.status,
        tglSelesai: result.skData.tglSelesai,
        bhFormatted: result.skData.bhFormatted,
        bmFormatted: result.skData.bmFormatted,
        periode: result.skData.periode
      };
      const pdfBuf = await generateSkPdf(htmlData);
      const driveMeta = await archiveSkPdfToDrive(result.teacherSynthetic, result.skData, pdfBuf, 'jabatan');
      if (driveMeta) {
        await db.query(
          `UPDATE sk_guru
           SET drive_file_id = ?, drive_file_name = ?, drive_folder_id = ?, drive_web_view_link = ?, drive_uploaded_at = NOW()
           WHERE id = ?`,
          [driveMeta.drive_file_id, driveMeta.drive_file_name, driveMeta.drive_folder_id, driveMeta.drive_web_view_link, result.skId]
        );
      }
    } catch (pdfErr) {
      console.error('[PENUGASAN] PDF/Drive archive error:', pdfErr.message);
      warning = 'SK tersimpan, tetapi arsip Drive gagal dibuat.';
    }

    res.json({
      success: true,
      data: {
        penugasan_id: result.penugasanId,
        sk_guru_id: result.skId,
        no_surat: result.noSurat,
        download_url: `/api/sk-guru/file/${result.skId}?view=1`,
        warning
      }
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error('Save penugasan error:', error);
    res.status(500).json({ success: false, message: 'Error menyimpan penugasan: ' + error.message });
  }
});

module.exports = router;
