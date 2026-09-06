// ============================================================
// KAFALAH ROUTES - Penggajian YPWI Lutim
// Struktur: Kafalah Pokok + Tunj. Keluarga + (Tunj. Struktural,
//   Pengabdian, Fungsional, Pembina/Pondok, Transport, Tepat
//   Waktu, Tidak Cepat Pulang, KJM, Prestasi Kinerja, Apresiasi)
//   - (Ta'awun, SIM-T, Pinjaman, Cuti Luar Tanggungan)
// Periode cut-off custom (tanggal-tanggal), disimpan di kolom DATE.
// ============================================================

const express = require('express');
const db = require('../../db');
const { authenticateOperator, authenticateBendahara } = require('../middleware/auth');

const router = express.Router();

// ------- Helpers -------
function num(v) { return parseFloat(v || 0) || 0; }

// Map tenant_id → jenjang (TK | SD | SMP | SMA | PONPES)
function jenjangFromTenant(nama, tenantId) {
  const n = (nama || '').toLowerCase();
  const t = (tenantId || '').toLowerCase();
  if (n.includes('tk') || n.includes('paud') || t.includes('tk')) return 'TK';
  if (n.includes('sd') || t.includes('sd')) return 'SD';
  if (n.includes('smp') || t.includes('smp')) return 'SMP';
  if (n.includes('ponpes') || n.includes('pesantren') || n.includes('pptq') || t.includes('pptq') || t.includes('ponpes')) return 'PONPES';
  if (n.includes('sma') || t.includes('sma')) return 'SMA';
  return 'TK';
}

// Pendidikan mapping: ambil dari kolom pendidikan_kode (standar) atau regex dari nama
// Standar dari complete-profile.html: SD, SMP, SMA, SMK, D1, D2, D3, S1, S2, S3, Lainnya
const VALID_KODE = ['SD', 'SMP', 'SMA', 'SMK', 'D1', 'D2', 'D3', 'S1', 'S2', 'S3'];

function mapKodeToKategori(kode) {
  if (!kode) return null;
  kode = kode.toUpperCase().trim();
  if (['SD','SMP','SMA','SMK'].includes(kode)) return 'SMA';
  if (['D1','D2','D3','D4'].includes(kode)) return 'D3';
  if (kode === 'S1') return 'S1';
  if (kode === 'S2') return 'S2';
  if (kode === 'S3') return 'S3';
  return null;
}

function pendidikanFromText(nama, p, kode) {
  // 1) Prioritas: kolom pendidikan_kode jika valid
  const fromKode = mapKodeToKategori(kode);
  if (fromKode) return fromKode;
  // 2) Fallback: parse pendidikan_terakhir (format: KODE/TAHUN/JURUSAN atau KODE/SEKOLAH/JURUSAN)
  if (p) {
    const first = p.toUpperCase().trim().split('/')[0].trim();
    const fromP = mapKodeToKategori(first);
    if (fromP) return fromP;
  }
  // 3) Fallback terakhir: regex dari nama
  let all = ((nama || '') + ' ' + (p || '')).toUpperCase();
  all = all.replace(/[\,;]+/g, '.').replace(/\.+/g, '.').replace(/\s+/g, ' ');
  // S3/ Doktor
  if (/\bS3\b|DR\.?\b|DOKTOR/.test(all)) return 'S3';
  // S2/ Magister
  if (/\bS2\b|M\.PD|M\.SI|M\.M\b|M\.AG|M\.H|M\.KN|M\.T\b|M\.ENG|MAGISTER/.test(all)) return 'S2';
  // S2/ Spesialis (Sp.PD, Sp.OG, Sp., dll)
  if (/\bSP\.?[A-Z]{1,3}\b/.test(all) && !/\bSP\.\s*$/.test(all)) return 'S2';
  if (/\bS\.M\b|\bSM\b/.test(all) && !/\bSMA\b|\bSMK\b/.test(all)) return 'S2';
  // D3 / D4
  if (/\bD3\b|\bD4\b|A\.MA\b|A\.MD\b|AMIK\b|DIPLOMA/.test(all)) return 'D3';
  // S1/ Sarjana: pola gelar S.X atau SP.
  if (/\bS1\b/.test(all)) return 'S1';
  if (/S\s*\.\s*(PD|PDI|E|H|S|AG|KOM|T|FARM|PSI|SN|HUT|PI|P|AN|HK|MM|ST|SE|SOS|SI|HUM|IK|IP|IG|TG|GZ)/.test(all)) return 'S1';
  if (/\bSP\s*\.\s*(PD|PDI)/.test(all)) return 'S1';
  if (/\bST\b|\bS\.ST\b/.test(all)) return 'S1';
  // Gelar tanpa titik
  if (/\bSE\b/.test(all)) return 'S1';
  if (/\bSH\b/.test(all)) return 'S1';
  if (/\bSP\b/.test(all)) return 'S1';
  if (/\bSS\b/.test(all)) return 'S1';
  if (/\bSKOM\b/.test(all)) return 'S1';
  if (/SARJANA/.test(all)) return 'S1';
  // SMA
  if (/SMA|SMU|\bMA\b|SMK|MAK|PACK/.test(all)) return 'SMA';
  return 'SMA'; // default fallback
}

// Hitung masa kerja dalam tahun (pembulatan ke bawah)
function masaKerjaTahun(tglMasuk) {
  if (!tglMasuk) return 0;
  const start = new Date(tglMasuk);
  const now = new Date();
  let years = (now - start) / (365.25 * 24 * 60 * 60 * 1000);
  return Math.max(0, Math.floor(years));
}

// Map status_kepegawaian → PT/PK
// PTY (Pegawai Tetap Yayasan), GTY/PTY → PT
// PKY (Pegawai Kontrak Yayasan), Honor → PK
function statusFromText(s) {
  const v = (s || '').toUpperCase();
  if (v.includes('HONOR') || v.includes('PKY') || v === 'PK') return 'PK';
  if (v.includes('PTY') || v.includes('GTY') || v === 'PT' || v === '') return 'PT';
  return 'PT';
}

// Hitung gaji pokok dari config kenaikan
// formula: gaji = gaji_awal + ceil((tahun - 2) / interval_tahun) * kenaikan_per_tahun
// capped at masa_kerja_max
async function lookupGajiPokok(statusPegawai, jenjang, pendidikan, tahun) {
  let rows = await db.query(
    `SELECT * FROM kafalah_kenaikan_config
     WHERE status_pegawai = ? AND jenjang = ? AND pendidikan = ? LIMIT 1`,
    [statusPegawai, jenjang, pendidikan]
  );
  if (rows.length) {
    const cfg = rows[0];
    return computeGajiFromConfig(cfg, tahun);
  }
  // fallback: jenjang apapun, Pendidikan sama
  rows = await db.query(
    `SELECT * FROM kafalah_kenaikan_config
     WHERE status_pegawai = ? AND pendidikan = ? LIMIT 1`,
    [statusPegawai, pendidikan]
  );
  if (rows.length) {
    return computeGajiFromConfig(rows[0], tahun);
  }
  return 0;
}

function computeGajiFromConfig(cfg, tahun) {
  const start = 2; // gaji_awal untuk 0-2 tahun
  const t = Math.max(0, Math.min(num(tahun), num(cfg.masa_kerja_max)));
  if (t <= start) return num(cfg.gaji_awal);
  const interval = Math.max(1, num(cfg.interval_tahun));
  const periods = Math.floor((t - start - 1) / interval) + 1;
  // contoh: interval=2, t=3 → (3-2-1)/2 + 1 = 0+1 = 1 periode → +50rb
  // contoh: interval=2, t=5 → (5-2-1)/2 + 1 = 1+1 = 2 periode → +100rb
  return num(cfg.gaji_awal) + (periods * num(cfg.kenaikan_per_tahun));
}

// Ambil settings
async function getKafalahSettings() {
  let rows = await db.query('SELECT * FROM kafalah_settings WHERE id = 1');
  if (!rows.length) {
    await db.query('INSERT IGNORE INTO kafalah_settings (id) VALUES (1)');
    rows = await db.query('SELECT * FROM kafalah_settings WHERE id = 1');
  }
  return rows[0] || {};
}

// Ambil override per-teacher
async function getOverrides(tenantId) {
  const rows = await db.query(
    'SELECT * FROM kafalah_teacher_overrides WHERE tenant_id = ?', [tenantId]
  );
  const m = {};
  rows.forEach(r => { m[r.teacher_id] = r; });
  return m;
}

// Hitung absensi dalam rentang
async function getAttendanceSummary(tenantId, startDate, endDate) {
  const start = startDate + ' 00:00:00';
  const end = endDate + ' 23:59:59';
  let q = `SELECT teacher_id,
    SUM(CASE WHEN status='tepat_waktu' THEN 1 ELSE 0 END) AS hadir,
    SUM(CASE WHEN status='tepat_waktu' THEN 1 ELSE 0 END) AS tepat_waktu,
    SUM(CASE WHEN status='terlambat' THEN 1 ELSE 0 END) AS terlambat,
    SUM(CASE WHEN status IN ('izin','cuti') THEN 1 ELSE 0 END) AS izin,
    SUM(CASE WHEN status='sakit' THEN 1 ELSE 0 END) AS sakit,
    SUM(CASE WHEN status='dinas_luar' OR dinas_luar=1 THEN 1 ELSE 0 END) AS dinas_luar
    FROM attendance_logs WHERE COALESCE(waktu_absen,waktu_scan) >= ? AND COALESCE(waktu_absen,waktu_scan) <= ?`;
  const p = [start, end];
  if (tenantId) { q += ' AND tenant_id = ?'; p.push(tenantId); }
  q += ' GROUP BY teacher_id';
  return db.query(q, p);
}

// ------- Endpoints -------

// GET settings
router.get('/kafalah/settings', authenticateBendahara, async (req, res) => {
  try {
    const s = await getKafalahSettings();
    res.json({ success: true, data: s });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// PUT settings
router.put('/kafalah/settings', authenticateBendahara, async (req, res) => {
  try {
    const fields = ['tunj_pengabdian','tunj_fungsional','tunj_transport','tunj_tepat_waktu','tunj_tidak_cepat_pulang','tunj_prestasi_kinerja','nominal_kjm','tunj_pembina','tunj_pondok','tunj_anak','tunj_istri'];
    const vals = {};
    fields.forEach(f => { if (req.body[f] !== undefined) vals[f] = num(req.body[f]); });
    if (!Object.keys(vals).length) return res.status(400).json({ success: false, message: 'Tidak ada field' });
    const set = Object.keys(vals).map(f => `${f}=?`).join(', ');
    await db.query(`INSERT INTO kafalah_settings (id, ${Object.keys(vals).join(',')}) VALUES (1, ${Object.keys(vals).map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE ${set}`, [...Object.values(vals), ...Object.values(vals)]);
    res.json({ success: true, message: 'Pengaturan KAFALAH tersimpan' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET matrix
router.get('/kafalah/matrix', authenticateBendahara, async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM kafalah_gaji_matrix ORDER BY status_pegawai, jenjang, pendidikan, masa_kerja_min');
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET kenaikan config (matrix baru)
router.get('/kafalah/kenaikan', authenticateBendahara, async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM kafalah_kenaikan_config ORDER BY status_pegawai, jenjang, pendidikan');
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// PUT update kenaikan config
router.put('/kafalah/kenaikan/:id', authenticateBendahara, async (req, res) => {
  try {
    const fields = ['gaji_awal','kenaikan_per_tahun','interval_tahun','masa_kerja_max'];
    const vals = {};
    fields.forEach(f => { if (req.body[f] !== undefined) vals[f] = num(req.body[f]); });
    if (!Object.keys(vals).length) return res.status(400).json({ success: false, message: 'Tidak ada field' });
    const set = Object.keys(vals).map(f => `${f}=?`).join(', ');
    await db.query(`UPDATE kafalah_kenaikan_config SET ${set} WHERE id=?`, [...Object.values(vals), req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET pendidikan ref
router.get('/kafalah/pendidikan-ref', authenticateBendahara, async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM kafalah_pendidikan_ref ORDER BY urutan');
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST sync matrix dengan pendidikan dari data guru (auto-add jika ada pendidikan baru)
router.post('/kafalah/sync-pendidikan', authenticateBendahara, async (req, res) => {
  try {
    const before = (await db.query('SELECT COUNT(*) AS c FROM kafalah_kenaikan_config'))[0].c;
    const beforeRef = (await db.query('SELECT COUNT(*) AS c FROM kafalah_pendidikan_ref'))[0].c;
    await autoSyncPendidikan();
    const after = (await db.query('SELECT COUNT(*) AS c FROM kafalah_kenaikan_config'))[0].c;
    const afterRef = (await db.query('SELECT COUNT(*) AS c FROM kafalah_pendidikan_ref'))[0].c;
    res.json({
      success: true,
      message: `Sinkronisasi selesai. Pendidikan: ${beforeRef}→${afterRef}, Kenaikan matrix: ${before}→${after}`,
      matrix_added: after - before,
      ref_added: afterRef - beforeRef
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST backfill pendidikan_kode di teachers dari regex nama
// Untuk guru yang belum pernah isi complete-profile.html
router.post('/kafalah/backfill-pendidikan-kode', authenticateBendahara, async (req, res) => {
  try {
    const teachers = await db.query(
      'SELECT id, nama, pendidikan_terakhir, pendidikan_kode FROM teachers WHERE status_aktif=1'
    );
    let updated = 0;
    for (const t of teachers) {
      const kode = t.pendidikan_kode;
      if (kode) continue; // sudah ada
      // deteksi dari regex nama → simpan sebagai SMA/D3/S1/S2/S3
      const kat = pendidikanFromText(t.nama, t.pendidikan_terakhir, null);
      if (kat === 'SMA') {
        // default ke SMA (kode 'SMA') — bisa diedit nanti oleh guru
        await db.query('UPDATE teachers SET pendidikan_kode=? WHERE id=?', ['SMA', t.id]);
        updated++;
      } else if (['D3','S1','S2','S3'].includes(kat)) {
        await db.query('UPDATE teachers SET pendidikan_kode=? WHERE id=?', [kat, t.id]);
        updated++;
      }
    }
    res.json({ success: true, message: `Backfill selesai: ${updated} guru diperbarui pendidikan_kode-nya`, updated });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST tambah pendidikan
router.post('/kafalah/pendidikan-ref', authenticateBendahara, async (req, res) => {
  try {
    const { kode, label, urutan } = req.body;
    if (!kode || !label) return res.status(400).json({ success: false, message: 'kode & label wajib' });
    await db.query('INSERT INTO kafalah_pendidikan_ref (kode, label, urutan) VALUES (?,?,?)',
      [kode.toUpperCase(), label, num(urutan) || 99]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET jabatan tunjangan (referensi struktural per jabatan)
router.get('/kafalah/jabatan-tunjangan', authenticateBendahara, async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM kafalah_jabatan_tunjangan ORDER BY nominal DESC, jabatan_label');
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// PUT update jabatan tunjangan
router.put('/kafalah/jabatan-tunjangan/:id', authenticateBendahara, async (req, res) => {
  try {
    const nominal = num(req.body.nominal);
    await db.query('UPDATE kafalah_jabatan_tunjangan SET nominal=? WHERE id=?', [nominal, req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Ambil default struktural dari jabatan (lookup berurutan)
async function lookupStrukturalByJabatan(jabatan, jabatanMap) {
  if (!jabatan) return 0;
  const norm = jabatan.toLowerCase().replace(/[^a-z]/g, '');
  // exact key
  if (jabatanMap[jabatan.toLowerCase().replace(/\s/g,'')]) return jabatanMap[jabatan.toLowerCase().replace(/\s/g,'')];
  // contains match
  for (const k of Object.keys(jabatanMap)) {
    if (norm.includes(k)) return jabatanMap[k];
  }
  return 0;
}

// PUT matrix (replace all untuk satu kombinasi)
router.put('/kafalah/matrix/:id', authenticateBendahara, async (req, res) => {
  try {
    const nominal = num(req.body.nominal);
    await db.query('UPDATE kafalah_gaji_matrix SET nominal=? WHERE id=?', [nominal, req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET overrides per tenant
router.get('/kafalah/overrides', authenticateBendahara, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    if (!tenantId) return res.status(400).json({ success: false, message: 'tenant_id required' });
    const rows = await db.query(
      `SELECT ko.*, t.nama FROM kafalah_teacher_overrides ko
       JOIN teachers t ON ko.teacher_id = t.id
       WHERE ko.tenant_id = ?`, [tenantId]
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// PUT override per teacher
router.put('/kafalah/overrides/:teacherId', authenticateBendahara, async (req, res) => {
  try {
    const tenantId = req.body.tenant_id;
    if (!tenantId) return res.status(400).json({ success: false, message: 'tenant_id required' });
    const fields = ['tunj_struktural','tunj_pembina','tunj_pondok','tunj_apresiasi'];
    const vals = { teacher_id: req.params.teacherId, tenant_id: tenantId };
    fields.forEach(f => { if (req.body[f] !== undefined) vals[f] = num(req.body[f]); });
    const cols = Object.keys(vals);
    const ph = cols.map(() => '?').join(',');
    const updateSet = cols.filter(c => c !== 'teacher_id' && c !== 'tenant_id').map(c => `${c}=VALUES(${c})`).join(', ');
    await db.query(
      `INSERT INTO kafalah_teacher_overrides (${cols.join(',')}) VALUES (${ph})
       ON DUPLICATE KEY UPDATE ${updateSet}`,
      Object.values(vals)
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST compute preview (tidak menyimpan)
router.post('/kafalah/preview', authenticateBendahara, async (req, res) => {
  try {
    const { tenant_id, periode_mulai, periode_selesai, label_periode } = req.body;
    if (!tenant_id || !periode_mulai || !periode_selesai) {
      return res.status(400).json({ success: false, message: 'tenant_id, periode_mulai, periode_selesai wajib' });
    }
    const rows = await computeKafalah(tenant_id, periode_mulai, periode_selesai, label_periode);
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error('preview error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST generate (simpan ke kafalah_payroll)
router.post('/kafalah/generate', authenticateBendahara, async (req, res) => {
  try {
    const { tenant_id, periode_mulai, periode_selesai, label_periode } = req.body;
    if (!tenant_id || !periode_mulai || !periode_selesai) {
      return res.status(400).json({ success: false, message: 'tenant_id, periode_mulai, periode_selesai wajib' });
    }
    const rows = await computeKafalah(tenant_id, periode_mulai, periode_selesai, label_periode);
    let saved = 0;
    for (const r of rows) {
      const sql = `INSERT INTO kafalah_payroll
        (teacher_id, tenant_id, periode_mulai, periode_selesai, label_periode,
         nama, nik, jabatan, status_pegawai, jenjang, pendidikan, masa_kerja_tahun, jumlah_anak, predikat_kinerja,
         hari_efektif, hadir, tidak_hadir, tepat_waktu, terlambat, tidak_absen_masuk, cepat_pulang, tidak_absen_pulang, kjm,
         kafalah_pokok, tunj_keluarga_istri, tunj_keluarga_anak, total_a,
         tunj_struktural, tunj_pengabdian, tunj_fungsional, tunj_pembina, tunj_pondok,
         tunj_transport, tunj_tepat_waktu, tunj_tidak_cepat_pulang, tunj_kjm, tunj_prestasi_kinerja, tunj_apresiasi, total_b,
         potong_taawun, potong_simt, potong_pinjaman, potong_cuti_luar_tanggungan, potong_persen_cuti, total_c,
         total_pendapatan, created_by)
        VALUES (?,?,?,?,?, ?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?,?, ?,?,?,?,?,?, ?,?)
        ON DUPLICATE KEY UPDATE
          nama=VALUES(nama), nik=VALUES(nik), jabatan=VALUES(jabatan), status_pegawai=VALUES(status_pegawai),
          jenjang=VALUES(jenjang), pendidikan=VALUES(pendidikan), masa_kerja_tahun=VALUES(masa_kerja_tahun),
          jumlah_anak=VALUES(jumlah_anak), predikat_kinerja=VALUES(predikat_kinerja),
          hari_efektif=VALUES(hari_efektif), hadir=VALUES(hadir), tidak_hadir=VALUES(tidak_hadir),
          tepat_waktu=VALUES(tepat_waktu), terlambat=VALUES(terlambat), tidak_absen_masuk=VALUES(tidak_absen_masuk),
          cepat_pulang=VALUES(cepat_pulang), tidak_absen_pulang=VALUES(tidak_absen_pulang), kjm=VALUES(kjm),
          kafalah_pokok=VALUES(kafalah_pokok), tunj_keluarga_istri=VALUES(tunj_keluarga_istri),
          tunj_keluarga_anak=VALUES(tunj_keluarga_anak), total_a=VALUES(total_a),
          tunj_struktural=VALUES(tunj_struktural), tunj_pengabdian=VALUES(tunj_pengabdian),
          tunj_fungsional=VALUES(tunj_fungsional), tunj_pembina=VALUES(tunj_pembina),
          tunj_pondok=VALUES(tunj_pondok), tunj_transport=VALUES(tunj_transport),
          tunj_tepat_waktu=VALUES(tunj_tepat_waktu), tunj_tidak_cepat_pulang=VALUES(tunj_tidak_cepat_pulang),
          tunj_kjm=VALUES(tunj_kjm), tunj_prestasi_kinerja=VALUES(tunj_prestasi_kinerja),
          tunj_apresiasi=VALUES(tunj_apresiasi), total_b=VALUES(total_b),
          potong_taawun=VALUES(potong_taawun), potong_simt=VALUES(potong_simt),
          potong_pinjaman=VALUES(potong_pinjaman), potong_cuti_luar_tanggungan=VALUES(potong_cuti_luar_tanggungan),
          potong_persen_cuti=VALUES(potong_persen_cuti), total_c=VALUES(total_c),
          total_pendapatan=VALUES(total_pendapatan), updated_at=NOW()`;
      const p = [
        r.teacher_id, tenant_id, periode_mulai, periode_selesai, label_periode || null,
        r.nama, r.nik || null, r.jabatan || null, r.status_pegawai || null, r.jenjang || null,
        r.pendidikan || null, r.masa_kerja_tahun || 0, r.jumlah_anak || 0, r.predikat_kinerja || null,
        r.hari_efektif, r.hadir, r.tidak_hadir, r.tepat_waktu, r.terlambat, r.tidak_absen_masuk,
        r.cepat_pulang, r.tidak_absen_pulang, r.kjm,
        r.kafalah_pokok, r.tunj_keluarga_istri, r.tunj_keluarga_anak, r.total_a,
        r.tunj_struktural, r.tunj_pengabdian, r.tunj_fungsional, r.tunj_pembina, r.tunj_pondok,
        r.tunj_transport, r.tunj_tepat_waktu, r.tunj_tidak_cepat_pulang, r.tunj_kjm, r.tunj_prestasi_kinerja, r.tunj_apresiasi, r.total_b,
        r.potong_taawun, r.potong_simt, r.potong_pinjaman, r.potong_cuti_luar_tanggungan, r.potong_persen_cuti, r.total_c,
        r.total_pendapatan, req.user.id
      ];
      await db.query(sql, p);
      saved++;
    }
    res.json({ success: true, message: `${saved} slip KAFALAH tersimpan`, data: rows });
  } catch (e) {
    console.error('generate error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET history (list slip tersimpan)
router.get('/kafalah/history', authenticateBendahara, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    const start = req.query.periode_mulai;
    const end = req.query.periode_selesai;
    let q = 'SELECT * FROM kafalah_payroll WHERE 1=1';
    const p = [];
    if (tenantId) { q += ' AND tenant_id=?'; p.push(tenantId); }
    if (start) { q += ' AND periode_mulai=?'; p.push(start); }
    if (end) { q += ' AND periode_selesai=?'; p.push(end); }
    q += ' ORDER BY nama ASC';
    const rows = await db.query(q, p);
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET rekap per unit (untuk konsolidasi)
router.get('/kafalah/rekap', authenticateBendahara, async (req, res) => {
  try {
    const start = req.query.periode_mulai;
    const end = req.query.periode_selesai;
    let q = `SELECT tenant_id, COUNT(*) as jumlah_guru, SUM(total_a) as total_wajib,
             SUM(total_b) as total_insentif, SUM(total_c) as total_potongan,
             SUM(total_pendapatan) as total_kafalah
             FROM kafalah_payroll WHERE 1=1`;
    const p = [];
    if (start) { q += ' AND periode_mulai=?'; p.push(start); }
    if (end) { q += ' AND periode_selesai=?'; p.push(end); }
    q += ' GROUP BY tenant_id';
    const rows = await db.query(q, p);
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// DELETE slip (untuk regenerate)
router.delete('/kafalah/payroll/:id', authenticateBendahara, async (req, res) => {
  try {
    await db.query('DELETE FROM kafalah_payroll WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// PUT update satu field (untuk koreksi manual sebelum simpan)
router.put('/kafalah/payroll/:id', authenticateBendahara, async (req, res) => {
  try {
    const editable = ['tunj_struktural','tunj_pembina','tunj_pondok','tunj_apresiasi','potong_taawun','potong_simt','potong_pinjaman','potong_cuti_luar_tanggungan','potong_persen_cuti','predikat_kinerja','jumlah_anak'];
    const vals = {};
    editable.forEach(f => { if (req.body[f] !== undefined) vals[f] = req.body[f]; });
    if (!Object.keys(vals).length) return res.status(400).json({ success: false, message: 'Tidak ada field' });
    // Recompute totals
    const cur = await db.query('SELECT * FROM kafalah_payroll WHERE id=?', [req.params.id]);
    if (!cur.length) return res.status(404).json({ success: false, message: 'Tidak ditemukan' });
    const r = { ...cur[0], ...vals };
    r.total_a = num(r.kafalah_pokok) + num(r.tunj_keluarga_istri) + num(r.tunj_keluarga_anak);
    r.total_b = num(r.tunj_struktural) + num(r.tunj_pengabdian) + num(r.tunj_fungsional)
      + num(r.tunj_pembina) + num(r.tunj_pondok) + num(r.tunj_transport)
      + num(r.tunj_tepat_waktu) + num(r.tunj_tidak_cepat_pulang)
      + num(r.tunj_kjm) + num(r.tunj_prestasi_kinerja) + num(r.tunj_apresiasi);
    r.total_c = num(r.potong_taawun) + num(r.potong_simt) + num(r.potong_pinjaman) + num(r.potong_cuti_luar_tanggungan);
    r.total_pendapatan = r.total_a + r.total_b - r.total_c;
    const set = ['total_a=?','total_b=?','total_c=?','total_pendapatan=?','updated_at=NOW()', ...Object.keys(vals).map(f => `${f}=?`)].join(', ');
    await db.query(`UPDATE kafalah_payroll SET ${set} WHERE id=?`,
      [r.total_a, r.total_b, r.total_c, r.total_pendapatan, ...Object.values(vals), req.params.id]);
    res.json({ success: true, data: r });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ------- Compute core -------
// Auto-sync: pastikan semua pendidikan yang ada di data guru
// sudah ada di kafalah_pendidikan_ref + kafalah_kenaikan_config.
// Dipanggil sebelum compute preview.
async function autoSyncPendidikan() {
  const teachers = await db.query(
    `SELECT id, nama, pendidikan_terakhir, pendidikan_kode FROM teachers WHERE status_aktif=1`
  );
  const detectedSet = new Set();
  for (const t of teachers) {
    const p = pendidikanFromText(t.nama, t.pendidikan_terakhir, t.pendidikan_kode);
    if (p !== 'UNKNOWN') detectedSet.add(p);
  }
  // Tambah ke pendidikan_ref jika belum ada
  const urutan = (await db.query('SELECT MAX(urutan) AS mx FROM kafalah_pendidikan_ref'))[0]?.mx || 0;
  let nextUrut = urutan + 1;
  for (const kode of detectedSet) {
    const exist = await db.query('SELECT id FROM kafalah_pendidikan_ref WHERE kode=?', [kode]);
    if (!exist.length) {
      await db.query('INSERT INTO kafalah_pendidikan_ref (kode, label, urutan, is_active) VALUES (?,?,?,1)',
        [kode, labelForPendidikan(kode), nextUrut++]);
    }
  }
  // Tambah ke kenaikan_config (semua status × jenjang) untuk pendidikan baru
  const statusList = ['PT', 'PK'];
  const jenjangList = ['TK', 'SD', 'SMP', 'SMA', 'PONPES'];
  for (const kode of detectedSet) {
    for (const st of statusList) {
      for (const j of jenjangList) {
        const exist = await db.query(
          'SELECT id FROM kafalah_kenaikan_config WHERE status_pegawai=? AND jenjang=? AND pendidikan=?',
          [st, j, kode]
        );
        if (!exist.length) {
          const defaultGaji = defaultGajiUntukPendidikan(st, j, kode);
          await db.query(
            `INSERT INTO kafalah_kenaikan_config
             (status_pegawai, jenjang, pendidikan, gaji_awal, kenaikan_per_tahun, interval_tahun, masa_kerja_max)
             VALUES (?,?,?,?,?,?,?)`,
            [st, j, kode, defaultGaji, 50000, 2, 20]
          );
        }
      }
    }
  }
}

function labelForPendidikan(kode) {
  const map = {
    'SMA': 'SMA / Sederajat',
    'D3': 'Diploma 3 (D3)',
    'S1': 'Sarjana (S1)',
    'S2': 'Magister (S2)',
    'S3': 'Doktor (S3)'
  };
  return map[kode] || kode;
}

// Default gaji awal berdasarkan status, jenjang, dan tingkatan pendidikan
// Tier: SMA < D3 < S1 < S2 < S3
function defaultGajiUntukPendidikan(status, jenjang, kode) {
  // Base per jenjang (ambil dari PT S1 2-th yang sudah ada di matrix)
  const basePT = { TK: 900000, SD: 1800000, SMP: 900000, SMA: 900000, PONPES: 900000 };
  const basePK = { TK: 500000, SD: 500000, SMP: 500000, SMA: 500000, PONPES: 500000 };
  const base = status === 'PT' ? basePT[jenjang] : basePK[jenjang];
  // Multiplier
  const mult = { SMA: 0.5, D3: 0.75, S1: 1.0, S2: 1.0, S3: 1.0 };
  return Math.round(base * (mult[kode] || 1));
}

async function computeKafalah(tenantId, startDate, endDate, labelPeriode) {
  // Auto-sync matrix dengan pendidikan dari data guru
  await autoSyncPendidikan();

  const settings = await getKafalahSettings();
  const overrides = await getOverrides(tenantId);
  const att = await getAttendanceSummary(tenantId, startDate, endDate);
  const attMap = {};
  att.forEach(a => { attMap[a.teacher_id] = a; });

  // Map jabatan → tunjangan struktural default
  const jabatanRows = await db.query('SELECT jabatan_key, nominal FROM kafalah_jabatan_tunjangan');
  const jabatanMap = {};
  jabatanRows.forEach(j => { jabatanMap[j.jabatan_key.toLowerCase()] = num(j.nominal); });

  // ambil guru aktif di unit ini
  const tenants = await db.query('SELECT nama_sekolah FROM tenants WHERE tenant_id=?', [tenantId]);
  const namaSekolah = tenants.length ? tenants[0].nama_sekolah : '';
  const jenjang = jenjangFromTenant(namaSekolah, tenantId);

  const teachers = await db.query(
    `SELECT t.id, t.nama, t.nik, t.status_kepegawaian, COALESCE(t.tmt, t.created_at) AS tmt, t.pendidikan_terakhir, t.pendidikan_kode, t.jumlah_anak,
            (SELECT ta.jabatan_di_unit FROM teacher_assignments ta
             WHERE ta.teacher_id = t.id AND ta.tenant_id = ? AND ta.is_paid = 1
             ORDER BY FIELD(LOWER(REPLACE(ta.jabatan_di_unit,' ','')), 'kepalasekolah','kepsek','bendahara','walikelas','guru') ASC
             LIMIT 1) AS jabatan
     FROM teachers t
     WHERE t.status_aktif = 1
       AND EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.teacher_id = t.id AND ta.tenant_id = ? AND ta.is_paid = 1)
     ORDER BY t.nama ASC`, [tenantId, tenantId]
  );

  const rows = [];
  for (const t of teachers) {
    const mk = masaKerjaTahun(t.tmt);
    const pendidikan = pendidikanFromText(t.nama, t.pendidikan_terakhir, t.pendidikan_kode);
    const status = statusFromText(t.status_kepegawaian);
    const gajiPokok = await lookupGajiPokok(status, jenjang, pendidikan, mk);

    const a = attMap[t.id] || {};
    const hadir = num(a.hadir);
    const terlambat = num(a.terlambat);
    const tepat_waktu = num(a.tepat_waktu);
    const izin = num(a.izin);
    const sakit = num(a.sakit);
    const hariKerja = 24; // default working days; bisa dioverride dari setting
    const tidak_hadir = Math.max(0, hariKerja - (hadir + terlambat + izin + sakit + num(a.dinas_luar)));
    const adaAbsensi = (hadir + terlambat) > 0; // ada catatan masuk

    const ov = overrides[t.id] || {};
    const jml_anak = num(t.jumlah_anak || ov.jumlah_anak);
    const tunjKeluargaIstri = (status === 'PT' ? num(settings.tunj_istri) : 0);
    const tunjKeluargaAnak = num(settings.tunj_anak) * jml_anak;
    const totalA = gajiPokok + tunjKeluargaIstri + tunjKeluargaAnak;

    const tunjPengabdian = num(settings.tunj_pengabdian);
    const tunjFungsional = num(settings.tunj_fungsional);
    const tunjPrestasiKinerja = num(settings.tunj_prestasi_kinerja);
    // Tunjangan kehadiran hanya diberikan jika ada catatan absensi
    const tunjTransport = adaAbsensi ? num(settings.tunj_transport) : 0;
    const tunjTepatWaktu = adaAbsensi ? num(settings.tunj_tepat_waktu) : 0;
    const tunjTidakCepatPulang = adaAbsensi ? num(settings.tunj_tidak_cepat_pulang) : 0;
    const tunjKjm = (num(settings.nominal_kjm)) * (num(a.kjm) || 0);
    const tunjPembina = num(settings.tunj_pembina) || num(ov.tunj_pembina);
    const tunjPondok = num(settings.tunj_pondok) || num(ov.tunj_pondok);
    // Struktural: prioritas override manual, fallback ke default jabatan
    const tunjStruktural = num(ov.tunj_struktural) || await lookupStrukturalByJabatan(t.jabatan, jabatanMap);
    const tunjApresiasi = num(ov.tunj_apresiasi);

    const totalB = tunjStruktural + tunjPengabdian + tunjFungsional + tunjPembina + tunjPondok
      + tunjTransport + tunjTepatWaktu + tunjTidakCepatPulang + tunjKjm + tunjPrestasiKinerja + tunjApresiasi;

    const totalC = 0;
    const totalPendapatan = totalA + totalB - totalC;

    rows.push({
      teacher_id: t.id,
      nama: t.nama,
      nik: t.nik,
      jabatan: t.jabatan,
      status_pegawai: status,
      jenjang,
      pendidikan,
      masa_kerja_tahun: mk,
      jumlah_anak: jml_anak,
      predikat_kinerja: 'A',
      hari_efektif: hariKerja,
      hadir, terlambat, tidak_hadir,
      tepat_waktu, tidak_absen_masuk: 0, cepat_pulang: 0, tidak_absen_pulang: 0,
      kjm: num(a.kjm),
      kafalah_pokok: gajiPokok,
      tunj_keluarga_istri: tunjKeluargaIstri,
      tunj_keluarga_anak: tunjKeluargaAnak,
      total_a: totalA,
      tunj_struktural: tunjStruktural,
      tunj_pengabdian: tunjPengabdian,
      tunj_fungsional: tunjFungsional,
      tunj_pembina: tunjPembina,
      tunj_pondok: tunjPondok,
      tunj_transport: tunjTransport,
      tunj_tepat_waktu: tunjTepatWaktu,
      tunj_tidak_cepat_pulang: tunjTidakCepatPulang,
      tunj_kjm: tunjKjm,
      tunj_prestasi_kinerja: tunjPrestasiKinerja,
      tunj_apresiasi: tunjApresiasi,
      total_b: totalB,
      potong_taawun: 0,
      potong_simt: 0,
      potong_pinjaman: 0,
      potong_cuti_luar_tanggungan: 0,
      potong_persen_cuti: 0,
      total_c: totalC,
      total_pendapatan: totalPendapatan
    });
  }
  return rows;
}

module.exports = router;
