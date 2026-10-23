// ============================================================
// SDM DASHBOARD JS - Direktur SDM Dashboard
// ============================================================

const API_BASE = '/api';
let authToken = localStorage.getItem('token') || sessionStorage.getItem('token');
let currentUser = null;
let isSdmPusat = false;
let currentTenant = '';
let attendanceChart = null;
let kpiChart = null;
let chartType = 'weekly';

// Pagination
let teacherCurrentPage = 1;
let teacherTotalPages = 1;

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  if (!authToken) {
    window.location.href = 'login.html';
    return;
  }

  loadUserInfo();
  await initDashboard();

  document.getElementById('currentDate').textContent = new Date().toLocaleDateString('id-ID', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  // Set default attendance date filter
  document.getElementById('attendanceDateFilter').value = new Date().toISOString().split('T')[0];

  // Nav items
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });
});

// Decode JWT payload (matches login payload: id, username, role, guru_id, tenant_id, assignments)
function loadUserInfo() {
  try {
    const payloadPart = authToken.split('.')[1];
    if (!payloadPart) return handleUnauthorized();
    const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(decodeURIComponent(escape(atob(base64))));
    if (!payload || !payload.id) return handleUnauthorized();

    currentUser = {
      id: payload.id,
      username: payload.username,
      role: payload.role,
      guru_id: payload.guru_id,
      tenant_id: payload.tenant_id,
      assignments: payload.assignments || []
    };

    isSdmPusat = currentUser.role === 'admin' || currentUser.assignments.some(a =>
      (a.jabatan_di_unit || '').toLowerCase().includes('sdm') && a.tenant_id === 'YPWILUTIM'
    );
    const hasSdmAccess = currentUser.role === 'admin' || currentUser.assignments.some(a =>
      (a.jabatan_di_unit || '').toLowerCase().includes('sdm')
    );

    if (!hasSdmAccess) {
      Swal.fire({
        title: 'Akses Ditolak',
        text: 'Halaman ini hanya untuk Direktur SDM. Hubungi administrator jika Anda merasa ini keliru.',
        icon: 'error',
        confirmButtonText: 'Kembali ke Login',
        confirmButtonColor: '#dc2626',
        allowOutsideClick: false
      }).then(() => logout());
      return;
    }

    const roleLabel = currentUser.role === 'admin'
      ? 'Administrator (Akses Penuh)'
      : (isSdmPusat ? 'SDM Pusat (YPWI Lutim)' : 'SDM Sekolah');
    document.getElementById('sdmUserName').textContent = payload.username || 'User';
    document.getElementById('sdmUserRole').textContent = roleLabel;
    if (isSdmPusat) {
      document.getElementById('tenantFilterWrap').classList.remove('hidden');
    }
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

// ============================================================
// TAB SWITCHING
// ============================================================
const tabSubtitles = {
  'dashboard': 'Ringkasan data SDM & KPI',
  'teachers': 'Kelola data guru, jabatan, dan penempatan',
  'access': 'Kelola siapa saja yang berhak mengakses dashboard SDM',
  'kpi': 'Penilaian kinerja pegawai & evaluasi',
  'attendance': 'Rekap log absensi guru',
  'recapAbsensi': 'Rekap absensi bulanan per sekolah',
  
  'payroll': 'Perhitungan gaji & potongan absensi',
  'sk-guru': 'Dokumen resmi kepegawaian guru',
  'rules': 'Aturan status kepegawaian & absensi',
  'qr-generator': 'Device scanner absensi',
  'idcard': 'Cetak kartu identitas',
  'settings': 'Konfigurasi sistem SDM'
};

const tabTitles = {
  'dashboard': 'Dashboard',
  'teachers': 'Manajemen Guru',
  'access': 'Akses SDM',
  'kpi': 'KPI & Evaluasi',
  'attendance': 'Log Kehadiran',
  'recapAbsensi': 'Rekap Absensi',
  
  'payroll': 'Penggajian',
  'sk-guru': 'Dokumen SK Guru',
  'rules': 'Aturan Kepegawaian',
  'qr-generator': 'QR Scanner',
  'idcard': 'Cetak ID Card',
  'settings': 'Pengaturan'
};

async function showTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(i => {
    i.classList.remove('nav-active');
    i.classList.add('text-gray-600');
  });
  document.getElementById(tabName + 'Tab')?.classList.remove('hidden');
  document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('nav-active');
  document.getElementById('pageTitle').textContent = tabTitles[tabName] || tabName;
  document.getElementById('pageSubtitle').textContent = tabSubtitles[tabName] || '';

  if (tabName === 'dashboard') loadDashboardStats();
  if (tabName === 'teachers') { loadJabatanFilter(); loadTeachers(); }
  if (tabName === 'access') loadAccessTab();
  if (tabName === 'kpi') { await loadKpiPeriods(); loadKpiTemplates(); await loadKpiOverview(); applyKpiAccessControl(); }
  if (tabName === 'attendance') { loadAttendanceLogs(); initMonthlyRecapSelectors(); }
  if (tabName === 'recapAbsensi') { loadAttendanceRecap(); initMonthlyRecapSelectors(); }
 
  if (tabName === 'payroll') { loadPayrollYears(); initPayrollSelectors(); initMonthlyRecapSelectors(); }
}

async function onTenantChange() {
  currentTenant = document.getElementById('tenantSelect').value;
  const activeTab = document.querySelector('.nav-item.nav-active')?.dataset.tab;
  if (activeTab === 'dashboard') loadDashboardStats();
  if (activeTab === 'teachers') loadTeachers();
  if (activeTab === 'kpi') loadKpiOverview();
  if (activeTab === 'attendance') loadAttendanceLogs();
 
}

// ============================================================
// API HELPER
// ============================================================
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

// ============================================================
// DASHBOARD
// ============================================================
async function initDashboard() {
  await loadTenantOptions();
  await loadDashboardStats();
  const activeTab = document.querySelector('.nav-item.nav-active')?.dataset.tab;
  if (activeTab === 'attendance') loadAttendanceLogs();
 
}

async function loadTenantOptions() {
  try {
    const data = await api('/sdm-dashboard/tenants');
    const sel = document.getElementById('tenantSelect');
    if (data.success && data.data) {
      data.data.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.tenant_id;
        opt.textContent = t.nama_sekolah;
        sel.appendChild(opt);
      });
      // Prefer SDM assignments over other assignments
      if (currentTenant && !data.data.some(d=>d.tenant_id===currentTenant)) {
        currentTenant = null;
      }
      if (!currentTenant && currentUser?.assignments?.length) {
        const sdmAssign = currentUser.assignments.find(a => (a.jabatan_di_unit||'').toLowerCase().includes('sdm') && data.data.some(d=>d.tenant_id===a.tenant_id));
        if (sdmAssign) {
          currentTenant = sdmAssign.tenant_id;
          sel.value = currentTenant;
          const at = document.querySelector('.nav-item.nav-active')?.dataset.tab;
          if (at==='attendance') loadAttendanceLogs();
        } else if (data.data.length > 0) {
          currentTenant = data.data[0].tenant_id;
          sel.value = currentTenant;
          const at = document.querySelector('.nav-item.nav-active')?.dataset.tab;
          if (at==='attendance') loadAttendanceLogs();
        }
      } else if (data.data.length > 0 && !currentTenant) {
        currentTenant = data.data[0].tenant_id;
        sel.value = currentTenant;
        const at = document.querySelector('.nav-item.nav-active')?.dataset.tab;
        if (at==='attendance') loadAttendanceLogs();
      }
    }
  } catch (err) { /* silent */ }
}

async function loadDashboardStats() {
  try {
    const [statsRes, chartRes, kpiRes] = await Promise.all([
      (async () => { let t=currentTenant; if(!t&&currentUser?.assignments?.length){ const sa=currentUser.assignments.find(a=>(a.jabatan_di_unit||'').toLowerCase().includes('sdm')); t=sa?.tenant_id||currentUser.assignments[0]?.tenant_id; } return api(`/sdm-dashboard/stats${t?`?tenant_id=${t}`:''}`); })(),
      (async () => { let t=currentTenant; if(!t&&currentUser?.assignments?.length){ const sa=currentUser.assignments.find(a=>(a.jabatan_di_unit||'').toLowerCase().includes('sdm')); t=sa?.tenant_id||currentUser.assignments[0]?.tenant_id; } const ctDef=document.getElementById("attendanceChartType")?.value||"daily"; return api(`/sdm-dashboard/attendance-chart?type=${ctDef}${t?`&tenant_id=${t}`:''}`); })(),
      (async () => { let t=currentTenant; if(!t&&currentUser?.assignments?.length){ const sa=currentUser.assignments.find(a=>(a.jabatan_di_unit||'').toLowerCase().includes('sdm')); t=sa?.tenant_id||currentUser.assignments[0]?.tenant_id; } return api(`/sdm-dashboard/kpi-summary${t?`?tenant_id=${t}`:''}`); })()
    ]);

    if (statsRes.success) {
      const d = statsRes.data;
      document.getElementById('statTotalTeachers').textContent = d.total_teachers || 0;
      document.getElementById('statTotalTeachers').classList.remove('skeleton-loader');
      document.getElementById('statTodayPresent').textContent = d.today_attendance || 0;
      document.getElementById('statTodayLate').textContent = d.late_today || 0;
      document.getElementById('statAvgKpi').textContent = d.kpi_summary?.avg_score || 0;
      document.getElementById('kpiActivePeriod').textContent = d.kpi_summary?.active_period || 'Belum ada periode';
      document.getElementById('kpiCompletionRate').textContent = `${d.kpi_summary?.completion_rate || 0}%`;
      document.getElementById('kpiTotalTemplates').textContent = d.kpi_summary?.total_templates || 0;
      document.getElementById('kpiAssessedCount').textContent = d.kpi_summary?.completion_rate ? Math.round((d.kpi_summary.completion_rate / 100) * (d.total_teachers || 0)) : 0;

      // School recap
      const tbody = document.getElementById('schoolRecapTable');
      if (d.by_school?.length) {
        tbody.innerHTML = d.by_school.map(s => {
          const rate = parseFloat(s.attendance_rate) || 0;
          const statusBadge = rate >= 90
            ? '<span class="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">Baik</span>'
            : rate >= 75
            ? '<span class="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">Cukup</span>'
            : '<span class="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full">Perhatian</span>';
          return `
            <tr>
              <td class="px-4 py-3 text-sm font-medium text-gray-900">${escapeHtml(s.nama_sekolah)}</td>
              <td class="px-4 py-3 text-sm text-gray-700">${s.teachers || 0}</td>
              <td class="px-4 py-3">
                <div class="flex items-center">
                  <div class="w-24 bg-gray-200 rounded-full h-2 mr-2">
                    <div class="bg-indigo-600 h-2 rounded-full kpi-progress-bar" style="width: ${rate}%"></div>
                  </div>
                  <span class="text-sm text-gray-700">${rate}%</span>
                </div>
              </td>
              <td class="px-4 py-3">${statusBadge}</td>
            </tr>`;
        }).join('');
      } else {
        tbody.innerHTML = '<tr><td colspan="4" class="px-4 py-8 text-center text-gray-500">Tidak ada data</td></tr>';
      }
    }

    if (chartRes.success) renderAttendanceChart(chartRes.data);
    if (kpiRes.success) renderKpiChart(kpiRes.data);
  } catch (err) {
    console.error('Dashboard stats error:', err);
  }
}

function renderAttendanceChart(chartData) {
  const ctx = document.getElementById('attendanceChart');
  if (!ctx) return;
  if (attendanceChart) attendanceChart.destroy();
  attendanceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartData.labels || [],
      datasets: (chartData.datasets || []).map(ds => ({
        label: ds.label,
        data: ds.data,
        borderColor: ds.borderColor,
        backgroundColor: ds.backgroundColor,
        fill: true,
        tension: 0.3
      }))
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom' } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

function renderKpiChart(kpiData) {
  const ctx = document.getElementById('kpiChart');
  if (!ctx) return;
  if (kpiChart) kpiChart.destroy();
  const indicators = (kpiData.by_indicator || []);
  // Urutkan berdasarkan achievement tertinggi terlebih dahulu
  indicators.sort((a, b) => (b.avg_achievement || 0) - (a.avg_achievement || 0));
  // Tampilkan semua indikator (tidak dibatasi 10)
  kpiChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: indicators.map(i => i.nama || 'Indikator #' + i.id),
      datasets: [{
        label: 'Avg Achievement (%)',
        data: indicators.map(i => i.avg_achievement || 0),
        backgroundColor: indicators.map(i => {
          const ach = i.avg_achievement || 0;
          return ach >= 90 ? '#22c55e' : ach >= 75 ? '#f59e0b' : '#ef4444';
        }),
        borderRadius: 4,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, max: 120, ticks: { callback: v => v + '%' } },
        x: {
          ticks: { maxRotation: 45, minRotation: 45, font: { size: 9 }, autoSkip: false },
          grid: { display: false }
        }
      },
      layout: { padding: { bottom: 20 } }
    }
  });
}

function switchChart(type) {
  chartType = type;
  document.getElementById('chartWeeklyBtn').className = type === 'weekly'
    ? 'px-3 py-1 text-xs font-medium bg-indigo-600 text-white rounded-md'
    : 'px-3 py-1 text-xs font-medium bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300';
  document.getElementById('chartMonthlyBtn').className = type === 'monthly'
    ? 'px-3 py-1 text-xs font-medium bg-indigo-600 text-white rounded-md'
    : 'px-3 py-1 text-xs font-medium bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300';
  let tC=currentTenant; if(!tC&&currentUser?.assignments?.length){ const sa=currentUser.assignments.find(a=>(a.jabatan_di_unit||'').toLowerCase().includes('sdm')); tC=sa?.tenant_id||currentUser.assignments[0]?.tenant_id; } api(`/sdm-dashboard/attendance-chart?type=${type}${tC ? `&tenant_id=${tC}` : ''}`)
    .then(res => res.success && renderAttendanceChart(res.data));
}

// ============================================================
// AKSES SDM (khusus SDM Pusat)
// YPWILUTIM = SDM Pusat, tenant lain = SDM Sekolah
// ============================================================
const SDM_PUSAT_TENANT = 'YPWILUTIM';
let selectedAccessTeacherId = null;
let accessSearchDebounce;

async function loadAccessTab() {
  // Sembunyikan form pemberian akses untuk non SDM Pusat
  const assignCard = document.getElementById('accessAssignCard');
  if (assignCard) {
    assignCard.style.display = isSdmPusat ? 'block' : 'none';
  }

  if (isSdmPusat) {
    await loadAccessTenantOptions();
    await loadSdmAccessList();
  }
}

async function loadAccessTenantOptions() {
  try {
    const data = await api('/sdm-dashboard/tenants');
    const sel = document.getElementById('accessTenantSelect');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">Pilih Sekolah</option>';
    if (data.success && data.data) {
      data.data.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.tenant_id;
        opt.textContent = `${t.tenant_id === SDM_PUSAT_TENANT ? 'PUSAT - ' : ''}${t.nama_sekolah}`;
        sel.appendChild(opt);
      });
    }
    if (current) sel.value = current;
    onAccessTenantChange();
  } catch (err) { /* silent */ }
}

// Tentukan otomatis label jabatan berdasarkan tenant yang dipilih
function onAccessTenantChange() {
  const sel = document.getElementById('accessTenantSelect');
  const preview = document.getElementById('accessJabatanPreview');
  if (!sel || !preview) return;

  const tenantId = sel.value;
  if (tenantId === SDM_PUSAT_TENANT) {
    preview.value = 'SDM Pusat (akses semua sekolah)';
    preview.classList.remove('text-gray-600');
    preview.classList.add('text-indigo-700', 'font-semibold');
  } else if (tenantId) {
    preview.value = 'SDM (akses unit sekolah ini)';
    preview.classList.remove('text-gray-600');
    preview.classList.add('text-indigo-700', 'font-semibold');
  } else {
    preview.value = '—';
    preview.classList.add('text-gray-600');
    preview.classList.remove('text-indigo-700', 'font-semibold');
  }

  // Reset pilihan guru saat tenant berubah
  resetSelectedTeacher();
}

function resetSelectedTeacher() {
  selectedAccessTeacherId = null;
  const search = document.getElementById('accessTeacherSearch');
  if (search) search.value = '';
  const resultWrap = document.getElementById('accessTeacherResult');
  if (resultWrap) resultWrap.classList.add('hidden');
  const list = document.getElementById('accessTeacherList');
  if (list) list.innerHTML = '';
}

function handleAccessTeacherSearch(e) {
  clearTimeout(accessSearchDebounce);
  accessSearchDebounce = setTimeout(() => searchAccessTeachers(), 400);
}

async function searchAccessTeachers() {
  const tenantId = document.getElementById('accessTenantSelect')?.value;
  const keyword = document.getElementById('accessTeacherSearch')?.value?.trim() || '';

  if (!tenantId) {
    Swal.fire('Peringatan', 'Pilih sekolah terlebih dahulu', 'warning');
    return;
  }
  if (keyword.length < 2) {
    document.getElementById('accessTeacherResult')?.classList.add('hidden');
    return;
  }

  try {
    const params = new URLSearchParams({ tenant_id: tenantId, search: keyword, limit: 25 });
    const data = await api(`/sdm-dashboard/access/candidates?${params}`);
    const wrap = document.getElementById('accessTeacherResult');
    const list = document.getElementById('accessTeacherList');

    if (data.success && data.data?.length) {
      wrap.classList.remove('hidden');
      list.innerHTML = data.data.map(t => `
        <div class="flex items-center justify-between px-4 py-3 hover:bg-gray-50 cursor-pointer" onclick="selectAccessTeacher(${t.id}, '${escapeHtml(t.nama).replace(/'/g, "\\'")}')">
          <div>
            <p class="text-sm font-medium text-gray-900">${escapeHtml(t.nama)}</p>
            <p class="text-xs text-gray-500">NIK: ${escapeHtml(t.nik || '-')}${t.nip ? ' | NIP: ' + escapeHtml(t.nip) : ''}</p>
          </div>
          <span class="text-xs text-gray-400">${escapeHtml(t.status_kepegawaian || '')}</span>
        </div>`).join('');
    } else {
      wrap.classList.remove('hidden');
      list.innerHTML = `
        <div class="px-4 py-6 text-center text-sm text-gray-500">
          Tidak ada guru ditemukan${tenantId === SDM_PUSAT_TENANT ? ' di tenant pusat' : ' di sekolah tersebut'}.<br>
          <span class="text-xs text-gray-400">Guru harus sudah memiliki penempatan di sekolah ini.</span>
        </div>`;
    }
  } catch (err) {
    Swal.fire('Error', err.message || 'Gagal mencari guru', 'error');
  }
}

function selectAccessTeacher(teacherId, nama) {
  selectedAccessTeacherId = teacherId;
  const list = document.getElementById('accessTeacherList');
  list.querySelectorAll('div').forEach(d => d.classList.remove('bg-indigo-50', 'ring-1', 'ring-indigo-300'));
  event?.currentTarget?.classList?.add('bg-indigo-50', 'ring-1', 'ring-indigo-300');

  Swal.fire({
    title: 'Guru dipilih',
    text: nama,
    icon: 'success',
    timer: 1200,
    showConfirmButton: false
  });
}

async function assignSdmAccess() {
  const tenantId = document.getElementById('accessTenantSelect')?.value;
  if (!tenantId) {
    Swal.fire('Peringatan', 'Pilih sekolah terlebih dahulu', 'warning');
    return;
  }
  if (!selectedAccessTeacherId) {
    Swal.fire('Peringatan', 'Cari dan pilih guru terlebih dahulu', 'warning');
    return;
  }
  if (!isSdmPusat) {
    Swal.fire('Akses Ditolak', 'Hanya SDM Pusat yang boleh memberikan akses SDM', 'error');
    return;
  }

  const jabatan = tenantId === SDM_PUSAT_TENANT ? 'SDM Pusat' : 'SDM';
  const confirm = await Swal.fire({
    title: 'Berikan akses SDM?',
    html: `<p class="text-sm text-gray-600">Jabatan yang akan diberikan: <span class="font-semibold text-indigo-700">${jabatan}</span></p>
           <p class="text-xs text-gray-500 mt-2">${jabatan === 'SDM Pusat' ? 'Akses ke semua sekolah.' : 'Akses hanya ke unit sekolah ini.'}</p>`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Ya, berikan',
    cancelButtonText: 'Batal',
    confirmButtonColor: '#4f46e5'
  });
  if (!confirm.isConfirmed) return;

  try {
    Swal.fire({ title: 'Memproses...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    const data = await api('/sdm-dashboard/access', {
      method: 'POST',
      body: JSON.stringify({ teacher_id: selectedAccessTeacherId, tenant_id: tenantId })
    });
    if (data.success) {
      Swal.fire('Berhasil', data.message, 'success');
      resetSelectedTeacher();
      loadSdmAccessList();
    } else {
      Swal.fire('Gagal', data.message || 'Tidak dapat memberikan akses', 'error');
    }
  } catch (err) {
    Swal.fire('Error', err.message || 'Gagal memberikan akses SDM', 'error');
  }
}

async function loadSdmAccessList() {
  const tbody = document.getElementById('sdmAccessTable');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-12 text-center text-gray-500"><i class="fas fa-spinner fa-spin text-xl mb-2"></i><p>Memuat data...</p></td></tr>';

  try {
    const data = await api('/sdm-dashboard/access/list');
    if (data.success && data.data?.length) {
      tbody.innerHTML = data.data.map(a => {
        const isPusat = a.tenant_id === SDM_PUSAT_TENANT;
        const jabatanLabel = isPusat ? 'SDM Pusat' : 'SDM';
        const levelBadge = isPusat
          ? '<span class="px-2 py-1 text-xs font-medium bg-indigo-100 text-indigo-800 rounded-full">Pusat &middot; Semua sekolah</span>'
          : '<span class="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">Sekolah &middot; Unit sendiri</span>';
        const sekolah = isPusat
          ? '<span class="font-semibold text-indigo-700">Pusat (YPWI Lutim)</span>'
          : escapeHtml(a.nama_sekolah || a.tenant_id);
        return `
          <tr>
            <td class="px-4 py-3 text-sm font-medium text-gray-900">${escapeHtml(a.nama)}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${escapeHtml(a.nik || '-')}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${sekolah}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${escapeHtml(a.jabatan_di_unit || jabatanLabel)}</td>
            <td class="px-4 py-3">${levelBadge}</td>
            <td class="px-4 py-3">
              ${isSdmPusat
                ? `<button onclick="revokeSdmAccess(${a.id}, '${escapeHtml(a.nama).replace(/'/g, "\\'")}', '${escapeHtml(a.nama_sekolah || a.tenant_id).replace(/'/g, "\\'")}')" class="text-red-600 hover:text-red-800 text-sm" title="Cabut akses"><i class="fas fa-user-minus"></i></button>`
                : '<span class="text-xs text-gray-400">Read-only</span>'}
            </td>
          </tr>`;
      }).join('');
    } else {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="px-4 py-12 text-center text-gray-500">
            <i class="fas fa-user-shield text-3xl text-gray-300 mb-3"></i>
            <p>Belum ada guru dengan jabatan SDM.</p>
            <p class="text-xs text-gray-400 mt-1">Gunakan form di atas untuk memberikan akses.</p>
          </td>
        </tr>`;
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-12 text-center text-red-500">Gagal memuat daftar akses SDM</td></tr>';
  }
}

async function revokeSdmAccess(assignmentId, nama, sekolah) {
  const confirm = await Swal.fire({
    title: 'Cabut akses SDM?',
    html: `<p class="text-sm text-gray-600"><span class="font-semibold">${nama}</span> akan kehilangan akses dashboard SDM${sekolah ? ` di ${sekolah}` : ''}.</p>
           <p class="text-xs text-gray-500 mt-2">Penempatan/jabatan lain yang dimiliki guru tersebut tidak terpengaruh.</p>`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Ya, cabut',
    cancelButtonText: 'Batal',
    confirmButtonColor: '#dc2626'
  });
  if (!confirm.isConfirmed) return;

  try {
    const data = await api(`/sdm-dashboard/access/${assignmentId}`, { method: 'DELETE' });
    if (data.success) {
      Swal.fire('Dicabut', data.message, 'success');
      loadSdmAccessList();
    } else {
      Swal.fire('Gagal', data.message || 'Tidak dapat mencabut akses', 'error');
    }
  } catch (err) {
    Swal.fire('Error', err.message || 'Gagal mencabut akses', 'error');
  }
}

// ============================================================
// MANAJEMEN GURU
// ============================================================
async function loadJabatanFilter() {
  try {
    let tJ=currentTenant; if(!tJ&&currentUser?.assignments?.length){ const sa=currentUser.assignments.find(a=>(a.jabatan_di_unit||'').toLowerCase().includes('sdm')); tJ=sa?.tenant_id||currentUser.assignments[0]?.tenant_id; } const data = await api(`/sdm-dashboard/jabatan-list${tJ?`?tenant_id=${tJ}`:''}`);
    const sel = document.getElementById('jabatanFilter');
    const current = sel.value;
    sel.innerHTML = '<option value="">Semua Jabatan</option>';
    if (data.success && data.data) {
      data.data.forEach(j => {
        const opt = document.createElement('option');
        opt.value = j.jabatan;
        opt.textContent = `${j.jabatan} (${j.count})`;
        sel.appendChild(opt);
      });
    }
    sel.value = current;
  } catch (err) { /* silent */ }
}

async function loadTeachers() {
  try {
    const search = document.getElementById('teacherSearch')?.value || '';
    const jabatan = document.getElementById('jabatanFilter')?.value || '';
    const statusKepeg = document.getElementById('statusKepegawaianFilter')?.value || '';
    const params = new URLSearchParams({ page: teacherCurrentPage, limit: 20 });
    if (search) params.append('search', search);
    if (jabatan) params.append('jabatan', jabatan);
    if (statusKepeg) params.append('status_kepegawaian', statusKepeg);
    let t = currentTenant;
    if (!t && currentUser?.assignments?.length) {
      const s = currentUser.assignments.find(a => (a.jabatan_di_unit||'').toLowerCase().includes('sdm'));
      t = s?.tenant_id || currentUser.assignments[0]?.tenant_id;
    }
    if (!t) t = window.userAssignments?.[0]?.tenant_id;
    if (t) params.append('tenant_id', t);

    const data = await api(`/sdm-dashboard/teacher-list?${params}`);
    const tbody = document.getElementById('sdmTeachersTable');
    if (data.success && data.data?.data?.length) {
      teacherTotalPages = data.data.pages;
      tbody.innerHTML = data.data.data.map(t => {
        const presentBadge = t.today_present > 0
          ? (t.today_late > 0 ? '<span class="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">Terlambat</span>' : '<span class="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">Hadir</span>')
          : '<span class="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">Belum</span>';
        return `
          <tr>
            <td class="px-4 py-3 text-sm font-medium text-gray-900">${escapeHtml(t.nama)}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${escapeHtml(t.nik || '-')}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${escapeHtml(t.nip || '-')}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${escapeHtml(t.jabatan_di_unit || '-')}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${escapeHtml(t.nama_sekolah || '-')}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${escapeHtml(t.status_kepegawaian || '-')}</td>
            <td class="px-4 py-3">${presentBadge}</td>
            <td class="px-4 py-3">
              <button onclick="viewTeacherDetail(${t.id})" class="text-indigo-600 hover:text-indigo-800 text-sm"><i class="fas fa-eye"></i></button>
            </td>
          </tr>`;
      }).join('');
      document.getElementById('teacherPaginationInfo').textContent = `Menampilkan ${data.data.data.length} dari ${data.data.total} data`;
      document.getElementById('teacherPrevPageBtn').disabled = teacherCurrentPage <= 1;
      document.getElementById('teacherNextPageBtn').disabled = teacherCurrentPage >= teacherTotalPages;
    } else {
      tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-12 text-center text-gray-500">Tidak ada data guru</td></tr>';
      document.getElementById('teacherPaginationInfo').textContent = 'Menampilkan 0 dari 0 data';
    }
  } catch (err) {
    document.getElementById('sdmTeachersTable').innerHTML = '<tr><td colspan="8" class="px-4 py-12 text-center text-red-500">Gagal memuat data</td></tr>';
  }
}

function changeTeacherPage(page) {
  if (page < 1 || page > teacherTotalPages) return;
  teacherCurrentPage = page;
  loadTeachers();
}

let searchDebounce;
function handleTeacherSearch(e) {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => { teacherCurrentPage = 1; loadTeachers(); }, 500);
}

function viewTeacherDetail(id) {
  Swal.fire({
    title: 'Detail Guru',
    html: `<p class="text-sm text-gray-600">ID Guru: ${id}</p><p class="text-sm text-gray-500 mt-2">Detail lengkap tersedia di database SDM.</p>`,
    confirmButtonText: 'Tutup',
    confirmButtonColor: '#4f46e5'
  });
}

// ============================================================
// KPI & EVALUASI
// ============================================================
async function switchKpiView(view) {
  ['overview', 'template', 'period'].forEach(v => {
    document.getElementById(`kpi${v.charAt(0).toUpperCase() + v.slice(1)}Section`)?.classList.add('hidden');
    document.getElementById(`kpi${v.charAt(0).toUpperCase() + v.slice(1)}Btn`)?.classList.remove('bg-indigo-600', 'text-white');
    document.getElementById(`kpi${v.charAt(0).toUpperCase() + v.slice(1)}Btn`)?.classList.add('bg-gray-200', 'text-gray-700');
  });
  document.getElementById(`kpi${view.charAt(0).toUpperCase() + view.slice(1)}Section`)?.classList.remove('hidden');
  document.getElementById(`kpi${view.charAt(0).toUpperCase() + view.slice(1)}Btn`)?.classList.add('bg-indigo-600', 'text-white');
  document.getElementById(`kpi${view.charAt(0).toUpperCase() + view.slice(1)}Btn`)?.classList.remove('bg-gray-200', 'text-gray-700');

  if (view === 'template') loadKpiTemplates();
  if (view === 'period') loadKpiPeriods();
  if (view === 'overview') loadKpiOverview();
}

async function loadKpiPeriods() {
  try {
    const [periodsData, teachersData] = await Promise.all([
      api('/sdm/kpi/periods'),
      api(isSdmPusat ? '/sdm-dashboard/teacher-list?limit=1000' : '/sdm-dashboard/teacher-list?limit=1000')
    ]);

    // Period select
    const sel = document.getElementById('kpiPeriodSelect');
    if (periodsData.success && periodsData.data?.length) {
      sel.innerHTML = '<option value="">Pilih periode...</option>';
      periodsData.data.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.nama} (${p.status})`;
        sel.appendChild(opt);
      });
      const active = periodsData.data.find(p => p.status === 'aktif');
      if (active) sel.value = active.id;
    } else {
      sel.innerHTML = '<option value="">Belum ada periode</option>';
    }

    // Teacher select
    const tsel = document.getElementById('kpiTeacherSelect');
    tsel.innerHTML = '<option value="">Semua Guru</option>';
    if (teachersData.success && teachersData.data?.data?.length) {
      teachersData.data.data.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = `${t.nama} - ${t.nama_sekolah || ''}`;
        tsel.appendChild(opt);
      });
    }

    // Period table
    const tbody = document.getElementById('kpiPeriodTable');
    if (periodsData.success && periodsData.data?.length) {
      tbody.innerHTML = periodsData.data.map(p => {
        const statusBadge = p.status === 'aktif'
          ? '<span class="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">Aktif</span>'
          : '<span class="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">Draft</span>';
        return `
          <tr>
            <td class="px-4 py-3 text-sm font-medium text-gray-900">${escapeHtml(p.nama)}</td>
            <td class="px-4 py-3 text-sm text-gray-700 capitalize">${escapeHtml(p.jenis)}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${p.tahun || '-'}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${p.tanggal_mulai ? formatDate(p.tanggal_mulai) : '-'}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${p.tanggal_selesai ? formatDate(p.tanggal_selesai) : '-'}</td>
            <td class="px-4 py-3">${statusBadge}</td>
            <td class="px-4 py-3">
              ${isSdmPusat ? `<button onclick="deleteKpiPeriod(${p.id})" class="text-red-600 hover:text-red-800 text-sm"><i class="fas fa-trash"></i></button>` : ''}
            </td>
          </tr>`;
      }).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-500">Belum ada periode</td></tr>';
    }
  } catch (err) {
    Swal.fire('Error', 'Gagal memuat periode penilaian KPI', 'error');
  }
}

async function loadKpiTemplates() {
  try {
    const kategori = document.getElementById('kpiKategoriSelect')?.value || '';
    const data = await api(`/sdm/kpi/templates${kategori ? `?kategori=${kategori}` : ''}`);
    const tbody = document.getElementById('kpiTemplateTable');
    if (data.success && data.data?.length) {
      tbody.innerHTML = data.data.map(t => {
        const sumberBadge = t.sumber === 'kehadiran'
          ? '<span class="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">Auto: Kehadiran</span>'
          : t.sumber === 'evaluasi'
          ? '<span class="px-2 py-1 text-xs font-medium bg-purple-100 text-purple-800 rounded-full">Auto: Evaluasi</span>'
          : '<span class="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">Manual</span>';
        return `
          <tr>
            <td class="px-4 py-3 text-sm font-medium text-gray-900">${escapeHtml(t.nama)}</td>
            <td class="px-4 py-3 text-sm text-gray-700 capitalize">${escapeHtml(t.kategori)}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${t.bobot}%</td>
            <td class="px-4 py-3 text-sm text-gray-700">${t.target_default}</td>
            <td class="px-4 py-3">${sumberBadge}</td>
            <td class="px-4 py-3">
              ${isSdmPusat ? `
              <button onclick="editKpiTemplate(${t.id})" class="text-indigo-600 hover:text-indigo-800 text-sm mr-2"><i class="fas fa-edit"></i></button>
              <button onclick="deleteKpiTemplate(${t.id})" class="text-red-600 hover:text-red-800 text-sm"><i class="fas fa-trash"></i></button>` : '<span class="text-xs text-gray-400">Read-only</span>'}
            </td>
          </tr>`;
      }).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-gray-500">Belum ada template KPI</td></tr>';
    }
  } catch (err) {
    Swal.fire('Error', 'Gagal memuat template KPI', 'error');
  }
}

async function loadKpiOverview() {
  const periodId = document.getElementById('kpiPeriodSelect')?.value || '';
  const kategori = document.getElementById('kpiKategoriSelect')?.value || '';
  
  try {
    let tK2=currentTenant; if(!tK2&&currentUser?.assignments?.length){ const sa=currentUser.assignments.find(a=>(a.jabatan_di_unit||"").toLowerCase().includes("sdm")); tK2=sa?.tenant_id||currentUser.assignments[0]?.tenant_id; } const data = await api(`/sdm-dashboard/kpi-summary?period_id=${periodId}${kategori ? `&kategori=${kategori}` : ""}${tK2 ? `&tenant_id=${tK2}` : ""}`);
    const tbody = document.getElementById('kpiByJabatanTable');
    if (data.success && data.data?.by_jabatan?.length) {
      tbody.innerHTML = data.data.by_jabatan.map(j => {
        const ach = j.avg_achievement || 0;
        const barColor = ach >= 90 ? 'bg-green-500' : ach >= 75 ? 'bg-yellow-500' : 'bg-red-500';
        return `
          <tr>
            <td class="px-4 py-3 text-sm font-medium text-gray-900">${escapeHtml(j.jabatan)}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${j.total_guru}</td>
            <td class="px-4 py-3">
              <div class="flex items-center">
                <div class="w-24 bg-gray-200 rounded-full h-2 mr-2">
                  <div class="${barColor} h-2 rounded-full kpi-progress-bar" style="width: ${ach}%"></div>
                </div>
                <span class="text-sm text-gray-700">${ach}%</span>
              </div>
            </td>
            <td class="px-4 py-3 text-sm font-semibold text-gray-900">${j.avg_score}</td>
          </tr>`;
      }).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="4" class="px-4 py-8 text-center text-gray-500">Belum ada data KPI</td></tr>';
    }
  } catch (err) {
    Swal.fire('Error', 'Gagal memuat ringkasan KPI', 'error');
  }

  // If teacher selected, load input table
  const teacherId = document.getElementById('kpiTeacherSelect')?.value || '';
  if (teacherId && periodId) {
    loadKpiInputTable(teacherId, periodId);
  } else {
    document.getElementById('kpiInputTable').innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-500">Pilih guru dan periode untuk mengisi nilai KPI</td></tr>';
  }
}

async function loadKpiTeacherDetail() {
  const teacherId = document.getElementById('kpiTeacherSelect')?.value || '';
  const periodId = document.getElementById('kpiPeriodSelect')?.value || '';
  const kategori = document.getElementById('kpiKategoriSelect')?.value || '';

  if (!periodId) {
    Swal.fire('Info', 'Pilih periode penilaian terlebih dahulu', 'info');
    return;
  }

  try {
    const data = await api(`/sdm-dashboard/kpi-summary?period_id=${periodId}${kategori ? `&kategori=${kategori}` : ''}`);
    const tbody = document.getElementById('kpiByJabatanTable');
    if (data.success && data.data?.by_jabatan?.length) {
      tbody.innerHTML = data.data.by_jabatan.map(j => {
        const ach = j.avg_achievement || 0;
        const barColor = ach >= 90 ? 'bg-green-500' : ach >= 75 ? 'bg-yellow-500' : 'bg-red-500';
        return `
          <tr>
            <td class="px-4 py-3 text-sm font-medium text-gray-900">${escapeHtml(j.jabatan)}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${j.total_guru}</td>
            <td class="px-4 py-3">
              <div class="flex items-center">
                <div class="w-24 bg-gray-200 rounded-full h-2 mr-2">
                  <div class="${barColor} h-2 rounded-full kpi-progress-bar" style="width: ${ach}%"></div>
                </div>
                <span class="text-sm text-gray-700">${ach}%</span>
              </div>
            </td>
            <td class="px-4 py-3 text-sm font-semibold text-gray-900">${j.avg_score}</td>
          </tr>`;
      }).join('');
    }
  } catch (err) {
    Swal.fire('Error', 'Gagal memuat detail KPI guru', 'error');
  }

  if (teacherId && periodId) loadKpiInputTable(teacherId, periodId);
}

async function loadKpiInputTable(teacherId, periodId) {
  try {
    const [templatesRes, assessmentRes] = await Promise.all([
      api('/sdm/kpi/templates'),
      api(`/sdm/kpi/assessment-detail?teacher_id=${teacherId}&period_id=${periodId}`)
    ]);

    const templates = templatesRes.success ? templatesRes.data : [];
    const scores = {};
    if (assessmentRes.success && assessmentRes.data?.length) {
      assessmentRes.data.forEach(a => { scores[a.indicator_id] = a; });
    }

    const tbody = document.getElementById('kpiInputTable');
    if (!templates.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-500">Belum ada template KPI</td></tr>';
      return;
    }

    tbody.innerHTML = templates.map(t => {
      const existing = scores[t.id];
      const nilai = existing?.nilai_aktual ?? '';
      const target = existing?.target ?? t.target_default;
      const penc = existing?.pencapaian ?? '';
      const skor = existing?.skor ?? '';
      const disabled = t.sumber !== 'manual' ? 'disabled' : '';
      const hasScore = existing && existing.nilai_aktual !== null && existing.nilai_aktual !== '';
      return `
        <tr data-indicator-id="${t.id}">
          <td class="px-4 py-3 text-sm font-medium text-gray-900">${escapeHtml(t.nama)}</td>
          <td class="px-4 py-3 text-sm text-gray-700 capitalize">${escapeHtml(t.kategori)}</td>
          <td class="px-4 py-3 text-sm text-gray-700">${t.bobot}%</td>
          <td class="px-4 py-3"><input type="number" class="kpi-target w-24 px-2 py-1 border border-gray-300 rounded text-sm" value="${target}" ${disabled}></td>
          <td class="px-4 py-3"><input type="number" class="kpi-nilai w-24 px-2 py-1 border border-gray-300 rounded text-sm" value="${nilai}" ${disabled}></td>
          <td class="px-4 py-3"><input type="number" class="kpi-pencapaian w-24 px-2 py-1 border border-gray-300 rounded text-sm" value="${penc}" ${disabled}></td>
          <td class="px-4 py-3"><input type="number" class="kpi-skor w-20 px-2 py-1 border border-gray-300 rounded text-sm" value="${skor}" ${disabled}></td>
          <td class="px-4 py-3 text-center">
            ${hasScore && !disabled ? `<button onclick="clearKpiScore(${t.id}, '${escapeHtml(t.nama).replace(/'/g, "\\'")}')" class="text-xs text-red-600 hover:text-red-800" title="Hapus nilai"><i class="fas fa-trash"></i></button>` : ''}
          </td>
        </tr>`;
    }).join('');
  } catch (err) {
    Swal.fire('Error', 'Gagal memuat tabel input KPI', 'error');
  }
}

async function clearKpiScore(indicatorId, indicatorName) {
  const teacherId = document.getElementById('kpiTeacherSelect')?.value;
  const periodId = document.getElementById('kpiPeriodSelect')?.value;
  if (!teacherId || !periodId) return;

  const confirm = await Swal.fire({
    title: 'Hapus nilai KPI?',
    html: `Nilai untuk indikator <strong>${escapeHtml(indicatorName)}</strong> akan dihapus.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Ya, hapus',
    confirmButtonColor: '#dc2626'
  });
  if (!confirm.isConfirmed) return;

  try {
    Swal.fire({ title: 'Menghapus...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    // Kirim nilai kosong untuk menghapus assessment
    await api('/sdm/kpi/assessments', {
      method: 'POST',
      body: JSON.stringify({
        teacher_id: parseInt(teacherId),
        indicator_id: parseInt(indicatorId),
        period_id: parseInt(periodId),
        nilai_aktual: null,
        target: null,
        pencapaian: null,
        skor: null
      })
    });
    Swal.fire('Berhasil', 'Nilai KPI dihapus', 'success');
    loadKpiInputTable(teacherId, periodId);
    loadKpiOverview();
  } catch (err) {
    Swal.fire('Error', err.message || 'Gagal menghapus nilai KPI', 'error');
  }
}

async function saveKpiScores() {
  const teacherId = document.getElementById('kpiTeacherSelect')?.value;
  const periodId = document.getElementById('kpiPeriodSelect')?.value;
  if (!teacherId || !periodId) {
    Swal.fire('Peringatan', 'Pilih guru dan periode terlebih dahulu', 'warning');
    return;
  }
  if (!isSdmPusat) {
    Swal.fire('Akses Ditolak', 'Hanya SDM Pusat yang boleh menginput nilai KPI', 'error');
    return;
  }

  const rows = document.querySelectorAll('#kpiInputTable tr[data-indicator-id]');
  const assessments = [];
  rows.forEach(row => {
    const indicatorId = row.dataset.indicatorId;
    const nilai = row.querySelector('.kpi-nilai').value;
    const target = row.querySelector('.kpi-target').value;
    const penc = row.querySelector('.kpi-pencapaian').value;
    const skor = row.querySelector('.kpi-skor').value;
    if (nilai !== '') {
      assessments.push({
        teacher_id: parseInt(teacherId),
        indicator_id: parseInt(indicatorId),
        nilai_aktual: parseFloat(nilai),
        target: parseFloat(target) || null,
        pencapaian: penc ? parseFloat(penc) : null,
        skor: skor ? parseFloat(skor) : null
      });
    }
  });

  if (!assessments.length) {
    Swal.fire('Info', 'Belum ada nilai yang diisi', 'info');
    return;
  }

  try {
    Swal.fire({
      title: 'Menyimpan...',
      html: '<div style="text-align:left;margin-top:1rem;"><div class="swal2-progress-steps" style="margin-bottom:0.5rem;font-size:0.85rem;color:#666;"></div><div class="swal2-progress-bar" style="width:100%;background:#eee;height:4px;border-radius:2px;"><div id="kpiSaveProgress" style="width:0%;background:#4f46e5;height:4px;border-radius:2px;transition:width 0.3s;"></div></div><div id="kpiSaveStatus" style="margin-top:0.5rem;font-size:0.8rem;color:#888;">Memproses 0 dari ' + assessments.length + ' indikator...</div></div>',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    // Gunakan bulk endpoint jika tersedia
    const bulkPayload = assessments.map(a => ({
      ...a,
      period_id: parseInt(periodId)
    }));

    let result;
    try {
      result = await api('/sdm/kpi/assessments/bulk', {
        method: 'POST',
        body: JSON.stringify({ assessments: bulkPayload })
      });
    } catch (bulkErr) {
      // Fallback: sequential save jika bulk endpoint tidak tersedia
      let successCount = 0;
      for (let i = 0; i < assessments.length; i++) {
        const a = assessments[i];
        const progress = ((i + 1) / assessments.length) * 100;
        document.getElementById('kpiSaveProgress').style.width = progress + '%';
        document.getElementById('kpiSaveStatus').textContent = `Memproses ${i + 1} dari ${assessments.length} indikator...`;
        try {
          await api('/sdm/kpi/assessments', { method: 'POST', body: JSON.stringify({ ...a, period_id: parseInt(periodId) }) });
          successCount++;
        } catch (e) {
          console.error(`Gagal menyimpan indikator ${a.indicator_id}:`, e);
        }
      }
      result = { success: true, message: `${successCount} dari ${assessments.length} nilai KPI tersimpan` };
    }

    document.getElementById('kpiSaveProgress').style.width = '100%';
    document.getElementById('kpiSaveStatus').textContent = 'Selesai!';

    await new Promise(r => setTimeout(r, 500));

    if (result.success) {
      Swal.fire('Berhasil', result.message || `${assessments.length} nilai KPI tersimpan`, 'success');
      loadKpiOverview();
    } else {
      Swal.fire('Gagal', result.message || 'Gagal menyimpan nilai KPI', 'error');
    }
  } catch (err) {
    Swal.fire('Error', err.message || 'Gagal menyimpan nilai KPI', 'error');
  }
}

function applyKpiAccessControl() {
  if (isSdmPusat) return; // SDM Pusat memiliki akses penuh

  // Non-SDM Pusat: read-only untuk semua fitur manajemen KPI
  const disabledEls = document.querySelectorAll('#kpiTemplateBtn, #kpiPeriodBtn, button[onclick*="saveKpi"], button[onclick*="showKpiTemplateModal"], button[onclick*="showKpiPeriodModal"]');
  disabledEls.forEach(el => el.disabled = true);

  // Sembunyikan tombol aksi manajemen
  const hideEls = document.querySelectorAll('.kpi-manage-action');
  hideEls.forEach(el => el.style.display = 'none');

  // Tampilkan pesan read-only
  const overviewSection = document.getElementById('kpiOverviewSection');
  if (overviewSection) {
    const existingMsg = overviewSection.querySelector('.kpi-readonly-msg');
    if (!existingMsg) {
      const msg = document.createElement('div');
      msg.className = 'kpi-readonly-msg';
      msg.innerHTML = '<div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6"><div class="flex items-start"><i class="fas fa-info-circle text-blue-600 mt-0.5 mr-3"></i><div class="text-sm text-blue-800"><p class="font-semibold mb-1">Akses Read-Only</p><p>Anda bukan SDM Pusat. Hanya dapat melihat data KPI, tidak dapat mengedit atau menambah template/periode.</p></div></div></div>';
      overviewSection.insertBefore(msg, overviewSection.firstChild);
    }
  }
}

// Template Modal
function showKpiTemplateModal(id = null) {
  if (!isSdmPusat) {
    Swal.fire('Akses Ditolak', 'Hanya SDM Pusat yang boleh mengelola template KPI', 'error');
    return;
  }
  document.getElementById('kpiTemplateId').value = id || '';
  document.getElementById('kpiTemplateModalTitle').textContent = id ? 'Edit Template KPI' : 'Tambah Template KPI';
  document.getElementById('kpiTemplateModal').classList.remove('hidden');
  document.getElementById('kpiTemplateModal').classList.add('show');
  if (id) loadKpiTemplateData(id);
}

function closeKpiTemplateModal() {
  document.getElementById('kpiTemplateModal').classList.add('hidden');
  document.getElementById('kpiTemplateModal').classList.remove('show');
  ['kpiTemplateNama', 'kpiTemplateBobot', 'kpiTemplateTarget', 'kpiTemplateKeterangan'].forEach(i => document.getElementById(i).value = '');
}

async function loadKpiTemplateData(id) {
  try {
    const data = await api('/sdm/kpi/templates');
    const t = data.data?.find(x => x.id === id);
    if (t) {
      document.getElementById('kpiTemplateNama').value = t.nama;
      document.getElementById('kpiTemplateKategori').value = t.kategori;
      document.getElementById('kpiTemplateBobot').value = t.bobot;
      document.getElementById('kpiTemplateTarget').value = t.target_default;
      document.getElementById('kpiTemplateSumber').value = t.sumber;
      document.getElementById('kpiTemplateKeterangan').value = t.keterangan || '';
    }
  } catch (err) { /* silent */ }
}

function editKpiTemplate(id) { showKpiTemplateModal(id); }

async function saveKpiTemplate() {
  const payload = {
    id: document.getElementById('kpiTemplateId').value || null,
    nama: document.getElementById('kpiTemplateNama').value,
    kategori: document.getElementById('kpiTemplateKategori').value,
    bobot: parseFloat(document.getElementById('kpiTemplateBobot').value) || 0,
    target_default: parseFloat(document.getElementById('kpiTemplateTarget').value) || 100,
    sumber: document.getElementById('kpiTemplateSumber').value,
    keterangan: document.getElementById('kpiTemplateKeterangan').value
  };
  if (!payload.nama) { Swal.fire('Peringatan', 'Nama indikator wajib diisi', 'warning'); return; }

  // Validasi total bobot wajib 100% (untuk kategori yang sama atau semua)
  try {
    const templatesRes = await api('/sdm/kpi/templates');
    if (templatesRes.success && templatesRes.data) {
      const existingTotal = templatesRes.data.reduce((sum, t) => {
        // Jika edit, ganti bobot lama dengan bobot baru
        if (payload.id && t.id == payload.id) return sum;
        return sum + parseFloat(t.bobot || 0);
      }, 0);
      const newTotal = existingTotal + payload.bobot;
      if (Math.abs(newTotal - 100) > 0.01) {
        Swal.fire('Peringatan', `Total bobot semua indikator wajib 100%. Saat ini: ${newTotal.toFixed(2)}%`, 'warning');
        return;
      }
    }
  } catch (err) { /* lanjut walau gagal cek total bobot */ }

  try {
    await api('/sdm/kpi/templates', { method: 'POST', body: JSON.stringify(payload) });
    Swal.fire('Berhasil', 'Template KPI tersimpan', 'success');
    closeKpiTemplateModal();
    loadKpiTemplates();
  } catch (err) {
    Swal.fire('Error', err.message || 'Gagal menyimpan template', 'error');
  }
}

async function deleteKpiTemplate(id) {
  const confirm = await Swal.fire({ title: 'Hapus template?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Ya, hapus', confirmButtonColor: '#dc2626' });
  if (!confirm.isConfirmed) return;
  try {
    await api(`/sdm/kpi/templates/${id}`, { method: 'DELETE' });
    Swal.fire('Dihapus', 'Template KPI nonaktif', 'success');
    loadKpiTemplates();
  } catch (err) {
    Swal.fire('Error', err.message || 'Gagal menghapus', 'error');
  }
}

// Period Modal
function showKpiPeriodModal() {
  if (!isSdmPusat) {
    Swal.fire('Akses Ditolak', 'Hanya SDM Pusat yang boleh membuat periode penilaian', 'error');
    return;
  }
  document.getElementById('kpiPeriodModal').classList.remove('hidden');
  document.getElementById('kpiPeriodModal').classList.add('show');
  document.getElementById('kpiPeriodTahun').value = new Date().getFullYear();
}

function closeKpiPeriodModal() {
  document.getElementById('kpiPeriodModal').classList.add('hidden');
  document.getElementById('kpiPeriodModal').classList.remove('show');
}

async function saveKpiPeriod() {
  const payload = {
    nama: document.getElementById('kpiPeriodNama').value,
    jenis: document.getElementById('kpiPeriodJenis').value,
    tahun: parseInt(document.getElementById('kpiPeriodTahun').value) || new Date().getFullYear(),
    tanggal_mulai: document.getElementById('kpiPeriodMulai').value || null,
    tanggal_selesai: document.getElementById('kpiPeriodSelesai').value || null
  };
  if (!payload.nama) { Swal.fire('Peringatan', 'Nama periode wajib diisi', 'warning'); return; }

  try {
    await api('/sdm/kpi/periods', { method: 'POST', body: JSON.stringify(payload) });
    Swal.fire('Berhasil', 'Periode penilaian dibuat', 'success');
    closeKpiPeriodModal();
    document.getElementById('kpiPeriodNama').value = '';
    loadKpiPeriods();
  } catch (err) {
    Swal.fire('Error', err.message || 'Gagal membuat periode', 'error');
  }
}

async function deleteKpiPeriod(id) {
  const confirm = await Swal.fire({ title: 'Batalkan periode?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Ya, batalkan', confirmButtonColor: '#dc2626' });
  if (!confirm.isConfirmed) return;
  try {
    await api(`/sdm/kpi/periods/${id}`, { method: 'DELETE' });
    Swal.fire('Dibatalkan', 'Periode penilaian dibatalkan', 'success');
    loadKpiPeriods();
  } catch (err) {
    Swal.fire('Error', err.message || 'Gagal membatalkan periode', 'error');
  }
}

// ============================================================
// ATTENDANCE LOGS
// ============================================================
async function loadAttendanceLogs() {
  try {
    const date = document.getElementById('attendanceDateFilter')?.value || new Date().toISOString().split('T')[0];
    const status = document.getElementById('attendanceStatusFilter')?.value || '';
    const params = new URLSearchParams({ date });
    if (status) params.append('status', status);
    let t = currentTenant;
    if (!t && currentUser?.assignments?.length) {
      const s = currentUser.assignments.find(a => (a.jabatan_di_unit||'').toLowerCase().includes('sdm'));
      t = s?.tenant_id || currentUser.assignments[0]?.tenant_id;
    }
    if (!t) t = window.userAssignments?.[0]?.tenant_id;
    if (t) params.append('tenant_id', t);

    const data = await api(`/sdm-dashboard/attendance-logs?${params}`);
    const tbody = document.getElementById('sdmAttendanceTable');
    if (data.success && data.data?.length) {
      tbody.innerHTML = data.data.slice(0, 200).map(a => {
        const statusBadge = a.status === 'tepat_waktu'
          ? '<span class="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">Tepat Waktu</span>'
          : '<span class="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full">Terlambat</span>';
        const jenisLabel = a.jenis === 'masuk' ? 'Masuk' : a.jenis === 'pulang' ? 'Pulang' : (a.jenis || '-');
        return `
          <tr>
            <td class="px-4 py-3 text-sm font-medium text-gray-900">${escapeHtml(a.nama || '-')}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${escapeHtml(a.nama_sekolah || a.tenant_id || '-')}</td>
            <td class="px-4 py-3 text-sm text-gray-700 capitalize">${escapeHtml(jenisLabel)}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${formatDateTime(a.waktu_scan)}</td>
            <td class="px-4 py-3">${statusBadge}</td>
            <td class="px-4 py-3 text-sm text-gray-500">${escapeHtml(a.metode || '-')}</td>
          </tr>`;
      }).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-12 text-center text-gray-500">Tidak ada data kehadiran</td></tr>';
    }
  } catch (err) {
    Swal.fire('Error', err.message || 'Gagal memuat data kehadiran', 'error');
    document.getElementById('sdmAttendanceTable').innerHTML = '<tr><td colspan="6" class="px-4 py-12 text-center text-red-500">Gagal memuat data kehadiran</td></tr>';
  }
}

// ============================================================
// REKAP BULANAN KEHADIRAN
// ============================================================


function initMonthlyRecapSelectors() {
  const bulanSel = document.getElementById('recapBulan');
  const tahunSel = document.getElementById('recapTahun');
  const now = new Date();

  if (bulanSel && !bulanSel.dataset.initialized) {
    bulanSel.value = now.getMonth() + 1;
    bulanSel.dataset.initialized = 'true';
  }
  if (tahunSel && tahunSel.options.length === 0) {
    const currentYear = now.getFullYear();
    for (let y = currentYear; y >= currentYear - 2; y--) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      tahunSel.appendChild(opt);
    }
    tahunSel.value = currentYear;
  }
}

function initPayrollSelectors() {
  initMonthlyRecapSelectors();
}

function exportPayrollPDF() {
  Swal.fire('Info', 'Export PDF payroll terhubung ke database SDM', 'info');
}

function showToast(msg, type) {
  const t = document.createElement('div');
  t.className = 'fixed top-4 right-4 z-[100] p-4 rounded-lg shadow-lg max-w-sm text-sm ' + (type === 'success' ? 'bg-green-500 text-white' : type === 'error' ? 'bg-red-500 text-white' : 'bg-blue-500 text-white');
  t.style.zIndex = '9999';
  t.innerHTML = '<div class="flex items-center"><i class="fas ' + (type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle') + ' mr-2"></i><span>' + msg + '</span></div>';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

async function loadAttendanceRecap() {
  const tenantSelect = document.getElementById('recapTenantSelect');
  if (!tenantSelect) return;
  if (tenantSelect.options.length <= 1) {
    tenantSelect.innerHTML = '<option value="">Memuat sekolah...</option>';
  }
  const monthSelect = document.getElementById('recapBulan');
  if (monthSelect && !monthSelect.dataset.defaulted) {
    monthSelect.value = String(new Date().getMonth() + 1);
    monthSelect.dataset.defaulted = '1';
  }
  try {
    const data = await api('/sdm-dashboard/tenants');
    if (data.success && data.data) {
      const opts = data.data.map(t => '<option value="' + t.tenant_id + '">' + (t.nama_sekolah || t.tenant_id) + '</option>').join('');
      tenantSelect.innerHTML = '<option value="">Semua Sekolah</option>' + opts;
    }
  } catch (e) {
    console.error('loadAttendanceRecap error:', e);
  }
}

window.loadMonthlyRecap = async function (mode = 'hadir') {
  const monthNames = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const tenantId = document.getElementById('recapTenantSelect')?.value;
  const month = document.getElementById('recapBulan')?.value;
  const year = document.getElementById('recapTahun')?.value;
  const content = document.getElementById('monthlyRecapContent');
  if (!tenantId || !month || !year) { showToast('Pilih sekolah, bulan, dan tahun', 'error'); return; }
  content.innerHTML = '<p class="text-center py-8"><i class="fas fa-spinner fa-spin"></i> Memuat...</p>';
  try {
    const res = await fetch('/api/admin/attendance-monthly?tenant_id=' + tenantId + '&bulan=' + month + '&tahun=' + year, { headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' } });
    const json = await res.json();
    if (!json.success) { showToast('Gagal memuat data', 'error'); return; }
    const data = json.data;
    const daysInMonth = json.daysInMonth || 30;
    const isLengkap = mode === 'lengkap';
    if (isLengkap) {
      let headerHtml = '<tr><th rowspan="2" class="p-1 border">No</th><th rowspan="2" class="p-1 border">Nama</th><th colspan="' + daysInMonth + '" class="p-1 border">Bulan: ' + monthNames[parseInt(month)] + ' ' + year + '</th><th colspan="3" class="p-1 border bg-blue-50">Datang</th><th colspan="3" class="p-1 border bg-red-50">Pulang</th><th colspan="4" class="p-1 border bg-purple-50">Izin</th><th colspan="1" class="p-1 border bg-red-100">Tanpa Keterangan</th></tr><tr>';
      for (let d = 1; d <= daysInMonth; d++) headerHtml += '<th class="p-1 border">' + d + '</th>';
      headerHtml += '<th class="p-1 border bg-blue-50 text-[10px]">Tepat Waktu</th><th class="p-1 border bg-blue-50 text-[10px]">Terlambat</th><th class="p-1 border bg-blue-50 text-[10px]">Tidak Absen</th>';
      headerHtml += '<th class="p-1 border bg-red-50 text-[10px]">Tepat Waktu</th><th class="p-1 border bg-red-50 text-[10px]">Pulang Cepat</th><th class="p-1 border bg-red-50 text-[10px]">Tidak Absen</th>';
      headerHtml += '<th class="p-1 border bg-purple-50 text-[10px]">Izin</th><th class="p-1 border bg-purple-50 text-[10px]">Sakit</th><th class="p-1 border bg-purple-50 text-[10px]">Dinas Luar</th><th class="p-1 border bg-purple-50 text-[10px]">Cuti</th>';
      headerHtml += '<th class="p-1 border bg-red-100 text-[10px]">Tanpa Keterangan</th></tr>';
      let bodyHtml = '';
      data.forEach((d, i) => {
        bodyHtml += '<tr><td class="p-1 text-center border">' + (i + 1) + '</td><td class="p-1 border">' + (d.nama || '') + '</td>';
        for (let day = 1; day <= daysInMonth; day++) {
          const masuk = d['tgl_' + day + '_masuk'] || '';
          const pulang = d['tgl_' + day + '_pulang'] || '';
          const statusLabelRaw = d['tgl_' + day] || '';
          const labelClean = statusLabelRaw.replace(/<[^>]*>/g, '').trim();
          let keteranganText = '';
          if (labelClean) {
            const labelMap = { 'TK': 'TK', 'I': 'Izin', 'S': 'Sakit', 'DL': 'Dinas Luar', 'C': 'Cuti' };
            const mappedLabel = labelMap[labelClean] || labelClean;
            if (labelClean === 'TK' || labelClean === 'I' || labelClean === 'S' || labelClean === 'DL' || labelClean === 'C') {
              keteranganText = '<span class="text-[12px] font-bold text-gray-700 block">' + mappedLabel + '</span>';
            }
          }
          const masukColor = (labelClean === 'TK' || labelClean === 'C' || labelClean === 'I' || labelClean === 'S' || labelClean === 'DL') ? 'text-red-600' : (labelClean === 'T') ? 'text-amber-600' : 'text-emerald-600';
          const pulangColor = (labelClean === 'TK' || labelClean === 'C' || labelClean === 'I' || labelClean === 'S' || labelClean === 'DL') ? 'text-red-600' : 'text-rose-600';
          let cellContent = '';
          if (masuk || pulang) {
            cellContent = '<span class="text-[12px] ' + masukColor + ' block font-medium">' + (masuk || '-') + '</span><span class="text-[11px] ' + pulangColor + '">' + (pulang || '-') + '</span>' + keteranganText;
          } else if (!masuk && !pulang) {
            cellContent = '<span class="text-[12px] text-gray-300">-</span>' + keteranganText;
          }
          bodyHtml += '<td class="p-1 text-center border align-top leading-tight">' + cellContent + '</td>';
        }
        bodyHtml += '<td class="p-1 text-center border text-[11px] text-blue-600 font-bold">' + (d.hadir || 0) + '</td><td class="p-1 text-center border text-[11px] text-yellow-600 font-bold">' + (d.terlambat || 0) + '</td><td class="p-1 text-center border text-[11px] text-red-600 font-bold">' + Math.max(0, daysInMonth - (d.hadir||0) - (d.terlambat||0) - (d.izin||0) - (d.sakit||0) - (d.dinas_luar||0) - (d.cuti||0)) + '</td>';
        bodyHtml += '<td class="p-1 text-center border text-[11px] text-blue-600 font-bold">' + (d.hadir || 0) + '</td><td class="p-1 text-center border text-[11px] text-orange-600 font-bold">0</td><td class="p-1 text-center border text-[11px] text-red-700 font-bold">' + Math.max(0, daysInMonth - (d.hadir||0) - (d.terlambat||0) - (d.izin||0) - (d.sakit||0) - (d.dinas_luar||0) - (d.cuti||0)) + '</td>';
        bodyHtml += '<td class="p-1 text-center border text-[11px] text-purple-600 font-bold">' + (d.izin || 0) + '</td><td class="p-1 text-center border text-[11px] text-red-600 font-bold">' + (d.sakit || 0) + '</td><td class="p-1 text-center border text-[11px] text-blue-600 font-bold">' + (d.dinas_luar || 0) + '</td><td class="p-1 text-center border text-[11px] text-purple-500 font-bold">' + (d.cuti || 0) + '</td>';
        bodyHtml += '<td class="p-1 text-center border text-[11px] text-red-700 font-bold">' + (d.tanpa_keterangan || 0) + '</td></tr>';
      });
      let totalHadir = 0, totalTerlambat = 0, totalIzin = 0, totalSakit = 0, totalCuti = 0, totalDinasLuar = 0, totalTanpaKeterangan = 0;
      data.forEach(d => {
        totalHadir += d.hadir || 0; totalTerlambat += d.terlambat || 0; totalIzin += d.izin || 0; totalSakit += d.sakit || 0; totalCuti += d.cuti || 0; totalDinasLuar += d.dinas_luar || 0; totalTanpaKeterangan += d.tanpa_keterangan || 0;
      });
      const summaryHtml = `<div class="mt-4 p-4 bg-gradient-to-r from-slate-50 to-blue-50 rounded-xl border border-slate-200 shadow-sm"><h4 class="font-bold text-gray-900 mb-4 flex items-center text-base"><i class="fas fa-chart-pie text-indigo-600 mr-2"></i>Ringkasan Kategori - Rekap Lengkap</h4><div class="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">` +
        `<div class="bg-red-100 p-3 rounded-lg border shadow-sm"><p class="text-sm font-bold text-red-800 mb-1 tracking-wide">TANPA KETERANGAN</p><p class="text-sm font-bold text-red-900">${totalTanpaKeterangan}</p><p class="text-sm text-red-600">TK - tanpa catatan absen</p></div>` +
        `<div class="bg-purple-50 p-3 rounded-lg border shadow-sm"><p class="text-sm font-bold text-purple-700 mb-1 tracking-wide">IZIN</p><p class="text-sm text-purple-700">Izin: <b class="text-purple-600">${totalIzin}</b> | Sakit: <b class="text-red-600">${totalSakit}</b></p><p class="text-sm text-purple-700">Dinas Luar: <b class="text-blue-600">${totalDinasLuar}</b> | Cuti: <b class="text-purple-500">${totalCuti}</b></p></div>` +
        `<div class="bg-gradient-to-r from-indigo-50 to-blue-50 p-3 rounded-lg border shadow-sm"><p class="text-sm font-bold text-indigo-800 mb-1 tracking-wide">DATANG</p><p class="text-sm text-indigo-700">Tepat Waktu: <b class="text-indigo-900">${totalHadir}</b> | Terlambat: <b class="text-amber-700">${totalTerlambat}</b></p></div>` +
        `<div class="bg-gradient-to-r from-red-50 to-orange-50 p-3 rounded-lg border shadow-sm"><p class="text-sm font-bold text-red-700 mb-1 tracking-wide">PULANG</p><p class="text-sm text-red-700">Tepat Waktu: <b class="text-blue-700">${totalHadir}</b> | Pulang Cepat: <b class="text-orange-700">0</b></p></div>` +
        `<div class="bg-gradient-to-r from-emerald-50 to-blue-50 p-3 rounded-lg border shadow-sm"><p class="text-sm font-bold text-emerald-700 mb-1 tracking-wide">TOTAL</p><p class="text-sm text-emerald-700">Guru: <b class="text-emerald-900">${data.length}</b> | Hari: <b>${daysInMonth}</b></p></div>` +
        `</div></div>`;
      content.innerHTML = '<div class="overflow-x-auto"><table class="w-full text-sm border-collapse"><thead>' + headerHtml + '</thead><tbody>' + bodyHtml + '</tbody></table></div>' + summaryHtml;
    } else {
      let headerHtml = '<tr><th rowspan="2" class="p-1 border">No</th><th rowspan="2" class="p-1 border">Nama</th><th colspan="' + daysInMonth + '" class="p-1 border">Bulan: ' + monthNames[parseInt(month)] + ' ' + year + '</th><th colspan="7" class="p-1 border">Keterangan</th></tr><tr>';
      for (let d = 1; d <= daysInMonth; d++) headerHtml += '<th class="p-1 border">' + d + '</th>';
      headerHtml += '<th class="p-1 border">H</th><th class="p-1 border">T</th><th class="p-1 border">I</th><th class="p-1 border">S</th><th class="p-1 border">D</th><th class="p-1 border">C</th><th class="p-1 border">TK</th></tr>';
      let bodyHtml = '';
      data.forEach((d, i) => {
        bodyHtml += '<tr><td class="p-1 text-center border">' + (i + 1) + '</td><td class="p-1 border">' + (d.nama || '') + '</td>';
        for (let day = 1; day <= daysInMonth; day++) bodyHtml += '<td class="p-1 text-center border">' + (d['tgl_' + day] || '') + '</td>';
        bodyHtml += '<td class="p-1 text-center border">' + (d.hadir || 0) + '</td><td class="p-1 text-center border">' + (d.terlambat || 0) + '</td><td class="p-1 text-center border">' + (d.izin || 0) + '</td><td class="p-1 text-center border">' + (d.sakit || 0) + '</td><td class="p-1 text-center border">' + (d.dinas_luar || 0) + '</td><td class="p-1 text-center border">' + (d.cuti || 0) + '</td><td class="p-1 text-center border">' + (d.tanpa_keterangan || 0) + '</td></tr>';
      });
      content.innerHTML = '<div class="overflow-x-auto"><table class="w-full text-sm border-collapse"><thead>' + headerHtml + '</thead><tbody>' + bodyHtml + '</tbody></table></div>';
    }
  } catch (e) { content.innerHTML = '<p class="text-red-500 p-4">Error: ' + e.message + '</p>'; }
};

window.exportMonthlyPdfFromRecap = async function () {
  const tenantId = document.getElementById('recapTenantSelect')?.value;
  const month = document.getElementById('recapBulan')?.value;
  const year = document.getElementById('recapTahun')?.value;
  const tenantName = document.getElementById('recapTenantSelect')?.selectedOptions[0]?.text || '';
  if (!tenantId || !month || !year) { showToast('Pilih sekolah, bulan, dan tahun', 'error'); return; }
  try {
    const res = await fetch('/api/admin/attendance-export-pdf?tenant_id=' + tenantId + '&bulan=' + month + '&tahun=' + year + '&tenant_name=' + encodeURIComponent(tenantName), { headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' } });
    if (!res.ok) {
      const json = await res.json().catch(() => ({ message: 'Gagal export PDF' }));
      showToast(json.message || 'Gagal export PDF', 'error');
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rekap_absensi_' + tenantId + '_' + year + month + '.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  } catch (e) {
    showToast('Gagal export PDF: ' + e.message, 'error');
  }
};

// ============================================================
// UTILITIES
// ============================================================
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatRupiah(num) {
  return 'Rp ' + (parseFloat(num) || 0).toLocaleString('id-ID');
}
