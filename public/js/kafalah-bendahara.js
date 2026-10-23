// ============================================================
// KAFALAH - Client logic untuk Bendahara Dashboard
// ============================================================

let kafalahPreviewData = [];

// Escape HTML so teacher-supplied values (nama, nik, jabatan, ...) cannot
// inject markup/script when written into innerHTML.
function kafalahEsc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Resolve tenant id used by KAFALAH settings/override UI.
// Prefers an explicit argument, then the settings-tab selector, then the KAFALAH tab selector.
function getKafalahTenantId(explicit) {
  if (explicit) return explicit;
  const el = document.getElementById('kafalahSettingsTenantSelect') ||
             document.getElementById('kafalahTenantSelect');
  return el ? el.value : '';
}

window.loadKafalahSettings = async function (tenantId) {
  try {
    // Get selected base mode from toggle switch
    const toggleEl = document.getElementById('kafalahBaseToggle');
    const isSekolah = toggleEl ? toggleEl.checked : false;
    const baseMode = isSekolah ? 'sekolah' : 'pusat';
    
    // Resolve tenant from argument or any available selector
    const selectedTenant = getKafalahTenantId(tenantId);
    
    // Only apply tenant scope when the user chose "Sekolah" mode and a school is selected.
    // Otherwise fall back to global settings.
    const effectiveTenantId = (isSekolah && selectedTenant) ? selectedTenant : null;
    
    const url = effectiveTenantId 
      ? '/api/kafalah/settings/tenant?tenant_id=' + encodeURIComponent(effectiveTenantId)
      : '/api/kafalah/settings';
    const res = await fetch(url, { headers: getAuthHeader() });
    const json = await res.json();
    if (!json.success) return;
    const s = json.data || {};
    
    // Update info text
    const infoEl = document.getElementById('kafalahSettingsInfo');
    if (infoEl) {
      if (isSekolah && effectiveTenantId) {
        const sel = document.getElementById('kafalahSettingsTenantSelect') || document.getElementById('kafalahTenantSelect');
        infoEl.innerHTML = '<i class="fas fa-info-circle mr-1"></i> Pengaturan ini berlaku untuk <b>' + (sel?.selectedOptions[0]?.text || 'sekolah ini') + '</b>. Bisa diubah sewaktu-waktu.';
      } else if (isSekolah && !effectiveTenantId) {
        infoEl.innerHTML = '<i class="fas fa-warning mr-1 text-amber-600"></i> Mode <b>Sekolah</b> dipilih, tetapi belum ada sekolah yang dipilih. Pilih sekolah terlebih dahulu — sementara ini menampilkan pengaturan <b>GLOBAL</b>.';
      } else {
        infoEl.innerHTML = '<i class="fas fa-info-circle mr-1"></i> Pengaturan komponen KAFALAH ini berlaku <b>GLOBAL</b> untuk semua unit. Bisa diubah sewaktu-waktu, namun tidak akan mengubah slip yang sudah tersimpan.';
      }
    }
    
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
    setVal('ksTunjJamMengajar', s.tunj_jam_mengajar);
    setVal('ksTunjIstri', s.tunj_istri);
    setVal('ksTunjAnak', s.tunj_anak);
    setVal('ksPotLuarTanggungan', s.pot_luar_tanggungan);
    setVal('ksPotDurasiSimt', s.pot_durasi_simt);
    setVal('ksPotTaawun', s.pot_taawun);
    setVal('ksPotPiutang', s.pot_piutang);
    
    // Load teacher overrides after settings
    loadTeacherOverrides();
  } catch (e) { console.error(e); }
};

function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v || 0; }

window.saveKafalahSettings = async function (e) {
  e.preventDefault();
  const tenantId = getKafalahTenantId();
  const toggleEl = document.getElementById('kafalahBaseToggle');
  const isSekolah = toggleEl ? toggleEl.checked : false;
  
  // For central admin: if sekolah mode but no tenant selected, show error
  if (isSekolah && !tenantId) {
    showToast('Pilih sekolah terlebih dahulu untuk mode Sekolah', 'error');
    return;
  }
  
  const fields = ['tunj_struktural','tunj_pengabdian','tunj_fungsional','tunj_transport','tunj_tepat_waktu','tunj_tidak_cepat_pulang','tunj_uang_makan','nominal_kjm','tunj_prestasi_kinerja','tunj_apresiasi','tunj_pembina','tunj_pondok','tunj_jam_mengajar','tunj_istri','tunj_anak','pot_luar_tanggungan','pot_durasi_simt','pot_taawun','pot_piutang'];
  const body = {};
  fields.forEach(f => {
    const el = document.getElementById('ks' + f.split('_').map(s => s[0].toUpperCase() + s.slice(1)).join(''));
    if (el) body[f] = parseFloat(el.value || 0);
  });
  if (isSekolah && tenantId) body.tenant_id = tenantId;
  
  const endpoint = isSekolah ? '/api/kafalah/settings/tenant' : '/api/kafalah/settings';
  try {
    const res = await fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(body)
    });
    const json = await res.json();
    if (json.success) {
      showToast('Pengaturan KAFALAH tersimpan', 'success');
      document.getElementById('ksSavedInfo').textContent = 'Tersimpan ' + new Date().toLocaleTimeString('id-ID');
    } else showToast(json.message || 'Gagal', 'error');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
};

window.loadKafalahMatrix = async function () {
  // alias ke kenaikan (matrix baru)
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
  // Preview di th 0, 2, 5, 10, max
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

window.previewKafalah = async function () {
  const tenantId = document.getElementById('kafalahTenantSelect').value;
  const period = getKafalahPeriod();
  if (!tenantId || !period) { showToast('Pilih sekolah & bulan', 'error'); return; }
  const { start, end, label } = period;
  const baseMode = document.getElementById('kafalahBaseToggle')?.checked ? 'school' : 'global';
  const tbody = document.getElementById('kafalahTable');
  tbody.innerHTML = '<tr><td colspan="27" class="text-center py-6"><i class="fas fa-spinner fa-spin"></i> Menghitung...</td></tr>';
  try {
    const res = await fetch('/api/kafalah/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ tenant_id: tenantId, periode_mulai: start, periode_selesai: end, label_periode: label, base_mode: baseMode })
    });
    const json = await res.json();
    if (!json.success) { tbody.innerHTML = '<tr><td colspan="27" class="text-center text-red-500">' + json.message + '</td></tr>'; return; }
    kafalahPreviewData = json.data || [];
    renderKafalahTable(kafalahPreviewData);
    renderKafalahSummary(kafalahPreviewData);
    // Show mode badge
    const modeLabel = baseMode === 'global' ? 'Global (Pusat)' : 'Sekolah (Tenant)';
    showToast(`Mode: ${modeLabel} ${json.base_mode === 'global' ? '🌐' : '🏫'}`, 'info');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="27" class="text-center text-red-500">' + e.message + '</td></tr>';
  }
};

function formatPeriodeLabel(start, end) {
  const m = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const s = new Date(start), e = new Date(end);
  return s.getDate() + ' ' + m[s.getMonth()] + ' ' + s.getFullYear() + ' s/d ' + e.getDate() + ' ' + m[e.getMonth()] + ' ' + e.getFullYear();
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
// Manual Edit Modal Functions
// ============================================================

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
  
  // Check if data came from DB (has payroll_id)
  const checkRes = await fetch('/api/kafalah/history?' + new URLSearchParams({
    tenant_id: document.getElementById('kafalahTenantSelect').value,
    periode_mulai: document.getElementById('kafalahBulan').value.split('-')[0] + '-' + document.getElementById('kafalahBulan').value.split('-')[1] + '-01',
    periode_selesai: new Date(document.getElementById('kafalahBulan').value.split('-')[0], document.getElementById('kafalahBulan').value.split('-')[1], 0).toISOString().split('T')[0]
  }), { headers: getAuthHeader() });
  
  // We need the payroll_id from DB - try to find it
  const fields = {};
  const inputs = document.querySelectorAll('#kafalahEditModal input[type="number"]');
  inputs.forEach(input => {
    const key = input.id.replace('edit_', '');
    fields[key] = parseFloat(input.value) || 0;
  });
  
  // Find payroll_id by matching teacher_id and period
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

function renderKafalahTable(rows) {
  const tbody = document.getElementById('kafalahTable');
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="27" class="text-center py-6">Tidak ada data guru</td></tr>'; return; }
  tbody.innerHTML = rows.map((r, i) => `
    <tr class="hover:bg-gray-50">
      <td class="px-2 py-1">${i + 1}</td>
      <td class="px-2 py-1 font-medium">${kafalahEsc(r.nama)}</td>
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
        <button onclick="openKafalahEditModal(${i})" class="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"><i class="fas fa-edit mr-1"></i>Edit</button>
      </td>
    </tr>
  `).join('');
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
  const baseMode = document.getElementById('kafalahBaseToggle')?.checked ? 'school' : 'global';
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
        label_periode: label,
        base_mode: baseMode
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
  const baseMode = document.getElementById('kafalahBaseToggle')?.checked ? 'school' : 'global';
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
        label_periode: label,
        base_mode: baseMode
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
  if (!r) return;
  
  const fields = {};
  const inputs = document.querySelectorAll('#kafalahEditModal input[type="number"]');
  inputs.forEach(input => {
    const key = input.id.replace('edit_', '');
    fields[key] = parseFloat(input.value) || 0;
  });
  
  // Find payroll_id by matching teacher_id and period
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
      renderKafalahTable(kafalahPreviewData);
      renderKafalahSummary(kafalahPreviewData);
    } else {
      showToast(json.message || 'Gagal simpan', 'error');
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
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
// Individual Overrides Functions
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

window.loadTeacherOverrides = async function () {
  const tenantId = getKafalahTenantId();
  if (!tenantId) {
    document.getElementById('teacherOverridesTable').innerHTML = 
      '<tr><td colspan="22" class="px-4 py-6 text-center text-gray-500">Pilih sekolah terlebih dahulu</td></tr>';
    return;
  }
  
  const tbody = document.getElementById('teacherOverridesTable');
  tbody.innerHTML = '<tr><td colspan="22" class="px-4 py-6 text-center"><i class="fas fa-spinner fa-spin"></i> Memuat...</td></tr>';
  
  try {
    // Fetch teachers for this tenant
    const teachersRes = await fetch('/api/kafalah/teachers?tenant_id=' + encodeURIComponent(tenantId), { headers: getAuthHeader() });
    const teachersJson = await teachersRes.json();
    const teachers = teachersJson.data || [];
    
    // Fetch overrides — backend may return a keyed object { teacher_id: {...} } or an array
    const overridesRes = await fetch('/api/kafalah/overrides?tenant_id=' + encodeURIComponent(tenantId), { headers: getAuthHeader() });
    const overridesJson = await overridesRes.json();
    let overrides = overridesJson.data || {};
    // Normalize: convert array to keyed object if needed
    if (Array.isArray(overrides)) {
      const keyed = {};
      overrides.forEach(o => { keyed[o.teacher_id] = o; });
      overrides = keyed;
    }
    
    if (!teachers.length) {
      tbody.innerHTML = '<tr><td colspan="22" class="px-4 py-6 text-center text-gray-500">Tidak ada guru di sekolah ini</td></tr>';
      return;
    }
    
    tbody.innerHTML = teachers.map(t => {
      const ov = overrides[t.id] || {};
      const isActive = ov.is_active ? 'checked' : '';
      return `
        <tr class="hover:bg-gray-50" data-teacher-id="${t.id}">
          <td class="px-2 py-1 font-medium">${kafalahEsc(t.nama)}</td>
          <td class="px-2 py-2 text-center">
            <label class="flex items-center justify-center gap-1 cursor-pointer">
              <input type="checkbox" class="override-active" ${isActive} onchange="toggleOverrideRow(this, ${t.id})">
            </label>
          </td>
          ${OVERRIDE_FIELDS.map(f => `
            <td class="px-2 py-1">
              <input type="number" class="w-20 px-1 py-0.5 text-right border rounded text-xs override-input" 
                     data-field="${f}" 
                     value="${ov[f] !== null && ov[f] !== undefined ? ov[f] : ''}"
                     ${!ov.is_active ? 'disabled' : ''}>
            </td>
          `).join('')}
        </tr>
      `;
    }).join('');
  } catch (e) {
    console.error(e);
    tbody.innerHTML = '<tr><td colspan="22" class="px-4 py-6 text-center text-red-500">' + e.message + '</td></tr>';
  }
};

window.toggleAllOverrides = function (checkbox) {
  const rows = document.querySelectorAll('#teacherOverridesTable tr[data-teacher-id]');
  rows.forEach(row => {
    const activeCheckbox = row.querySelector('.override-active');
    const inputs = row.querySelectorAll('.override-input');
    activeCheckbox.checked = checkbox.checked;
    inputs.forEach(input => input.disabled = !checkbox.checked);
  });
};

window.toggleOverrideRow = function (checkbox, teacherId) {
  const row = checkbox.closest('tr');
  const inputs = row.querySelectorAll('.override-input');
  inputs.forEach(input => input.disabled = !checkbox.checked);
};

window.saveAllTeacherOverrides = async function () {
  const tenantId = getKafalahTenantId();
  if (!tenantId) { showToast('Pilih sekolah terlebih dahulu', 'error'); return; }
  
  const rows = document.querySelectorAll('#teacherOverridesTable tr[data-teacher-id]');
  if (!rows.length) { showToast('Tidak ada data guru', 'error'); return; }
  
  let savedCount = 0;
  for (const row of rows) {
    const teacherId = row.dataset.teacherId;
    const isActive = row.querySelector('.override-active').checked;
    
    const body = { tenant_id: tenantId, is_active: isActive ? 1 : 0 };
    let hasValue = false;
    
    row.querySelectorAll('.override-input').forEach(input => {
      const field = input.dataset.field;
      const val = input.value.trim();
      if (val !== '') {
        body[field] = parseFloat(val);
        hasValue = true;
      }
    });
    
    if (!isActive && !hasValue) continue; // Skip inactive with no values
    
    try {
      const res = await fetch('/api/kafalah/overrides/' + teacherId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (json.success) savedCount++;
    } catch (e) {
      console.error('Save override error:', e);
    }
  }
  
  if (savedCount > 0) {
    showToast(`${savedCount} override guru tersimpan`, 'success');
    loadTeacherOverrides(); // Reload to show updated state
  } else {
    showToast('Tidak ada perubahan', 'info');
  }
};

window.sendKafalahWhatsApp = async function (mode) {
  if (!kafalahPreviewData.length) { showToast('Hitung preview dulu', 'error'); return; }
  const tenantId = document.getElementById('kafalahTenantSelect').value;
  const period = getKafalahPeriod();
  if (!tenantId || !period) { showToast('Pilih sekolah & bulan dulu', 'error'); return; }
  const { start, end, label } = period;
  
  const modeLabel = mode === 'pusat' ? 'Pusat (Global + Override)' : 'Sekolah (Tenant + Override)';
  if (!confirm(`Kirim slip KAFALAH ke WhatsApp untuk ${kafalahPreviewData.length} guru?\nPeriode: ${label}\nMode: ${modeLabel}`)) return;
  
  // Get teacher IDs from preview data
  const teacherIds = kafalahPreviewData.map(r => r.teacher_id).filter(id => id);
  if (!teacherIds.length) { showToast('Tidak ada data guru valid', 'error'); return; }
  
  try {
    const res = await fetch('/api/kafalah/send-slip-whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({
        teacher_ids: teacherIds,
        tenant_id: tenantId,
        periode_mulai: start,
        periode_selesai: end,
        mode: mode
      })
    });
    const json = await res.json();
    if (json.success) {
      showToast(json.message, 'success');
      // Show detail results
      if (json.data && json.data.length) {
        const failed = json.data.filter(r => !r.sent).map(r => r.nama).join(', ');
        if (failed) showToast(`Gagal kirim ke: ${failed}`, 'warning');
      }
    } else {
      showToast(json.message || 'Gagal mengirim', 'error');
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
};

// Tab handler hook.
// The dashboard's inline tab switcher calls these when a tab is opened and when
// the tenant/base-mode selectors change, so the settings form and override table
// always reflect the current base mode (Pusat / Sekolah).
window.kafalahOnSettingsContextChange = function (explicitTenant) {
  const toggleEl = document.getElementById('kafalahBaseToggle');
  const isSekolah = toggleEl ? toggleEl.checked : false;
  const a = document.getElementById('kafalahSettingsTenantSelect');
  const b = document.getElementById('kafalahTenantSelect');

  // Keep both school selectors in sync so either tab shows the same selection.
  let tenant = explicitTenant || '';
  if (!tenant && a && a.value) tenant = a.value;
  if (!tenant && b && b.value) tenant = b.value;
  if (a && a.value !== tenant) a.value = tenant;
  if (b && b.value !== tenant) b.value = tenant;

  if (!isSekolah) {
    // Pusat mode: settings form shows global values (School scope ignored).
    loadKafalahSettings();
    return;
  }
  if (!tenant) {
    // Sekolah mode but no school picked yet: show global and prompt.
    loadKafalahSettings();
    return;
  }
  loadKafalahSettings(tenant);
  loadTeacherOverrides();
};

// Tab handler hook (legacy map kept for any external callers)
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    const tabMap = {
      kafalah: () => { loadKafalahSettings(getKafalahTenantId()); },
      paymentSettings: () => { loadKafalahSettings(); loadKafalahMatrix(); }
    };
    // expose for inline tab switcher
    window._kafalahTabHandlers = tabMap;
  });
})();
