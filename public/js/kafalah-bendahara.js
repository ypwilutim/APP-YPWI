// ============================================================
// KAFALAH - Client logic untuk Bendahara Dashboard
// ============================================================

// Use var or check existing to allow multiple script loads (dashboard + sekolah)
window.kafalahPreviewData = window.kafalahPreviewData || [];

// Escape HTML so teacher-supplied values (nama, nik, jabatan, ...) cannot
// inject markup/script when written into innerHTML.
function kafalahEsc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, c => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": ''' }[c]));
}

// Resolve tenant id used by KAFALAH settings/override UI.
// Prefers an explicit argument, then the settings-tab selector, then the KAFALAH tab selector.
function getKafalahTenantId(explicit) {
  if (explicit) return explicit;
  const el = document.getElementById('kafalahSettingsTenantSelect') ||
             document.getElementById('kafalahTenantSelect');
  return el ? el.value : '';
}

// Format currency
function fmtRp(v) {
  return 'Rp ' + (parseFloat(v || 0) || 0).toLocaleString('id-ID');
}

// Helper: Get start/end dates from month input (format: YYYY-MM)
function getKafalahPeriod() {
  const bulan = document.getElementById('kafalahBulan').value;
  if (!bulan) return null;
  const [year, month] = bulan.split('-').map(Number);
  const m = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0); // last day of month
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
    label: m[month - 1] + ' ' + year
  };
}

// ============================================================
// KAFALAH Global Toggle Management (per-tenant use_global flag)
// ============================================================

// Load KAFALAH settings context for a tenant and update UI
window.loadKafalahSettingsContext = async function(tenantId) {
  if (!tenantId) return;
  
  try {
    const res = await fetch('/api/kafalah/settings/tenant?tenant_id=' + encodeURIComponent(tenantId), { headers: getAuthHeader() });
    const json = await res.json();
    if (!json.success) return;
    
    const { use_global, source, can_manage_global, settings } = json.data;
    
    // Update badge in KAFALAH tab
    const badge = document.getElementById('kafalahModeBadge');
    if (badge) {
      badge.textContent = use_global ? '🌐 Global (Standar Pusat)' : '🏫 Lokal (Pengaturan Sekolah)';
      badge.className = use_global ? 'badge bg-blue-100 text-blue-800' : 'badge bg-emerald-100 text-emerald-800';
    }
    
    // Update toggle checkbox
    const toggle = document.getElementById('kafalahUseGlobalToggle');
    if (toggle) {
      toggle.checked = use_global;
      toggle.disabled = !can_manage_global;
    }
    
    // Show/hide notices
    const notice = document.getElementById('kafalahGlobalNotice');
    const lockNotice = document.getElementById('kafalahGlobalLockNotice');
    if (notice) notice.style.display = use_global ? 'block' : 'none';
    if (lockNotice) lockNotice.style.display = (!can_manage_global && use_global) ? 'block' : 'none';
    
    // Load settings values into form (always show tenant's own settings)
    loadKafalahSettingsForm(settings);
    
  } catch (e) {
    console.error('loadKafalahSettingsContext error:', e);
  }
};

// Save KAFALAH use_global toggle (SDM Pusat only)
window.saveKafalahUseGlobal = async function() {
  const tenantId = getKafalahTenantId();
  const useGlobal = document.getElementById('kafalahUseGlobalToggle').checked;
  
  try {
    const res = await fetch('/api/kafalah/settings/use-global', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ tenant_id: tenantId, use_global: useGlobal })
    });
    const json = await res.json();
    if (json.success) {
      showToast(json.message, 'success');
      loadKafalahSettingsContext(tenantId);
    } else {
      // Revert toggle on error
      document.getElementById('kafalahUseGlobalToggle').checked = !useGlobal;
      showToast(json.message || 'Gagal', 'error');
    }
  } catch (e) {
    document.getElementById('kafalahUseGlobalToggle').checked = !useGlobal;
    showToast('Error: ' + e.message, 'error');
  }
};

// ============================================================
// Settings Functions
// ============================================================

// Load KAFALAH settings form with tenant's own settings (not effective settings)
window.loadKafalahSettingsForm = function (s) {
  setVal('ksTunjStruktural', s.tunj_struktural);
  setVal('ksTunjPengabdian', s.tunj_pengabdian);
  setVal('ksTunjFungsional', s.tunj_fungsional);
  setVal('ksTunjTransport', s.tunj_transport);
  setVal('ksTunjTepatWaktu', s.tunj_tepat_waktu);
  setVal('ksTunjTidakCepatPulang', s.tunj_tidak_cepat_pulang);
  setVal('ksTunjUangMakan', s.tunj_uang_makan);
  setVal('ksNominalKjm', s.nominal_kjm);
  setVal('ksTunjPrestasiKinerja', s.tunj_prestasi_kinerja);
  setVal('ksTunjApresiasi', s.tunj_apresiasi);
  setVal('ksTunjPembina', s.tunj_pembina);
  setVal('ksTunjPondok', s.tunj_pondok);
  setVal('ksTunjJamMengajar', s.tunj_jam_mengajar);
  setVal('ksTunjIstri', s.tunj_istri);
  setVal('ksTunjAnak', s.tunj_anak);
  setVal('ksPotLuarTanggungan', s.pot_luar_tanggungan);
  setVal('ksPotDurasiSimt', s.pot_durasi_simt);
  setVal('ksPotTaawun', s.pot_taawun);
  setVal('ksPotPiutang', s.pot_piutang);
};

// Load KAFALAH settings context (called when tenant selector changes)
window.loadKafalahSettings = async function (tenantId) {
  try {
    const selectedTenant = getKafalahTenantId(tenantId);
    if (!selectedTenant) return;
    
    const res = await fetch('/api/kafalah/settings/tenant?tenant_id=' + encodeURIComponent(selectedTenant), { headers: getAuthHeader() });
    const json = await res.json();
    if (!json.success) return;
    
    const { use_global, source, settings } = json.data;
    
    // Update info text
    const infoEl = document.getElementById('kafalahSettingsInfo');
    if (infoEl) {
      const sel = document.getElementById('kafalahSettingsTenantSelect') || document.getElementById('kafalahTenantSelect');
      const schoolName = sel?.selectedOptions[0]?.text || 'sekolah ini';
      if (use_global) {
        infoEl.innerHTML = '<i class="fas fa-info-circle mr-1"></i> Saat ini menggunakan <b>Pengaturan Global (Pusat)</b>. Pengaturan di bawah ini adalah pengaturan lokal <b>' + schoolName + '</b> yang tersimpan dan akan dipakai saat toggle Global dimatikan.';
      } else {
        infoEl.innerHTML = '<i class="fas fa-info-circle mr-1"></i> Menggunakan pengaturan lokal <b>' + schoolName + '</b>. Bisa diubah sewaktu-waktu.';
      }
    }
    
    // Fill form with tenant's own settings
    loadKafalahSettingsForm(settings);
    
  } catch (e) { console.error(e); }
};

function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v || 0; }

window.saveKafalahSettings = async function (e) {
  e.preventDefault();
  const tenantId = getKafalahTenantId();
  
  const fields = ['tunj_struktural','tunj_pengabdian','tunj_fungsional','tunj_transport','tunj_tepat_waktu','tunj_tidak_cepat_pulang','tunj_uang_makan','nominal_kjm','tunj_prestasi_kinerja','tunj_apresiasi','tunj_pembina','tunj_pondok','tunj_jam_mengajar','tunj_istri','tunj_anak','pot_luar_tanggungan','pot_durasi_simt','pot_taawun','pot_piutang'];
  const body = { tenant_id: tenantId };
  fields.forEach(f => {
    const el = document.getElementById('ks' + f.split('_').map(s => s[0].toUpperCase() + s.slice(1)).join(''));
    if (el) body[f] = parseFloat(el.value || 0);
  });
  
  try {
    const res = await fetch('/api/kafalah/settings/tenant', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(body)
    });
    const json = await res.json();
    if (json.success) {
      showToast('Pengaturan KAFALAH sekolah tersimpan', 'success');
    } else showToast(json.message || 'Gagal', 'error');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
};

window.loadKafalahMatrix = async function () {
  return loadKafalahKenaikan();
};

window.loadKafalahKenaikan = async function () {
  const tbody = document.getElementById('kafalahKenaikanBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" class="text-center py-4"><i class="fas fa-spinner fa-spin"></i></td></tr>';
  const statusFilter = document.getElementById('kenaikanStatusFilter')?.value || '';
  const jenjangFilter = document.getElementById('kenaikanJenjangFilter')?.value || '';
  try {
    const res = await fetch('/api/kafalah/kenaikan', { headers: getAuthHeader() });
    const json = await res.json();
    if (!json.success) { tbody.innerHTML = '<tr><td colspan="8" class="text-center text-red-500">' + json.message + '</td></tr>'; return; }
    const filtered = json.data.filter(r =>
      (!statusFilter || r.status_pegawai === statusFilter) &&
      (!jenjangFilter || r.jenjang === jenjangFilter)
    );
    tbody.innerHTML = filtered.map(r => {
      const preview = computePreviewKenaikan(r);
      return `<tr class="hover:bg-gray-50">
        <td class="px-2 py-1">${r.status_pegawai}</td>
        <td class="px-2 py-1">${r.jenjang}</td>
        <td class="px-2 py-1">${r.pendidikan}</td>
        <td class="px-2 py-1 text-right">
          <input type="number" value="${r.gaji_awal}" min="0" step="1000" class="w-28 border rounded px-1 py-0.5 text-right" onchange="updateKenaikan(${r.id}, 'gaji_awal', this.value)" />
        </td>
        <td class="px-2 py-1 text-right">
          <input type="number" value="${r.kenaikan_per_tahun}" min="0" step="1000" class="w-24 border rounded px-1 py-0.5 text-right" onchange="updateKenaikan(${r.id}, 'kenaikan_per_tahun', this.value)" />
        </td>
        <td class="px-2 py-1 text-center">
          <input type="number" value="${r.interval_tahun}" min="1" step="1" class="w-14 border rounded px-1 py-0.5 text-center" onchange="updateKenaikan(${r.id}, 'interval_tahun', this.value)" />
        </td>
        <td class="px-2 py-1 text-center">
          <input type="number" value="${r.masa_kerja_max}" min="1" step="1" class="w-14 border rounded px-1 py-0.5 text-center" onchange="updateKenaikan(${r.id}, 'masa_kerja_max', this.value)" />
        </td>
        <td class="px-2 py-1 text-xs text-gray-600">${preview}</td>
      </tr>`;
    }).join('');
  } catch (e) { tbody.innerHTML = '<tr><td colspan="8" class="text-center text-red-500">' + e.message + '</td></tr>'; }
};

function computePreviewKenaikan(cfg) {
  const list = [0, 2, 5, 10, cfg.masa_kerja_max];
  return list.map(t => {
    const start = 2;
    let g = cfg.gaji_awal;
    if (t > start) {
      const periods = Math.floor((t - start - 1) / cfg.interval_tahun) + 1;
      g = cfg.gaji_awal + periods * cfg.kenaikan_per_tahun;
    }
    return `th${t}=${fmtRp(g)}`;
  }).join(' • ');
}

window.updateKenaikan = async function (id, field, value) {
  try {
    await fetch('/api/kafalah/kenaikan/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ [field]: parseFloat(value) || 0 })
    });
    showToast('Diperbarui', 'success');
    loadKafalahKenaikan();
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
};

window.loadPendidikanRef = async function () {
  const list = document.getElementById('pendidikanRefList');
  if (!list) return;
  try {
    const res = await fetch('/api/kafalah/pendidikan-ref', { headers: getAuthHeader() });
    const json = await res.json();
    if (!json.success) return;
    list.innerHTML = json.data.map(r =>
      `<span class="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs">${r.kode} — ${r.label}</span>`
    ).join('');
  } catch (e) {}
};

window.addPendidikanRef = async function () {
  const kode = document.getElementById('newPendidikanKode').value.trim();
  const label = document.getElementById('newPendidikanLabel').value.trim();
  if (!kode || !label) { showToast('Kode & label wajib', 'error'); return; }
  try {
    const res = await fetch('/api/kafalah/pendidikan-ref', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ kode, label })
    });
    const json = await res.json();
    if (json.success) {
      showToast('Pendidikan ditambahkan', 'success');
      document.getElementById('newPendidikanKode').value = '';
      document.getElementById('newPendidikanLabel').value = '';
      loadPendidikanRef();
      loadKafalahKenaikan();
    } else showToast(json.message || 'Gagal', 'error');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
};

window.syncPendidikanMatrix = async function () {
  try {
    const res = await fetch('/api/kafalah/sync-pendidikan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() }
    });
    const json = await res.json();
    if (json.success) {
      showToast(json.message, 'success');
      loadPendidikanRef();
      loadKafalahKenaikan();
    } else showToast(json.message || 'Gagal', 'error');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
};

window.loadJabatanTunjangan = async function () {
  const tbody = document.getElementById('kafalahJabatanBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="3" class="text-center py-4"><i class="fas fa-spinner fa-spin"></i></td></tr>';
  try {
    const res = await fetch('/api/kafalah/jabatan-tunjangan', { headers: getAuthHeader() });
    const json = await res.json();
    if (!json.success) return;
    tbody.innerHTML = json.data.map(r =>
      `<tr class="hover:bg-gray-50">
        <td class="px-2 py-1 font-medium">${r.jabatan_label}</td>
        <td class="px-2 py-1 text-xs text-gray-500">${r.jabatan_key}</td>
        <td class="px-2 py-1 text-right">
          <input type="number" value="${r.nominal}" min="0" step="10000" class="w-32 border rounded px-2 py-1 text-right" onchange="updateJabatanTunjangan(${r.id}, this.value)" />
        </td>
      </tr>`
    ).join('');
  } catch (e) { console.error(e); }
};

window.updateJabatanTunjangan = async function (id, nominal) {
  try {
    await fetch('/api/kafalah/jabatan-tunjangan/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ nominal: parseFloat(nominal) || 0 })
    });
    showToast('Tunjangan jabatan diperbarui', 'success');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
};

window.updateKafalahMatrix = async function (id, nominal) {
  try {
    await fetch('/api/kafalah/matrix/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ nominal: parseFloat(nominal) || 0 })
    });
    showToast('Matrix diperbarui', 'success');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
};

// ============================================================
// Preview & Generate
// ============================================================

window.previewKafalah = async function () {
  const tenantId = document.getElementById('kafalahTenantSelect').value;
  const period = getKafalahPeriod();
  if (!tenantId || !period) { showToast('Pilih sekolah & bulan', 'error'); return; }
  const { start, end, label } = period;
  const tbody = document.getElementById('kafalahTable');
  tbody.innerHTML = '<tr><td colspan="27" class="text-center py-6"><i class="fas fa-spinner fa-spin"></i> Menghitung...</td></tr>';
  try {
    const res = await fetch('/api/kafalah/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ tenant_id: tenantId, periode_mulai: start, periode_selesai: end, label_periode: label })
    });
    const json = await res.json();
    if (!json.success) { tbody.innerHTML = '<tr><td colspan="27" class="text-center text-red-500">' + json.message + '</td></tr>'; return; }
    kafalahPreviewData = json.data || [];
    renderKafalahTable(kafalahPreviewData);
    renderKafalahSummary(kafalahPreviewData);
    // Show mode badge
    const modeLabel = json.source === 'central' ? 'Global (Standar Pusat) 🌐' : 'Lokal (Pengaturan Sekolah) 🏫';
    showToast(`Mode: ${modeLabel}`, 'info');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="27" class="text-center text-red-500">' + e.message + '</td></tr>';
  }
};

// ============================================================
// Manual Edit Modal Functions
// ============================================================

let kafalahEditIndex = -1;

window.openKafalahEditModal = function (index) {
  kafalahEditIndex = index;
  const r = kafalahPreviewData[index];
  if (!r) return;
  
  const modalHtml = `
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div class="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div class="flex justify-between items-center p-4 border-b sticky top-0 bg-white z-10">
          <h4 class="font-semibold text-lg">Edit Manual KAFALAH: ${kafalahEsc(r.nama)}</h4>
          <button onclick="closeKafalahEditModal()" class="text-gray-500 hover:text-gray-700 text-2xl leading-none">&times;</button>
        </div>
        <div class="p-4 space-y-4">
          <div class="bg-gray-50 p-3 rounded text-sm">
            <div class="grid grid-cols-2 gap-2 text-xs">
              <span class="text-gray-500">NIK</span> <span class="font-medium">${kafalahEsc(r.nik) || '-'}</span>
              <span class="text-gray-500">Jabatan</span> <span class="font-medium">${kafalahEsc(r.jabatan) || '-'}</span>
              <span class="text-gray-500">Status</span> <span class="font-medium">${kafalahEsc(r.status_pegawai)}</span>
              <span class="text-gray-500">Masa Kerja</span> <span class="font-medium">${r.masa_kerja_tahun || 0} th</span>
            </div>
          </div>
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">Kafalah Pokok (Gaji Pokok)</label>
              <input type="number" id="edit_kafalah_pokok" value="${r.kafalah_pokok || 0}" min="0" step="1000" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">T. Keluarga (Istri)</label>
              <input type="number" id="edit_tunj_keluarga_istri" value="${r.tunj_keluarga_istri || 0}" min="0" step="1000" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">T. Keluarga (Anak)</label>
              <input type="number" id="edit_tunj_keluarga_anak" value="${r.tunj_keluarga_anak || 0}" min="0" step="1000" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">T. Struktural</label>
              <input type="number" id="edit_tunj_struktural" value="${r.tunj_struktural || 0}" min="0" step="1000" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">T. Pengabdian</label>
              <input type="number" id="edit_tunj_pengabdian" value="${r.tunj_pengabdian || 0}" min="0" step="1000" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">T. Fungsional</label>
              <input type="number" id="edit_tunj_fungsional" value="${r.tunj_fungsional || 0}" min="0" step="1000" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">T. Pembina</label>
              <input type="number" id="edit_tunj_pembina" value="${r.tunj_pembina || 0}" min="0" step="1000" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">T. Pondok</label>
              <input type="number" id="edit_tunj_pondok" value="${r.tunj_pondok || 0}" min="0" step="1000" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">T. Transport</label>
              <input type="number" id="edit_tunj_transport" value="${r.tunj_transport || 0}" min="0" step="1000" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">T. Kedatangan (Tepat Waktu)</label>
              <input type="number" id="edit_tunj_tepat_waktu" value="${r.tunj_tepat_waktu || 0}" min="0" step="1000" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">T. Tidak Cepat Pulang</label>
              <input type="number" id="edit_tunj_tidak_cepat_pulang" value="${r.tunj_tidak_cepat_pulang || 0}" min="0" step="1000" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">T. Uang Makan</label>
              <input type="number" id="edit_tunj_uang_makan" value="${r.tunj_uang_makan || 0}" min="0" step="1000" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">KJM</label>
              <input type="number" id="edit_tunj_kjm" value="${r.tunj_kjm || 0}" min="0" step="1000" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">T. Prestasi Kinerja</label>
              <input type="number" id="edit_tunj_prestasi_kinerja" value="${r.tunj_prestasi_kinerja || 0}" min="0" step="1000" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">T. Apresiasi</label>
              <input type="number" id="edit_tunj_apresiasi" value="${r.tunj_apresiasi || 0}" min="0" step="1000" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">T. Jam Mengajar</label>
              <input type="number" id="edit_tunj_jam_mengajar" value="${r.tunj_jam_mengajar || 0}" min="0" step="1000" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">Pot. Luar Tanggungan</label>
              <input type="number" id="edit_potong_cuti_luar_tanggungan" value="${r.potong_cuti_luar_tanggungan || 0}" min="0" step="1000" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">Pot. SIM-T</label>
              <input type="number" id="edit_potong_simt" value="${r.potong_simt || 0}" min="0" step="1000" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">Pot. Ta'awun</label>
              <input type="number" id="edit_potong_taawun" value="${r.potong_taawun || 0}" min="0" step="1000" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">Pot. Piutang</label>
              <input type="number" id="edit_potong_pinjaman" value="${r.potong_pinjaman || 0}" min="0" step="1000" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
          </div>
          
          <div class="bg-gray-50 p-3 rounded text-sm">
            <div class="grid grid-cols-4 gap-2 text-xs">
              <span class="text-gray-500">Total A</span> <span class="font-bold text-blue-600" id="edit_total_a">${fmtRp(r.total_a)}</span>
              <span class="text-gray-500">Total B</span> <span class="font-bold text-emerald-600" id="edit_total_b">${fmtRp(r.total_b)}</span>
              <span class="text-gray-500">Total C</span> <span class="font-bold text-red-600" id="edit_total_c">${fmtRp(r.total_c)}</span>
              <span class="text-gray-500">Total</span> <span class="font-bold text-yellow-600" id="edit_total_pendapatan">${fmtRp(r.total_pendapatan)}</span>
            </div>
          </div>
          
          <div class="flex justify-end gap-2 pt-2 border-t">
            <button onclick="closeKafalahEditModal()" class="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400">Batal</button>
            <button onclick="saveKafalahManualEdit()" class="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"><i class="fas fa-save mr-1"></i>Simpan</button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  
  // Auto-calculate totals on input change
  const inputs = document.querySelectorAll('#kafalahEditModal input[type="number"]');
  inputs.forEach(input => {
    input.addEventListener('input', recalcKafalahEditTotals);
  });
};

window.closeKafalahEditModal = function () {
  const modal = document.querySelector('.fixed.inset-0.z-50 .bg-white.rounded-xl:has(#edit_kafalah_pokok)');
  if (modal) modal.closest('.fixed.inset-0').remove();
  kafalahEditIndex = -1;
};

function recalcKafalahEditTotals() {
  const get = (id) => parseFloat(document.getElementById(id)?.value) || 0;
  const totalA = get('edit_kafalah_pokok') + get('edit_tunj_keluarga_istri') + get('edit_tunj_keluarga_anak');
  const totalB = get('edit_tunj_struktural') + get('edit_tunj_pengabdian') + get('edit_tunj_fungsional')
    + get('edit_tunj_pembina') + get('edit_tunj_pondok') + get('edit_tunj_transport')
    + get('edit_tunj_tepat_waktu') + get('edit_tunj_tidak_cepat_pulang') + get('edit_tunj_kjm')
    + get('edit_tunj_prestasi_kinerja') + get('edit_tunj_apresiasi')
    + get('edit_tunj_uang_makan') + get('edit_tunj_jam_mengajar');
  const totalC = get('edit_potong_cuti_luar_tanggungan') + get('edit_potong_simt')
    + get('edit_potong_taawun') + get('edit_potong_pinjaman');
  const total = totalA + totalB - totalC;
  document.getElementById('edit_total_a').textContent = fmtRp(totalA);
  document.getElementById('edit_total_b').textContent = fmtRp(totalB);
  document.getElementById('edit_total_c').textContent = fmtRp(totalC);
  document.getElementById('edit_total_pendapatan').textContent = fmtRp(total);
}

window.saveKafalahManualEdit = async function () {
  if (kafalahEditIndex < 0) return;
  const r = kafalahPreviewData[kafalahEditIndex];
  if (!r || !r.teacher_id) { showToast('Data tidak valid', 'error'); return; }
  
  const tenantId = document.getElementById('kafalahTenantSelect').value;
  const period = getKafalahPeriod();
  if (!period) { showToast('Pilih bulan', 'error'); return; }
  const { start, end } = period;
  
  const historyRes = await fetch('/api/kafalah/history?' + new URLSearchParams({
    tenant_id: tenantId,
    periode_mulai: start,
    periode_selesai: end
  }), { headers: getAuthHeader() });
  
  const historyJson = await historyRes.json();
  let payrollId = null;
  if (historyJson.success && historyJson.data) {
    const match = historyJson.data.find(h => h.teacher_id === kafalahPreviewData[kafalahEditIndex].teacher_id);
    if (match) payrollId = match.id;
  }
  
  if (!payrollId) { showToast('Tidak menemukan slip di database untuk diedit', 'error'); return; }
  
  const fields = {};
  const inputs = document.querySelectorAll('#kafalahEditModal input[type="number"]');
  inputs.forEach(input => {
    const key = input.id.replace('edit_', '');
    fields[key] = parseFloat(input.value) || 0;
  });
  
  try {
    const res = await fetch('/api/kafalah/save-manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ payroll_id: payrollId, fields })
    });
    const json = await res.json();
    if (json.success) {
      showToast('Edit manual tersimpan', 'success');
      closeKafalahEditModal();
      // Update preview data
      kafalahPreviewData[kafalahEditIndex] = { ...kafalahPreviewData[kafalahEditIndex], ...fields };
      recalcKafalahEditTotals();
      renderKafalahTable(kafalahPreviewData);
      renderKafalahSummary(kafalahPreviewData);
    } else {
      showToast(json.message || 'Gagal simpan', 'error');
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
};

// ============================================================
// Custom Override Modal (from Preview Table)
// ============================================================

let kafalahOverrideTeacherId = null;

window.openKafalahOverrideModal = async function (teacherId, teacherName) {
  kafalahOverrideTeacherId = teacherId;
  const tenantId = getKafalahTenantId();
  if (!tenantId) { showToast('Pilih sekolah dulu', 'error'); return; }

  // Fetch current override
  let ov = {};
  try {
    const res = await fetch('/api/kafalah/overrides?tenant_id=' + encodeURIComponent(tenantId), { headers: getAuthHeader() });
    const json = await res.json();
    if (json.success && json.data && json.data[teacherId]) ov = json.data[teacherId];
  } catch (e) {}

  const modalHtml = `
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" id="kafalahOverrideModal">
      <div class="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div class="flex justify-between items-center p-4 border-b sticky top-0 bg-white z-10">
          <h4 class="font-semibold text-lg">Custom KAFALAH: ${teacherName}</h4>
          <button onclick="closeKafalahOverrideModal()" class="text-gray-500 hover:text-gray-700 text-2xl leading-none">&times;</button>
        </div>
        <div class="p-4 space-y-4">
          <div class="bg-gray-50 p-3 rounded text-sm">
            <div class="flex items-center gap-2">
              <input type="checkbox" id="overrideIsActive" ${ov.is_active ? 'checked' : ''} onchange="toggleOverrideFields()">
              <label class="font-medium text-gray-700 cursor-pointer">Aktifkan Custom KAFALAH untuk guru ini</label>
            </div>
            <p class="text-xs text-gray-500 mt-1 ml-6">Kosongkan field untuk gunakan standar sekolah/pusat</p>
          </div>
          
          <div id="overrideFieldsContainer" style="display: ${ov.is_active ? 'block' : 'none'};">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              ${OVERRIDE_FIELDS.map(f => {
                const label = OVERRIDE_DISPLAY[f] || f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                const value = ov[f] !== null && ov[f] !== undefined ? ov[f] : '';
                return `
                  <div>
                    <label class="block text-xs font-medium text-gray-600 mb-1">${label}</label>
                    <input type="number" name="${f}" value="${value || ''}" step="1000" min="0" 
                      class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm ${ov[f] === null || ov[f] === undefined ? 'bg-gray-50' : ''}"
                      placeholder="Kosong = standar">
                  </div>
                `;
              }).join('')}
            </div>
          </div>
          
          <div class="flex justify-end gap-2 pt-2 border-t">
            <button onclick="closeKafalahOverrideModal()" class="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400">Batal</button>
            <button onclick="saveKafalahOverride()" class="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"><i class="fas fa-save mr-1"></i>Simpan Custom</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
};

window.closeKafalahOverrideModal = function () {
  const modal = document.getElementById('kafalahOverrideModal');
  if (modal) modal.remove();
  kafalahOverrideTeacherId = null;
};

window.toggleOverrideFields = function () {
  const active = document.getElementById('overrideIsActive').checked;
  document.getElementById('overrideFieldsContainer').style.display = active ? 'block' : 'none';
};

window.saveKafalahOverride = async function () {
  if (!kafalahOverrideTeacherId) return;
  const tenantId = getKafalahTenantId();
  const isActive = document.getElementById('overrideIsActive').checked;

  const fields = { is_active: isActive ? 1 : 0 };
  document.querySelectorAll('#overrideFieldsContainer input[name]').forEach(input => {
    const val = input.value.trim();
    if (val !== '') fields[input.name] = parseFloat(val);
  });

  try {
    const res = await fetch('/api/kafalah/overrides/' + kafalahOverrideTeacherId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ ...fields, tenant_id: tenantId })
    });
    const json = await res.json();
    if (json.success) {
      showToast('Custom KAFALAH tersimpan', 'success');
      closeKafalahOverrideModal();
      // Refresh preview to show updated values
      previewKafalah();
    } else showToast(json.message || 'Gagal', 'error');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
};

function renderKafalahTable(rows) {
  const tbody = document.getElementById('kafalahTable');
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="27" class="text-center py-6">Tidak ada data guru</td></tr>'; return; }
  
  // Get overrides for badge display
  const tenantId = getKafalahTenantId();
  let overrides = {};
  if (tenantId) {
    try {
      const res = await fetch('/api/kafalah/overrides?tenant_id=' + encodeURIComponent(tenantId), { headers: getAuthHeader() });
      const json = await res.json();
      if (json.success && json.data) overrides = json.data;
    } catch (e) {}
  }
  
  tbody.innerHTML = rows.map((r, i) => {
    const ov = overrides[r.teacher_id] || {};
    const isCustom = ov.is_active && Object.keys(ov).some(k => k !== 'is_active' && k !== 'teacher_id' && k !== 'tenant_id' && k !== 'updated_at' && ov[k] !== null);
    return `
    <tr class="hover:bg-gray-50 cursor-pointer" onclick="openKafalahDetailModal(${i})">
      <td class="px-2 py-1">${i + 1}</td>
      <td class="px-2 py-1 font-medium">${kafalahEsc(r.nama)} ${isCustom ? '<span class="ml-1 text-xs bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">Custom</span>' : ''}</td>
      <td class="px-2 py-1">${kafalahEsc(r.nik) || '-'}</td>
      <td class="px-2 py-1">${kafalahEsc(r.status_pegawai)}</td>
      <td class="px-2 py-1">${kafalahEsc(r.jabatan) || '-'}</td>
      <td class="px-2 py-1 text-right">${fmtRp(r.kafalah_pokok)}</td>
      <td class="px-2 py-1 text-right">${fmtRp(r.tunj_keluarga_istri)}</td>
      <td class="px-2 py-1 text-right">${fmtRp(r.tunj_keluarga_anak)}</td>
      <td class="px-2 py-1 text-right bg-blue-50 font-medium">${fmtRp(r.total_a)}</td>
      <td class="px-2 py-1 text-right">${fmtRp(r.tunj_struktural)}</td>
      <td class="px-2 py-1 text-right">${fmtRp(r.tunj_fungsional)}</td>
      <td class="px-2 py-1 text-right">${fmtRp(r.tunj_transport)}</td>
      <td class="px-2 py-1 text-right">${fmtRp(r.tunj_tepat_waktu)}</td>
      <td class="px-2 py-1 text-right">${fmtRp(r.tunj_tidak_cepat_pulang)}</td>
      <td class="px-2 py-1 text-right">${fmtRp(r.tunj_uang_makan)}</td>
      <td class="px-2 py-1 text-right">${fmtRp(r.tunj_kjm)}</td>
      <td class="px-2 py-1 text-right">${fmtRp(r.tunj_prestasi_kinerja)}</td>
      <td class="px-2 py-1 text-right">${fmtRp(r.tunj_apresiasi)}</td>
      <td class="px-2 py-1 text-right">${fmtRp(r.tunj_pembina)}</td>
      <td class="px-2 py-1 text-right">${fmtRp(r.tunj_jam_mengajar)}</td>
      <td class="px-2 py-1 text-right bg-emerald-50 font-medium">${fmtRp(r.total_b)}</td>
      <td class="px-2 py-1 text-right bg-red-50">${fmtRp(r.potong_cuti_luar_tanggungan || 0)}</td>
      <td class="px-2 py-1 text-right bg-red-50">${fmtRp(r.potong_simt || 0)}</td>
      <td class="px-2 py-1 text-right bg-red-50">${fmtRp(r.potong_taawun || 0)}</td>
      <td class="px-2 py-1 text-right bg-red-50">${fmtRp(r.potong_pinjaman || 0)}</td>
      <td class="px-2 py-1 text-right bg-yellow-50 font-bold">${fmtRp(r.total_pendapatan)}</td>
      <td class="px-2 py-2 text-center">
        <button onclick="event.stopPropagation(); openKafalahEditModal(${i})" class="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"><i class="fas fa-edit mr-1"></i>Edit</button>
        <button onclick="event.stopPropagation(); openKafalahOverrideModal(${r.teacher_id}, '${kafalahEsc(r.nama)}')" class="text-xs px-2 py-1 ml-1 bg-emerald-600 text-white rounded hover:bg-emerald-700"><i class="fas fa-user-cog mr-1"></i>Custom</button>
      </td>
    </tr>`;
  }).join('');
}

function renderKafalahSummary(rows) {
  const summary = document.getElementById('kafalahSummary');
  let wajib = 0, insentif = 0, potong = 0, total = 0;
  rows.forEach(r => {
    wajib += parseFloat(r.total_a) || 0;
    insentif += parseFloat(r.total_b) || 0;
    potong += parseFloat(r.total_c) || 0;
    total += parseFloat(r.total_pendapatan) || 0;
  });
  document.getElementById('kSumWajib').textContent = fmtRp(wajib);
  document.getElementById('kSumInsentif').textContent = fmtRp(insentif);
  document.getElementById('kSumPotong').textContent = fmtRp(potong);
  document.getElementById('kSumTotal').textContent = fmtRp(total);
  summary.classList.remove('hidden');
}

window.updateKafalahRow = function (idx, field, value) {
  const r = kafalahPreviewData[idx];
  if (!r) return;
  const v = parseFloat(value) || 0;
  r[field] = v;
  // Recompute totals
  if (field === 'tunj_struktural' || field === 'tunj_apresiasi') {
    r.total_b = (r.tunj_struktural||0) + (r.tunj_pengabdian||0) + (r.tunj_fungsional||0)
      + (r.tunj_pembina||0) + (r.tunj_pondok||0) + (r.tunj_transport||0)
      + (r.tunj_tepat_waktu||0) + (r.tunj_tidak_cepat_pulang||0)
      + (r.tunj_kjm||0) + (r.tunj_prestasi_kinerja||0) + (r.tunj_apresiasi||0)
      + (r.tunj_uang_makan||0) + (r.tunj_jam_mengajar||0);
  }
  if (field === 'total_c') {
    r.potong_taawun = v; r.potong_simt = 0; r.potong_pinjaman = 0; r.potong_cuti_luar_tanggungan = 0;
  }
  r.total_c = (r.potong_taawun||0) + (r.potong_simt||0) + (r.potong_pinjaman||0) + (r.potong_cuti_luar_tanggungan||0);
  r.total_pendapatan = (r.total_a||0) + (r.total_b||0) - (r.total_c||0);
  renderKafalahTable(kafalahPreviewData);
  renderKafalahSummary(kafalahPreviewData);
};

window.generateKafalah = async function () {
  if (!kafalahPreviewData.length) { showToast('Hitung preview dulu', 'error'); return; }
  const tenantId = document.getElementById('kafalahTenantSelect').value;
  const period = getKafalahPeriod();
  if (!period) { showToast('Pilih bulan', 'error'); return; }
  const { start, end, label } = period;
  if (!confirm(`Simpan ${kafalahPreviewData.length} slip KAFALAH untuk ${label}?`)) return;
  try {
    // First check if any records already exist in DB for this period
    const teacherIds = kafalahPreviewData.map(r => r.teacher_id).filter(id => id);
    const checkRes = await fetch('/api/kafalah/history?' + new URLSearchParams({
      tenant_id: tenantId,
      periode_mulai: start,
      periode_selesai: end
    }), { headers: getAuthHeader() });
    const checkJson = await checkRes.json();
    let existingCount = 0;
    if (checkJson.success && checkJson.data) {
      existingCount = checkJson.data.filter(r => teacherIds.includes(r.teacher_id)).length;
    }
    if (existingCount > 0) {
      if (!confirm(`${existingCount} guru sudah punya slip di periode ini. Tetap simpan (akan overwrite)?`)) return;
    }
    const res = await fetch('/api/kafalah/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({
        tenant_id: tenantId,
        periode_mulai: start,
        periode_selesai: end,
        label_periode: label
      })
    });
    const json = await res.json();
    if (json.success) { showToast(json.message, 'success'); kafalahPreviewData = []; }
    else showToast(json.message || 'Gagal', 'error');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
};

window.regenerateKafalah = async function () {
  if (!kafalahPreviewData.length) { showToast('Hitung preview dulu', 'error'); return; }
  const tenantId = document.getElementById('kafalahTenantSelect').value;
  const period = getKafalahPeriod();
  if (!period) { showToast('Pilih bulan', 'error'); return; }
  const { start, end, label } = period;
  if (!confirm(`PERINGATAN: Akan menghapus dan menghitung ulang SEMUA slip untuk ${label}. Lanjutkan?`)) return;
  try {
    const teacherIds = kafalahPreviewData.map(r => r.teacher_id).filter(id => id);
    const res = await fetch('/api/kafalah/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({
        teacher_ids: teacherIds,
        tenant_id: tenantId,
        periode_mulai: start,
        periode_selesai: end,
        label_periode: label
      })
    });
    const json = await res.json();
    if (json.success) { 
      showToast(json.message, 'success'); 
      kafalahPreviewData = json.data || [];
      renderKafalahTable(kafalahPreviewData);
      renderKafalahSummary(kafalahPreviewData);
    } else showToast(json.message || 'Gagal', 'error');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
};

// ============================================================
// Export & History
// ============================================================

window.exportKafalahExcel = function () {
  if (!kafalahPreviewData.length) { showToast('Tidak ada data', 'error'); return; }
  const tenantName = document.getElementById('kafalahTenantSelect').selectedOptions[0]?.text || 'Semua';
  const period = getKafalahPeriod();
  if (!period) { showToast('Pilih bulan', 'error'); return; }
  const { start, end, label } = period;
  const headers = ['No','Nama','NIK','Status','Jabatan','Kafalah Pokok','T. Keluarga (Istri)','T. Keluarga (Anak)','Total A','T. Struktural','T. Fungsional','T. Transportasi','T. Kedatangan','T. Tidak Pulang Cepat','T. Uang Makan','KJM','T. Prestasi Kinerja','T. Apresiasi','T. Pembina','T. Jam Mengajar','Total B','Pemotongan Luar Tanggungan','Durasi SIM-T',"Ta'awun",'Piutang','TOTAL KAFALAH'];
  const data = kafalahPreviewData.map((r, i) => ({
    'No': i+1, 'Nama': r.nama, 'NIK': r.nik||'', 'Status': r.status_pegawai, 'Jabatan': r.jabatan||'',
    'Kafalah Pokok': r.kafalah_pokok, 'T. Keluarga (Istri)': r.tunj_keluarga_istri, 'T. Keluarga (Anak)': r.tunj_keluarga_anak, 'Total A': r.total_a,
    'T. Struktural': r.tunj_struktural, 'T. Fungsional': r.tunj_fungsional, 'T. Transportasi': r.tunj_transport,
    'T. Kedatangan': r.tunj_tepat_waktu, 'T. Tidak Pulang Cepat': r.tunj_tidak_cepat_pulang, 'T. Uang Makan': r.tunj_uang_makan,
    'KJM': r.tunj_kjm, 'T. Prestasi Kinerja': r.tunj_prestasi_kinerja, 'T. Apresiasi': r.tunj_apresiasi,
    'T. Pembina': r.tunj_pembina, 'T. Jam Mengajar': r.tunj_jam_mengajar, 'Total B': r.total_b,
    'Pemotongan Luar Tanggungan': r.potong_cuti_luar_tanggungan || 0, 'Durasi SIM-T': r.potong_simt || 0,
    "Ta'awun": r.potong_taawun || 0, 'Piutang': r.potong_pinjaman || 0, 'TOTAL KAFALAH': r.total_pendapatan
  }));
  const ws = XLSX.utils.json_to_sheet(data, { header: headers });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Kafalah ' + tenantName);
  XLSX.writeFile(wb, 'KAFALAH_' + tenantName.replace(/\s/g,'_') + '_' + start + '_' + end + '.xlsx');
};

window.loadKafalahHistory = async function () {
  const tenantId = document.getElementById('kafalahTenantSelect').value;
  const period = getKafalahPeriod();
  if (!period) { showToast('Pilih bulan', 'error'); return; }
  const { start, end } = period;
  const tbody = document.getElementById('kafalahTable');
  tbody.innerHTML = '<tr><td colspan="26" class="text-center py-6"><i class="fas fa-spinner fa-spin"></i> Memuat history...</td></tr>';
  try {
    const params = new URLSearchParams();
    if (tenantId) params.set('tenant_id', tenantId);
    if (start) params.set('periode_mulai', start);
    if (end) params.set('periode_selesai', end);
    const res = await fetch('/api/kafalah/history?' + params.toString(), { headers: getAuthHeader() });
    const json = await res.json();
    if (!json.success) { tbody.innerHTML = '<tr><td colspan="26" class="text-center text-red-500">' + json.message + '</td></tr>'; return; }
    kafalahPreviewData = (json.data || []).map(r => ({
      ...r,
      teacher_id: r.teacher_id,
      kafalah_pokok: parseFloat(r.kafalah_pokok) || 0,
      tunj_keluarga_istri: parseFloat(r.tunj_keluarga_istri) || 0,
      tunj_keluarga_anak: parseFloat(r.tunj_keluarga_anak) || 0,
      total_a: parseFloat(r.total_a) || 0,
      tunj_struktural: parseFloat(r.tunj_struktural) || 0,
      tunj_pengabdian: parseFloat(r.tunj_pengabdian) || 0,
      tunj_fungsional: parseFloat(r.tunj_fungsional) || 0,
      tunj_pembina: parseFloat(r.tunj_pembina) || 0,
      tunj_pondok: parseFloat(r.tunj_pondok) || 0,
      tunj_transport: parseFloat(r.tunj_transport) || 0,
      tunj_tepat_waktu: parseFloat(r.tunj_tepat_waktu) || 0,
      tunj_tidak_cepat_pulang: parseFloat(r.tunj_tidak_cepat_pulang) || 0,
      tunj_kjm: parseFloat(r.tunj_kjm) || 0,
      tunj_uang_makan: parseFloat(r.tunj_uang_makan) || 0,
      tunj_jam_mengajar: parseFloat(r.tunj_jam_mengajar) || 0,
      tunj_prestasi_kinerja: parseFloat(r.tunj_prestasi_kinerja) || 0,
      tunj_apresiasi: parseFloat(r.tunj_apresiasi) || 0,
      total_b: parseFloat(r.total_b) || 0,
      potong_taawun: parseFloat(r.potong_taawun) || 0,
      potong_simt: parseFloat(r.potong_simt) || 0,
      potong_pinjaman: parseFloat(r.potong_pinjaman) || 0,
      potong_cuti_luar_tanggungan: parseFloat(r.potong_cuti_luar_tanggungan) || 0,
      total_c: parseFloat(r.total_c) || 0,
      total_pendapatan: parseFloat(r.total_pendapatan) || 0
    }));
    renderKafalahTable(kafalahPreviewData);
    renderKafalahSummary(kafalahPreviewData);
    showToast(`${kafalahPreviewData.length} slip dimuat dari history`, 'info');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="26" class="text-center text-red-500">' + e.message + '</td></tr>';
  }
};

// ============================================================
// Guru Khusus / Individual Override Functions
// ============================================================

// Override fields list (matching backend OVERRIDE_FIELDS)
const OVERRIDE_FIELDS = [
  'tunj_struktural', 'tunj_pembina', 'tunj_pondok', 'tunj_apresiasi',
  'tunj_transport', 'tunj_tepat_waktu', 'tunj_tidak_cepat_pulang',
  'tunj_uang_makan', 'tunj_fungsional', 'tunj_prestasi_kinerja',
  'tunj_jam_mengajar', 'tunj_istri', 'tunj_anak', 'nominal_kjm',
  'pot_luar_tanggungan', 'pot_durasi_simt', 'pot_taawun', 'pot_piutang'
];

// Field display names for table headers
const OVERRIDE_DISPLAY = {
  tunj_struktural: 'Struktural',
  tunj_transport: 'Transport',
  tunj_tepat_waktu: 'Kedatangan',
  tunj_tidak_cepat_pulang: 'Tidak Cepat Pulang',
  tunj_uang_makan: 'Uang Makan',
  tunj_fungsional: 'Fungsional',
  tunj_prestasi_kinerja: 'Prestasi',
  tunj_apresiasi: 'Apresiasi',
  tunj_jam_mengajar: 'Jam Mengajar',
  tunj_pembina: 'Pembina',
  tunj_pondok: 'Pondok',
  tunj_istri: 'Istri',
  tunj_anak: 'Anak',
  nominal_kjm: 'KJM/jam',
  pot_luar_tanggungan: 'Pot. Luar Tanggungan',
  pot_durasi_simt: 'Pot. SIM-T',
  pot_taawun: 'Pot. Ta\'awun',
  pot_piutang: 'Pot. Piutang'
};

// ============================================================
// WhatsApp
// ============================================================

window.sendKafalahWhatsApp = async function (mode) {
  if (!kafalahPreviewData.length) { showToast('Hitung preview dulu', 'error'); return; }
  const tenantId = document.getElementById('kafalahTenantSelect').value;
  const period = getKafalahPeriod();
  if (!tenantId || !period) { showToast('Pilih sekolah & bulan dulu', 'error'); return; }
  const { start, end, label } = period;
  
  // Mode parameter removed - backend auto-resolves from tenant level
  if (!confirm(`Kirim slip KAFALAH ke WhatsApp untuk ${kafalahPreviewData.length} guru?\nPeriode: ${label}`)) return;
  
  // Get teacher IDs from preview data
  const teacherIds = kafalahPreviewData.map(r => r.teacher_id).filter(id => id);
  if (!teacherIds.length) { showToast('Tidak ada data guru valid', 'error'); return; }
  
  try {
    const res = await fetch('/api/kafalah/send-slip-whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ teacher_ids: teacherIds, tenant_id: tenantId, periode_mulai: start, periode_selesai: end })
    });
    const json = await res.json();
    if (json.success) {
      showToast(json.message, 'success');
    } else {
      showToast(json.message || 'Gagal kirim', 'error');
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
};