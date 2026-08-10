//  < !--Quran Reader Integration-- >
// Quran Reader Widget Functionality
const QURAN_STORAGE_KEY_PAGE = 'quranCurrentPage';
const QURAN_STORAGE_KEY_KHATAM = 'quranKhatam';
const TOTAL_PAGES = 604;

// Update Quran widget UI
function updateQuranWidget() {
    const quranPageTextEl = document.getElementById('quranPageText');
    const quranProgressBarEl = document.getElementById('quranProgressBar');
    const quranKhatamTextEl = document.getElementById('quranKhatamText');

    if (!quranPageTextEl || !quranProgressBarEl || !quranKhatamTextEl) return;

    // Prefer legacy key 'quranPage' if present, otherwise use existing key
    const pageFromLegacy = localStorage.getItem('quranPage');
    const pageFromKey = localStorage.getItem(QURAN_STORAGE_KEY_PAGE);
    const currentPage = parseInt(pageFromLegacy || pageFromKey) || 1;
    // khatam can be stored under different keys. Prefer quranKhatam, fallback to khatamCount or any key starting with 'khatamCount'
    let totalKhatam = parseInt(localStorage.getItem(QURAN_STORAGE_KEY_KHATAM));
    if (isNaN(totalKhatam)) {
        const fallback = localStorage.getItem('khatamCount');
        totalKhatam = parseInt(fallback);
    }
    if (isNaN(totalKhatam)) {
        // search for keys starting with khatamCount
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('khatamCount')) {
                const v = parseInt(localStorage.getItem(k));
                if (!isNaN(v)) { totalKhatam = v; break; }
            }
        }
    }
    totalKhatam = isNaN(totalKhatam) ? 0 : totalKhatam;

    quranPageTextEl.textContent = `Halaman ${currentPage}/${TOTAL_PAGES}`;

    const progressPercent = ((currentPage - 1) / (TOTAL_PAGES - 1)) * 100;
    quranProgressBarEl.style.width = `${progressPercent}%`;

    quranKhatamTextEl.textContent = `Khatam: ${totalKhatam}`;
}

// Handle read button click / card click
function handleQuranRead() {
    window.open('quran-reader.html', '_blank');
}

// Initialize Quran widget
function initQuranWidget() {
    updateQuranWidget();

    // Listen for storage changes (when quran-reader.html updates localStorage)
    window.addEventListener('storage', function (e) {
        if (e.key === QURAN_STORAGE_KEY_PAGE || e.key === QURAN_STORAGE_KEY_KHATAM || e.key === 'quranPage') {
            updateQuranWidget();
        }
    });

    // Add click listener to read button
    const quranReadBtnEl = document.getElementById('quranReadBtn');
    if (quranReadBtnEl) {
        quranReadBtnEl.addEventListener('click', handleQuranRead);
    }

    // Make the whole widget clickable to open reader
    const quranWidgetEl = document.getElementById('quranWidget');
    if (quranWidgetEl) {
        quranWidgetEl.style.cursor = 'pointer';
        quranWidgetEl.addEventListener('click', function (e) {
            // Prevent double handling when clicking the read button itself
            if (e.target && (e.target.id === 'quranReadBtn' || e.target.closest && e.target.closest('#quranReadBtn'))) return;
            handleQuranRead();
        });
    }
}

// Avatar utility functions - defined early so they can be used in HTML
function showAvatarFallback(show) {
    const fallback = document.getElementById('avatarFallback');
    const img = document.getElementById('userPhoto');

    if (show) {
        fallback.classList.add('show');
        img.style.display = 'none';
    } else {
        fallback.classList.remove('show');
        img.style.display = 'block';
    }
}

function showFallbackAvatar(img) {
    console.log('Image failed to load, showing fallback');
    showAvatarFallback(true);
}

function showUserPhoto() {
    console.log('Image loaded successfully, hiding fallback');
    const fallback = document.getElementById('avatarFallback');
    const img = document.getElementById('userPhoto');
    fallback.classList.remove('show');
    img.style.display = 'block';
}

// JAVASCRIPT UX CONTROLLER
const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || '{}');
window.token = token;
window.userRole = (parseJwt(token) || {}).role || user.role || null;

if (!token) {
    window.location.href = 'login.html';
}

// Decode JWT token and extract payload
function parseJwt(token) {
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

// Check if JWT token is expired (proactive check)
function isTokenExpired(token) {
    if (!token) return true;
    const payload = parseJwt(token);
    if (!payload || !payload.exp) return true;
    const now = Math.floor(Date.now() / 1000);
    return payload.exp < now;
}

// Proactive logout helper
function forceLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.replace('login.html');
}

// Global fetch wrapper: proactive token expiry check + auto-logout on 401 (only for expired tokens)
(function () {
    const _fetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
        const currentToken = localStorage.getItem('token');
        if (!currentToken || isTokenExpired(currentToken)) {
            forceLogout();
            return new Response(null, { status: 401, statusText: 'Token expired' });
        }
        try {
            const res = await _fetch(input, init);
            // Only logout on 401 (unauthorized), not on 403 (forbidden) to allow error handling
            if (res && res.status === 401) {
                forceLogout();
            }
            return res;
        } catch (err) {
            throw err;
        }
    };
})();


async function setTeacherInfo() {
    try {
        const response = await fetch('/api/teacher/info', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        // 1. Ambil elemen dengan aman
        const teacherNameEl = document.getElementById('teacherName');
        const teacherDetailsEl = document.getElementById('teacherDetails');
        const userPhotoElement = document.getElementById('userPhoto');
        const adminSection = document.getElementById('adminNavSection');

        if (data.success) {
            const teacher = data.teacher;
            const assignments = data.assignments;

            if (teacherNameEl) teacherNameEl.textContent = teacher.nama || user.username || 'Guru';

            const schoolNames = assignments.map(a => a.nama_sekolah || a.tenant_id).join(', ');
            if (teacherDetailsEl) teacherDetailsEl.textContent = `Unit Sekolah: ${schoolNames || 'Tidak ada'}`;

            // Always set userAssignments so geofencing works for all roles
            window.userAssignments = assignments;

            // Set foto dengan pengecekan elemen
            if (userPhotoElement) {
                if (teacher.link_foto && teacher.link_foto.trim() !== '' && teacher.link_foto !== 'null') {
                    userPhotoElement.src = teacher.link_foto;
                    userPhotoElement.onload = showUserPhoto;
                    userPhotoElement.onerror = showFallbackAvatar;
                } else {
                    userPhotoElement.src = '';
                    showFallbackAvatar();
                }
            }

            // 2. Cek apakah adminSection ada sebelum manipulasi
            if (adminSection) {
                adminSection.classList.remove('hidden');
                let htmlContent = '';

                // --- Logika Ketua Yayasan ---
                const ketuaYayasan = assignments.find(a => {
                    const jabatan = (a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, '');
                    return jabatan.includes('ketua') && jabatan.includes('yayasan');
                });
                if (ketuaYayasan) {
                    htmlContent += '<a href="master-dashboard.html" style="display:inline-flex;align-items:center;gap:0.4rem;padding:0.3rem 0.75rem;background:#7c3aed;color:white;border-radius:0.5rem;font-size:0.8rem;font-weight:600;text-decoration:none;"><span class="fas fa-crown mr-1"></span> Dashboard Yayasan</a>';
                }

                // --- Logika Admin Sekolah (admin/operator/media/tu/tata usaha) ---
                const adminRoles = ['admin', 'operator', 'media', 'tu', 'tatausaha', 'tatausaha'];
                const adminUnits = assignments.filter(a => {
                    const jabatan = (a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, '');
                    return adminRoles.some(role => jabatan.includes(role));
                });

                if (adminUnits.length > 0) {
                    htmlContent += `<button onclick="showAdminUnitModal.call(null, window.userAssignments ? window.userAssignments.filter(a => ['admin','operator','media','tu','tatausaha'].some(r => (a.jabatan_di_unit||'').toLowerCase().replace(/\\s/g,'').includes(r))) : [])" style="display:inline-flex;align-items:center;gap:0.4rem;padding:0.3rem 0.75rem;background:#059669;color:white;border-radius:0.5rem;font-size:0.8rem;font-weight:600;border:none;cursor:pointer;"><span class="fas fa-user-cog mr-1"></span> Admin Unit</button>`;
                }

                if (canApproveIzin(assignments)) {
                    htmlContent += `<button onclick="openApprovalIzinModal()" style="display:inline-flex;align-items:center;gap:0.4rem;padding:0.3rem 0.75rem;background:#7c3aed;color:white;border-radius:0.5rem;font-size:0.8rem;font-weight:600;border:none;cursor:pointer;"><span class="fas fa-user-check mr-1"></span> Approval Izin</button>`;
                }

                adminSection.innerHTML = htmlContent;
            }
        }
    } catch (error) {
        console.error('Error loading teacher info:', error);
    }
}

// ============================================================
// PAKTA INTEGRITAS - Modal & akses khusus pimpinan unit
// ============================================================
const PAKTA_SIGNER_JABATANS = ['kepalasekolah', 'pimpinan', 'pimpinanpondok', 'ketua'];
const PAKTA_VIEWER_TENANT = 'YPWILUTIM';
const PAKTA_VIEWER_JABATANS = ['admin', 'ketua'];

function isPaktaSigner(assignments) {
    return (assignments || []).some(a =>
        PAKTA_SIGNER_JABATANS.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''))
    );
}

function isPaktaViewer(assignments) {
    return (assignments || []).some(a =>
        a.tenant_id === PAKTA_VIEWER_TENANT &&
        PAKTA_VIEWER_JABATANS.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''))
    );
}

function openPaktaModal() {
    const m = document.getElementById('paktaIntegritasModal');
    if (m) m.style.display = 'flex';
}

function closePaktaModal() {
    const m = document.getElementById('paktaIntegritasModal');
    if (m) m.style.display = 'none';
}

function goToPaktaSign() {
    window.location.href = 'pakta-sign.html';
}

// ============================================================
// APPROVAL PERIZINAN (admin / ketua / kepala unit)
// ============================================================
const IZIN_LABEL = { izin: 'Izin', sakit: 'Sakit', cuti: 'Cuti', dinas_luar: 'Dinas Luar' };
const STATUS_LABEL = { pending: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak' };
const STATUS_COLOR = { pending: '#d97706', approved: '#15803d', rejected: '#dc2626' };

function openApprovalIzinModal() {
    const m = document.getElementById('approvalIzinModal');
    if (m) m.style.display = 'flex';
    loadApprovalIzin();
}

function closeApprovalIzinModal() {
    const m = document.getElementById('approvalIzinModal');
    if (m) m.style.display = 'none';
}

let selectedApprovalIds = new Set();

function updateApprovalBulkBar() {
    const bar = document.getElementById('approvalBulkBar');
    const count = document.getElementById('approvalSelectedCount');
    if (!bar) return;
    const n = selectedApprovalIds.size;
    if (count) count.textContent = n;
    bar.style.display = n > 0 ? 'block' : 'none';
    const selectAll = document.getElementById('approvalSelectAll');
    const checkboxes = document.querySelectorAll('.approval-check');
    if (selectAll) {
        selectAll.checked = checkboxes.length > 0 && [...checkboxes].every(c => c.checked);
        selectAll.indeterminate = checkboxes.length > 0 && [...checkboxes].some(c => c.checked) && !selectAll.checked;
    }
}

function toggleApprovalSelection(id, checked) {
    if (checked) selectedApprovalIds.add(id);
    else selectedApprovalIds.delete(id);
    updateApprovalBulkBar();
}

function toggleApprovalSelectAll(checked) {
    document.querySelectorAll('.approval-check').forEach(c => {
        c.checked = checked;
        const id = parseInt(c.value, 10);
        if (checked) selectedApprovalIds.add(id);
        else selectedApprovalIds.delete(id);
    });
    updateApprovalBulkBar();
}

function clearApprovalSelection() {
    selectedApprovalIds.clear();
    document.querySelectorAll('.approval-check').forEach(c => { c.checked = false; });
    updateApprovalBulkBar();
}

async function loadApprovalIzin() {
    const listEl = document.getElementById('approvalIzinList');
    const subtitleEl = document.getElementById('approvalIzinSubtitle');
    if (!listEl) return;

    clearApprovalSelection();

    const filter = document.getElementById('approvalIzinFilter')?.value || 'pending';
    const assignments = window.userAssignments || [];
    const tenantFilter = getApprovalTenantFilter(assignments);
    const principalOnly = isKetuaYPWILUTIM(assignments);

    if (subtitleEl) {
        const scope = !tenantFilter ? 'Semua unit sekolah'
            : 'Unit: ' + assignments.filter(a => tenantFilter.includes(a.tenant_id)).map(a => a.nama_sekolah || a.tenant_id).join(', ');
        const base = tenantFilter ? `Data perizinan ${scope}` : 'Data perizinan seluruh unit';
        subtitleEl.textContent = principalOnly ? `${base} (hanya izin kepala sekolah)` : base;
    }

    listEl.innerHTML = '<div style="padding:2rem 0;text-align:center;color:#94a3b8;font-size:0.9rem;"><i class="fas fa-spinner spinner" style="font-size:1.25rem;margin-bottom:0.5rem;display:inline-block;"></i><p style="margin:0;">Memuat data perizinan...</p></div>';

    try {
        const params = new URLSearchParams();
        params.set('status', filter);
        if (tenantFilter) tenantFilter.forEach(t => params.append('tenant_id', t));
        if (principalOnly) params.set('principal_only', '1');

        const response = await fetch(`/api/admin/leave-requests?${params.toString()}`, {
            headers: { 'Authorization': 'Bearer ' + (window.token || localStorage.getItem('token')) }
        });
        const result = await response.json();

        if (!response.ok || !result.success) {
            listEl.innerHTML = `<div style="padding:2rem 0;text-align:center;color:#dc2626;font-size:0.9rem;">${result.message || 'Gagal memuat data'}</div>`;
            return;
        }

        const data = result.data || [];
        if (data.length === 0) {
            listEl.innerHTML = '<div style="padding:2rem 0;text-align:center;color:#94a3b8;font-size:0.9rem;">Tidak ada pengajuan izin pada filter ini.</div>';
            return;
        }

        const hasPending = data.some(r => (r.status || 'pending') === 'pending');
        const selectAllHtml = hasPending
            ? `<div style="display:flex;align-items:center;gap:0.5rem;padding:0 0.25rem 0.5rem;border-bottom:1px solid #f1f5f9;margin-bottom:0.5rem;">
                 <input type="checkbox" id="approvalSelectAll" onchange="toggleApprovalSelectAll(this.checked)" style="width:1.1rem;height:1.1rem;accent-color:#7c3aed;cursor:pointer;">
                 <label for="approvalSelectAll" style="font-size:0.82rem;font-weight:600;color:#475569;cursor:pointer;">Pilih Semua (yang menunggu)</label>
               </div>`
            : '';

        listEl.innerHTML = selectAllHtml + data.map(r => {
            const jenis = IZIN_LABEL[r.jenis] || r.jenis || '-';
            const status = r.status || 'pending';
            const tglMulai = r.tanggal_mulai ? new Date(r.tanggal_mulai).toLocaleDateString('id-ID') : '-';
            const tglSelesai = r.tanggal_selesai ? new Date(r.tanggal_selesai).toLocaleDateString('id-ID') : '-';
            const created = r.created_at ? new Date(r.created_at).toLocaleString('id-ID') : '-';
            const isPending = status === 'pending';

            const checkboxHtml = isPending
                ? `<input type="checkbox" class="approval-check" value="${r.id}" onchange="toggleApprovalSelection(${r.id}, this.checked)" style="width:1.25rem;height:1.25rem;accent-color:#7c3aed;cursor:pointer;flex-shrink:0;margin-top:0.15rem;">`
                : `<div style="width:1.25rem;flex-shrink:0;"></div>`;

            const actions = isPending
                ? `<div style="display:flex;gap:0.5rem;margin-top:0.75rem;">
                     <button onclick="processApprovalIzin(${r.id}, 'approved')" style="flex:1;padding:0.5rem;border-radius:0.5rem;border:none;background:#16a34a;color:white;font-weight:600;font-size:0.8rem;cursor:pointer;"><i class="fas fa-check"></i> Setujui</button>
                     <button onclick="processApprovalIzin(${r.id}, 'rejected')" style="flex:1;padding:0.5rem;border-radius:0.5rem;border:none;background:#dc2626;color:white;font-weight:600;font-size:0.8rem;cursor:pointer;"><i class="fas fa-times"></i> Tolak</button>
                   </div>`
                : `<div style="margin-top:0.75rem;font-size:0.8rem;color:#64748b;">${r.catatan ? 'Catatan: ' + escapeHtml(r.catatan) : 'Tidak ada catatan'}</div>`;

            return `
            <div style="border:1px solid #e2e8f0;border-radius:0.75rem;padding:1rem;margin-bottom:0.75rem;background:#fff;display:flex;gap:0.75rem;">
                ${checkboxHtml}
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;">
                        <div style="min-width:0;">
                            <div style="font-weight:700;color:#0f172a;font-size:0.95rem;">${escapeHtml(r.teacher_name || '-')}</div>
                            <div style="font-size:0.78rem;color:#64748b;margin-top:0.15rem;">${escapeHtml(r.nama_sekolah || r.tenant_id || '-')}</div>
                        </div>
                        <span style="flex-shrink:0;padding:0.25rem 0.6rem;border-radius:999px;font-size:0.72rem;font-weight:700;background:${STATUS_COLOR[status]}1a;color:${STATUS_COLOR[status]};">${STATUS_LABEL[status]}</span>
                    </div>
                    <div style="margin-top:0.6rem;display:flex;flex-wrap:wrap;gap:0.4rem;">
                        <span style="background:#f3f4f6;color:#475569;padding:0.2rem 0.55rem;border-radius:0.4rem;font-size:0.75rem;font-weight:600;">${jenis}</span>
                        <span style="background:#eff6ff;color:#2563eb;padding:0.2rem 0.55rem;border-radius:0.4rem;font-size:0.75rem;">${tglMulai}${tglSelesai && tglSelesai !== tglMulai ? ' s.d. ' + tglSelesai : ''}</span>
                    </div>
                    <div style="margin-top:0.6rem;font-size:0.82rem;color:#334155;line-height:1.5;">${escapeHtml(r.keterangan || '-')}</div>
                    <div style="margin-top:0.4rem;font-size:0.72rem;color:#94a3b8;">Diajukan: ${created}</div>
                    ${actions}
                </div>
            </div>`;
        }).join('');

        updateApprovalBulkBar();
    } catch (error) {
        console.error('Approval izin load error:', error);
        listEl.innerHTML = '<div style="padding:2rem 0;text-align:center;color:#dc2626;font-size:0.9rem;">Terjadi kesalahan saat memuat data.</div>';
    }
}

async function processApprovalIzin(id, status) {
    const catatan = status === 'rejected'
        ? prompt('Catatan penolakan (opsional):')
        : prompt('Catatan persetujuan (opsional):');
    if (catatan === null) return;

    try {
        const response = await fetch(`/api/admin/leave-requests/${id}/status`, {
            method: 'PUT',
            headers: {
                'Authorization': 'Bearer ' + (window.token || localStorage.getItem('token')),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status, catatan })
        });
        const result = await response.json();
        if (result.success) {
            if (window.Swal) {
                Swal.fire({ icon: 'success', title: 'Berhasil', text: result.message, timer: 1500, showConfirmButton: false });
            }
            loadApprovalIzin();
        } else {
            alert(result.message || 'Gagal memproses izin');
        }
    } catch (error) {
        console.error('Approval izin process error:', error);
        alert('Terjadi kesalahan saat memproses izin');
    }
}

async function bulkProcessApprovalIzin(status) {
    const ids = [...selectedApprovalIds];
    if (ids.length === 0) return;
    const label = status === 'approved' ? 'menyetujui' : 'menolak';
    if (!confirm(`Yakin ingin ${label} ${ids.length} pengajuan izin yang dipilih?`)) return;

    const catatan = prompt('Catatan (opsional):');
    if (catatan === null) return;

    try {
        let successCount = 0;
        for (const id of ids) {
            const response = await fetch(`/api/admin/leave-requests/${id}/status`, {
                method: 'PUT',
                headers: {
                    'Authorization': 'Bearer ' + (window.token || localStorage.getItem('token')),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status, catatan: catatan || null })
            });
            const result = await response.json();
            if (result.success) successCount++;
        }
        if (window.Swal) {
            Swal.fire({ icon: 'success', title: 'Selesai', text: `${successCount} dari ${ids.length} berhasil ${status === 'approved' ? 'disetujui' : 'ditolak'}`, timer: 1800, showConfirmButton: false });
        }
        loadApprovalIzin();
    } catch (error) {
        console.error('Bulk approval error:', error);
        alert('Terjadi kesalahan saat memproses izin terpilih');
    }
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function canApproveIzin(assignments) {
    const list = assignments || [];
    if (window.userRole === 'admin') return true;
    if (list.length === 0) return false;

    const ketuaRoles = ['kepalasekolah', 'pimpinan', 'ketua', 'kepalapondok'];
    const isKetuaYpwilutim = list.some(a => {
        const jabatan = (a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, '');
        return a.tenant_id === 'YPWILUTIM' && ketuaRoles.includes(jabatan);
    });
    if (isKetuaYpwilutim) return true;

    const isKetuaOther = list.some(a => {
        const jabatan = (a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, '');
        return a.tenant_id !== 'YPWILUTIM' && ketuaRoles.includes(jabatan);
    });
    if (isKetuaOther) return true;

    return false;
}

function getApprovalTenantFilter(assignments) {
    const list = assignments || [];
    if (window.userRole === 'admin') return ['YPWILUTIM'];

    const ketuaRoles = ['kepalasekolah', 'pimpinan', 'ketua', 'kepalapondok'];
    const isKetuaYpwilutim = list.some(a => {
        const jabatan = (a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, '');
        return a.tenant_id === 'YPWILUTIM' && ketuaRoles.includes(jabatan);
    });
    if (isKetuaYpwilutim) return null;

    const allowed = list
        .filter(a => {
            const jabatan = (a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, '');
            return a.tenant_id !== 'YPWILUTIM' && ketuaRoles.includes(jabatan);
        })
        .map(a => a.tenant_id);
    return allowed.length > 0 ? allowed : [];
}

function isKetuaYPWILUTIM(assignments) {
    const list = assignments || [];
    const ketuaRoles = ['kepalasekolah', 'pimpinan', 'ketua', 'kepalapondok'];
    return list.some(a => {
        const jabatan = (a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, '');
        return a.tenant_id === 'YPWILUTIM' && ketuaRoles.includes(jabatan);
    });
}

async function initPaktaIntegritas() {
    try {
        const periode = new Date().toISOString().slice(0, 7);
        const lbl = document.getElementById('paktaPeriodeLabel');
        if (lbl) lbl.textContent = periode;

        const res = await fetch('/api/pakta/me', {
            headers: { 'Authorization': 'Bearer ' + (window.token || localStorage.getItem('token')) }
        });
        const json = await res.json();
        if (json.success) {
            if (json.data && json.data.status === 'sudah') {
                closePaktaModal();
            } else {
                openPaktaModal();
            }
        }
    } catch (e) {
        // Jangan paksa tampil modal bila pengecekan gagal
    }
}

let currentAttendanceRule = null;
let currentLocation = null;
    window.isLocationValid = false;

function updateLocationDisplay(success, message) {
    const locationInfo = document.getElementById('locationInfo');
    locationInfo.className = success ? 'location-info success' : 'location-info error';
    locationInfo.innerHTML = `<span>${message}</span>`;
}

function showLocationPermissionBanner() {
    const banner = document.getElementById('locationPermissionBanner');
    if (banner) banner.style.display = 'block';
}

function dismissLocationBanner() {
    const banner = document.getElementById('locationPermissionBanner');
    if (banner) banner.style.display = 'none';
}

function retryLocationPermission() {
    dismissLocationBanner();
    requestLocationPermission();
}

function showAttendanceLoading() {
    const loading = document.getElementById('attendanceLoading');
    if (loading) loading.style.display = 'block';
}

function hideAttendanceLoading() {
    const loading = document.getElementById('attendanceLoading');
    if (loading) loading.style.display = 'none';
}

function getLocationErrorMessage(error) {
    switch (error.code) {
        case error.PERMISSION_DENIED:
            return 'Akses lokasi ditolak. Izinkan akses lokasi untuk melanjutnya.';
        case error.POSITION_UNAVAILABLE:
            return 'Lokasi tidak tersedia. Pastikan GPS aktif.';
        case error.TIMEOUT:
            return 'Timeout mendapatkan lokasi. Coba lagi.';
        default:
            return 'Error mendapatkan lokasi: ' + error.message;
    }
}

// Helper: Pengecekan hari absen (format: senin / senin,selasa / senin-rabu)
function isDayMatch(ruleHari, currentDay) {
    if (!ruleHari || ruleHari.trim() === '') return true;

    const rule = ruleHari.toLowerCase().trim();
    const day = currentDay.toLowerCase().trim();

    if (rule.includes('-')) {
        const [start, end] = rule.split('-').map(d => d.trim());
        const days = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
        const startIdx = days.indexOf(start);
        const endIdx = days.indexOf(end);
        const currentIdx = days.indexOf(day);

        if (startIdx === -1 || endIdx === -1 || currentIdx === -1) return false;
        return currentIdx >= startIdx && currentIdx <= endIdx;
    }

    const ruleDays = rule.split(',').map(d => d.trim());
    return ruleDays.includes(day);
}

function togglePassword(inputId) {
    const input = document.getElementById(inputId);
    const icon = input.nextElementSibling; // Asumsi span tepat setelah input

    if (input.type === "password") {
        input.type = "text";
        icon.textContent = "🙈"; // Ganti ikon saat terbuka
    } else {
        input.type = "password";
        icon.textContent = "👁️"; // Ganti ikon saat tertutup
    }
}

function toggleAdminDropdown() {
    var menu = document.getElementById('adminDropdownMenu');
    if (menu) {
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    }
}

function toggleEvaluatorDropdown() {
    var menu = document.getElementById('evaluatorDropdownMenu');
    if (menu) {
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    }
}

// Close dropdowns when clicking outside
document.addEventListener('click', function (e) {
    var adminMenu = document.getElementById('adminDropdownMenu');
    var adminSection = document.getElementById('adminNavSection');
    var evalMenu = document.getElementById('evaluatorDropdownMenu');

    if (adminMenu && adminSection && !adminSection.contains(e.target)) {
        adminMenu.style.display = 'none';
    }
    if (evalMenu && adminSection && !adminSection.contains(e.target)) {
        evalMenu.style.display = 'none';
    }
});

function enableAttendanceButtons() {
    // Tidak dipakai lagi - sudah digantikan loadRecentAttendance
}

function getCurrentAttendancePeriod() {
    if (!currentAttendanceRule) return { period: 'unknown', canAttend: true };

    const rule = currentAttendanceRule;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const [masukH, masukM] = (rule.jam_masuk || rule.jam_mulai || '07:00').split(':').map(Number);
    const [pulangH, pulangM] = (rule.jam_pulang || rule.jam_selesai || '16:00').split(':').map(Number);

    const masukStart = masukH * 60 + masukM;
    const pulangStart = pulangH * 60 + pulangM;

    // Toleransi 2 jam untuk setiap periode
    const masukEnd = masukStart + 120;
    const pulangEnd = pulangStart + 120;

    if (currentMinutes >= masukStart && currentMinutes <= masukEnd) {
        return { period: 'masuk', canAttend: true, label: 'Absen Masuk' };
    }

    if (currentMinutes >= pulangStart && currentMinutes <= pulangEnd) {
        return { period: 'pulang', canAttend: true, label: 'Absen Pulang' };
    }

    return { period: 'outside', canAttend: false, label: 'Di Luar Jam Absensi' };
}

async function updateAttendanceButtonsState() {
    console.log('updateAttendanceButtonsState called, currentLocation:', currentLocation);
    const checkInBtn = document.getElementById('checkInBtn');
    const checkOutBtn = document.getElementById('checkOutBtn');
    const locationInfo = document.getElementById('locationInfo');

    // Pastikan variabel absen diinisialisasi
    if (window.hasCheckedInToday === undefined) window.hasCheckedInToday = false;
    if (window.hasCheckedOutToday === undefined) window.hasCheckedOutToday = false;

    if (!currentLocation) {
        if (checkInBtn) checkInBtn.disabled = true;
        if (checkOutBtn) checkOutBtn.disabled = true;
        if (locationInfo) {
            locationInfo.className = 'location-info error';
            locationInfo.innerHTML = '<span>❌ Lokasi tidak tersedia. Aktifkan GPS untuk absensi.</span>';
        }
        return;
    }

    try {
        const result = await validateLocationRadius(currentLocation.latitude, currentLocation.longitude);
        console.log('Radius validation result:', result);

        const isInsideValidZone = result.withinRadius;
        window.isLocationValid = isInsideValidZone;

        let statusHtml = '';
        let statusClass = '';

        if (isInsideValidZone) {
            statusClass = 'location-info success';
            statusHtml = `<span>✅ Lokasi valid — Dalam radius ${result.radius}m dari ${result.schoolName}</span>`;
        } else {
            statusClass = 'location-info error';
            statusHtml = `<span>❌ Di luar radius unit Anda (${result.schoolName})</span>`;
        }

        if (locationInfo) {
            locationInfo.className = statusClass;
            locationInfo.innerHTML = statusHtml;
        }

        if (isInsideValidZone && window.currentRulesTenantId) {
            await loadAttendanceRules();
            await loadRecentAttendance();
        }

        applyTimeRulesToButtons(isInsideValidZone, statusClass, statusHtml, checkInBtn, checkOutBtn, locationInfo);
    } catch (error) {
        console.error('Radius validation error:', error);
        window.isLocationValid = false;
        if (checkInBtn) checkInBtn.disabled = true;
        if (checkOutBtn) checkOutBtn.disabled = true;
        if (locationInfo) {
            locationInfo.className = 'location-info error';
            locationInfo.innerHTML = '<span>❌ Gagal memvalidasi lokasi. Absensi tidak diizinkan.</span>';
        }
    }
}

function applyTimeRulesToButtons(isInsideValidZone, statusClass, statusHtml, checkInBtn, checkOutBtn, locationInfo) {
    const permissionBtn = document.getElementById('permissionBtn');
    if (permissionBtn) permissionBtn.style.display = 'inline-block';

    const hasCheckedInToday = window.hasCheckedInToday === true;

    if (window.currentAttendanceRules && window.currentAttendanceRules.length > 0) {
        const sekarang = new Date();
        const currentMinutes = sekarang.getHours() * 60 + sekarang.getMinutes();
        const dayNames = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
        const currentDay = dayNames[sekarang.getDay()];

        let bolehCheckIn = false;
        let bolehCheckOut = false;
        let statusSesiAktif = '';
        let nextRule = null;
        let nextRuleDiff = Infinity;

        const hasPulangRuleToday = window.currentAttendanceRules.some(r => {
            const hari = r.hari || r.hari_kerja || '';
            return isDayMatch(hari, currentDay) && (r.tipe || '').toLowerCase().includes('pulang');
        });

        console.log('[DEBUG_RULE] Menit sekarang:', currentMinutes, 'Hari:', currentDay, 'hasPulangRuleToday:', hasPulangRuleToday);

        window.currentAttendanceRules.forEach(rule => {
            const tipeRule = (rule.tipe || '').toLowerCase().trim();
            const mulai = rule.jam_mulai;
            const selesai = rule.jam_selesai;

            if (!isDayMatch(rule.hari, currentDay)) return;

            const [mulaiH, mulaiM] = ((rule.jam_mulai || rule.jam_masuk || '00:00').split(':').map(n => parseInt(n) || 0));
            const [selesaiH, selesaiM] = ((rule.jam_selesai || rule.jam_pulang || '00:00').split(':').map(n => parseInt(n) || 0));
            const mulaiMenit = mulaiH * 60 + mulaiM;
            const selesaiMenit = selesaiH * 60 + selesaiM;

            const isOvernight = mulaiMenit > selesaiMenit;
            const isInRange = isOvernight
                ? (currentMinutes >= mulaiMenit || currentMinutes <= selesaiMenit)
                : (currentMinutes >= mulaiMenit && currentMinutes <= selesaiMenit);

            if (isInRange) {
                console.log(`[DEBUG_RULE] Cocok dengan Rule ID ${rule.id}: ${rule.tipe} (${mulai} - ${selesai})`);

                if (tipeRule === 'datang' && !hasCheckedInToday) {
                    bolehCheckIn = true;
                    statusSesiAktif = rule.status_log || 'Tepat Waktu';
                }
                if (tipeRule === 'pulang' && hasCheckedInToday) {
                    bolehCheckOut = true;
                    statusSesiAktif = rule.status_log || 'Pulang';
                }
            } else {
                let diffMenit = mulaiMenit - currentMinutes;
                if (isOvernight && diffMenit < 0) diffMenit += 1440;
                const diffMs = diffMenit * 60 * 1000;
                if (diffMs < nextRuleDiff && diffMs > 0) {
                    nextRuleDiff = diffMs;
                    nextRule = rule;
                }
if (diffMenit < 0 && !isOvernight) {
                    // Rule sudah lewat
                    } else if (tipeRule === 'pulang' && mulaiMenit > currentMinutes && !nextRule && window.hasCheckedInToday) {
                    nextRuleDiff = diffMenit;
                    nextRule = rule;
                }
            }
        });

        checkInBtn.style.display = 'none';
        checkInBtn.disabled = true;
        checkOutBtn.style.display = 'none';
        checkOutBtn.disabled = true;

        // Jika sudah absen masuk dan pulang, sembunyikan semua tombol
        if (window.hasCheckedOutToday) {
            const distanceText = window.lastDistanceResult !== undefined ? `<br><small>📍 Jarak Anda saat ini: ${Math.round(window.lastDistanceResult)} meter dari target</small>` : '';
            locationInfo.className = 'location-info success';
            locationInfo.innerHTML = statusHtml + distanceText + '<br><small>✅ Absensi hari ini selesai (sudah masuk & pulang).</small>';
            return;
        }

        if (!hasCheckedInToday) {
            checkInBtn.style.display = 'block';
            checkInBtn.disabled = !bolehCheckIn || !isInsideValidZone;
            checkOutBtn.style.display = 'none';
            checkOutBtn.disabled = true;
        } else {
            checkInBtn.style.display = 'none';
            checkInBtn.disabled = true;

            if (hasPulangRuleToday) {
                checkOutBtn.style.display = 'block';
                checkOutBtn.disabled = !bolehCheckOut || !isInsideValidZone;
            } else {
                checkOutBtn.style.display = 'none';
                checkOutBtn.disabled = true;
                updateAttendanceWidget('Absensi Hari Ini Selesai', '#15803d', '#dcfce7');
            }
        }

        if (!isInsideValidZone) {
            checkInBtn.title = 'Aktifkan GPS untuk melakukan absensi';
            checkOutBtn.title = 'Aktifkan GPS untuk melakukan absensi';
        } else {
            checkInBtn.title = '';
            checkOutBtn.title = '';
        }

        const distanceText = window.lastDistanceResult !== undefined ? `<br><small>📍 Jarak Anda saat ini: ${Math.round(window.lastDistanceResult)} meter dari target</small>` : '';
        let infoTambahanAturan = '';

        if (!hasCheckedInToday) {
            if (bolehCheckIn) {
                infoTambahanAturan = `<br><small>🕒 Sesi aktif: <b>Absen Datang</b> (${statusSesiAktif})</small>`;
            } else if (nextRule) {
                const totalSeconds = Math.floor(nextRuleDiff / 1000);
                const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
                const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
                const seconds = String(totalSeconds % 60).padStart(2, '0');
                const ruleLabel = (nextRule.tipe || '').toLowerCase().includes('datang') ? 'Absen Datang' : 'Absen Pulang';
                infoTambahanAturan = `<br><small>⏳ Sesi berikutnya (${ruleLabel}) akan dibuka dalam: ${hours}:${minutes}:${seconds}</small>`;
            } else {
                infoTambahanAturan = `<br><small>🕒 Sesi absen belum dibuka / sudah ditutup (Jam sekarang: ${String(sekarang.getHours()).padStart(2, '0')}:${String(sekarang.getMinutes()).padStart(2, '0')})</small>`;
            }
        } else {
            if (hasPulangRuleToday) {
                if (bolehCheckOut) {
                    infoTambahanAturan = `<br><small>🕒 Sesi aktif: <b>Absen Pulang</b> (${statusSesiAktif})</small>`;
                } else if (nextRule && nextRule.tipe && (nextRule.tipe || '').toLowerCase().includes('pulang')) {
                    const totalSeconds = Math.floor(nextRuleDiff / 1000);
                    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
                    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
                    const seconds = String(totalSeconds % 60).padStart(2, '0');
                    infoTambahanAturan = `<br><small>⏳ Absen Pulang akan dibuka dalam: ${hours}:${minutes}:${seconds}</small>`;
                } else {
                    infoTambahanAturan = `<br><small>🕒 Menunggu jam absen pulang...</small>`;
                }
            } else {
                infoTambahanAturan = `<br><small>✅ Unit ini hanya memerlukan absen masuk. Absensi hari ini selesai.</small>`;
            }
        }

        locationInfo.className = statusClass;
        locationInfo.innerHTML = statusHtml + distanceText + infoTambahanAturan;

    } else {
        checkInBtn.style.display = 'none';
        checkInBtn.disabled = true;
        checkOutBtn.style.display = 'none';
        checkOutBtn.disabled = true;
        const distanceText = window.lastDistanceResult !== undefined ? `<br><small>📍 Jarak Anda saat ini: ${Math.round(window.lastDistanceResult)} meter dari target</small>` : '';
        locationInfo.className = 'location-info warning';
        locationInfo.innerHTML = statusHtml + distanceText + '<br><small>⚠️ Tenant ini belum memiliki aturan absensi.</small>';
    }
}

// ==========================================
// FUNGSI VALIDASI RADIUS GEOFENCING
// HANYA CEK HOME TENANT (tenant_id assignment guru)
// ==========================================
async function validateLocationRadius(userLat, userLng) {
    try {
        if (!window.userAssignments || window.userAssignments.length === 0) {
            console.log('[VALIDATE_RADIUS] Tidak ada unit assigned');
            return {
                withinRadius: false,
                isDinasLuarAllowed: false,
                distance: 0,
                radius: 0,
                schoolName: 'Tidak ada unit yang ditugaskan'
            };
        }

        const acc = (currentLocation && currentLocation.accuracy) ? currentLocation.accuracy : 0;

        // Ambil semua units (termasuk tenant_locations) untuk validasi radius
        const unitsResponse = await fetch('/api/units/all', {
            headers: { 'Authorization': 'Bearer ' + token }
        });

        if (!unitsResponse.ok) {
            throw new Error('Failed to fetch all units');
        }

        const unitsData = await unitsResponse.json();
        if (!unitsData.success || !unitsData.units) {
            throw new Error('No units data');
        }

        const assignedTenantIds = window.userAssignments.map(a => a.tenant_id);
        const allUnitsResults = [];

        for (const unit of unitsData.units) {
            // Hanya cek unit yang di-assign user
            if (!assignedTenantIds.includes(unit.tenant_id)) continue;
            if (!unit.latitude || !unit.longitude) continue;

            const tLat = parseFloat(unit.latitude);
            const tLng = parseFloat(unit.longitude);
            const dist = calculateDistance(userLat, userLng, tLat, tLng) * 1000;
            const rad = unit.location_radius || 200;
            const eff = dist + (acc * 0.3);

            console.log('[VALIDATE_RADIUS] Multi-tenant check:', unit.nama_sekolah, 'dist:', dist.toFixed(0), 'rad:', rad, 'eff:', eff.toFixed(0));

            allUnitsResults.push({
                tenantId: unit.tenant_id,
                schoolName: unit.nama_sekolah,
                distance: dist,
                radius: rad,
                effectiveDist: eff,
                isHomeUnit: true
            });
        }

        allUnitsResults.sort((a, b) => a.effectiveDist - b.effectiveDist);

        for (const unit of allUnitsResults) {
            if (unit.effectiveDist <= unit.radius) {
                console.log('[VALIDATE_RADIUS] Unit aktif ditemukan:', unit.schoolName, 'tenant:', unit.tenantId);
                window.currentNearestTenantId = unit.tenantId;
                window.currentRulesTenantId = unit.tenantId;
                window.lastDistanceResult = unit.distance;
                window.isHomeUnit = true;
                return {
                    withinRadius: true,
                    distance: unit.distance,
                    radius: unit.radius,
                    schoolName: unit.schoolName,
                    tenant_id: unit.tenantId,
                    isHomeUnit: true,
                    isDinasLuarCandidate: false
                };
            }
        }

        console.log('[VALIDATE_RADIUS] Di luar radius semua unit yang ditugaskan');
        return {
            withinRadius: false,
            isDinasLuarAllowed: false,
            distance: 0,
            radius: 0,
            schoolName: 'Di luar radius semua unit Anda'
        };

    } catch (error) {
        console.error('Error validating radius:', error);
        return {
            withinRadius: false,
            isDinasLuarAllowed: false,
            distance: 0,
            radius: 0,
            schoolName: 'Error validasi lokasi'
        };
    }
}



function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    return distance;
}

// Helper: Normalisasi tenant_id untuk perbandingan aman (hilangkan spasi, uppercase)
function normalizeTenantId(tenantId) {
    return (tenantId || "").toString().replace(/\s+/g, '').toUpperCase();
}

async function checkDinasLuar(userLat, userLng) {
    try {
        const response = await fetch('/api/units/all', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch all units');
        }

        const data = await response.json();

        if (!data.success || !data.units) {
            return { canDinasLuar: false };
        }

        // Ambil home tenant dari assignments atau user profile
        const userHomeTenant = window.userAssignments && window.userAssignments.length > 0
            ? window.userAssignments[0].tenant_id
            : (user.tenant_id || '');
        const currentHomeTenant = normalizeTenantId(userHomeTenant);

        for (const unit of data.units) {
            if (!unit.latitude || !unit.longitude) continue;

            const distance = calculateDistance(userLat, userLng, parseFloat(unit.latitude), parseFloat(unit.longitude));
            const radius = unit.location_radius || 200;

            if (distance * 1000 <= radius) {
                // Perbandingan aman: normalisasi tenant_id sebelum dibandingkan
                const detectedTenant = normalizeTenantId(unit.tenant_id);
                const isHomeUnit = currentHomeTenant === detectedTenant ||
                    (unit.nama_sekolah && userHomeTenant && unit.nama_sekolah.includes(userHomeTenant));

                return {
                    canDinasLuar: !isHomeUnit, // Jika home unit, jangan anggap dinas luar
                    unit: unit,
                    isHomeUnit: isHomeUnit
                };
            }
        }

        return { canDinasLuar: false };
    } catch (error) {
        console.error('Error checking dinas luar:', error);
        return { canDinasLuar: false };
    }
}

async function detectNearbyUnits(lat, lng) {
    try {
        const response = await fetch(`/api/units/nearby?lat=${lat}&lng=${lng}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success) {
            const nearestUnit = data.nearestUnit;
            if (nearestUnit) {
                console.log('Nearest unit detected:', nearestUnit);
                // Update UI to show nearest unit
                const locationInfo = document.getElementById('locationInfo');
                const existingText = locationInfo.querySelector('span').textContent;
                locationInfo.innerHTML = `<span>${existingText}<br><small>🏫 Unit Terdekat: ${nearestUnit.nama_sekolah} (${nearestUnit.distance.toFixed(1)}km)</small></span>`;
            }
        }
    } catch (error) {
        console.error('Error detecting nearby units:', error);
    }
}

let locationWatcher = null;

function requestLocationPermission() {
    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
            async function (position) {
                currentLocation = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy
                };
                updateLocationDisplay(true, `Lokasi didapatkan (${Math.round(position.coords.accuracy)}m akurasi)`);
                const waitForAssignments = new Promise(resolve => {
                    if (window.userAssignments?.length) return resolve();
                    const check = setInterval(() => {
                        if (window.userAssignments?.length) {
                            clearInterval(check);
                            resolve();
                        }
                    }, 100);
                    setTimeout(() => { clearInterval(check); resolve(); }, 5000);
                });

                await waitForAssignments;
                await loadRecentAttendance();
                await updateUnitSelector();
                await loadAttendanceRules();
                await updateAttendanceButtonsState();
                await detectNearbyUnits(position.coords.latitude, position.coords.longitude);
                startLocationWatcher();

            },
            function (error) {
                console.error('Location error:', error);
                updateLocationDisplay(false, getLocationErrorMessage(error));
                showLocationPermissionBanner();
                
                // Tunggu userAssignments terisi dulu baru panggil
                const waitForAssignments = new Promise(resolve => {
                    if (window.userAssignments?.length) return resolve();
                    const check = setInterval(() => {
                        if (window.userAssignments?.length) {
                            clearInterval(check);
                            resolve();
                        }
                    }, 100);
                    setTimeout(() => { clearInterval(check); resolve(); }, 3000);
                });
waitForAssignments.then(async () => {
                    await updateUnitSelector();
                    await loadAttendanceRules();
                    await loadRecentAttendance();
                    updateAttendanceButtonsState();
                    const checkInBtn = document.getElementById('checkInBtn');
                    const checkOutBtn = document.getElementById('checkOutBtn');
                    const locationInfo = document.getElementById('locationInfo');
                    if (checkInBtn && checkOutBtn && locationInfo) {
                        applyTimeRulesToButtons(false, 'location-info warning', 
                            '<span>⚠️ GPS tidak aktif. Absensi dibatasi.</span>', 
                            checkInBtn, checkOutBtn, locationInfo);
                    }
                });
            },
            {
                enableHighAccuracy: true,
                timeout: 20000,
                maximumAge: 300000
            }
        );
    } else {
        updateLocationDisplay(false, 'Geolokasi tidak didukung oleh browser ini.');
        // Tunggu userAssignments terisi dulu baru panggil loadRecentAttendance
        setTimeout(() => {
            updateUnitSelector();
            loadAttendanceRules();
            loadRecentAttendance();
        }, 100);
    }
}

function startLocationWatcher() {
    if (locationWatcher) {
        navigator.geolocation.clearWatch(locationWatcher);
    }

    locationWatcher = navigator.geolocation.watchPosition(
        function (position) {
            // Update location if it changed significantly (>10 meters)
            const newLocation = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy
            };

            const distanceChanged = currentLocation ?
                calculateDistance(
                    currentLocation.latitude, currentLocation.longitude,
                    newLocation.latitude, newLocation.longitude
                ) * 1000 > 10 : true; // Always update if no previous location

            if (distanceChanged) {
                console.log('Location changed, updating status...');
                currentLocation = newLocation;
                updateLocationDisplay(true, `Lokasi diperbarui (${Math.round(position.coords.accuracy)}m akurasi)`);
                loadRecentAttendance().then(() => {
                    loadAttendanceRules();
                    updateAttendanceButtonsState();
                });
            }
        },
        function (error) {
            console.warn('Location watch error:', error);
            // Don't update display for watch errors, keep current status
        },
        {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 60000
        }
    );
}

async function recordAttendance(jenis) {
    if (!currentLocation) { alert('Lokasi belum didapatkan.'); return; }
    showAttendanceLoading();

    const checkInBtn = document.getElementById('checkInBtn');
    const checkOutBtn = document.getElementById('checkOutBtn');

    if (checkInBtn) { checkInBtn.disabled = true; checkInBtn.style.opacity = '0.6'; }
    if (checkOutBtn) { checkOutBtn.disabled = true; checkOutBtn.style.opacity = '0.6'; }

    try {
        const radiusCheck = await validateLocationRadius(currentLocation.latitude, currentLocation.longitude);
        if (!radiusCheck.withinRadius && !radiusCheck.isDinasLuarAllowed) {
            alert(`Anda di luar radius: ${radiusCheck.schoolName}. Pilih "Ajukan Izin" untuk absen dinas luar.`);
            return;
        }

        if (radiusCheck.tenant_id) {
            window.currentNearestTenantId = radiusCheck.tenant_id;
        }

        const now = new Date();
        const currentMin = now.getHours() * 60 + now.getMinutes();

        const matchedRule = window.currentAttendanceRules.find(r => {
            const [h1, m1] = r.jam_mulai.split(':');
            const [h2, m2] = r.jam_selesai.split(':');
            const startMin = h1 * 60 + +m1;
            const endMin = h2 * 60 + +m2;
            const inTimeRange = startMin <= endMin
                ? currentMin >= startMin && currentMin <= endMin
                : currentMin >= startMin || currentMin <= endMin;
            return inTimeRange && r.tipe.toLowerCase() === (jenis === 'masuk' ? 'datang' : 'pulang');
        });

        if (!matchedRule) {
            alert("Saat ini bukan jam absen yang diizinkan.");
            return;
        }

        if (jenis === 'pulang' && !window.hasCheckedInToday) {
            alert("Anda tidak bisa absen pulang karena belum melakukan absen masuk hari ini.");
            return;
        }

        const formData = new FormData();
        formData.append('jenis', jenis);
        formData.append('metode', 'dashboard');
        formData.append('tenant_id', window.currentNearestTenantId || window.currentRulesTenantId || window.userAssignments?.[0]?.tenant_id || '');
        formData.append('latitude', currentLocation.latitude);
        formData.append('longitude', currentLocation.longitude);
        formData.append('waktu_absen', now.toISOString());
        formData.append('client_timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Makassar');
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const h = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        const localDateTime = `${y}-${m}-${d} ${h}:${min}:${s}`;
        formData.append('waktu_scan', localDateTime);
        formData.append('rule_id', matchedRule.id);
        formData.append('status', matchedRule.status_log.toLowerCase().replace(' ', '_'));

        if (!navigator.onLine) {
            const offlineData = {
                id: Date.now(),
                jenis,
                metode: 'dashboard',
                latitude: currentLocation.latitude,
                longitude: currentLocation.longitude,
                waktu_scan: `${y}-${m}-${d} ${h}:${min}:${s}`,
                timestamp: now.toISOString(),
                token: window.token || localStorage.getItem('token'),
                rule_id: matchedRule.id,
                status: matchedRule.status_log.toLowerCase().replace(' ', '_'),
                tenant_id: window.currentNearestTenantId || window.userAssignments?.[0]?.tenant_id
            };
            const stored = JSON.parse(localStorage.getItem('offlineAttendance') || '[]');
            stored.push(offlineData);
            localStorage.setItem('offlineAttendance', JSON.stringify(stored));
            Swal.fire({
                title: 'Offline',
                text: 'Absensi tersimpan offline. Akan dikirim otomatis saat online.',
                icon: 'info',
                confirmButtonColor: '#066e3a'
            });
            return;
        }

        console.log('[DEBUG_ATTENDANCE] Sending attendance with tenant_id:', window.currentNearestTenantId || window.currentRulesTenantId || window.userAssignments?.[0]?.tenant_id);
        console.log('[DEBUG_ATTENDANCE] formData tenant_id:', formData.get('tenant_id'));
        const response = await fetch('/api/attendance', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + (window.token || localStorage.getItem('token'))
            },
            body: formData
        });

        const result = await response.json();

        await new Promise(r => setTimeout(r, 500));
        await loadRecentAttendance();
        loadTodaySummary();

        requestAnimationFrame(async () => {
            if (result.success) {
                await new Promise(r => setTimeout(r, 100));
                Swal.fire({
                    title: 'Berhasil',
                    text: result.message,
                    icon: 'success',
                    confirmButtonColor: '#066e3a'
                });
            } else {
                Swal.fire({
                    title: 'Gagal',
                    text: result.message,
                    icon: 'error',
                    confirmButtonColor: '#dc2626'
                });
            }
        });
    } catch (error) {
        console.error('Submit error:', error);
        loadTodaySummary();
        loadRecentAttendance();
        requestAnimationFrame(() => {
            Swal.fire({
                title: 'Error',
                text: 'Terjadi kesalahan jaringan',
                icon: 'error',
                confirmButtonColor: '#dc2626'
            });
        });
    } finally {
        hideAttendanceLoading();
        if (checkInBtn) { checkInBtn.disabled = false; checkInBtn.style.opacity = ''; }
        if (checkOutBtn) { checkOutBtn.disabled = false; checkOutBtn.style.opacity = ''; }
    }
}

function showAttendanceResult(success, message, data = null) {
    const title = success ? 'Berhasil' : 'Gagal';
    const icon = success ? 'success' : 'error';

    Swal.fire({
        title: title,
        text: message,
        icon: icon,
        confirmButtonColor: success ? '#066e3a' : '#dc2626'
    }).then(() => {
        if (success) {
            loadTodaySummary();
            loadRecentAttendance();
        }
    });
}

function updateConnectionStatus() {
    const statusEl = document.getElementById('connectionStatus');
    if (!statusEl) return;
    if (navigator.onLine) {
        statusEl.innerHTML = '<i class="fas fa-circle text-green-500 mr-1"></i>Sistem Online';
        statusEl.className = 'badge badge-success';
    } else {
        statusEl.innerHTML = '<i class="fas fa-wifi-slash text-red-500 mr-1"></i>Koneksi Offline';
        statusEl.className = 'badge badge-error';
    }
}

function showOfflineMessage() {
    updateConnectionStatus();
}

async function syncOfflineAttendance() {
    updateConnectionStatus();

    try {
        const offlineData = JSON.parse(localStorage.getItem('offlineAttendance') || '[]');
        if (offlineData.length === 0) return;

        let syncedCount = 0;
        for (const data of offlineData) {
            try {
                const response = await fetch('/api/attendance', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${data.token}`
                    },
                    // Di dalam loop sync
                    body: JSON.stringify({
                        jenis: data.jenis,
                        metode: data.metode,
                        latitude: data.latitude,
                        longitude: data.longitude,
                        waktu_absen: data.timestamp,
                        waktu_scan: data.waktu_scan || new Date(data.timestamp).toLocaleTimeString('id-ID', { hour12: false }),
                        tenant_id: data.tenant_id // Kirim tenant_id hasil deteksi lokasi
                    })
                });

                if (response.ok) {
                    syncedCount++;
                    const index = offlineData.indexOf(data);
                    offlineData.splice(index, 1);
                }
            } catch (error) {
                console.error('Failed to sync:', data.id, error);
            }
        }

        localStorage.setItem('offlineAttendance', JSON.stringify(offlineData));

        if (syncedCount > 0) {
            showAttendanceResult(true, `${syncedCount} absensi offline berhasil dikirim`);
            loadTodaySummary();
        }
    } catch (error) {
        console.error('Sync error:', error);
    }
}

// TAMBAHKAN FUNGSI INI DI DALAM TAG <SCRIPT> DASHBOARD.HTML

async function checkActiveLeave() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const now = new Date();
        const currentHour = now.getHours();

        const response = await fetch('/api/leave-requests?status=approved', {
            headers: { 'Authorization': 'Bearer ' + (window.token || localStorage.getItem('token')) }
        });

        if (response.ok) {
            const result = await response.json();
            if (result.success && result.data.length > 0) {
                const activeLeave = result.data.find(leave => {
                    return leave.tanggal_mulai <= today && leave.tanggal_selesai >= today;
                });

                const permissionBtn = document.getElementById('permissionBtn');
                if (permissionBtn) {
                    if (activeLeave) {
                        // Cek apakah hari terakhir dan jam >= 18:00
                        const isLastDay = activeLeave.tanggal_selesai === today;
                        if (isLastDay && currentHour >= 18) {
                            permissionBtn.style.display = 'inline-block';
                            permissionBtn.disabled = false;
                            permissionBtn.innerHTML = '<i class="fas fa-file-medical" style="margin-right: 0.4rem;"></i>Ajukan Izin Lagi';
                        } else {
                            permissionBtn.style.display = 'none';
                            permissionBtn.disabled = true;
                        }
                    } else {
                        permissionBtn.style.display = 'inline-block';
                        permissionBtn.disabled = false;
                        permissionBtn.innerHTML = '<i class="fas fa-file-medical" style="margin-right: 0.4rem;"></i>Ajukan Izin';
                    }
                }
            }
        }
    } catch (error) {
        console.error('Leave check error:', error);
    }
}

async function loadLeaveStatus() {
    try {
        const response = await fetch('/api/leave-requests?status=pending', {
            headers: { 'Authorization': 'Bearer ' + (window.token || localStorage.getItem('token')) }
        });

        const leaveStatusList = document.getElementById('leaveStatusList');
        if (!leaveStatusList) return;

        if (response.ok) {
            const result = await response.json();
            if (result.success && result.data.length > 0) {
                let html = '';
                result.data.forEach(leave => {
                    const statusColor = leave.status === 'approved' ? '#15803d' : leave.status === 'rejected' ? '#dc2626' : '#b45309';
                    const statusBg = leave.status === 'approved' ? '#dcfce7' : leave.status === 'rejected' ? '#fef2f2' : '#fef3c7';
                    html += `
                        <div style="padding: 0.6rem 0; border-bottom: 1px solid #f1f5f9; display: flex; flex-direction: column; gap: 0.25rem;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="font-weight: 600; color: #0f172a; font-size: 0.85rem;">${leave.jenis.toUpperCase()}</span>
                                <span style="font-size: 0.75rem; background: ${statusBg}; color: ${statusColor}; padding: 0.125rem 0.5rem; border-radius: 0.25rem; font-weight: 600;">${leave.status.toUpperCase()}</span>
                            </div>
                            <div style="font-size: 0.75rem; color: #6b7280;">
                                ${leave.tanggal_mulai} s/d ${leave.tanggal_selesai}
                            </div>
                            <div style="font-size: 0.75rem; color: #64748b; font-style: italic;">${leave.keterangan}</div>
                        </div>
                    `;
                });
                leaveStatusList.innerHTML = html || '<p style="padding: 0.5rem 0; text-align: center; color: #94a3b8; font-size: 0.85rem;">Tidak ada pengajuan izin aktif</p>';
            } else {
                leaveStatusList.innerHTML = '<p style="padding: 0.5rem 0; text-align: center; color: #94a3b8; font-size: 0.85rem;">Tidak ada pengajuan izin aktif</p>';
            }
        }
    } catch (error) {
        console.error('Leave status load error:', error);
        document.getElementById('leaveStatusList').innerHTML = '<p style="padding: 0.5rem 0; text-align: center; color: #dc2626; font-size: 0.85rem;">Error memuat data</p>';
    }
}

async function updateUnitSelector() {
    const container = document.getElementById('unitSelectorCard');
    const select = document.getElementById('unitSelector');
    const info = document.getElementById('unitSelectorInfo');
    if (!container || !select) return;

    if (!window.userAssignments || window.userAssignments.length <= 1) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    select.innerHTML = '<option value="">-- Pilih Unit --</option>';
    window.userAssignments.forEach(a => {
        const option = document.createElement('option');
        option.value = a.tenant_id;
        option.textContent = a.nama_sekolah || a.tenant_id;
        select.appendChild(option);
    });

    const current = window.currentRulesTenantId || window.userAssignments[0]?.tenant_id;
    if (current) {
        select.value = current;
    }
    if (info) {
        info.textContent = current ? `Unit aktif: ${window.userAssignments.find(a => a.tenant_id === current)?.nama_sekolah || current}` : '';
    }
}

function onUnitSelectorChange(value) {
    const info = document.getElementById('unitSelectorInfo');
    if (!value) {
        window.currentRulesTenantId = window.userAssignments?.[0]?.tenant_id || '';
        if (info) info.textContent = '';
    } else {
        window.currentRulesTenantId = value;
        const assignment = window.userAssignments.find(a => a.tenant_id === value);
        if (info) info.textContent = `Unit aktif: ${assignment?.nama_sekolah || value}`;
    }
    loadAttendanceRules();
    updateAttendanceButtonsState();
}

async function loadAttendanceRules() {
    try {
        const url = new URL('/api/attendance-rules', window.location.origin);
        const tenantId = window.currentRulesTenantId || window.userAssignments?.[0]?.tenant_id || user.tenant_id;
        if (tenantId) {
            url.searchParams.set('tenant_id', tenantId);
        }

        console.log('[loadAttendanceRules] URL:', url.toString(), 'tenantId:', tenantId);
        const response = await fetch(url.toString(), {
            headers: { 'Authorization': 'Bearer ' + (window.token || localStorage.getItem('token')) }
        });

        if (response.ok) {
            const result = await response.json();
            if (result.success) {
                window.currentAttendanceRules = result.rules;
                if (result.source_tenant && result.source_tenant !== 'universal') {
                    window.currentRulesTenantId = result.source_tenant || tenantId;
                } else if (window.userAssignments && window.userAssignments.length > 0) {
                    window.currentRulesTenantId = window.userAssignments[0]?.tenant_id;
                } else {
                    window.currentRulesTenantId = '';
                }
                console.log('[DASHBOARD] Aturan absensi berhasil dimuat:', result.source_tenant, window.currentAttendanceRules);
            } else {
                window.currentAttendanceRules = [];
                window.currentRulesTenantId = tenantId;
            }
        } else {
            window.currentAttendanceRules = [];
            window.currentRulesTenantId = tenantId;
        }
    } catch (error) {
        console.error('Gagal mengambil data aturan absensi dari server:', error);
        window.currentAttendanceRules = [];
    }
    updateDashboardRuleStatus();
}

function updateDashboardRuleStatus(rules) {
    const statusText = document.getElementById('ruleStatusText');
    const statusBadge = document.getElementById('ruleStatusBadge');
    const nextInfo = document.getElementById('ruleNextInfo');

    if (!statusText || !statusBadge) return;

    const activeRules = rules || window.currentAttendanceRules || [];
    console.log('[updateDashboardRuleStatus] Rules:', activeRules);

    if (!activeRules || activeRules.length === 0) {
        statusText.textContent = 'Tidak ada aturan untuk unit Anda';
        statusBadge.innerHTML = '<i class="fas fa-exclamation" style="margin-right: 0.25rem;"></i>Tidak Ada';
        statusBadge.style.background = '#fef3c7';
        statusBadge.style.color = '#92400e';
        if (nextInfo) nextInfo.textContent = 'Belum ada jadwal sesi absensi sekolah Anda';
        return;
    }

    const sekarang = new Date();
    const currentMinutes = sekarang.getHours() * 60 + sekarang.getMinutes();
    const dayNames = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
    const currentDayIndex = sekarang.getDay();
    const currentDay = dayNames[currentDayIndex];

    let activeRule = null;
    let nextRule = null;
    let nextRuleDiff = Infinity;

    const rulesForToday = activeRules.filter(rule => {
        const hari = rule.hari || rule.hari_kerja || '';
        return isDayMatch(hari, currentDay);
    });

    rulesForToday.forEach(rule => {
        const mulai = rule.jam_mulai || rule.jam_masuk || '00:00';
        const selesai = rule.jam_selesai || rule.jam_pulang || '23:59';
        const [mulaiH, mulaiM] = mulai.split(':').map(n => parseInt(n) || 0);
        const [selesaiH, selesaiM] = selesai.split(':').map(n => parseInt(n) || 0);
        const mulaiMenit = mulaiH * 60 + mulaiM;
        const selesaiMenit = selesaiH * 60 + selesaiM;

        if (currentMinutes >= mulaiMenit && currentMinutes <= selesaiMenit) {
            activeRule = rule;
        } else if (mulaiMenit > currentMinutes) {
            const diff = mulaiMenit - currentMinutes;
            if (diff < nextRuleDiff) {
                nextRuleDiff = diff;
                nextRule = rule;
            }
        }
    });

    const formatTime = (time) => (time || '00:00').substring(0, 5);
    const capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

    if (activeRule) {
        const isPulang = (activeRule.nama_aturan || activeRule.tipe || '').toLowerCase().includes('pulang') ||
                          (activeRule.jam_pulang && !(activeRule.jam_mulai || activeRule.jam_masuk));
        const tipeLabel = isPulang ? 'Absen Pulang' : 'Absen Datang';
        statusText.textContent = `Aturan aktif: ${tipeLabel} (${formatTime(activeRule.jam_mulai || activeRule.jam_masuk)} - ${formatTime(activeRule.jam_selesai || activeRule.jam_pulang)})`;
        statusBadge.innerHTML = '<i class="fas fa-check-circle" style="margin-right: 0.25rem;"></i>Aktif';
        statusBadge.style.background = '#dcfce7';
        statusBadge.style.color = '#15803d';
        if (nextInfo) nextInfo.textContent = activeRule.status_log || activeRule.keterangan || '-';
    } else if (nextRule) {
        const totalSeconds = nextRuleDiff * 60;
        const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
        const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
        const isPulang = (nextRule.nama_aturan || nextRule.tipe || '').toLowerCase().includes('pulang') ||
                          (nextRule.jam_pulang && !(nextRule.jam_mulai || nextRule.jam_masuk));
        const tipeLabel = isPulang ? 'Absen Pulang' : 'Absen Datang';
        statusText.textContent = `Aturan berikutnya: ${tipeLabel} (${formatTime(nextRule.jam_mulai || nextRule.jam_masuk)} - ${formatTime(nextRule.jam_selesai || nextRule.jam_pulang)})`;
        statusBadge.innerHTML = '<i class="fas fa-clock" style="margin-right: 0.25rem;"></i>Menunggu';
        statusBadge.style.background = '#dbeafe';
        statusBadge.style.color = '#1d4ed8';
        if (nextInfo) nextInfo.textContent = `Dibuka dalam ${hours}:${minutes} • ${nextRule.hari || nextRule.hari_kerja || ''}`;
    } else {
        const isMultiDay = rulesForToday.length > 0 && (rulesForToday[0]?.hari || rulesForToday[0]?.hari_kerja || '').includes(',');
        const hasPulang = rulesForToday.some(r => (r.nama_aturan || r.tipe || '').toLowerCase().includes('pulang') ||
                                                   (r.jam_pulang && !(r.jam_mulai || r.jam_masuk)));
        
        if (rulesForToday.length === 0) {
            let foundNextDay = null;
            for (let offset = 1; offset <= 7; offset++) {
                const nextDayIndex = (currentDayIndex + offset) % 7;
                const nextDay = dayNames[nextDayIndex];
                const nextDayRules = activeRules.filter(r => {
                    const hari = (r.hari || r.hari_kerja || '');
                    return isDayMatch(hari, nextDay);
                });
                if (nextDayRules.length > 0) {
                    foundNextDay = { day: nextDay, rules: nextDayRules };
                    break;
                }
            }
            
            if (foundNextDay) {
                const nextDay = foundNextDay.day;
                const firstRule = foundNextDay.rules[0];
                const nextTime = firstRule.jam_mulai || firstRule.jam_masuk || '00:00';
                const isNextPulang = (firstRule.nama_aturan || firstRule.tipe || '').toLowerCase().includes('pulang') ||
                                       (firstRule.jam_pulang && !(firstRule.jam_mulai || firstRule.jam_masuk));
                const tipeLabel = isNextPulang ? 'Absen Pulang' : 'Absen Datang';
                const isNextDay = dayNames[(currentDayIndex + 1) % 7] === nextDay;
                statusText.textContent = isNextDay 
                    ? `Besok: ${tipeLabel} (${formatTime(nextTime)})`
                    : `${capitalize(nextDay)}: ${tipeLabel} (${formatTime(nextTime)})`;
                statusBadge.innerHTML = '<i class="fas fa-calendar-day" style="margin-right: 0.25rem;"></i>Jadwal';
                statusBadge.style.background = '#eff6ff';
                statusBadge.style.color = '#0c4a6e';
                if (nextInfo) nextInfo.textContent = `Jadwal untuk hari ${capitalize(nextDay)} pukul ${formatTime(nextTime)}`;
            } else {
                statusText.textContent = 'Tidak ada jadwal absensi yang tersedia';
                statusBadge.innerHTML = '<i class="fas fa-exclamation" style="margin-right: 0.25rem;"></i>Tidak Ada';
                statusBadge.style.background = '#fef3c7';
                statusBadge.style.color = '#92400e';
                if (nextInfo) nextInfo.textContent = 'Belum ada jadwal sesi absensi sekolah Anda';
            }
        } else if (!isMultiDay && !hasPulang) {
            const isPulang = (activeRules[0]?.nama_aturan || activeRules[0]?.tipe || '').toLowerCase().includes('pulang') ||
                              (activeRules[0]?.jam_pulang && !activeRules[0]?.jam_masuk);
            const tipeLabel = isPulang ? 'Absen Pulang' : 'Absen Datang';
            statusText.textContent = `Sedang aktif: ${tipeLabel}`;
            statusBadge.innerHTML = '<i class="fas fa-check-double" style="margin-right: 0.25rem;"></i>Selesai';
            statusBadge.style.background = '#e2fbe8';
            statusBadge.style.color = '#15803d';
            if (nextInfo) nextInfo.textContent = 'Hanya ada aturan absen masuk untuk unit ini.';
        } else {
            let foundNextDay = null;
            for (let offset = 1; offset <= 7; offset++) {
                const nextDayIndex = (currentDayIndex + offset) % 7;
                const nextDay = dayNames[nextDayIndex];
                const nextDayRules = activeRules.filter(r => {
                    const hari = (r.hari || r.hari_kerja || '');
                    return isDayMatch(hari, nextDay);
                });
                if (nextDayRules.length > 0) {
                    foundNextDay = { day: nextDay, rules: nextDayRules };
                    break;
                }
            }
            
            if (foundNextDay) {
                const nextDay = foundNextDay.day;
                const firstRule = foundNextDay.rules[0];
                const nextTime = firstRule.jam_mulai || firstRule.jam_masuk || '00:00';
                const isNextPulang = (firstRule.nama_aturan || firstRule.tipe || '').toLowerCase().includes('pulang') ||
                                       (firstRule.jam_pulang && !(firstRule.jam_mulai || firstRule.jam_masuk));
                const tipeLabel = isNextPulang ? 'Absen Pulang' : 'Absen Datang';
                const isNextDay = dayNames[(currentDayIndex + 1) % 7] === nextDay;
                statusText.textContent = isNextDay 
                    ? `Besok: ${tipeLabel} (${formatTime(nextTime)})`
                    : `${capitalize(nextDay)}: ${tipeLabel} (${formatTime(nextTime)})`;
                statusBadge.innerHTML = '<i class="fas fa-calendar-day" style="margin-right: 0.25rem;"></i>Jadwal';
                statusBadge.style.background = '#eff6ff';
                statusBadge.style.color = '#0c4a6e';
                if (nextInfo) nextInfo.textContent = `Jadwal untuk hari ${capitalize(nextDay)} pukul ${formatTime(nextTime)}`;
            } else {
                statusText.textContent = 'Sesi hari ini telah berakhir';
                statusBadge.innerHTML = '<i class="fas fa-check-double" style="margin-right: 0.25rem;"></i>Selesai';
                statusBadge.style.background = '#e2fbe8';
                statusBadge.style.color = '#15803d';
                if (nextInfo) nextInfo.textContent = 'Tidak ada jadwal absensi yang tersedia.';
            }
        }
    }
}

async function loadTodaySummary() {
    console.log('loadTodaySummary called (numbers only)');
    try {
        const response = await fetch('/api/dashboard', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log('response status:', response.status);

        let data = null;
        if (response.ok) {
            data = await response.json();
            if (data.success) {
                document.getElementById('totalAttendance').textContent = data.data.totalAbsensi;
                document.getElementById('lastStatus').textContent = data.data.absensiToday;
                document.getElementById('lastStatus').className = data.data.absensiToday === 'Belum absen' ? 'badge badge-warning' : 'badge badge-success';

                // Button state is handled by loadRecentAttendance for tenant-aware logic
            }
        }

        console.log('Checking password modal:', { data_user: data?.data?.user, is_default_password: data?.data?.user?.is_default_password });
        if (data && data.success && data.data && data.data.user && data.data.user.is_default_password) {
            console.log('Showing password change modal now');
            const modal = document.getElementById('changePasswordModal');
            console.log('Modal element:', modal);
            if (modal) {
                modal.style.display = 'flex';
                modal.classList.add('show');
                console.log('Modal classes after:', modal.className);
            } else {
                console.error('Modal not found');
            }
        } else {
            console.log('Not showing modal - conditions not met');
        }

    } catch (error) {
        console.error('Summary load error:', error);
    }
}





async function loadRecentAttendance() {
    console.log('Loading recent attendance');
    if (window.isLocationValid === undefined) window.isLocationValid = false;
    try {
        const response = await fetch('/api/attendance-history', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log('Attendance history response status:', response.status);

        const recentDiv = document.getElementById('recentAttendance');
        const statusBox = document.getElementById('lastStatus');
        const timeBox = document.getElementById('lastTime');
        const totalBox = document.getElementById('totalAttendance');
        const checkInBtn = document.getElementById('checkInBtn');
        const checkOutBtn = document.getElementById('checkOutBtn');
        const locationInfo = document.getElementById('locationInfo');

        if (response.ok) {
            const data = await response.json();
            console.log('Attendance history data:', data);

            const activeTenantId = window.currentNearestTenantId || window.userAssignments?.[0]?.tenant_id;
            const todayWITA = new Date();
            const witaDateStr = todayWITA.getFullYear() + '-' + String(todayWITA.getMonth() + 1).padStart(2, '0') + '-' + String(todayWITA.getDate()).padStart(2, '0');

            if (data.success && data.data.length > 0) {
                const groups = {};
                const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des'];

                data.data.forEach(attendance => {
                    const [datePart] = (attendance.waktu_scan || '').split(' ');
                    const [y, m] = datePart ? datePart.split('-') : ['unknown', 'unknown'];
                    const groupKey = y && m ? `${y}-${m}` : 'unknown';
                    if (!groups[groupKey]) groups[groupKey] = [];
                    groups[groupKey].push(attendance);
                });

                let html = '';
                Object.keys(groups).forEach(groupKey => {
                    if (groupKey === 'unknown') return;
                    const [y, m] = groupKey.split('-');
                    html += `<div class="attendance-month-group" style="margin-bottom:0.75rem;"><h4 style="font-size:0.9rem;font-weight:700;color:#0f172a;margin:0 0 0.5rem 0;">${monthNames[parseInt(m, 10) - 1] || m} ${y}</h4>`;
                    groups[groupKey].forEach(attendance => {
                        const datePart = attendance.waktu_scan?.split(' ')[0] || '';
                        const timePart = attendance.waktu_scan?.split(' ')[1] || '';
                        const dd = datePart.split('-')[2];
                        const shortDate = dd ? `${parseInt(dd)} ${monthNames[parseInt(datePart.split('-')[1]) - 1]}` : '';
                        const timeStr = timePart ? timePart.slice(0, 5) : '';
                        const jenisText = attendance.jenis === 'masuk' ? 'Masuk' : 'Pulang';
                        const statusText = attendance.status === 'tepat_waktu' ? 'Tepat Waktu' : 'Terlambat';
                        html += `<div class="recent-attendance-item" style="padding:0.6rem 0.5rem;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;"><div style="flex:1;"><div style="display:flex;align-items:center;gap:0.5rem;"><span style="font-weight:700;color:#0f172a">${shortDate}</span><span style="color:#94a3b8">|</span><span style="font-weight:600;color:${attendance.jenis === 'masuk' ? '#16a34a' : '#dc2626'}">${jenisText}</span></div><div style="font-size:0.78rem;color:#6b7280;margin-top:0.25rem">${timeStr} • ${statusText}</div></div></div>`;
                    });
                    html += '</div>';
                });
                recentDiv.innerHTML = html;

                const wrapperEl = document.getElementById('historyWrapper');
                if (wrapperEl) { wrapperEl.style.maxHeight = '210px'; wrapperEl.style.overflowY = 'auto'; }
                const toggleBtn = document.getElementById('toggleHistoryBtn');
                if (toggleBtn) toggleBtn.style.display = 'none';
                const fadeEl = document.getElementById('historyFade');
                if (fadeEl) fadeEl.style.display = 'none';

                if (totalBox) totalBox.innerText = data.data.length;

const todaysLogs = data.data.filter(log => log.waktu_scan?.split(' ')[0] === witaDateStr && log.tenant_id === activeTenantId);
                const hasMasukToday = todaysLogs.some(log => log.jenis === 'masuk');
                const hasPulangToday = todaysLogs.some(log => log.jenis === 'pulang');
                const logTerbaru = todaysLogs.length > 0 ? todaysLogs[0] : { jenis: null };
                
                window.hasCheckedInToday = hasMasukToday && !hasPulangToday;
                window.hasCheckedOutToday = hasMasukToday && hasPulangToday; // Sudah absen masuk + pulang
                if (timeBox) timeBox.innerText = logTerbaru.waktu_scan?.split(' ')[1]?.slice(0, 5) || '';

                if (statusBox) {
                    if (hasPulangToday) {
                        statusBox.innerText = 'Sudah Pulang';
                        statusBox.style.setProperty('background', '#eff6ff', 'important');
                        statusBox.style.setProperty('color', '#1e40af', 'important');
                    } else if (hasMasukToday) {
                        statusBox.innerText = 'Sudah Masuk';
                        statusBox.style.setProperty('background', '#e2fbe8', 'important');
                        statusBox.style.setProperty('color', '#15803d', 'important');
                    } else {
                        statusBox.innerText = 'Belum absen';
                        statusBox.style.setProperty('background', '#fef3c7', 'important');
statusBox.style.setProperty('color', '#92400e', 'important');
                    }
                }
            } else if (data.data.length === 0) {
                recentDiv.innerHTML = '<p class="text-center text-gray-500">Belum ada riwayat absensi</p>';
                if (statusBox) { statusBox.innerText = 'Belum absen'; statusBox.style.setProperty('background', '#fef3c7', 'important'); statusBox.style.setProperty('color', '#92400e', 'important'); }
                if (timeBox) timeBox.innerText = '-';
                if (totalBox) totalBox.innerText = '0';
                if (checkInBtn) checkInBtn.style.display = 'inline-block';
                if (checkOutBtn) { checkOutBtn.style.display = 'none'; }
                window.hasCheckedInToday = false;
            }
        } else {
            recentDiv.innerHTML = '<p class="text-center text-red-500">Gagal memuat data</p>';
        }
    } catch (error) {
        console.error('Recent attendance load error:', error);
        document.getElementById('recentAttendance').innerHTML = '<p class="text-center text-red-500">Error loading data</p>';
    }
    updateDashboardRuleStatus();
}

function toggleHistoryLayout() {
    const wrapper = document.getElementById('historyWrapper');
    const btn = document.getElementById('toggleHistoryBtn');
    const icon = document.getElementById('toggleHistoryIcon');

    if (wrapper.style.maxHeight === 'none' || wrapper.style.maxHeight === '') {
        wrapper.style.maxHeight = '200px';
        btn.querySelector('span').textContent = 'Lihat Selengkapnya';
        icon.className = 'fas fa-chevron-down';
    } else {
        wrapper.style.maxHeight = 'none';
        btn.querySelector('span').textContent = 'Sembunyikan';
        icon.className = 'fas fa-chevron-up';
    }
}

function logout() {
    console.log('Logout called');
    if (confirm('Apakah Anda yakin ingin logout?')) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.replace('login.html');
    }
}

function hardRefresh() {
    console.log('Hard refresh triggered');
    window.location.reload(true);
}

function closeChangePasswordModal() {
    const modal = document.getElementById('changePasswordModal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('show');
    }
    document.getElementById('oldPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
}

let currentDinasJenis = null;
let currentDinasUnit = null;

function showDinasLuarModal(jenis, dinasCheck) {
    currentDinasJenis = jenis;
    currentDinasUnit = dinasCheck.unit;
    document.getElementById('dinasUnitName').textContent = dinasCheck.unit.nama_sekolah;
    document.getElementById('dinasLuarModal').classList.add('show');
}

function closeDinasLuarModal() {
    document.getElementById('dinasLuarModal').classList.remove('show');
    document.getElementById('kegiatanDinas').value = '';
    document.getElementById('selfieInput').value = '';
    currentDinasJenis = null;
    currentDinasUnit = null;
}

async function submitDinasLuar() {
    const kegiatan = document.getElementById('kegiatanDinas').value.trim();
    if (!kegiatan) {
        Swal.fire('Error', 'Harap isi kegiatan yang dilakukan', 'error');
        return;
    }

    const metode = 'dashboard';
    const checkInBtn = document.getElementById('checkInBtn');
    const checkOutBtn = document.getElementById('checkOutBtn');

    checkInBtn.disabled = true;
    checkOutBtn.disabled = true;

    const originalText = currentDinasJenis === 'masuk' ? checkInBtn.innerHTML : checkOutBtn.innerHTML;
    const processingBtn = currentDinasJenis === 'masuk' ? checkInBtn : checkOutBtn;
    processingBtn.innerHTML = '<i class="fas fa-spinner spinner" style="margin-right: 0.5rem;"></i>Menyimpan...';

    try {
        const formData = new FormData();
        formData.append('jenis', currentDinasJenis);
        formData.append('metode', metode);
        formData.append('latitude', currentLocation.latitude);
        formData.append('longitude', currentLocation.longitude);
        formData.append('dinas_luar', 'true');
        formData.append('kegiatan_dinas', kegiatan);
        formData.append('waktu_absen', new Date().toISOString());

        const selfieInput = document.getElementById('selfieInput');
        if (selfieInput.files[0]) {
            formData.append('selfie', selfieInput.files[0]);
        }

        const response = await fetch('/api/attendance', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        const result = await response.json();

        if (result.success) {
            showAttendanceResult(true, result.message + ' (Dinas Luar)', result.data);
            loadTodaySummary();
            closeDinasLuarModal();
        } else {
            showAttendanceResult(false, result.message);
        }
    } catch (error) {
        console.error('Dinas luar error:', error);
        showAttendanceResult(false, 'Terjadi kesalahan saat mengirim absensi dinas luar');
    } finally {
        checkInBtn.disabled = false;
        checkOutBtn.disabled = false;
        processingBtn.innerHTML = originalText;
    }
}

async function changePassword() {
    const oldPassword = document.getElementById('oldPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (!oldPassword || !newPassword || !confirmPassword) {
        Swal.fire('Error', 'Semua field harus diisi', 'error');
        return;
    }

    if (newPassword !== confirmPassword) {
        Swal.fire('Error', 'Password baru dan konfirmasi tidak cocok', 'error');
        return;
    }

    if (newPassword.length < 8) {
        Swal.fire('Error', 'Password baru minimal 8 karakter', 'error');
        return;
    }

    // Check password strength
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
        Swal.fire('Error', 'Password harus mengandung huruf besar, huruf kecil, dan angka', 'error');
        return;
    }

    try {
        const response = await fetch('/api/change-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                oldPassword: oldPassword,
                newPassword: newPassword,
                confirmPassword: confirmPassword
            })
        });

        const result = await response.json();
        if (result.success) {
            Swal.fire('Berhasil', 'Password berhasil diubah', 'success');
            closeChangePasswordModal();
        } else {
            Swal.fire('Error', result.message || result.error || 'Gagal mengubah password', 'error');
        }
    } catch (error) {
        console.error('Change password error:', error);
        Swal.fire('Error', error.message || 'Terjadi kesalahan', 'error');
    }
}

// Profile photo functions
function changeProfilePhoto() {
    // Create file input dynamically
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = function (e) {
        const file = e.target.files[0];
        if (file) {
            uploadProfilePhoto(file);
        }
    };
    input.click();
}

async function uploadProfilePhoto(file) {
    const formData = new FormData();
    formData.append('photo', file);

    try {
        const response = await fetch('/api/upload-profile-photo', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        const result = await response.json();
        if (result.success) {
            // Update photo immediately
            document.getElementById('userPhoto').src = result.photoUrl;
            showAvatarFallback(false);
            Swal.fire('Berhasil', 'Foto profil berhasil diperbarui', 'success');
        } else {
            Swal.fire('Error', result.message, 'error');
        }
    } catch (error) {
        console.error('Upload error:', error);
        Swal.fire('Error', 'Gagal mengupload foto', 'error');
    }
}

// Initialize on load
initializeDashboard();

// Initialize Dashboard
async function initializeDashboard() {
     console.log('Initializing dashboard');
     await setTeacherInfo();  // Wait for teacher info to load assignments
     requestLocationPermission();
     loadTodaySummary();
     loadLeaveStatus();
     checkActiveLeave();
     updateConnectionStatus();
     checkAndShowAllUnitsSummary(); // Check and load all units summary for ketua/admin (after assignments loaded)
      if (canApproveIzin(window.userAssignments || [])) {
        openApprovalIzinModal();
      }
      // loadAttendanceRules() dan loadRecentAttendance() dipanggil dari requestLocationPermission setelah lokasi didapatkan
      initQuranWidget(); // Initialize Quran widget

     window.attendanceInterval = setInterval(function () {
         checkActiveLeave(); // Cek izin setiap detik
     }, 1000);

     window.addEventListener('online', syncOfflineAttendance);
window.addEventListener('offline', showOfflineMessage);
 }

// Check if user has ketua/admin role at YPWILUTIM and show all units summary
function checkAndShowAllUnitsSummary() {
    const assignments = window.userAssignments || [];
    console.log('[DEBUG] checkAndShowAllUnitsSummary - assignments:', assignments);
    
    const hasKetuaOrAdminAtYpwilutim = assignments.some(a => {
        const jabatan = (a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, '');
        console.log('[DEBUG] Checking role:', a.tenant_id, jabatan);
        return a.tenant_id === 'YPWILUTIM' && (jabatan.includes('ketua') || jabatan.includes('admin') || jabatan.includes('kepala') || jabatan.includes('pimpinan') || jabatan.includes('kepalasekolah'));
    });
    
    console.log('[DEBUG] hasKetuaOrAdminAtYpwilutim:', hasKetuaOrAdminAtYpwilutim);
    
    if (hasKetuaOrAdminAtYpwilutim) {
        loadAllUnitsSummary();
    }
}

// Load attendance summary for all units
async function loadAllUnitsSummary(dateFilter = null) {
    const widget = document.getElementById('allUnitsSummaryWidget');
    const tbody = document.getElementById('allUnitsSummaryBody');
    const periodEl = document.getElementById('allUnitsPeriod');
    const dateInput = document.getElementById('allUnitsDateFilter');

    if (!widget) return;

    widget.style.display = 'block';

    // Set default date to today if no filter
    const targetDate = dateFilter || new Date().toISOString().split('T')[0];
    if (dateInput) dateInput.value = targetDate;

    try {
        const response = await fetch(`/api/summary/all-units?date=${targetDate}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            const result = await response.json();
            if (result.success && result.data) {
                periodEl.textContent = `Periode: ${result.date || targetDate}`;

                if (result.data.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" style="padding: 1rem; text-align: center; color: #94a3b8;">Tidak ada data unit</td></tr>';
                } else {
                    tbody.innerHTML = result.data.map(item => `
                        <tr style="border-bottom: 1px solid #f1f5f9; cursor: pointer;" onclick="showTeachersModal('${item.tenant_id}', 'hadir', '${targetDate}')">
                            <td style="padding: 0.5rem; font-weight: 500; color: #0f172a;">${item.nama_sekolah || item.tenant_id}</td>
                            <td style="padding: 0.5rem; text-align: center; color: #475569;">${item.total_guru || 0}</td>
                            <td style="padding: 0.5rem; text-align: center; color: #15803d; font-weight: 600; cursor: pointer;" onclick="event.stopPropagation(); showTeachersModal('${item.tenant_id}', 'hadir', '${targetDate}')">${item.hadir || 0}</td>
                            <td style="padding: 0.5rem; text-align: center; color: #d97706; font-weight: 600; cursor: pointer;" onclick="event.stopPropagation(); showTeachersModal('${item.tenant_id}', 'terlambat', '${targetDate}')">${item.terlambat || 0}</td>
                            <td style="padding: 0.5rem; text-align: center; color: #2563eb; font-weight: 600; cursor: pointer;" onclick="event.stopPropagation(); showTeachersModal('${item.tenant_id}', 'izin', '${targetDate}')">${item.izin || 0}</td>
                            <td style="padding: 0.5rem; text-align: center; color: #dc2626; font-weight: 600; cursor: pointer;" onclick="event.stopPropagation(); showTeachersModal('${item.tenant_id}', 'alpha', '${targetDate}')">${item.alpha || 0}</td>
                        </tr>
                    `).join('');
                }
            } else if (result.message) {
                tbody.innerHTML = `<tr><td colspan="6" style="padding: 1rem; text-align: center; color: #dc2626;">${result.message}</td></tr>`;
            }
        } else {
            const errorText = await response.text().catch(() => 'Unknown error');
            tbody.innerHTML = `<tr><td colspan="6" style="padding: 1rem; text-align: center; color: #dc2626;">Error: ${response.status} - ${errorText}</td></tr>`;
        }
    } catch (error) {
        console.error('All units summary error:', error);
        tbody.innerHTML = '<tr><td colspan="6" style="padding: 1rem; text-align: center; color: #dc2626;">Error memuat data</td></tr>';
    }
}

function refreshAllUnitsSummaryWithDate() {
    const dateInput = document.getElementById('allUnitsDateFilter');
    if (dateInput) loadAllUnitsSummary(dateInput.value);
}

// Modal untuk menampilkan daftar guru
let teachersModal, currentTenantId, currentStatus;
function showTeachersModal(tenantId, status, dateFilter = null) {
    currentTenantId = tenantId;
    currentStatus = status;
    const selectedDate = dateFilter || (document.getElementById('allUnitsDateFilter')?.value) || new Date().toISOString().split('T')[0];

    if (!teachersModal || !document.contains(teachersModal)) {
        teachersModal = document.createElement('div');
        teachersModal.className = 'modal-overlay';
        teachersModal.style.cssText = 'display:flex;position:fixed;inset:0;background:rgba(15,23,42,0.6);backdrop-filter:blur(4px);z-index:1000;align-items:center;justify-content:center;padding:1rem;';
        teachersModal.innerHTML = `
            <div style="background:white;border-radius:1rem;max-width:500px;width:100%;max-height:80vh;display:flex;flex-direction:column;">
                <div style="padding:1rem;border-bottom:1px solid #e2e8f0;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;">
                        <h3 id="teachersModalTitle" style="margin:0;font-size:1.1rem;font-weight:600;"></h3>
                        <button onclick="closeTeachersModal()" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:1.25rem;">&times;</button>
                    </div>
                    <input type="date" id="teachersDateFilter" onchange="loadTeachersForDate()" style="width:100%;padding:0.5rem;border:1px solid #cbd5e1;border-radius:0.5rem;font-size:0.9rem;">
                </div>
                <div id="teachersModalBody" style="padding:1rem;overflow-y:auto;flex:1;"></div>
            </div>
        `;
        document.body.appendChild(teachersModal);
    } else {
        teachersModal.style.display = 'flex';
    }

    document.getElementById('teachersDateFilter').value = selectedDate;

    const statusLabels = { hadir: 'Hadir', terlambat: 'Terlambat', izin: 'Izin', alpha: 'Tidak Absen' };
    document.getElementById('teachersModalTitle').textContent = `Daftar Guru - ${statusLabels[status] || status}`;
    loadTeachersForDate(selectedDate);
}

async function loadTeachersForDate(date = null) {
    const dateToUse = date || document.getElementById('teachersDateFilter')?.value || new Date().toISOString().split('T')[0];
    const modalBody = document.getElementById('teachersModalBody');
    modalBody.innerHTML = '<div style="padding:1rem;text-align:center;color:#94a3b8;"><i class="fas fa-spinner fa-spin"></i> Memuat...</div>';

    try {
        const response = await fetch(`/api/summary/unit-teachers?tenant_id=${currentTenantId}&status=${currentStatus}&date=${dateToUse}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        if (data.success && data.data.length > 0) {
            const isAlpha = currentStatus === 'alpha';
            const headerBtn = isAlpha ? `
                <button onclick="sendBulkMessage('${dateToUse}')" style="background:#2563eb;color:white;border:none;padding:0.4rem 0.8rem;border-radius:0.5rem;font-size:0.8rem;cursor:pointer;">
                    <i class="fas fa-paper-plane"></i> Kirim Massal
                </button>
            ` : '';
            
            const teachersList = data.data.map(t => `
                <div style="padding:0.5rem 0;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;">
                    <div>
                        <div style="font-weight:600;color:#0f172a;">${t.nama}</div>
                        <div style="font-size:0.8rem;color:#64748b;">NIP: ${t.nip || '-'} | Waktu: ${t.waktu_scan ? new Date(t.waktu_scan).toLocaleTimeString('id-ID') : 'Belum absen'}</div>
                    </div>
                    ${isAlpha ? `<button onclick="sendMessageToTeacher('${t.nama}')" style="background:#ef4444;color:white;border:none;padding:0.3rem 0.6rem;border-radius:0.4rem;font-size:0.75rem;cursor:pointer;"><i class="fas fa-paper-plane"></i></button>` : ''}
                </div>
            `).join('');
            
            modalBody.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;padding-bottom:0.5rem;border-bottom:1px solid #e2e8f0;">
                    <div style="font-weight:600;color:#0f172a;">
                        <i class="fas fa-exclamation-triangle" style="color:#dc2626;margin-right:0.5rem;"></i>Guru Belum Absen
                    </div>
                    ${headerBtn}
                </div>
                ${teachersList}
            `;
        } else {
            modalBody.innerHTML = '<div style="padding:2rem;text-align:center;color:#94a3b8;">Tidak ada guru dalam kategori ini</div>';
        }
    } catch (err) {
        console.error('Teachers modal error:', err);
        modalBody.innerHTML = '<div style="padding:2rem;text-align:center;color:#dc2626;">Error memuat data</div>';
    }
}

async function sendBulkMessage(date) {
    const teacherNames = [];
    const items = document.querySelectorAll('#teachersModalBody > div > div > div:first-child');
    items.forEach(d => teacherNames.push(d.textContent));

    const { value: message } = await Swal.fire({
        title: 'Kirim Pesan Massal',
        html: `<textarea id="bulkMessage" class="swal2-textarea" placeholder="Tulis pesan tegur..." style="width:100%;min-height:100px;"></textarea>`,
        showCancelButton: true,
        confirmButtonText: 'Kirim ke Semua',
        cancelButtonText: 'Batal',
        preConfirm: () => document.getElementById('bulkMessage').value
    });

    if (!message) return;

    const sendPromises = teacherNames.map(name =>
        fetch('/api/chat/conversations', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetName: name, targetUserType: 'guru' })
        }).then(r => r.json()).then(c => {
            if (c.success) {
                return fetch(`/api/chat/conversations/${c.conversationId}/messages`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: `[TEGUR] ${message}` })
                });
            }
        })
    );

    await Promise.all(sendPromises);
    Swal.fire('Berhasil', `Pesan terkirim ke ${teacherNames.length} guru`, 'success');
}

async function sendMessageToTeacher(teacherName) {
    const { value: message } = await Swal.fire({
        title: `Kirim Tegur ke ${teacherName}`,
        html: `<textarea id="teacherMessage" class="swal2-textarea" placeholder="Tulis pesan..." style="width:100%;min-height:100px;"></textarea>`,
        showCancelButton: true,
        confirmButtonText: 'Kirim',
        cancelButtonText: 'Batal',
        preConfirm: () => document.getElementById('teacherMessage').value
    });

    if (!message) return;

    try {
        const conv = await fetch('/api/chat/conversations', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetName: teacherName, targetUserType: 'guru' })
        }).then(r => r.json());

        if (conv.success) {
            await fetch(`/api/chat/conversations/${conv.conversationId}/messages`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: `[TEGUR] ${message}` })
            });
            Swal.fire('Berhasil', 'Pesan terkirim', 'success');
        }
    } catch (err) {
        Swal.fire('Gagal', 'Tidak dapat mengirim pesan', 'error');
    }
}

function closeTeachersModal() {
    if (teachersModal) teachersModal.style.display = 'none';
}

// Setup global error handler for user photo (fallback if script loads before DOM)
window.showFallbackAvatar = function(img) { 
    const fallback = document.getElementById('avatarFallback'); 
    if (fallback) fallback.classList.add('show'); 
    const userPhoto = document.getElementById('userPhoto');
    if (userPhoto) userPhoto.style.display = 'none';
};
window.showUserPhoto = function() { 
    const fallback = document.getElementById('avatarFallback'); 
    if (fallback) fallback.classList.remove('show'); 
    const userPhoto = document.getElementById('userPhoto');
    if (userPhoto) userPhoto.style.display = 'block';
};

// ========================================================
// PWA INSTALL PROMPT
// ========================================================
let deferredPrompt;
const installBanner = document.createElement('div');
installBanner.id = 'pwa-install-banner';
installBanner.style.cssText = `
      position: fixed; bottom: 0; left: 0; right: 0;
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      color: white; padding: 1rem; text-align: center;
      display: none; z-index: 9999; flex-direction: column;
      gap: 0.5rem; box-shadow: 0 -2px 10px rgba(0,0,0,0.1);
    `;
installBanner.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 0.25rem;">
        <i class="fas fa-download"></i> Install Aplikasi Dashboard
      </div>
      <div style="font-size: 0.85rem; opacity: 0.9;">Akses lebih cepat & bisa offline</div>
      <div style="display: flex; gap: 0.5rem; justify-content: center; margin-top: 0.5rem;">
        <button id="install-btn" style="background: white; color: #2563eb; border: none; padding: 0.5rem 1rem; border-radius: 0.25rem; font-weight: 600; cursor: pointer;">Install</button>
        <button id="dismiss-btn" style="background: transparent; color: white; border: 1px solid white; padding: 0.5rem 1rem; border-radius: 0.25rem; font-weight: 600; cursor: pointer;">Nanti</button>
      </div>
    `;
document.body.appendChild(installBanner);

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBanner.style.display = 'flex';
});

document.getElementById('install-btn')?.addEventListener('click', async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            console.log('PWA installed');
        }
        deferredPrompt = null;
        installBanner.style.display = 'none';
    }
});

document.getElementById('dismiss-btn')?.addEventListener('click', () => {
    installBanner.style.display = 'none';
});

// Register service worker for PWA
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/scanner-sw.js')
        .then(reg => console.log('[SW] Dashboard registered:', reg.scope))
        .catch(err => console.log('[SW] Dashboard registration failed:', err));
}

// Navigate to admin unit
window.goToAdminUnit = function (select) {
    if (select.value) {
        window.location.href = 'school-admin.html?tenant=' + select.value;
    }
}

// Variabel scope lokal
let currentAdminUnits = [];
let selectedAdminUnitId = null;

// Setup bendahara/treasurer nav button
function setupTreasurerNav() {
    const mobileNav = document.getElementById('mobileTreasurerNav');
    const desktopBtn = document.getElementById('desktopTreasurerBtn');
    const mobileAdminNav = document.getElementById('mobileAdminNav');

    const assignments = window.userAssignments || [];
    const hasBendahara = assignments.some(a => {
        const jabatan = (a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, '');
        return jabatan === 'bendahara';
    });

    const hasAdminRoles = assignments.some(a => {
        const jabatan = (a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, '');
        return ['admin', 'operator', 'media', 'tu', 'tatausaha', 'kepala', 'pimpinan'].some(role => jabatan.includes(role));
    });

    if (hasBendahara) {
        const isYPWILUTIM = assignments.some(a => a.tenant_id === 'YPWILUTIM');
        const targetPage = isYPWILUTIM ? 'bendahara-dashboard.html' : 'treasurer-dashboard.html';
        if (mobileNav) {
            mobileNav.style.display = 'block';
            mobileNav.onclick = () => { window.location.href = targetPage; };
        }
        if (desktopBtn) {
            desktopBtn.style.display = 'block';
            desktopBtn.onclick = () => { window.location.href = targetPage; };
        }
    }

    if (hasAdminRoles) {
        if (mobileAdminNav) {
            mobileAdminNav.style.display = 'block';
            mobileAdminNav.onclick = () => { showAdminUnitModal(assignments); };
        }
    }

    if (canApproveIzin(assignments)) {
        let mobileApproval = document.getElementById('mobileApprovalNav');
        if (!mobileApproval) {
            mobileApproval = document.createElement('div');
            mobileApproval.id = 'mobileApprovalNav';
            mobileApproval.style.cssText = 'text-align: center; color: #7c3aed; cursor: pointer;';
            mobileApproval.innerHTML = '<i class="fas fa-user-check" style="font-size: 1.3rem; display: block; margin-bottom: 2px;"></i><span style="font-size: 0.65rem; font-weight: 600;">Approval</span>';
            const bottomNav = document.querySelector('.mobile-bottom-nav');
            if (bottomNav) bottomNav.appendChild(mobileApproval);
        }
        mobileApproval.onclick = () => { openApprovalIzinModal(); };
    }
}

// Menampilkan Modal
let storedAdminUnits = [];

function showAdminUnitModal(units) {
    const listEl = document.getElementById('adminUnitList');
    const modal = document.getElementById('adminUnitModal');
    const confirmBtn = document.getElementById('confirmAdminUnitBtn');

    if (!listEl || !modal) return;

    const adminRoles = ['admin', 'operator', 'media', 'tu', 'tatausaha'];
    const filteredUnits = units.filter(u => {
        const jabatan = (u.jabatan_di_unit || '').toLowerCase().replace(/\s/g, '');
        return adminRoles.some(role => jabatan.includes(role));
    });

    currentAdminUnits = filteredUnits;
    selectedAdminUnitId = null;

    listEl.innerHTML = filteredUnits.map((unit) => `
    <label class="unit-option">
        <div class="unit-icon">
            <i class="fas fa-school text-blue-600 text-lg"></i>
        </div>
        
        <div class="flex-1 min-w-0 mr-3">
            <div class="font-bold text-slate-800 truncate text-[15px]">
                ${unit.nama_sekolah || unit.tenant_id}
            </div>
            <div class="text-xs text-slate-500 font-medium mt-0.5 truncate flex items-center gap-1.5">
                <span class="bg-slate-100 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold">
                    ${unit.tenant_id}
                </span>
                <span>•</span>
                <span>${unit.jabatan_di_unit || 'Admin'}</span>
            </div>
        </div>

        <input type="radio" 
               name="adminUnit" 
               value="${unit.tenant_id}" 
               onchange="handleUnitSelection('${unit.tenant_id}', this)" 
               class="unit-radio">
    </label>
`).join('');

    modal.style.display = 'flex';
    confirmBtn.disabled = true;
    confirmBtn.classList.add('btn-disabled');
}

// Menangani pemilihan unit
function handleUnitSelection(tenantId, radioEl) {
    selectedAdminUnitId = tenantId;

    // Reset visual
    document.querySelectorAll('.unit-option').forEach(el => el.classList.remove('unit-option-selected'));
    radioEl.closest('.unit-option').classList.add('unit-option-selected');

    // Aktifkan tombol
    const confirmBtn = document.getElementById('confirmAdminUnitBtn');
    confirmBtn.disabled = false;
    confirmBtn.classList.remove('btn-disabled');
}

// Menutup modal
function closeAdminUnitModal() {
    document.getElementById('adminUnitModal').style.display = 'none';
}

// Aksi konfirmasi
function confirmAdminUnit() {
    if (selectedAdminUnitId) {
        window.location.href = `school-admin.html?tenant=${selectedAdminUnitId}`;
    }
}

// Inisialisasi
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(setupTreasurerNav, 2000);
});

// Permission Modal functions
function showPermissionModal() {
    document.getElementById('permissionModal').style.display = 'flex';
}

function closePermissionModal() {
    document.getElementById('permissionModal').style.display = 'none';
    document.getElementById('permissionType').value = '';
    document.getElementById('permissionStartDate').value = '';
    document.getElementById('permissionEndDate').value = '';
    document.getElementById('permissionKeterangan').value = '';
}

async function submitPermission() {
    const permissionType = document.getElementById('permissionType').value;
    const startDate = document.getElementById('permissionStartDate').value;
    const endDate = document.getElementById('permissionEndDate').value;
    const keterangan = document.getElementById('permissionKeterangan').value.trim();
    const submitBtn = document.getElementById('submitPermissionBtn');

    if (!permissionType) {
        Swal.fire('Error', 'Pilih jenis izin terlebih dahulu', 'error');
        return;
    }

    if (!keterangan) {
        Swal.fire('Error', 'Keterangan wajib diisi', 'error');
        return;
    }

    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner spinner" style="margin-right: 0.5rem;"></i>Menyimpan...';

    try {
        const response = await fetch('/api/leave-request', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + (window.token || localStorage.getItem('token'))
            },
            body: JSON.stringify({
                jenis: permissionType,
                keterangan: keterangan,
                tanggal_mulai: startDate,
                tanggal_selesai: endDate || startDate,
                tenant_id: (window.userAssignments || []).map(a => a.tenant_id).filter(Boolean)
            })
        });

        const result = await response.json();

        if (result.success) {
            Swal.fire({ title: 'Berhasil', text: 'Pengajuan izin berhasil dikirim (status: pending)', icon: 'success', confirmButtonColor: '#066e3a' });
            closePermissionModal();
            loadTodaySummary();
        } else {
            Swal.fire({ title: 'Gagal', text: result.message, icon: 'error', confirmButtonColor: '#dc2626' });
        }
    } catch (error) {
        console.error('Permission submit error:', error);
        Swal.fire({ title: 'Error', text: 'Terjadi kesalahan jaringan', icon: 'error', confirmButtonColor: '#dc2626' });
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
}// ============================================================
// Edit Profile Modal Functions
// ============================================================

// Open edit profile modal and load teacher data
function openEditProfileModal() {
    const modal = document.getElementById('editProfileModal');
    if (modal) {
        modal.style.display = 'flex';
        loadEditProfileData();
    }
}

function openCompleteProfile() {
    const teacherId = document.getElementById('editTeacherId').value;
    if (teacherId) {
        window.location.href = 'complete-profile.html?teacher_id=' + teacherId;
    }
}

// Close edit profile modal
function closeEditProfileModal() {
    const modal = document.getElementById('editProfileModal');
    if (modal) {
        modal.style.display = 'none';
        const preview = document.getElementById('editPhotoPreview');
        if (preview) {
            preview.src = '';
            preview.style.display = 'none';
        }
        const photoInput = document.getElementById('editPhotoInput');
        if (photoInput) photoInput.value = '';
    }
}

function handleEditPhotoClick() {
    const photoInput = document.getElementById('editPhotoInput');
    if (photoInput) photoInput.click();
}

document.addEventListener('DOMContentLoaded', function() {
    const editPhotoInput = document.getElementById('editPhotoInput');
    if (editPhotoInput) {
        editPhotoInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(event) {
                    const preview = document.getElementById('editPhotoPreview');
                    if (preview) {
                        preview.src = event.target.result;
                        preview.style.display = 'block';
                    }
                };
                reader.readAsDataURL(file);
            }
        });
    }
});

async function loadEditProfileData() {
    try {
        const teacherInfo = await fetch('/api/teacher/info', {
            headers: { 'Authorization': 'Bearer ' + (window.token || localStorage.getItem('token')) }
        }).then(r => r.json());

        if (teacherInfo.success && teacherInfo.teacher) {
            const teacher = teacherInfo.teacher;
            document.getElementById('editTeacherId').value = teacher.id || '';
            const sv = (id, val) => {
                const el = document.getElementById(id);
                if (el && val != null) el.textContent = val;
            };
            const setText = (id, val, map) => {
                const el = document.getElementById(id);
                if (el) el.textContent = map ? (map[val] || val) : val;
            };
            sv('editNama', teacher.nama);
            sv('editNik', teacher.nik);
            sv('editNip', teacher.nip);
            sv('editEmail', teacher.email);
            sv('editTempatLahir', teacher.tempat_lahir);
            sv('editTanggalLahir', teacher.tanggal_lahir);
            setText('editJenisKelaminText', teacher.jenis_kelamin, { L: 'Laki-laki', P: 'Perempuan' });
            sv('editAlamat', teacher.alamat);
            sv('editNoWa', teacher.no_wa);
            setText('editStatusKepegawaianText', teacher.status_kepegawaian, { PTY: 'PTY', PKY: 'PKY', Honor: 'Honor' });
            setText('editStatusAktifText', teacher.status_aktif, { 1: 'Aktif', 0: 'Tidak Aktif' });
            sv('editTmt', teacher.tmt);
            if (teacher.pendidikan_terakhir) {
                const parts = teacher.pendidikan_terakhir.split('/');
                sv('editPendidikanText', parts[0] || '');
                sv('editJurusan', parts[1] || '');
                sv('editNamaSekolahPendidikan', parts[2] || '');
            }
            sv('editBank', teacher.bank);
            sv('editNomorRekening', teacher.nomor_rekening);
            if (teacher.link_foto) {
                const preview = document.getElementById('editPhotoPreview');
                if (preview) {
                    preview.src = teacher.link_foto;
                    preview.style.display = 'block';
                }
                document.getElementById('editPhotoPlaceholder').style.display = 'none';
            }
        }
    } catch (error) {
        console.error('Error loading teacher data:', error);
        Swal.fire({ title: 'Error', text: 'Gagal memuat data profil', icon: 'error' });
    }
}

function openCompleteProfile() {
    const teacherId = document.getElementById('editTeacherId');
    const id = teacherId ? teacherId.value : '';
    window.location.href = 'complete-profile.html' + (id ? '?teacher_id=' + id : '');
}

function showAllUnitsSummaryModal() {
    const modal = document.getElementById('allUnitsSummaryModal');
    const tableBody = document.getElementById('allUnitsSummaryModalBody');
    const widgetBody = document.getElementById('allUnitsSummaryBody');
    const dateFilter = document.getElementById('allUnitsModalDateFilter');
    
    if (dateFilter && document.getElementById('allUnitsDateFilter')) {
        dateFilter.value = document.getElementById('allUnitsDateFilter').value;
    }
    
    if (tableBody && widgetBody) {
        tableBody.innerHTML = widgetBody.innerHTML;
    }
    
    if (modal) modal.style.display = 'flex';
}

function closeAllUnitsSummaryModal() {
    const modal = document.getElementById('allUnitsSummaryModal');
    if (modal) modal.style.display = 'none';
}

// ============================================================
// EMAIL CONFIRMATION MODAL (SIMPLE, NO OTP)
// ============================================================

function isEmailVerified() {
    return localStorage.getItem('email_verified') === 'true';
}

function setEmailVerified() {
    localStorage.setItem('email_verified', 'true');
    localStorage.setItem('email_verified_at', new Date().toISOString());
}

function showEmailVerificationModal() {
    const modal = document.getElementById('emailVerificationModal');
    if (modal) {
        modal.style.display = 'flex';
        loadTeacherEmailForConfirmation();
    }
}

function closeEmailVerificationModal() {
    const modal = document.getElementById('emailVerificationModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function loadTeacherEmailForConfirmation() {
    try {
        const response = await fetch('/api/teacher/info', {
            headers: { 'Authorization': 'Bearer ' + (window.token || localStorage.getItem('token')) }
        });
        const data = await response.json();
        if (data.success && data.teacher) {
            const emailInput = document.getElementById('verifyEmailInput');
            if (emailInput && data.teacher.email) {
                emailInput.value = data.teacher.email;
            }
        }
    } catch (error) {
        console.error('Error loading teacher email:', error);
    }
}

async function confirmEmail() {
    const emailInput = document.getElementById('verifyEmailInput');
    const confirmBtn = document.getElementById('confirmEmailBtn');
    const email = emailInput ? emailInput.value.trim() : '';

    if (!email) {
        Swal.fire({ title: 'Gagal', text: 'Email wajib diisi', icon: 'error', confirmButtonColor: '#dc2626' });
        return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        Swal.fire({ title: 'Gagal', text: 'Format email tidak valid', icon: 'error', confirmButtonColor: '#dc2626' });
        return;
    }

    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right: 0.4rem;"></i> Menyimpan...';
    }

    try {
        const response = await fetch('/api/auth/update-email', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + (window.token || localStorage.getItem('token'))
            },
            body: JSON.stringify({ email })
        });

        const result = await response.json();

        if (result.success) {
            setEmailVerified();
            Swal.fire({ title: 'Berhasil', text: 'Email berhasil diperbarui dan diverifikasi', icon: 'success', confirmButtonColor: '#15803d' });
            closeEmailVerificationModal();
        } else {
            Swal.fire({ title: 'Gagal', text: result.message, icon: 'error', confirmButtonColor: '#dc2626' });
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.innerHTML = '<i class="fas fa-check" style="margin-right: 0.4rem;"></i> Ya, Email Sudah Benar';
            }
        }
    } catch (error) {
        console.error('Confirm email error:', error);
        Swal.fire({ title: 'Error', text: 'Terjadi kesalahan jaringan', icon: 'error', confirmButtonColor: '#dc2626' });
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '<i class="fas fa-check" style="margin-right: 0.4rem;"></i> Ya, Email Sudah Benar';
        }
    }
}

// Prevent closing email confirmation modal by clicking overlay
document.addEventListener('click', function (e) {
    const emailVerifModal = document.getElementById('emailVerificationModal');
    if (emailVerifModal && emailVerifModal.style.display === 'flex') {
        if (e.target === emailVerifModal) {
            e.stopPropagation();
            e.preventDefault();
        }
    }
}, true);

// Check email confirmation status on page load
async function checkEmailVerification() {
    if (isEmailVerified()) return;

    try {
        const response = await fetch('/api/teacher/info', {
            headers: { 'Authorization': 'Bearer ' + (window.token || localStorage.getItem('token')) }
        });
        const data = await response.json();
        if (data.success && data.teacher && data.teacher.email) {
            showEmailVerificationModal();
        }
    } catch (error) {
        console.error('Error checking email verification:', error);
    }
}

// Initialize email verification check when dashboard loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkEmailVerification);
} else {
    checkEmailVerification();
}

// ============================================================
// PROBLEM ATTENDANCE QR
// ============================================================
function showProblemQR() {
    const modal = document.getElementById('problemQRModal');
    const container = document.getElementById('problemQRImage');
    if (!modal || !container) return;

    container.innerHTML = '<div style="text-align:center;padding:2rem;"><i class="fas fa-spinner fa-spin" style="font-size:1.5rem;color:#2563eb;"></i><p style="margin-top:0.5rem;color:#64748b;font-size:0.875rem;">Membuat QR...</p></div>';
    modal.style.display = 'flex';

    (async () => {
        try {
            const token = window.token || localStorage.getItem('token');
            const res = await fetch('/api/teacher/info', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const data = await res.json();
            if (!data.success || !data.teacher) {
                container.innerHTML = '<p style="color:#dc2626;text-align:center;">Gagal memuat data guru</p>';
                return;
            }

            const teacher = data.teacher;
            const scanId = teacher.scan_id || teacher.id;
            const payload = {
                scan_id: String(scanId),
                nama: teacher.nama || '',
                email: teacher.email || '',
                no_wa: teacher.no_wa || '',
                ts: Date.now()
            };

            const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
            const qrRes = await fetch('/api/qrcode/' + encodeURIComponent(encoded) + '?size=200', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const qrData = await qrRes.json();

            if (qrData.success && qrData.qr_url) {
                container.innerHTML = '<img src="' + qrData.qr_url + '" style="max-width:200px;height:auto;border-radius:0.5rem;" alt="QR Absen Masalah">';
            } else {
                container.innerHTML = '<p style="color:#dc2626;text-align:center;">Gagal generate QR</p>';
            }
        } catch (e) {
            console.error('Problem QR error:', e);
            container.innerHTML = '<p style="color:#dc2626;text-align:center;">Terjadi kesalahan</p>';
        }
    })();
}

function closeProblemQRModal() {
    const modal = document.getElementById('problemQRModal');
    if (modal) modal.style.display = 'none';
}
