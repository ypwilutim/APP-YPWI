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

// Ensure tenant_id column in kafalah_settings
async function ensureKafalahSettingsTable() {
  try {
    await db.query(`ALTER TABLE kafalah_settings ADD COLUMN tenant_id VARCHAR(20) DEFAULT NULL`);
    await db.query(`CREATE UNIQUE INDEX idx_tenant ON kafalah_settings (tenant_id)`);
  } catch (e) {
    // Column might already exist
  }
}

// Ambil settings - global atau per tenant
async function getKafalahSettings(tenantId = null) {
  await ensureKafalahSettingsTable();
  let rows;
  if (tenantId) {
    rows = await db.query('SELECT * FROM kafalah_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
    if (rows.length) return rows[0];
  }
  // Fallback ke global (tenant_id IS NULL)
  rows = await db.query('SELECT * FROM kafalah_settings WHERE tenant_id IS NULL AND id = 1');
  if (!rows.length) {
    await db.query('INSERT IGNORE INTO kafalah_settings (id, tenant_id) VALUES (1, NULL)');
    rows = await db.query('SELECT * FROM kafalah_settings WHERE tenant_id IS NULL AND id = 1');
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

// ============================================================
// NEW HELPERS: Base Mode & Settings Resolution
// ============================================================

// Ambil preferensi base mode user (global/school)
// Priority: explicit param > DB preference > default
async function getBaseMode(req, explicitTenantId = null) {
  const userId = req.user?.id;
  if (!userId) return { baseMode: 'global', tenantId: null };
  
  const tenantId = explicitTenantId || req.query.tenant_id || req.body.tenant_id || null;
  
  // If explicit base_mode in query/body, use it
  const explicitBaseMode = req.query.base_mode || req.body.base_mode;
  if (explicitBaseMode && ['global', 'school'].includes(explicitBaseMode)) {
    return { baseMode: explicitBaseMode, tenantId };
  }
  
  // Load from DB
  try {
    const rows = await db.query(
      'SELECT base_mode FROM kafalah_base_mode WHERE user_id = ? AND (tenant_id = ? OR tenant_id IS NULL) ORDER BY tenant_id DESC LIMIT 1',
      [req.user.id, tenantId]
    );
    if (rows.length) {
      return { baseMode: rows[0].base_mode, tenantId };
    }
  } catch (e) {
    console.error('getBaseMode error:', e);
  }
  
  // Default: global for central, school for school bendahara
  const isCentral = req.user?.assignments?.some(a => a.tenant_id === 'YPWILUTIM');
  return { baseMode: isCentral ? 'global' : 'school', tenantId };
}

// Resolve settings berdasarkan base mode
async function resolveSettings(tenantId, baseMode) {
  if (baseMode === 'global') {
    return await getKafalahSettings(null);
  }
  // school mode: try school settings, fallback to global
  if (tenantId) {
    const schoolSettings = await getKafalahSettings(tenantId);
    const hasSettings = schoolSettings && Object.keys(schoolSettings).length > 1; // more than just id
    if (hasSettings) return schoolSettings;
  }
  // Fallback to global
  return await getKafalahSettings(null);
}

// Resolve gaji pokok config berdasarkan base mode
async function resolveGajiPokokConfig(tenantId, baseMode) {
  if (baseMode === 'global') {
    return await getGajiPokokConfig(null);
  }
  if (tenantId) {
    const config = await getGajiPokokConfig(tenantId);
    if (config && config.length) return config;
  }
  return await getGajiPokokConfig(null);
}

// Get gaji pokok config (NEW TABLE: kafalah_gaji_pokok_config)
async function getGajiPokokConfig(tenantId = null) {
  if (tenantId) {
    const rows = await db.query(
      'SELECT * FROM kafalah_gaji_pokok_config WHERE tenant_id = ?', [tenantId]
    );
    if (rows.length) return rows;
  }
  return await db.query('SELECT * FROM kafalah_gaji_pokok_config WHERE tenant_id IS NULL');
}

// Lookup gaji pokok dari config baru (kafalah_gaji_pokok_config)
async function lookupGajiPokokNew(statusPegawai, jenjang, pendidikan, tahun, configRows) {
  // Exact match
  let rows = configRows.filter(r => 
    r.status_pegawai === statusPegawai && 
    r.jenjang === jenjang && 
    r.pendidikan === pendidikan
  );
  if (rows.length) {
    const cfg = rows[0];
    return computeGajiFromConfigNew(cfg, tahun);
  }
  // Fallback: any jenjang, same status & pendidikan
  rows = configRows.filter(r => 
    r.status_pegawai === statusPegawai && 
    r.pendidikan === pendidikan
  );
  if (rows.length) {
    return computeGajiFromConfigNew(rows[0], tahun);
  }
  return 0;
}

function computeGajiFromConfigNew(cfg, tahun) {
  const start = 2;
  const t = Math.max(0, Math.min(num(tahun), num(cfg.masa_kerja_max)));
  if (t <= start) return num(cfg.gaji_pokok_base);
  const interval = Math.max(1, num(cfg.interval_tahun));
  const periods = Math.floor((t - start - 1) / interval) + 1;
  return num(cfg.gaji_pokok_base) + (periods * num(cfg.kenaikan_per_tahun));
}

// Overrideable fields list
const OVERRIDE_FIELDS = [
  'tunj_struktural', 'tunj_pembina', 'tunj_pondok', 'tunj_apresiasi',
  'tunj_transport', 'tunj_tepat_waktu', 'tunj_tidak_cepat_pulang',
  'tunj_uang_makan', 'tunj_fungsional', 'tunj_prestasi_kinerja',
  'tunj_jam_mengajar', 'tunj_istri', 'tunj_anak', 'nominal_kjm',
  'pot_luar_tanggungan', 'pot_durasi_simt', 'pot_taawun', 'pot_piutang'
];

// Helper: get override value with is_active logic
function getOverrideValue(override, baseValue, field) {
  if (!override.is_active) return num(baseValue);
  const val = override[field];
  return (val !== null && val !== undefined) ? num(val) : num(baseValue);
}

// Hitung absensi detail per hari untuk KAFALAH
async function getAttendanceDaily(tenantId, startDate, endDate) {
  const start = startDate + ' 00:00:00';
  const end = endDate + ' 23:59:59';
  
  let q = `
    SELECT 
      m.teacher_id,
      m.tgl,
      m.status_masuk,
      m.status_pulang,
      m.dinas_luar,
      m.tenant_id_masuk,
      m.tenant_id_pulang
    FROM (
      SELECT 
        masuk.teacher_id,
        masuk.tgl,
        masuk.status as status_masuk,
        pulang.status as status_pulang,
        masuk.dinas_luar,
        masuk.tenant_id as tenant_id_masuk,
        pulang.tenant_id as tenant_id_pulang
      FROM (
        -- Earliest check-in per teacher per day
        SELECT 
          al.teacher_id,
          al.tenant_id,
          DATE(COALESCE(al.waktu_absen, al.waktu_scan)) as tgl,
          al.status,
          al.dinas_luar,
          ROW_NUMBER() OVER (PARTITION BY al.teacher_id, DATE(COALESCE(al.waktu_absen, al.waktu_scan)) ORDER BY COALESCE(al.waktu_absen, al.waktu_scan) ASC) as rn
        FROM attendance_logs al
        WHERE al.jenis = 'masuk'
          AND COALESCE(al.waktu_absen, al.waktu_scan) >= ?
          AND COALESCE(al.waktu_absen, al.waktu_scan) <= ?
      ) masuk
      LEFT JOIN (
        -- Latest check-out per teacher per day
        SELECT 
          al.teacher_id,
          al.tenant_id,
          DATE(COALESCE(al.waktu_absen, al.waktu_scan)) as tgl,
          al.status,
          ROW_NUMBER() OVER (PARTITION BY al.teacher_id, DATE(COALESCE(al.waktu_absen, al.waktu_scan)) ORDER BY COALESCE(al.waktu_absen, al.waktu_scan) DESC) as rn
        FROM attendance_logs al
        WHERE al.jenis = 'pulang'
          AND COALESCE(al.waktu_absen, al.waktu_scan) >= ?
          AND COALESCE(al.waktu_absen, al.waktu_scan) <= ?
      ) pulang
        ON masuk.teacher_id = pulang.teacher_id
        AND masuk.tgl = pulang.tgl
        AND pulang.rn = 1
      WHERE masuk.rn = 1
    ) m
  `;
  
  const p = [start, end, start, end];
  if (tenantId) {
    q += ` WHERE m.tenant_id_masuk = ? AND m.tenant_id_pulang = ?`;
    p.push(tenantId, tenantId);
  }
  q += ` ORDER BY m.teacher_id, m.tgl`;
  return db.query(q, p);
}

// Hitung summary dari data daily (untuk backward compatibility & summary)
async function getAttendanceSummary(tenantId, startDate, endDate) {
  const daily = await getAttendanceDaily(tenantId, startDate, endDate);
  const summary = {};
  for (const d of daily) {
    if (!summary[d.teacher_id]) {
      summary[d.teacher_id] = {
        teacher_id: d.teacher_id,
        tepat_waktu: 0,
        terlambat: 0,
        cepat_pulang: 0,
        tidak_absen_masuk: 0,
        tidak_absen_pulang: 0,
        hadir: 0,
        izin: 0,
        sakit: 0,
        dinas_luar: 0,
        kjm: 0,
        // New: daily detail for per-day calculation
        dailyDetails: []
      };
    }
    const s = summary[d.teacher_id];
    s.dailyDetails.push({
      tgl: d.tgl,
      status_masuk: d.status_masuk,
      status_pulang: d.status_pulang,
      dinas_luar: d.dinas_luar
    });
    
    if (d.status_masuk === 'tepat_waktu') s.tepat_waktu++;
    else if (d.status_masuk === 'terlambat') s.terlambat++;
    else if (d.status_masuk === 'kjm') s.kjm++;
    else if (d.status_masuk === 'izin' || d.status_masuk === 'cuti') s.izin++;
    else if (d.status_masuk === 'sakit') s.sakit++;
    else if (d.status_masuk === 'dinas_luar' || d.dinas_luar === 1) s.dinas_luar++;
    
    if (d.status_masuk === 'tepat_waktu' || d.status_masuk === 'terlambat') s.hadir++;
    
    if (d.status_pulang === 'pulang_cepat') s.cepat_pulang++;
    
    if (d.status_masuk === null) s.tidak_absen_masuk++;
    else if (d.status_pulang === null) s.tidak_absen_pulang++;
  }
  return Object.values(summary);
}

// ------- Endpoints -------

// GET settings (global)
router.get('/kafalah/settings', authenticateBendahara, async (req, res) => {
  try {
    const s = await getKafalahSettings();
    res.json({ success: true, data: s });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET settings (tenant-specific)
router.get('/kafalah/settings/tenant', authenticateBendahara, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    if (!tenantId) return res.status(400).json({ success: false, message: 'tenant_id required' });
    const s = await getKafalahSettings(tenantId);
    res.json({ success: true, data: s });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// PUT settings (global)
router.put('/kafalah/settings', authenticateBendahara, async (req, res) => {
  try {
    const fields = ['tunj_struktural','tunj_fungsional','tunj_transport','tunj_tepat_waktu','tunj_tidak_cepat_pulang','tunj_prestasi_kinerja','nominal_kjm','tunj_pembina','tunj_anak','tunj_istri','tunj_uang_makan','tunj_apresiasi','tunj_jam_mengajar','pot_luar_tanggungan','pot_durasi_simt','pot_taawun','pot_piutang'];
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

// PUT settings (tenant-specific)
router.put('/kafalah/settings/tenant', authenticateBendahara, async (req, res) => {
  try {
    const tenantId = req.body.tenant_id || req.query.tenant_id;
    if (!tenantId) return res.status(400).json({ success: false, message: 'tenant_id required' });
    const allFields = ['tunj_struktural','tunj_fungsional','tunj_transport','tunj_tepat_waktu','tunj_tidak_cepat_pulang','tunj_prestasi_kinerja','nominal_kjm','tunj_pembina','tunj_anak','tunj_istri','tunj_uang_makan','tunj_apresiasi','tunj_jam_mengajar','pot_luar_tanggungan','pot_durasi_simt','pot_taawun','pot_piutang'];
    // Only include fields that are actually provided
    const fields = allFields.filter(f => req.body[f] !== undefined);
    if (fields.length === 0) return res.status(400).json({ success: false, message: 'Tidak ada field' });
    
    const vals = { tenant_id: tenantId };
    fields.forEach(f => { vals[f] = num(req.body[f]); });
    
    const set = fields.map(f => `${f}=?`).join(', ');
    await db.query(
      `INSERT INTO kafalah_settings (tenant_id, ${fields.join(',')}) VALUES (?, ${fields.map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE ${set}`,
      [tenantId, ...fields.map(f => vals[f]), ...fields.map(f => vals[f])]
    );
    res.json({ success: true, message: 'Pengaturan KAFALAH sekolah tersimpan' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// DELETE settings (tenant-specific) - revert to global
router.delete('/kafalah/settings/tenant', authenticateBendahara, async (req, res) => {
  try {
    const tenantId = req.body.tenant_id || req.query.tenant_id;
    if (!tenantId) return res.status(400).json({ success: false, message: 'tenant_id required' });
    await db.query('DELETE FROM kafalah_settings WHERE tenant_id = ?', [tenantId]);
    res.json({ success: true, message: 'Pengaturan sekolah dihapus, menggunakan global' });
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
    // Return as keyed object: { teacher_id: {...} }
    const keyed = {};
    rows.forEach(r => { keyed[r.teacher_id] = r; });
    res.json({ success: true, data: keyed });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET teachers by tenant (for override UI)
router.get('/kafalah/teachers', authenticateBendahara, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    if (!tenantId) return res.status(400).json({ success: false, message: 'tenant_id required' });
    const rows = await db.query(
      `SELECT t.id, t.nama FROM teachers t
       JOIN teacher_assignments ta ON t.id = ta.teacher_id
       WHERE ta.tenant_id = ? AND t.status_aktif = 1
       ORDER BY t.nama ASC`, [tenantId]
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
    const fields = [...OVERRIDE_FIELDS, 'is_active'];
    const vals = { teacher_id: req.params.teacherId, tenant_id: tenantId };
    fields.forEach(f => { if (req.body[f] !== undefined) vals[f] = (f === 'is_active') ? (req.body[f] ? 1 : 0) : num(req.body[f]); });
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
    const { tenant_id, periode_mulai, periode_selesai, label_periode, base_mode } = req.body;
    if (!tenant_id || !periode_mulai || !periode_selesai) {
      return res.status(400).json({ success: false, message: 'tenant_id, periode_mulai, periode_selesai wajib' });
    }
    const baseMode = base_mode && ['global', 'school'].includes(base_mode) ? base_mode : 'school';
    const rows = await computeKafalah(tenant_id, periode_mulai, periode_selesai, label_periode, baseMode);
    res.json({ success: true, data: rows, base_mode: baseMode });
  } catch (e) {
    console.error('preview error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST generate (simpan ke kafalah_payroll)
router.post('/kafalah/generate', authenticateBendahara, async (req, res) => {
  try {
    const { tenant_id, periode_mulai, periode_selesai, label_periode, base_mode } = req.body;
    if (!tenant_id || !periode_mulai || !periode_selesai) {
      return res.status(400).json({ success: false, message: 'tenant_id, periode_mulai, periode_selesai wajib' });
    }
    const baseMode = base_mode && ['global', 'school'].includes(base_mode) ? base_mode : 'school';
    const rows = await computeKafalah(tenant_id, periode_mulai, periode_selesai, label_periode, baseMode);
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
         total_pendapatan, base_mode_used, is_manual_edit, created_by)
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
         total_pendapatan=VALUES(total_pendapatan), base_mode_used=VALUES(base_mode_used), is_manual_edit=VALUES(is_manual_edit), updated_at=NOW()`;
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
        r.total_pendapatan, baseMode, 0, req.user.id
      ];
      await db.query(sql, p);
      saved++;
    }
    res.json({ success: true, message: `${saved} slip KAFALAH tersimpan`, data: rows, base_mode: baseMode });
  } catch (e) {
    console.error('generate error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ============================================================
// NEW ENDPOINTS: Base Mode, Regenerate, Save Manual
// ============================================================

// GET base mode preference
router.get('/kafalah/base-mode', authenticateBendahara, async (req, res) => {
  try {
    const { baseMode, tenantId } = await getBaseMode(req);
    res.json({ success: true, data: { base_mode: baseMode, tenant_id: tenantId } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// PUT base mode preference
router.put('/kafalah/base-mode', authenticateBendahara, async (req, res) => {
  try {
    const { base_mode, tenant_id } = req.body;
    if (!base_mode || !['global', 'school'].includes(base_mode)) {
      return res.status(400).json({ success: false, message: 'base_mode harus global atau school' });
    }
    const userId = req.user.id;
    const tenantId = tenant_id || null;
    await db.query(
      `INSERT INTO kafalah_base_mode (user_id, tenant_id, base_mode)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE base_mode = VALUES(base_mode)`,
      [userId, tenantId, base_mode]
    );
    res.json({ success: true, message: 'Base mode tersimpan', data: { base_mode, tenant_id } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST regenerate (force recalculate & overwrite)
router.post('/kafalah/regenerate', authenticateBendahara, async (req, res) => {
  try {
    const { teacher_ids, tenant_id, periode_mulai, periode_selesai, label_periode, base_mode } = req.body;
    if (!tenant_id || !periode_mulai || !periode_selesai || !teacher_ids || !Array.isArray(teacher_ids)) {
      return res.status(400).json({ success: false, message: 'tenant_id, periode_mulai, periode_selesai, teacher_ids[] wajib' });
    }
    const baseMode = base_mode && ['global', 'school'].includes(base_mode) ? base_mode : 'school';

    // 1. Delete existing
    const placeholders = teacher_ids.map(() => '?').join(',');
    await db.query(
      `DELETE FROM kafalah_payroll WHERE teacher_id IN (${placeholders}) AND tenant_id=? AND periode_mulai=? AND periode_selesai=?`,
      [...teacher_ids, tenant_id, periode_mulai, periode_selesai]
    );

    // 2. Recompute fresh
    const rows = await computeKafalah(tenant_id, periode_mulai, periode_selesai, label_periode, baseMode);
    const filtered = rows.filter(r => teacher_ids.includes(r.teacher_id));

    // 3. Insert fresh
    let saved = 0;
    for (const r of filtered) {
      const sql = `INSERT INTO kafalah_payroll
        (teacher_id, tenant_id, periode_mulai, periode_selesai, label_periode,
         nama, nik, jabatan, status_pegawai, jenjang, pendidikan, masa_kerja_tahun, jumlah_anak, predikat_kinerja,
         hari_efektif, hadir, tidak_hadir, tepat_waktu, terlambat, tidak_absen_masuk, cepat_pulang, tidak_absen_pulang, kjm,
         kafalah_pokok, tunj_keluarga_istri, tunj_keluarga_anak, total_a,
         tunj_struktural, tunj_pengabdian, tunj_fungsional, tunj_pembina, tunj_pondok,
         tunj_transport, tunj_tepat_waktu, tunj_tidak_cepat_pulang, tunj_kjm, tunj_prestasi_kinerja, tunj_apresiasi, total_b,
         potong_taawun, potong_simt, potong_pinjaman, potong_cuti_luar_tanggungan, potong_persen_cuti, total_c,
         total_pendapatan, base_mode_used, is_manual_edit, created_by)
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
         total_pendapatan=VALUES(total_pendapatan), base_mode_used=VALUES(base_mode_used), is_manual_edit=VALUES(is_manual_edit), updated_at=NOW()`;
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
        r.total_pendapatan, baseMode, 0, req.user.id
      ];
      await db.query(sql, p);
      saved++;
    }
    res.json({ success: true, message: `${saved} slip diregenerasi`, data: filtered, base_mode: baseMode });
  } catch (e) {
    console.error('regenerate error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST save manual edit per row
router.post('/kafalah/save-manual', authenticateBendahara, async (req, res) => {
  try {
    const { payroll_id, fields } = req.body;
    if (!payroll_id || !fields || typeof fields !== 'object') {
      return res.status(400).json({ success: false, message: 'payroll_id dan fields object wajib' });
    }
    const allowedFields = [
      'kafalah_pokok', 'tunj_keluarga_istri', 'tunj_keluarga_anak',
      'tunj_struktural', 'tunj_pengabdian', 'tunj_fungsional', 'tunj_pembina', 'tunj_pondok',
      'tunj_transport', 'tunj_tepat_waktu', 'tunj_tidak_cepat_pulang', 'tunj_kjm',
      'tunj_prestasi_kinerja', 'tunj_apresiasi', 'tunj_uang_makan', 'tunj_jam_mengajar',
      'potong_taawun', 'potong_simt', 'potong_pinjaman', 'potong_cuti_luar_tanggungan'
    ];
    const updates = [];
    const vals = [];
    for (const [key, value] of Object.entries(fields)) {
      if (allowedFields.includes(key)) {
        updates.push(`${key}=?`);
        vals.push(num(value));
      }
    }
    if (!updates.length) return res.status(400).json({ success: false, message: 'Tidak ada field valid' });
    vals.push(payroll_id);
    await db.query(
      `UPDATE kafalah_payroll SET ${updates.join(', ')}, is_manual_edit=1, updated_at=NOW() WHERE id=?`,
      vals
    );
    // Return updated row
    const [row] = await db.query('SELECT * FROM kafalah_payroll WHERE id=?', [payroll_id]);
    res.json({ success: true, message: 'Edit manual tersimpan', data: row });
  } catch (e) {
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
    const editable = ['tunj_struktural','tunj_pembina','tunj_pondok','tunj_apresiasi','tunj_uang_makan','tunj_jam_mengajar','potong_taawun','potong_simt','potong_pinjaman','potong_cuti_luar_tanggungan','potong_persen_cuti','predikat_kinerja','jumlah_anak'];
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
      + num(r.tunj_kjm) + num(r.tunj_prestasi_kinerja) + num(r.tunj_apresiasi)
      + num(r.tunj_uang_makan) + num(r.tunj_jam_mengajar);
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

// POST send slip gaji via WhatsApp
router.post('/kafalah/send-slip-whatsapp', authenticateBendahara, async (req, res) => {
  try {
    const { teacher_ids, tenant_id, periode_mulai, periode_selesai, mode } = req.body;
    if (!tenant_id || !periode_mulai || !periode_selesai) {
      return res.status(400).json({ success: false, message: 'tenant_id, periode_mulai, periode_selesai wajib' });
    }
    if (!teacher_ids || !Array.isArray(teacher_ids) || teacher_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'teacher_ids wajib diisi' });
    }
    if (!mode || !['pusat', 'sekolah'].includes(mode)) {
      return res.status(400).json({ success: false, message: 'mode harus "pusat" atau "sekolah"' });
    }

    // Get tenant info
    const tenants = await db.query('SELECT nama_sekolah FROM tenants WHERE tenant_id=?', [tenant_id]);
    const namaSekolah = tenants.length ? tenants[0].nama_sekolah : '';

    // Get settings
    const settings = await getKafalahSettings(tenant_id);
    const overrides = await getOverrides(tenant_id);
    const jabatanRows = await db.query('SELECT jabatan_key, nominal FROM kafalah_jabatan_tunjangan');
    const jabatanMap = {};
    jabatanRows.forEach(j => { jabatanMap[j.jabatan_key.toLowerCase()] = num(j.nominal); });

    // Get teacher data
    const placeholders = teacher_ids.map(() => '?').join(',');
    const teachers = await db.query(
      `SELECT t.id, t.nama, t.nik, t.no_wa, t.status_kepegawaian, COALESCE(t.tmt, t.created_at) AS tmt, t.pendidikan_terakhir, t.pendidikan_kode, t.jumlah_anak, t.status_perkawinan, t.data_keluarga,
              (SELECT ta.jabatan_di_unit FROM teacher_assignments ta
               WHERE ta.teacher_id = t.id AND ta.tenant_id = ? AND ta.is_paid = 1
               ORDER BY FIELD(LOWER(REPLACE(ta.jabatan_di_unit,' ','')), 'kepalasekolah','kepsek','bendahara','walikelas','guru') ASC
               LIMIT 1) AS jabatan
       FROM teachers t
       WHERE t.id IN (${placeholders}) AND t.status_aktif = 1`, [tenant_id, ...teacher_ids]
    );

    // Get attendance for these teachers
    const att = await getAttendanceSummary(tenant_id, periode_mulai, periode_selesai);
    const attMap = {};
    att.forEach(a => { attMap[a.teacher_id] = a; });

    // Get all teacher NIKs for spouse check
    const allTeacherNiks = new Set((await db.query('SELECT nik FROM teachers WHERE status_aktif = 1')).map(r => r.nik));
    const jenjang = jenjangFromTenant(namaSekolah, tenant_id);

    let sentCount = 0;
    let failedCount = 0;
    const results = [];

    for (const t of teachers) {
      const a = attMap[t.id] || {};
      const mk = masaKerjaTahun(t.tmt);
      const pendidikan = pendidikanFromText(t.nama, t.pendidikan_terakhir, t.pendidikan_kode);
      const status = statusFromText(t.status_kepegawaian);
      const gajiPokok = await lookupGajiPokok(status, jenjang, pendidikan, mk);

      // Calculate per-day attendance-based allowances
      let transportDays = 0;
      let uangMakanDays = 0;
      let tepatWaktuDays = 0;
      let tidakCepatPulangDays = 0;
      
      if (a.dailyDetails && a.dailyDetails.length > 0) {
        for (const d of a.dailyDetails) {
          const isHadir = d.status_masuk === 'tepat_waktu' || d.status_masuk === 'terlambat';
          const isTepatWaktu = d.status_masuk === 'tepat_waktu';
          const isCepatPulang = d.status_pulang === 'pulang_cepat';
          
          if (isTepatWaktu && !isCepatPulang) transportDays++;
          if (isHadir) uangMakanDays++;
          if (isTepatWaktu) tepatWaktuDays++;
          if (isHadir && !isCepatPulang) tidakCepatPulangDays++;
        }
      }

      const ov = overrides[t.id] || {};
      const jml_anak = num(t.jumlah_anak || ov.jumlah_anak);

      // Spouse check
      let pasanganBekerjaDiYpwi = false;
      try {
        const keluarga = t.data_keluarga ? JSON.parse(t.data_keluarga) : [];
        for (const k of keluarga) {
          if ((k.tipe === 'istri' || k.tipe === 'suami') && k.nik && allTeacherNiks.has(k.nik)) {
            pasanganBekerjaDiYpwi = true;
            break;
          }
        }
      } catch (e) { /* ignore */ }

      // Mode-specific calculations
      // 'pusat' = Global base + Individual override
      // 'sekolah' = Tenant base + Individual override
      // Individual override is ALWAYS applied on top (if is_active=1)
      let baseSettings = settings;
      if (mode === 'pusat') {
        // Force global settings - query global if needed
        baseSettings = await getKafalahSettings(null);
      } else if (mode === 'sekolah') {
        // Use tenant settings (already loaded as 'settings')
        baseSettings = settings;
      }

      const isMenikah = (t.status_perkawinan === 'Menikah');
      const tunjKeluargaIstri = (isMenikah && status === 'PT' && !pasanganBekerjaDiYpwi) ? getOverrideValue(ov, baseSettings.tunj_istri, 'tunj_istri') : 0;
      const tunjKeluargaAnak = (isMenikah && !pasanganBekerjaDiYpwi) ? (getOverrideValue(ov, baseSettings.tunj_anak, 'tunj_anak') * jml_anak) : 0;
      const totalA = gajiPokok + tunjKeluargaIstri + tunjKeluargaAnak;

      const tunjPengabdian = getOverrideValue(ov, baseSettings.tunj_pengabdian, 'tunj_pengabdian');
      const tunjFungsional = getOverrideValue(ov, baseSettings.tunj_fungsional, 'tunj_fungsional');
      const tunjPrestasiKinerja = getOverrideValue(ov, baseSettings.tunj_prestasi_kinerja, 'tunj_prestasi_kinerja');
      const tunjJamMengajar = getOverrideValue(ov, baseSettings.tunj_jam_mengajar, 'tunj_jam_mengajar');
      const tunjUangMakanRate = getOverrideValue(ov, baseSettings.tunj_uang_makan, 'tunj_uang_makan');
      const tunjTransportRate = getOverrideValue(ov, baseSettings.tunj_transport, 'tunj_transport');
      const tunjTepatWaktuRate = getOverrideValue(ov, baseSettings.tunj_tepat_waktu, 'tunj_tepat_waktu');
      const tunjTidakCepatPulangRate = getOverrideValue(ov, baseSettings.tunj_tidak_cepat_pulang, 'tunj_tidak_cepat_pulang');
      const tunjPembina = getOverrideValue(ov, baseSettings.tunj_pembina, 'tunj_pembina');
      const tunjPondok = getOverrideValue(ov, baseSettings.tunj_pondok, 'tunj_pondok');
      const tunjStruktural = getOverrideValue(ov, await lookupStrukturalByJabatan(t.jabatan, jabatanMap), 'tunj_struktural');
      const tunjApresiasi = getOverrideValue(ov, 0, 'tunj_apresiasi');
      const nominalKjm = getOverrideValue(ov, baseSettings.nominal_kjm, 'nominal_kjm');

      // Calculate components
      const tunjTransport = tunjTransportRate * transportDays;
      const tunjUangMakan = tunjUangMakanRate * uangMakanDays;
      const tunjTepatWaktu = tunjTepatWaktuRate * tepatWaktuDays;
      const tunjTidakCepatPulang = tunjTidakCepatPulangRate * tidakCepatPulangDays;
      const tunjKjm = nominalKjm * (num(a.kjm) || 0);

      const totalB = tunjStruktural + tunjPengabdian + tunjFungsional + tunjPembina + tunjPondok
        + tunjTransport + tunjTepatWaktu + tunjTidakCepatPulang + tunjKjm + tunjPrestasiKinerja + tunjApresiasi
        + tunjUangMakan + tunjJamMengajar;

      const potLuarTanggungan = getOverrideValue(ov, baseSettings.pot_luar_tanggungan, 'pot_luar_tanggungan');
      const potDurasiSimt = getOverrideValue(ov, baseSettings.pot_durasi_simt, 'pot_durasi_simt');
      const potTaawun = getOverrideValue(ov, baseSettings.pot_taawun, 'pot_taawun');
      const potPiutang = getOverrideValue(ov, baseSettings.pot_piutang, 'pot_piutang');
      const totalC = potLuarTanggungan + potDurasiSimt + potTaawun + potPiutang;
      const totalPendapatan = totalA + totalB - totalC;

      // Format periode label
      const startDate = new Date(periode_mulai);
      const endDate = new Date(periode_selesai);
      const bulanNama = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
      const periodeLabel = `${bulanNama[startDate.getMonth()]} ${startDate.getFullYear()}`;

      // Generate WhatsApp message
      const message = generateKafalahSlipMessage({
        namaSekolah,
        periodeLabel,
        guru: t,
        jabatan: t.jabatan,
        status,
        jenjang,
        pendidikan,
        mk,
        gajiPokok,
        tunjKeluargaIstri,
        tunjKeluargaAnak,
        jml_anak,
        totalA,
        tunjStruktural,
        tunjPengabdian,
        tunjFungsional,
        tunjPembina,
        tunjPondok,
        tunjTransport,
        tunjTepatWaktu,
        tunjTidakCepatPulang,
        tunjUangMakan,
        tunjKjm,
        tunjPrestasiKinerja,
        tunjApresiasi,
        tunjJamMengajar,
        nominalKjm,
        transportDays,
        uangMakanDays,
        tepatWaktuDays,
        tidakCepatPulangDays,
        kjm: num(a.kjm) || 0,
        totalB,
        potLuarTanggungan,
        potDurasiSimt,
        potTaawun,
        potPiutang,
        totalC,
        totalPendapatan
      });

      // Send WhatsApp
      let sent = false;
      if (t.no_wa && typeof global.sendWhatsAppMessage === 'function') {
        try {
          await global.sendWhatsAppMessage(t.no_wa, message);
          sent = true;
          sentCount++;
        } catch (e) {
          console.error('WA send error:', e);
        }
      }
      if (!sent) failedCount++;

      results.push({
        teacher_id: t.id,
        nama: t.nama,
        no_wa: t.no_wa,
        sent,
        message: sent ? 'Terkirim' : 'Gagal (no WA atau error)'
      });
    }

    res.json({ 
      success: true, 
      message: `Terkirim: ${sentCount}, Gagal: ${failedCount}`,
      data: results
    });
  } catch (e) {
    console.error('send-slip-whatsapp error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// Helper function to generate slip message
function generateKafalahSlipMessage(data) {
  const fmt = (n) => 'Rp ' + (num(n) || 0).toLocaleString('id-ID');
  const { 
    namaSekolah, periodeLabel, guru, jabatan, status, jenjang, pendidikan, mk,
    gajiPokok, tunjKeluargaIstri, tunjKeluargaAnak, jml_anak, totalA,
    tunjStruktural, tunjPengabdian, tunjFungsional, tunjPembina, tunjPondok,
    tunjTransport, tunjTepatWaktu, tunjTidakCepatPulang, tunjUangMakan,
    tunjKjm, tunjPrestasiKinerja, tunjApresiasi, tunjJamMengajar, nominalKjm,
    transportDays, uangMakanDays, tepatWaktuDays, tidakCepatPulangDays, kjm,
    totalB, potLuarTanggungan, potDurasiSimt, potTaawun, potPiutang, totalC, totalPendapatan
  } = data;

  return `*SLIP GAJI KAFALAH - ${namaSekolah.toUpperCase()}*
Periode: ${periodeLabel}

👤 *Nama:* ${guru.nama}
🆔 *NIK:* ${guru.nik || '-'}
📋 *Jabatan:* ${jabatan || '-'}
📊 *Status:* ${status} - ${jenjang} - ${pendidikan} (MK: ${mk} th)

──────────────────
💰 *KOMPONEN WAJIB (A)*
• Gaji Pokok: ${fmt(gajiPokok)}
• Tunj. Istri: ${fmt(tunjKeluargaIstri)}
• Tunj. Anak: ${fmt(tunjKeluargaAnak)} (${jml_anak} anak)
**Total A: ${fmt(totalA)}**

──────────────────
🎁 *KOMPONEN INSSENTIF (B)*
• Struktural: ${fmt(tunjStruktural)}
• Fungsional: ${fmt(tunjFungsional)}
• Transportasi: ${fmt(tunjTransport)} (${transportDays} hari)
• Kedatangan Tepat Waktu: ${fmt(tunjTepatWaktu)} (${tepatWaktuDays} hari)
• Tidak Pulang Cepat: ${fmt(tunjTidakCepatPulang)} (${tidakCepatPulangDays} hari)
• Uang Makan: ${fmt(tunjUangMakan)} (${uangMakanDays} hari)
• KJM: ${fmt(tunjKjm)} (${kjm} jam × ${fmt(nominalKjm)})
• Prestasi Kinerja: ${fmt(tunjPrestasiKinerja)}
• Apresiasi: ${fmt(tunjApresiasi)}
• Pembina: ${fmt(tunjPembina)}
• Jam Mengajar: ${fmt(tunjJamMengajar)}
**Total B: ${fmt(totalB)}**

──────────────────
⚠️ *PEMOTONGAN (C)*
• Luar Tanggungan: ${fmt(potLuarTanggungan)}
• SIM-T: ${fmt(potDurasiSimt)}
• Ta'awun: ${fmt(potTaawun)}
• Piutang: ${fmt(potPiutang)}
**Total C: ${fmt(totalC)}**

──────────────────
✅ *TOTAL DITERIMA: ${fmt(totalPendapatan)}*
(Total A + Total B - Total C)

📱 *YPWI Luwu Timur - Sistem KAFALAH*`;
}

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
// Hitung hari kerja (tidak termasuk akhir pekan) dalam rentang tanggal
function hitungHariKerja(startStr, endStr) {
  const start = new Date(startStr);
  const end = new Date(endStr);
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  let hariKerja = 0;
  for (let d = new Date(startDay); d <= endDay; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) hariKerja++;
  }
  return hariKerja;
}

function defaultGajiUntukPendidikan(status, jenjang, kode) {
  // Base per jenjang (ambil dari PT S1 2-th yang sudah ada di matrix)
  const basePT = { TK: 900000, SD: 1800000, SMP: 900000, SMA: 900000, PONPES: 900000 };
  const basePK = { TK: 500000, SD: 500000, SMP: 500000, SMA: 500000, PONPES: 500000 };
  const base = status === 'PT' ? basePT[jenjang] : basePK[jenjang];
  // Multiplier
  const mult = { SMA: 0.5, D3: 0.75, S1: 1.0, S2: 1.0, S3: 1.0 };
  return Math.round(base * (mult[kode] || 1));
}

async function computeKafalah(tenantId, startDate, endDate, labelPeriode, baseMode = 'school') {
  // Auto-sync matrix dengan pendidikan dari data guru
  await autoSyncPendidikan();

  const settings = await resolveSettings(tenantId, baseMode);
  const overrides = await getOverrides(tenantId);
  const gajiConfig = await resolveGajiPokokConfig(tenantId, baseMode);
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
    `SELECT t.id, t.nama, t.nik, t.status_kepegawaian, COALESCE(t.tmt, t.created_at) AS tmt, t.pendidikan_terakhir, t.pendidikan_kode, t.jumlah_anak, t.status_perkawinan, t.data_keluarga,
            (SELECT ta.jabatan_di_unit FROM teacher_assignments ta
             WHERE ta.teacher_id = t.id AND ta.tenant_id = ? AND ta.is_paid = 1
             ORDER BY FIELD(LOWER(REPLACE(ta.jabatan_di_unit,' ','')), 'kepalasekolah','kepsek','bendahara','walikelas','guru') ASC
             LIMIT 1) AS jabatan
      FROM teachers t
      WHERE t.status_aktif = 1
        AND EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.teacher_id = t.id AND ta.tenant_id = ? AND ta.is_paid = 1)
      ORDER BY t.nama ASC`, [tenantId, tenantId]
  );

  // Build set of NIKs of all active teachers (for spouse check)
  const allTeacherNiks = new Set((await db.query('SELECT nik FROM teachers WHERE status_aktif = 1')).map(r => r.nik));

  const rows = [];
  for (const t of teachers) {
    const mk = masaKerjaTahun(t.tmt);
    const pendidikan = pendidikanFromText(t.nama, t.pendidikan_terakhir, t.pendidikan_kode);
    const status = statusFromText(t.status_kepegawaian);
    const gajiPokok = await lookupGajiPokokNew(status, jenjang, pendidikan, mk, gajiConfig);

    const a = attMap[t.id] || {};
    const hadir = num(a.hadir);
    const terlambat = num(a.terlambat);
    const tepat_waktu = num(a.tepat_waktu);
    const izin = num(a.izin);
    const sakit = num(a.sakit);
    const hariKerja = hitungHariKerja(startDate, endDate); // hari kerja tanpa akhir pekan
    const tidak_hadir = Math.max(0, hariKerja - (hadir + terlambat + izin + sakit + num(a.dinas_luar)));
    const adaAbsensi = (hadir + terlambat) > 0; // ada catatan masuk

    // Calculate per-day attendance-based allowances
    let transportDays = 0;
    let uangMakanDays = 0;
    let tepatWaktuDays = 0;
    let tidakCepatPulangDays = 0;
    
    if (a.dailyDetails && a.dailyDetails.length > 0) {
      for (const d of a.dailyDetails) {
        const isHadir = d.status_masuk === 'tepat_waktu' || d.status_masuk === 'terlambat';
        const isTepatWaktu = d.status_masuk === 'tepat_waktu';
        const isCepatPulang = d.status_pulang === 'pulang_cepat';
        
        if (isTepatWaktu && !isCepatPulang) transportDays++;
        if (isHadir) uangMakanDays++;
        if (isTepatWaktu) tepatWaktuDays++;
        if (isHadir && !isCepatPulang) tidakCepatPulangDays++;
      }
    }

    const ov = overrides[t.id] || {};
    const jml_anak = num(t.jumlah_anak || ov.jumlah_anak);

    // Cek apakah istri/suami juga bekerja di YPWI LUTIM
    let pasanganBekerjaDiYpwi = false;
    try {
      const keluarga = t.data_keluarga ? JSON.parse(t.data_keluarga) : [];
      for (const k of keluarga) {
        if ((k.tipe === 'istri' || k.tipe === 'suami') && k.nik && allTeacherNiks.has(k.nik)) {
          pasanganBekerjaDiYpwi = true;
          break;
        }
      }
    } catch (e) { /* ignore parse errors */ }

    const isMenikah = (t.status_perkawinan === 'Menikah');
    // Tunj. Istri: hanya jika menikah, PT, dan pasangan tidak bekerja di YPWI
    const tunjKeluargaIstri = (isMenikah && status === 'PT' && !pasanganBekerjaDiYpwi) ? getOverrideValue(ov, settings.tunj_istri, 'tunj_istri') : 0;
    // Tunj. Anak: hanya jika menikah dan pasangan tidak bekerja di YPWI
    const tunjKeluargaAnak = (isMenikah && !pasanganBekerjaDiYpwi) ? (getOverrideValue(ov, settings.tunj_anak, 'tunj_anak') * jml_anak) : 0;
    const totalA = gajiPokok + tunjKeluargaIstri + tunjKeluargaAnak;

    const tunjPengabdian = getOverrideValue(ov, settings.tunj_pengabdian, 'tunj_pengabdian');
    const tunjFungsional = getOverrideValue(ov, settings.tunj_fungsional, 'tunj_fungsional');
    const tunjPrestasiKinerja = getOverrideValue(ov, settings.tunj_prestasi_kinerja, 'tunj_prestasi_kinerja');
    const tunjJamMengajar = getOverrideValue(ov, settings.tunj_jam_mengajar, 'tunj_jam_mengajar');
    
    // NEW: Per-day calculation based on attendance
    // Transportasi: per hari jika datang tepat waktu DAN tidak cepat pulang
    const tunjTransport = getOverrideValue(ov, settings.tunj_transport, 'tunj_transport') * transportDays;
    // Uang Makan: per hari jika hadir (termasuk terlambat, termasuk absen datang tanpa absen pulang)
    const tunjUangMakan = getOverrideValue(ov, settings.tunj_uang_makan, 'tunj_uang_makan') * uangMakanDays;
    // Kedatangan Tepat Waktu: per hari tepat waktu
    const tunjTepatWaktu = getOverrideValue(ov, settings.tunj_tepat_waktu, 'tunj_tepat_waktu') * tepatWaktuDays;
    // Tidak Cepat Pulang: per hari hadir tapi tidak cepat pulang
    const tunjTidakCepatPulang = getOverrideValue(ov, settings.tunj_tidak_cepat_pulang, 'tunj_tidak_cepat_pulang') * tidakCepatPulangDays;
    
    const tunjKjm = (getOverrideValue(ov, settings.nominal_kjm, 'nominal_kjm')) * (num(a.kjm) || 0);
    const tunjPembina = getOverrideValue(ov, settings.tunj_pembina, 'tunj_pembina');
    const tunjPondok = getOverrideValue(ov, settings.tunj_pondok, 'tunj_pondok');
    // Struktural: prioritas override manual, fallback ke default jabatan
    const tunjStruktural = getOverrideValue(ov, await lookupStrukturalByJabatan(t.jabatan, jabatanMap), 'tunj_struktural');
    const tunjApresiasi = getOverrideValue(ov, 0, 'tunj_apresiasi');

    const totalB = tunjStruktural + tunjPengabdian + tunjFungsional + tunjPembina + tunjPondok
      + tunjTransport + tunjTepatWaktu + tunjTidakCepatPulang + tunjKjm + tunjPrestasiKinerja + tunjApresiasi
      + tunjUangMakan + tunjJamMengajar;

    // Total C: hitung dari 4 komponen pemotongan
    const potLuarTanggungan = getOverrideValue(ov, settings.pot_luar_tanggungan, 'pot_luar_tanggungan');
    const potDurasiSimt = getOverrideValue(ov, settings.pot_durasi_simt, 'pot_durasi_simt');
    const potTaawun = getOverrideValue(ov, settings.pot_taawun, 'pot_taawun');
    const potPiutang = getOverrideValue(ov, settings.pot_piutang, 'pot_piutang');
    const totalC = potLuarTanggungan + potDurasiSimt + potTaawun + potPiutang;
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
      tepat_waktu, 
      tidak_absen_masuk: num(a.tidak_absen_masuk || 0), 
      cepat_pulang: num(a.cepat_pulang || 0), 
      tidak_absen_pulang: num(a.tidak_absen_pulang || 0),
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
      tunj_uang_makan: tunjUangMakan,
      tunj_jam_mengajar: tunjJamMengajar,
      total_b: totalB,
      potong_taawun: potTaawun,
      potong_simt: potDurasiSimt,
      potong_pinjaman: potPiutang,
      potong_cuti_luar_tanggungan: potLuarTanggungan,
      potong_persen_cuti: 0,
      total_c: totalC,
      total_pendapatan: totalPendapatan
    });
  }
  return rows;
}

module.exports = router;
