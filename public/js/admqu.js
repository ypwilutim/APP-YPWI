// ADMQU Page Logic
const API_BASE = '/api';
let authToken = getAuthToken();
let currentUser = null;
let currentTeacherId = null;
let currentTenantId = null;
let skPreviewData = null;

// Token helper for PWA context
function getAuthToken() {
  return localStorage.getItem('token') 
    || sessionStorage.getItem('token')
    || window.token
    || (window.opener && window.opener.localStorage && window.opener.localStorage.getItem('token'))
    || (window.parent && window.parent !== window && window.parent.localStorage && window.parent.localStorage.getItem('token'));
}

const SK_TYPE_LABELS = {
  'baru': 'Pengangkatan Guru Baru',
  'kembali': 'Pengangkatan Kembali Guru',
  'tetap_guru': 'Pengangkatan Guru Tetap',
  'kontrak_guru': 'Pengangkatan Guru Kontrak',
  'honorer_guru': 'Pengangkatan Guru Honor',
  'pimpinan': 'Pengangkatan Pimpinan'
};

const SK_TYPE_BADGES = {
  'baru': 'sk-type-baru',
  'kembali': 'sk-type-kembali',
  'tetap_guru': 'sk-type-tetap',
  'kontrak_guru': 'sk-type-kontrak',
  'honorer_guru': 'sk-type-honorer',
  'pimpinan': 'sk-type-tetap'
};

document.addEventListener('DOMContentLoaded', async () => {
  if (!authToken) {
    window.location.href = 'login.html';
    return;
  }

  loadUserInfo();
  initPage();
});

function loadUserInfo() {
  try {
    const payloadPart = authToken.split('.')[1];
    if (!payloadPart) return handleUnauthorized();
    const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(decodeURIComponent(escape(atob(base64))));
    if (!payload || !payload.id) return handleUnauthorized();

  // Check URL parameter for tenant_id
  const urlParams = new URLSearchParams(window.location.search);
  const urlTenantId = urlParams.get('tenant_id');

  currentUser = {
    id: payload.id,
    username: payload.username,
    role: payload.role,
    guru_id: payload.guru_id,
    tenant_id: payload.tenant_id,
    assignments: payload.assignments || []
  };

  // Determine tenantId: URL param > token tenant_id > first assignment
  let selectedTenantId = null;
  if (urlTenantId) {
    const valid = currentUser.assignments.some(a => a.tenant_id === urlTenantId);
    if (valid) selectedTenantId = urlTenantId;
  }
  if (!selectedTenantId) {
    selectedTenantId = currentUser.tenant_id || (currentUser.assignments[0]?.tenant_id || null);
  }
  currentTeacherId = currentUser.guru_id || (currentUser.assignments[0]?.teacher_id || null);
  currentTenantId = selectedTenantId;

    console.log('[ADMQU] User loaded:', { teacherId: currentTeacherId, tenantId: currentTenantId });
  } catch (err) {
    console.error('Token decode error:', err);
    handleUnauthorized();
  }
}

function handleUnauthorized() {
  localStorage.removeItem('token');
  sessionStorage.removeItem('token');
  window.location.href = 'login.html';
}

function logout() {
  localStorage.removeItem('token');
  sessionStorage.removeItem('token');
  window.location.href = 'login.html';
}

function initPage() {
  populateYearSelects();
  populateTenantSelects();
  setDefaultMonthYear();
  showTab('sk-guru');
  loadSkStatus();
  loadSkRequestStatus();
  loadAbsensi();
  loadSlipGaji();
  loadSlipHistory();
}

function populateYearSelects() {
  const currentYear = new Date().getFullYear();
  const selects = ['absensiTahun', 'slipTahun'];
  selects.forEach(id => {
    const sel = document.getElementById(id);
    if (sel) {
      for (let y = currentYear - 2; y <= currentYear + 1; y++) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y;
        if (y === currentYear) opt.selected = true;
        sel.appendChild(opt);
      }
    }
  });
}

function populateTenantSelects() {
  const assignments = currentUser?.assignments || [];
  const seen = new Set();
  const options = assignments
    .filter(a => a.tenant_id && !seen.has(a.tenant_id) && seen.add(a.tenant_id))
    .map(a => `<option value="${a.tenant_id}">${a.nama_sekolah || a.tenant_id}</option>`)
    .join('');

  ['absensiTenant', 'slipTenant', 'skTenant'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) sel.innerHTML = options;
  });

  const urlParams = new URLSearchParams(window.location.search);
  const urlTenantId = urlParams.get('tenant_id');
  const selectedTenantId = (urlTenantId && [...(document.getElementById('absensiTenant')?.options || [])].some(o => o.value === urlTenantId))
    ? urlTenantId
    : currentTenantId;

  ['absensiTenant', 'slipTenant', 'skTenant'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel && [...sel.options].some(o => o.value === selectedTenantId)) {
      sel.value = selectedTenantId;
    }
  });
}
function setDefaultMonthYear() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  document.getElementById('absensiBulan').value = month;
  document.getElementById('slipBulan').value = month;
  document.getElementById('absensiTahun').value = year;
  document.getElementById('slipTahun').value = year;
}

function showTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tabName)?.classList.add('active');
  document.querySelector('[data-tab="' + tabName + '"]')?.classList.add('active');
}

async function api(endpoint, options = {}) {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      ...options
    });
    if (res.status === 401 || res.status === 403) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) handleUnauthorized();
      throw new Error(data.message || 'Akses ditolak');
    }
    return await res.json();
  } catch (err) {
    console.error(`API error ${endpoint}:`, err);
    throw err;
  }
}

// ==================== SK GURU ====================
async function loadSkStatus() {
  try {
    const res = await api('/admqu/sk-list');
    if (!res.success) throw new Error(res.message);

    if (res.data && res.data.length) {
      showSkList(res.data);
    } else {
      const statusRes = await api('/admqu/sk-status');
      if (!statusRes.success) throw new Error(statusRes.message);
      showEmptySkState(statusRes.data);
    }
  } catch (err) {
    console.error('Load SK status error:', err);
    showSkError(err.message);
  }
}

function showSkList(sks) {
  document.getElementById('skListCard').style.display = 'block';
  document.getElementById('skEmptyCard').style.display = 'none';

  const canViewDrive = ['admin', 'yayasan', 'direktur'].includes(currentUser?.role);
  const tbody = document.getElementById('skListBody');
  tbody.innerHTML = sks.map(sk => `
    <tr>
      <td>${sk.no_surat || '-'}</td>
      <td>${sk.tentang || '-'}</td>
      <td>${sk.bm || '-'}</td>
      <td><span class="sk-type-badge ${SK_TYPE_BADGES[sk.tentag_type] || 'sk-type-baru'}">${SK_TYPE_LABELS[sk.tentag_type] || sk.tentag_type || '-'}</span></td>
      <td>
        <button class="btn btn-outline btn-sm" onclick="viewSkPdf(${sk.id})"><i class="fas fa-eye"></i> View</button>
        <button class="btn btn-primary btn-sm" onclick="downloadSkPdf(${sk.id})"><i class="fas fa-file-pdf"></i> PDF</button>
        ${canViewDrive && sk.drive_web_view_link ? `<a class="btn btn-outline btn-sm" href="${sk.drive_web_view_link}" target="_blank" rel="noopener"><i class="fab fa-google-drive"></i> Drive</a>` : ''}
      </td>
    </tr>
  `).join('');

  const mobile = document.getElementById('skListMobile');
  mobile.innerHTML = sks.map(sk => `
    <div class="sk-mobile-card">
      <div class="sk-mobile-row"><span class="sk-mobile-label">Nomor</span><span class="sk-mobile-value">${sk.no_surat || '-'}</span></div>
      <div class="sk-mobile-row"><span class="sk-mobile-label">Tentang</span><span class="sk-mobile-value">${sk.tentang || '-'}</span></div>
      <div class="sk-mobile-row"><span class="sk-mobile-label">Tanggal</span><span class="sk-mobile-value">${sk.bm || '-'}</span></div>
      <div class="sk-mobile-row"><span class="sk-mobile-label">Jenis</span><span class="sk-mobile-value"><span class="sk-type-badge ${SK_TYPE_BADGES[sk.tentag_type] || 'sk-type-baru'}">${SK_TYPE_LABELS[sk.tentag_type] || sk.tentag_type || '-'}</span></span></div>
      <div class="sk-mobile-actions">
        <button class="btn btn-outline btn-sm" onclick="viewSkPdf(${sk.id})"><i class="fas fa-eye"></i> View</button>
        <button class="btn btn-primary btn-sm" onclick="downloadSkPdf(${sk.id})"><i class="fas fa-file-pdf"></i> PDF</button>
        ${canViewDrive && sk.drive_web_view_link ? `<a class="btn btn-outline btn-sm" href="${sk.drive_web_view_link}" target="_blank" rel="noopener"><i class="fab fa-google-drive"></i> Drive</a>` : ''}
      </div>
    </div>
  `).join('');
}

async function fetchSkFile(skId, format = 'pdf') {
  const res = await fetch(`${API_BASE}/sk-guru/file/${skId}?format=${format}`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });
  if (!res.ok) throw new Error('Gagal memuat SK');
  return await res.blob();
}

async function requestSk(type) {
  if (!currentTeacherId) return;
  const tentang_type = type === 'jabatan' ? 'jabatan' : 'baru';
  const tenantId = document.getElementById('skTenant')?.value;
  try {
    Swal.fire({ title: 'Mengajukan SK...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    const res = await api('/admqu/sk-request', {
      method: 'POST',
      body: JSON.stringify({ tentang_type, tenant_id: tenantId })
    });
    if (!res.success) throw new Error(res.message);
    Swal.fire('Berhasil', res.message || 'Pengajuan SK dikirim', 'success');
    loadSkRequestStatus();
  } catch (err) {
    Swal.fire('Gagal', err.message || 'Gagal mengajukan SK', 'error');
  }
}
async function loadSkRequestStatus() {
  try {
    const res = await api('/admqu/sk-request/status');
    if (!res.success || !res.data || !res.data.length) {
      document.getElementById('skRequestStatus').innerHTML = '';
      return;
    }
    const latest = res.data[0];
    const label = latest.status === 'approved' ? 'Disetujui (SK sedang dibuat)' :
      latest.status === 'rejected' ? 'Ditolak' : 'Menunggu persetujuan admin';
    const color = latest.status === 'approved' ? '#16a34a' : latest.status === 'rejected' ? '#dc2626' : '#d97706';
    document.getElementById('skRequestStatus').innerHTML = `
      <div style="padding: 0.75rem; border-radius: 0.5rem; background: #f8fafc; border: 1px solid #e2e8f0; font-size: 0.85rem;">
        <strong>Pengajuan terakhir:</strong> ${latest.tentang_type === 'jabatan' ? 'Pengangkatan Jabatan' : 'Pengangkatan Guru'}
        — <span style="color: ${color}; font-weight: 600;">${label}</span>
        <span style="color: #64748b;">(${new Date(latest.created_at).toLocaleDateString('id-ID')})</span>
      </div>
    `;
  } catch (err) {
    console.error('Load SK request status error:', err);
  }
}
async function viewSkPdf(skId) {
  try {
    const blob = await fetchSkFile(skId, 'pdf');
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  } catch (err) {
    Swal.fire('Error', err.message || 'Gagal view SK', 'error');
  }
}

async function downloadSkPdf(skId) {
  try {
    const blob = await fetchSkFile(skId, 'pdf');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SK_Guru_${skId}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    Swal.fire('Error', err.message || 'Gagal download SK', 'error');
  }
}
function showEmptySkState(data) {
  document.getElementById('skListCard').style.display = 'none';
  document.getElementById('skEmptyCard').style.display = 'block';

  document.getElementById('skEmptyText').innerHTML = `Belum ada SK untuk tahun <strong>${data.suggested?.hijri_year || '1446'}</strong> H. Anda dapat mengajukan penerbitan SK Guru baru.`;

  // Pre-fill modal form with suggested data
  if (data.teacher) {
    document.getElementById('skHijriYear').value = data.suggested?.hijri_year || '';
    document.getElementById('skTglMulai').value = formatDateForInput(data.suggested?.tgl_mulai);
    document.getElementById('skTglSelesai').value = formatDateForInput(data.suggested?.tgl_selesai);
    document.getElementById('skPt').value = data.teacher.pt || '';
    if (data.teacher.tmt) {
      document.getElementById('skTmt').value = data.teacher.tmt.split('T')[0];
    }
  }
}

function showSkError(msg) {
  document.getElementById('skListCard').style.display = 'none';
  document.getElementById('skEmptyCard').style.display = 'block';
  document.getElementById('skEmptyText').innerHTML = 'Gagal memuat status SK: ' + msg;
}

function openSkModal() {
  document.getElementById('skApplyModal').classList.add('show');
}

function closeSkApplyModal() {
  document.getElementById('skApplyModal').classList.remove('show');
}

async function previewSkFromModal() {
  const form = document.getElementById('skApplyForm');
  const formData = new FormData(form);
  const payload = {
    teacher_id: currentTeacherId,
    tentang_type: formData.get('tentang_type'),
    pt: formData.get('pt') || '',
    tmt_custom: formData.get('tmt_custom') || '',
    no_surat: '',
    tgl_mulai_custom: formData.get('tgl_mulai_custom') || '',
    tgl_selesai_custom: formData.get('tgl_selesai_custom') || '',
    tentang: formData.get('tentang') || '',
    periode_custom: ''
  };

  if (!payload.tentang_type) {
    Swal.fire('Peringatan', 'Pilih jenis SK terlebih dahulu', 'warning');
    return;
  }

  try {
    Swal.fire({ title: 'Memuat preview...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    const res = await api('/sk-guru/preview', { method: 'POST', body: JSON.stringify(payload) });
    if (!res.success) throw new Error(res.message);

    skPreviewData = { ...payload, preview: res.data };
    closeSkApplyModal();
    showSkPreview(res.data);
  } catch (err) {
    Swal.fire('Error', err.message || 'Gagal preview SK', 'error');
  }
}

async function submitSkFromModal() {
  const form = document.getElementById('skApplyForm');
  const formData = new FormData(form);
  const payload = {
    teacher_id: currentTeacherId,
    tentang_type: formData.get('tentang_type'),
    pt: formData.get('pt') || '',
    tmt_custom: formData.get('tmt_custom') || '',
    no_surat: '',
    tgl_mulai_custom: formData.get('tgl_mulai_custom') || '',
    tgl_selesai_custom: formData.get('tgl_selesai_custom') || '',
    tentang: formData.get('tentang') || '',
    periode_custom: ''
  };

  if (!payload.tentang_type) {
    Swal.fire('Peringatan', 'Pilih jenis SK terlebih dahulu', 'warning');
    return;
  }

  const btn = event.target;
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Mengajukan...';

  try {
    const res = await api('/sk-guru/generate', { method: 'POST', body: JSON.stringify(payload) });
    if (!res.success) throw new Error(res.message);

    Swal.fire('Berhasil', 'SK Guru berhasil diterbitkan!', 'success');
    closeSkApplyModal();
    loadSkStatus();
  } catch (err) {
    Swal.fire('Gagal', err.message || 'Gagal mengajukan SK', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

function showSkPreview(data) {
  const html = buildSkPreviewHtml(data);
  document.getElementById('skPreviewModalContent').innerHTML = html;
  document.getElementById('skPreviewModal').classList.add('show');
}

function closeSkPreviewModal() {
  document.getElementById('skPreviewModal').classList.remove('show');
}

async function confirmSkFromPreviewModal() {
  if (!skPreviewData) return;
  closeSkPreviewModal();
  await submitSk(skPreviewData);
}

async function submitSk(previewData = null) {
  const payload = previewData || {
    teacher_id: currentTeacherId,
    tentang_type: document.getElementById('skJenisSelect').value,
    pt: document.getElementById('skPt').value || '',
    tmt_custom: document.getElementById('skTmt').value || '',
    no_surat: '',
    tgl_mulai_custom: document.getElementById('skTglMulai').value || '',
    tgl_selesai_custom: document.getElementById('skTglSelesai').value || '',
    tentang: document.getElementById('skTentangCustom').value || '',
    periode_custom: ''
  };

  if (!payload.tentang_type) {
    Swal.fire('Peringatan', 'Pilih jenis SK terlebih dahulu', 'warning');
    return;
  }

  try {
    Swal.fire({ title: 'Mengajukan...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    const res = await api('/sk-guru/generate', { method: 'POST', body: JSON.stringify(payload) });
    if (!res.success) throw new Error(res.message);

    Swal.fire('Berhasil', 'SK Guru berhasil diterbitkan!', 'success');
    loadSkStatus();
  } catch (err) {
    Swal.fire('Gagal', err.message || 'Gagal mengajukan SK', 'error');
  }
}

// ==================== RINGKASAN ABSENSI ====================
async function loadAbsensi() {
  const bulan = document.getElementById('absensiBulan').value;
  const tahun = document.getElementById('absensiTahun').value;
  const tenantId = document.getElementById('absensiTenant')?.value;

  try {
    const res = await api(`/admqu/absensi-ringkasan?bulan=${bulan}&tahun=${tahun}${tenantId ? '&tenant_id=' + encodeURIComponent(tenantId) : ''}`);
    if (!res.success) throw new Error(res.message);

    renderAbsensi(res.data);
  } catch (err) {
    console.error('Load absensi error:', err);
    document.getElementById('absensiStatsCard').style.display = 'none';
    document.getElementById('absensiCalendarCard').style.display = 'none';
  }
}

function renderAbsensi(data) {
  const s = data.summary;
  document.getElementById('statHadir').textContent = s.hadir;
  document.getElementById('statTerlambat').textContent = s.terlambat;
  document.getElementById('statIzin').textContent = s.izin;
  document.getElementById('statSakit').textContent = s.sakit;
  document.getElementById('statDinas').textContent = s.dinas_luar;
  document.getElementById('statCuti').textContent = s.cuti;
  document.getElementById('statTanpa').textContent = s.tanpa_keterangan;

  document.getElementById('absensiStatsCard').style.display = 'block';
  document.getElementById('absensiCalendarCard').style.display = 'block';

  renderCalendar(data.daily, parseInt(data.bulan), parseInt(data.tahun));
}

function renderCalendar(daily, bulan, tahun) {
  const grid = document.getElementById('calendarGrid');
  const daysInMonth = new Date(tahun, bulan, 0).getDate();
  const firstDay = new Date(tahun, bulan - 1, 1).getDay();
  const today = new Date();
  const isCurrentMonth = today.getMonth() === bulan - 1 && today.getFullYear() === tahun;

  let html = '';
  const dayLabels = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  dayLabels.forEach(d => html += `<div class="calendar-day"><span class="day-label">${d}</span></div>`);

  for (let i = 0; i < firstDay; i++) {
    html += `<div class="calendar-day empty"></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const status = daily[d] || '-';
    let cls = 'calendar-day';
    let label = '';
    switch (status) {
      case 'H': cls += ' hadir'; label = 'H'; break;
      case 'T': cls += ' terlambat'; label = 'T'; break;
      case 'I': cls += ' izin'; label = 'I'; break;
      case 'S': cls += ' sakit'; label = 'S'; break;
      case 'D': cls += ' dinas'; label = 'D'; break;
      case 'C': cls += ' cuti'; label = 'C'; break;
      case '-': cls += ' empty'; label = ''; break;
      default: cls += ' empty'; label = status.charAt(0);
    }
    if (isCurrentMonth && d === today.getDate()) cls += ' today';
    html += `<div class="${cls}"><span class="day-num">${d}</span>${label ? `<span class="day-status">${label}</span>` : ''}</div>`;
  }

  grid.innerHTML = html;
}

// ==================== SLIP GAJI ====================
async function loadSlipGaji() {
  const bulan = document.getElementById('slipBulan').value;
  const tahun = document.getElementById('slipTahun').value;
  const tenantId = document.getElementById('slipTenant')?.value;

  try {
    const res = await api(`/admqu/slip-gaji?bulan=${bulan}&tahun=${tahun}${tenantId ? '&tenant_id=' + encodeURIComponent(tenantId) : ''}`);
    if (!res.success) throw new Error(res.message);

    renderSlipGaji(res.data);
  } catch (err) {
    console.error('Load slip gaji error:', err);
    document.getElementById('slipGajiCard').style.display = 'none';
  }
}

function renderSlipGaji(data) {
  document.getElementById('slipGajiCard').style.display = 'block';
  document.getElementById('slipHistoryCard').style.display = 'block';

  document.getElementById('slipPeriode').textContent = `Periode: ${formatMonthYear(data.periode)}`;
  document.getElementById('slipNama').textContent = data.guru.nama;
  document.getElementById('slipNip').textContent = data.guru.nip;
  document.getElementById('slipJabatan').textContent = data.guru.jabatan;
  document.getElementById('slipSekolah').textContent = data.guru.sekolah;

  const r = data.rincian;
  const a = data.absensi;

  const rows = [
    { label: 'Gaji Pokok', value: r.gaji_pokok, class: '' },
    { label: 'Tunj. Kinerja', value: r.tunj_kinerja, class: '' },
    { label: 'Tunj. Umum', value: r.tunj_umum, class: '' },
    { label: 'Tunj. Istri', value: r.tunj_istri, class: '' },
    { label: 'Tunj. Anak', value: r.tunj_anak, class: '' },
    { label: 'Tunj. Kepala Sekolah', value: r.tunj_kepala_sekolah, class: '' },
    { label: 'Tunj. Wali Kelas', value: r.tunj_wali_kelas, class: '' },
    { label: 'Honor Bendahara', value: r.honor_bendahara, class: '' },
    { label: 'Tunj. Kehadiran', value: r.tunj_kehadiran, class: 'bg-yellow' },
    { label: 'Total Penggajian', value: r.total_penggajian, class: 'total-row font-bold' },
    { label: 'Potongan Terlambat', value: -r.potongan_terlambat, class: 'bg-red' },
    { label: 'Potongan Izin', value: -r.potongan_izin, class: 'bg-red' },
    { label: 'Potongan Sakit', value: -r.potongan_sakit, class: 'bg-red' },
    { label: 'Potongan Tanpa Keterangan', value: -r.potongan_tanpa_keterangan, class: 'bg-red' },
    { label: 'Total Potongan', value: -r.total_potongan, class: 'total-row font-bold bg-red' },
    { label: 'TOTAL BERSIH', value: r.total_bersih, class: 'net-row font-bold' }
  ];

  const tbody = document.getElementById('slipBreakdownBody');
  tbody.innerHTML = rows.map(row => `
    <tr class="${row.class}">
      <td>${row.label}</td>
      <td class="text-right ${row.value < 0 ? 'text-red-600' : ''}">${formatRp(Math.abs(row.value))}</td>
    </tr>
  `).join('');
}

async function loadSlipHistory() {
  const tenantId = document.getElementById('slipTenant')?.value;
  try {
    const res = await api(`/admqu/slip-gaji/history${tenantId ? '?tenant_id=' + encodeURIComponent(tenantId) : ''}`);
    if (!res.success) throw new Error(res.message);

    const tbody = document.getElementById('slipHistoryBody');
    if (res.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="px-4 py-8 text-center text-gray-500">Belum ada riwayat slip gaji</td></tr>';
      return;
    }
    tbody.innerHTML = res.data.map(h => `
      <tr>
        <td>${formatMonthYear(h.periode)}</td>
        <td class="text-right font-medium">${formatRp(h.total_gaji)}</td>
        <td>${new Date(h.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Load slip history error:', err);
  }
}

async function downloadSlipGaji() {
  const bulan = document.getElementById('slipBulan').value;
  const tahun = document.getElementById('slipTahun').value;
  if (!currentTeacherId) return;
  window.open(`${API_BASE}/treasurer/public/salary-slip-pdf/${currentTeacherId}?month=${tahun}-${String(bulan).padStart(2, '0')}`, '_blank');
}

async function emailSlipGaji() {
  const bulan = document.getElementById('slipBulan').value;
  const tahun = document.getElementById('slipTahun').value;
  if (!currentTeacherId) return;

  try {
    Swal.fire({ title: 'Mengirim email...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    const res = await api('/treasurer/public/send-salary-slip-email', {
      method: 'POST',
      body: JSON.stringify({ teacherId: currentTeacherId, month: `${tahun}-${String(bulan).padStart(2, '0')}` })
    });
    if (res.success) {
      Swal.fire('Berhasil', 'Slip gaji telah dikirim ke email Anda', 'success');
    } else {
      Swal.fire('Gagal', res.message || 'Gagal kirim email', 'error');
    }
  } catch (err) {
    Swal.fire('Error', err.message || 'Gagal kirim email', 'error');
  }
}

// ==================== UTILS ====================
function formatRp(v) {
  return 'Rp ' + (parseFloat(v || 0)).toLocaleString('id-ID');
}

function formatMonthYear(periode) {
  if (!periode) return '-';
  const [year, month] = periode.split('-');
  const months = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  return `${months[parseInt(month)]} ${year}`;
}

function formatDateForInput(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.match(/(\d+)\s+(\w+)\s+(\d+)/);
  if (!parts) return '';
  const day = parts[1].padStart(2, '0');
  const monthNames = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const month = String(monthNames.indexOf(parts[2]) + 1).padStart(2, '0');
  const year = parts[3];
  return `${year}-${month}-${day}`;
}

function buildSkPreviewHtml(data) {
  const d = data.preview || data;
  return `
    <div class="kop" style="text-align:center;margin-bottom:4px;">
      <img src="SKTEMPLATE/images/image2.jpg" alt="KOP YPWI" style="width:100%;max-width:680px;height:auto;">
    </div>
    <div class="bismillah" style="text-align:center;margin-bottom:4px;">
      <img src="SKTEMPLATE/images/image1.png" alt="Bismillah" style="width:130px;height:auto;">
    </div>
    <p style="text-align:center;font-weight:bold;font-size:10pt;">SURAT KEPUTUSAN</p>
    <p style="text-align:center;font-weight:bold;font-size:10pt;">KETUA YAYASAN PESANTREN WAHDAH ISLAMIYAH LUWU TIMUR</p>
    <p style="text-align:center;font-size:9.5pt;font-weight:bold;">Nomor : <span style="font-weight:bold;">${d.no_surat || d.noSurat || '(Otomatis)'}</span></p>
    <p style="text-align:center;font-weight:bold;font-size:10pt;">TENTANG</p>
    <p style="text-align:center;font-weight:bold;font-size:9.5pt;">${d.tentang || '(Otomatis)'}</p>
    <table style="margin-left:0px;width:100%;">
      <tr><td style="width:90pt;"><b>Menimbang</b></td><td>:</td><td>a.</td><td>Bahwa untuk efektivitas penyelenggaraan pendidikan di <b>${d.unit || '(Unit)'}</b>, perlu menetapkan jabatan <b>${d.jabatan || '(Jabatan)'}</b>.</td></tr>
      <tr><td></td><td></td><td>b.</td><td>Bahwa Saudara/i <b>${d.nama || '(Nama)'}</b> dipandang layak untuk menjabat <b>${d.jabatan || '(Jabatan)'}</b>.</td></tr>
      <tr><td><b>Mengingat</b></td><td>:</td><td>1.</td><td>Firman Allah dalam Al-Qur'an Al-Mujadilah (58) ayat 11.</td></tr>
      <tr><td></td><td></td><td>2.</td><td>Undang-Undang No. 20 tahun 2003 tentang Sistem Pendidikan Nasional.</td></tr>
      <tr><td></td><td></td><td>3.</td><td>Undang-Undang No. 14 tahun 2005 tentang Sertifikasi Guru dan Dosen.</td></tr>
      <tr><td><b>Memperhatikan</b></td><td>:</td><td>1.</td><td>Anggaran Dasar dan Anggaran Rumah Tangga YPWI Luwu Timur.</td></tr>
      <tr><td></td><td></td><td>2.</td><td>Hasil Musyawarah Pengurus YPWI Luwu Timur.</td></tr>
      <tr><td colspan="4" style="text-align:center;padding:4px 0;"><b>M E M U T U S K A N</b></td></tr>
      <tr><td><b>PERTAMA</b></td><td>:</td><td colspan="2">Terhitung mulai <b>${d.tgl_mulai || d.tglMulai || '(Tanggal)'}</b> mengangkat sebagai <b>${d.jabatan || '(Jabatan)'}</b> selama periode <b>${d.periode || '(Periode)'}</b> sampai <b>${d.tgl_selesai || d.tglSelesai || '(Tanggal)'}</b></td></tr>
    </table>
    <table style="margin-left:115pt;margin-top:2px;width:calc(100%-115pt);">
      <tr><td style="width:110pt;">Nama</td><td>:</td><td><b>${d.nama || '(Nama)'}</b></td></tr>
      <tr><td>Tempat/tanggal lahir</td><td>:</td><td>${d.ttl || '(TTL)'}</td></tr>
      <tr><td>Tahun Mulai Tugas</td><td>:</td><td>${d.tmt || '(TMT)'}</td></tr>
      <tr><td>Pendidikan Terakhir</td><td>:</td><td>${d.pt || '(PT)'}</td></tr>
      <tr><td>Status Kepegawaian</td><td>:</td><td>${d.status || '(Status)'}</td></tr>
      <tr><td>NIY</td><td>:</td><td>${d.niy || '(NIY)'}</td></tr>
      <tr><td>Unit Kerja</td><td>:</td><td>${d.unit || '(Unit)'}</td></tr>
    </table>
    <table style="margin-top:2px;">
      <tr><td style="width:90pt;"><b>KEDUA</b></td><td>:</td><td>Apabila terdapat kekeliruan akan diperbaiki sebagaimana mestinya.</td></tr>
      <tr><td><b>KETIGA</b></td><td>:</td><td><b>Asli</b> Keputusan ini diberikan kepada yang bersangkutan.</td></tr>
    </table>
    <div style="margin-top:6px;text-align:right;">
      <table style="width:250pt;float:right;text-align:center;">
        <tr><td style="text-align:left;width:70pt;">Ditetapkan di</td><td>:</td><td style="text-align:left;">Luwu Timur</td></tr>
        <tr><td style="text-align:left;">Pada tanggal</td><td>:</td><td style="text-align:left;"><div style="display:inline-block;text-align:left;line-height:1.2;"><span style="text-decoration:underline;">${d.bh || '(Hijriah)'}</span><br><span>${d.bm || '(Masehi)'}</span></div></td></tr>
        <tr><td colspan="3" style="text-align:center;padding-top:4px;">
          <p>Yayasan Pesantren Wahdah Islamiyah</p>
          <p>Luwu Timur</p>
          <p>Ketua</p>
          <div style="margin-top:60px;"><b>Usman, S.Pd.I,. Gr.</b><br>NIY.3112198706201402006</div>
        </td></tr>
      </table>
      <div style="clear:both;"></div>
    </div>
  `;
}