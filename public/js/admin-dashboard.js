// Hidden filters for modal triggers - wait for DOM ready
document.addEventListener('DOMContentLoaded', function() {
  const hiddenFilters = document.createElement('div');
  hiddenFilters.style.display = 'none';
  hiddenFilters.innerHTML = '<select id="teacherTenantFilter"><option value="">Semua Sekolah</option></select>';
  document.body.appendChild(hiddenFilters);
});

const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = val;
        el.classList.remove('skeleton-loader', 'skeleton-text-lg');
    }
};

function checkAuth401403(response) {
    if (response.status === 401 || response.status === 403) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.replace('login.html');
        return true;
    }
    return false;
}

let currentTeacherId = null;
let currentRuleId = null;
let currentPage = 1;
let totalPages = 1;
let pageLimit = 10;
let currentMapContext = 'edit'; // 'edit' atau 'add' — menentukan field mana yang diupdate oleh map/deteksi
async function loadScannerDevices() {
    const container = document.getElementById('devices-list');
    if (!container) return;

    container.innerHTML = '<div class="text-center py-8 text-gray-500"><i class="fas fa-spinner fa-spin text-xl mb-2"></i><p>Memuat data device...</p></div>';

    try {
        const response = await fetch('/api/scanner/devices', {
            headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
        });

        if (response.status === 401 || response.status === 403) {
            container.innerHTML = '<div class="text-center py-8 text-gray-500">Akses ditolak</div>';
            return;
        }

        const data = await response.json();

        if (data.success && data.data && data.data.length > 0) {
            container.innerHTML = data.data.map(device => `
                <div class="bg-white border border-gray-200 rounded-lg p-4 flex justify-between items-center">
                    <div>
                        <h5 class="font-medium text-gray-900">${device.school_name || '-'} - ${device.device_name || device.device_id}</h5>
                        <p class="text-sm text-gray-600">Status: ${device.status || 'Aktif'} | Total Scan: ${device.total_scans_today || device.total_scans || 0}</p>
                        ${device.last_scan_time ? `<p class="text-xs text-gray-500 mt-1">Scan Terakhir: ${new Date(device.last_scan_time).toLocaleString('id-ID')}</p>` : ''}
                        ${device.last_scan && !device.last_scan_time ? `<p class="text-xs text-gray-500 mt-1">Scan Terakhir: ${new Date(device.last_scan).toLocaleString('id-ID')}</p>` : ''}
                    </div>
                    <div class="flex items-center space-x-2">
                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${device.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                            ${device.status === 'active' ? 'Aktif' : device.status || 'Aktif'}
                        </span>
                    </div>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<div class="text-center py-8 text-gray-500">Belum ada device terdaftar</div>';
        }
    } catch (error) {
        console.error('Error loading scanner devices:', error);
        container.innerHTML = '<div class="text-center py-8 text-red-500">Error memuat device</div>';
    }
}

async function loadQRLogs() {
    const tbody = document.getElementById('qr-logs-table');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-500"><i class="fas fa-spinner fa-spin mr-2"></i>Memuat logs...</td></tr>';

    try {
        const response = await fetch('/api/scanner/attendance/logs?limit=50', {
            headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
        });

        if (response.status === 401 || response.status === 403) {
            tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-500">Akses ditolak</td></tr>';
            return;
        }

        const data = await response.json();

        if (data.success && data.data && data.data.length > 0) {
            tbody.innerHTML = data.data.map(log => `
                <tr class="hover:bg-gray-50">
                    <td class="px-4 py-3 text-sm text-gray-900">${log.teacher_name || '-'}</td>
                    <td class="px-4 py-3 text-sm text-gray-500">${log.school_name || '-'}</td>
                    <td class="px-4 py-3 text-sm text-gray-500">${log.device_name || log.device_id || '-'}</td>
                    <td class="px-4 py-3 text-sm text-gray-500">${log.waktu_scan ? new Date(log.waktu_scan).toLocaleString('id-ID') : '-'}</td>
                    <td class="px-4 py-3 text-sm">
                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${log.sync_status === 'synced' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}">
                            ${log.sync_status === 'synced' ? 'Tersinkron' : log.sync_status || '-'}
                        </span>
                    </td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-500">Belum ada log scanner</td></tr>';
        }
    } catch (error) {
        console.error('Error loading QR logs:', error);
        tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-red-500">Error memuat logs</td></tr>';
    }
}

let currentEmailFolder = 'sent';
let currentEmailPage = 1;
const EMAIL_PAGE_LIMIT = 20;

async function loadEmailList(folder = 'sent', page = 1) {
    currentEmailFolder = folder;
    currentEmailPage = page;
    const list = document.getElementById('emailList');
    if (!list) return;

    list.innerHTML = '<div class="px-3 py-6 text-center text-gray-500 text-sm"><i class="fas fa-spinner fa-spin mr-2"></i>Memuat email...</div>';

    const search = document.getElementById('emailSearch')?.value || '';

    const params = new URLSearchParams({
        folder,
        page: page.toString(),
        limit: EMAIL_PAGE_LIMIT.toString(),
        search
    });

    try {
        const response = await fetch(`/api/admin/emails?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
        });

        if (response.status === 401 || response.status === 403) {
            list.innerHTML = '<div class="px-3 py-6 text-center text-gray-500 text-sm">Akses ditolak</div>';
            return;
        }

        const json = await response.json();

        if (json.success && json.data && json.data.length > 0) {
            list.innerHTML = json.data.map(email => `
                <div onclick="viewEmailDetail(${email.id})" class="px-3 py-3 cursor-pointer hover:bg-gray-50 border-b border-gray-100 last:border-b-0 ${email.is_read ? '' : 'bg-blue-50'}">
                    <div class="flex items-center justify-between mb-1">
                        <span class="text-sm font-medium text-gray-900 truncate mr-2">${escapeHtml(email.to_email)}</span>
                        <span class="text-xs text-gray-500 whitespace-nowrap">${formatEmailDate(email.created_at)}</span>
                    </div>
                    <div class="text-sm text-gray-700 font-medium truncate mb-1">${escapeHtml(email.subject || '(Tanpa Subjek)')}</div>
                    <div class="text-xs text-gray-500 truncate">${escapeHtml(email.body_text || '')}</div>
                    <div class="flex items-center gap-2 mt-1">
                        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${email.status === 'sent' ? 'bg-green-100 text-green-800' : email.status === 'failed' ? 'bg-red-100 text-red-800' : email.status === 'draft' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'}">
                            ${email.status === 'sent' ? 'Terkirim' : email.status === 'failed' ? 'Gagal' : email.status === 'draft' ? 'Draft' : email.status}
                        </span>
                        ${email.has_attachments ? '<span class="text-xs text-gray-500"><i class="fas fa-paperclip mr-1"></i>Lampiran</span>' : ''}
                    </div>
                </div>
            `).join('');
        } else {
            list.innerHTML = '<div class="px-3 py-6 text-center text-gray-500 text-sm">Tidak ada email di folder ini</div>';
        }
    } catch (error) {
        console.error('Error loading email list:', error);
        list.innerHTML = '<div class="px-3 py-6 text-center text-red-500 text-sm">Error memuat email</div>';
    }
}

async function viewEmailDetail(emailId) {
    const detail = document.getElementById('emailDetail');
    if (!detail) return;

    detail.innerHTML = '<div class="text-center text-gray-500 py-12"><i class="fas fa-spinner fa-spin mr-2"></i>Memuat detail email...</div>';

    try {
        const response = await fetch(`/api/admin/emails/${emailId}`, {
            headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
        });

        if (response.status === 401 || response.status === 403) {
            detail.innerHTML = '<div class="text-center text-gray-500 py-12">Akses ditolak</div>';
            return;
        }

        const json = await response.json();

        if (json.success && json.data) {
            const email = json.data;
            detail.innerHTML = `
                <div class="border-b border-gray-100 pb-4 mb-4">
                    <div class="flex items-start justify-between mb-3">
                        <h4 class="text-lg font-semibold text-gray-900">${escapeHtml(email.subject || '(Tanpa Subjek)')}</h4>
                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${email.status === 'sent' ? 'bg-green-100 text-green-800' : email.status === 'failed' ? 'bg-red-100 text-red-800' : email.status === 'draft' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'}">
                            ${email.status === 'sent' ? 'Terkirim' : email.status === 'failed' ? 'Gagal' : email.status === 'draft' ? 'Draft' : email.status}
                        </span>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-gray-600">
                        <div><span class="font-medium">Dari:</span> ${escapeHtml(email.from_email)}</div>
                        <div><span class="font-medium">Kepada:</span> ${escapeHtml(email.to_email)}</div>
                        ${email.cc ? `<div><span class="font-medium">CC:</span> ${escapeHtml(email.cc)}</div>` : ''}
                        ${email.bcc ? `<div><span class="font-medium">BCC:</span> ${escapeHtml(email.bcc)}</div>` : ''}
                        <div><span class="font-medium">Kategori:</span> ${email.category || '-'}</div>
                        <div><span class="font-medium">Dibuat:</span> ${new Date(email.created_at).toLocaleString('id-ID')}</div>
                        ${email.sent_at ? `<div><span class="font-medium">Dikirim:</span> ${new Date(email.sent_at).toLocaleString('id-ID')}</div>` : ''}
                    </div>
                    ${email.error_message ? `<div class="mt-3 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700"><strong>Error:</strong> ${escapeHtml(email.error_message)}</div>` : ''}
                </div>
                <div class="prose max-w-none">
                    <div class="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">${email.body_html || escapeHtml(email.body_text || 'Tidak ada isi')}</div>
                </div>
            `;
        } else {
            detail.innerHTML = '<div class="text-center text-gray-500 py-12">Email tidak ditemukan</div>';
        }
    } catch (error) {
        console.error('Error loading email detail:', error);
        detail.innerHTML = '<div class="text-center text-red-500 py-12">Error memuat detail email</div>';
    }
}

function switchEmailFolder(folder) {
    document.querySelectorAll('[id^="folder-"]').forEach(btn => {
        btn.classList.remove('bg-blue-50', 'text-blue-700');
        btn.classList.add('text-gray-700', 'hover:bg-gray-100');
    });
    const activeBtn = document.getElementById('folder-' + folder);
    if (activeBtn) {
        activeBtn.classList.remove('text-gray-700', 'hover:bg-gray-100');
        activeBtn.classList.add('bg-blue-50', 'text-blue-700');
    }
    loadEmailList(folder, 1);
}

function refreshEmailList() {
    loadEmailList(currentEmailFolder, currentEmailPage);
}

function openComposeModal() {
    const modal = document.getElementById('composeEmailModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('show');
    }
}

function closeComposeModal() {
    const modal = document.getElementById('composeEmailModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('show');
    }
}

async function sendComposedEmail() {
    const to = document.getElementById('composeTo')?.value?.trim();
    const cc = document.getElementById('composeCc')?.value?.trim();
    const bcc = document.getElementById('composeBcc')?.value?.trim();
    const subject = document.getElementById('composeSubject')?.value?.trim();
    const body = document.getElementById('composeBody')?.value?.trim();

    if (!to || !subject || !body) {
        alert('Penerima, subjek, dan isi email diperlukan');
        return;
    }

    try {
        const response = await fetch('/api/admin/emails/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}`
            },
            body: JSON.stringify({ to, cc, bcc, subject, body })
        });

        const json = await response.json();

        if (json.success) {
            alert('Email berhasil dikirim');
            closeComposeModal();
            document.getElementById('composeTo').value = '';
            document.getElementById('composeCc').value = '';
            document.getElementById('composeBcc').value = '';
            document.getElementById('composeSubject').value = '';
            document.getElementById('composeBody').value = '';
            refreshEmailList();
        } else {
            alert('Gagal mengirim email: ' + json.message);
        }
    } catch (error) {
        console.error('Send email error:', error);
        alert('Error mengirim email');
    }
}

async function saveDraft() {
    const to = document.getElementById('composeTo')?.value?.trim();
    const cc = document.getElementById('composeCc')?.value?.trim();
    const bcc = document.getElementById('composeBcc')?.value?.trim();
    const subject = document.getElementById('composeSubject')?.value?.trim();
    const body = document.getElementById('composeBody')?.value?.trim();

    if (!to && !subject && !body) {
        alert('Draft kosong');
        return;
    }

    try {
        const response = await fetch('/api/admin/emails/draft', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}`
            },
            body: JSON.stringify({ to, cc, bcc, subject, body })
        });

        const json = await response.json();

        if (json.success) {
            alert('Draft tersimpan');
            closeComposeModal();
            document.getElementById('composeTo').value = '';
            document.getElementById('composeCc').value = '';
            document.getElementById('composeBcc').value = '';
            document.getElementById('composeSubject').value = '';
            document.getElementById('composeBody').value = '';
            refreshEmailList();
        } else {
            alert('Gagal menyimpan draft: ' + json.message);
        }
    } catch (error) {
        console.error('Save draft error:', error);
        alert('Error menyimpan draft');
    }
}

function formatEmailDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
        return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
        return 'Kemarin';
    } else if (days < 7) {
        return days + ' hari lalu';
    } else {
        return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

window.loadEmailList = loadEmailList;
window.viewEmailDetail = viewEmailDetail;
window.switchEmailFolder = switchEmailFolder;
window.refreshEmailList = refreshEmailList;
window.openComposeModal = openComposeModal;
window.closeComposeModal = closeComposeModal;
window.sendComposedEmail = sendComposedEmail;
window.saveDraft = saveDraft;
window.loadTenantLocations = fetchTenantLocations;
window.updateToggleVisual = updateToggleVisual;
window.showAddTenantModal = function () {
    const modal = document.getElementById('addTenantModal');
    if (modal) modal.classList.remove('hidden');
};

document.addEventListener('DOMContentLoaded', () => {
    // ==========================================
    // 1. LOGIKA TOMBOL OTOMATIS (AUTO DETECT)
    // ==========================================
    const modalDetectBtn = document.getElementById('autoDetectModalBtn');

    if (modalDetectBtn) {
        modalDetectBtn.addEventListener('click', function () {
            if (!navigator.geolocation) {
                alert('Browser Anda tidak mendukung fitur Geolocation.');
                return;
            }

            // Ubah status tombol menjadi loading
            const originalHTML = this.innerHTML;
            this.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Mendeteksi...';
            this.disabled = true;

            // Ubah status teks petunjuk di bawah tombol
            const statusContainer = document.getElementById('locationStatus');
            if (statusContainer) {
                statusContainer.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Menghubungi satelit GPS perangkat Anda...';
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const lat = position.coords.latitude.toFixed(6);
                    const lng = position.coords.longitude.toFixed(6);

                    const latInput = document.getElementById('latitudeInput');
                    const lngInput = document.getElementById('longitudeInput');
                    const previewContainer = document.getElementById('coordinatePreview');
                    const accuracyCheck = document.getElementById('coordinateAccuracy');

                    // Masukkan data koordinat langsung ke dalam input form modal
                    if (latInput && lngInput) {
                        latInput.value = lat;
                        lngInput.value = lng;

                        // Trigger event 'input' agar fungsi peta di bawah langsung membaca perubahannya
                        latInput.dispatchEvent(new Event('input', { bubbles: true }));
                        lngInput.dispatchEvent(new Event('input', { bubbles: true }));
                    }

                    if (previewContainer) {
                        previewContainer.innerHTML = `<span class="text-blue-600 font-bold">${lat}, ${lng}</span>`;
                    }

                    if (accuracyCheck) {
                        accuracyCheck.classList.remove('hidden');
                    }

                    if (statusContainer) {
                        statusContainer.innerHTML = `<i class="fas fa-check-circle text-green-600 mr-1"></i> Lokasi berhasil disalin ke form modal!`;
                    }

                    this.innerHTML = originalHTML;
                    this.disabled = false;
                },
                (error) => {
                    this.innerHTML = originalHTML;
                    this.disabled = false;

                    if (statusContainer) {
                        statusContainer.innerHTML = `<i class="fas fa-exclamation-triangle text-red-500 mr-1"></i> Gagal: ${error.message}`;
                    }

                    if (error.code === 1) {
                        alert('Akses GPS ditolak. Tolong izinkan hak akses lokasi pada pengaturan browser Anda.');
                    } else {
                        alert(`Gagal mendeteksi koordinat perangkat: ${error.message}`);
                    }
                },
                { enableHighAccuracy: true, timeout: 10000 }
            );
        });
    }

    // ==========================================
    // 2. LOGIKA SINKRONISASI REAL-TIME INPUT -> PETA
    // ==========================================
    const latInput = document.getElementById('latitudeInput');
    const lngInput = document.getElementById('longitudeInput');

    if (latInput && lngInput) {
        function liveSyncFormToMap() {
            const lat = parseFloat(latInput.value);
            const lng = parseFloat(lngInput.value);

            // Validasi standar koordinat bumi
            if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {

                // A. JIKA MENGGUNAKAN LEAFLET.JS
                if (typeof map !== 'undefined' && map !== null) {
                    if (typeof marker !== 'undefined' && marker !== null) {
                        marker.setLatLng([lat, lng]);
                    } else if (typeof mapMarker !== 'undefined' && mapMarker !== null) {
                        mapMarker.setLatLng([lat, lng]);
                    }

                    // Bergerak dinamis mengikuti rute koordinat baru
                    map.panTo([lat, lng]);

                    // Memaksa rendering ulang map agar tidak patah/blank saat modal dibuka-tutup
                    setTimeout(() => map.invalidateSize(), 50);
                }

                // B. JIKA MENGGUNAKAN GOOGLE MAPS
                else if (typeof google !== 'undefined' && typeof google.maps !== 'undefined') {
                    const newLatLng = new google.maps.LatLng(lat, lng);

                    if (typeof marker !== 'undefined' && typeof marker.setPosition === 'function') {
                        marker.setPosition(newLatLng);
                    }

                    if (typeof map !== 'undefined' && typeof map.panTo === 'function') {
                        map.panTo(newLatLng);
                    }
                }
            }
        }

        // Dengarkan ketikan manual pengguna (Karakter demi karakter)
        latInput.addEventListener('input', liveSyncFormToMap);
        lngInput.addEventListener('input', liveSyncFormToMap);

        // Dengarkan pengisian otomatis dari sistem (Termasuk fungsi dispatchEvent di atas)
        latInput.addEventListener('change', liveSyncFormToMap);
        lngInput.addEventListener('change', liveSyncFormToMap);
    }
});

// Load attendance logs when switching to attendance tab (handled in showTab)
// Removed auto-call on DOMContentLoaded to prevent premature API calls before auth is ready

async function fetchDashboardData() {
    try {
        const response = await fetch('/api/admin/summary', {
            headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            // window.location.replace("login.html");
            return;
        }

        const res = await response.json();

        if (res.success) {
            const d = res.data;
            setEl('totalTeachers', d.totalTeachers ?? 0);
            setEl('todayAttendance', d.activeToday ?? 0);
            setEl('lateCount', d.lateToday ?? 0);
            setEl('scannerStatus', 'Online');
            setEl('accountWithCount', d.teachersWithAccount ?? 0);
            setEl('accountWithoutCount', d.teachersWithoutAccount ?? 0);
        } else {
            // Clear loading animation even on error
            setEl('totalTeachers', 0);
            setEl('todayAttendance', 0);
            setEl('lateCount', 0);
            setEl('scannerStatus', 'Error');
            setEl('accountWithCount', 0);
            setEl('accountWithoutCount', 0);
        }
    } catch (error) {
        console.error('Dashboard fetch error:', error);
        setEl('totalTeachers', 0);
        setEl('todayAttendance', 0);
        setEl('lateCount', 0);
        setEl('scannerStatus', 'OFF');
    }
}

async function fetchTeachers(page = 1) {
    try {
        const tenantId = window.teacherTenantFilterValue || window.tenantId || (JSON.parse(localStorage.getItem('user') || '{}'))?.tenant_id || (JSON.parse(localStorage.getItem('user') || '{}'))?.assignments?.[0]?.tenant_id || '';
        const statusKepegawaian = window.teacherStatusFilterValue || '';
        const search = window.teacherSearchValue || '';

        let url = '/api/admin/teachers?page=' + page + '&limit=' + pageLimit;
        if (tenantId) url += '&tenant_id=' + tenantId;
        if (statusKepegawaian) url += '&status_kepegawaian=' + encodeURIComponent(statusKepegawaian);
        if (search) url += '&search=' + encodeURIComponent(search);

        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            // window.location.replace("login.html");
            return;
        }

        const res = await response.json();

        if (res.success) {
            console.log('Teachers data received:', res.data);
            const items = Array.isArray(res.data) ? res.data : (res.data ? [res.data] : []);
            console.log('Teachers items count:', items.length);

            // AMAN: Menggunakan Optional Chaining (?.) dan nilai cadangan jika pagination undefined
            currentPage = res.pagination?.page || page;
            totalPages = res.pagination?.totalPages || 1;

            const tbody = document.getElementById('teachersTable');
            console.log('Teachers tbody found:', !!tbody);

            if (tbody) {
                tbody.innerHTML = items.map(t => `
          <tr class="hover:bg-gray-50">
            <td class="px-6 py-4">
              <input type="checkbox" class="teacher-checkbox" value="${t.id}" onchange="updateSelectAll()">
            </td>
            <td class="px-6 py-4 text-sm text-gray-900">${t.nama || '-'}</td>
            <td class="px-6 py-4 text-sm text-gray-500">${t.nik || '-'}</td>
            <td class="px-6 py-4 text-sm text-gray-500">${t.nip || '-'}</td>
            <td class="px-6 py-4 text-sm text-gray-500">${t.status_kepegawaian || '-'}</td>
            <td class="px-6 py-4 text-sm text-gray-500">
              <div class="max-w-xs truncate" title="${Array.isArray(t.assignments)
                        ? t.assignments.map(a => a.nama_sekolah || a.tenant_id).join(', ')
                        : (typeof t.assignments === 'string' ? t.assignments : 'Belum ditugaskan')
                    }">
                ${Array.isArray(t.assignments)
                        ? t.assignments.map(a => a.nama_sekolah || a.tenant_id).join(', ')
                        : (typeof t.assignments === 'string' ? t.assignments : 'Belum ditugaskan')
                    }
              </div>
            </td>
            <td class="px-6 py-4 text-sm">
              <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${t.status_aktif ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                ${t.status_aktif ? 'Aktif' : 'Nonaktif'}
              </span>
            </td>
            <td class="px-6 py-4 text-sm space-x-2">
              <button onclick="createUser(${t.id})" class="inline-flex items-center p-1.5 text-green-600 hover:text-green-800 hover:bg-green-50 rounded-md transition-colors duration-150" title="Buat User">
                <i class="fas fa-user-plus text-sm"></i>
              </button>
              <button onclick="editTeacher(${t.id})" class="inline-flex items-center p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-md transition-colors duration-150" title="Edit">
                <i class="fas fa-edit text-sm"></i>
              </button>
              <button onclick="deleteTeacher(${t.id})" class="inline-flex items-center p-1.5 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-md transition-colors duration-150" title="Hapus">
                <i class="fas fa-trash text-sm"></i>
              </button>
            </td>
          </tr>
        `).join('');
            }

            // AMAN: Mengirimkan objek cadangan kosong {} jika res.pagination tidak ada
            updatePaginationControls(res.pagination || { page: currentPage, totalPages: totalPages });

            console.log('Teachers table updated with', items.length, 'rows for page', currentPage);
        }
    } catch (error) {
        console.error('Teachers fetch error:', error);
    }
}

function handleTeacherSearch(event) {
    const searchValue = event.target.value.trim();
    window.teacherSearchValue = searchValue;
    fetchTeachers(1);
}

function handleStudentSearch(event) {
    const searchValue = event.target.value.trim();
    window.studentSearchValue = searchValue;
    loadStudents(1);
}

async function fetchRules() {
    try {
        const response = await fetch('/api/admin/rules', {
            headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            // window.location.replace("login.html");
            return;
        }

        const res = await response.json();

        if (res.success) {
            console.log('Rules data received:', res.data);
            const items = Array.isArray(res.data) ? res.data : (res.data ? [res.data] : []);
            console.log('Rules items count:', items.length);
            const container = document.getElementById('attendanceRules');
            console.log('Rules container found:', !!container);

            if (items.length === 0) {
                container.innerHTML = `
              <div class="text-center py-12">
                <i class="fas fa-clock text-4xl text-gray-400 mb-4"></i>
                <p class="text-gray-600">Belum ada aturan absensi</p>
                <button onclick="showAddRuleModal()" class="mt-4 inline-flex items-center px-4 py-2 bg-blue-600 border border-transparent rounded-md text-sm font-medium text-white hover:bg-blue-700">
                  <i class="fas fa-plus mr-2"></i>
                  Tambah Aturan Pertama
                </button>
              </div>
            `;
            } else {
                container.innerHTML = items.map(rule => `
              <div class="bg-white border border-gray-200 rounded-lg p-4">
                <div class="flex items-center justify-between">
                  <div>
                    <h5 class="font-medium text-gray-900">${rule.tenant_id === 'DEFAULT' ? 'Default' : rule.tenant_id} - ${rule.tipe}</h5>
                    <p class="text-sm text-gray-600">Jam: ${rule.jam_mulai} - ${rule.jam_selesai}</p>
                    <p class="text-sm text-gray-600">Status: ${rule.status_log === 'tepat_waktu' ? 'Tepat Waktu' : 'Terlambat'}</p>
                    ${rule.keterangan ? `<p class="text-sm text-gray-500">${rule.keterangan}</p>` : ''}
                  </div>
                  <div class="flex space-x-2">
                    <button onclick="editRule(${rule.id})" class="text-blue-600 hover:text-blue-800">
                      <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="deleteRule(${rule.id})" class="text-red-600 hover:text-red-800">
                      <i class="fas fa-trash"></i>
                    </button>
                  </div>
                </div>
              </div>
            `).join('');
            }
            console.log('Rules container updated with', items.length, 'rules');
        }
    } catch (error) {
        console.error('Rules fetch error:', error);
    }
}

async function fetchAttendanceLogs() {
    try {
        const response = await fetch('/api/admin/attendance-logs', {
            headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            // window.location.replace("login.html");
            return;
        }

        const res = await response.json();

        if (res.success) {
            const items = Array.isArray(res.data) ? res.data : (res.data ? [res.data] : []);
            const tbody = document.getElementById('attendanceTable');
            tbody.innerHTML = items.map(a => `
            <tr class="hover:bg-gray-50">
              <td class="px-6 py-4 text-sm text-gray-900">${a.nama || '-'}</td>
              <td class="px-6 py-4 text-sm text-gray-500">${a.nip || '-'}</td>
              <td class="px-6 py-4 text-sm text-gray-500">${a.jenis}</td>
              <td class="px-6 py-4 text-sm text-gray-500">${new Date(a.waktu_scan).toLocaleString('id-ID')}</td>
              <td class="px-6 py-4 text-sm">
                <span class="px-2 py-1 rounded-full text-xs ${a.status === 'tepat_waktu' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                  ${a.status === 'tepat_waktu' ? 'Tepat Waktu' : 'Terlambat'}
                </span>
              </td>
              <td class="px-6 py-4 text-sm text-gray-500">${a.metode}</td>
            </tr>
          `).join('');
        }
    } catch (error) {
        console.error('Attendance logs fetch error:', error);
    }
}

async function fetchTenantLocations() {
    try {
        const response = await fetch('/api/admin/tenants', {
            headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            // window.location.replace("login.html");
            return;
        }

        const res = await response.json();

        if (res.success) {
            const items = Array.isArray(res.data) ? res.data : (res.data ? [res.data] : []);
            const container = document.getElementById('tenantLocations');

            if (items.length === 0) {
                container.innerHTML = '<p class="text-gray-500">Tidak ada data tenant</p>';
                return;
            }

            // Update stats
            document.getElementById('totalSchools').textContent = items.length;
            document.getElementById('configuredLocations').textContent = items.filter(t => t.latitude && t.longitude).length;
            // Gunakan truthy check karena nilai bisa true/false/1/0
            const centralCount = items.filter(t => t.use_central_rules).length;
            document.getElementById('usingCentralRules').textContent = centralCount;
            console.log('[TENANT LIST] Total sekolah:', items.length, 'Lokasi terkonfigurasi:', items.filter(t => t.latitude && t.longitude).length, 'Gunakan aturan pusat:', centralCount);

            container.innerHTML = items.map(tenant => `
            <div class="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow duration-200">
              <div class="flex items-start justify-between mb-4">
                <div class="flex-1">
                  <h5 class="text-lg font-semibold text-gray-900 mb-1">${tenant.nama_sekolah}</h5>
                  <p class="text-sm text-gray-600">ID: ${tenant.tenant_id}</p>
                </div>
                <div class="flex items-center space-x-3">
                  <label class="flex items-center cursor-pointer">
                    <span class="mr-2 text-sm text-gray-600">Aturan Pusat</span>
                    <div class="relative">
                      <input type="checkbox" class="sr-only toggle-checkbox" data-action="toggle-central" data-tenant-id="${tenant.tenant_id}" ${tenant.use_central_rules ? 'checked' : ''}>
                        <div class="w-11 h-6 bg-gray-200 rounded-full toggle-track transition-colors duration-200 pointer-events-none ${tenant.use_central_rules ? 'bg-blue-600' : 'bg-gray-200'}"></div>
                       <div class="absolute left-0.5 top-0.5 w-5 h-5 bg-white border border-gray-300 rounded-full toggle-thumb transition-transform duration-200 pointer-events-none ${tenant.use_central_rules ? 'translate-x-5' : 'translate-x-0'}"></div>
                    </div>
                  </label>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <label class="block text-xs font-medium text-gray-500 mb-1">Latitude</label>
                  <div class="text-sm font-mono text-gray-900 bg-gray-50 px-3 py-2 rounded border">
                    ${tenant.latitude ? parseFloat(tenant.latitude).toFixed(6) : 'Belum diatur'}
                  </div>
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 mb-1">Longitude</label>
                  <div class="text-sm font-mono text-gray-900 bg-gray-50 px-3 py-2 rounded border">
                    ${tenant.longitude ? parseFloat(tenant.longitude).toFixed(6) : 'Belum diatur'}
                  </div>
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 mb-1">Radius</label>
                  <div class="text-sm font-mono text-gray-900 bg-gray-50 px-3 py-2 rounded border">
                    ${tenant.location_radius || 100}m
                  </div>
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 mb-1">Status</label>
                  <div class="text-sm text-gray-900">
                    ${tenant.latitude && tenant.longitude ? 'Aktif' : 'Tidak Aktif'}
                  </div>
                </div>
              </div>

              <div class="flex items-center justify-between pt-4 border-t border-gray-200">
                <div class="text-sm text-gray-600">
                  ${tenant.location_name ? `📍 ${tenant.location_name}` : 'Nama lokasi belum diatur'}
                </div>
                <div class="flex space-x-2">
                  <button data-action="auto-detect" data-tenant-id="${tenant.tenant_id}" class="inline-flex items-center px-3 py-2 border border-blue-300 rounded-md text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors duration-200">
                    <i class="fas fa-crosshairs mr-2"></i>
                    Auto Detect
                  </button>
                  <button data-action="edit-location" data-tenant-id="${tenant.tenant_id}" class="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors duration-200">
                    <i class="fas fa-edit mr-2"></i>
                    Edit
                  </button>
                </div>
              </div>
            </div>
          `).join('');

            // Attach event listeners to the newly created buttons
            attachLocationButtonListeners();
        }
    } catch (error) {
        console.error('Tenant locations fetch error:', error);
        document.getElementById('tenantLocations').innerHTML = '<p style="color: var(--error-color);">Error memuat data lokasi</p>';
    }
}

// Function to update toggle visual appearance
function updateToggleVisual(checkbox) {
    if (!checkbox) return;
    const track = checkbox.closest('.relative')?.querySelector('.toggle-track');
    const thumb = checkbox.closest('.relative')?.querySelector('.toggle-thumb');

    console.log('[TOGGLE] updateToggleVisual - checked:', checkbox.checked, {
        track: !!track,
        thumb: !!thumb
    });

    if (!track || !thumb) {
        console.warn('[TOGGLE] toggle-track or toggle-thumb not found');
        return;
    }

    if (checkbox.checked) {
        track.classList.remove('bg-gray-200');
        track.classList.add('bg-blue-600');
        thumb.classList.add('translate-x-5');
        thumb.classList.remove('translate-x-0');
    } else {
        track.classList.remove('bg-blue-600');
        track.classList.add('bg-gray-200');
        thumb.classList.remove('translate-x-5');
        thumb.classList.add('translate-x-0');
    }
}

// Function to update toggle visual appearance
function updateAllToggleVisuals() {
    document.querySelectorAll('[data-action="toggle-central"]').forEach(checkbox => {
        updateToggleVisual(checkbox);
    });
}

// Function to attach event listeners to location buttons
function attachLocationButtonListeners() {
    // Auto-detect buttons
    document.querySelectorAll('[data-action="auto-detect"]').forEach(button => {
        button.addEventListener('click', function () {
            const tenantId = this.getAttribute('data-tenant-id');
            autoDetectLocation(tenantId);
        });
    });

    // Edit location buttons
    document.querySelectorAll('[data-action="edit-location"]').forEach(button => {
        button.addEventListener('click', function () {
            const tenantId = this.getAttribute('data-tenant-id');
            editTenantLocation(tenantId);
        });
    });

    // Toggle central rule buttons
    document.querySelectorAll('[data-action="toggle-central"]').forEach(checkbox => {
        // Update visual on load
        updateToggleVisual(checkbox);

        // Listen for changes
        checkbox.addEventListener('change', function () {
            const tenantId = this.getAttribute('data-tenant-id');
            const isChecked = this.checked;
            updateToggleVisual(this);
            toggleCentralRule(tenantId, isChecked);
        });
    });
}

// Toggle central rule for a tenant
async function toggleCentralRule(tenantId, isChecked) {
    console.log('[TOGGLE] Pengguna mengubah toggle:', { tenantId, isChecked });
    showToast(`Mengubah aturan pusat...`, 'info');

    try {
        // Log sebelum request
        console.log('[TOGGLE] Mengirim PUT request ke /api/admin/tenants/', tenantId, {
            use_central_rules: isChecked
        });

        const response = await fetch(`/api/admin/tenants/${tenantId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}`
            },
            body: JSON.stringify({ use_central_rules: isChecked })
        });

        console.log('[TOGGLE] Response status:', response.status, response.statusText);

        if (response.status === 401 || response.status === 403) {
            console.warn('[TOGGLE] Token expired / unauthorized, redirecting ke login');
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            // window.location.replace("login.html");
            return;
        }

        if (!response.ok) {
            throw new Error('Failed to update central rule setting');
        }

        const result = await response.json();
        console.log('[TOGGLE] Response body:', result);

        if (result.success) {
            console.log('[TOGGLE] ✅ Berhasil di update di server');
            showToast(`Aturan pusat ${isChecked ? 'diaktifkan' : 'dinonaktifkan'} untuk tenant terpilih`, 'success');

            // Refresh data untuk memastikan UI sinkron
            fetchTenantLocations();
        } else {
            console.warn('[TOGGLE] ❌ Gagal di server:', result.message);
            showToast(`Gagal ${isChecked ? 'mengaktifkan' : 'menonaktifkan'} aturan pusat`, 'error');
            // Revert checkbox
            const checkbox = document.querySelector(`[data-action="toggle-central"][data-tenant-id="${tenantId}"]`);
            if (checkbox) {
                checkbox.checked = !isChecked;
                updateToggleVisual(checkbox);
            }
        }
    } catch (error) {
        console.error('[TOGGLE] ❌ Error:', error);
        showToast('Error updating central rule setting', 'error');
        // Revert checkbox
        const checkbox = document.querySelector(`[data-action="toggle-central"][data-tenant-id="${tenantId}"]`);
        if (checkbox) {
            checkbox.checked = !isChecked;
            updateToggleVisual(checkbox);
        }
    }
}

function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('hidden'));
    document.querySelectorAll('.nav-item').forEach(nav => {
        nav.classList.remove('nav-active', 'bg-blue-600', 'text-white');
        nav.classList.add('text-gray-600');
    });

    const activeTab = document.getElementById(tabName + 'Tab');
    if (activeTab) activeTab.classList.remove('hidden');

    const activeBtn = document.querySelector(`button[data-tab="${tabName}"]`);
    if (activeBtn) {
        activeBtn.classList.add('nav-active');
        activeBtn.classList.remove('text-gray-600');
    }

    const titles = {
        dashboard: 'Dashboard',
        teachers: 'Manajemen Guru',
        students: 'Manajemen Siswa',
        attendance: 'Log Kehadiran',
        payroll: 'Penggajian',
        documents: 'Dokumen HR',
        settings: 'Pengaturan',
        evaluations: 'Penilaian Guru Otomatis',
        whatsapp: 'Pesan WhatsApp',
        email: 'Log Email',
        'qr-generator': 'QR Scanner & Generator'
    };
    setEl('pageTitle', titles[tabName]);

    if (tabName === 'dashboard') fetchDashboardData();
    else if (tabName === 'teachers') { fetchTeachers(1); loadTeacherTenants(); }
    else if (tabName === 'students') { loadStudents(); loadStudentClasses(); }
    else if (tabName === 'attendance') fetchAttendanceLogs();
    else if (tabName === 'email') loadEmailLogs();
    else if (tabName === 'qr-generator') {
        loadScannerDevices();
        loadQRLogs();
    }
    else if (tabName === 'settings') {
        showSettingsTab('locations');
    }
}

function showAddTeacherModal() {
    currentTeacherId = null;
    document.getElementById('teacherModalTitle').textContent = 'Tambah Guru';
    document.getElementById('teacherForm').reset();

    const tenantSelect = document.getElementById('teacherTenantSelect');
    if (tenantSelect) {
      tenantSelect.innerHTML = '<option value="">Pilih Sekolah</option>';
      fetch('/api/admin/tenants', {
          headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
      })
          .then(res => res.json())
          .then(data => {
              if (data.success) {
                  data.data.forEach(tenant => {
                      const option = document.createElement('option');
                      option.value = tenant.tenant_id;
                      option.textContent = tenant.nama_sekolah;
                      tenantSelect.appendChild(option);
                  });
              }
          });
    }

    const modal = document.getElementById('teacherModal') || document.getElementById('addTeacherModal');
    if (modal) modal.classList.add('show');
}

function hideTeacherModal() {
    const modal = document.getElementById('teacherModal') || document.getElementById('addTeacherModal');
    if (modal) modal.classList.remove('show');
    if (modal) modal.style.display = 'none';
}

function showAddRuleModal() {
    currentRuleId = null;
    document.getElementById('ruleModalTitle').textContent = 'Tambah Aturan';
    document.getElementById('ruleForm').reset();

    document.querySelectorAll('input[name="target"]').forEach(cb => {
        cb.checked = false;
        cb.disabled = false;
    });
    adminOnTargetChange();

    // Populate tenant options
    const tenantSelect = document.querySelector('select[name="tenant_id"]');
    tenantSelect.innerHTML = '<option value="">Pilih Tenant</option>';

    // Fetch tenants for dropdown
    fetch('/api/admin/tenants', {
        headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                data.data.forEach(tenant => {
                    const option = document.createElement('option');
                    option.value = tenant.tenant_id;
                    option.textContent = tenant.nama_sekolah;
                    tenantSelect.appendChild(option);
                });
            }
        })
        .catch(error => console.error('Error fetching tenants:', error));

    document.getElementById('ruleModal').classList.add('show');
}

function hideRuleModal() {
    document.getElementById('ruleModal').classList.remove('show');
}

function showLocationModal() {
    currentMapContext = 'edit';
    document.getElementById('locationModal').classList.add('show');
}

function hideLocationModal() {
    document.getElementById('locationModal').classList.remove('show');
    const checkbox = document.getElementById('useCentralRulesInput');
    if (checkbox) {
        checkbox.checked = false;
        updateToggleVisual(checkbox);
    }
}

async function editTeacher(id) {
    try {
        const response = await fetch(`/api/admin/teachers/${id}`, {
            headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
        });
        const res = await response.json();

        if (res.success) {
            const teacher = res.data;
            document.getElementById('teacherModalTitle').textContent = 'Edit Guru';
            const form = document.getElementById('teacherForm');
            form.nama.value = teacher.nama;

            // Populate tenant options
            const tenantSelect = document.getElementById('teacherTenantSelect');
            tenantSelect.innerHTML = '<option value="">Pilih Sekolah</option>';
            const tenantRes = await fetch('/api/admin/tenants', {
                headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
            });
            const tenantData = await tenantRes.json();
            if (tenantData.success) {
                tenantData.data.forEach(tenant => {
                    const option = document.createElement('option');
                    option.value = tenant.tenant_id;
                    option.textContent = tenant.nama_sekolah;
                    tenantSelect.appendChild(option);
                });
                // Set selected value from assignment
                if (teacher.assignments && teacher.assignments.length > 0) {
                    tenantSelect.value = teacher.assignments[0].tenant_id;
                }
            }

            document.getElementById('teacherModal').classList.add('show');
        }
    } catch (error) {
        console.error('Error fetching teacher detail:', error);
    }
}

async function editRule(id) {
    try {
        const response = await fetch(`/api/admin/rules/${id}`, {
            headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
        });
        const res = await response.json();

        if (res.success) {
            currentRuleId = id;

            const rule = res.data;
            document.getElementById('ruleModalTitle').textContent = 'Edit Aturan';
            const form = document.getElementById('ruleForm');

            document.querySelectorAll('input[name="target"]').forEach(cb => {
                cb.checked = false;
                cb.disabled = true;
            });

            if (rule.tenant_id) {
                const tenantCb = document.querySelector('input[name="target"][value="tenant"]');
                if (tenantCb) tenantCb.checked = true;
            } else if (rule.tipe_unit) {
                const centralCb = document.querySelector(`input[name="target"][value="central_${rule.tipe_unit}"]`);
                if (centralCb) centralCb.checked = true;
            }

            adminOnTargetChange();

            form.tipe.value = rule.tipe;
            form.jam_mulai.value = rule.jam_mulai;
            form.jam_selesai.value = rule.jam_selesai;
            form.keterangan.value = rule.keterangan;
            form.status_log.value = rule.status_log;

            const tenantSelect = document.querySelector('select[name="tenant_id"]');
            if (tenantSelect.options.length <= 1) {
                fetch('/api/admin/tenants', {
                    headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
                })
                    .then(res => res.json())
                    .then(data => {
                        if (data.success) {
                            tenantSelect.innerHTML = '<option value="">Pilih Tenant</option>';
                            data.data.forEach(tenant => {
                                const option = document.createElement('option');
                                option.value = tenant.tenant_id;
                                option.textContent = tenant.nama_sekolah;
                                tenantSelect.appendChild(option);
                            });
                            tenantSelect.value = rule.tenant_id;
                        }
                    });
            } else {
                tenantSelect.value = rule.tenant_id;
            }

            document.getElementById('ruleModal').classList.add('show');
        }
    } catch (error) {
        console.error('Error fetching rule detail:', error);
    }
}

async function editTenantLocation(tenantId) {
    try {
        const response = await fetch('/api/admin/tenants', {
            headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
        });
        const res = await response.json();

        if (res.success) {
            const tenant = res.data.find(t => t.tenant_id === tenantId);
            if (tenant) {
                document.getElementById('locationModalTitle').textContent = 'Edit Lokasi Sekolah';
                const form = document.getElementById('locationForm');
                document.getElementById('locationTenantIdHidden').value = tenant.tenant_id;
                document.getElementById('locationNamaSekolah').value = tenant.nama_sekolah;
                form.latitude.value = tenant.latitude || '';
                form.longitude.value = tenant.longitude || '';
                form.location_radius.value = tenant.location_radius || 100;
                form.location_name.value = tenant.location_name || '';
                // Set toggle for use_central_rules
                const useCentralRulesCheckbox = document.getElementById('useCentralRulesInput');
                if (useCentralRulesCheckbox) {
                    useCentralRulesCheckbox.checked = tenant.use_central_rules === true;
                    updateToggleVisual(useCentralRulesCheckbox);
                }

                // Update coordinate preview
                updateCoordinatePreview();

                // Reset map state
                const mapContainer = document.getElementById('mapContainer');
                if (!mapContainer.classList.contains('hidden')) {
                    toggleMap(); // Close map if open
                }

                showLocationModal();
            }
        }
    } catch (error) {
        console.error('Error fetching tenant detail:', error);
    }
}

async function deleteTeacher(id) {
    if (confirm('Apakah Anda yakin ingin menghapus guru ini?')) {
        try {
            const response = await fetch(`/api/admin/teachers/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
            });
            const res = await response.json();
            if (res.success) {
                fetchTeachers(currentPage);
            }
        } catch (error) {
            console.error('Delete teacher error:', error);
        }
    }
}

async function deleteRule(id) {
    if (confirm('Apakah Anda yakin ingin menghapus aturan ini?')) {
        try {
            const response = await fetch(`/api/admin/rules/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
            });
            const res = await response.json();
            if (res.success) {
                fetchRules();
            }
        } catch (error) {
            console.error('Delete rule error:', error);
        }
    }
}

// Bulk actions
function toggleSelectAll() {
    const selectAll = document.getElementById('selectAll');
    const checkboxes = document.querySelectorAll('.teacher-checkbox');
    checkboxes.forEach(cb => cb.checked = selectAll.checked);
}

function updateSelectAll() {
    const checkboxes = document.querySelectorAll('.teacher-checkbox');
    const selectAll = document.getElementById('selectAll');
    selectAll.checked = checkboxes.length > 0 && Array.from(checkboxes).every(cb => cb.checked);
}

function getSelectedTeacherIds() {
    const checkboxes = document.querySelectorAll('.teacher-checkbox:checked');
    return Array.from(checkboxes).map(cb => parseInt(cb.value));
}

async function deleteSelectedTeachers() {
    const selectedIds = getSelectedTeacherIds();
    if (selectedIds.length === 0) {
        alert('Pilih guru yang ingin dihapus');
        return;
    }
    if (!confirm(`Hapus ${selectedIds.length} guru terpilih?`)) return;

    try {
        const promises = selectedIds.map(id =>
            fetch(`/api/admin/teachers/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
            })
        );
        await Promise.all(promises);
        fetchTeachers(currentPage);
    } catch (error) {
        console.error('Bulk delete error:', error);
        alert('Terjadi kesalahan saat menghapus');
    }
}

window.loadTeacherTenants = async function () {
    const tenantFilter = document.getElementById('teacherTenantFilter');
    if (!tenantFilter) return;

    try {
        const response = await fetch('/api/admin/tenants', {
            headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
        });
        const data = await response.json();

        if (data.success) {
            tenantFilter.innerHTML = '<option value="">Semua Sekolah</option>' + data.data.map(t => `<option value="${t.tenant_id}">${t.nama_sekolah}</option>`).join('');
        }
    } catch (error) {
        console.error('Error loading tenants:', error);
    }
};

async function createUsersForSelected() {
    const selectedIds = getSelectedTeacherIds();
    if (selectedIds.length === 0) {
        alert('Pilih guru yang ingin dibuat user-nya');
        return;
    }

    try {
        const promises = selectedIds.map(id =>
            fetch(`/api/admin/teachers/${id}/create-user`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
            })
        );
        const results = await Promise.all(promises);
        let successCount = 0;
        let errorMessages = [];
        for (let i = 0; i < results.length; i++) {
            const res = await results[i].json();
            if (res.success) {
                successCount++;
            } else {
                errorMessages.push(`Guru ${selectedIds[i]}: ${res.message}`);
            }
        }
        if (successCount > 0) {
            alert(`${successCount} user berhasil dibuat`);
        }
        if (errorMessages.length > 0) {
            alert('Error:\n' + errorMessages.join('\n'));
        }
        fetchTeachers(currentPage);
    } catch (error) {
        console.error('Bulk create user error:', error);
        alert('Terjadi kesalahan');
    }
}

async function createUser(teacherId) {
    if (!confirm('Buat user account untuk guru ini?')) return;

    try {
        const response = await fetch(`/api/admin/teachers/${teacherId}/create-user`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
        });
        const res = await response.json();
        if (res.success) {
            alert('User account berhasil dibuat');
            fetchTeachers(currentPage);
        } else {
            alert('Error: ' + res.message);
        }
    } catch (error) {
        console.error('Create user error:', error);
        alert('Terjadi kesalahan');
    }
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    // window.location.href = "login.html";
}

// Pagination functions
function updatePaginationControls(pagination) {
    const { page, totalPages, total, limit } = pagination;

    // Update pagination info
    const startRecord = (page - 1) * limit + 1;
    const endRecord = Math.min(page * limit, total);
    document.getElementById('paginationInfo').textContent = `Menampilkan ${startRecord}-${endRecord} dari ${total} data`;

    // Update prev/next buttons
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');

    const hasPrevPage = page > 1;
    const hasNextPage = page < totalPages;

    prevBtn.disabled = !hasPrevPage;
    nextBtn.disabled = !hasNextPage;

    prevBtn.onclick = hasPrevPage ? prevPage : null;
    nextBtn.onclick = hasNextPage ? nextPage : null;

    // Update page numbers
    const pageNumbersContainer = document.getElementById('pageNumbers');
    pageNumbersContainer.innerHTML = '';

    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    // Add first page and ellipsis if needed
    if (startPage > 1) {
        pageNumbersContainer.appendChild(createPageButton(1));
        if (startPage > 2) {
            const ellipsis = document.createElement('span');
            ellipsis.className = 'px-3 py-2 text-sm text-gray-500';
            ellipsis.textContent = '...';
            pageNumbersContainer.appendChild(ellipsis);
        }
    }

    // Add page numbers
    for (let i = startPage; i <= endPage; i++) {
        pageNumbersContainer.appendChild(createPageButton(i, i === currentPage));
    }

    // Add last page and ellipsis if needed
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            const ellipsis = document.createElement('span');
            ellipsis.className = 'px-3 py-2 text-sm text-gray-500';
            ellipsis.textContent = '...';
            pageNumbersContainer.appendChild(ellipsis);
        }
        pageNumbersContainer.appendChild(createPageButton(totalPages));
    }
}

function createPageButton(pageNum, isActive = false) {
    const button = document.createElement('button');
    button.className = `px-3 py-2 text-sm font-medium rounded-md ${isActive
        ? 'bg-blue-600 text-white'
        : 'text-gray-500 bg-white border border-gray-300 hover:bg-gray-50'
        }`;
    button.textContent = pageNum;
    if (!isActive) {
        button.onclick = () => goToPage(pageNum);
    }
    return button;
}

function goToPage(page) {
    if (page >= 1 && page <= totalPages) {
        currentPage = page;
        fetchTeachers(page);
    }
}

function prevPage() {
    if (currentPage > 1) {
        goToPage(currentPage - 1);
    }
}

function nextPage() {
    if (currentPage < totalPages) {
        goToPage(currentPage + 1);
    }
}

// Toast notification function
function showToast(message, type = 'info') {
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg max-w-sm ${type === 'success' ? 'bg-green-500 text-white' :
        type === 'error' ? 'bg-red-500 text-white' :
            'bg-blue-500 text-white'
        }`;

    toast.innerHTML = `
        <div class="flex items-center">
          <i class="fas ${type === 'success' ? 'fa-check-circle' :
            type === 'error' ? 'fa-exclamation-circle' :
                'fa-info-circle'
        } mr-2"></i>
          <span>${message}</span>
        </div>
      `;

    document.body.appendChild(toast);

    // Auto remove after 3 seconds
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// Settings Navigation
function showSettingsTab(tabName) {
    // Hide all setting contents
    document.querySelectorAll('.setting-content').forEach(content => {
        content.classList.add('hidden');
    });

    // Remove active class from all nav items
    document.querySelectorAll('.settings-nav-item').forEach(item => {
        item.classList.remove('active', 'text-blue-600', 'border-blue-500');
        item.classList.add('text-gray-500', 'border-transparent');
    });

    // Show selected content and activate nav item
    const content = document.getElementById(tabName + 'Setting');
    const navItem = document.querySelector(`[data-setting="${tabName}"]`);

    if (content) content.classList.remove('hidden');
    if (navItem) {
        navItem.classList.add('active', 'text-blue-600', 'border-blue-500');
        navItem.classList.remove('text-gray-500', 'border-transparent');
    }

    // Load data based on tab
    if (tabName === 'locations') {
        fetchTenantLocations();
        // Update all toggle visuals after loading
        setTimeout(updateAllToggleVisuals, 100);
    } else if (tabName === 'locations-multi') {
        loadTenantLocations();
    } else if (tabName === 'attendance') {
        fetchRules();
    }
}

// Auto Detect Location Functions
async function autoDetectLocation(tenantId) {
    if (!navigator.geolocation) {
        alert('Browser tidak mendukung geolokasi');
        return;
    }

    // AMAN: Mencari tombol berdasarkan atribut data, bukan menggunakan variabel 'event' yang rawan crash
    const button = document.querySelector(`[data-action="auto-detect"][data-tenant-id="${tenantId}"]`);
    let originalText = '<i class="fas fa-crosshairs mr-2"></i>Auto Detect';

    if (button) {
        originalText = button.innerHTML;
        button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Detecting...';
        button.disabled = true;
    }

    try {
        const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 300000
            });
        });

        const latitude = position.coords.latitude.toFixed(6);
        const longitude = position.coords.longitude.toFixed(6);

        // Ambil data form lain yang mungkin dibutuhkan oleh backend V5.0 Anda jika ada
        const response = await fetch(`/api/admin/tenants/${tenantId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}`
            },
            body: JSON.stringify({
                latitude: latitude,
                longitude: longitude,
                location_radius: 100, // Radius default geofence 100 meter
                location_name: `Auto-detected at ${new Date().toLocaleString('id-ID')}`
            })
        });

        const res = await response.json();

        // Memeriksa response.ok atau res.success sesuai standarisasi API Anda
        if (response.ok || res.success) {
            alert(`Lokasi berhasil dideteksi dan disimpan!\nLatitude: ${latitude}\nLongitude: ${longitude}`);

            // Sinkronisasi fungsi refresh daftar tenant
            if (typeof fetchTenantLocations === 'function') fetchTenantLocations();
            else if (typeof loadTenants === 'function') loadTenants();
            else if (typeof fetchTenants === 'function') fetchTenants();

        } else {
            throw new Error(res.message || 'Failed to update location');
        }

    } catch (error) {
        console.error('Location detection error:', error);
        if (error.code === 1) {
            alert('Akses lokasi ditolak. Silakan izinkan akses lokasi di browser Anda.');
        } else if (error.code === 2) {
            alert('Lokasi tidak dapat dideteksi. Pastikan GPS aktif dan coba lagi.');
        } else {
            alert('Error mendeteksi lokasi: ' + error.message);
        }
    } finally {
        if (button) {
            button.innerHTML = originalText;
            button.disabled = false;
        }
    }
}

async function autoDetectLocationModal(event) {
    console.log('🔍 Detect location button clicked');

    // Tentukan field berdasarkan konteks modal
    const isAddModal = currentMapContext === 'add';
    const latFieldId = isAddModal ? 'locationLat' : 'latitudeInput';
    const lngFieldId = isAddModal ? 'locationLng' : 'longitudeInput';
    const coordPreviewId = isAddModal ? 'coordinatePreviewModal' : 'coordinatePreview';
    const statusDivId = isAddModal ? 'tenantLocationStatus' : 'locationStatus';

    if (!navigator.geolocation) {
        console.error('❌ Geolocation not supported');
        alert('Browser tidak mendukung geolokasi');
        return;
    }

    const button = event.target.closest('button');
    console.log('Button found:', !!button);

    const originalText = button.innerHTML;
    const statusDiv = document.getElementById(statusDivId);
    const latInput = document.getElementById(latFieldId);
    const lngInput = document.getElementById(lngFieldId);
    const coordPreview = document.getElementById(coordPreviewId);

    console.log('Status div found:', !!statusDiv);
    console.log('Lat input found:', !!latInput);
    console.log('Lng input found:', !!lngInput);

    button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Detecting...';
    button.disabled = true;
    statusDiv.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Mendapatkan koordinat GPS...';

    try {
        const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 300000
            });
        });

        const latitude = position.coords.latitude.toFixed(6);
        const longitude = position.coords.longitude.toFixed(6);
        const accuracy = Math.round(position.coords.accuracy);

        console.log('📍 GPS coordinates obtained:', { latitude, longitude, accuracy });

        // Fill the form inputs
        if (latInput) latInput.value = latitude;
        if (lngInput) lngInput.value = longitude;

        // Update coordinate preview
        if (coordPreview) coordPreview.innerHTML = `📍 ${latitude}, ${longitude}`;

        // Update status
        statusDiv.innerHTML = `<i class="fas fa-check-circle mr-1 text-green-600"></i>Lokasi berhasil dideteksi (akurasi: ${accuracy}m)`;
        statusDiv.classList.add('text-green-600');
        setTimeout(() => {
            statusDiv.classList.remove('text-green-600');
        }, 3000);

        console.log('Form updated successfully');

        // Update mini map with GPS coordinates
        if (isAddModal) {
            updateMiniMap(latitude, longitude);
        } else {
            updateLocationMap(latitude, longitude);
        }
        console.log('Map updated with GPS coordinates');

    } catch (error) {
        console.error('Modal location detection error:', error);
        let errorMessage = 'Gagal mendapatkan lokasi';

        if (error.code === 1) {
            errorMessage = 'Akses lokasi ditolak. Izinkan akses lokasi di browser.';
        } else if (error.code === 2) {
            errorMessage = 'Lokasi tidak dapat ditemukan. Pastikan GPS aktif.';
        } else if (error.code === 3) {
            errorMessage = 'Timeout mendeteksi lokasi. Coba lagi.';
        }

        statusDiv.innerHTML = `<i class="fas fa-exclamation-triangle mr-1 text-red-600"></i>${errorMessage}`;
        statusDiv.classList.add('text-red-600');
        setTimeout(() => {
            statusDiv.classList.remove('text-red-600');
        }, 3000);

        // Fallback: Update map with default coordinates
        console.log('⚠️ GPS failed, using default coordinates');
        const defaultLat = -2.2166;
        const defaultLng = 113.9209;

        if (isAddModal) {
            updateMiniMap(defaultLat, defaultLng);
        } else {
            updateLocationMap(defaultLat, defaultLng);
        }

        if (latInput) latInput.value = defaultLat.toFixed(6);
        if (lngInput) lngInput.value = defaultLng.toFixed(6);
        if (coordPreview) coordPreview.innerHTML = `📍 ${defaultLat.toFixed(6)}, ${defaultLng.toFixed(6)} (Default)`;

    } finally {
        button.innerHTML = originalText;
        button.disabled = false;
    }
}

// Refresh tenant locations
function refreshTenantLocations() {
    const container = document.getElementById('tenantLocations');
    container.innerHTML = `
        <div class="text-center py-12">
          <div class="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent mx-auto mb-4"></div>
          <p class="text-gray-600">Memuat ulang data lokasi...</p>
        </div>
      `;
    fetchTenantLocations();
}

// Update coordinate preview when inputs change
const latInput = document.getElementById('latitudeInput');
const lngInput = document.getElementById('longitudeInput');
if (latInput) latInput.addEventListener('input', updateCoordinatePreview);
if (lngInput) lngInput.addEventListener('input', updateCoordinatePreview);

function updateCoordinatePreview() {
    const lat = document.getElementById('latitudeInput').value;
    const lng = document.getElementById('longitudeInput').value;
    const preview = document.getElementById('coordinatePreview');

    if (lat && lng) {
        preview.innerHTML = `📍 ${parseFloat(lat).toFixed(6)}, ${parseFloat(lng).toFixed(6)}`;
    } else {
        preview.innerHTML = '';
    }
}

document.getElementById('teacherForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData);

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';

    try {
        const method = currentTeacherId ? 'PUT' : 'POST';
        const url = currentTeacherId ? `/api/admin/teachers/${currentTeacherId}` : '/api/admin/teachers';

        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}`
            },
            body: JSON.stringify(data)
        });

        const res = await response.json();
        if (res.success) {
            hideTeacherModal();
            fetchTeachers(currentPage);
        }
    } catch (error) {
        console.error('Teacher form submit error:', error);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
});

document.getElementById('ruleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);

    const tipe = formData.get('tipe');
    const jam_mulai = formData.get('jam_mulai');
    const jam_selesai = formData.get('jam_selesai');
    const keterangan = formData.get('keterangan') || '';
    const status_log = formData.get('status_log');
    const hari = Array.from(form.querySelectorAll('input[name="hari"]:checked')).map(cb => cb.value).join(',');
    const checkedTargets = Array.from(form.querySelectorAll('input[name="target"]:checked')).map(cb => cb.value);

    if (checkedTargets.length === 0) {
      showToast('Pilih minimal satu target aturan', 'error');
      return;
    }

    if (checkedTargets.includes('tenant') && !formData.get('tenant_id')) {
      showToast('Pilih sekolah untuk target Tenant Spesifik', 'error');
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';

    try {
      let successCount = 0;
      let errorCount = 0;

      for (const target of checkedTargets) {
        const payload = {
          tipe,
          jam_mulai,
          jam_selesai,
          keterangan,
          status_log,
          hari: hari || null
        };

        if (target === 'tenant') {
          payload.tenant_id = formData.get('tenant_id');
        } else {
          payload.tipe_unit = target.replace('central_', '');
        }

        const method = currentRuleId ? 'PUT' : 'POST';
        const url = currentRuleId ? `/api/admin/rules/${currentRuleId}` : '/api/admin/rules';

        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}`
          },
          body: JSON.stringify(payload)
        });

        const res = await response.json();
        if (res.success) {
          successCount++;
        } else {
          errorCount++;
          console.error(`Error saving rule for target ${target}:`, res.message);
        }
      }

      if (errorCount === 0) {
        hideRuleModal();
        fetchRules();
        showToast(`${successCount} aturan berhasil disimpan`, 'success');
      } else {
        showToast(`${successCount} berhasil, ${errorCount} gagal disimpan`, 'error');
      }
    } catch (error) {
      console.error('Rule form submit error:', error);
      showToast('Terjadi kesalahan saat menyimpan aturan', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
});

document.getElementById('locationForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const useCentralRulesInput = document.getElementById('useCentralRulesInput');
    if (!useCentralRulesInput) {
        return;
    }
    
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData);
    const tenantId = data.tenant_id;

    if (!tenantId) {
        showToast('Tenant ID tidak ditemukan', 'error');
        return;
    }

    data.use_central_rules = useCentralRulesInput.checked;

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';

    try {
        const response = await fetch(`/api/admin/tenants/${tenantId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}`
            },
            body: JSON.stringify(data)
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            // window.location.replace("login.html");
            return;
        }

        const res = await response.json();
        if (res.success) {
            hideLocationModal();
            fetchTenantLocations();
            showToast('Lokasi berhasil disimpan', 'success');
        } else {
            showToast('Error: ' + (res.message || 'Gagal menyimpan lokasi'), 'error');
        }
    } catch (error) {
        console.error('Location form submit error:', error);
        showToast('Terjadi kesalahan saat menyimpan lokasi', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
});

// ── Tenant Location Modal (Tambah / Edit Lokasi Tenant) ──
document.getElementById('tenantLocationForm')
    .addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData);
        const tenantId = data.tenant_id;

        const submitBtn = e.target.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';

        try {
            const response = await fetch(`/api/admin/tenants/${tenantId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}`
                },
                body: JSON.stringify(data)
            });

            if (response.status === 401 || response.status === 403) {
                console.warn('[TENANT LOCATION] Token expired / unauthorized, redirecting to login');
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                // window.location.replace("login.html");
                return;
            }

            const res = await response.json();
            if (res.success) {
                hideTenantLocationModal();
                fetchTenantLocations();
                showToast('Lokasi tenant berhasil disimpan', 'success');
            } else {
                showToast('Gagal menyimpan: ' + (res.message || 'Terjadi kesalahan'), 'error');
            }
        } catch (error) {
            console.error('Tenant location form submit error:', error);
            showToast('Terjadi kesalahan saat menyimpan lokasi tenant', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });

document.addEventListener('DOMContentLoaded', function () {
    // Run auth check first
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');

    if (!token || !userData) {
        // window.location.replace("/login.html");
        return;
    }

    try {
        const user = JSON.parse(userData);
        if (user.role !== 'admin') {
            // window.location.replace("/login.html");
            return;
        }
        window.authToken = token;
        window.currentUser = user;

        // Now initialize UI components after auth is confirmed
        initAllUI();
    } catch (e) {
        // window.location.replace("/login.html");
    }
});

function initAllUI() {
    const now = new Date();
    setEl('currentDate', now.toLocaleDateString('id-ID', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    }));

    setEl('adminName', window.currentUser?.username || 'Admin');

    // Attach tab click handlers
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', function () {
            const tab = this.getAttribute('data-tab');
            showTab(tab);
        });
    });

    // Email filter listeners
    document.getElementById('emailSearch')?.addEventListener('input', () => loadEmailList(currentEmailFolder, 1));

    // Add settings navigation event listeners
    document.querySelectorAll('.settings-nav-item').forEach(item => {
        item.addEventListener('click', function () {
            const setting = this.getAttribute('data-setting');
            showSettingsTab(setting);
        });
    });

    // Add coordinate preview listeners
    document.getElementById('latitudeInput')?.addEventListener('input', updateCoordinatePreview);
    document.getElementById('longitudeInput')?.addEventListener('input', updateCoordinatePreview);

    // Add modal auto-detect button listener
    document.getElementById('detectLocationBtn')?.addEventListener('click', (event) => autoDetectLocationModal(event));

    // Add device modal button
    document.getElementById('add-device-modal-btn')?.addEventListener('click', () => {
        const modal = document.getElementById('addDeviceModal');
        modal.classList.remove('hidden');
        modal.classList.add('show');

        // Load tenant options for device modal
        fetch('/api/admin/tenants', {
            headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
        })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    const select = document.getElementById('deviceTenantId');
                    select.innerHTML = '<option value="">Pilih Sekolah</option>';
                    data.data.forEach(tenant => {
                        const option = document.createElement('option');
                        option.value = tenant.tenant_id;
                        option.textContent = tenant.nama_sekolah;
                        option.dataset.schoolName = tenant.nama_sekolah;
                        select.appendChild(option);
                    });
                    select.addEventListener('change', function() {
                        const selected = this.options[this.selectedIndex];
                        const schoolNameInput = document.getElementById('deviceSchoolName');
                        const tokenInput = document.getElementById('deviceRegistrationToken');
                        if (schoolNameInput) schoolNameInput.value = selected ? selected.dataset.schoolName || '' : '';
                        if (tokenInput && this.value) {
                            tokenInput.value = 'YPWI-' + (this.value || 'REG').toUpperCase() + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
                        }
                    });
                }
            })
            .catch(error => console.error('Error loading tenants for device modal:', error));

            // Regenerate token button
            document.getElementById('btnRegenerateToken')?.addEventListener('click', function() {
                const tenantSelect = document.getElementById('deviceTenantId');
                const tokenInput = document.getElementById('deviceRegistrationToken');
                if (tenantSelect && tokenSelect.value && tokenInput) {
                    tokenInput.value = 'YPWI-' + tenantSelect.value.toUpperCase() + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
                }
            });
    });


    // Refresh devices button
    document.getElementById('refresh-devices')?.addEventListener('click', loadScannerDevices);

    // Auto evaluation button
    document.getElementById('runAutoEvaluation')?.addEventListener('click', runAutoEvaluation);

    fetchDashboardData();

    // Initialize PDF report and recap view
    initPdfReport();
    initRecapView();

    // WhatsApp functionality
    setupWhatsApp();
};

// Stub functions for WhatsApp and other features
function loadTenantsForWhatsApp() { }
function loadTeachersForWhatsApp() { }
function setupMessageTemplates() { }
function runAutoEvaluation() { }
function initPdfReport() { }
function initRecapView() { }
function updateWhatsAppStatus(msg, type) { }

// WhatsApp Functions
function setupWhatsApp() {
    loadTenantsForWhatsApp();
    loadTeachersForWhatsApp();
    setupMessageTemplates();

    // Bulk WhatsApp form
    const bulkForm = document.getElementById('bulkWhatsAppForm');
    if (bulkForm) bulkForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const tenantId = document.getElementById('bulkTenantSelect').value;
        const message = document.getElementById('bulkMessage').value.trim();

        if (!tenantId || !message) {
            alert('Pilih unit sekolah dan isi pesan!');
            return;
        }

        if (!confirm(`Kirim pesan ke semua guru di unit ${tenantId}?`)) {
            return;
        }

        try {
            const btn = e.target.querySelector('button[type="submit"]');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Mengirim...';
            btn.disabled = true;

            const response = await fetch(`/api/admin/send-whatsapp-bulk/${tenantId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}`
                },
                body: JSON.stringify({ message })
            });

            const result = await response.json();

            if (result.success) {
                updateWhatsAppStatus(`✅ ${result.message || 'Pesan berhasil dikirim ke ' + (result.total_sent || 0) + ' guru'}`, 'success');
                document.getElementById('bulkWhatsAppForm').reset();
            } else {
                updateWhatsAppStatus(`❌ Gagal mengirim: ${result.message}`, 'error');
            }

            btn.innerHTML = originalText;
            btn.disabled = false;

        } catch (error) {
            console.error('Bulk WhatsApp error:', error);
            updateWhatsAppStatus('❌ Terjadi kesalahan saat mengirim pesan', 'error');
            e.target.querySelector('button[type="submit"]').innerHTML = '<i class="fab fa-whatsapp mr-2"></i>Kirim Pesan Massal';
            e.target.querySelector('button[type="submit"]').disabled = false;
        }
    });

    // Single WhatsApp form
    document.getElementById('singleWhatsAppForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const teacherId = document.getElementById('singleTeacherSelect').value;
        const message = document.getElementById('singleMessage').value.trim();

        if (!teacherId || !message) {
            alert('Pilih guru dan isi pesan!');
            return;
        }

        if (!confirm('Kirim pesan ke guru yang dipilih?')) {
            return;
        }

        try {
            const btn = e.target.querySelector('button[type="submit"]');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Mengirim...';
            btn.disabled = true;

            const response = await fetch(`/api/admin/send-whatsapp-single/${teacherId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}`
                },
                body: JSON.stringify({ message })
            });

            const result = await response.json();

            if (result.success) {
                updateWhatsAppStatus(`✅ Pesan berhasil dikirim ke ${result.recipient || 'guru'}`, 'success');
                document.getElementById('singleWhatsAppForm').reset();
            } else {
                updateWhatsAppStatus(`❌ Gagal mengirim: ${result.message}`, 'error');
            }

            btn.innerHTML = originalText;
            btn.disabled = false;

        } catch (error) {
            console.error('Single WhatsApp error:', error);
            updateWhatsAppStatus('❌ Terjadi kesalahan saat mengirim pesan', 'error');
            e.target.querySelector('button[type="submit"]').innerHTML = '<i class="fab fa-whatsapp mr-2"></i>Kirim Pesan';
            e.target.querySelector('button[type="submit"]').disabled = false;
        }
    });

    // Refresh button
    const refreshWhatsAppBtn = document.getElementById('refreshWhatsApp');
    if (refreshWhatsAppBtn) refreshWhatsAppBtn.addEventListener('click', () => {
        loadTenantsForWhatsApp();
        loadTeachersForWhatsApp();
        updateWhatsAppStatus('🔄 Data diperbarui', 'info');
    });
}

// Students Tab Functions
let currentStudentPage = 1;
let studentLimit = 25;
let totalStudents = 0;
let totalStudentPages = 0;
let studentSortBy = 'nama_siswa';
let studentSortDir = 'ASC';

window.sortStudents = function (field) {
    if (studentSortBy === field) {
        studentSortDir = studentSortDir === 'ASC' ? 'DESC' : 'ASC';
    } else {
        studentSortBy = field;
        studentSortDir = 'ASC';
    }
    loadStudents(1);
};

window.loadStudents = async function (page = 1) {
    currentStudentPage = page;
    const tbody = document.getElementById('studentsTable');
    const searchInput = document.getElementById('studentSearch');
    const search = window.studentSearchValue || (searchInput ? searchInput.value.trim() : '');
    const classId = window.studentClassFilterValue || '';
    const tenantId = window.studentTenantFilterValue || window.tenantId || (JSON.parse(localStorage.getItem('user') || '{}'))?.tenant_id || (JSON.parse(localStorage.getItem('user') || '{}'))?.assignments?.[0]?.tenant_id || '';

    tbody.innerHTML = '<tr><td colspan="7" class="px-6 py-12 text-center text-gray-500"><i class="fas fa-spinner fa-spin"></i> Memuat...</td></tr>';

    try {
        const params = new URLSearchParams({
            page,
            limit: studentLimit,
            sortBy: studentSortBy,
            sortDir: studentSortDir
        });
        if (search) params.append('search', search);
        if (classId) params.append('class_id', classId);
        if (tenantId) params.append('tenant_id', tenantId);

        const response = await fetch('/api/admin/students?' + params.toString(), {
            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
        });
        const data = await response.json();

if (data.success) {
            totalStudents = data.pagination?.total || 0;
            totalStudentPages = data.pagination?.totalPages || 1;

            tbody.innerHTML = data.data.map(s => `
              <tr class="${!s.nama_kelas || s.class_id === null ? 'bg-yellow-50' : ''}">
                <td class="px-6 py-4 text-center"><input type="checkbox" class="student-checkbox" value="${s.id}" onchange="updateMutasiBtnState()"></td>
                <td class="px-6 py-4">${s.nama_siswa || '-'}${!s.nama_kelas || s.class_id === null ? '<span class="text-xs text-yellow-600 font-semibold">(Belum ada kelas)</span>' : ''}</td>
                <td class="px-6 py-4">${s.nisn || '-'}</td>
                <td class="px-6 py-4">${s.nis || '-'}</td>
                <td class="px-6 py-4">${s.nama_kelas || '-'}</td>
                <td class="px-6 py-4">${s.nama_orang_tua || '-'}<br><small>${s.no_wa_ortu || ''}</small></td>
                <td class="px-6 py-4">Rp ${(s.iuran_bulanan || 0).toLocaleString('id-ID')}</td>
                <td class="px-6 py-4">
                  <button onclick="showStudentMutasiModal(${s.id}, '${s.nama_siswa || ''}', '${s.nama_sekolah || ''}', '${s.tenant_id || ''}')" class="text-purple-600 hover:text-purple-800 mr-2" title="Mutasi">
                    <i class="fas fa-exchange-alt"></i>
                  </button>
                  <button onclick="editStudent(${s.id})" class="text-blue-600 hover:text-blue-800" title="Edit">
                    <i class="fas fa-edit"></i>
                  </button>
                </td>
              </tr>
            `).join('') || '<tr><td colspan="8" class="px-6 py-12 text-center text-gray-500">Tidak ada data siswa</td></tr>';

renderStudentPagination();
        } else {
            tbody.innerHTML = '<tr><td colspan="8" class="px-6 py-12 text-center text-red-500">Gagal memuat data</td></tr>';
        }
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="8" class="px-6 py-12 text-center text-red-500">Error: ' + error.message + '</td></tr>';
    }
};


window.loadStudentClasses = async function () {
    // Classes are loaded in the filter modal, this function kept for compatibility
};

window.changeStudentPage = function (newPage) {
    if (newPage < 1 || newPage > totalStudentPages) return;
    loadStudents(newPage);
};

window.changeStudentLimit = function (newLimit) {
    studentLimit = parseInt(newLimit);
    loadStudents(1);
};

function renderStudentPagination() {
    const paginationInfo = document.getElementById('studentPaginationInfo');
    if (paginationInfo) {
        paginationInfo.textContent = 'Menampilkan ' + ((currentStudentPage - 1) * studentLimit + 1) + ' - ' + Math.min(currentStudentPage * studentLimit, totalStudents) + ' dari ' + totalStudents + ' data';
    }

    const pageNumbers = document.getElementById('studentPageNumbers');
    if (pageNumbers) {
        let html = '';
        const maxVisible = 5;
        let start = Math.max(1, currentStudentPage - Math.floor(maxVisible / 2));
        let end = Math.min(totalStudentPages, start + maxVisible - 1);
        if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);

        for (let i = start; i <= end; i++) {
            html += '<button onclick="changeStudentPage(' + i + ')" class="px-3 py-1 rounded ' + (i === currentStudentPage ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50') + '">' + i + '</button>';
        }
        pageNumbers.innerHTML = html;
    }

    const prevBtn = document.getElementById('studentPrevPageBtn');
    const nextBtn = document.getElementById('studentNextPageBtn');
    if (prevBtn) prevBtn.disabled = currentStudentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentStudentPage >= totalStudentPages;
}

window.updateStudentPayment = async function (studentId, currentIuran) {
    const { value: newIuran } = await Swal.fire({
        title: 'Update Iuran Bulanan',
        input: 'number',
        inputLabel: 'Iuran Bulanan Baru',
        inputValue: currentIuran,
        inputAttributes: {
            min: 0,
            step: 1000
        },
        showCancelButton: true,
        confirmButtonText: 'Update',
        cancelButtonText: 'Batal',
        preConfirm: (value) => {
            if (value === '' || value === null) return 0;
            if (parseInt(value) < 0) return Swal.showValidationMessage('Iuran tidak boleh negatif');
            return parseInt(value);
        }
    });

    if (newIuran !== undefined) {
        try {
            const response = await fetch('/api/admin/students/' + studentId + '/payment', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + localStorage.getItem('token')
                },
                body: JSON.stringify({ iuran_bulanan: newIuran })
            });
            const data = await response.json();
            if (data.success) {
                Swal.fire('Berhasil', 'Iuran berhasil diupdate', 'success');
                loadStudents(currentStudentPage);
            } else {
                Swal.fire('Error', data.message, 'error');
            }
        } catch (error) {
            alert('Terjadi kesalahan saat menghapus');
        }
    }
}

window.showTeacherTransferModal = async function () {
    const selectedIds = getSelectedTeacherIds();
    if (selectedIds.length === 0) {
        alert('Pilih guru yang ingin dimutasi');
        return;
    }

    const tenantsRes = await fetch('/api/admin/tenants', {
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });
    const tenantsData = await tenantsRes.json();
    const tenants = tenantsData.success ? tenantsData.data : [];

    Swal.fire({
        title: 'Mutasi Guru',
        html: `
          <select id="transferTenantSelect" class="swal2-input">
            <option value="">Pilih Sekolah Tujuan</option>
            ${tenants.map(t => `<option value="${t.tenant_id}">${t.nama_sekolah}</option>`).join('')}
          </select>
          <input id="transferJabatan" class="swal2-input" placeholder="Jabatan di Sekolah Baru" value="Guru">
        `,
        showCancelButton: true,
        confirmButtonText: 'Mutasi',
        preConfirm: () => ({
            tenant_id: document.getElementById('transferTenantSelect').value,
            jabatan_di_unit: document.getElementById('transferJabatan').value
        })
    }).then(async (result) => {
        if (result.isConfirmed && result.value.tenant_id) {
            try {
                const promises = selectedIds.map(id =>
                    fetch('/api/admin/teachers/' + id + '/transfer', {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + localStorage.getItem('token')
                        },
                        body: JSON.stringify(result.value)
                    })
                );
                await Promise.all(promises);
                Swal.fire('Berhasil', 'Guru berhasil dipindahkan', 'success');
                fetchTeachers(currentPage);
            } catch (error) {
                Swal.fire('Error', 'Gagal memindahkan guru', 'error');
            }
        }
    });
}

window.showStudentTransferModal = async function () {
    const selectedIds = getSelectedStudentIds();
    if (selectedIds.length === 0) {
        alert('Pilih siswa yang ingin dimutasi');
        return;
    }

    const tenantsRes = await fetch('/api/admin/tenants', {
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });
    const tenantsData = await tenantsRes.json();
    const tenants = tenantsData.success ? tenantsData.data : [];

    let classes = [];
    let selectedTenantId = '';
    const loadClasses = async (tenantId) => {
        if (!tenantId) {
            classes = [];
            return;
        }
        const classesRes = await fetch('/api/admin/classes?tenant_id=' + tenantId, {
            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
        });
        const classesData = await classesRes.json();
        classes = classesData.success ? classesData.data : [];
    };

    const tenantSelect = document.createElement('select');
    tenantSelect.innerHTML = '<option value="">Pilih Sekolah Tujuan</option>' + tenants.map(t => `<option value="${t.tenant_id}">${t.nama_sekolah}</option>`).join('');

    Swal.fire({
        title: 'Mutasi Siswa',
        html: `
          <select id="studentTransferTenant" class="swal2-input" onchange="window.loadTransferClasses(this.value)">
            <option value="">Pilih Sekolah Tujuan</option>
            ${tenants.map(t => `<option value="${t.tenant_id}">${t.nama_sekolah}</option>`).join('')}
          </select>
          <select id="studentTransferClass" class="swal2-input">
            <option value="">Pilih Kelas Tujuan</option>
          </select>
        `,
        showCancelButton: true,
        confirmButtonText: 'Mutasi',
        preConfirm: () => ({
            tenant_id: document.getElementById('studentTransferTenant').value,
            class_id: document.getElementById('studentTransferClass').value
        })
    }).then(async (result) => {
        if (result.isConfirmed && result.value.tenant_id) {
            try {
                const promises = selectedIds.map(id =>
                    fetch('/api/admin/students/' + id + '/transfer', {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + localStorage.getItem('token')
                        },
                        body: JSON.stringify(result.value)
                    })
                );
                await Promise.all(promises);
                Swal.fire('Berhasil', 'Siswa berhasil dipindahkan', 'success');
                loadStudents(currentStudentPage);
            } catch (error) {
                Swal.fire('Error', 'Gagal memindahkan siswa', 'error');
            }
        }
    });
}

window.loadTransferClasses = async function (tenantId) {
    const classSelect = document.getElementById('studentTransferClass');
    if (!tenantId) {
        classSelect.innerHTML = '<option value="">Pilih Kelas Tujuan</option>';
        return;
    }
    const res = await fetch('/api/admin/classes?tenant_id=' + tenantId, {
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });
    const data = await res.json();
    if (data.success) {
        classSelect.innerHTML = '<option value="">Pilih Kelas Tujuan</option>' + data.data.map(c => `<option value="${c.id}">${c.nama_kelas}</option>`).join('');
    }
}

window.showAddStudentModal = function () {
    Swal.fire({
        title: 'Tambah Siswa Baru',
        html: `
          <input id="sw_nis" class="swal2-input" placeholder="NIS" required>
          <input id="sw_nisn" class="swal2-input" placeholder="NISN">
          <input id="sw_nama" class="swal2-input" placeholder="Nama Siswa" required>
          <select id="sw_kelas" class="swal2-input"></select>
          <input id="sw_iuran" class="swal2-input" placeholder="Iuran Bulanan" type="number">
        `,
        didOpen: async () => {
            const res = await fetch('/api/admin/classes', {
                headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
            });
            const cls = await res.json();
            if (cls.success) {
                document.getElementById('sw_kelas').innerHTML = '<option value="">Pilih Kelas</option>' + cls.data.map(c => `<option value="${c.id}">${c.nama_kelas}</option>`).join('');
            }
        },
        preConfirm: () => {
            return {
                nis: document.getElementById('sw_nis').value,
                nisn: document.getElementById('sw_nisn').value,
                nama_siswa: document.getElementById('sw_nama').value,
                class_id: document.getElementById('sw_kelas').value,
                iuran_bulanan: document.getElementById('sw_iuran').value
            };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            const res = await fetch('/api/admin/students', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + localStorage.getItem('token')
                },
                body: JSON.stringify({ ...result.value, tenant_id: window.currentUser?.tenant_id })
            });
            const data = await res.json();
            if (data.success) {
                Swal.fire('Berhasil', 'Siswa berhasil ditambahkan', 'success');
                loadStudents();
            } else {
                Swal.fire('Error', data.message, 'error');
            }
        }
    });
};

// Student Filter Modal
window.showStudentFilterModal = function () {
    const currentTenantFilter = window.studentTenantFilterValue || '';
    const currentClassFilter = window.studentClassFilterValue || '';

    Swal.fire({
        title: 'Filter Siswa',
        html: `
       <div class="text-left space-y-3">
         <div>
           <label class="block text-sm font-medium text-gray-700 mb-1">Sekolah</label>
           <select id="filterTenant" class="swal2-input w-full">
             <option value="">Semua Sekolah</option>
           </select>
         </div>
         <div>
           <label class="block text-sm font-medium text-gray-700 mb-1">Kelas</label>
           <select id="filterClass" class="swal2-input w-full">
             <option value="">Semua Kelas</option>
           </select>
         </div>
       </div>
     `,
        didOpen: async () => {
            const tenantRes = await fetch('/api/admin/tenants', {
                headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
            });
            const tenantData = await tenantRes.json();
            if (tenantData.success) {
                document.getElementById('filterTenant').innerHTML += tenantData.data.map(t => `<option value="${t.tenant_id}" ${t.tenant_id === currentTenantFilter || t.tenant_id === window.currentUser?.tenant_id ? 'selected' : ''}>${t.nama_sekolah}</option>`).join('');
            }

            const loadFilteredClasses = async () => {
                const selectedTenantId = document.getElementById('filterTenant').value;
                const classRes = await fetch('/api/admin/classes' + (selectedTenantId ? '?tenant_id=' + selectedTenantId : ''), {
                    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
                });
                const classData = await classRes.json();
                if (classData.success) {
                    const classSelect = document.getElementById('filterClass');
                    classSelect.innerHTML = '<option value="">Semua Kelas</option>';
                    classData.data.forEach(c => {
                        const selected = c.id == currentClassFilter ? 'selected' : '';
                        classSelect.innerHTML += `<option value="${c.id}" ${selected}>${c.nama_kelas}</option>`;
                    });
                }
            };

            document.getElementById('filterTenant').addEventListener('change', loadFilteredClasses);
            await loadFilteredClasses();
        },
        showCancelButton: true,
        confirmButtonText: 'Terapkan Filter',
        cancelButtonText: 'Batal'
    }).then(async (result) => {
        if (result.isConfirmed) {
            window.studentTenantFilterValue = document.getElementById('filterTenant').value;
            window.studentClassFilterValue = document.getElementById('filterClass').value;
            loadStudents();
        }
    });
};

// Teacher Filter Modal
window.showTeacherFilterModal = function () {
    const currentTenantFilter = window.teacherTenantFilterValue || '';

    Swal.fire({
        title: 'Filter Guru',
        html: `
      <div class="text-left space-y-3">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Sekolah</label>
          <select id="teacherFilterTenant" class="swal2-input w-full">
            <option value="">Semua Sekolah</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Status Kepegawaian</label>
          <select id="teacherFilterStatus" class="swal2-input w-full">
            <option value="">Semua Status</option>
            <option value="PNS">PNS</option>
            <option value="Non-PNS">Non-PNS</option>
            <option value="Kontrak">Kontrak</option>
          </select>
        </div>
      </div>
            `,
        didOpen: async () => {
            const res = await fetch('/api/admin/tenants', {
                headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
            });
            const data = await res.json();
            if (data.success) {
                document.getElementById('teacherFilterTenant').innerHTML += data.data.map(t => `<option value="${t.tenant_id}">${t.nama_sekolah}</option>`).join('');
            }
        },
        showCancelButton: true,
        confirmButtonText: 'Terapkan Filter',
        cancelButtonText: 'Batal'
    }).then((result) => {
        if (result.isConfirmed) {
            window.teacherTenantFilterValue = document.getElementById('teacherFilterTenant').value;
            window.teacherStatusFilterValue = document.getElementById('teacherFilterStatus').value;
            fetchTeachers(1);
        }
    });
};

window.loadTeacherTenants = async function () {
    // Hidden tenant filter for teacher modal
};

// Make functions globally available for onclick attributes
window.showAddTeacherModal = showAddTeacherModal;
window.showAddRuleModal = showAddRuleModal;
window.refreshTenantLocations = refreshTenantLocations;
window.hideTeacherModal = hideTeacherModal;
window.hideRuleModal = hideRuleModal;
window.hideLocationModal = hideLocationModal;
window.editTeacher = editTeacher;
window.deleteTeacher = deleteTeacher;
window.toggleSelectAll = toggleSelectAll;
window.updateSelectAll = updateSelectAll;
window.deleteSelectedTeachers = deleteSelectedTeachers;
window.createUsersForSelected = createUsersForSelected;
window.createUser = createUser;
window.editRule = editRule;
window.deleteRule = deleteRule;
window.showSettingsTab = showSettingsTab;
window.showAccountModal = showAccountModal;
window.closeAccountModal = closeAccountModal;
window.toggleSelectAllNoAccount = toggleSelectAllNoAccount;
window.sendEmailToSelected = sendEmailToSelected;
window.loadAkunGuru = loadAkunGuru;
window.showAddTeacherModal = showAddTeacherModal;
window.hideTeacherModal = hideTeacherModal;
window.showAddRuleModal = showAddRuleModal;
window.hideRuleModal = hideRuleModal;
window.hideLocationModal = hideLocationModal;
window.deleteSelectedTeachers = deleteSelectedTeachers;
window.createUsersForSelected = createUsersForSelected;
window.refreshTenantLocations = refreshTenantLocations;

// Stub functions untuk fitur yang belum diimplementasi sepenuhnya
window.openWhatsAppMessenger = function () { };
window.showMutasiTeachersModal = function () { };
window.loadStudentPaymentSummary = function () { };
window.loadTenantLocations = function () { };
window.loadEmploymentRules = function () { };
window.createBackup = function () { };
window.restoreDatabase = function () { };
window.showSkGuruModal = function () {
    const modal = document.getElementById('skGuruModal');
    if (modal) { modal.classList.remove('hidden'); modal.classList.add('show'); }
};
window.hideSkGuruModal = function () {
    const modal = document.getElementById('skGuruModal');
    if (modal) { modal.classList.remove('show'); modal.classList.add('hidden'); }
};
window.previewSkGuru = function () { alert('Fitur preview SK Guru belum tersedia'); };
window.bulkGenerateSkGuru = function () { alert('Fitur bulk generate SK Guru belum tersedia'); };
window.hideSkPreviewModal = function () { alert('Fitur preview SK Guru belum tersedia'); };
window.confirmGenerateSk = function () { alert('Fitur generate SK belum tersedia'); };
window.saveSkAutomationSettings = function () { alert('Fitur pengaturan SK Automation belum tersedia'); };
window.refreshBankSettings = function () { };
window.loadBillSettings = function () { };
window.saveBillSettings = function () { alert('Fitur pengaturan iuran belum tersedia'); };
window.loadPaymentSettings = function () { };
window.savePaymentSettings = function () { alert('Fitur pengaturan payment belum tersedia'); };
window.testPaymentConnection = function () { alert('Fitur test payment belum tersedia'); };
window.generateMonthlyInvoices = function () { alert('Fitur generate invoice bulanan belum tersedia'); };
window.hideSalaryModal = function () { };
window.saveSalary = function () { alert('Fitur pengaturan gaji belum tersedia'); };
window.openBulkBillModal = function () { alert('Fitur bulk bill belum tersedia'); };
window.closeChangePasswordModal = function () { };
window.changePassword = function () { alert('Fitur change password belum tersedia'); };
window.closeStudentEditModal = function () { };
window.saveStudentEdit = function () { alert('Fitur edit siswa belum tersedia'); };

// Stub functions for admin dashboard (hanya fallback bila belum didefinisikan oleh halaman lain seperti school-admin.html)
// Student edit helpers (always available for the single Edit action)
{
  const studentAuthHdr = () => ({ 'Authorization': 'Bearer ' + (window.authToken || localStorage.getItem('token') || '') });

  async function populateStudentEditSelects(tenantId, classId) {
    const tSel = document.getElementById('editStudentTenant');
    const cSel = document.getElementById('editStudentClass');
    try {
      const tr = await fetch('/api/admin/tenants?limit=500', { headers: studentAuthHdr() }).then(r => r.json());
      if (tSel) tSel.innerHTML = (tr.data || []).map(t => `<option value="${t.tenant_id}" ${t.tenant_id === tenantId ? 'selected' : ''}>${t.nama_sekolah}</option>`).join('');
    } catch (e) { console.error(e); }
    try {
      const effectiveTenantId = tenantId || window.tenantId || (JSON.parse(localStorage.getItem('user') || '{}'))?.tenant_id || (JSON.parse(localStorage.getItem('user') || '{}'))?.assignments?.[0]?.tenant_id;
      const cr = await fetch('/api/admin/classes?limit=1000&tenant_id=' + (effectiveTenantId || ''), { headers: studentAuthHdr() }).then(r => r.json());
      if (cSel) cSel.innerHTML = '<option value="">-- Pilih Kelas --</option>' + (cr.data || []).map(c => `<option value="${c.id}" ${c.id === classId ? 'selected' : ''}>${c.tingkatan ? c.tingkatan + ' - ' : ''}${c.nama_kelas}</option>`).join('');
    } catch (e) { console.error(e); }
  }

  window.fetchClassesForTenant = async function (tenantId) {
    const cSel = document.getElementById('editStudentClass');
    if (!cSel || !tenantId) return;
    try {
      const cr = await fetch('/api/admin/classes?limit=1000&tenant_id=' + tenantId, { headers: studentAuthHdr() }).then(r => r.json());
      cSel.innerHTML = '<option value="">-- Pilih Kelas --</option>' + (cr.data || []).map(c => `<option value="${c.id}">${c.tingkatan ? c.tingkatan + ' - ' : ''}${c.nama_kelas}</option>`).join('');
    } catch (e) { console.error(e); }
  }

  window.editStudent = async function (id) {
    try {
      const res = await fetch('/api/admin/students/' + id, { headers: studentAuthHdr() });
      const data = await res.json();
      if (!data.success) { alert('Gagal memuat data siswa'); return; }
      const s = data.data;
      document.getElementById('editStudentId').value = s.id;
      document.getElementById('editStudentNama').value = s.nama_siswa || '';
      document.getElementById('editStudentNis').value = s.nis || '';
      document.getElementById('editStudentNisn').value = s.nisn || '';
      document.getElementById('editStudentJk').value = s.jenis_kelamin || '';
      document.getElementById('editStudentIuran').value = s.iuran_bulanan ?? 0;
      document.getElementById('editStudentParent').value = s.nama_orang_tua || '';
      document.getElementById('editStudentWa').value = s.no_wa_ortu || '';
      await populateStudentEditSelects(s.tenant_id, s.class_id);
      document.getElementById('studentEditModal').classList.add('show');
    } catch (e) { console.error(e); alert('Error memuat siswa'); }
  };

  window.saveStudentEdit = async function () {
    const id = document.getElementById('editStudentId').value;
    const payload = {
      tenant_id: document.getElementById('editStudentTenant').value,
      class_id: document.getElementById('editStudentClass').value || null,
      nama_siswa: document.getElementById('editStudentNama').value,
      nis: document.getElementById('editStudentNis').value,
      nisn: document.getElementById('editStudentNisn').value,
      jenis_kelamin: document.getElementById('editStudentJk').value,
      iuran_bulanan: parseFloat(document.getElementById('editStudentIuran').value) || 0,
      nama_orang_tua: document.getElementById('editStudentParent').value,
      no_wa: document.getElementById('editStudentWa').value
    };
    try {
      const res = await fetch('/api/admin/students/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...studentAuthHdr() },
        body: JSON.stringify(payload)
      });
      const d = await res.json();
      if (d.success) {
        document.getElementById('studentEditModal').classList.remove('show');
        window.loadStudents(1);
        alert('Data siswa berhasil disimpan');
      } else { alert(d.message || 'Gagal menyimpan'); }
    } catch (e) { console.error(e); alert('Error menyimpan'); }
  };

  window.closeStudentEditModal = function () {
    document.getElementById('studentEditModal')?.classList.remove('show');
  };

  // Student Mutasi Functions
  window.showStudentMutasiModal = async function (id, namaSiswa, oldSchool, oldTenant) {
    const modal = document.getElementById('studentMutasiModal');
    if (!modal) return;
    
    // If called from header button without args, get selected students
    if (!id) {
      const checked = Array.from(document.querySelectorAll('.student-checkbox:checked')).map(cb => cb.value);
      if (checked.length === 0) return;
      if (checked.length === 1) {
        id = checked[0];
      } else {
        openBulkMutasiModal(checked);
        return;
      }
    }
    
    document.getElementById('mutasiStudentId').value = id;
    document.getElementById('mutasiOldSchool').value = oldSchool || '-';
    document.getElementById('mutasiReason').value = '';
    
    const targetSel = document.getElementById('mutasiTarget');
    const tenantsRes = await fetch('/api/admin/tenants?limit=500', { headers: studentAuthHdr() });
    const tenantsData = await tenantsRes.json();
    const tenants = tenantsData.success ? tenantsData.data : [];
    targetSel.innerHTML = '<option value="">Pilih Sekolah Tujuan</option>' +
      tenants.filter(t => t.tenant_id !== oldTenant).map(t => `<option value="${t.tenant_id}">${t.nama_sekolah}</option>`).join('') +
      '<option value="other">Lainnya...</option>';
    
    document.getElementById('mutasiOtherInput').classList.add('hidden');
    modal.classList.add('show');
  };

  window.toggleMutasiOtherInput = function () {
    const target = document.getElementById('mutasiTarget').value;
    const otherInput = document.getElementById('mutasiOtherInput');
    otherInput.classList.toggle('hidden', target !== 'other');
  };

  // Checkbox handlers
  window.toggleSelectAllStudents = function () {
    const selectAll = document.getElementById('selectAllStudents');
    const checkboxes = document.querySelectorAll('.student-checkbox');
    checkboxes.forEach(cb => cb.checked = selectAll.checked);
    updateMutasiBtnState();
  };

  window.updateMutasiBtnState = function () {
    const checked = document.querySelectorAll('.student-checkbox:checked');
    const btn = document.getElementById('mutasiBtn');
    if (btn) btn.disabled = checked.length === 0;
  };

  window.closeStudentMutasiModal = function () {
    const modal = document.getElementById('studentMutasiModal');
    if (modal) modal.classList.remove('show');
  };

  // Bulk mutasi modal opener for admin-dashboard
  window.openBulkMutasiModal = async function (ids) {
    const modal = document.getElementById('studentMutasiModal');
    if (!modal) return;
    document.getElementById('mutasiStudentId').value = ids.join(',');
    document.getElementById('mutasiOldSchool').value = ids.length + ' siswa dipilih';
    document.getElementById('mutasiReason').value = '';

    const targetSel = document.getElementById('mutasiTarget');
    const tenantsRes = await fetch('/api/admin/tenants?limit=500', { headers: studentAuthHdr() });
    const tenantsData = await tenantsRes.json();
    const tenants = tenantsData.success ? tenantsData.data : [];
    targetSel.innerHTML = '<option value="">Pilih Sekolah Tujuan</option>' +
      tenants.map(t => `<option value="${t.tenant_id}">${t.nama_sekolah}</option>`).join('') +
      '<option value="other">Lainnya...</option>';

    document.getElementById('mutasiOtherInput').classList.add('hidden');
    modal.classList.add('show');
  };

  window.submitStudentMutasi = async function () {
    const idInput = document.getElementById('mutasiStudentId').value;
    const ids = idInput.includes(',') ? idInput.split(',').map(s => s.trim()) : [idInput];
    const targetTenant = document.getElementById('mutasiTarget').value;
    const otherSchoolName = document.getElementById('mutasiOtherSchoolName').value.trim();
    const reason = document.getElementById('mutasiReason').value.trim();

    if (!targetTenant) {
      if (typeof Swal !== 'undefined') {
        Swal.fire('Error', 'Pilih tujuan mutasi', 'error');
      } else {
        alert('Pilih tujuan mutasi');
      }
      return;
    }

    try {
      const promises = ids.map(sid =>
        fetch('/api/admin/students/' + sid + '/mutasi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...studentAuthHdr() },
          body: JSON.stringify({ target_tenant_id: targetTenant, target_tenant_name: otherSchoolName || null, reason })
        }).then(r => r.json())
      );
      const results = await Promise.all(promises);
      const success = results.filter(r => r.success).length;
      closeStudentMutasiModal();
      loadStudents(1);
      if (typeof Swal !== 'undefined') {
        showToast(`${success}/${ids.length} siswa berhasil dimutasi`, 'success');
      } else {
        console.log(`${success}/${ids.length} siswa berhasil dimutasi`);
      }
    } catch (e) {
      console.error('[BULK MUTASI]', e);
      if (typeof Swal !== 'undefined') {
        showToast('Terjadi kesalahan', 'error');
      }
    }
  };
}

if (typeof window.loadAttendanceLogs !== 'function') {
  window.loadAttendanceLogs = async function (page = 1) {
    try {
      const response = await fetch('/api/admin/attendance-logs?page=' + page + '&limit=50', {
        headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
      });

      if (checkAuth401403(response)) return;

      const res = await response.json();

      if (res.success) {
        const tbody = document.getElementById('attendanceTable');
        const items = res.data || [];
        if (!tbody) return;

        if (items.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-4 text-center text-gray-500">Tidak ada log absensi hari ini</td></tr>';
          return;
        }

        tbody.innerHTML = items.map(log => `
          <tr class="hover:bg-gray-50">
            <td class="px-6 py-4 text-sm text-gray-900 font-medium">${log.nama_guru || log.teacher_id || '-'}</td>
            <td class="px-6 py-4 text-sm text-gray-500">${log.nip || '-'}</td>
            <td class="px-6 py-4 text-sm text-gray-500 capitalize">${log.jenis || '-'}</td>
            <td class="px-6 py-4 text-sm text-gray-500">
              ${log.waktu_scan ? new Date(log.waktu_scan).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-'} WITA
            </td>
            <td class="px-6 py-4 text-sm">
              <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium 
                ${log.status === 'tepat_waktu' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                ${log.status ? log.status.replace('_', ' ') : '-'}
              </span>
            </td>
            <td class="px-6 py-4 text-sm text-gray-500 capitalize">${log.metode || '-'}</td>
          </tr>
        `).join('');
      }
    } catch (error) {
      console.error('Gagal memuat log absensi:', error);
    }
  };
}

// ===== Attendance Monthly Recap =====
window.switchAttendanceView = function(view) {
    const logSection = document.getElementById('logViewSection');
    const monthlySection = document.getElementById('monthlyRecapSection');
    const logBtn = document.getElementById('logViewBtn');
    const monthlyBtn = document.getElementById('monthlyViewBtn');
    if (logSection) logSection.classList.toggle('hidden', view === 'monthly');
    if (monthlySection) monthlySection.classList.toggle('hidden', view !== 'monthly');
    if (logBtn) { logBtn.classList.toggle('bg-blue-600', view === 'log'); logBtn.classList.toggle('text-white', view === 'log'); }
    if (monthlyBtn) { monthlyBtn.classList.toggle('bg-blue-600', view === 'monthly'); monthlyBtn.classList.toggle('text-white', view === 'monthly'); }
};

window.loadMonthlyRecap = async function() {
    const monthNames = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const tenantId = document.getElementById('recapTenantSelect')?.value;
    const month = document.getElementById('recapMonthSelect')?.value;
    const year = document.getElementById('recapYearSelect')?.value;
    const content = document.getElementById('monthlyRecapContent');
    if (!tenantId || !month || !year) { showToast('Pilih sekolah, bulan, dan tahun', 'error'); return; }
    if (content) content.innerHTML = '<p class="text-center py-8"><i class="fas fa-spinner fa-spin"></i> Memuat...</p>';
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/admin/attendance-monthly?tenant_id=' + tenantId + '&bulan=' + month + '&tahun=' + year, {
            headers: token ? { 'Authorization': 'Bearer ' + token } : {}
        });
        const json = await res.json();
        if (!json.success) { showToast('Gagal memuat data', 'error'); return; }
        const data = json.data;
        const daysInMonth = json.daysInMonth || 30;
        const weekendDays = data.length ? data[0].weekendDays || [] : [];
        let headerHtml = '<tr><th rowspan="2" class="p-1 border border-gray-300">No</th><th rowspan="2" class="p-1 border border-gray-300">Nama</th>';
        for (let d = 1; d <= daysInMonth; d++) headerHtml += '<th class="p-1 border border-gray-300">' + d + '</th>';
        headerHtml += '<th colspan="7" class="p-1 border border-gray-300">Keterangan</th></tr><tr>';
        for (let d = 1; d <= daysInMonth; d++) headerHtml += '<th class="p-1 border border-gray-300"></th>';
        headerHtml += '<th class="p-1 border border-gray-300">Tepat Waktu</th><th class="p-1 border border-gray-300">Terlambat</th><th class="p-1 border border-gray-300">Izin</th><th class="p-1 border border-gray-300">Sakit</th><th class="p-1 border border-gray-300">Dinas Luar</th><th class="p-1 border border-gray-300">Cuti</th><th class="p-1 border border-gray-300">Tanpa Keterangan</th></tr>';
        let bodyHtml = '';
        data.forEach((d, i) => {
            const rowClass = i % 2 === 0 ? 'bg-white' : 'bg-slate-50';
            bodyHtml += '<tr class="' + rowClass + '"><td class="p-1 text-center border border-gray-300">' + (i + 1) + '</td><td class="p-1 border border-gray-300" style="min-width:120px;">' + (d.nama || '') + '</td>';
            for (let day = 1; day <= daysInMonth; day++) {
                const isWeekend = weekendDays.includes(day);
                bodyHtml += '<td class="p-1 text-center border border-gray-300 ' + (isWeekend ? 'bg-gray-100' : '') + '">' + (d['tgl_' + day] || '') + '</td>';
            }
            bodyHtml += '<td class="p-1 text-center border border-gray-300">' + (d.hadir || 0) + '</td><td class="p-1 text-center border border-gray-300">' + (d.terlambat || 0) + '</td><td class="p-1 text-center border border-gray-300">' + (d.izin || 0) + '</td><td class="p-1 text-center border border-gray-300">' + (d.sakit || 0) + '</td><td class="p-1 text-center border border-gray-300">' + (d.dinas_luar || 0) + '</td><td class="p-1 text-center border border-gray-300">' + (d.cuti || 0) + '</td><td class="p-1 text-center border border-gray-300">' + (d.tanpa_keterangan || 0) + '</td></tr>';
        });
        if (content) content.innerHTML = '<div class="overflow-x-auto"><table class="w-full text-sm border-collapse border border-gray-300"><thead class="bg-slate-100">' + headerHtml + '</thead><tbody>' + bodyHtml + '</tbody></table></div>';
    } catch (e) {
        if (content) content.innerHTML = '<p class="text-red-500 p-4">Error: ' + e.message + '</p>';
    }
};

window.exportMonthlyPdfFromRecap = function() {
    const tenantId = document.getElementById('recapTenantSelect')?.value;
    const month = document.getElementById('recapMonthSelect')?.value;
    const year = document.getElementById('recapYearSelect')?.value;
    const monthNames = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const tenantName = document.getElementById('recapTenantSelect')?.selectedOptions[0]?.text || '';
    let signatory = 'Pimpinan';
    if (tenantId === 'YPWILUTIM') signatory = 'Ketua';
    else if (['PPTQMALILI', 'PPTQAMALIA'].includes(tenantId)) signatory = 'Pimpinan Pondok';
    else if (tenantId.includes('TKIT') || tenantId.includes('SDIT') || tenantId.includes('SMPIT') || tenantId.includes('SMAIT')) signatory = 'Kepala Sekolah';
    const content = document.getElementById('monthlyRecapContent');
    const table = content?.querySelector('table');
    if (!table) { showToast('Data belum dimuat', 'error'); return; }
    const thead = table.querySelector('thead');
    const theadHtml = thead ? thead.innerHTML : '';
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const perPage = 25;
    let pages = [];
    for (let i = 0; i < rows.length; i += perPage) {
        const pageRows = rows.slice(i, i + perPage);
        let pageTable = '<table style="width:100%;border-collapse:collapse;font-size:7pt"><thead>' + theadHtml + '</thead><tbody>';
        pageRows.forEach(r => pageTable += r.outerHTML);
        pageTable += '</tbody></table>';
        if (i === 0) {
            pages.push('<div style="text-align:center;margin-bottom:10px"><img src="/assets/images/header-yayasan-landscape.png" style="max-width:100%;height:auto"></div><h2 style="text-align:center;margin:5px 0">Rekap Absensi Bulanan</h2><p style="text-align:center;margin:5px 0">Sekolah: ' + tenantName + ' | Periode: ' + monthNames[parseInt(month)] + ' ' + year + '</p>' + pageTable);
        } else {
            pages.push('<div style="page-break-before:always"></div><p style="text-align:center">Lanjutan Rekap Absensi</p>' + pageTable);
        }
    }
    const win = window.open('', '_blank');
    win.document.write('<!DOCTYPE html><html><head><title>Rekap Absensi Bulanan</title><style>@page{size:A4 landscape;margin:1cm}body{font-family:Arial,sans-serif;font-size:8pt}table{width:100%;border-collapse:collapse}th,td{border:1px solid #000;padding:2px;text-align:center;font-size:7pt}th{background:#f0f0f0}.sign{margin-top:20px;text-align:right}.sign .line{border-top:1px solid #000;width:120px;margin-left:auto;margin-bottom:5px}</style></head><body>' + pages.join('') + '<div class="sign"><p>' + signatory + ',</p><div class="line"></div><p>________________________</p></div><script>window.onload=function(){window.print();}</script></body></html>');
    win.document.close();
};

window.exportMonthlyExcel = function() {
    const tenantId = document.getElementById('recapTenantSelect')?.value;
    const month = document.getElementById('recapMonthSelect')?.value;
    const year = document.getElementById('recapYearSelect')?.value;
    const monthNames = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const tenantName = document.getElementById('recapTenantSelect')?.selectedOptions[0]?.text || '';
    const content = document.getElementById('monthlyRecapContent');
    const rows = content?.querySelectorAll('tbody tr') || [];
    let html = '<table border="1" cellspacing="0" cellpadding="4"><tr><th colspan="10">' + tenantName + ' - ' + monthNames[parseInt(month)] + ' ' + year + '</th></tr><tr><th>No</th><th>Nama</th><th>Tanggal</th><th>Tepat Waktu</th><th>Terlambat</th><th>Izin</th><th>Sakit</th><th>Dinas Luar</th><th>Cuti</th><th>Tanpa Keterangan</th></tr><tbody>';
    rows.forEach((r, i) => {
        const cells = r.querySelectorAll('td');
        html += '<tr><td>' + (i + 1) + '</td><td>' + (cells[1]?.textContent || '') + '</td><td>' + monthNames[parseInt(month)] + ' ' + year + '</td><td>' + (cells[3]?.textContent || 0) + '</td><td>' + (cells[4]?.textContent || 0) + '</td><td>' + (cells[5]?.textContent || 0) + '</td><td>' + (cells[6]?.textContent || 0) + '</td><td>' + (cells[7]?.textContent || 0) + '</td><td>' + (cells[8]?.textContent || 0) + '</td><td>' + (cells[9]?.textContent || 0) + '</td></tr>';
    });
    html += '</tbody></table>';
    const blob = new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'rekap_absensi_' + tenantId + '_' + year + String(month).padStart(2, '0') + '.xls';
    a.click();
    URL.revokeObjectURL(url);
};

window.loadTenantFilters = async function() {
    const tenantSelect = document.getElementById('recapTenantSelect');
    const yearSelect = document.getElementById('recapYearSelect');
    if (tenantSelect && tenantSelect.options.length <= 1) tenantSelect.innerHTML = '<option value="">Memuat...</option>';
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/admin/tenants', { headers: token ? { 'Authorization': 'Bearer ' + token } : {} });
        const json = await res.json();
        const opts = (json.data || []).map(t => '<option value="' + t.tenant_id + '">' + t.nama_sekolah + '</option>').join('');
        if (tenantSelect) tenantSelect.innerHTML = '<option value="">Pilih Sekolah...</option>' + opts;
        if (yearSelect && yearSelect.options.length <= 1) {
            const curYear = new Date().getFullYear();
            for (let y = curYear - 2; y <= curYear + 1; y++) {
                const o = document.createElement('option'); o.value = y; o.textContent = y;
                if (y === curYear) o.selected = true;
                yearSelect.appendChild(o);
            }
        }
    } catch (e) {
        if (tenantSelect) tenantSelect.innerHTML = '<option value="">Gagal memuat</option>';
    }
};

async function showAccountModal() {
    const modal = document.getElementById('accountModal');
    if (!modal) return;
    modal.classList.add('show');
    await loadNoAccountTeachers();
}

function closeAccountModal() {
    const modal = document.getElementById('accountModal');
    if (modal) {
        modal.classList.remove('show');
    }
}

async function loadNoAccountTeachers() {
    const tbody = document.getElementById('noAccountTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-500"><i class="fas fa-spinner fa-spin"></i> Memuat data...</td></tr>';

    try {
        const response = await fetch('/api/admin/teacher-account-summary', {
            headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
        });

        if (response.status === 401 || response.status === 403) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-gray-500">Akses ditolak</td></tr>';
            return;
        }

        const data = await response.json();

        if (data.success && data.data && data.data.length > 0) {
            tbody.innerHTML = data.data.map(teacher => `
                <tr class="hover:bg-gray-50">
                    <td class="px-4 py-3">
                        <input type="checkbox" class="no-account-checkbox" value="${teacher.id}">
                    </td>
                    <td class="px-4 py-3 text-sm text-gray-900">${teacher.nama || '-'}</td>
                    <td class="px-4 py-3 text-sm text-gray-500">${teacher.nik || '-'}</td>
                    <td class="px-4 py-3 text-sm text-gray-500">${teacher.nip || '-'}</td>
                    <td class="px-4 py-3 text-sm text-gray-500">${teacher.email || '-'}</td>
                    <td class="px-4 py-3 text-sm text-gray-500">${teacher.no_wa || '-'}</td>
                    <td class="px-4 py-3 text-sm text-gray-500">${teacher.assignments && teacher.assignments.length > 0 ? teacher.assignments.map(a => a.nama_sekolah || a.tenant_id).join(', ') : '-'}</td>
                    <td class="px-4 py-3 text-sm">
                        <button onclick="createUser(${teacher.id})" class="text-green-600 hover:text-green-800" title="Buat Akun">
                            <i class="fas fa-user-plus"></i>
                        </button>
                    </td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-gray-500">Semua guru sudah memiliki akun</td></tr>';
        }
    } catch (error) {
        console.error('Error loading no account teachers:', error);
        tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-red-500">Error memuat data</td></tr>';
    }
}

function toggleSelectAllNoAccount() {
    const selectAll = document.getElementById('selectAllNoAccount');
    const checkboxes = document.querySelectorAll('.no-account-checkbox');
    checkboxes.forEach(cb => cb.checked = selectAll.checked);
}

async function sendEmailToSelected() {
    const checkboxes = document.querySelectorAll('.no-account-checkbox:checked');
    const teacherIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

    if (teacherIds.length === 0) {
        alert('Pilih minimal satu guru untuk dikirim email');
        return;
    }

    const customMessage = prompt('Masukkan pesan email (opsional):', 'Akun sistem absensi Anda belum dibuat. Silakan hubungi admin untuk mengaktivasi akun Anda.');
    if (customMessage === null) return;

    try {
        const response = await fetch('/api/admin/send-email-no-account', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}`
            },
            body: JSON.stringify({ teacher_ids: teacherIds, message: customMessage })
        });

        const result = await response.json();

        if (result.success) {
            alert(result.message);
            loadNoAccountTeachers();
        } else {
            alert('Error: ' + result.message);
        }
    } catch (error) {
        console.error('Send email error:', error);
        alert('Terjadi kesalahan');
    }
}

async function loadAkunGuru() {
    try {
        const response = await fetch('/api/admin/summary', {
            headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            return;
        }

        const res = await response.json();

        if (res.success) {
            const d = res.data;
            const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
            el('akunTotalGuru', d.totalTeachers ?? 0);
            el('akunPunyaAkun', d.teachersWithAccount ?? 0);
            el('akunBelumAkun', d.teachersWithoutAccount ?? 0);
        }
    } catch (error) {
        console.error('Error loading akun guru summary:', error);
    }

    await loadNoAccountTeachers();
}

// Global exports for onclick handlers
window.editTenantLocation = editTenantLocation;
window.autoDetectLocationModal = autoDetectLocationModal;
window.toggleMap = function () {
    const mapContainer = document.getElementById('mapContainer');
    if (mapContainer) mapContainer.classList.toggle('hidden');
};
window.centerMapOnCurrent = function () { };
window.clearMapMarker = function () { };
window.updateMiniMap = function () { };
window.updateLocationMap = function () { };
window.updateCoordinatePreview = updateCoordinatePreview;
window.copyCoordinates = function () {
    const lat = document.getElementById('latitudeInput')?.value;
    const lng = document.getElementById('longitudeInput')?.value;
    if (lat && lng) navigator.clipboard.writeText(`${lat}, ${lng}`);
};
window.copyCoordinatesModal = function () {
    const lat = document.getElementById('locationLat')?.value;
    const lng = document.getElementById('locationLng')?.value;
    if (lat && lng) navigator.clipboard.writeText(`${lat}, ${lng}`);
};
window.goToPage = goToPage;
window.prevPage = prevPage;
window.nextPage = nextPage;
window.hideTenantLocationModal = function () {
    const modal = document.getElementById('tenantLocationModal');
    if (modal) modal.classList.add('hidden');
};
window.hideAddDeviceModal = function () {
    const modal = document.getElementById('addDeviceModal');
    if (modal) { modal.classList.remove('show'); modal.classList.add('hidden'); }
};
window.hideAddTenantModal = function () {
    const modal = document.getElementById('addTenantModal');
    if (modal) modal.classList.add('hidden');
};
window.selectTeacher = function (id) { };
window.editDevice = function (id) { };
window.changeDeviceStatus = function (id, status) { };
window.deleteDevice = function (id) { };
window.showAddLocationModal = function () { };
window.toggleLocationStatus = function (id) { };
window.deleteTenantLocation = function (id) { };