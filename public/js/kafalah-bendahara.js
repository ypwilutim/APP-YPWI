// ============================================================
// KAFALAH - Client logic untuk Bendahara Dashboard
// ============================================================

let kafalahPreviewData = [];

window.loadKafalahSettings = async function () {
  try {
    const res = await fetch('/api/kafalah/settings', { headers: getAuthHeader() });
    const json = await res.json();
    if (!json.success) return;
    const s = json.data || {};
    setVal('ksTunjPengabdian', s.tunj_pengabdian);
    setVal('ksTunjFungsional', s.tunj_fungsional);
    setVal('ksTunjTransport', s.tunj_transport);
    setVal('ksTunjTepatWaktu', s.tunj_tepat_waktu);
    setVal('ksTunjTidakCepatPulang', s.tunj_tidak_cepat_pulang);
    setVal('ksTunjPrestasiKinerja', s.tunj_prestasi_kinerja);
    setVal('ksNominalKjm', s.nominal_kjm);
    setVal('ksTunjPembina', s.tunj_pembina);
    setVal('ksTunjPondok', s.tunj_pondok);
    setVal('ksTunjAnak', s.tunj_anak);
    setVal('ksTunjIstri', s.tunj_istri);
  } catch (e) { console.error(e); }
};

function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v || 0; }

window.saveKafalahSettings = async function (e) {
  e.preventDefault();
  const fields = ['tunj_pengabdian','tunj_fungsional','tunj_transport','tunj_tepat_waktu','tunj_tidak_cepat_pulang','tunj_prestasi_kinerja','nominal_kjm','tunj_pembina','tunj_pondok','tunj_anak','tunj_istri'];
  const body = {};
  fields.forEach(f => {
    const el = document.getElementById('ks' + f.split('_').map(s => s[0].toUpperCase() + s.slice(1)).join(''));
    if (el) body[f] = parseFloat(el.value || 0);
  });
  try {
    const res = await fetch('/api/kafalah/settings', {
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
  const start = document.getElementById('kafalahStart').value;
  const end = document.getElementById('kafalahEnd').value;
  if (!tenantId || !start || !end) { showToast('Pilih sekolah & periode', 'error'); return; }
  const tbody = document.getElementById('kafalahTable');
  tbody.innerHTML = '<tr><td colspan="23" class="text-center py-6"><i class="fas fa-spinner fa-spin"></i> Menghitung...</td></tr>';
  try {
    const res = await fetch('/api/kafalah/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ tenant_id: tenantId, periode_mulai: start, periode_selesai: end, label_periode: formatPeriodeLabel(start, end) })
    });
    const json = await res.json();
    if (!json.success) { tbody.innerHTML = '<tr><td colspan="23" class="text-center text-red-500">' + json.message + '</td></tr>'; return; }
    kafalahPreviewData = json.data || [];
    renderKafalahTable(kafalahPreviewData);
    renderKafalahSummary(kafalahPreviewData);
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="23" class="text-center text-red-500">' + e.message + '</td></tr>';
  }
};

function formatPeriodeLabel(start, end) {
  const m = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const s = new Date(start), e = new Date(end);
  return s.getDate() + ' ' + m[s.getMonth()] + ' ' + s.getFullYear() + ' s/d ' + e.getDate() + ' ' + m[e.getMonth()] + ' ' + e.getFullYear();
}

function renderKafalahTable(rows) {
  const tbody = document.getElementById('kafalahTable');
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="23" class="text-center py-6">Tidak ada data guru</td></tr>'; return; }
  tbody.innerHTML = rows.map((r, i) => `
    <tr class="hover:bg-gray-50">
      <td class="px-2 py-1">${i + 1}</td>
      <td class="px-2 py-1 font-medium">${r.nama}</td>
      <td class="px-2 py-1">${r.nik || '-'}</td>
      <td class="px-2 py-1">${r.status_pegawai}</td>
      <td class="px-2 py-1">${r.jabatan || '-'}</td>
      <td class="px-2 py-1 text-right">${fmtRp(r.kafalah_pokok)}</td>
      <td class="px-2 py-1 text-right">${fmtRp(r.tunj_keluarga_istri)}</td>
      <td class="px-2 py-1 text-right">${fmtRp(r.tunj_keluarga_anak)}</td>
      <td class="px-2 py-1 text-right bg-blue-50 font-medium">${fmtRp(r.total_a)}</td>
      <td class="px-2 py-1 text-right">
        <input type="number" value="${r.tunj_struktural}" min="0" step="50000" class="w-20 border rounded px-1 py-0.5 text-right text-xs" onchange="updateKafalahRow(${i},'tunj_struktural',this.value)" />
      </td>
      <td class="px-2 py-1 text-right">${fmtRp(r.tunj_pengabdian)}</td>
      <td class="px-2 py-1 text-right">${fmtRp(r.tunj_fungsional)}</td>
      <td class="px-2 py-1 text-right">${fmtRp(r.tunj_pembina)}</td>
      <td class="px-2 py-1 text-right">${fmtRp(r.tunj_pondok)}</td>
      <td class="px-2 py-1 text-right">${fmtRp(r.tunj_transport)}</td>
      <td class="px-2 py-1 text-right">${fmtRp(r.tunj_tepat_waktu)}</td>
      <td class="px-2 py-1 text-right">${fmtRp(r.tunj_tidak_cepat_pulang)}</td>
      <td class="px-2 py-1 text-right">${fmtRp(r.tunj_kjm)}</td>
      <td class="px-2 py-1 text-right">${fmtRp(r.tunj_prestasi_kinerja)}</td>
      <td class="px-2 py-1 text-right">
        <input type="number" value="${r.tunj_apresiasi}" min="0" step="50000" class="w-20 border rounded px-1 py-0.5 text-right text-xs" onchange="updateKafalahRow(${i},'tunj_apresiasi',this.value)" />
      </td>
      <td class="px-2 py-1 text-right bg-emerald-50 font-medium">${fmtRp(r.total_b)}</td>
      <td class="px-2 py-1 text-right bg-red-50">
        <input type="number" value="${r.potong_taawun + r.potong_simt + r.potong_pinjaman + r.potong_cuti_luar_tanggungan}" min="0" step="1000" class="w-20 border rounded px-1 py-0.5 text-right text-xs" onchange="updateKafalahRow(${i},'total_c',this.value)" />
      </td>
      <td class="px-2 py-1 text-right bg-yellow-50 font-bold">${fmtRp(r.total_pendapatan)}</td>
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
      + (r.tunj_kjm||0) + (r.tunj_prestasi_kinerja||0) + (r.tunj_apresiasi||0);
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
  const start = document.getElementById('kafalahStart').value;
  const end = document.getElementById('kafalahEnd').value;
  if (!confirm(`Simpan ${kafalahPreviewData.length} slip KAFALAH untuk periode ini?`)) return;
  try {
    const res = await fetch('/api/kafalah/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({
        tenant_id: tenantId,
        periode_mulai: start,
        periode_selesai: end,
        label_periode: formatPeriodeLabel(start, end),
        data: kafalahPreviewData
      })
    });
    const json = await res.json();
    if (json.success) { showToast(json.message, 'success'); kafalahPreviewData = []; }
    else showToast(json.message || 'Gagal', 'error');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
};

window.exportKafalahExcel = function () {
  if (!kafalahPreviewData.length) { showToast('Tidak ada data', 'error'); return; }
  const tenantName = document.getElementById('kafalahTenantSelect').selectedOptions[0]?.text || 'Semua';
  const start = document.getElementById('kafalahStart').value;
  const end = document.getElementById('kafalahEnd').value;
  const headers = ['No','Nama','NIK','Status','Jabatan','Jenjang','Pendidikan','MK','Anak','Kafalah Pokok','T. Istri','T. Anak','Total A','T. Struktural','T. Pengabdian','T. Fungsional','T. Pembina','T. Pondok','T. Transport','T. Tepat Waktu','T. Tdk Cepat Plg','T. KJM','T. Kinerja','T. Apresiasi','Total B','Potongan','TOTAL KAFALAH'];
  const data = kafalahPreviewData.map((r, i) => ({
    'No': i+1, 'Nama': r.nama, 'NIK': r.nik||'', 'Status': r.status_pegawai, 'Jabatan': r.jabatan||'',
    'Jenjang': r.jenjang, 'Pendidikan': r.pendidikan, 'MK': r.masa_kerja_tahun, 'Anak': r.jumlah_anak,
    'Kafalah Pokok': r.kafalah_pokok, 'T. Istri': r.tunj_keluarga_istri, 'T. Anak': r.tunj_keluarga_anak, 'Total A': r.total_a,
    'T. Struktural': r.tunj_struktural, 'T. Pengabdian': r.tunj_pengabdian, 'T. Fungsional': r.tunj_fungsional,
    'T. Pembina': r.tunj_pembina, 'T. Pondok': r.tunj_pondok, 'T. Transport': r.tunj_transport,
    'T. Tepat Waktu': r.tunj_tepat_waktu, 'T. Tdk Cepat Plg': r.tunj_tidak_cepat_pulang,
    'T. KJM': r.tunj_kjm, 'T. Kinerja': r.tunj_prestasi_kinerja, 'T. Apresiasi': r.tunj_apresiasi,
    'Total B': r.total_b, 'Potongan': r.total_c, 'TOTAL KAFALAH': r.total_pendapatan
  }));
  const ws = XLSX.utils.json_to_sheet(data, { header: headers });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Kafalah ' + tenantName);
  XLSX.writeFile(wb, 'KAFALAH_' + tenantName.replace(/\s/g,'_') + '_' + start + '_' + end + '.xlsx');
};

window.loadKafalahHistory = async function () {
  const tenantId = document.getElementById('kafalahTenantSelect').value;
  const start = document.getElementById('kafalahStart').value;
  const end = document.getElementById('kafalahEnd').value;
  const tbody = document.getElementById('kafalahTable');
  tbody.innerHTML = '<tr><td colspan="23" class="text-center py-6"><i class="fas fa-spinner fa-spin"></i> Memuat history...</td></tr>';
  try {
    const params = new URLSearchParams();
    if (tenantId) params.set('tenant_id', tenantId);
    if (start) params.set('periode_mulai', start);
    if (end) params.set('periode_selesai', end);
    const res = await fetch('/api/kafalah/history?' + params.toString(), { headers: getAuthHeader() });
    const json = await res.json();
    if (!json.success) { tbody.innerHTML = '<tr><td colspan="23" class="text-center text-red-500">' + json.message + '</td></tr>'; return; }
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
    tbody.innerHTML = '<tr><td colspan="23" class="text-center text-red-500">' + e.message + '</td></tr>';
  }
};

// Tab handler hook
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    const tabMap = {
      kafalah: () => { loadKafalahSettings(); },
      paymentSettings: () => { loadKafalahSettings(); loadKafalahMatrix(); }
    };
    // expose for inline tab switcher
    window._kafalahTabHandlers = tabMap;
  });
})();
