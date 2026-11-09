// ============================================================
// SDM Dashboard - Main Script
// ============================================================

document.addEventListener('DOMContentLoaded', function() {
    initializeDashboard();
});

async function initializeDashboard() {
    console.log('Initializing SDM Dashboard');
    await setTeacherInfo();
    requestLocationPermission();
    loadTodaySummary();
    loadLeaveStatus();
    checkActiveLeave();
    updateConnectionStatus();
    checkAndShowAllUnitsSummary();
    if (canApproveIzin(window.userAssignments || [])) {
        openApprovalIzinModal();
    }
    initQuranWidget();
    checkSpmbPanitia();

    window.attendanceInterval = setInterval(function () {
        checkActiveLeave();
    }, 1000);

    window.addEventListener('online', syncOfflineAttendance);
    window.addEventListener('offline', showOfflineMessage);
}

function showTab(tabName) {
    console.log('Switching to tab:', tabName);
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.remove('nav-active');
        el.classList.add('text-gray-600', 'hover:bg-gray-100');
    });
    const tabEl = document.getElementById(tabName + 'Tab');
    const btnEl = document.querySelector('[data-tab="' + tabName + '"]');
    if (tabEl) tabEl.classList.remove('hidden');
    if (btnEl) {
        btnEl.classList.add('nav-active');
        btnEl.classList.remove('text-gray-600', 'hover:bg-gray-100');
    }
    window.currentTab = tabName;

    if (tabName === 'kafalah') {
        loadTenantFilters();
        const today = new Date();
        const defaultMonth = today.toISOString().slice(0, 7);
        const bulanEl = document.getElementById('kafalahBulan');
        if (bulanEl) bulanEl.value = defaultMonth;
        loadKafalahSettings(getKafalahTenantId());
        loadTeacherOverrides();
    }
    if (tabName === 'payroll') loadPayroll();
    if (tabName === 'sk-guru') loadSkGuruList();
    if (tabName === 'rules') loadRules();
    if (tabName === 'attendance') loadAttendanceLog();
    if (tabName === 'recapAbsensi') loadRecapAbsensi();
    if (tabName === 'manualAttendance') loadManualAttendanceUI();
    if (tabName === 'sk-guru') loadSkGuruList();
    if (tabName === 'qr-generator') loadQrGenerator();
    if (tabName === 'idcard') loadIdCardUI();
    if (tabName === 'settings') {
        loadPaymentSettings();
        loadKafalahSettings();
        loadKafalahKenaikan();
        loadJabatanTunjangan();
        loadPendidikanRef();
    }
    if (tabName === 'access') loadAccessSettings();
    if (tabName === 'kpi') loadKpiDashboard();
    if (tabName === 'teachers') loadTeachersList();
    if (tabName === 'qr-generator') loadQrGenerator();
    if (tabName === 'idcard') loadIdCardUI();
    if (tabName === 'settings') {
        loadPaymentSettings();
        loadKafalahSettings();
        loadKafalahKenaikan();
        loadJabatanTunjangan();
        loadPendidikanRef();
    }
}

// KAFALAH helper functions
function getKafalahTenantId(explicit) {
    if (explicit) return explicit;
    const el = document.getElementById('kafalahSettingsTenantSelect') ||
               document.getElementById('kafalahTenantSelect');
    return el ? el.value : '';
}

function kafalahOnSettingsContextChange(tenantId) {
    const toggleEl = document.getElementById('kafalahBaseToggle');
    const isSekolah = toggleEl ? toggleEl.checked : false;
    const selectedTenant = getKafalahTenantId();
    const isAdmin = ['admin', 'yayasan', 'direktur'].includes(window.userRole);
    const hasAdminAssignment = (window.userAssignments || []).some(a => 
        ['pimpinan', 'kepala', 'ketua', 'admin', 'bendahara', 'operator'].includes(a.jabatan_di_unit?.toLowerCase() || '')
    );
    const canEdit = isAdmin || hasAdminAssignment;

    const selectedTenantId = tenantId || (isSekolah ? getKafalahTenantId() : null);
    const infoEl = document.getElementById('kafalahSettingsInfo');
    if (infoEl) {
        if (isSekolah && !selectedTenantId) {
            infoEl.innerHTML = '<i class="fas fa-warning mr-1 text-amber-600"></i> Mode <b>Sekolah</b> dipilih, tetapi belum ada sekolah yang dipilih. Pilih sekolah terlebih dahulu — sementara ini menampilkan pengaturan <b>GLOBAL</b>.';
        } else if (isSekolah && selectedTenantId) {
            const sel = document.getElementById('kafalahSettingsTenantSelect') || document.getElementById('kafalahTenantSelect');
            infoEl.innerHTML = '<i class="fas fa-info-circle mr-1"></i> Pengaturan ini berlaku untuk <b>' + (sel?.selectedOptions[0]?.text || 'sekolah ini') + '</b>. Bisa diubah sewaktu-waktu.';
        } else {
            infoEl.innerHTML = '<i class="fas fa-info-circle mr-1"></i> Pengaturan komponen KAFALAH ini berlaku <b>GLOBAL</b> untuk semua unit. Bisa diubah sewaktu-waktu, namun tidak akan mengubah slip yang sudah tersimpan.';
        }
    }

    loadKafalahSettings();
    loadKafalahMatrix();
    loadJabatanTunjangan();
    loadPendidikanRef();
}

function getKafalahTenantId(explicit) {
    if (explicit) return explicit;
    const el = document.getElementById('kafalahSettingsTenantSelect') ||
               document.getElementById('kafalahTenantSelect');
    return el ? el.value : '';
}

// Export functions to window
window.loadKafalahSettings = async function(tenantId) {
    try {
        const toggleEl = document.getElementById('kafalahBaseToggle');
        const isSekolah = toggleEl ? toggleEl.checked : false;
        const selectedTenant = getKafalahTenantId();
        const effectiveTenantId = (tenantId || (document.getElementById('kafalahSettingsTenantSelect')?.value || document.getElementById('kafalahTenantSelect')?.value));
        const selectedTenant = getKafalahTenantId();
        const isSekolah = document.getElementById('kafalahBaseToggle')?.checked || false;
        const effectiveTenantId = (isSekolah && selectedTenant) ? selectedTenant : null;
        
        const url = effectiveTenantId 
          ? '/api/kafalah/settings/tenant?tenant_id=' + encodeURIComponent(effectiveTenantId)
          : '/api/kafalah/settings';
        const res = await fetch(url, { headers: getAuthHeader() });
        const json = await res.json();
        if (!json.success) return;
        const s = json.data || {};
        
        const infoEl = document.getElementById('kafalahSettingsInfo');
        if (infoEl) {
          if (document.getElementById('kafalahBaseToggle')?.checked && effectiveTenantId) {
            const sel = document.getElementById('kafalahSettingsTenantSelect') || document.getElementById('kafalahTenantSelect');
            infoEl.innerHTML = '<i class="fas fa-info-circle mr-1"></i> Pengaturan ini berlaku untuk <b>' + (sel?.selectedOptions[0]?.text || 'sekolah ini') + '</b>. Bisa diubah sewaktu-waktu.';
          } else if (document.getElementById('kafalahBaseToggle')?.checked && !effectiveTenantId) {
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
        
        loadTeacherOverrides();
    } catch (e) { console.error(e); }

function getAuthHeader() {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    return token ? { 'Authorization': 'Bearer ' + token } : {};
}

function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val ?? '';
}

function showToast(message, type = 'info') {
    const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
    });
    Toast.fire({ icon: type, title: message });
}

function apiUrl(path) {
    return '/api' + path;
}

function showToast(message, type = 'info') {
    const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
    });
    Toast.fire({ icon: type, title: message });
}

function showToast(message, type = 'info') {
    const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
    });
    Toast.fire({ icon: type, title: message });
}

// Make functions global
window.kafalahOnSettingsContextChange = kafalahOnSettingsContextChange;
window.getKafalahTenantId = getKafalahTenantId;
window.loadKafalahSettings = loadKafalahSettings;
window.getAuthHeader = getAuthHeader;
window.setVal = setVal;
window.showToast = showToast;
window.apiUrl = apiUrl;