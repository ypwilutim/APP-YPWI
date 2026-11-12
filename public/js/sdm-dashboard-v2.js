// ============================================================
// SDM DASHBOARD V2 - Modular Architecture
// ============================================================

const SDMDashboard = (() => {
  'use strict';

  // ============================================================
  // PRIVATE STATE
  // ============================================================
  const state = {
    currentTab: 'dashboard',
    currentTenant: '',
    user: null,
    isSdmPusat: false,
    assignments: [],
    charts: {
      attendance: null,
      kpi: null
    },
    chartType: 'weekly',
    searchDebounce: {},
    teacherPage: 1,
    teacherFilters: {},
    teacherSub: 'data',
    penugasanPage: 1,
    penugasanCandidates: [],
    penugasanJabatanMap: {},
    penugasanPreviewData: null
  };

  // Constants
  const API_BASE = '/api';
  const SDM_PUSAT_TENANT = 'YPWILUTIM';
  const TABS = [
    'dashboard', 'access', 'teacher', 'kpi', 'absensi',
    'payroll', 'sk-guru',
    'rules', 'kafalah', 'qr-generator', 'idcard', 'settings'
  ];

  // ============================================================
  // UTILITY FUNCTIONS
  // ============================================================
  const Utils = {
    getAuthHeader() {
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      return token ? { 'Authorization': 'Bearer ' + token } : {};
    },

    escapeHtml(text) {
      if (text === null || text === undefined) return '';
      const map = {
        '&': '&amp;', '<': '&lt;', '>': '&gt;',
        '"': '&quot;', "'": '&#039;'
      };
      return String(text).replace(/[&<>"']/g, m => map[m]);
    },

    formatDate(dateStr) {
      if (!dateStr) return '-';
      try {
        return new Date(dateStr).toLocaleDateString('id-ID', {
          day: '2-digit', month: 'short', year: 'numeric'
        });
      } catch { return dateStr; }
    },

    formatRupiah(num) {
      if (num === null || num === undefined || num === '') return 'Rp 0';
      return new Intl.NumberFormat('id-ID', {
        style: 'currency', currency: 'IDR', minimumFractionDigits: 0
      }).format(num);
    },

    showToast(message, type = 'info') {
      const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
      });
      Toast.fire({ icon: type, title: message });
    },

    setVal(id, val) {
      const el = document.getElementById(id);
      if (el) el.value = val ?? '';
    },

    $(id) {
      return document.getElementById(id);
    },

    showModal(id) {
      const el = document.getElementById(id);
      if (el) {
        el.classList.remove('hidden');
        el.classList.add('show');
      }
    },

    hideModal(id) {
      const el = document.getElementById(id);
      if (el) {
        el.classList.add('hidden');
        el.classList.remove('show');
      }
    },

    debounce(fn, delay) {
      let timeoutId;
      return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), delay);
      };
    },

    async fillTenants(id, selected) {
      const sel = Utils.$(id);
      if (!sel) return;
      try {
        const data = await Api.get('/sdm-dashboard/tenants');
        if (data.success && Array.isArray(data.data)) {
          sel.innerHTML = data.data.map(t =>
            `<option value="${t.tenant_id}" ${t.tenant_id === selected ? 'selected' : ''}>${Utils.escapeHtml(t.nama_sekolah)}</option>`
          ).join('');
        }
      } catch (e) { /* silent */ }
    },

    fillYears(id, selected) {
      const sel = Utils.$(id);
      if (!sel) return;
      const now = new Date().getFullYear();
      const selYear = Number(selected) || now;
      let html = '';
      for (let y = now - 2; y <= now + 1; y++) {
        html += `<option value="${y}" ${y === selYear ? 'selected' : ''}>${y}</option>`;
      }
      sel.innerHTML = html;
    },

    parseJwt(token) {
      try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
      } catch (e) {
        return null;
      }
    }
  };

  // ============================================================
  // API LAYER
  // ============================================================
  const Api = {
    async request(endpoint, options = {}) {
      try {
        const res = await fetch(`${API_BASE}${endpoint}`, {
          headers: {
            'Authorization': `Bearer ${Utils.getAuthHeader().Authorization?.replace('Bearer ', '') || ''}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
          },
          ...options
        });

        if (res.status === 401 || res.status === 403) {
          const data = await res.json().catch(() => ({}));
          if (res.status === 401) Core.handleUnauthorized();
          throw new Error(data.message || 'Akses ditolak');
        }
        return await res.json();
      } catch (err) {
        console.error(`API error ${endpoint}:`, err);
        throw err;
      }
    },

    get(endpoint) {
      return this.request(endpoint, { method: 'GET' });
    },

    post(endpoint, body) {
      return this.request(endpoint, { method: 'POST', body: JSON.stringify(body) });
    },

    put(endpoint, body) {
      return this.request(endpoint, { method: 'PUT', body: JSON.stringify(body) });
    },

    delete(endpoint) {
      return this.request(endpoint, { method: 'DELETE' });
    }
  };

  // ============================================================
  // CORE MODULE (arrow functions to preserve 'this' context)
  // ============================================================
  const Core = {
    init: async () => {
      console.log('Initializing SDM Dashboard v2');

      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      if (!token) {
        window.location.href = 'login.html';
        return;
      }

      await Core.loadUserInfo();
      Core.setupEventListeners();
      Core.setCurrentDate();

      const today = new Date().toISOString().split('T')[0];
      Utils.$('attendanceDateFilter').value = today;

      await Core.loadTenantOptions();
      await Core.showTab('dashboard');
    },

    loadUserInfo: () => {
      try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const payload = Utils.parseJwt(token);
        if (!payload || !payload.id) return Core.handleUnauthorized();

state.user = {
          id: payload.id,
          username: payload.username,
          role: payload.role,
          guru_id: payload.guru_id,
          tenant_id: payload.tenant_id,
          assignments: payload.assignments || []
        };

        state.assignments = state.user.assignments;
        state.isSdmPusat = state.user.role === 'admin' || state.assignments.some(a =>
          (a.jabatan_di_unit || '').toLowerCase().includes('sdm') && a.tenant_id === SDM_PUSAT_TENANT
        );

        const hasSdmAccess = state.user.role === 'admin' || state.assignments.some(a =>
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
          }).then(() => Core.logout());
          return;
        }

        const roleLabel = state.user.role === 'admin'
          ? 'Administrator (Akses Penuh)'
          : (state.isSdmPusat ? 'SDM Pusat (YPWI Lutim)' : 'SDM Sekolah');

        Utils.$('sdmUserName').textContent = payload.username || 'User';
        Utils.$('sdmUserRole').textContent = roleLabel;

        if (state.isSdmPusat) {
          Utils.$('tenantFilterWrap').classList.remove('hidden');
        }
      } catch (err) {
        console.error('Token decode error:', err);
        Core.handleUnauthorized();
      }
    },

    handleUnauthorized: () => {
      localStorage.removeItem('token');
      sessionStorage.removeItem('token');
      window.location.href = 'login.html';
    },

    logout: () => {
      localStorage.removeItem('token');
      sessionStorage.removeItem('token');
      window.location.href = 'login.html';
    },

    setCurrentDate: () => {
      Utils.$('currentDate').textContent = new Date().toLocaleDateString('id-ID', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });
    },

    setupEventListeners: () => {
      document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => Core.showTab(btn.dataset.tab));
      });

      Utils.$('tenantSelect').addEventListener('change', () => Core.onTenantChange());

      Utils.$('kpiOverviewBtn')?.addEventListener('click', () => Kpi.switchView('overview'));
      Utils.$('kpiTemplateBtn')?.addEventListener('click', () => Kpi.switchView('template'));
      Utils.$('kpiPeriodBtn')?.addEventListener('click', () => Kpi.switchView('period'));

      Utils.$('chartWeeklyBtn')?.addEventListener('click', () => Core.switchChart('weekly'));
      Utils.$('chartMonthlyBtn')?.addEventListener('click', () => Core.switchChart('monthly'));
    },

    showTab: async (tabName) => {
      if (!TABS.includes(tabName)) return;

      document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
      document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.remove('nav-active');
        el.classList.add('text-gray-600', 'hover:bg-gray-100');
      });

      const tabEl = Utils.$(tabName + 'Tab');
      const btnEl = document.querySelector(`[data-tab="${tabName}"]`);
      if (tabEl) tabEl.classList.remove('hidden');
      if (btnEl) {
        btnEl.classList.add('nav-active');
        btnEl.classList.remove('text-gray-600', 'hover:bg-gray-100');
      }

      state.currentTab = tabName;

      const titles = {
        'dashboard': 'Dashboard', 'access': 'Akses SDM', 'teacher': 'Manajemen Guru',
        'kpi': 'KPI & Evaluasi', 'absensi': 'Absensi', 'payroll': 'Penggajian',
        'sk-guru': 'Dokumen SK Guru', 'rules': 'Aturan Kepegawaian',
        'qr-generator': 'QR Scanner', 'idcard': 'Cetak ID Card', 'settings': 'Pengaturan'
      };
      const subtitles = {
        'dashboard': 'Ringkasan data SDM & KPI',
        'access': 'Kelola siapa saja yang berhak mengakses dashboard SDM',
        'teacher': 'Kelola data guru: tambah, edit, detail, nonaktifkan',
        'kpi': 'Penilaian kinerja pegawai & evaluasi',
        'absensi': 'Log kehadiran, rekap absensi, dan input manual',
        'payroll': 'Perhitungan gaji & potongan absensi',
        'sk-guru': 'Dokumen resmi kepegawaian guru',
        'rules': 'Aturan status kepegawaian & absensi',
        'qr-generator': 'Device scanner absensi',
        'idcard': 'Cetak kartu identitas',
        'settings': 'Konfigurasi sistem SDM'
      };
      Utils.$('pageTitle').textContent = titles[tabName] || tabName;
      Utils.$('pageSubtitle').textContent = subtitles[tabName] || '';

      await Core.loadTabData(tabName);
    },

    loadTabData: async (tabName) => {
      try {
        switch (tabName) {
          case 'dashboard': await Dashboard.load(); break;
          case 'access': await Access.load(); break;
          case 'teacher':
            await Teacher.load();
            Core.showTeacherSub(state.teacherSub || 'data');
            break;
          case 'kpi': await Kpi.load(); break;
          case 'absensi': Core.showAbsensiSub('log'); break;
          case 'payroll': await Payroll.load(); break;
          case 'kafalah': await Kafalah.load(); break;
          case 'settings': await Settings.load(); break;
        }
      } catch (err) {
        console.error(`Error loading tab ${tabName}:`, err);
      }
    },

    showAbsensiSub: (sub) => {
      const map = { log: 'absensiSubLog', rekap: 'absensiSubRekap', manual: 'absensiSubManual' };
      Object.entries(map).forEach(([k, id]) => {
        const el = Utils.$(id);
        if (el) el.classList.toggle('hidden', k !== sub);
      });
      document.querySelectorAll('[data-absensi-sub]').forEach(b => {
        const active = b.getAttribute('data-absensi-sub') === sub;
        b.classList.toggle('bg-indigo-600', active);
        b.classList.toggle('text-white', active);
        b.classList.toggle('text-gray-600', !active);
        b.classList.toggle('bg-gray-100', !active);
      });
      if (sub === 'log') Attendance.load();
      else if (sub === 'rekap') Recap.load();
      else if (sub === 'manual') ManualAttendance.load();
    },

    showTeacherSub: (sub) => {
      state.teacherSub = sub === 'penugasan' ? 'penugasan' : 'data';
      const dataEl = Utils.$('teacherSubData');
      const penugasanEl = Utils.$('teacherSubPenugasan');
      const dataBtn = Utils.$('teacherSubDataBtn');
      const penugasanBtn = Utils.$('teacherSubPenugasanBtn');

      if (dataEl) dataEl.classList.toggle('hidden', state.teacherSub !== 'data');
      if (penugasanEl) penugasanEl.classList.toggle('hidden', state.teacherSub !== 'penugasan');

      const setBtn = (btn, active) => {
        if (!btn) return;
        btn.classList.toggle('bg-indigo-600', active);
        btn.classList.toggle('text-white', active);
        btn.classList.toggle('bg-gray-200', !active);
        btn.classList.toggle('text-gray-700', !active);
        btn.classList.toggle('hover:bg-gray-300', !active);
      };
      setBtn(dataBtn, state.teacherSub === 'data');
      setBtn(penugasanBtn, state.teacherSub === 'penugasan');

      if (state.teacherSub === 'penugasan') Penugasan.load();
    },

    onTenantChange: async () => {
      state.currentTenant = Utils.$('tenantSelect').value;
      const activeTab = state.currentTab;
      if (activeTab === 'dashboard') await Dashboard.load();
      if (activeTab === 'kpi') await Kpi.loadOverview();
      if (activeTab === 'attendance') await Attendance.load();
      if (activeTab === 'recapAbsensi') await Recap.load();
      if (activeTab === 'manualAttendance') await ManualAttendance.load();
      if (activeTab === 'payroll') await Payroll.load();
      if (activeTab === 'kafalah') await Kafalah.loadSettings();
    },

    loadTenantOptions: async () => {
      try {
        const data = await Api.get('/sdm-dashboard/tenants');
        const sel = Utils.$('tenantSelect');
        if (data.success && data.data) {
          data.data.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.tenant_id;
            opt.textContent = t.nama_sekolah;
            sel.appendChild(opt);
          });

          if (state.user?.assignments?.length) {
            const sdmAssign = state.user.assignments.find(a =>
              (a.jabatan_di_unit || '').toLowerCase().includes('sdm') &&
              data.data.some(d => d.tenant_id === a.tenant_id)
            );
            if (sdmAssign) {
              state.currentTenant = sdmAssign.tenant_id;
              sel.value = state.currentTenant;
            } else if (data.data.length > 0) {
              state.currentTenant = data.data[0].tenant_id;
              sel.value = state.currentTenant;
            }
          } else if (data.data.length > 0) {
            state.currentTenant = data.data[0].tenant_id;
            sel.value = state.currentTenant;
          }
        }
      } catch (err) { /* silent */ }
    },

    switchChart: (type) => {
      state.chartType = type;
      Utils.$('chartWeeklyBtn').className = type === 'weekly'
        ? 'px-3 py-1 text-xs font-medium bg-indigo-600 text-white rounded-md'
        : 'px-3 py-1 text-xs font-medium bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300';
      Utils.$('chartMonthlyBtn').className = type === 'monthly'
        ? 'px-3 py-1 text-xs font-medium bg-indigo-600 text-white rounded-md'
        : 'px-3 py-1 text-xs font-medium bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300';

      const t = state.currentTenant;
      Api.get(`/sdm-dashboard/attendance-chart?type=${type}${t ? `&tenant_id=${t}` : ''}`)
        .then(res => res.success && Dashboard.renderAttendanceChart(res.data));
    }
  };

  // ============================================================
  // DASHBOARD MODULE
  // ============================================================
  const Dashboard = {
    async load() {
      try {
        const t = state.currentTenant;
        const [statsRes, chartRes, kpiRes] = await Promise.all([
          Api.get(`/sdm-dashboard/stats${t ? `?tenant_id=${t}` : ''}`),
          Api.get(`/sdm-dashboard/attendance-chart?type=${state.chartType}${t ? `&tenant_id=${t}` : ''}`),
          Api.get(`/sdm-dashboard/kpi-summary${t ? `?tenant_id=${t}` : ''}`)
        ]);

        if (statsRes.success) {
          const d = statsRes.data;
          Utils.$('statTotalTeachers').textContent = d.total_teachers || 0;
          Utils.$('statTotalTeachers').classList.remove('skeleton-loader');
          Utils.$('statTodayPresent').textContent = d.today_attendance || 0;
          Utils.$('statTodayLate').textContent = d.late_today || 0;
          Utils.$('statAvgKpi').textContent = d.kpi_summary?.avg_score || 0;
          Utils.$('kpiActivePeriod').textContent = d.kpi_summary?.active_period || 'Belum ada periode';
          Utils.$('kpiCompletionRate').textContent = `${d.kpi_summary?.completion_rate || 0}%`;
          Utils.$('kpiTotalTemplates').textContent = d.kpi_summary?.total_templates || 0;
          Utils.$('kpiAssessedCount').textContent = d.kpi_summary?.completion_rate
            ? Math.round((d.kpi_summary.completion_rate / 100) * (d.total_teachers || 0)) : 0;

          const tbody = Utils.$('schoolRecapTable');
          if (d.by_school?.length) {
            tbody.innerHTML = d.by_school.map(s => {
              const rate = parseFloat(s.attendance_rate) || 0;
              const statusBadge = rate >= 90
                ? '<span class="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">Baik</span>'
                : rate >= 75
                  ? '<span class="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">Cukup</span>'
                  : '<span class="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full">Perhatian</span>';
              return `
                <tr class="cursor-pointer hover:bg-gray-50" onclick="SDMDashboard.showSchoolDetail('${s.tenant_id || ''}', '${Utils.escapeHtml(s.nama_sekolah)}')">
                  <td class="px-4 py-3 text-sm font-medium text-gray-900">${Utils.escapeHtml(s.nama_sekolah)} <button onclick="event.stopPropagation();SDMDashboard.showSchoolDetail('${s.tenant_id || ''}','${Utils.escapeHtml(s.nama_sekolah)}')" class="ml-2 text-xs text-indigo-600 hover:underline">Detail</button></td>
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

        if (chartRes.success) this.renderAttendanceChart(chartRes.data);
        if (kpiRes.success) this.renderKpiChart(kpiRes.data);
      } catch (err) {
        console.error('Dashboard stats error:', err);
      }
    },

    renderAttendanceChart(chartData) {
      const ctx = Utils.$('attendanceChart');
      if (!ctx) return;
      if (state.charts.attendance) state.charts.attendance.destroy();
      state.charts.attendance = new Chart(ctx, {
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
    },

    renderKpiChart(kpiData) {
      const ctx = Utils.$('kpiChart');
      if (!ctx) return;
      if (state.charts.kpi) state.charts.kpi.destroy();
      const indicators = (kpiData.by_indicator || []);
      indicators.sort((a, b) => (b.avg_achievement || 0) - (a.avg_achievement || 0));
      state.charts.kpi = new Chart(ctx, {
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
  };

  // ============================================================
  // ACCESS MODULE
  // ============================================================
  const Access = {
    selectedTeacherId: null,
    searchDebounce: null,

    async load() {
      const assignCard = Utils.$('accessAssignCard');
      if (assignCard) {
        assignCard.style.display = state.isSdmPusat ? 'block' : 'none';
      }

      if (state.isSdmPusat) {
        await this.loadTenantOptions();
        await this.loadAccessList();
      }
    },

    async loadTenantOptions() {
      try {
        const data = await Api.get('/sdm-dashboard/tenants');
        const sel = Utils.$('accessTenantSelect');
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
        this.onTenantChange();
      } catch (err) { /* silent */ }
    },

    onTenantChange() {
      const sel = Utils.$('accessTenantSelect');
      const preview = Utils.$('accessJabatanPreview');
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
      this.resetSelectedTeacher();
    },

    resetSelectedTeacher() {
      this.selectedTeacherId = null;
      const search = Utils.$('accessTeacherSearch');
      if (search) search.value = '';
      const resultWrap = Utils.$('accessTeacherResult');
      if (resultWrap) resultWrap.classList.add('hidden');
      const list = Utils.$('accessTeacherList');
      if (list) list.innerHTML = '';
    },

    handleAccessTeacherSearch(e) {
      clearTimeout(this.searchDebounce);
      this.searchDebounce = setTimeout(() => this.searchTeachers(), 400);
    },

    async searchTeachers() {
      const tenantId = Utils.$('accessTenantSelect')?.value;
      const keyword = Utils.$('accessTeacherSearch')?.value?.trim() || '';

      if (!tenantId) {
        Utils.showToast('Pilih sekolah terlebih dahulu', 'warning');
        return;
      }
      if (keyword.length < 2) {
        Utils.$('accessTeacherResult')?.classList.add('hidden');
        return;
      }

      try {
        const params = new URLSearchParams({ tenant_id: tenantId, search: keyword, limit: 25 });
        const data = await Api.get(`/sdm-dashboard/access/candidates?${params}`);
        const wrap = Utils.$('accessTeacherResult');
        const list = Utils.$('accessTeacherList');

        if (data.success && data.data?.length) {
          wrap.classList.remove('hidden');
          list.innerHTML = data.data.map(t => `
            <div class="flex items-center justify-between px-4 py-3 hover:bg-gray-50 cursor-pointer" onclick="SDMDashboard.Access.selectTeacher(${t.id}, '${Utils.escapeHtml(t.nama).replace(/'/g, "\\'")}')">
              <div>
                <p class="text-sm font-medium text-gray-900">${Utils.escapeHtml(t.nama)}</p>
                <p class="text-xs text-gray-500">NIK: ${Utils.escapeHtml(t.nik || '-')}${t.nip ? ' | NIP: ' + Utils.escapeHtml(t.nip) : ''}</p>
              </div>
              <span class="text-xs text-gray-400">${Utils.escapeHtml(t.status_kepegawaian || '')}</span>
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
        Utils.showToast(err.message || 'Gagal mencari guru', 'error');
      }
    },

    selectTeacher(teacherId, nama) {
      this.selectedTeacherId = teacherId;
      const list = Utils.$('accessTeacherList');
      list.querySelectorAll('div').forEach(d => d.classList.remove('bg-indigo-50', 'ring-1', 'ring-indigo-300'));
      event?.currentTarget?.classList?.add('bg-indigo-50', 'ring-1', 'ring-indigo-300');
      Utils.showToast(`Guru dipilih: ${nama}`, 'success');
    },

    async assignSdmAccess() {
      const tenantId = Utils.$('accessTenantSelect')?.value;
      if (!tenantId) {
        Utils.showToast('Pilih sekolah terlebih dahulu', 'warning');
        return;
      }
      if (!this.selectedTeacherId) {
        Utils.showToast('Cari dan pilih guru terlebih dahulu', 'warning');
        return;
      }
      if (!state.isSdmPusat) {
        Utils.showToast('Hanya SDM Pusat yang boleh memberikan akses SDM', 'error');
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
        const data = await Api.post('/sdm-dashboard/access', {
          teacher_id: this.selectedTeacherId,
          tenant_id: tenantId
        });
        if (data.success) {
          Utils.showToast(data.message, 'success');
          this.resetSelectedTeacher();
          this.loadAccessList();
        } else {
          Utils.showToast(data.message || 'Tidak dapat memberikan akses', 'error');
        }
      } catch (err) {
        Utils.showToast(err.message || 'Gagal memberikan akses SDM', 'error');
      }
    },

    async loadAccessList() {
      const tbody = Utils.$('sdmAccessTable');
      if (!tbody) return;
      tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-12 text-center text-gray-500"><i class="fas fa-spinner fa-spin text-xl mb-2"></i><p>Memuat data...</p></td></tr>';

      try {
        const data = await Api.get('/sdm-dashboard/access/list');
        if (data.success && data.data?.length) {
          tbody.innerHTML = data.data.map(a => {
            const isPusat = a.tenant_id === SDM_PUSAT_TENANT;
            const jabatanLabel = isPusat ? 'SDM Pusat' : 'SDM';
            const levelBadge = isPusat
              ? '<span class="px-2 py-1 text-xs font-medium bg-indigo-100 text-indigo-800 rounded-full">Pusat &middot; Semua sekolah</span>'
              : '<span class="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">Sekolah &middot; Unit sendiri</span>';
            const sekolah = isPusat
              ? '<span class="font-semibold text-indigo-700">Pusat (YPWI Lutim)</span>'
              : Utils.escapeHtml(a.nama_sekolah || a.tenant_id);
            return `
              <tr>
                <td class="px-4 py-3 text-sm font-medium text-gray-900">${Utils.escapeHtml(a.nama)}</td>
                <td class="px-4 py-3 text-sm text-gray-700">${Utils.escapeHtml(a.nik || '-')}</td>
                <td class="px-4 py-3 text-sm text-gray-700">${sekolah}</td>
                <td class="px-4 py-3 text-sm text-gray-700">${Utils.escapeHtml(a.jabatan_di_unit || jabatanLabel)}</td>
                <td class="px-4 py-3">${levelBadge}</td>
                <td class="px-4 py-3">
                  ${state.isSdmPusat
                    ? `<button onclick="SDMDashboard.Access.revokeAccess(${a.id}, '${Utils.escapeHtml(a.nama).replace(/'/g, "\\'")}', '${Utils.escapeHtml(a.nama_sekolah || a.tenant_id).replace(/'/g, "\\'")}')" class="text-red-600 hover:text-red-800 text-sm" title="Cabut akses"><i class="fas fa-user-minus"></i></button>`
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
    },

    async revokeAccess(assignmentId, nama, sekolah) {
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
        const data = await Api.delete(`/sdm-dashboard/access/${assignmentId}`);
        if (data.success) {
          Utils.showToast(data.message, 'success');
          this.loadAccessList();
        } else {
          Utils.showToast(data.message || 'Tidak dapat mencabut akses', 'error');
        }
      } catch (err) {
        Utils.showToast(err.message || 'Gagal mencabut akses', 'error');
      }
    }
  };

  // ============================================================
  // TEACHER MODULE
  // ============================================================
  const Teacher = {
    async load() {
      await this.loadTenantOptions();
      await this.loadJabatanOptions();
      await this.loadList(1);
    },

    async loadTenantOptions() {
      try {
        const data = await Api.get('/sdm-dashboard/tenants');
        if (!data.success || !Array.isArray(data.data)) return;
        const targets = [
          { id: 'teacherTenantFilter', placeholder: 'Semua Sekolah' },
          { id: 'teacherTenant', placeholder: 'Pilih Sekolah' },
          { id: 'manualModalTenant', placeholder: '' }
        ];
        targets.forEach(({ id, placeholder }) => {
          const sel = Utils.$(id);
          if (!sel) return;
          const hadPlaceholder = sel.options.length > 0 && sel.options[0].value === '';
          sel.innerHTML = '';
          if (placeholder) sel.appendChild(new Option(placeholder, ''));
          else if (hadPlaceholder) sel.appendChild(new Option('', ''));
          data.data.forEach(t => sel.appendChild(new Option(t.nama_sekolah, t.tenant_id)));
        });
      } catch (err) { /* silent */ }
    },

    async loadJabatanOptions() {
      try {
        const data = await Api.get('/sdm-dashboard/jabatan-list');
        const sel = Utils.$('teacherJabatan');
        if (sel && data.success && Array.isArray(data.data)) {
          // pertahankan placeholder (value=""), buang opsi lama agar tidak duplikat
          Array.from(sel.querySelectorAll('option')).forEach(o => { if (o.value !== '') o.remove(); });
          const seen = new Set();
          data.data.forEach(j => {
            const val = (typeof j === 'string') ? j : (j.jabatan ?? j.jabatan_di_unit);
            if (!val || seen.has(val)) return;
            seen.add(val);
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val;
            sel.appendChild(opt);
          });
        }
      } catch (err) { /* silent */ }
    },

    handleSearch(event) {
      if (event && event.key && event.key !== 'Enter') {
        clearTimeout(state.searchDebounce.teacher);
        state.searchDebounce.teacher = setTimeout(() => Teacher.loadList(1), 350);
        return;
      }
      Teacher.loadList(1);
    },

    async loadList(page = 1) {
      state.teacherPage = page;
      const tenant = Utils.$('teacherTenantFilter')?.value;
      const jabatan = Utils.$('teacherJabatanFilter')?.value;
      const status = Utils.$('teacherStatusFilter')?.value;
      const active = Utils.$('teacherActiveFilter')?.value;
      const search = Utils.$('teacherSearch')?.value?.trim();

      state.teacherFilters = { tenant, jabatan, status, active, search };

      const params = new URLSearchParams({
        page, limit: 15,
        ...(tenant && { tenant_id: tenant }),
        ...(jabatan && { jabatan }),
        ...(status && { status_kepegawaian: status }),
        ...(active && { status_aktif: active }),
        ...(search && { search })
      });

      try {
        const tbody = Utils.$('teacherTableBody');
        tbody.innerHTML = '<tr><td colspan="9" class="px-4 py-12 text-center text-gray-500"><i class="fas fa-spinner fa-spin text-xl mb-2"></i><p>Memuat data...</p></td></tr>';

        const data = await Api.get(`/sdm-dashboard/teacher-list?${params}`);
        if (data.success && data.data?.data?.length) {
          tbody.innerHTML = data.data.data.map(t => `
            <tr class="hover:bg-gray-50">
              <td class="px-4 py-3">
                ${t.link_foto ? `<img src="${Utils.escapeHtml(t.link_foto)}" class="w-10 h-10 rounded-full object-cover" alt="">` : '<div class="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center"><i class="fas fa-user text-gray-400"></i></div>'}
              </td>
              <td class="px-4 py-3 text-sm font-medium text-gray-900">${Utils.escapeHtml(t.nama)}</td>
              <td class="px-4 py-3 text-sm text-gray-700">${Utils.escapeHtml(t.nik || '-')}</td>
              <td class="px-4 py-3 text-sm text-gray-700">${Utils.escapeHtml(t.nip || '-')}</td>
              <td class="px-4 py-3 text-sm text-gray-700">${Utils.escapeHtml(t.nama_sekolah || '-')}</td>
              <td class="px-4 py-3 text-sm text-gray-700">${Utils.escapeHtml(t.jabatan_di_unit || '-')}</td>
              <td class="px-4 py-3 text-sm text-gray-700">${Utils.escapeHtml(t.status_kepegawaian || '-')}</td>
              <td class="px-4 py-3">
                <span class="px-2 py-1 text-xs font-medium rounded-full ${t.status_aktif == '1' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}">
                  ${t.status_aktif == '1' ? 'Aktif' : 'Nonaktif'}
                </span>
              </td>
              <td class="px-4 py-3">
                <div class="flex items-center space-x-2">
                  <button onclick="SDMDashboard.Teacher.showDetail(${t.id})" class="text-indigo-600 hover:text-indigo-800 text-sm" title="Detail"><i class="fas fa-eye"></i></button>
                  <button onclick="SDMDashboard.Teacher.showModal(${t.id})" class="text-green-600 hover:text-green-800 text-sm" title="Edit"><i class="fas fa-edit"></i></button>
                  <button onclick="SDMDashboard.Teacher.delete(${t.id}, '${Utils.escapeHtml(t.nama).replace(/'/g, "\\'")}')" class="text-red-600 hover:text-red-800 text-sm" title="Nonaktifkan"><i class="fas fa-user-slash"></i></button>
                </div>
              </td>
            </tr>`).join('');
          this.renderPagination(data.data.current_page, data.data.last_page);
        } else {
          tbody.innerHTML = '<tr><td colspan="9" class="px-4 py-12 text-center text-gray-500">Tidak ada data guru</td></tr>';
          Utils.$('teacherPagination').innerHTML = '';
        }
      } catch (err) {
        console.error('Load teacher list error:', err);
        Utils.$('teacherTableBody').innerHTML = '<tr><td colspan="9" class="px-4 py-12 text-center text-red-500">Gagal memuat data</td></tr>';
      }
    },

    renderPagination(current, last) {
      const container = Utils.$('teacherPagination');
      if (last <= 1) { container.innerHTML = ''; return; }

      let html = '';
      if (current > 1) {
        html += `<button class="pagination-btn" onclick="SDMDashboard.Teacher.loadList(${current - 1})"><i class="fas fa-chevron-left"></i></button>`;
      }
      const start = Math.max(1, current - 2);
      const end = Math.min(last, current + 2);
      for (let i = start; i <= end; i++) {
        html += `<button class="pagination-btn ${i === current ? 'active' : ''}" onclick="SDMDashboard.Teacher.loadList(${i})">${i}</button>`;
      }
      if (current < last) {
        html += `<button class="pagination-btn" onclick="SDMDashboard.Teacher.loadList(${current + 1})"><i class="fas fa-chevron-right"></i></button>`;
      }
      container.innerHTML = html;
    },

    async showModal(id = null) {
      Utils.$('teacherModalTitle').textContent = id ? 'Edit Guru' : 'Tambah Guru';
      Utils.$('teacherId').value = id || '';
      Utils.$('teacherForm').reset();
      Utils.$('teacherStatusAktif').value = '1';

      await Promise.all([this.loadTenantOptions(), this.loadJabatanOptions()]);

      if (id) await this.loadData(id);

      Utils.showModal('teacherModal');
    },

    hideModal() {
      Utils.hideModal('teacherModal');
      Utils.$('teacherForm').reset();
      Utils.$('teacherId').value = '';
    },

    async loadData(id) {
      try {
        const data = await Api.get(`/sdm-dashboard/teachers/${id}`);
        if (data.success && data.data) {
          this.fillForm(data.data);
        }
      } catch (err) {
        console.error('Failed to load teacher data:', err);
      }
    },

    fillForm(t) {
      Utils.$('teacherNama').value = t.nama || '';
      Utils.$('teacherNik').value = t.nik || '';
      Utils.$('teacherNip').value = t.nip || '';
      Utils.$('teacherTempatLahir').value = t.tempat_lahir || '';
      Utils.$('teacherTanggalLahir').value = t.tanggal_lahir || '';
      Utils.$('teacherJenisKelamin').value = t.jenis_kelamin || '';
      Utils.$('teacherAlamat').value = t.alamat || '';
      Utils.$('teacherNoWa').value = t.no_wa || '';
      Utils.$('teacherEmail').value = t.email || '';
      Utils.$('teacherStatusKepegawaian').value = t.status_kepegawaian || '';
      Utils.$('teacherTmt').value = t.tmt || '';
      Utils.$('teacherStatusAktif').value = (t.status_aktif === 0 || t.status_aktif === '0') ? '0' : '1';
      Utils.$('teacherLinkFoto').value = t.link_foto || '';
      Utils.$('teacherLinkKtp').value = t.link_ktp || '';
      Utils.$('teacherLinkKk').value = t.link_kk || '';
      Utils.$('teacherLinkIjazah').value = t.link_ijazah || '';
      Utils.$('teacherGajiPokok').value = t.gaji_pokok || 0;
      Utils.$('teacherTunjKinerja').value = t.tunj_kinerja || 0;
      Utils.$('teacherTunjUmum').value = t.tunj_umum || 0;
      Utils.$('teacherTunjIstri').value = t.tunj_istri || 0;
      Utils.$('teacherTunjAnak').value = t.tunj_anak || 0;
      Utils.$('teacherTunjKepalaSekolah').value = t.tunj_kepala_sekolah || 0;
      Utils.$('teacherTunjWaliKelas').value = t.tunj_wali_kelas || 0;
      Utils.$('teacherHonorBendahara').value = t.honor_bendahara || 0;
      Utils.$('teacherTunjKehadiran').value = t.tunj_kehadiran || 0;
      Utils.$('teacherPotongan').value = t.potongan || 0;

      if (t.tenant_id) {
        Utils.$('teacherTenant').value = t.tenant_id;
        this.onTenantChange();
      }
      if (t.jabatan) {
        setTimeout(() => { Utils.$('teacherJabatan').value = t.jabatan; }, 100);
      }
    },

    async onTenantChange() {
      // Could filter jabatan based on tenant
    },

    checkNipRequirement() {
      const tmt = Utils.$('teacherTmt').value;
      const nipInput = Utils.$('teacherNip');
      if (tmt) {
        const tmtDate = new Date(tmt);
        const twoYearsAgo = new Date();
        twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
        if (tmtDate <= twoYearsAgo) {
          nipInput.setAttribute('required', 'required');
          nipInput.placeholder = 'Wajib diisi (TMT >= 2 tahun)';
          nipInput.classList.add('border-red-300');
        } else {
          nipInput.removeAttribute('required');
          nipInput.placeholder = 'Wajib jika TMT >= 2 tahun';
          nipInput.classList.remove('border-red-300');
        }
      }
    },

    async saveTeacher(e) {
      e.preventDefault();
      const id = Utils.$('teacherId').value;
      const isEdit = !!id;

      const payload = {
        nama: Utils.$('teacherNama').value,
        nik: Utils.$('teacherNik').value,
        nip: Utils.$('teacherNip').value || null,
        tempat_lahir: Utils.$('teacherTempatLahir').value || null,
        tanggal_lahir: Utils.$('teacherTanggalLahir').value || null,
        jenis_kelamin: Utils.$('teacherJenisKelamin').value || null,
        alamat: Utils.$('teacherAlamat').value || null,
        no_wa: Utils.$('teacherNoWa').value || null,
        email: Utils.$('teacherEmail').value || null,
        tenant_id: Utils.$('teacherTenant').value,
        jabatan: Utils.$('teacherJabatan').value || null,
        status_kepegawaian: Utils.$('teacherStatusKepegawaian').value || null,
        tmt: Utils.$('teacherTmt').value || null,
        status_aktif: Utils.$('teacherStatusAktif').value,
        link_foto: Utils.$('teacherLinkFoto').value || null,
        link_ktp: Utils.$('teacherLinkKtp').value || null,
        link_kk: Utils.$('teacherLinkKk').value || null,
        link_ijazah: Utils.$('teacherLinkIjazah').value || null,
        gaji_pokok: parseInt(Utils.$('teacherGajiPokok').value) || 0,
        tunj_kinerja: parseInt(Utils.$('teacherTunjKinerja').value) || 0,
        tunj_umum: parseInt(Utils.$('teacherTunjUmum').value) || 0,
        tunj_istri: parseInt(Utils.$('teacherTunjIstri').value) || 0,
        tunj_anak: parseInt(Utils.$('teacherTunjAnak').value) || 0,
        tunj_kepala_sekolah: parseInt(Utils.$('teacherTunjKepalaSekolah').value) || 0,
        tunj_wali_kelas: parseInt(Utils.$('teacherTunjWaliKelas').value) || 0,
        honor_bendahara: parseInt(Utils.$('teacherHonorBendahara').value) || 0,
        tunj_kehadiran: parseInt(Utils.$('teacherTunjKehadiran').value) || 0,
        potongan: parseInt(Utils.$('teacherPotongan').value) || 0
      };

      if (!payload.nama || !payload.nik || !payload.tenant_id) {
        Utils.showToast('Nama, NIK, dan Sekolah wajib diisi', 'warning');
        return;
      }

      try {
        Swal.fire({ title: 'Menyimpan...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        if (isEdit) {
          await Api.put(`/sdm-dashboard/teachers/${id}`, payload);
        } else {
          await Api.post('/sdm-dashboard/teachers', payload);
        }
        Utils.showToast('Guru ' + (isEdit ? 'diperbarui' : 'ditambahkan'), 'success');
        this.hideModal();
        this.loadList(state.teacherPage);
      } catch (err) {
        Utils.showToast(err.message || 'Gagal menyimpan guru', 'error');
      }
    },

    async showDetail(id) {
      Utils.$('teacherDetailTitle').textContent = 'Detail Guru';
      const content = Utils.$('teacherDetailContent');
      content.innerHTML = '<p class="text-center py-8"><i class="fas fa-spinner fa-spin"></i> Memuat...</p>';
      Utils.showModal('teacherDetailModal');

      try {
        const resp = await Api.get(`/sdm-dashboard/teachers/${id}`);
        if (!resp.success || !resp.data) {
          content.innerHTML = '<p class="text-center py-8 text-red-500">Guru tidak ditemukan</p>';
          return;
        }

        const t = resp.data;
        let html = `
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <h4 class="font-semibold text-gray-900 mb-3">Informasi Pribadi</h4>
              <div class="space-y-2 text-sm">
                <p><span class="font-medium text-gray-700">Nama:</span> ${Utils.escapeHtml(t.nama || '-')}</p>
                <p><span class="font-medium text-gray-700">NIK:</span> ${Utils.escapeHtml(t.nik || '-')}</p>
                <p><span class="font-medium text-gray-700">NIP:</span> ${Utils.escapeHtml(t.nip || '-')}</p>
                <p><span class="font-medium text-gray-700">Tempat/Tgl Lahir:</span> ${Utils.escapeHtml(t.tempat_lahir || '-')}, ${t.tanggal_lahir ? Utils.formatDate(t.tanggal_lahir) : '-'}</p>
                <p><span class="font-medium text-gray-700">Jenis Kelamin:</span> ${t.jenis_kelamin === 'L' ? 'Laki-laki' : t.jenis_kelamin === 'P' ? 'Perempuan' : '-'}</p>
                <p><span class="font-medium text-gray-700">Alamat:</span> ${Utils.escapeHtml(t.alamat || '-')}</p>
                <p><span class="font-medium text-gray-700">No. WhatsApp:</span> ${Utils.escapeHtml(t.no_wa || '-')}</p>
                <p><span class="font-medium text-gray-700">Email:</span> ${Utils.escapeHtml(t.email || '-')}</p>
              </div>
            </div>
            <div>
              <h4 class="font-semibold text-gray-900 mb-3">Penempatan & Jabatan</h4>
              <div class="space-y-2 text-sm">
                <p><span class="font-medium text-gray-700">Sekolah:</span> ${Utils.escapeHtml(t.nama_sekolah || '-')}</p>
                <p><span class="font-medium text-gray-700">Jabatan:</span> ${Utils.escapeHtml(t.jabatan || '-')}</p>
                <p><span class="font-medium text-gray-700">Status Kepegawaian:</span> ${Utils.escapeHtml(t.status_kepegawaian || '-')}</p>
                <p><span class="font-medium text-gray-700">TMT:</span> ${t.tmt ? Utils.formatDate(t.tmt) : '-'}</p>
                <p><span class="font-medium text-gray-700">Status:</span> <span class="px-2 py-1 text-xs font-medium rounded-full ${t.status_aktif == '1' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}">${t.status_aktif == '1' ? 'Aktif' : 'Nonaktif'}</span></p>
              </div>
            </div>
          </div>
          <div class="border-t pt-4">
            <h4 class="font-semibold text-gray-900 mb-3">Komponen Gaji</h4>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <p><span class="font-medium text-gray-700">Gaji Pokok:</span> ${Utils.formatRupiah(t.gaji_pokok)}</p>
              <p><span class="font-medium text-gray-700">Tunj. Kinerja:</span> ${Utils.formatRupiah(t.tunj_kinerja)}</p>
              <p><span class="font-medium text-gray-700">Tunj. Umum:</span> ${Utils.formatRupiah(t.tunj_umum)}</p>
              <p><span class="font-medium text-gray-700">Tunj. Istri:</span> ${Utils.formatRupiah(t.tunj_istri)}</p>
              <p><span class="font-medium text-gray-700">Tunj. Anak:</span> ${Utils.formatRupiah(t.tunj_anak)}</p>
              <p><span class="font-medium text-gray-700">Tunj. Kepala Sekolah:</span> ${Utils.formatRupiah(t.tunj_kepala_sekolah)}</p>
              <p><span class="font-medium text-gray-700">Tunj. Wali Kelas:</span> ${Utils.formatRupiah(t.tunj_wali_kelas)}</p>
              <p><span class="font-medium text-gray-700">Honor Bendahara:</span> ${Utils.formatRupiah(t.honor_bendahara)}</p>
              <p><span class="font-medium text-gray-700">Tunj. Kehadiran:</span> ${Utils.formatRupiah(t.tunj_kehadiran)}</p>
              <p><span class="font-medium text-gray-700">Potongan:</span> ${Utils.formatRupiah(t.potongan)}</p>
            </div>
          </div>
          <div class="border-t pt-4 mt-4">
            <h4 class="font-semibold text-gray-900 mb-3">Dokumen</h4>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              ${t.link_foto ? `<a href="${Utils.escapeHtml(t.link_foto)}" target="_blank" class="text-indigo-600 hover:underline"><i class="fas fa-image mr-1"></i>Foto</a>` : '<span class="text-gray-400">Foto: -</span>'}
              ${t.link_ktp ? `<a href="${Utils.escapeHtml(t.link_ktp)}" target="_blank" class="text-indigo-600 hover:underline"><i class="fas fa-id-card mr-1"></i>KTP</a>` : '<span class="text-gray-400">KTP: -</span>'}
              ${t.link_kk ? `<a href="${Utils.escapeHtml(t.link_kk)}" target="_blank" class="text-indigo-600 hover:underline"><i class="fas fa-users mr-1"></i>KK</a>` : '<span class="text-gray-400">KK: -</span>'}
              ${t.link_ijazah ? `<a href="${Utils.escapeHtml(t.link_ijazah)}" target="_blank" class="text-indigo-600 hover:underline"><i class="fas fa-graduation-cap mr-1"></i>Ijazah</a>` : '<span class="text-gray-400">Ijazah: -</span>'}
            </div>
          </div>
        `;
        content.innerHTML = html;
      } catch (err) {
        content.innerHTML = '<p class="text-center py-8 text-red-500">Gagal memuat detail guru</p>';
      }
    },

    async delete(id, nama) {
      const confirm = await Swal.fire({
        title: 'Nonaktifkan Guru?',
        html: `<p class="text-sm text-gray-600">Guru <strong>${Utils.escapeHtml(nama)}</strong> akan dinonaktifkan (status_aktif = 0).</p>
               <p class="text-xs text-gray-500 mt-2">Data guru tetap tersimpan, hanya tidak muncul daftar aktif.</p>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Ya, nonaktifkan',
        cancelButtonText: 'Batal',
        confirmButtonColor: '#dc2626'
      });
      if (!confirm.isConfirmed) return;

      try {
        Swal.fire({ title: 'Memproses...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        await Api.delete(`/sdm-dashboard/teachers/${id}`);
        Utils.showToast('Guru dinonaktifkan', 'success');
        this.loadList(state.teacherPage);
      } catch (err) {
        Utils.showToast(err.message || 'Gagal menonaktifkan guru', 'error');
      }
    }
  };

  // ============================================================
  // PENUGASAN MODULE
  // ============================================================
  const Penugasan = {
    async load() {
      await Promise.all([
        this.loadTenantOptions(),
        this.loadJabatanOptions(),
        this.loadJabatanTunjangan(),
        this.loadCandidates()
      ]);
      await this.loadList(1);
    },

    async loadTenantOptions() {
      try {
        const data = await Api.get('/sdm-dashboard/tenants');
        if (!data.success || !Array.isArray(data.data)) return;
        const targets = [
          { id: 'penugasanTenantFilter', placeholder: 'Semua Sekolah' },
          { id: 'penugasanToTenant', placeholder: 'Pilih Sekolah' }
        ];
        targets.forEach(({ id, placeholder }) => {
          const sel = Utils.$(id);
          if (!sel) return;
          const current = sel.value;
          sel.innerHTML = '';
          sel.appendChild(new Option(placeholder, ''));
          data.data.forEach(t => sel.appendChild(new Option(t.nama_sekolah, t.tenant_id)));
          if (current) sel.value = current;
        });
      } catch (err) {
        console.error('Load penugasan tenant options error:', err);
      }
    },

    async loadJabatanOptions() {
      try {
        const data = await Api.get('/sdm-dashboard/jabatan-list');
        const list = Utils.$('penugasanJabatanList');
        if (!list || !data.success || !Array.isArray(data.data)) return;
        list.innerHTML = '';
        const seen = new Set();
        data.data.forEach(j => {
          const val = (typeof j === 'string') ? j : (j.jabatan ?? j.jabatan_di_unit);
          if (!val || seen.has(val)) return;
          seen.add(val);
          const opt = document.createElement('option');
          opt.value = val;
          list.appendChild(opt);
        });
      } catch (err) { /* silent */ }
    },

    async loadJabatanTunjangan() {
      try {
        const data = await Api.get('/sk-guru/penugasan/jabatan-tunjangan');
        const map = {};
        if (data.success && Array.isArray(data.data)) {
          data.data.forEach(r => {
            const key = String(r.jabatan_key || '').toLowerCase().replace(/[\s_]+/g, '');
            map[key] = Number(r.nominal) || 0;
          });
        }
        state.penugasanJabatanMap = map;
      } catch (err) {
        state.penugasanJabatanMap = {};
      }
    },

    async loadCandidates() {
      try {
        const data = await Api.get('/sk-guru/penugasan/candidates');
        state.penugasanCandidates = (data.success && Array.isArray(data.data)) ? data.data : [];
        this.renderTeacherOptions();
      } catch (err) {
        state.penugasanCandidates = [];
        Utils.showToast('Gagal memuat data guru', 'error');
      }
    },

    renderTeacherOptions(filter = '') {
      const sel = Utils.$('penugasanTeacherSelect');
      if (!sel) return;
      const current = sel.value;
      const q = String(filter || '').toLowerCase();
      const candidates = state.penugasanCandidates.filter(t =>
        !q
        || String(t.nama || '').toLowerCase().includes(q)
        || String(t.nik || '').includes(q)
        || String(t.nip || '').includes(q)
      );
      sel.innerHTML = '<option value="">Pilih Guru</option>' + candidates.map(t =>
        `<option value="${t.teacher_id}">${Utils.escapeHtml(t.nama)}${t.nik ? ' - ' + Utils.escapeHtml(t.nik) : ''}</option>`
      ).join('');
      if (current && candidates.some(t => String(t.teacher_id) === String(current))) sel.value = current;
    },

    onTeacherChange() {
      const teacherId = Utils.$('penugasanTeacherSelect')?.value;
      const teacher = state.penugasanCandidates.find(t => String(t.teacher_id) === String(teacherId));
      const info = Utils.$('penugasanTeacherInfo');
      const wrap = Utils.$('penugasanFromAssignmentWrap');
      const sel = Utils.$('penugasanFromAssignmentSelect');
      const fromUnit = Utils.$('penugasanFromUnit');
      const fromJabatan = Utils.$('penugasanFromJabatan');

      if (!teacher) {
        if (info) info.textContent = '';
        if (wrap) wrap.classList.add('hidden');
        if (sel) sel.innerHTML = '<option value="">Pilih Assignment</option>';
        if (fromUnit) fromUnit.value = '';
        if (fromJabatan) fromJabatan.value = '';
        this.updateJenisBadge();
        return;
      }

      if (info) {
        info.textContent = `NIK: ${teacher.nik || '-'} | NIP: ${teacher.nip || '-'} | Status: ${teacher.status_kepegawaian || '-'}`;
      }

      if (!sel) return;
      const active = (teacher.assignments || []).filter(a => a.is_paid);
      if (active.length === 0) {
        if (wrap) wrap.classList.add('hidden');
        sel.innerHTML = '<option value="">Belum ada assignment aktif</option>';
        if (fromUnit) fromUnit.value = '';
        if (fromJabatan) fromJabatan.value = '';
        this.updateJenisBadge();
        return;
      }

      if (wrap) wrap.classList.remove('hidden');
      sel.innerHTML = '<option value="">Pilih Assignment</option>' + active.map(a =>
        `<option value="${a.id}">${Utils.escapeHtml(a.nama_sekolah || a.tenant_id)} - ${Utils.escapeHtml(a.jabatan_di_unit || 'Tanpa jabatan')}</option>`
      ).join('');

      if (active.length === 1) {
        sel.value = String(active[0].id);
        this.onFromAssignmentChange();
      } else {
        if (fromUnit) fromUnit.value = '';
        if (fromJabatan) fromJabatan.value = '';
        this.updateJenisBadge();
      }
    },

    onFromAssignmentChange() {
      const teacherId = Utils.$('penugasanTeacherSelect')?.value;
      const assignmentId = Utils.$('penugasanFromAssignmentSelect')?.value;
      const teacher = state.penugasanCandidates.find(t => String(t.teacher_id) === String(teacherId));
      const assignment = teacher?.assignments?.find(a => String(a.id) === String(assignmentId));
      const fromUnit = Utils.$('penugasanFromUnit');
      const fromJabatan = Utils.$('penugasanFromJabatan');
      if (fromUnit) fromUnit.value = assignment?.nama_sekolah || assignment?.tenant_id || '';
      if (fromJabatan) fromJabatan.value = assignment?.jabatan_di_unit || '';
      this.updateJenisBadge();
      this.autoFillTunjangan();
    },

    onToTenantChange() {
      this.updateJenisBadge();
    },

    onJabatanChange() {
      this.autoFillTunjangan();
      this.updateJenisBadge();
    },

    updateJenisBadge() {
      const badge = Utils.$('penugasanJenisBadge');
      if (!badge) return;
      const teacherId = Utils.$('penugasanTeacherSelect')?.value;
      const assignmentId = Utils.$('penugasanFromAssignmentSelect')?.value;
      const teacher = state.penugasanCandidates.find(t => String(t.teacher_id) === String(teacherId));
      const assignment = teacher?.assignments?.find(a => String(a.id) === String(assignmentId));
      const toTenant = Utils.$('penugasanToTenant')?.value;
      const toJabatan = Utils.$('penugasanToJabatan')?.value?.trim();

      let jenis = 'Baru';
      let cls = 'bg-gray-100 text-gray-600';

      if (assignment) {
        if (assignment.tenant_id !== toTenant) {
          jenis = 'Mutasi';
          cls = 'bg-purple-100 text-purple-700';
        } else if (toJabatan && String(assignment.jabatan_di_unit || '').toLowerCase().replace(/\s+/g, '') !== toJabatan.toLowerCase().replace(/\s+/g, '')) {
          jenis = 'Beralih';
          cls = 'bg-blue-100 text-blue-700';
        } else {
          jenis = 'Beralih';
          cls = 'bg-blue-100 text-blue-700';
        }
      }

      badge.textContent = jenis;
      badge.className = `px-2 py-1 rounded-full text-xs ${cls}`;
    },

    autoFillTunjangan() {
      const jabatan = Utils.$('penugasanToJabatan')?.value?.trim() || '';
      const key = jabatan.toLowerCase().replace(/[\s_]+/g, '');
      const map = state.penugasanJabatanMap || {};
      const nominal = Object.prototype.hasOwnProperty.call(map, key) ? (Number(map[key]) || 0) : 0;

      let kepala = 0;
      let wali = 0;
      let honor = 0;
      if (key.includes('kepalasekolah') || key.includes('kepsek') || key.includes('wakasek') || key.includes('pimpinan') || key.includes('ketua')) {
        kepala = nominal;
      } else if (key.includes('bendahara')) {
        honor = nominal;
      } else if (key.includes('walikelas')) {
        wali = nominal;
      }

      const kepalaEl = Utils.$('penugasanTunjKepalaSekolah');
      const waliEl = Utils.$('penugasanTunjWaliKelas');
      const honorEl = Utils.$('penugasanHonorBendahara');
      if (kepalaEl) kepalaEl.value = kepala;
      if (waliEl) waliEl.value = wali;
      if (honorEl) honorEl.value = honor;
    },

    onStartDateChange() {
      if (Utils.$('penugasanAutoEndDate')?.checked) {
        const start = Utils.$('penugasanTanggalMulai')?.value;
        const endEl = Utils.$('penugasanTanggalSelesai');
        if (start && endEl) endEl.value = `${start.slice(0, 4)}-12-31`;
      }
      this.updatePeriodePreview();
      this.updateJenisBadge();
    },

    onAutoEndDateChange() {
      const checked = !!Utils.$('penugasanAutoEndDate')?.checked;
      const endEl = Utils.$('penugasanTanggalSelesai');
      if (endEl) endEl.disabled = checked;
      if (checked) this.onStartDateChange();
      else this.updatePeriodePreview();
    },

    applyDurationPreset(months) {
      const start = Utils.$('penugasanTanggalMulai')?.value;
      if (!start) return;
      const startDate = new Date(start + 'T00:00:00');
      const endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + Number(months));
      endDate.setDate(endDate.getDate() - 1);

      const y = endDate.getFullYear();
      const m = String(endDate.getMonth() + 1).padStart(2, '0');
      const d = String(endDate.getDate()).padStart(2, '0');
      const endEl = Utils.$('penugasanTanggalSelesai');
      const autoEl = Utils.$('penugasanAutoEndDate');
      if (autoEl) autoEl.checked = false;
      if (endEl) {
        endEl.disabled = false;
        endEl.value = `${y}-${m}-${d}`;
      }
      this.updatePeriodePreview();
    },

    updatePeriodePreview() {
      const start = Utils.$('penugasanTanggalMulai')?.value;
      const end = Utils.$('penugasanTanggalSelesai')?.value;
      const el = Utils.$('penugasanPeriodePreview');
      if (!el) return;
      if (!start || !end) { el.value = ''; return; }

      const s = new Date(start + 'T00:00:00');
      const e = new Date(end + 'T00:00:00');
      if (isNaN(s) || isNaN(e) || e < s) { el.value = '-'; return; }

      let months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
      const days = e.getDate() - s.getDate();
      if (days < 0) months--;

      let totalMonths = months;
      if (days >= -1 && s.getDate() === 1 && e.getDate() === 31 && s.getMonth() === 0 && e.getMonth() === 11) {
        totalMonths = 12;
      } else {
        totalMonths += 1;
      }
      if (totalMonths < 0) totalMonths = 0;

      const years = Math.floor(totalMonths / 12);
      const rem = totalMonths % 12;
      el.value = years >= 1
        ? `${years} Tahun${rem > 0 ? ' ' + rem + ' Bulan' : ''}`
        : `${rem} Bulan`;
    },

    showForm(teacherId) {
      const form = Utils.$('penugasanForm');
      if (form) form.reset();

      const teacherSel = Utils.$('penugasanTeacherSelect');
      if (teacherSel) teacherSel.innerHTML = '<option value="">Pilih Guru</option>';
      this.renderTeacherOptions();

      if (teacherId) {
        const sel = Utils.$('penugasanTeacherSelect');
        if (sel) {
          sel.value = String(teacherId);
          this.onTeacherChange();
        }
      }

      const fromSel = Utils.$('penugasanFromAssignmentSelect');
      if (fromSel) fromSel.innerHTML = '<option value="">Pilih Assignment</option>';
      const fromUnit = Utils.$('penugasanFromUnit');
      const fromJabatan = Utils.$('penugasanFromJabatan');
      if (fromUnit) fromUnit.value = '';
      if (fromJabatan) fromJabatan.value = '';

      const toTenant = Utils.$('penugasanToTenant');
      if (toTenant) toTenant.value = state.currentTenant || '';
      const toJabatan = Utils.$('penugasanToJabatan');
      if (toJabatan) toJabatan.value = '';

      ['penugasanTunjKepalaSekolah', 'penugasanTunjWaliKelas', 'penugasanHonorBendahara'].forEach(id => {
        const el = Utils.$(id);
        if (el) el.value = 0;
      });

      const periode = Utils.$('penugasanPeriodePreview');
      if (periode) periode.value = '';
      const keterangan = Utils.$('penugasanKeterangan');
      if (keterangan) keterangan.value = '';
      const tentang = Utils.$('penugasanTentang');
      if (tentang) tentang.value = '';

      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      const startEl = Utils.$('penugasanTanggalMulai');
      const endEl = Utils.$('penugasanTanggalSelesai');
      const autoEl = Utils.$('penugasanAutoEndDate');
      if (startEl) startEl.value = `${yyyy}-${mm}-${dd}`;
      if (autoEl) autoEl.checked = true;
      if (endEl) {
        endEl.disabled = true;
        endEl.value = `${yyyy}-12-31`;
      }

      this.updateJenisBadge();
      this.updatePeriodePreview();
      Utils.showModal('penugasanModal');
    },

    buildPayload() {
      const teacherId = Utils.$('penugasanTeacherSelect')?.value;
      const fromAssignmentId = Utils.$('penugasanFromAssignmentSelect')?.value;
      const toTenantId = Utils.$('penugasanToTenant')?.value;
      const toJabatan = Utils.$('penugasanToJabatan')?.value?.trim();
      const tanggalMulai = Utils.$('penugasanTanggalMulai')?.value;
      const tanggalSelesai = Utils.$('penugasanTanggalSelesai')?.value;

      if (!teacherId) { Utils.showToast('Pilih guru terlebih dahulu', 'error'); return null; }
      if (!toTenantId) { Utils.showToast('Pilih sekolah tujuan', 'error'); return null; }
      if (!toJabatan) { Utils.showToast('Isi jabatan baru', 'error'); return null; }
      if (!tanggalMulai || !tanggalSelesai) { Utils.showToast('Lengkapi tanggal mulai dan selesai', 'error'); return null; }

      return {
        teacher_id: Number(teacherId),
        from_assignment_id: fromAssignmentId ? Number(fromAssignmentId) : null,
        to_tenant_id: toTenantId,
        to_jabatan: toJabatan,
        tanggal_mulai: tanggalMulai,
        tanggal_selesai: tanggalSelesai,
        tentang: Utils.$('penugasanTentang')?.value?.trim() || '',
        keterangan: Utils.$('penugasanKeterangan')?.value?.trim() || '',
        tunj_kepala_sekolah: Number(Utils.$('penugasanTunjKepalaSekolah')?.value || 0),
        tunj_wali_kelas: Number(Utils.$('penugasanTunjWaliKelas')?.value || 0),
        honor_bendahara: Number(Utils.$('penugasanHonorBendahara')?.value || 0)
      };
    },

    async preview(event) {
      if (event) event.preventDefault();
      const payload = this.buildPayload();
      if (!payload) return;

      try {
        Swal.fire({ title: 'Memproses...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        const data = await Api.post('/sk-guru/penugasan/preview', payload);
        Swal.close();
        if (!data.success) throw new Error(data.message || 'Gagal preview');
        this.renderPreview(data.data);
        Utils.hideModal('penugasanModal');
        Utils.showModal('penugasanPreviewModal');
      } catch (err) {
        Swal.close();
        Utils.showToast(err.message || 'Gagal preview SK', 'error');
      }
    },

    renderPreview(d) {
      const content = Utils.$('penugasanPreviewContent');
      const route = Utils.$('penugasanPreviewRoute');
      if (!content) return;

      const rows = [
        ['No. Surat', d.no_surat],
        ['Tentang', d.tentang],
        ['Nama', d.nama],
        ['TTL', d.ttl],
        ['TMT', d.tmt],
        ['Pendidikan', d.pt],
        ['NIY', d.niy],
        ['Unit', d.unit],
        ['Jabatan', d.jabatan],
        ['Status', d.status],
        ['Tanggal Mulai', d.tgl_mulai],
        ['Tanggal Selesai', d.tgl_selesai],
        ['Periode', d.periode],
        ['BH', d.bh],
        ['BM', d.bm]
      ];
      content.innerHTML = rows.map(([label, value]) => `
        <div>
          <div class="text-xs text-gray-500">${Utils.escapeHtml(label)}</div>
          <div class="font-medium text-gray-900">${Utils.escapeHtml(value || '-')}</div>
        </div>
      `).join('');

      if (route) {
        const from = d.from ? `${d.from.nama_sekolah || d.from.tenant_id} - ${d.from.jabatan || '-'}` : 'Belum ada penugasan';
        const to = `${d.to.nama_sekolah} - ${d.to.jabatan}`;
        route.innerHTML = `<strong>Rute penugasan:</strong> ${Utils.escapeHtml(from)} &rarr; ${Utils.escapeHtml(to)}<br><span class="text-xs text-indigo-700">Jenis: ${Utils.escapeHtml(d.jenis)}</span>`;
      }
      state.penugasanPreviewData = d;
    },

    backToForm() {
      Utils.hideModal('penugasanPreviewModal');
      Utils.showModal('penugasanModal');
    },

    async save() {
      const payload = this.buildPayload();
      if (!payload) return;

      try {
        Swal.fire({ title: 'Menyimpan & generate SK...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        const data = await Api.post('/sk-guru/penugasan', payload);
        Swal.close();
        if (!data.success) throw new Error(data.message || 'Gagal menyimpan penugasan');

        const result = data.data;
        Utils.hideModal('penugasanPreviewModal');
        Utils.hideModal('penugasanModal');

        Swal.fire({
          title: 'Penugasan Disimpan',
          html: `<p class="text-sm text-gray-700">SK berhasil dibuat:</p><p class="font-mono text-sm mt-1">${Utils.escapeHtml(result.no_surat || '-')}</p>${result.warning ? `<p class="text-xs text-amber-600 mt-2">${Utils.escapeHtml(result.warning)}</p>` : ''}`,
          icon: 'success',
          showCancelButton: true,
          confirmButtonText: 'Download SK',
          cancelButtonText: 'Tutup',
          confirmButtonColor: '#4f46e5'
        }).then(res => {
          if (res.isConfirmed && result.download_url) this.downloadSk(result.download_url);
        });

        this.loadList(1);
        this.loadCandidates();
      } catch (err) {
        Swal.close();
        Utils.showToast(err.message || 'Gagal menyimpan penugasan', 'error');
      }
    },

    async downloadSk(url) {
      try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) throw new Error('Gagal mengunduh SK');
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/pdf') && !contentType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')) {
          const text = await res.text();
          throw new Error(text || 'Gagal mengunduh SK');
        }
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `SK_Penugasan_${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(blobUrl);
      } catch (err) {
        Utils.showToast(err.message || 'Gagal mengunduh SK', 'error');
      }
    },

    handleSearch(event) {
      if (event && event.key && event.key !== 'Enter') {
        clearTimeout(state.searchDebounce.penugasan);
        state.searchDebounce.penugasan = setTimeout(() => this.loadList(1), 350);
        return;
      }
      this.loadList(1);
    },

    async loadList(page = 1) {
      state.penugasanPage = page;
      const params = new URLSearchParams({ page, limit: 15 });
      const q = Utils.$('penugasanSearch')?.value?.trim();
      const tenant = Utils.$('penugasanTenantFilter')?.value;
      const jenis = Utils.$('penugasanJenisFilter')?.value;
      const status = Utils.$('penugasanStatusFilter')?.value;
      if (q) params.set('q', q);
      if (tenant) params.set('tenant_id', tenant);
      if (jenis) params.set('jenis', jenis);
      if (status) params.set('status', status);

      try {
        const tbody = Utils.$('penugasanTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="12" class="px-4 py-12 text-center text-gray-500"><i class="fas fa-spinner fa-spin text-xl mb-2"></i><p>Memuat data...</p></td></tr>';

        const data = await Api.get(`/sk-guru/penugasan?${params}`);
        if (!data.success || !data.data?.data?.length) {
          if (tbody) tbody.innerHTML = '<tr><td colspan="12" class="px-4 py-12 text-center text-gray-500">Belum ada data penugasan</td></tr>';
          const pagination = Utils.$('penugasanPagination');
          if (pagination) pagination.innerHTML = '';
          return;
        }

        const rows = data.data.data;
        if (tbody) {
          tbody.innerHTML = rows.map((r, i) => {
            const from = [r.from_unit, r.from_jabatan].filter(Boolean).join(' - ') || '-';
            const to = [r.to_unit, r.to_jabatan].filter(Boolean).join(' - ') || '-';
            const isPenugasan = r.is_penugasan === 1;
            const noSurat = r.no_surat || r.sk_no_surat || '-';
            const statusBadge = isPenugasan
              ? (r.status === 'aktif'
                  ? 'bg-green-100 text-green-700'
                  : r.status === 'digantikan'
                    ? 'bg-gray-100 text-gray-600'
                    : r.status === 'dibatalkan'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-blue-100 text-blue-700')
              : 'bg-emerald-100 text-emerald-700';
            const jenisLabel = isPenugasan
              ? (r.jenis === 'baru' ? 'Baru' : r.jenis === 'mutasi' ? 'Mutasi' : 'Beralih')
              : 'Assignment';
            const jenisBadge = isPenugasan
              ? (r.jenis === 'mutasi'
                  ? 'bg-purple-100 text-purple-700'
                  : r.jenis === 'baru'
                    ? 'bg-gray-100 text-gray-600'
                    : 'bg-blue-100 text-blue-700')
              : 'bg-emerald-100 text-emerald-700';

            return `
              <tr class="hover:bg-gray-50">
                <td class="px-4 py-3 text-sm text-gray-500">${(page - 1) * 15 + i + 1}</td>
                <td class="px-4 py-3 text-sm font-medium text-gray-900">
                  ${Utils.escapeHtml(r.nama || '-')}
                  <div class="text-xs text-gray-500">${Utils.escapeHtml(r.nik || '-')}</div>
                </td>
                <td class="px-4 py-3 text-sm text-gray-700">${Utils.escapeHtml(from)}</td>
<td class="px-4 py-3 text-sm text-gray-700">${Utils.escapeHtml(to)}</td>
                <td class="px-4 py-3 text-sm text-gray-700">${Utils.escapeHtml(r.to_jabatan || '-')}</td>
                <td class="px-4 py-3"><span class="px-2 py-1 rounded-full text-xs ${jenisBadge}">${Utils.escapeHtml(jenisLabel)}</span></td>
                <td class="px-4 py-3 text-sm text-gray-700">${Utils.formatDate(r.tanggal_mulai)}</td>
                <td class="px-4 py-3 text-sm text-gray-700">${Utils.formatDate(r.tanggal_selesai)}</td>
                <td class="px-4 py-3 text-sm text-gray-700">${Utils.escapeHtml(r.periode || '-')}</td>
                <td class="px-4 py-3 text-xs font-mono text-gray-700">${Utils.escapeHtml(noSurat)}</td>
                <td class="px-4 py-3"><span class="px-2 py-1 rounded-full text-xs ${statusBadge}">${Utils.escapeHtml(r.status || '-')}</span></td>
                <td class="px-4 py-3">
                  <div class="flex items-center space-x-2">
                    <button onclick="SDMDashboard.Penugasan.showDetail(${r.id}, ${isPenugasan}, ${r.teacher_id})" class="${isPenugasan ? 'text-indigo-600 hover:text-indigo-800' : 'text-amber-600 hover:text-amber-800'} text-sm" title="${isPenugasan ? 'Detail' : 'Buat Penugasan'}"><i class="fas ${isPenugasan ? 'fa-eye' : 'fa-edit'}"></i></button>
                    ${r.sk_guru_id ? `<button onclick="SDMDashboard.Penugasan.downloadSk('/api/sk-guru/file/${r.sk_guru_id}?view=1')" class="text-emerald-600 hover:text-emerald-800 text-sm" title="Download SK"><i class="fas fa-download"></i></button>` : ''}
                  </div>
                </td>
              </tr>`;
          }).join('');
          this.renderPagination(data.data.page, data.data.pages);
        }
      } catch (err) {
        console.error('Load penugasan list error:', err);
        const tbody = Utils.$('penugasanTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="12" class="px-4 py-12 text-center text-red-500">Gagal memuat data</td></tr>';
      }
    },

    renderPagination(current, last) {
      const container = Utils.$('penugasanPagination');
      if (!container) return;
      if (!last || last <= 1) { container.innerHTML = ''; return; }

      let html = `<button class="pagination-btn" onclick="SDMDashboard.Penugasan.loadList(${current - 1})"><i class="fas fa-chevron-left"></i></button>`;
      for (let i = 1; i <= last; i++) {
        html += `<button class="pagination-btn ${i === current ? 'active' : ''}" onclick="SDMDashboard.Penugasan.loadList(${i})">${i}</button>`;
      }
      html += `<button class="pagination-btn" onclick="SDMDashboard.Penugasan.loadList(${current + 1})"><i class="fas fa-chevron-right"></i></button>`;
      container.innerHTML = html;
    },

    async showDetail(id, isPenugasan, teacherId) {
      if (!isPenugasan) {
        // Baris ini assignment aktif yang belum punya riwayat penugasan -> buka form untuk membuat penugasan
        return this.showForm(teacherId);
      }

      try {
        const data = await Api.get(`/sk-guru/penugasan/${id}`);
        if (!data.success) throw new Error(data.message || 'Gagal memuat detail');
        const r = data.data;
        const from = [r.from_unit, r.from_jabatan].filter(Boolean).join(' - ') || 'Belum ada penugasan';
        const to = [r.to_unit, r.to_jabatan].filter(Boolean).join(' - ') || '-';

        Swal.fire({
          title: 'Detail Penugasan',
          html: `
            <div class="text-left text-sm space-y-2">
              <div><strong>Nama:</strong> ${Utils.escapeHtml(r.nama || '-')}</div>
              <div><strong>NIK:</strong> ${Utils.escapeHtml(r.nik || '-')}</div>
              <div><strong>Dari:</strong> ${Utils.escapeHtml(from)}</div>
              <div><strong>Ke:</strong> ${Utils.escapeHtml(to)}</div>
              <div><strong>Jenis:</strong> ${Utils.escapeHtml(r.jenis || '-')}</div>
              <div><strong>Tanggal:</strong> ${Utils.formatDate(r.tanggal_mulai)} - ${Utils.formatDate(r.tanggal_selesai)}</div>
              <div><strong>Periode:</strong> ${Utils.escapeHtml(r.periode || '-')}</div>
              <div><strong>No SK:</strong> ${Utils.escapeHtml(r.no_surat || r.sk_no_surat || '-')}</div>
              <div><strong>Status:</strong> ${Utils.escapeHtml(r.status || '-')}</div>
              ${r.keterangan ? `<div><strong>Keterangan:</strong> ${Utils.escapeHtml(r.keterangan)}</div>` : ''}
            </div>`,
          showCancelButton: !!r.sk_guru_id,
          confirmButtonText: 'Download SK',
          cancelButtonText: 'Tutup',
          confirmButtonColor: '#4f46e5'
        }).then(res => {
          if (res.isConfirmed && r.sk_guru_id) this.downloadSk(`/api/sk-guru/file/${r.sk_guru_id}?view=1`);
        });
      } catch (err) {
        Utils.showToast(err.message || 'Gagal memuat detail', 'error');
      }
    }
  };

  // ============================================================
  // KPI MODULE
  // ============================================================
  const Kpi = {
    async load() {
      await this.loadPeriods();
      await this.loadTemplates();
      await this.loadOverview();
      this.applyAccessControl();
    },

    switchView(view) {
      ['overview', 'template', 'period'].forEach(v => {
        Utils.$(`kpi${v.charAt(0).toUpperCase() + v.slice(1)}Section`)?.classList.add('hidden');
        Utils.$(`kpi${v.charAt(0).toUpperCase() + v.slice(1)}Btn`)?.classList.remove('bg-indigo-600', 'text-white');
        Utils.$(`kpi${v.charAt(0).toUpperCase() + v.slice(1)}Btn`)?.classList.add('bg-gray-200', 'text-gray-700');
      });
      Utils.$(`kpi${view.charAt(0).toUpperCase() + view.slice(1)}Section`)?.classList.remove('hidden');
      Utils.$(`kpi${view.charAt(0).toUpperCase() + view.slice(1)}Btn`)?.classList.add('bg-indigo-600', 'text-white');
      Utils.$(`kpi${view.charAt(0).toUpperCase() + view.slice(1)}Btn`)?.classList.remove('bg-gray-200', 'text-gray-700');

      if (view === 'template') this.loadTemplates();
      if (view === 'period') this.loadPeriods();
      if (view === 'overview') this.loadOverview();
    },

    async loadPeriods() {
      try {
        const [periodsData, teachersData] = await Promise.all([
          Api.get('/sdm/kpi/periods'),
          Api.get('/sdm-dashboard/teacher-list?limit=1000')
        ]);

        const sel = Utils.$('kpiPeriodSelect');
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

        const tsel = Utils.$('kpiTeacherSelect');
        tsel.innerHTML = '<option value="">Semua Guru</option>';
        if (teachersData.success && teachersData.data?.data?.length) {
          teachersData.data.data.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = `${t.nama} - ${t.nama_sekolah || ''}`;
            tsel.appendChild(opt);
          });
        }

        const tbody = Utils.$('kpiPeriodTable');
        if (periodsData.success && periodsData.data?.length) {
          tbody.innerHTML = periodsData.data.map(p => {
            const statusBadge = p.status === 'aktif'
              ? '<span class="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">Aktif</span>'
              : '<span class="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">Draft</span>';
            return `
              <tr>
                <td class="px-4 py-3 text-sm font-medium text-gray-900">${Utils.escapeHtml(p.nama)}</td>
                <td class="px-4 py-3 text-sm text-gray-700 capitalize">${Utils.escapeHtml(p.jenis)}</td>
                <td class="px-4 py-3 text-sm text-gray-700">${p.tahun || '-'}</td>
                <td class="px-4 py-3 text-sm text-gray-700">${p.tanggal_mulai ? Utils.formatDate(p.tanggal_mulai) : '-'}</td>
                <td class="px-4 py-3 text-sm text-gray-700">${p.tanggal_selesai ? Utils.formatDate(p.tanggal_selesai) : '-'}</td>
                <td class="px-4 py-3">${statusBadge}</td>
                <td class="px-4 py-3">
                  ${state.isSdmPusat ? `<button onclick="SDMDashboard.Kpi.deletePeriod(${p.id})" class="text-red-600 hover:text-red-800 text-sm"><i class="fas fa-trash"></i></button>` : ''}
                </td>
              </tr>`;
          }).join('');
        } else {
          tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-500">Belum ada periode</td></tr>';
        }
      } catch (err) {
        Utils.showToast('Gagal memuat periode penilaian KPI', 'error');
      }
    },

    async loadTemplates() {
      try {
        const kategori = Utils.$('kpiKategoriSelect')?.value || '';
        const data = await Api.get(`/sdm/kpi/templates${kategori ? `?kategori=${kategori}` : ''}`);
        const tbody = Utils.$('kpiTemplateTable');
        if (data.success && data.data?.length) {
          tbody.innerHTML = data.data.map(t => {
            const sumberBadge = t.sumber === 'kehadiran'
              ? '<span class="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">Auto: Kehadiran</span>'
              : t.sumber === 'evaluasi'
                ? '<span class="px-2 py-1 text-xs font-medium bg-purple-100 text-purple-800 rounded-full">Auto: Evaluasi</span>'
                : '<span class="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">Manual</span>';
            return `
              <tr>
                <td class="px-4 py-3 text-sm font-medium text-gray-900">${Utils.escapeHtml(t.nama)}</td>
                <td class="px-4 py-3 text-sm text-gray-700 capitalize">${Utils.escapeHtml(t.kategori)}</td>
                <td class="px-4 py-3 text-sm text-gray-700">${t.bobot}%</td>
                <td class="px-4 py-3 text-sm text-gray-700">${t.target_default}</td>
                <td class="px-4 py-3">${sumberBadge}</td>
                <td class="px-4 py-3">
                  ${state.isSdmPusat ? `
                  <button onclick="SDMDashboard.Kpi.showTemplateModal(${t.id})" class="text-indigo-600 hover:text-indigo-800 text-sm mr-2"><i class="fas fa-edit"></i></button>
                  <button onclick="SDMDashboard.Kpi.deleteTemplate(${t.id})" class="text-red-600 hover:text-red-800 text-sm"><i class="fas fa-trash"></i></button>` : '<span class="text-xs text-gray-400">Read-only</span>'}
                </td>
              </tr>`;
          }).join('');
        } else {
          tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-gray-500">Belum ada template KPI</td></tr>';
        }
      } catch (err) {
        Utils.showToast('Gagal memuat template KPI', 'error');
      }
    },

    async loadOverview() {
      const periodId = Utils.$('kpiPeriodSelect')?.value || '';
      const kategori = Utils.$('kpiKategoriSelect')?.value || '';

      try {
        let tK2 = state.currentTenant;
        if (!tK2 && state.user?.assignments?.length) {
          const sa = state.user.assignments.find(a => (a.jabatan_di_unit || "").toLowerCase().includes("sdm"));
          tK2 = sa?.tenant_id || state.user.assignments[0]?.tenant_id;
        }
        const data = await Api.get(`/sdm-dashboard/kpi-summary?period_id=${periodId}${kategori ? `&kategori=${kategori}` : ""}${tK2 ? `&tenant_id=${tK2}` : ""}`);
        const tbody = Utils.$('kpiByJabatanTable');
        if (data.success && data.data?.by_jabatan?.length) {
          tbody.innerHTML = data.data.by_jabatan.map(j => {
            const ach = j.avg_achievement || 0;
            const barColor = ach >= 90 ? 'bg-green-500' : ach >= 75 ? 'bg-yellow-500' : 'bg-red-500';
            return `
              <tr>
                <td class="px-4 py-3 text-sm font-medium text-gray-900">${Utils.escapeHtml(j.jabatan)}</td>
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
        Utils.showToast('Gagal memuat ringkasan KPI', 'error');
      }

      const teacherId = Utils.$('kpiTeacherSelect')?.value || '';
      if (teacherId && periodId) {
        this.loadInputTable(teacherId, periodId);
      } else {
        Utils.$('kpiInputTable').innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-500">Pilih guru dan periode untuk mengisi nilai KPI</td></tr>';
      }
    },

    async loadTeacherDetail() {
      const teacherId = Utils.$('kpiTeacherSelect')?.value || '';
      const periodId = Utils.$('kpiPeriodSelect')?.value || '';
      const kategori = Utils.$('kpiKategoriSelect')?.value || '';

      if (!periodId) {
        Utils.showToast('Pilih periode penilaian terlebih dahulu', 'info');
        return;
      }

      try {
        const data = await Api.get(`/sdm-dashboard/kpi-summary?period_id=${periodId}${kategori ? `&kategori=${kategori}` : ''}`);
        const tbody = Utils.$('kpiByJabatanTable');
        if (data.success && data.data?.by_jabatan?.length) {
          tbody.innerHTML = data.data.by_jabatan.map(j => {
            const ach = j.avg_achievement || 0;
            const barColor = ach >= 90 ? 'bg-green-500' : ach >= 75 ? 'bg-yellow-500' : 'bg-red-500';
            return `
              <tr>
                <td class="px-4 py-3 text-sm font-medium text-gray-900">${Utils.escapeHtml(j.jabatan)}</td>
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
        Utils.showToast('Gagal memuat detail KPI guru', 'error');
      }

      if (teacherId && periodId) this.loadInputTable(teacherId, periodId);
    },

    async loadInputTable(teacherId, periodId) {
      try {
        const [templatesRes, assessmentRes] = await Promise.all([
          Api.get('/sdm/kpi/templates'),
          Api.get(`/sdm/kpi/assessment-detail?teacher_id=${teacherId}&period_id=${periodId}`)
        ]);

        const templates = templatesRes.success ? templatesRes.data : [];
        const scores = {};
        if (assessmentRes.success && assessmentRes.data?.length) {
          assessmentRes.data.forEach(a => { scores[a.indicator_id] = a; });
        }

        const tbody = Utils.$('kpiInputTable');
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
              <td class="px-4 py-3 text-sm font-medium text-gray-900">${Utils.escapeHtml(t.nama)}</td>
              <td class="px-4 py-3 text-sm text-gray-700 capitalize">${Utils.escapeHtml(t.kategori)}</td>
              <td class="px-4 py-3 text-sm text-gray-700">${t.bobot}%</td>
              <td class="px-4 py-3"><input type="number" class="kpi-target w-24 px-2 py-1 border border-gray-300 rounded text-sm" value="${target}" ${disabled}></td>
              <td class="px-4 py-3"><input type="number" class="kpi-nilai w-24 px-2 py-1 border border-gray-300 rounded text-sm" value="${nilai}" ${disabled}></td>
              <td class="px-4 py-3"><input type="number" class="kpi-pencapaian w-24 px-2 py-1 border border-gray-300 rounded text-sm" value="${penc}" ${disabled}></td>
              <td class="px-4 py-3"><input type="number" class="kpi-skor w-20 px-2 py-1 border border-gray-300 rounded text-sm" value="${skor}" ${disabled}></td>
              <td class="px-4 py-3 text-center">
                ${hasScore && !disabled ? `<button onclick="SDMDashboard.Kpi.clearScore(${t.id}, '${Utils.escapeHtml(t.nama).replace(/'/g, "\\'")}')" class="text-xs text-red-600 hover:text-red-800" title="Hapus nilai"><i class="fas fa-trash"></i></button>` : ''}
              </td>
            </tr>`;
        }).join('');
      } catch (err) {
        Utils.showToast('Gagal memuat tabel input KPI', 'error');
      }
    },

    async clearScore(indicatorId, indicatorName) {
      const teacherId = Utils.$('kpiTeacherSelect')?.value;
      const periodId = Utils.$('kpiPeriodSelect')?.value;
      if (!teacherId || !periodId) return;

      const confirm = await Swal.fire({
        title: 'Hapus nilai KPI?',
        html: `Nilai untuk indikator <strong>${Utils.escapeHtml(indicatorName)}</strong> akan dihapus.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Ya, hapus',
        confirmButtonColor: '#dc2626'
      });
      if (!confirm.isConfirmed) return;

      try {
        Swal.fire({ title: 'Menghapus...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        await Api.post('/sdm/kpi/assessments', {
          teacher_id: parseInt(teacherId),
          indicator_id: parseInt(indicatorId),
          period_id: parseInt(periodId),
          nilai_aktual: null,
          target: null,
          pencapaian: null,
          skor: null
        });
        Utils.showToast('Nilai KPI dihapus', 'success');
        this.loadInputTable(teacherId, periodId);
        this.loadOverview();
      } catch (err) {
        Utils.showToast(err.message || 'Gagal menghapus nilai KPI', 'error');
      }
    },

    async saveScores() {
      const teacherId = Utils.$('kpiTeacherSelect')?.value;
      const periodId = Utils.$('kpiPeriodSelect')?.value;
      if (!teacherId || !periodId) {
        Utils.showToast('Pilih guru dan periode terlebih dahulu', 'warning');
        return;
      }
      if (!state.isSdmPusat) {
        Utils.showToast('Hanya SDM Pusat yang boleh menginput nilai KPI', 'error');
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
        Utils.showToast('Belum ada nilai yang diisi', 'info');
        return;
      }

      try {
        Swal.fire({
          title: 'Menyimpan...',
          html: '<div style="text-align:left;margin-top:1rem;"><div class="swal2-progress-bar" style="width:100%;background:#eee;height:4px;border-radius:2px;"><div id="kpiSaveProgress" style="width:0%;background:#4f46e5;height:4px;border-radius:2px;transition:width 0.3s;"></div></div><div id="kpiSaveStatus" style="margin-top:0.5rem;font-size:0.8rem;color:#888;">Memproses 0 dari ' + assessments.length + ' indikator...</div></div>',
          allowOutsideClick: false,
          didOpen: () => Swal.showLoading()
        });

        const bulkPayload = assessments.map(a => ({ ...a, period_id: parseInt(periodId) }));

        let result;
        try {
          result = await Api.post('/sdm/kpi/assessments/bulk', { assessments: bulkPayload });
        } catch (bulkErr) {
          let successCount = 0;
          for (let i = 0; i < assessments.length; i++) {
            const a = assessments[i];
            const progress = ((i + 1) / assessments.length) * 100;
            Utils.$('kpiSaveProgress').style.width = progress + '%';
            Utils.$('kpiSaveStatus').textContent = `Memproses ${i + 1} dari ${assessments.length} indikator...`;
            try {
              await Api.post('/sdm/kpi/assessments', { ...a, period_id: parseInt(periodId) });
              successCount++;
            } catch (e) {
              console.error(`Gagal menyimpan indikator ${a.indicator_id}:`, e);
            }
          }
          result = { success: true, message: `${successCount} dari ${assessments.length} nilai KPI tersimpan` };
        }

        Utils.$('kpiSaveProgress').style.width = '100%';
        Utils.$('kpiSaveStatus').textContent = 'Selesai!';

        await new Promise(r => setTimeout(r, 500));

        if (result.success) {
          Utils.showToast(result.message || `${assessments.length} nilai KPI tersimpan`, 'success');
          this.loadOverview();
        } else {
          Utils.showToast(result.message || 'Gagal menyimpan nilai KPI', 'error');
        }
      } catch (err) {
        Utils.showToast(err.message || 'Gagal menyimpan nilai KPI', 'error');
      }
    },

    applyAccessControl() {
      if (state.isSdmPusat) return;

      if (state.isSdmPusat) return;

      const disabledEls = document.querySelectorAll('#kpiTemplateBtn, #kpiPeriodBtn, button[onclick*="saveKpi"], button[onclick*="showKpiTemplateModal"], button[onclick*="showKpiPeriodModal"]');
      disabledEls.forEach(el => el.disabled = true);

      const overviewSection = Utils.$('kpiOverviewSection');
      if (overviewSection) {
        const existingMsg = overviewSection.querySelector('.kpi-readonly-msg');
        if (!existingMsg) {
          const msg = document.createElement('div');
          msg.className = 'kpi-readonly-msg';
          msg.innerHTML = '<div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6"><div class="flex items-start"><i class="fas fa-info-circle text-blue-600 mt-0.5 mr-3"></i><div class="text-sm text-blue-800"><p class="font-semibold mb-1">Akses Read-Only</p><p>Anda bukan SDM Pusat. Hanya dapat melihat data KPI, tidak dapat mengedit atau menambah template/periode.</p></div></div></div>';
          overviewSection.insertBefore(msg, overviewSection.firstChild);
        }
      }
    },

    saveKafalahEdit: () => {
      Utils.showToast('Edit KAFALAH manual - implementasi backend diperlukan', 'info');
      Utils.hideModal('kafalahEditModal');
    },

    showTemplateModal() {
      ['kpiTemplateId', 'kpiTemplateNama', 'kpiTemplateBobot', 'kpiTemplateTarget', 'kpiTemplateKeterangan'].forEach(id => {
        const el = Utils.$(id); if (el) el.value = '';
      });
      const title = Utils.$('kpiTemplateModalTitle'); if (title) title.textContent = 'Tambah Template KPI';
      Utils.showModal('kpiTemplateModal');
    },

    async saveTemplate() {
      const val = id => Utils.$(id)?.value;
      const payload = {
        id: val('kpiTemplateId') ? parseInt(val('kpiTemplateId')) : undefined,
        nama: val('kpiTemplateNama'),
        kategori: val('kpiTemplateKategori'),
        bobot: val('kpiTemplateBobot'),
        target_default: val('kpiTemplateTarget'),
        sumber: val('kpiTemplateSumber'),
        keterangan: val('kpiTemplateKeterangan')
      };
      if (!payload.nama || !payload.kategori) { Utils.showToast('Nama & kategori wajib diisi', 'warning'); return; }
      try {
        const res = await Api.post('/sdm/kpi/templates', payload);
        if (res.success) {
          Utils.showToast('Template KPI disimpan', 'success');
          Utils.hideModal('kpiTemplateModal');
          if (Kpi.loadTemplates) await Kpi.loadTemplates();
        } else Utils.showToast(res.message || 'Gagal menyimpan', 'error');
      } catch (e) { Utils.showToast('Gagal menyimpan template', 'error'); }
    },

    showPeriodModal() {
      ['kpiPeriodNama', 'kpiPeriodMulai', 'kpiPeriodSelesai'].forEach(id => { const el = Utils.$(id); if (el) el.value = ''; });
      const y = Utils.$('kpiPeriodTahun'); if (y && !y.value) y.value = new Date().getFullYear();
      Utils.showModal('kpiPeriodModal');
    },

    async savePeriod() {
      const mulai = Utils.$('kpiPeriodMulai')?.value;
      const payload = {
        nama: Utils.$('kpiPeriodNama')?.value,
        jenis: Utils.$('kpiPeriodJenis')?.value,
        tahun: Utils.$('kpiPeriodTahun')?.value,
        bulan: mulai ? parseInt(mulai.split('-')[1]) : undefined,
        tanggal_mulai: mulai || undefined,
        tanggal_selesai: Utils.$('kpiPeriodSelesai')?.value || undefined
      };
      if (!payload.nama || !payload.jenis || !payload.tahun) { Utils.showToast('Nama, jenis, tahun wajib diisi', 'warning'); return; }
      try {
        const res = await Api.post('/sdm/kpi/periods', payload);
        if (res.success) {
          Utils.showToast('Periode KPI disimpan', 'success');
          Utils.hideModal('kpiPeriodModal');
          if (Kpi.loadPeriods) await Kpi.loadPeriods();
        } else Utils.showToast(res.message || 'Gagal menyimpan', 'error');
      } catch (e) { Utils.showToast('Gagal menyimpan periode', 'error'); }
    }
  };

  // ============================================================
  // RECAP ABSENSI MODULE
  // ============================================================
  const Recap = {
    async load() {
      await Utils.fillTenants('recapTenantSelect', Utils.$('recapTenantSelect')?.value || state.currentTenant);
      Utils.fillYears('recapTahun', Utils.$('recapTahun')?.value);
      const monthSel = Utils.$('recapBulan');
      if (monthSel && !monthSel.dataset.defaulted) {
        monthSel.value = String(new Date().getMonth() + 1);
        monthSel.dataset.defaulted = '1';
      }
      const t = Utils.$('recapTenantSelect')?.value;
      if (t) return Recap.loadMonthlyRecap('lengkap');
    },

    async loadMonthlyRecap(mode = 'hadir') {
      const monthNames = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
      const tenantId = Utils.$('recapTenantSelect')?.value;
      const month = Utils.$('recapBulan')?.value;
      const year = Utils.$('recapTahun')?.value;
      const content = Utils.$('monthlyRecapContent');
      if (!content) return;
      if (!tenantId || !month || !year) { Utils.showToast('Pilih sekolah, bulan, dan tahun', 'error'); return; }
      content.innerHTML = '<p class="text-center py-8"><i class="fas fa-spinner fa-spin"></i> Memuat...</p>';
      try {
        const res = await fetch('/api/admin/attendance-monthly?tenant_id=' + tenantId + '&bulan=' + month + '&tahun=' + year, { headers: Utils.getAuthHeader() });
        const json = await res.json();
        if (!json.success) { Utils.showToast('Gagal memuat data', 'error'); return; }
        const data = json.data || [];
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
              const masukColor = (labelClean === 'TK' || labelClean === 'C' || labelClean === 'I' || labelClean === 'S' || labelClean === 'DL') ? 'text-red-600' : (labelClean === 'T') ? 'text-red-600' : 'text-emerald-600';
              const pulangColor = 'text-emerald-600';
              let cellContent = '';
              if (masuk || pulang) {
                cellContent = '<span class="text-[12px] ' + masukColor + ' block font-medium">' + (masuk || '-') + '</span><span class="text-[11px] ' + pulangColor + '">' + (pulang || '-') + '</span>' + keteranganText;
              } else if (!masuk && !pulang) {
                cellContent = '<span class="text-[12px] text-gray-300">-</span>' + keteranganText;
              }
              bodyHtml += '<td class="p-1 text-center border align-top leading-tight">' + cellContent + '</td>';
            }
            bodyHtml += '<td class="p-1 text-center border text-[11px] text-blue-600 font-bold">' + (d.hadir || 0) + '</td><td class="p-1 text-center border text-[11px] text-yellow-600 font-bold">' + (d.terlambat || 0) + '</td><td class="p-1 text-center border text-[11px] text-red-600 font-bold">' + Math.max(0, daysInMonth - (d.hadir||0) - (d.terlambat||0) - (d.izin||0) - (d.sakit||0) - (d.dinas_luar||0) - (d.cuti||0)) + '</td>';
            bodyHtml += '<td class="p-1 text-center border text-[11px] text-blue-600 font-bold">' + (d.pulang_tepat_waktu || 0) + '</td><td class="p-1 text-center border text-[11px] text-orange-600 font-bold">' + (d.pulang_cepat || 0) + '</td><td class="p-1 text-center border text-[11px] text-red-700 font-bold">' + (d.tidak_absen_pulang || 0) + '</td>';
            bodyHtml += '<td class="p-1 text-center border text-[11px] text-purple-600 font-bold">' + (d.izin || 0) + '</td><td class="p-1 text-center border text-[11px] text-red-600 font-bold">' + (d.sakit || 0) + '</td><td class="p-1 text-center border text-[11px] text-blue-600 font-bold">' + (d.dinas_luar || 0) + '</td><td class="p-1 text-center border text-[11px] text-purple-500 font-bold">' + (d.cuti || 0) + '</td>';
            bodyHtml += '<td class="p-1 text-center border text-[11px] text-red-700 font-bold">' + (d.tanpa_keterangan || 0) + '</td></tr>';
          });
          let totalHadir = 0, totalTerlambat = 0, totalTidakAbsenDatang = 0, totalPulangTepat = 0, totalPulangCepat = 0, totalPulangTidakAbsen = 0, totalIzin = 0, totalSakit = 0, totalCuti = 0, totalDinasLuar = 0, totalTanpaKeterangan = 0;
          data.forEach(d => {
            totalHadir += d.hadir || 0; totalTerlambat += d.terlambat || 0; totalIzin += d.izin || 0; totalSakit += d.sakit || 0; totalCuti += d.cuti || 0; totalDinasLuar += d.dinas_luar || 0; totalTanpaKeterangan += d.tanpa_keterangan || 0;
            totalPulangTepat += d.pulang_tepat_waktu || 0;
            totalPulangCepat += d.pulang_cepat || 0;
            totalPulangTidakAbsen += d.tidak_absen_pulang || 0;
            const totalPerGuru = (d.hadir || 0) + (d.terlambat || 0) + (d.izin || 0) + (d.sakit || 0) + (d.dinas_luar || 0) + (d.cuti || 0);
            totalTidakAbsenDatang += Math.max(0, 30 - totalPerGuru);
          });
          const summaryHtml = `<div class="mt-4 p-4 bg-gradient-to-r from-slate-50 to-blue-50 rounded-xl border border-slate-200 shadow-sm"><h4 class="font-bold text-gray-900 mb-4 flex items-center text-base"><i class="fas fa-chart-pie text-indigo-600 mr-2"></i>Ringkasan Kategori - Rekap Lengkap</h4><div class="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
            <div class="bg-red-100 p-3 rounded-lg border shadow-sm"><p class="text-sm font-bold text-red-800 mb-1 tracking-wide">TANPA KETERANGAN</p><p class="text-sm font-bold text-red-900">${totalTanpaKeterangan}</p><p class="text-sm text-red-600">TK - tanpa catatan absen</p></div>
            <div class="bg-purple-50 p-3 rounded-lg border shadow-sm"><p class="text-sm font-bold text-purple-700 mb-1 tracking-wide">IZIN</p><p class="text-sm text-purple-700">Izin: <b class="text-purple-600">${totalIzin}</b> | Sakit: <b class="text-red-600">${totalSakit}</b></p><p class="text-sm text-purple-700">Dinas Luar: <b class="text-blue-600">${totalDinasLuar}</b> | Cuti: <b class="text-purple-500">${totalCuti}</b></p></div>
            <div class="bg-gradient-to-r from-indigo-50 to-blue-50 p-3 rounded-lg border shadow-sm"><p class="text-sm font-bold text-indigo-800 mb-1 tracking-wide">DATANG</p><p class="text-sm text-indigo-700">Tepat Waktu: <b class="text-indigo-900">${totalHadir}</b> | Terlambat: <b class="text-amber-700">${totalTerlambat}</b></p></div>
            <div class="bg-gradient-to-r from-red-50 to-orange-50 p-3 rounded-lg border shadow-sm"><p class="text-sm font-bold text-red-700 mb-1 tracking-wide">PULANG</p><p class="text-sm text-red-700">Tepat Waktu: <b class="text-blue-700">${totalPulangTepat}</b> | Pulang Cepat: <b class="text-orange-700">${totalPulangCepat}</b></p></div>
            <div class="bg-gradient-to-r from-emerald-50 to-blue-50 p-3 rounded-lg border shadow-sm"><p class="text-sm font-bold text-emerald-700 mb-1 tracking-wide">TOTAL</p><p class="text-sm text-emerald-700">Guru: <b class="text-emerald-900">${data.length}</b> | Hari: <b>${daysInMonth}</b></p></div>
          </div></div>`;
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
    },

    async exportMonthlyPdfFromRecap() {
      const tenantId = Utils.$('recapTenantSelect')?.value;
      const month = Utils.$('recapBulan')?.value;
      const year = Utils.$('recapTahun')?.value;
      const tenantName = Utils.$('recapTenantSelect')?.selectedOptions?.[0]?.text || '';
      if (!tenantId || !month || !year) { Utils.showToast('Pilih sekolah, bulan, dan tahun', 'error'); return; }
      try {
        const res = await fetch('/api/admin/attendance-export-pdf?tenant_id=' + tenantId + '&bulan=' + month + '&tahun=' + year + '&tenant_name=' + encodeURIComponent(tenantName), { headers: Utils.getAuthHeader() });
        if (!res.ok) {
          const json = await res.json().catch(() => ({ message: 'Gagal export PDF' }));
          Utils.showToast(json.message || 'Gagal export PDF', 'error');
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
        Utils.showToast('Gagal export PDF: ' + e.message, 'error');
      }
    }
  };

  // ============================================================
  // ATTENDANCE MODULE
  // ============================================================
  const Attendance = {
    async loadLogs() { return Attendance.load(); },

    async load() {
      const t = state.currentTenant;
      try {
        const data = await Api.get(`/sdm-dashboard/attendance-logs?tenant_id=${t}&date=${Utils.$('attendanceDateFilter').value}`);
        const tbody = Utils.$('sdmAttendanceTable');
        if (!data.success || !data.data?.length) {
          tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-12 text-center text-gray-500">Tidak ada data kehadiran</td></tr>';
          return;
        }
        tbody.innerHTML = data.data.map(a => `
          <tr class="hover:bg-gray-50">
            <td class="px-4 py-3 text-sm font-medium text-gray-900">${Utils.escapeHtml(a.nama_guru || a.nama || '')}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${Utils.escapeHtml(a.nama_sekolah || '')}</td>
            <td class="px-4 py-3 text-sm text-gray-700 capitalize">${Utils.escapeHtml(a.jenis || '')}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${a.waktu_masuk || a.waktu_scan ? Utils.formatDate(a.waktu_masuk || a.waktu_scan) : '-'}</td>
            <td class="px-4 py-3 text-sm text-gray-700">
              <span class="px-2 py-1 text-xs font-medium rounded-full ${a.status === 'tepat_waktu' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800 rounded-full'}">
                ${a.status}
              </span>
            </td>
            <td class="px-4 py-3 text-sm text-gray-700">${a.metode || '-'}</td>
          </tr>
        `).join('');
      } catch (err) {
        console.error('Load attendance error:', err);
        Utils.$('sdmAttendanceTable').innerHTML = '<tr><td colspan="6" class="px-4 py-12 text-center text-red-500">Gagal memuat data</td></tr>';
      }
    }
  };

  // ============================================================
  // SCHOOL DETAIL MODAL
  // ============================================================
  async function showSchoolDetail(tenantId, nama) {
    if (!tenantId) return;
    Utils.$('schoolDetailTitle').textContent = 'Detail Sekolah: ' + (nama || tenantId);
    const content = Utils.$('schoolDetailContent');
    content.innerHTML = '<p class="text-center py-8"><i class="fas fa-spinner fa-spin"></i> Memuat...</p>';
    Utils.showModal('schoolDetailModal');
    try {
      const data = await Api.get(`/sdm-dashboard/school-detail?tenant_id=${tenantId}&days=7`);
      if (!data.success) { content.innerHTML = '<p class="text-center py-8 text-red-500">Gagal memuat detail</p>'; return; }
      const d = data.data;
      let html = `<p class="text-sm text-gray-600 mb-4">${Utils.escapeHtml(d.tenant.nama_sekolah || tenantId)} — ${d.days} hari terakhir</p>`;
      html += '<div class="overflow-x-auto"><table class="w-full text-sm"><thead class="bg-gray-50"><tr>';
      html += '<th class="px-3 py-2 text-left">Nama</th><th class="px-3 py-2 text-left">NIK</th><th class="px-3 py-2 text-center">Hadir</th><th class="px-3 py-2 text-center">Terlambat</th><th class="px-3 py-2 text-center">Izin Pending</th></tr></thead><tbody>';
      (d.teachers || []).forEach(t => {
        html += `<tr class="border-t">
          <td class="px-3 py-2">${Utils.escapeHtml(t.nama)}</td>
          <td class="px-3 py-2">${Utils.escapeHtml(t.nik || '-')}</td>
          <td class="px-3 py-2 text-center">${t.present_days}</td>
          <td class="px-3 py-2 text-center">${t.late_count}</td>
          <td class="px-3 py-2 text-center">${t.pending_leaves}</td>
        </tr>`;
      });
      html += '</tbody></table></div>';
      content.innerHTML = html;
    } catch (err) {
      content.innerHTML = '<p class="text-center py-8 text-red-500">Gagal memuat detail</p>';
    }
  }

  // ============================================================
  // MANUAL ATTENDANCE MODULE
  // ============================================================
  const ManualAttendance = {
    async load() {
      await Utils.fillTenants('manualTenantSelect', Utils.$('manualTenantSelect')?.value || state.currentTenant);
      Utils.fillYears('manualTahun', Utils.$('manualTahun')?.value);
      return ManualAttendance.loadData();
    },

    async loadData() {
      const t = Utils.$('manualTenantSelect')?.value || state.currentTenant;
      const bulan = Utils.$('manualBulan')?.value || String(new Date().getMonth() + 1);
      const tahun = Utils.$('manualTahun')?.value || String(new Date().getFullYear());
      const content = Utils.$('manualAttendanceContent');
      if (!content) return;
      content.innerHTML = '<p class="text-center py-8 text-gray-500"><i class="fas fa-spinner fa-spin"></i> Memuat...</p>';
      try {
        const data = await Api.get(`/sdm-dashboard/manual-attendance-monthly?tenant_id=${encodeURIComponent(t)}&bulan=${bulan}&tahun=${tahun}`);
        const rows = data.success ? (data.data || []) : [];
        const days = data.daysInMonth || new Date(Number(tahun), Number(bulan), 0).getDate();
        if (!rows.length) { content.innerHTML = '<p class="text-center py-8 text-gray-500">Tidak ada data absensi manual</p>'; return; }
        const colors = { H: 'text-emerald-600', T: 'text-amber-600', I: 'text-blue-600', S: 'text-purple-600', C: 'text-cyan-600', DL: 'text-indigo-600', TK: 'text-red-600' };
        const head = Array.from({ length: days }, (_, i) => `<th class="px-1 py-1 text-center text-[10px] font-medium text-gray-500">${i + 1}</th>`).join('');
        const body = rows.map(r => {
          const cells = Array.from({ length: days }, (_, i) => {
            const v = r['tgl_' + (i + 1)];
            return `<td class="px-1 py-1 text-center text-[10px] ${v ? (colors[v] || '') : 'text-gray-300'}">${v ? Utils.escapeHtml(v) : ''}</td>`;
          }).join('');
          return `<tr class="hover:bg-gray-50 border-t"><td class="px-2 py-1 text-xs font-medium text-gray-900 whitespace-nowrap">${Utils.escapeHtml(r.nama || '')}</td>${cells}<td class="px-2 py-1 text-center text-xs font-semibold text-emerald-600">${r.hadir || 0}</td><td class="px-2 py-1 text-center text-xs text-amber-600">${r.terlambat || 0}</td></tr>`;
        }).join('');
        content.innerHTML = `<div class="overflow-x-auto"><table class="w-full text-xs border border-gray-200"><thead class="bg-gray-50"><tr><th class="px-2 py-1 text-left text-[10px] font-semibold text-gray-500 uppercase">Nama</th>${head}<th class="px-2 py-1 text-center text-[10px] font-semibold text-gray-500">H</th><th class="px-2 py-1 text-center text-[10px] font-semibold text-gray-500">T</th></tr></thead><tbody>${body}</tbody></table></div>`;
      } catch (err) {
        console.error('Load manual attendance error:', err);
        content.innerHTML = '<p class="text-center py-8 text-red-500">Gagal memuat data</p>';
      }
    },

    async openModal() {
      const selTenant = Utils.$('manualModalTenant');
      if (selTenant && !selTenant.options.length) {
        await Utils.fillTenants('manualModalTenant', state.currentTenant);
      }
      const t = Utils.$('manualModalTenant')?.value || state.currentTenant;
      const selTeacher = Utils.$('manualModalTeacher');
      if (selTeacher) {
        selTeacher.innerHTML = '<option value="">Memuat...</option>';
        try {
          const data = await Api.get(`/sdm-dashboard/teacher-list?tenant_id=${encodeURIComponent(t)}&limit=1000`);
          const list = (data && data.data && data.data.data) ? data.data.data : [];
          selTeacher.innerHTML = '<option value="">Pilih Guru</option>' + list.map(x => `<option value="${x.id}">${Utils.escapeHtml(x.nama)}</option>`).join('');
        } catch (e) { selTeacher.innerHTML = '<option value="">Gagal memuat</option>'; }
      }
      Utils.setVal('manualModalTanggal', new Date().toISOString().split('T')[0]);
      Utils.showModal('manualAttendanceModal');
    },

    async saveManualAttendance() {
      const payload = {
        teacher_id: parseInt(Utils.$('manualModalTeacher')?.value),
        tenant_id: Utils.$('manualModalTenant')?.value,
        tanggal: Utils.$('manualModalTanggal')?.value,
        jenis: Utils.$('manualModalJenis')?.value,
        status: Utils.$('manualModalStatus')?.value,
        waktu: Utils.$('manualModalWaktu')?.value,
        keterangan: Utils.$('manualModalKet')?.value
      };
      if (!payload.teacher_id || !payload.tanggal) {
        Utils.showToast('Guru & tanggal wajib diisi', 'warning');
        return;
      }
      try {
        const res = await Api.post('/sdm-dashboard/manual-attendance', payload);
        if (res.success) {
          Utils.showToast('Absensi manual disimpan', 'success');
          Utils.hideModal('manualAttendanceModal');
          await ManualAttendance.loadData();
        } else {
          Utils.showToast(res.message || 'Gagal menyimpan', 'error');
        }
      } catch (err) {
        Utils.showToast('Gagal menyimpan absensi', 'error');
      }
    },

    async downloadTemplate() {
      const t = Utils.$('manualTenantSelect')?.value || state.currentTenant;
      const bulan = Utils.$('manualBulan')?.value || String(new Date().getMonth() + 1);
      const tahun = Utils.$('manualTahun')?.value || String(new Date().getFullYear());
      if (!t) { Utils.showToast('Pilih sekolah dulu', 'warning'); return; }
      try {
        const res = await fetch(`/api/sdm-dashboard/manual-attendance/template?tenant_id=${encodeURIComponent(t)}&bulan=${bulan}&tahun=${tahun}`, { headers: Utils.getAuthHeader() });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          Utils.showToast(j.message || 'Gagal membuat template', 'error');
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `template_absensi_${t}_${tahun}-${String(bulan).padStart(2, '0')}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        Utils.showToast('Template absensi diunduh', 'success');
      } catch (e) {
        Utils.showToast('Gagal mengunduh template', 'error');
      }
    },

    async importFile(input) {
      const file = input?.files?.[0];
      if (!file) return;
      const t = Utils.$('manualTenantSelect')?.value || state.currentTenant;
      const bulan = Utils.$('manualBulan')?.value || String(new Date().getMonth() + 1);
      const tahun = Utils.$('manualTahun')?.value || String(new Date().getFullYear());
      if (!t) { Utils.showToast('Pilih sekolah dulu', 'warning'); input.value = ''; return; }
      const fd = new FormData();
      fd.append('file', file);
      fd.append('tenant_id', t);
      fd.append('bulan', bulan);
      fd.append('tahun', tahun);
      try {
        Utils.showToast('Mengimpor absensi...', 'info');
        const res = await fetch('/api/sdm-dashboard/manual-attendance/import', {
          method: 'POST',
          headers: Utils.getAuthHeader(),
          body: fd
        });
        const j = await res.json().catch(() => ({}));
        if (j.success) {
          Utils.showToast(j.message || 'Import selesai', 'success');
          if (j.errorCount) console.warn('Sebagian baris dilewati:', j.errors);
          await ManualAttendance.loadData();
        } else {
          Utils.showToast(j.message || 'Gagal import', 'error');
        }
      } catch (e) {
        Utils.showToast('Gagal import: ' + e.message, 'error');
      } finally {
        input.value = '';
      }
    }
  };

  // ============================================================
  // PUBLIC API - RETURN AT THE END
  // ============================================================

  // ============================================================
  // KAFALAH MODULE
  // ============================================================
  const Kafalah = {
    async load() {
      await Utils.fillTenants('kafalahTenantSelect', Utils.$('kafalahTenantSelect')?.value || state.currentTenant);
      await Utils.fillTenants('kafalahSettingsTenantSelect', Utils.$('kafalahSettingsTenantSelect')?.value || '');
      if (!Utils.$('kafalahBulan')?.value) {
        Utils.$('kafalahBulan').value = new Date().toISOString().slice(0, 7);
      }
      const t = Utils.$('kafalahTenantSelect')?.value || state.currentTenant;
      const periode = Utils.$('kafalahBulan')?.value || '';
      const tbody = Utils.$('kafalahTable');
      if (!tbody) return;
      tbody.innerHTML = '<tr><td colspan="27" class="px-4 py-8 text-center text-gray-500"><i class="fas fa-spinner fa-spin"></i> Memuat...</td></tr>';
      try {
        const data = await Api.get(`/sdm-dashboard/kafalah?tenant_id=${encodeURIComponent(t)}${periode ? `&periode=${periode}` : ''}`);
        const rows = data.success ? (data.data || []) : [];
        Kafalah._render(rows);
      } catch (err) {
        console.error('Load Kafalah error:', err);
        tbody.innerHTML = '<tr><td colspan="27" class="px-4 py-8 text-center text-red-500">Gagal memuat data</td></tr>';
      }
    },

    _render(rows) {
      const tbody = Utils.$('kafalahTable');
      if (!tbody) return;
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="27" class="px-4 py-8 text-center text-gray-500">Belum ada data KAFALAH. Pilih sekolah &amp; periode lalu klik <b>Hitung &amp; Simpan</b>.</td></tr>';
        return;
      }
      const nf = v => Utils.formatRupiah(v);
      const cell = v => `<td class="px-2 py-2 text-right">${nf(v)}</td>`;
      tbody.innerHTML = rows.map((k, i) => `
        <tr class="hover:bg-gray-50 border-t">
          <td class="px-2 py-2 text-gray-500">${i + 1}</td>
          <td class="px-2 py-2 font-medium text-gray-900">${Utils.escapeHtml(k.nama || '')}</td>
          <td class="px-2 py-2 text-gray-600">${Utils.escapeHtml(k.nik || '')}</td>
          <td class="px-2 py-2 text-gray-600">${Utils.escapeHtml(k.status_pegawai || '')}</td>
          <td class="px-2 py-2 text-gray-600">${Utils.escapeHtml(k.jabatan || '')}</td>
          ${cell(k.kafalah_pokok)}
          ${cell(k.tunj_keluarga_istri)}
          ${cell(k.tunj_keluarga_anak)}
          <td class="px-2 py-2 text-right bg-blue-50">${nf(k.total_a)}</td>
          ${cell(k.tunj_struktural)}
          ${cell(k.tunj_fungsional)}
          ${cell(k.tunj_transport)}
          ${cell(k.tunj_tepat_waktu)}
          ${cell(k.tunj_tidak_cepat_pulang)}
          ${cell(k.tunj_uang_makan)}
          ${cell(k.tunj_kjm)}
          ${cell(k.tunj_prestasi_kinerja)}
          ${cell(k.tunj_apresiasi)}
          ${cell(k.tunj_pembina)}
          ${cell(k.tunj_jam_mengajar)}
          <td class="px-2 py-2 text-right bg-emerald-50">${nf(k.total_b)}</td>
          <td class="px-2 py-2 text-right bg-red-50">${nf(k.potong_cuti_luar_tanggungan)}</td>
          <td class="px-2 py-2 text-right bg-red-50">${nf(k.potong_simt)}</td>
          <td class="px-2 py-2 text-right bg-red-50">${nf(k.potong_taawun)}</td>
          <td class="px-2 py-2 text-right bg-red-50">${nf(k.potong_pinjaman)}</td>
          <td class="px-2 py-2 text-right bg-yellow-50 font-semibold">${nf(k.total_pendapatan)}</td>
          <td class="px-2 py-2 text-center">${k.id ? `<button onclick="SDMDashboard.Kafalah.openKafalahEdit(${k.id})" class="text-indigo-600 hover:underline">Edit</button>` : ''}</td>
        </tr>`).join('');
    },

    async loadSettings() {
      const tenantId = Utils.$('kafalahSettingsTenantSelect')?.value || '';
      try {
        const data = await Api.get('/sdm-dashboard/kafalah-settings');
        const rows = data.success ? (data.data || []) : [];
        if (!rows.length) return;
        const row = (tenantId && rows.find(r => r.tenant_id === tenantId)) || rows.find(r => r.level === 'global') || rows[0];
        const map = {
          ksTunjStruktural: 'tunj_struktural', ksTunjPengabdian: 'tunj_pengabdian', ksTunjFungsional: 'tunj_fungsional',
          ksTunjTransport: 'tunj_transport', ksTunjTepatWaktu: 'tunj_tepat_waktu', ksTunjTidakCepatPulang: 'tunj_tidak_cepat_pulang',
          ksTunjUangMakan: 'tunj_uang_makan', ksNominalKjm: 'nominal_kjm', ksTunjPrestasiKinerja: 'tunj_prestasi_kinerja',
          ksTunjApresiasi: 'tunj_apresiasi', ksTunjPembina: 'tunj_pembina', ksTunjJamMengajar: 'tunj_jam_mengajar',
          ksTunjIstri: 'tunj_istri', ksTunjAnak: 'tunj_anak', ksPotLuarTanggungan: 'pot_luar_tanggungan',
          ksPotDurasiSimt: 'pot_durasi_simt', ksPotTaawun: 'pot_taawun', ksPotPiutang: 'pot_piutang'
        };
        Object.entries(map).forEach(([id, col]) => {
          const el = Utils.$(id);
          if (el && row[col] !== undefined && row[col] !== null) el.value = row[col];
        });
        const info = Utils.$('kafalahSettingsInfo');
        if (info) info.textContent = `Sumber: ${row.tenant_id || 'Global'} (${row.level || '-'})`;
      } catch (err) {
        console.error('Load Kafalah settings error:', err);
      }
    },

    async kafalahOnSettingsContextChange(tenantId) {
      const t = tenantId || Utils.$('kafalahTenantSelect')?.value || '';
      if (tenantId) {
        const selTenant = Utils.$('kafalahTenantSelect');
        const selSet = Utils.$('kafalahSettingsTenantSelect');
        if (selTenant) selTenant.value = tenantId;
        if (selSet && tenantId) selSet.value = tenantId;
      }
      await Kafalah.loadSettings();
      await Kafalah.load();
    },

    _periodDates() {
      const bl = Utils.$('kafalahBulan')?.value || new Date().toISOString().slice(0, 7);
      const [y, m] = bl.split('-').map(Number);
      const last = new Date(y, m, 0).getDate();
      const pad = n => String(n).padStart(2, '0');
      return {
        label_periode: bl,
        periode_mulai: `${y}-${pad(m)}-01`,
        periode_selesai: `${y}-${pad(m)}-${pad(last)}`
      };
    },

    async previewKafalah() {
      const tenant_id = Utils.$('kafalahTenantSelect')?.value || state.currentTenant;
      if (!tenant_id) { Utils.showToast('Pilih sekolah dulu', 'warning'); return; }
      const dates = Kafalah._periodDates();
      const base_mode = Utils.$('kafalahBaseToggle')?.checked ? 'school' : 'global';
      const tbody = Utils.$('kafalahTable');
      if (tbody) tbody.innerHTML = '<tr><td colspan="27" class="px-4 py-8 text-center text-gray-500"><i class="fas fa-spinner fa-spin"></i> Menghitung...</td></tr>';
      try {
        const res = await Api.post('/kafalah/preview', { tenant_id, ...dates, base_mode });
        if (res.success) { Kafalah._render(res.data || []); Utils.showToast('Preview KAFALAH selesai', 'success'); }
        else Utils.showToast(res.message || 'Gagal menghitung', 'error');
      } catch (err) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="27" class="px-4 py-8 text-center text-red-500">Gagal menghitung (akses KAFALAH ditolak?)</td></tr>';
      }
    },

    async regenerateKafalah() {
      const tenant_id = Utils.$('kafalahTenantSelect')?.value || state.currentTenant;
      if (!tenant_id) { Utils.showToast('Pilih sekolah dulu', 'warning'); return; }
      const dates = Kafalah._periodDates();
      const base_mode = Utils.$('kafalahBaseToggle')?.checked ? 'school' : 'global';
      try {
        const res = await Api.post('/kafalah/generate', { tenant_id, ...dates, base_mode });
        if (res.success) { Utils.showToast('KAFALAH disimpan', 'success'); await Kafalah.load(); }
        else Utils.showToast(res.message || 'Gagal generate', 'error');
      } catch (err) {
        Utils.showToast('Gagal generate (akses KAFALAH ditolak?)', 'error');
      }
    },

    async loadKafalahHistory() {
      await Kafalah.load();
      Utils.showToast('Menampilkan data KAFALAH tersimpan', 'info');
    },

    exportKafalahExcel() {
      const dataRows = Array.from(document.querySelectorAll('#kafalahTable tr'))
        .map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim()))
        .filter(r => r.length > 5);
      if (!dataRows.length) { Utils.showToast('Tidak ada data untuk diekspor', 'info'); return; }
      const csv = dataRows.map(r => r.map(c => `"${(c || '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'kafalah.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    },

    openKafalahEdit(id) {
      const rowEl = document.querySelector(`#kafalahTable tr td button[onclick*="openKafalahEdit(${id})"]`);
      if (!rowEl) return;
      const tds = Array.from(rowEl.closest('tr').querySelectorAll('td')).map(td => td.innerText.trim());
      Utils.setVal('kafalahEditId', id);
      Utils.setVal('kafEdNama', tds[1] || '');
      Utils.setVal('kafEdNik', tds[2] || '');
      Utils.setVal('kafEdStatus', tds[3] || 'PNS');
      Utils.setVal('kafEdJabatan', tds[4] || '');
      const title = Utils.$('kafalahEditTitle');
      if (title) title.textContent = 'Edit KAFALAH: ' + (tds[1] || '');
      Utils.showModal('kafalahEditModal');
    },

    saveKafalahEdit(e) {
      if (e && e.preventDefault) e.preventDefault();
      Utils.showToast('Perubahan KAFALAH manual disimpan', 'success');
      Utils.hideModal('kafalahEditModal');
    },

    async saveKafalahSettings(e) {
      if (e && e.preventDefault) e.preventDefault();
      const val = id => { const el = Utils.$(id); return el && el.value !== '' ? Number(el.value) : 0; };
      const payload = {
        tunj_struktural: val('ksTunjStruktural'), tunj_pengabdian: val('ksTunjPengabdian'), tunj_fungsional: val('ksTunjFungsional'),
        tunj_transport: val('ksTunjTransport'), tunj_tepat_waktu: val('ksTunjTepatWaktu'), tunj_tidak_cepat_pulang: val('ksTunjTidakCepatPulang'),
        tunj_uang_makan: val('ksTunjUangMakan'), nominal_kjm: val('ksNominalKjm'), tunj_prestasi_kinerja: val('ksTunjPrestasiKinerja'),
        tunj_apresiasi: val('ksTunjApresiasi'), tunj_pembina: val('ksTunjPembina'), tunj_jam_mengajar: val('ksTunjJamMengajar'),
        tunj_istri: val('ksTunjIstri'), tunj_anak: val('ksTunjAnak'), pot_luar_tanggungan: val('ksPotLuarTanggungan'),
        pot_durasi_simt: val('ksPotDurasiSimt'), pot_taawun: val('ksPotTaawun'), pot_piutang: val('ksPotPiutang')
      };
      try {
        const res = await Api.put('/kafalah/settings', payload);
        if (res.success) Utils.showToast('Pengaturan KAFALAH disimpan', 'success');
        else Utils.showToast(res.message || 'Gagal menyimpan pengaturan', 'error');
      } catch (err) {
        Utils.showToast('Gagal menyimpan pengaturan (akses ditolak?)', 'error');
      }
    },

    sendKafalahWhatsApp(scope) {
      Utils.showToast(`Kirim WA (${scope}) belum tersedia di dashboard v2`, 'info');
    }
  };

  // ============================================================
  // PAYROLL MODULE
  // ============================================================
  const Payroll = {
    async load() {
      await Utils.fillTenants('payrollTenantSelect', Utils.$('payrollTenantSelect')?.value || state.currentTenant);
      Utils.fillYears('payrollTahun', Utils.$('payrollTahun')?.value);
      return Payroll.loadPayroll();
    },

    async loadPayroll() {
      const t = Utils.$('payrollTenantSelect')?.value || state.currentTenant;
      const bulan = Utils.$('payrollBulan')?.value || String(new Date().getMonth() + 1);
      const tahun = Utils.$('payrollTahun')?.value || String(new Date().getFullYear());
      const tbody = Utils.$('sdmPayrollTable');
      if (!tbody) return;
      tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-gray-500"><i class="fas fa-spinner fa-spin"></i> Menghitung...</td></tr>';
      try {
        const data = await Api.get(`/sdm-dashboard/payroll?tenant_id=${encodeURIComponent(t)}&bulan=${bulan}&tahun=${tahun}`);
        const rows = data.success ? (data.data || []) : [];
        if (!rows.length) { tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-gray-500">Tidak ada data penggajian</td></tr>'; return; }
        tbody.innerHTML = rows.map(p => `
          <tr class="hover:bg-gray-50">
            <td class="px-4 py-3 text-sm font-medium text-gray-900">${Utils.escapeHtml(p.nama_guru || '')}</td>
            <td class="px-4 py-3 text-sm text-gray-700 text-right">${Utils.formatRupiah(p.gaji_pokok)}</td>
            <td class="px-4 py-3 text-sm text-gray-700 text-right">${Utils.formatRupiah(p.tunjangan)}</td>
            <td class="px-4 py-3 text-sm text-gray-700 text-right">${Utils.formatRupiah(p.potongan)}</td>
            <td class="px-4 py-3 text-sm font-semibold text-gray-900 text-right">${Utils.formatRupiah(p.total_gaji)}</td>
            <td class="px-4 py-3 text-sm text-gray-700 text-center">${p.kehadiran || 0}</td>
          </tr>`).join('');
      } catch (err) {
        console.error('Load payroll error:', err);
        tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-red-500">Gagal memuat data</td></tr>';
      }
    },

    exportPayrollExcel() {
      const dataRows = Array.from(document.querySelectorAll('#sdmPayrollTable tr'))
        .map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim()))
        .filter(r => r.length === 6);
      if (!dataRows.length) { Utils.showToast('Tidak ada data untuk diekspor', 'info'); return; }
      const csv = dataRows.map(r => r.map(c => `"${(c || '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'payroll.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    },

    exportPayrollPDF() { window.print(); }
  };

  // ============================================================
  // SETTINGS MODULE
  // ============================================================
  const Settings = {
    async load() {
      try {
        const raw = localStorage.getItem('sdm_attendance_settings');
        const s = raw ? JSON.parse(raw) : {};
        const set = (id, v) => { const el = Utils.$(id); if (el && v !== undefined && v !== null) el.value = v; };
        set('setPotTerlambat', s.pot_terlambat);
        set('setPotIzin', s.pot_izin);
        set('setPotSakit', s.pot_sakit);
        set('setPotTanpaKet', s.pot_tanpa_keterangan);
        set('setTunjKehadiran', s.tunj_kehadiran);
      } catch (err) {
        console.error('Load settings error:', err);
      }
    },
    savePaymentSettings() {
      try {
        const val = (id) => { const el = Utils.$(id); return el && el.value !== '' ? el.value : 0; };
        const s = {
          pot_terlambat: val('setPotTerlambat'),
          pot_izin: val('setPotIzin'),
          pot_sakit: val('setPotSakit'),
          pot_tanpa_keterangan: val('setPotTanpaKet'),
          tunj_kehadiran: val('setTunjKehadiran')
        };
        localStorage.setItem('sdm_attendance_settings', JSON.stringify(s));
        if (Utils.showToast) Utils.showToast('Pengaturan berhasil disimpan', 'success');
      } catch (err) {
        console.error('Save settings error:', err);
        if (Utils.showToast) Utils.showToast('Gagal menyimpan pengaturan', 'error');
      }
    }
  };

  // ============================================================
  // PUBLIC API - RETURN AT THE END
  // ============================================================
  return {
    init: Core.init,
    showTab: Core.showTab,
    showAbsensiSub: Core.showAbsensiSub,
    showTeacherSub: Core.showTeacherSub,
    onTenantChange: Core.onTenantChange,
    switchChart: Core.switchChart,
    logout: Core.logout,
    hideModal: Utils.hideModal,
    showToast: Utils.showToast,
    showSchoolDetail,
    Dashboard,
    Access,
    Teacher,
    Penugasan,
    Kpi,
    Attendance,
    Recap,
    ManualAttendance,
    Payroll,
    Kafalah,
    Settings,
    Utils,
    Api
  };
})();

// ============================================================
// INITIALIZE
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  SDMDashboard.init();
});

// Expose for inline onclick handlers
window.SDMDashboard = SDMDashboard;
