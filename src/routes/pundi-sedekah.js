const express = require('express');
const router = express.Router();
const db = require('../../db');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');
const { formatPhoneNumber } = require(path.join(__dirname, '../utils/whatsappTemplate'));

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.csv', '.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Format file harus .csv, .xlsx, atau .xls'));
  }
});

// Initialize donors table if not exists
async function ensureDonaturTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS donatur_pundi_ceria (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nama_donatur VARCHAR(100) NOT NULL,
      no_wa VARCHAR(20) NOT NULL,
      nama_siswa VARCHAR(100) NOT NULL,
      kelas VARCHAR(50) DEFAULT NULL,
      sekolah_yayasan VARCHAR(200) DEFAULT NULL,
      status ENUM('aktif', 'non-aktif') DEFAULT 'aktif',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

// Initialize calon donatur (prospek) table
async function ensureCalonDonaturTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS calon_donatur_pundi_ceria (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nama_calon_donatur VARCHAR(100) NOT NULL,
      no_wa VARCHAR(20) NOT NULL,
      nama_siswa VARCHAR(100) DEFAULT NULL,
      kelas VARCHAR(50) DEFAULT NULL,
      sekolah_yayasan VARCHAR(200) DEFAULT NULL,
      keterangan VARCHAR(255) DEFAULT NULL,
      status ENUM('calon', 'menjadi_donatur', 'non-aktif') DEFAULT 'calon',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_no_wa (no_wa)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

// Initialize WhatsApp message history table
async function ensureWaHistoryTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS wa_pundi_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tujuan ENUM('manual', 'calon_donatur', 'siswa') DEFAULT 'manual',
      nama_penerima VARCHAR(100) DEFAULT NULL,
      nomor VARCHAR(20) NOT NULL,
      pesan TEXT NOT NULL,
      template VARCHAR(50) DEFAULT NULL,
      status ENUM('terkirim', 'gagal') DEFAULT 'terkirim',
      error_message TEXT DEFAULT NULL,
      message_id VARCHAR(100) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

// Ensure tables exist on route access
ensureDonaturTable();
ensureCalonDonaturTable();
ensureWaHistoryTable();

// ============================================================
// GET: List donatur pundi ceria
// ============================================================
router.get('/', async (req, res) => {
  try {
    const donatur = await db.query(
      'SELECT * FROM donatur_pundi_ceria ORDER BY created_at DESC'
    );
    res.json({ success: true, data: donatur || [] });
  } catch (error) {
    console.error('[PUNDI-SEDEKAH] Error fetching donatur:', error.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ============================================================
// CALON DONATUR (PROSPEK) ROUTES
// ============================================================

// GET: List calon donatur (prospek)
router.get('/calon-donatur', async (req, res) => {
  try {
    const rows = await db.query(
      'SELECT * FROM calon_donatur_pundi_ceria ORDER BY created_at DESC'
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('[PUNDI-SEDEKAH] Error fetching calon donatur:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST: Tambah calon donatur baru
router.post('/calon-donatur', async (req, res) => {
  try {
    let { nama_calon_donatur, no_wa, nama_siswa, kelas, sekolah_yayasan, keterangan } = req.body;

    if (!nama_calon_donatur || !no_wa) {
      return res.status(400).json({ success: false, message: 'Nama calon donatur dan no WA wajib diisi' });
    }

    const formattedNoWa = formatPhoneNumber(no_wa);
    if (!formattedNoWa) {
      return res.status(400).json({ success: false, message: 'Nomor WA tidak valid' });
    }

    // Cek duplikat nomor
    const existing = await db.query(
      'SELECT id FROM calon_donatur_pundi_ceria WHERE no_wa = ?',
      [formattedNoWa]
    );
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Nomor WA sudah terdaftar sebagai calon donatur' });
    }

    const result = await db.query(
      'INSERT INTO calon_donatur_pundi_ceria (nama_calon_donatur, no_wa, nama_siswa, kelas, sekolah_yayasan, keterangan) VALUES (?, ?, ?, ?, ?, ?)',
      [nama_calon_donatur, formattedNoWa, nama_siswa || null, kelas || null, sekolah_yayasan || null, keterangan || null]
    );

    res.json({
      success: true,
      data: {
        id: result.insertId,
        nama_calon_donatur,
        no_wa: formattedNoWa,
        nama_siswa,
        kelas,
        sekolah_yayasan,
        keterangan,
        status: 'calon'
      }
    });
  } catch (error) {
    console.error('[PUNDI-SEDEKAH] Error adding calon donatur:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT: Update calon donatur
router.put('/calon-donatur/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nama_calon_donatur, no_wa, nama_siswa, kelas, sekolah_yayasan, keterangan, status } = req.body;

    const existingRows = await db.query('SELECT id FROM calon_donatur_pundi_ceria WHERE id = ?', [id]);
    if (existingRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Calon donatur tidak ditemukan' });
    }

    const updates = {};
    if (nama_calon_donatur !== undefined) updates.nama_calon_donatur = nama_calon_donatur;
    if (nama_siswa !== undefined) updates.nama_siswa = nama_siswa || null;
    if (kelas !== undefined) updates.kelas = kelas || null;
    if (sekolah_yayasan !== undefined) updates.sekolah_yayasan = sekolah_yayasan || null;
    if (keterangan !== undefined) updates.keterangan = keterangan || null;
    if (status !== undefined) updates.status = status;
    if (no_wa !== undefined) {
      const formattedNoWa = formatPhoneNumber(no_wa);
      if (!formattedNoWa) {
        return res.status(400).json({ success: false, message: 'Nomor WA tidak valid' });
      }
      const dup = await db.query(
        'SELECT id FROM calon_donatur_pundi_ceria WHERE no_wa = ? AND id != ?',
        [formattedNoWa, id]
      );
      if (dup.length > 0) {
        return res.status(409).json({ success: false, message: 'Nomor WA sudah dipakai calon donatur lain' });
      }
      updates.no_wa = formattedNoWa;
    }

    if (Object.keys(updates).length === 0) {
      return res.json({ success: true, message: 'Tidak ada data yang diupdate' });
    }

    const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.query(`UPDATE calon_donatur_pundi_ceria SET ${setClause} WHERE id = ?`, [...Object.values(updates), id]);

    res.json({ success: true, message: 'Calon donatur berhasil diupdate' });
  } catch (error) {
    console.error('[PUNDI-SEDEKAH] Error updating calon donatur:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE: Hapus calon donatur
router.delete('/calon-donatur/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query('DELETE FROM calon_donatur_pundi_ceria WHERE id = ?', [id]);
    if (!result || result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Calon donatur tidak ditemukan' });
    }
    res.json({ success: true, message: 'Calon donatur berhasil dihapus' });
  } catch (error) {
    console.error('[PUNDI-SEDEKAH] Error deleting calon donatur:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================
// WHATSAPP PUNDI SEDEKAH (Meta WhatsApp Business API)
// Digunakan untuk menghubungi CALON DONATUR (prospek) maupun
// donatur aktif melalui template resmi yang sudah APPROVED.
// ============================================================

const {
  fetchMetaTemplates,
  sendBillTemplate,
  sendBillTemplateWithRetry,
  sendFreeMessage,
  checkParamNamesLimit
} = require(path.join(__dirname, '../utils/whatsappTemplate'));

// URL aplikasi publik untuk halaman konfirmasi Pundi Ceria.
// Domain tombol pada template Meta sudah tetap (https://app.ypwilutim.com),
// jadi yang dikirim ke Meta hanya path + query string-nya.
function getPundiAppBaseUrl() {
  return (process.env.PUNDI_APP_URL || 'https://app.ypwilutim.com').replace(/\/+$/, '');
}

function buildKonfirmasiLink(ident) {
  return `${getPundiAppBaseUrl()}/konfirmasi-pundi.html?donaturId=${ident}`;
}

function buildKonfirmasiLinkByWa(nomor) {
  return `${getPundiAppBaseUrl()}/konfirmasi-pundi.html?no_wa=${encodeURIComponent(nomor)}`;
}

// Parameter untuk template pundi_ceria (urutan variabel mengikuti template Meta)
function buildPundiCeriaParams(data, linkKonfirmasi) {
  const namaSiswa = (data && data.nama_siswa) || 'Ananda';
  return {
    nama_siswa: namaSiswa,
    nama_sekolah_atau_yayasan: (data && data.sekolah_yayasan) || 'YPWI Lutim',
    nama_siswa_copy: namaSiswa,
    link_konfirmasi: linkKonfirmasi
  };
}

// Resolve penerima + link konfirmasi dari nomor tujuan
async function resolveRecipient(formattedWa, tujuan) {
  const calon = await db.query(
    'SELECT * FROM calon_donatur_pundi_ceria WHERE no_wa = ?',
    [formattedWa]
  );
  if (calon.length > 0) {
    const c = calon[0];
    return {
      nama_penerima: c.nama_calon_donatur,
      nama_siswa: c.nama_siswa,
      sekolah_yayasan: c.sekolah_yayasan,
      ref_id: c.id,
      ref_type: 'calon_donatur',
      link_konfirmasi: buildKonfirmasiLinkByWa(formattedWa)
    };
  }

  const donatur = await db.query(
    'SELECT * FROM donatur_pundi_ceria WHERE no_wa = ?',
    [formattedWa]
  );
  if (donatur.length > 0) {
    const d = donatur[0];
    return {
      nama_penerima: d.nama_donatur,
      nama_siswa: d.nama_siswa,
      sekolah_yayasan: d.sekolah_yayasan,
      ref_id: d.id,
      ref_type: 'donatur',
      link_konfirmasi: buildKonfirmasiLink(d.id)
    };
  }

  return {
    nama_penerima: tujuan === 'manual' ? 'Nomor Manual' : null,
    nama_siswa: 'Ananda',
    sekolah_yayasan: 'YPWI Lutim',
    ref_id: null,
    ref_type: tujuan || 'manual',
    link_konfirmasi: buildKonfirmasiLinkByWa(formattedWa)
  };
}

// GET: Daftar template WhatsApp dari Meta (untuk dropdown di halaman admin)
router.get('/whatsapp-templates', async (req, res) => {
  try {
    const result = await fetchMetaTemplates();
    res.json(result);
  } catch (error) {
    console.error('[PUNDI-SEDEKAH] Error whatsapp templates:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET: Status koneksi WhatsApp (cek lewat Meta Graph API)
router.get('/whatsapp-status', async (req, res) => {
  try {
    const result = await fetchMetaTemplates();
    const templates = result.data || [];
    const hasPundiCeria = templates.some(t => t.name === 'pundi_ceria');

    // Cek kesehatan template: nama variabel named-parameter dibatasi 20 karakter
    // oleh Meta Cloud API. Bila ada yang lebih panjang, pengiriman pasti ditolak.
    const templateIssues = templates.map(t => {
      const body = (t.components || []).find(c => String(c.type || '').toUpperCase() === 'BODY');
      const names = (body && body.example && Array.isArray(body.example.body_text_named_params))
        ? body.example.body_text_named_params.map(p => p.param_name)
        : [];
      const issue = checkParamNamesLimit(t.name, names);
      return issue ? { template: t.name, error: issue } : null;
    }).filter(Boolean);

    const pundiCeriaIssue = templateIssues.find(i => i.template === 'pundi_ceria');

    res.json({
      success: true,
      connected: true,
      service: 'Meta WhatsApp Business API',
      total_templates: templates.length,
      pundi_ceria_ready: hasPundiCeria,
      pundi_ceria_valid: hasPundiCeria && !pundiCeriaIssue,
      template_error: pundiCeriaIssue ? pundiCeriaIssue.error : null,
      template_issues: templateIssues,
      message: !hasPundiCeria
        ? 'Terhubung ke Meta, tetapi template pundi_ceria tidak ditemukan/belum APPROVED.'
        : pundiCeriaIssue
          ? 'Terhubung ke Meta, tetapi template pundi_ceria perlu diperbaiki (lihat detail masalah template).'
          : 'Terhubung ke Meta. Template pundi_ceria siap digunakan.'
    });
  } catch (error) {
    console.error('[PUNDI-SEDEKAH] Error whatsapp status:', error.message);
    res.json({
      success: false,
      connected: false,
      service: 'Meta WhatsApp Business API',
      message: error.message
    });
  }
});

// POST: Kirim pesan WhatsApp (template pundi_ceria atau pesan bebas)
router.post('/whatsapp-send', async (req, res) => {
  let historyId = null;
  try {
    const { tujuan, nomor, template, pesan } = req.body;
    const templateName = template || 'pundi_ceria';

    if (!nomor) {
      return res.status(400).json({ success: false, message: 'Nomor tujuan wajib diisi' });
    }

    const formattedWa = formatPhoneNumber(nomor);
    if (!formattedWa) {
      return res.status(400).json({ success: false, message: 'Nomor WhatsApp tidak valid' });
    }

    if (templateName === 'kustom' && (!pesan || !pesan.trim())) {
      return res.status(400).json({ success: false, message: 'Isi pesan wajib diisi untuk pengiriman pesan kustom' });
    }

    // Cari data penerima (calon donatur > donatur aktif)
    const recipient = await resolveRecipient(formattedWa, tujuan);

    // Catat histori sebelum dikirim agar kegagalan tetap tercatat
    try {
      const ins = await db.query(
        'INSERT INTO wa_pundi_history (tujuan, nama_penerima, nomor, pesan, template, status) VALUES (?, ?, ?, ?, ?, "gagal")',
        [
          recipient.ref_type || tujuan || 'manual',
          recipient.nama_penerima || null,
          formattedWa,
          templateName === 'kustom' ? pesan.trim() : `[Template ${templateName}] ${recipient.nama_siswa || ''} - ${recipient.link_konfirmasi}`,
          templateName
        ]
      );
      historyId = ins.insertId;
    } catch (histErr) {
      console.error('[PUNDI-SEDEKAH] Gagal simpan histori:', histErr.message);
    }

    let result;
    let sentPesan;

    if (templateName === 'kustom') {
      // Pesan bebas hanya bisa dikirim jika penerima pernah membalas dalam 24 jam
      // (batasan WhatsApp Business API). Template lebih aman untuk prospek.
      result = await sendFreeMessage(formattedWa, pesan.trim());
      sentPesan = pesan.trim();
    } else {
      const params = buildPundiCeriaParams(recipient, recipient.link_konfirmasi);
      result = await sendBillTemplateWithRetry(formattedWa, params, templateName);
      sentPesan = `[Template ${templateName}] ${recipient.nama_siswa || ''} - ${recipient.link_konfirmasi}`;
    }

    if (historyId) {
      await db.query(
        'UPDATE wa_pundi_history SET status = "terkirim", pesan = ?, message_id = ?, error_message = NULL WHERE id = ?',
        [sentPesan, result.messageId || null, historyId]
      );
    }

    res.json({
      success: true,
      message: 'Pesan WhatsApp berhasil dikirim',
      data: {
        id: historyId,
        nomor: formattedWa,
        nama_penerima: recipient.nama_penerima,
        messageId: result.messageId || null,
        template: templateName,
        link_konfirmasi: recipient.link_konfirmasi
      }
    });
  } catch (error) {
    console.error('[PUNDI-SEDEKAH] Error kirim WhatsApp:', error.message);

    if (historyId) {
      try {
        await db.query(
          'UPDATE wa_pundi_history SET status = "gagal", error_message = ? WHERE id = ?',
          [error.message, historyId]
        );
      } catch (e) { /* ignore */ }
    }

    res.status(500).json({
      success: false,
      message: error.message || 'Gagal mengirim pesan WhatsApp'
    });
  }
});

// POST: Kirim pesan WhatsApp massal ke calon donatur terpilih
router.post('/whatsapp-send-bulk', async (req, res) => {
  try {
    const { calon_donatur_ids, all_calon, template, pesan } = req.body;
    const templateName = template || 'pundi_ceria';

    if (templateName === 'kustom' && (!pesan || !pesan.trim())) {
      return res.status(400).json({ success: false, message: 'Isi pesan wajib diisi untuk pengiriman pesan kustom' });
    }

    let targets;
    if (all_calon) {
      targets = await db.query('SELECT * FROM calon_donatur_pundi_ceria WHERE status = "calon"');
    } else if (calon_donatur_ids && calon_donatur_ids.length > 0) {
      const placeholders = calon_donatur_ids.map(() => '?').join(',');
      targets = await db.query(
        `SELECT * FROM calon_donatur_pundi_ceria WHERE id IN (${placeholders})`,
        calon_donatur_ids
      );
    } else {
      return res.status(400).json({ success: false, message: 'Pilih calon donatur terlebih dahulu' });
    }

    if (!targets || targets.length === 0) {
      return res.status(400).json({ success: false, message: 'Tidak ada calon donatur yang dipilih' });
    }

    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (const c of targets) {
      let historyId = null;
      const formattedWa = formatPhoneNumber(c.no_wa);
      if (!formattedWa) {
        results.push({ id: c.id, nama: c.nama_calon_donatur, no_wa: c.no_wa, success: false, error: 'Nomor telepon tidak valid' });
        failCount++;
        continue;
      }

      const linkKonfirmasi = buildKonfirmasiLinkByWa(formattedWa);
      try {
        const ins = await db.query(
          'INSERT INTO wa_pundi_history (tujuan, nama_penerima, nomor, pesan, template, status) VALUES (?, ?, ?, ?, ?, "gagal")',
          ['calon_donatur', c.nama_calon_donatur, formattedWa, `[Template ${templateName}]`, templateName]
        );
        historyId = ins.insertId;
      } catch (histErr) {
        console.error('[PUNDI-SEDEKAH] Gagal simpan histori bulk:', histErr.message);
      }

      try {
        let result;
        if (templateName === 'kustom') {
          result = await sendFreeMessage(formattedWa, pesan.trim());
        } else {
          const params = buildPundiCeriaParams(c, linkKonfirmasi);
          result = await sendBillTemplateWithRetry(formattedWa, params, templateName);
        }

        if (historyId) {
          await db.query(
            'UPDATE wa_pundi_history SET status = "terkirim", pesan = ?, message_id = ?, error_message = NULL WHERE id = ?',
            [templateName === 'kustom' ? pesan.trim() : `[Template ${templateName}] ${c.nama_siswa || ''} - ${linkKonfirmasi}`, result.messageId || null, historyId]
          );
        }
        successCount++;
        results.push({ id: c.id, nama: c.nama_calon_donatur, no_wa: c.no_wa, success: true, messageId: result.messageId || null });
      } catch (error) {
        console.error(`[PUNDI-SEDEKAH] Bulk gagal ke ${c.no_wa}:`, error.message);
        if (historyId) {
          try {
            await db.query(
              'UPDATE wa_pundi_history SET status = "gagal", error_message = ? WHERE id = ?',
              [error.message, historyId]
            );
          } catch (e) { /* ignore */ }
        }
        failCount++;
        results.push({ id: c.id, nama: c.nama_calon_donatur, no_wa: c.no_wa, success: false, error: error.message });
      }
    }

    res.json({
      success: true,
      total: targets.length,
      successCount,
      failCount,
      results
    });
  } catch (error) {
    console.error('[PUNDI-SEDEKAH] Error bulk WhatsApp:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET: Riwayat pengiriman WhatsApp Pundi Sedekah
router.get('/whatsapp-history', async (req, res) => {
  try {
    // NOTE: LIMIT tidak di-bind sebagai parameter karena mysql2 di project ini
    // menolak angka sebagai argumen prepared statement. Nilai sudah divalidasi integer.
    const parsedLimit = parseInt(req.query.limit, 10);
    const limit = Math.min(isNaN(parsedLimit) || parsedLimit < 1 ? 50 : parsedLimit, 200);
    const rows = await db.query(
      `SELECT * FROM wa_pundi_history ORDER BY created_at DESC LIMIT ${limit}`
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('[PUNDI-SEDEKAH] Error whatsapp history:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST: Import calon donatur dari CSV/Excel
router.post('/calon-donatur/csv-import', csvUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'File CSV wajib diunggah' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    if (!rows || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Tidak ada data ditemukan di file' });
    }

    const parsed = [];
    const errors = [];

    rows.forEach((row, idx) => {
      const line = idx + 2; // +1 header, +1 untuk 1-based
      const noWa = String(row['no_wa'] || row['nomor_wa'] || row['nohp'] || row['no_hp'] || '').trim();
      const nama = String(row['nama_calon_donatur'] || row['nama'] || row['nama_donatur'] || '').trim();
      const namaSiswa = String(row['nama_siswa'] || '').trim() || null;
      const kelas = String(row['kelas'] || '').trim() || null;
      const sekolah = String(row['sekolah_yayasan'] || row['sekolah'] || row['yayasan'] || '').trim() || null;
      const keterangan = String(row['keterangan'] || '').trim() || null;

      if (!noWa || !nama) {
        errors.push({ line, message: `Baris ${line}: nama & no_wa wajib diisi` });
        return;
      }
      const formatted = formatPhoneNumber(noWa);
      if (!formatted) {
        errors.push({ line, message: `Baris ${line}: nomor WA tidak valid (${noWa})` });
        return;
      }
      parsed.push({ nama_calon_donatur: nama, no_wa: formatted, nama_siswa: namaSiswa, kelas, sekolah_yayasan: sekolah, keterangan });
    });

    let imported = 0;
    const skipped = [];
    for (const item of parsed) {
      try {
        await db.query(
          'INSERT INTO calon_donatur_pundi_ceria (nama_calon_donatur, no_wa, nama_siswa, kelas, sekolah_yayasan, keterangan) VALUES (?, ?, ?, ?, ?, ?)',
          [item.nama_calon_donatur, item.no_wa, item.nama_siswa, item.kelas, item.sekolah_yayasan, item.keterangan]
        );
        imported++;
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') {
          skipped.push(`${item.nama_calon_donatur} (${item.no_wa}) sudah terdaftar`);
        } else {
          errors.push({ message: `${item.nama_calon_donatur}: ${e.message}` });
        }
      }
    }

    res.json({
      success: true,
      imported,
      skipped: skipped.length,
      totalRows: rows.length,
      message: `${imported} calon donatur berhasil diimport${skipped.length ? ', ' + skipped.length + ' dilewati (duplikat)' : ''}`,
      details: { errors, skipped }
    });
  } catch (error) {
    console.error('[PUNDI-SEDEKAH] Error CSV import calon donatur:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE: Hapus semua riwayat
router.delete('/whatsapp-history', async (req, res) => {
  try {
    await db.query('DELETE FROM wa_pundi_history');
    res.json({ success: true, message: 'Riwayat pengiriman berhasil dihapus' });
  } catch (error) {
    console.error('[PUNDI-SEDEKAH] Error hapus history:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});


// ============================================================
// GET: Get single donatur by ID
// NOTE: route spesifik (/calon-donatur, /whatsapp-*, /donatur/:id)
// didaftarkan sebelum route ini karena Express mencocokkan
// secara berurutan. ID harus numerik; jika bukan, lanjutkan ke
// route/layer lain agar tidak membayangi router lain di /api.
// ============================================================
router.get('/donatur/:id', async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ success: false, message: 'ID donatur tidak valid' });
    }
    const donatur = await db.query(
      'SELECT * FROM donatur_pundi_ceria WHERE id = ?',
      [req.params.id]
    );
    if (!donatur || donatur.length === 0) {
      return res.status(404).json({ success: false, message: 'Donatur tidak ditemukan' });
    }
    res.json({ success: true, data: donatur[0] });
  } catch (error) {
    console.error('[PUNDI-SEDEKAH] Error fetching donatur by ID:', error.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.get('/:id', async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) {
    return next();
  }
  try {
    const donatur = await db.query(
      'SELECT * FROM donatur_pundi_ceria WHERE id = ?',
      [req.params.id]
    );
    if (!donatur || donatur.length === 0) {
      return res.status(404).json({ success: false, message: 'Donatur tidak ditemukan' });
    }
    res.json({ success: true, data: donatur[0] });
  } catch (error) {
    console.error('[PUNDI-SEDEKAH] Error fetching donatur by ID:', error.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ============================================================
// POST: Add new donatur (manual entry)
// ============================================================
router.post('/', async (req, res) => {
  try {
    const { nama_donatur, no_wa, nama_siswa, kelas, sekolah_yayasan } = req.body;

    if (!nama_donatur || !no_wa || !nama_siswa) {
      return res.status(400).json({ success: false, message: 'Nama donatur, no WA, dan nama siswa wajib diisi' });
    }

    const formattedNoWa = formatPhoneNumber(no_wa);
    if (!formattedNoWa) {
      return res.status(400).json({ success: false, message: 'Nomor WA tidak valid' });
    }

    const result = await db.query(
      'INSERT INTO donatur_pundi_ceria (nama_donatur, no_wa, nama_siswa, kelas, sekolah_yayasan) VALUES (?, ?, ?, ?, ?)',
      [nama_donatur, formattedNoWa, nama_siswa, kelas, sekolah_yayasan]
    );

    res.json({ success: true, data: { id: result.insertId, ...req.body } });
  } catch (error) {
    console.error('[PUNDI-SEDEKAH] Error adding donatur:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================
// POST: Broadcast WhatsApp pesan ke donatur
// ============================================================
router.post('/broadcast', async (req, res) => {
  try {
    const { messageType, selectedDonaturIds, customMessage } = req.body;

    if (!messageType) {
      return res.status(400).json({ success: false, message: 'Jenis pesan wajib dipilih' });
    }

    // Fetch donatur data
    let donaturData;
    if (selectedDonaturIds && selectedDonaturIds.length > 0) {
      const placeholders = selectedDonaturIds.map(() => '?').join(',');
      donaturData = await db.query(
        `SELECT * FROM donatur_pundi_ceria WHERE id IN (${placeholders})`,
        selectedDonaturIds
      );
    } else {
      donaturData = await db.query('SELECT * FROM donatur_pundi_ceria WHERE status = "aktif"');
    }

    if (donaturData.length === 0) {
      return res.status(400).json({ success: false, message: 'Tidak ada donatur yang dipilih' });
    }

    // WhatsApp template for pundi ceria
    const templateName = 'pundi_ceria';

    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (const donatur of donaturData) {
      const formattedPhone = formatPhoneNumber(donatur.no_wa);
      if (!formattedPhone) {
        results.push({
          id: donatur.id,
          no_wa: donatur.no_wa,
          success: false,
          error: 'Nomor telepon tidak valid'
        });
        failCount++;
        continue;
      }

      // Link konfirmasi mengikuti template Meta (domain tombol sudah tetap
      // di template, sehingga yang berbeda hanya path + query string).
      const linkKonfirmasi = buildKonfirmasiLink(donatur.id);

      try {
        // Kirim memakai template resmi pundi_ceria yang sudah APPROVED di Meta
        const params = buildPundiCeriaParams(donatur, linkKonfirmasi);

        let result;
        if (messageType === 'template') {
          result = await sendBillTemplateWithRetry(formattedPhone, params, templateName);
        } else if (messageType === 'custom') {
          result = await sendFreeMessage(formattedPhone, customMessage || '');
        } else {
          results.push({
            id: donatur.id,
            no_wa: donatur.no_wa,
            success: false,
            error: 'Jenis pesan tidak valid'
          });
          failCount++;
          continue;
        }

        results.push({
          id: donatur.id,
          no_wa: donatur.no_wa,
          success: true,
          messageId: result.messageId
        });
        successCount++;
      } catch (error) {
        console.error(`[PUNDI-SEDEKAH] Error sending to ${donatur.no_wa}:`, error.message);
        results.push({
          id: donatur.id,
          no_wa: donatur.no_wa,
          success: false,
          error: error.message
        });
        failCount++;
      }
    }

    res.json({
      success: true,
      total: donaturData.length,
      successCount,
      failCount,
      results
    });
  } catch (error) {
    console.error('[PUNDI-SEDEKAH] Error broadcast:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================
// POST: Import donatur from CSV
// ============================================================
router.post('/csv-import', async (req, res) => {
  try {
    const { filePath } = req.body;

    if (!filePath) {
      return res.status(400).json({ success: false, message: 'Path file CSV wajib disediakan' });
    }

    const workbook = XLSX.readFile(filePath);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const donaturData = XLSX.utilsheet_to_json(worksheet);

    if (!donaturData || donaturData.length === 0) {
      return res.status(400).json({ success: false, message: 'Tidak ada data ditemukan di CSV' });
    }

    // Parse CSV columns - expect: no_wa,nama_siswa,nama_donatur[,kelas][,sekolah_yayasan]
    const parsedDonatur = [];
    for (const row of donaturData) {
      const noWa = String(row['no_wa'] || row['nomor_wa'] || row['nohp'] || '').trim();
      const namaSiswa = String(row['nama_siswa'] || row['nama'] || '').trim();
      const namaDonatur = String(row['nama_donatur'] || row['donatur'] || '').trim();
      const kelas = String(row['kelas'] || row['kelas_siswa'] || '').trim() || null;
      const sekolahYayasan = String(row['sekolah_yayasan'] || row['yayasan'] || '').trim() || null;

      if (!noWa || !namaSiswa) {
        return res.status(400).json({ success: false, message: `Baris tidak lengkap: no_wa=${noWa}, nama_siswa=${namaSiswa}` });
      }

      const formattedNoWa = formatPhoneNumber(noWa);
      if (!formattedNoWa) {
        return res.status(400).json({ success: false, message: `Nomor WA tidak valid di baris: ${noWa}` });
      }

      parsedDonatur.push({
        nama_donatur: namaDonatur || null,
        no_wa: formattedNoWa,
        nama_siswa: namaSiswa,
        kelas: kelas,
        sekolah_yayasan: sekolahYayasan
      });
    }

    // Insert into database
    for (const donatur of parsedDonatur) {
      await db.query(
        'INSERT INTO donatur_pundi_ceria (nama_donatur, no_wa, nama_siswa, kelas, sekolah_yayasan) VALUES (?, ?, ?, ?, ?)',
        [donatur.nama_donatur, donatur.no_wa, donatur.nama_siswa, donatur.kelas, donatur.sekolah_yayasan]
      );
    }

    res.json({
      success: true,
      imported: parsedDonatur.length,
      message: `${parsedDonatur.length} donatur berhasil diimport`
    });
  } catch (error) {
    console.error('[PUNDI-SEDEKAH] Error CSV import:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================
// REGISTRASI DONATUR (dipakai halaman konfirmasi-pundi.html)
// Didaftarkan untuk GET dan POST karena halaman konfirmasi
// memanggilnya sebagai GET saat membuka link, dan POST saat submit.
// ============================================================
async function handleRegistrasiDonatur(source, res, isLookupOnly) {
  try {
    const no_wa = source.no_wa;

    if (!no_wa) {
      return res.status(400).json({ success: false, message: 'Nomor WA wajib diisi' });
    }

    const formattedNoWa = formatPhoneNumber(no_wa);
    if (!formattedNoWa) {
      return res.status(400).json({ success: false, message: 'Nomor WA tidak valid' });
    }

    // Cek donatur exist berdasarkan no_wa
    const existing = await db.query(
      'SELECT * FROM donatur_pundi_ceria WHERE no_wa = ?',
      [formattedNoWa]
    );

    if (existing.length > 0) {
      // Sudah ada → aktivkan kembali & perbarui data bila dikirim
      if (!isLookupOnly) {
        await db.query(
          'UPDATE donatur_pundi_ceria SET status = "aktif", updated_at = NOW() WHERE no_wa = ?',
          [formattedNoWa]
        );
      }
      return res.json({
        success: true,
        data: existing[0],
        message: 'Donatur sudah terdaftar, status diperbarui menjadi aktif'
      });
    }

    // Halaman konfirmasi memakai GET hanya untuk memeriksa status,
    // jadi belum berdasar apa pun untuk membuat data baru.
    if (isLookupOnly) {
      return res.json({
        success: false,
        message: 'Donatur belum terdaftar',
        data: { no_wa: formattedNoWa }
      });
    }

    // Belum ada → Buat donatur baru dengan status aktif
    const namaDonatur = String(source.nama_donatur || '').trim();
    if (!namaDonatur) {
      return res.status(400).json({ success: false, message: 'Nama donatur wajib diisi untuk registrasi' });
    }

    const result = await db.query(
      'INSERT INTO donatur_pundi_ceria (nama_donatur, no_wa, nama_siswa, kelas, sekolah_yayasan, status) VALUES (?, ?, ?, ?, ?, "aktif")',
      [namaDonatur, formattedNoWa, source.nama_siswa || null, source.kelas || null, source.sekolah_yayasan || null]
    );

    return res.json({
      success: true,
      data: {
        id: result.insertId,
        nama_donatur: namaDonatur,
        no_wa: formattedNoWa,
        nama_siswa: source.nama_siswa,
        kelas: source.kelas,
        sekolah_yayasan: source.sekolah_yayasan,
        status: 'aktif'
      },
      message: 'Donatur baru berhasil terdaftar'
    });
  } catch (error) {
    console.error('[PUNDI-SEDEKAH] Error registrasi:', error.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

router.get('/registrasi', (req, res) => handleRegistrasiDonatur(req.query, res, true));
router.post('/registrasi', (req, res) => handleRegistrasiDonatur(req.body || {}, res, false));

module.exports = router;