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

// Global fetch wrapper: proactive token expiry check + auto-logout on 401/403
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
            if (res && (res.status === 401 || res.status === 403)) {
                // Clear sensitive local data and redirect to login immediately
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
                    showFallbackAvatar(true);
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
                    if (adminUnits.length === 1) {
                        const unit = adminUnits[0];
                        htmlContent += `<a href="school-admin.html?tenant=${unit.tenant_id}" style="display:inline-flex;align-items:center;gap:0.4rem;padding:0.3rem 0.75rem;background:#059669;color:white;border-radius:0.5rem;font-size:0.8rem;font-weight:600;text-decoration:none;margin-left:0.5rem;"><span class="fas fa-user-cog mr-1"></span> Admin ${unit.nama_sekolah || unit.tenant_id}</a>`;
                    } else {
                        let dropdownOptions = '<option value="">-- Pilih Unit --</option>';
                        adminUnits.forEach(unit => {
                            dropdownOptions += `<option value="${unit.tenant_id}">${unit.nama_sekolah || unit.tenant_id}</option>`;
                        });
                        htmlContent += `
                          <div style="display:inline-block;margin-left:0.5rem;">
                            <select id="adminUnitSelect" onchange="goToAdminUnit(this)" style="padding:0.3rem 0.5rem;border-radius:0.25rem;border:1px solid #059669;background:white;color:#059669;font-size:0.8rem;font-weight:600;cursor:pointer;">
                              ${dropdownOptions}
                            </select>
                          </div>
                        `;
                    }
                }

                adminSection.innerHTML = htmlContent;
            }
        }
    } catch (error) {
        console.error('Error loading teacher info:', error);
    }
}

let currentLocation = null;
let currentAttendanceRule = null;

function updateLocationDisplay(success, message) {
    const locationInfo = document.getElementById('locationInfo');
    locationInfo.className = success ? 'location-info success' : 'location-info error';
    locationInfo.innerHTML = `<span>${message}</span>`;
}

function getLocationErrorMessage(error) {
    switch (error.code) {
        case error.PERMISSION_DENIED:
            return 'Akses lokasi ditolak. Izinkan akses lokasi untuk melanjutkan.';
        case error.POSITION_UNAVAILABLE:
            return 'Lokasi tidak tersedia. Pastikan GPS aktif.';
        case error.TIMEOUT:
            return 'Timeout mendapatkan lokasi. Coba lagi.';
        default:
            return 'Error mendapatkan lokasi: ' + error.message;
    }
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
    // Don't enable buttons automatically - wait for radius validation
    updateAttendanceButtonsState();
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

function updateAttendanceButtonsState() {
    console.log('updateAttendanceButtonsState called, currentLocation:', currentLocation);
    const checkInBtn = document.getElementById('checkInBtn');
    const checkOutBtn = document.getElementById('checkOutBtn');
    const locationInfo = document.getElementById('locationInfo');

    if (!currentLocation) {
        checkInBtn.disabled = true;
        checkOutBtn.disabled = true;
        locationInfo.className = 'location-info error';
        locationInfo.innerHTML = '<span>❌ Lokasi tidak tersedia. Aktifkan GPS untuk absensi.</span>';
        return;
    }

    // Validate radius with nearest school
    validateLocationRadius(currentLocation.latitude, currentLocation.longitude)
        .then(result => {
            console.log('Radius validation result in updateAttendanceButtonsState:', result);

            let isInsideValidZone = false;
            let statusHtml = '';
            let statusClass = '';

            if (result.withinRadius) {
                isInsideValidZone = true;

                if (result.isHomeUnit !== false) {
                    // Sekolah sendiri — tampil hijau normal
                    statusClass = 'location-info success';
                    statusHtml = `<span>✅ Lokasi valid — Dalam radius ${result.radius}m dari ${result.schoolName}</span>`;
                } else if (result.isDinasLuarCandidate) {
                    // Sekolah lain dalam radius — tampil kuning (dinas luar)
                    statusClass = 'location-info warning';
                    statusHtml = `<span>⚠️ Di luar unit utama — Dinas luar di ${result.schoolName}</span>`;
                } else {
                    // Sekolah lain tapi tidak ada penanda khusus
                    statusClass = 'location-info warning';
                    statusHtml = `<span>⚠️ Di luar unit utama — Dinas luar di ${result.schoolName}</span>`;
                }
            } else {
                // Coba checkDinasLuar sebagai fallback tambahan
                return checkDinasLuar(currentLocation.latitude, currentLocation.longitude)
                    .then(dinasCheck => {
                        if (dinasCheck.canDinasLuar) {
                            isInsideValidZone = true;
                            statusClass = 'location-info warning';
                            statusHtml = `<span>⚠️ Di luar unit utama — Dinas luar di ${dinasCheck.unit.nama_sekolah}</span>`;
                        } else {
                            isInsideValidZone = false;
                            statusClass = 'location-info error';
                            statusHtml = `<span>❌ Di luar radius semua unit sekolah YPWI</span>`;
                        }
                        applyTimeRulesToButtons(isInsideValidZone, statusClass, statusHtml, checkInBtn, checkOutBtn, locationInfo);
                    })
                    .catch(() => {
                        isInsideValidZone = false;
                        statusClass = 'location-info error';
                        statusHtml = `<span>❌ Di luar radius semua unit sekolah YPWI</span>`;
                        applyTimeRulesToButtons(isInsideValidZone, statusClass, statusHtml, checkInBtn, checkOutBtn, locationInfo);
                    });
            }

            // Jalankan jika valid atau sekolah lain
            applyTimeRulesToButtons(isInsideValidZone, statusClass, statusHtml, checkInBtn, checkOutBtn, locationInfo);
        })
        .catch(error => {
            console.error('Radius validation error:', error);
            // Fallback aman: Jangan kunci user jika sistem rule/lokasi error internal
            checkInBtn.disabled = false;
            checkOutBtn.disabled = false;
            locationInfo.className = 'location-info warning';
            locationInfo.innerHTML = '<span>⚠️ Gagal memvalidasi lokasi. Absensi tetap diizinkan sebagai fallback.</span>';
        });
}

function applyTimeRulesToButtons(isInsideValidZone, statusClass, statusHtml, checkInBtn, checkOutBtn, locationInfo) {
    const permissionBtn = document.getElementById('permissionBtn');
    if (permissionBtn) permissionBtn.style.display = 'inline-block'; // Always show permission button
    
    if (!isInsideValidZone) {
        checkInBtn.disabled = true;
        checkOutBtn.disabled = true;
        locationInfo.className = statusClass;
        locationInfo.innerHTML = '<span>❌ Di luar radius semua unit sekolah YPWI.</span>';
        return;
    }

    if (window.currentAttendanceRules && window.currentAttendanceRules.length > 0) {
        const sekarang = new Date();
        const opsiWaktu = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
        const jamSekarangString = sekarang.toLocaleTimeString('en-US', opsiWaktu);

        let bolehCheckIn = false;
        let bolehCheckOut = false;
        let statusSesiAktif = '';
        let nextRule = null;
        let nextRuleDiff = Infinity;

        console.log('[DEBUG_RULE] Jam sekarang:', jamSekarangString);

        window.currentAttendanceRules.forEach(rule => {
            const tipeRule = (rule.tipe || '').toLowerCase().trim();
            const mulai = rule.jam_mulai;
            const selesai = rule.jam_selesai;

            if (jamSekarangString >= mulai && jamSekarangString <= selesai) {
                console.log(`[DEBUG_RULE] Cocok dengan Rule ID ${rule.id}: ${rule.tipe} (${mulai} - ${selesai})`);

                if (tipeRule === 'datang') {
                    bolehCheckIn = true;
                    statusSesiAktif = rule.status_log || 'Tepat Waktu';
                }
                if (tipeRule === 'pulang') {
                    bolehCheckOut = true;
                    statusSesiAktif = rule.status_log || 'Pulang';
                }
            } else {
                const ruleStartDate = new Date(`2000-01-01T${mulai}`);
                const currentTimeForCalc = new Date(`2000-01-01T${jamSekarangString}`);
                let diffMs = ruleStartDate - currentTimeForCalc;
                if (diffMs < 0) {
                    ruleStartDate.setDate(ruleStartDate.getDate() + 1);
                    diffMs = ruleStartDate - currentTimeForCalc;
                }
                if (diffMs < nextRuleDiff && diffMs > 0) {
                    nextRuleDiff = diffMs;
                    nextRule = rule;
                }
            }
        });

        checkInBtn.disabled = !bolehCheckIn;
        checkOutBtn.disabled = !bolehCheckOut;

        const distanceText = window.lastDistanceResult !== undefined ? `<br><small>📍 Jarak Anda saat ini: ${Math.round(window.lastDistanceResult)} meter dari target</small>` : '';

        let infoTambahanAturan = '';
        if (!bolehCheckIn && !bolehCheckOut) {
            if (nextRule) {
                const totalSeconds = Math.floor(nextRuleDiff / 1000);
                const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
                const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
                const seconds = String(totalSeconds % 60).padStart(2, '0');
                const ruleLabel = (nextRule.tipe || '').toLowerCase().includes('datang') ? 'Absen Datang' : 'Absen Pulang';
                infoTambahanAturan = `<br><small>⏳ Sesi berikutnya (${ruleLabel}) akan dibuka dalam: ${hours}:${minutes}:${seconds}</small>`;
            } else {
                infoTambahanAturan = `<br><small>🕒 Sesi absen belum dibuka / sudah ditutup (Jam sekarang: ${jamSekarangString})</small>`;
            }
        } else {
            infoTambahanAturan = `<br><small>🕒 Sesi aktif: <b>${bolehCheckIn ? 'Absen Datang' : 'Absen Pulang'}</b> (${statusSesiAktif})</small>`;
        }

        locationInfo.className = statusClass;
        locationInfo.innerHTML = statusHtml + distanceText + infoTambahanAturan;

    } else {
        checkInBtn.disabled = true;
        checkOutBtn.disabled = true;
        const distanceText = window.lastDistanceResult !== undefined ? `<br><small>📍 Jarak Anda saat ini: ${Math.round(window.lastDistanceResult)} meter dari target</small>` : '';
        locationInfo.className = 'location-info error';
        locationInfo.innerHTML = '<span>❌ Tenant ini belum memiliki aturan absensi. Hubungi admin.</span>';
    }
}

// ==========================================
// FUNGSI VALIDASI RADIUS GEOFENCING (FIXED — cek semua lokasi dari DB)
// ==========================================
async function validateLocationRadius(userLat, userLng) {
    try {
        // ======================================================
        // TAHAP 1: Cek SEMUA sekolah yang di-assign ke user, urutkan berdasarkan jarak
        // ======================================================
        if (!window.userAssignments || window.userAssignments.length === 0) {
            console.log('[VALIDATE_RADIUS] Tidak ada unit assigned');
        } else {
            const assignmentResults = [];
            
            for (let i = 0; i < window.userAssignments.length; i++) {
                const assignment = window.userAssignments[i];
                const tenantId = encodeURIComponent(assignment.tenant_id);

                const res = await fetch('/api/tenants/' + tenantId, {
                    headers: { 'Authorization': 'Bearer ' + token }
                });

                if (!res.ok) continue;

                const data = await res.json();
                if (!data.success || !data.tenant.latitude) continue;

                const tLat = parseFloat(data.tenant.latitude);
                const tLng = parseFloat(data.tenant.longitude);
                const dist = calculateDistance(userLat, userLng, tLat, tLng) * 1000;
                const rad = data.tenant.location_radius || 200;
                const acc = (currentLocation && currentLocation.accuracy) ? currentLocation.accuracy : 0;
                const eff = dist + (acc * 0.3);

                console.log('[VALIDATE_RADIUS] Check', data.tenant.nama_sekolah, 'dist:', dist.toFixed(0), 'rad:', rad, 'eff:', eff.toFixed(0));

                if (eff <= rad) {
                    assignmentResults.push({
                        withinRadius: true,
                        distance: dist,
                        radius: rad,
                        schoolName: data.tenant.nama_sekolah,
                        tenant_id: data.tenant.tenant_id
                    });
                }
            }

            // Pilih assignment yang paling dekat
            if (assignmentResults.length > 0) {
                assignmentResults.sort((a, b) => a.distance - b.distance);
                const closest = assignmentResults[0];
                console.log('[VALIDATE_RADIUS] Closest assignment:', closest);
                window.currentNearestTenantId = closest.tenant_id;
                window.lastDistanceResult = closest.distance;
                return { ...closest, isHomeUnit: true, isDinasLuarCandidate: false };
            }
        }

        // ======================================================
        // TAHAP 2: Jika tidak ada sekolah assigned yang dalam radius,
        //           cek SEMUA lokasi di database (tenants + tenant_locations)
        // ======================================================
        console.log('[VALIDATE_RADIUS] Tidak dalam sekolah assigned, cek semua lokasi...');

        const allUnitsRes = await fetch('/api/units/all', {
            headers: { 'Authorization': 'Bearer ' + token }
        });

        if (allUnitsRes.ok) {
            const allUnitsData = await allUnitsRes.json();
            if (allUnitsData.success && allUnitsData.units && allUnitsData.units.length > 0) {
                const userHomeTenantNorm = normalizeTenantId(
                    window.userAssignments?.[0]?.tenant_id || ''
                );
                const acc = (currentLocation && currentLocation.accuracy) ? currentLocation.accuracy : 0;
                const userHomeTenantIds = window.userAssignments?.map(a => a.tenant_id) || [];

                // Kumpulkan semua unit dalam radius
                const unitsInRadius = [];
                for (const unit of allUnitsData.units) {
                    if (!unit.latitude || !unit.longitude) continue;

                    const tLat = parseFloat((unit.latitude || '').toString().trim());
                    const tLng = parseFloat((unit.longitude || '').toString().trim());
                    if (isNaN(tLat) || isNaN(tLng)) continue;

                    const dist = calculateDistance(userLat, userLng, tLat, tLng) * 1000;
                    const rad = parseInt(unit.location_radius) || 100;
                    const eff = dist + (acc * 0.3);

                    console.log('[VALIDATE_RADIUS] Cek lokasi lain:', unit.nama_sekolah, 'dist:', dist.toFixed(0), 'rad:', rad, 'eff:', eff.toFixed(0));

                    if (eff <= rad) {
                        const detectedTenantNorm = normalizeTenantId(unit.tenant_id);
                        const isHomeUnit = userHomeTenantIds.includes(unit.tenant_id);
                        
                        unitsInRadius.push({
                            withinRadius: true,
                            distance: dist,
                            radius: rad,
                            schoolName: unit.nama_sekolah,
                            nama_sekolah: unit.nama_sekolah,
                            tenant_id: unit.tenant_id,
                            latitude: unit.latitude,
                            longitude: unit.longitude,
                            location_radius: unit.location_radius,
                            unit: unit,
                            isHomeUnit: isHomeUnit,
                            isDinasLuarCandidate: !isHomeUnit
                        });
                    }
                }

                // Urutkan berdasarkan jarak, prioritaskan home unit
                if (unitsInRadius.length > 0) {
                    unitsInRadius.sort((a, b) => {
                        // Prioritas 1: Home unit (isHomeUnit: true lebih dulu)
                        if (a.isHomeUnit && !b.isHomeUnit) return -1;
                        if (!a.isHomeUnit && b.isHomeUnit) return 1;
                        // Prioritas 2: Jarak terdekat
                        return a.distance - b.distance;
                    });
                    
                    const closest = unitsInRadius[0];
                    console.log('[VALIDATE_RADIUS] Selected location:', closest.schoolName,
                        closest.isHomeUnit ? '(home unit)' : '(dinas luar)');
                    
                    window.currentNearestTenantId = closest.tenant_id;
                    window.lastDistanceResult = closest.distance;
                    return closest;
                }
            }
        }

        console.log('[VALIDATE_RADIUS] Not within any location in database');
        return {
            withinRadius: false,
            distance: 0,
            radius: 0,
            schoolName: 'Tidak dalam lokasi manapun'
        };

    } catch (error) {
        console.error('Error validating radius:', error);
        return {
            withinRadius: false,
            distance: 0,
            radius: 0,
            schoolName: 'Error validasi'
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
                loadAttendanceRules(currentLocation.latitude, currentLocation.longitude);
                updateAttendanceButtonsState();
                await detectNearbyUnits(position.coords.latitude, position.coords.longitude);
                startLocationWatcher();

            },
            function (error) {
                console.error('Location error:', error);
                updateLocationDisplay(false, getLocationErrorMessage(error));
                loadAttendanceRules(); // Fallback: load rules tanpa lokasi
                updateAttendanceButtonsState();
            },
            {
                enableHighAccuracy: true,
                timeout: 20000,
                maximumAge: 300000
            }
        );
    } else {
        updateLocationDisplay(false, 'Geolokasi tidak didukung oleh browser ini.');
        loadAttendanceRules(); // Fallback: load rules tanpa lokasi
        updateAttendanceButtonsState();
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
                loadAttendanceRules(newLocation.latitude, newLocation.longitude);
                loadRecentAttendance().then(() => updateAttendanceButtonsState());
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

    const checkInBtn = document.getElementById('checkInBtn');
    const checkOutBtn = document.getElementById('checkOutBtn');

    // Disable buttons immediately to prevent double-click
    if (checkInBtn) { checkInBtn.disabled = true; checkInBtn.style.opacity = '0.6'; }
    if (checkOutBtn) { checkOutBtn.disabled = true; checkOutBtn.style.opacity = '0.6'; }

    const radiusCheck = await validateLocationRadius(currentLocation.latitude, currentLocation.longitude);
    if (!radiusCheck.withinRadius) {
        if (checkInBtn) { checkInBtn.disabled = false; checkInBtn.style.opacity = ''; }
        if (checkOutBtn) { checkOutBtn.disabled = false; checkOutBtn.style.opacity = ''; }
        alert(`Anda di luar radius: ${radiusCheck.schoolName}`);
        return;
    }

    // Update currentNearestTenantId from radius check result
    if (radiusCheck.tenant_id) {
        window.currentNearestTenantId = radiusCheck.tenant_id;
    }

    const now = new Date();
    const currentMin = now.getHours() * 60 + now.getMinutes();

    const matchedRule = window.currentAttendanceRules.find(r => {
        const [h1, m1] = r.jam_mulai.split(':');
        const [h2, m2] = r.jam_selesai.split(':');
        return currentMin >= (h1 * 60 + +m1) && currentMin < (h2 * 60 + +m2) && r.tipe.toLowerCase() === (jenis === 'masuk' ? 'datang' : 'pulang');
    });

    if (!matchedRule) {
        if (checkInBtn) { checkInBtn.disabled = false; checkInBtn.style.opacity = ''; }
        if (checkOutBtn) { checkOutBtn.disabled = false; checkOutBtn.style.opacity = ''; }
        alert("Saat ini bukan jam absen yang diizinkan.");
        return;
    }

    const formData = new FormData();
    formData.append('jenis', jenis);
    formData.append('metode', 'dashboard');
    formData.append('latitude', currentLocation.latitude);
    formData.append('longitude', currentLocation.longitude);
    formData.append('waktu_absen', now.toISOString());
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

    // Handle offline mode - save to localStorage if no internet
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

    try {
        const response = await fetch('/api/attendance', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + (window.token || localStorage.getItem('token'))
            },
            body: formData
        });

        const result = await response.json();

        // Refresh UI
        await new Promise(r => setTimeout(r, 500));
        await loadRecentAttendance();
        loadTodaySummary();

        // Update button disabled state based on time rules
        updateAttendanceButtonsState();

        requestAnimationFrame(async () => {
            if (result.success) {
                // Small delay to ensure UI updates
                await new Promise(r => setTimeout(r, 100));

                Swal.fire({
                    title: 'Berhasil',
                    text: result.message,
                    icon: 'success',
                    confirmButtonColor: '#066e3a'
                });
            } else {
                // Re-enable buttons on failure
                if (checkInBtn) { checkInBtn.disabled = false; checkInBtn.style.opacity = ''; }
                if (checkOutBtn) { checkOutBtn.disabled = false; checkOutBtn.style.opacity = ''; }

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
        // Re-enable buttons on error
        if (checkInBtn) { checkInBtn.disabled = false; checkInBtn.style.opacity = ''; }
        if (checkOutBtn) { checkOutBtn.disabled = false; checkOutBtn.style.opacity = ''; }
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

async function loadAttendanceRules(lat, lng) {
    try {
        let url = '/api/attendance-rules';
        if (lat && lng) {
            url += `?lat=${lat}&lng=${lng}`;
        }
        
        const response = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + (window.token || localStorage.getItem('token')) }
        });

        if (response.ok) {
            const result = await response.json();
            if (result.success) {
                window.currentAttendanceRules = result.rules;
                console.log('[DASHBOARD] Aturan absensi berhasil dimuat:', result.source_tenant, window.currentAttendanceRules);
            }
        }
    } catch (error) {
        console.error('Gagal mengambil data aturan absensi dari server:', error);
    }
}

function updateAttendanceButtons(hasMasuk, hasPulang) {
    const checkInBtn = document.getElementById('checkInBtn');
    const checkOutBtn = document.getElementById('checkOutBtn');

    if (!hasMasuk) {
        checkInBtn.style.display = 'inline-block';
        checkOutBtn.style.display = 'none';
        checkInBtn.disabled = true; // Start disabled, updateAttendanceButtonsState will enable if valid
        checkInBtn.innerHTML = '<i class="fas fa-sign-in-alt" style="margin-right: 0.5rem;"></i>Absen Masuk';
    } else if (!hasPulang) {
        checkInBtn.style.display = 'none';
        checkOutBtn.style.display = 'inline-block';
        checkOutBtn.disabled = true; // Start disabled, updateAttendanceButtonsState will enable if valid
        checkOutBtn.innerHTML = '<i class="fas fa-sign-out-alt" style="margin-right: 0.5rem;"></i>Absen Pulang';
    } else {
        checkInBtn.style.display = 'none';
        checkOutBtn.style.display = 'none';
        updateLocationDisplay(true, 'Absensi hari ini telah lengkap ✅');
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
        if (data && data.data && data.data.user && data.data.user.is_default_password) {
            console.log('Showing password change modal now');
            const modal = document.getElementById('changePasswordModal');
            console.log('Modal element:', modal);
            if (modal) {
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
    try {
        const response = await fetch('/api/attendance-history', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log('Attendance history response status:', response.status);

        const recentDiv = document.getElementById('recentAttendance');

        // Ambil elemen widget status atas
        const statusBox = document.getElementById('lastStatus');
        const timeBox = document.getElementById('lastTime');
        const totalBox = document.getElementById('totalAttendance');

        // TANGKAP KEDUA TOMBOL ASLI ANDA
        const checkInBtn = document.getElementById('checkInBtn');
        const checkOutBtn = document.getElementById('checkOutBtn');

        if (response.ok) {
            const data = await response.json();
            console.log('Attendance history data:', data);

            if (data.success && data.data.length > 0) {
                // Check if user is multi-tenant
                const isMultiTenant = window.userAssignments && window.userAssignments.length > 1;

                const todayLocal = new Date();
                const localDateStr = todayLocal.getFullYear() + '-' + String(todayLocal.getMonth() + 1).padStart(2, '0') + '-' + String(todayLocal.getDate()).padStart(2, '0');

                // 1. Render data ke dalam HTML riwayat - SEMUA log tampil (termasuk unit lain)
                const activeTenantId = window.currentNearestTenantId || window.userAssignments?.[0]?.tenant_id;
                // Render semua log yang diterima, dikelompokkan per bulan. Tampilkan 3 item visible, sisanya bisa di-scroll
                const groups = {};
                const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des'];

                data.data.forEach(attendance => {
                    const [datePart, timePart] = (attendance.waktu_scan || '').split(' ');
                    const [y, m, d] = (datePart || '').split('-');
                    const groupKey = y && m ? `${y}-${m}` : 'unknown';
                    if (!groups[groupKey]) groups[groupKey] = [];
                    groups[groupKey].push({ attendance, datePart, timePart });
                });

                let html = '';
                Object.keys(groups).forEach(groupKey => {
                    if (groupKey === 'unknown') return; // skip malformed
                    const [y, m] = groupKey.split('-');
                    html += `<div class="attendance-month-group" style="margin-bottom:0.75rem;"><h4 style="font-size:0.9rem;font-weight:700;color:#0f172a;margin:0 0 0.5rem 0;">${monthNames[parseInt(m, 10) - 1] || m} ${y}</h4>`;
                    groups[groupKey].forEach((item, idx) => {
                        const attendance = item.attendance;
                        const datePart = item.datePart || '';
                        const timePart = item.timePart || '';
                        const [yy, mm, dd] = datePart.split('-');
                        const shortDate = dd ? `${parseInt(dd, 10)} ${monthNames[parseInt(mm, 10) - 1]}` : '';
                        const timeStr = timePart ? timePart.slice(0, 5) : '';
                        const jenisText = attendance.jenis === 'masuk' ? 'Masuk' : 'Pulang';
                        const statusText = attendance.status === 'tepat_waktu' ? 'Tepat Waktu' : 'Terlambat';
                        const ruleDesc = attendance.rule_keterangan ? `<div class="text-xs text-gray-400 mt-1">${attendance.rule_keterangan}</div>` : '';
                        const schoolHtml = (isMultiTenant && attendance.nama_sekolah) ? `<div class="text-xs text-gray-500 mt-0.5">${attendance.nama_sekolah}</div>` : '';

                        html += `<div class="recent-attendance-item" style="padding:0.6rem 0.5rem; border-bottom:1px solid #f1f5f9; display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem;">
                    <div style="flex:1;">
                      <div style="display:flex; align-items:center; gap:0.5rem;">
                        <span style="font-weight:700;color:#0f172a">${shortDate}</span>
                        <span style="color:#94a3b8">|</span>
                        <span style="font-weight:600; color:${attendance.jenis === 'masuk' ? '#16a34a' : '#dc2626'}">${jenisText}</span>
                      </div>
                      <div style="font-size:0.78rem;color:#6b7280;margin-top:0.25rem">${timeStr} • ${statusText}</div>
                      ${ruleDesc}
                      ${schoolHtml}
                    </div>
                    <div style="margin-left:0.5rem; font-size:0.8rem; font-weight:700; display:flex; align-items:center;">
                      <span class="badge ${attendance.status === 'tepat_waktu' ? 'badge-success' : 'badge-warning'}">${statusText}</span>
                    </div>
                  </div>`;
                    });
                    html += `</div>`;
                });

                recentDiv.innerHTML = html;

                // Atur wrapper supaya menampilkan 3 item saja dan sisanya scrollable
                const wrapperEl = document.getElementById('historyWrapper');
                if (wrapperEl) {
                    // tinggi kira-kira 3 item × 64px
                    wrapperEl.style.maxHeight = '210px';
                    wrapperEl.style.overflowY = 'auto';
                }
                // Hilangkan tombol 'Lihat Selengkapnya'
                const toggleBtn = document.getElementById('toggleHistoryBtn'); if (toggleBtn) toggleBtn.style.display = 'none';
                const fadeEl = document.getElementById('historyFade'); if (fadeEl) fadeEl.style.display = 'none';

                // 2. SINKRONISASI TOTAL & JAM DARI DATA PALING BARU
                if (totalBox) totalBox.innerText = data.data.length;

                // Filter log terbaru untuk unit yang aktif (multi-tenant support)
                // Setiap unit harus absen terpisah - tidak boleh terpengaruh log unit lain
                const todaysLogs = data.data.filter(log => {
                    const logDate = log.waktu_scan ? log.waktu_scan.split(' ')[0] : '';
                    return logDate === localDateStr && log.tenant_id === activeTenantId;
                });
                // Jika sudah absen di unit ini hari ini, gunakan log terbaru unit ini
                // Jika belum absen di unit ini, jangan fallback ke unit lain (biarkan tombol muncul)
                const logTerbaru = todaysLogs[0] || { jenis: null, tenant_id: activeTenantId };
                const logParts = logTerbaru.waktu_scan ? logTerbaru.waktu_scan.split(' ') : [];

                // Set timeBox dari waktu lokal database
                if (timeBox && logParts.length >= 2) {
                    const logTimePart = logParts[1];
                    timeBox.innerText = logTimePart ? logTimePart.slice(0, 5).replace(':', '.') : '';
                }

                // 3. SINKRONISASI KOTAK STATUS AKHIR
                const teksHtmlBaru = recentDiv.innerHTML.toLowerCase();
                const logDatePart = logParts[0] || '';
                const isLogToday = logDatePart && logDatePart === localDateStr;

                if (statusBox) {
                    // Prioritas: pulang > masuk (log terbaru menentukan)
                    if (isLogToday && logTerbaru.jenis === 'pulang') {
                        statusBox.innerText = 'Sudah Pulang';
                        statusBox.style.setProperty('background', '#eff6ff', 'important');
                        statusBox.style.setProperty('color', '#1e40af', 'important');
                    } else if (isLogToday && logTerbaru.jenis === 'masuk') {
                        statusBox.innerText = 'Sudah Masuk';
                        statusBox.style.setProperty('background', '#e2fbe8', 'important');
                        statusBox.style.setProperty('color', '#15803d', 'important');
                    }
                }

                // ========================================================
                // 4. KONTROL TAMPILAN DUA TOMBOL (SHOW / HIDE)
                // ========================================================
                // KONTROL TAMPILAN DUA TOMBOL (SHOW / HIDE)
                if (isLogToday && logTerbaru.jenis === 'masuk') {
                    // JIKA BARU ABSEN MASUK HARI INI -> Sembunyikan Tombol Masuk, Munculkan Tombol Pulang
                    if (checkInBtn) checkInBtn.style.display = 'none';
                    if (checkOutBtn) checkOutBtn.style.display = 'inline-block';

                } else if (isLogToday && logTerbaru.jenis === 'pulang') {
                    // JIKA SUDAH ABSEN PULANG HARI INI -> Sembunyikan kedua tombol (Absensi beres)
                    if (checkInBtn) checkInBtn.style.display = 'none';
                    if (checkOutBtn) checkOutBtn.style.display = 'none';
                } else {
                    // Log terbaru dari hari lain -> TAMPilkan tombol Masuk (belum absen hari ini)
                    if (checkInBtn) checkInBtn.style.display = 'inline-block';
                    if (checkOutBtn) checkOutBtn.style.display = 'none';
                }
            } else {
                // KONDISI JIKA BELUM ADA LOG ABSENSI SAMA SEKALI (AWAL HARI)
                recentDiv.innerHTML = '<p class="text-center text-gray-500">Belum ada riwayat absensi</p>';
                if (statusBox) {
                    statusBox.innerText = 'Belum absen';
                    statusBox.style.setProperty('background', '#fef3c7', 'important');
                    statusBox.style.setProperty('color', '#92400e', 'important');
                }
                if (timeBox) timeBox.innerText = '-';
                if (totalBox) totalBox.innerText = '0';

                // KONDISI AWAL: Munculkan Tombol Masuk saja, Sembunyikan Tombol Pulang
                if (checkInBtn) checkInBtn.style.display = 'block';
                if (checkOutBtn) checkOutBtn.style.display = 'none';
            }
        } else {
            console.log('Response not ok');
            recentDiv.innerHTML = '<p class="text-center text-red-500">Gagal memuat riwayat</p>';
        }
    } catch (error) {
        console.error('Recent attendance load error:', error);
        document.getElementById('recentAttendance').innerHTML = '<p class="text-center text-red-500">Error loading data</p>';
    }
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

function closeChangePasswordModal() {
    document.getElementById('changePasswordModal').classList.remove('show');
    // Clear fields
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
            Swal.fire('Error', result.message, 'error');
        }
    } catch (error) {
        console.error('Change password error:', error);
        Swal.fire('Error', 'Terjadi kesalahan', 'error');
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

function initializeDashboard() {
    console.log('Initializing dashboard');
    setTeacherInfo();
    requestLocationPermission();
    loadTodaySummary();
    loadRecentAttendance();
    loadLeaveStatus();
    checkActiveLeave();
    updateConnectionStatus();
    // loadAttendanceRules() dipanggil dari requestLocationPermission setelah lokasi didapatkan
    initQuranWidget(); // Initialize Quran widget

    window.attendanceInterval = setInterval(function () {
        if (currentLocation) {
            updateAttendanceButtonsState();
        }
        checkActiveLeave(); // Cek izin setiap detik
    }, 1000);

    window.addEventListener('online', syncOfflineAttendance);
    window.addEventListener('offline', showOfflineMessage);
}

// ========================================================
// JURUS PAMUNGKAS: PAKSA SINKRONISASI SETELAH HALAMAN SIAP
// ========================================================
window.addEventListener('DOMContentLoaded', () => {
    // 1. Pastikan fungsi utama Anda dijalankan saat startup
    if (typeof loadRecentAttendance === 'function') {
        loadRecentAttendance();
    }
});

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

// Setup mobile & desktop nav
function setupMobileAdminNav() {
    const mobileNav = document.getElementById('mobileAdminNav');
    const desktopBtn = document.getElementById('desktopAdminBtn');

    // Filter unit dengan role admin
    const adminUnits = (window.userAssignments || []).filter(a => {
        const jabatan = (a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, '');
        const adminRoles = ['admin', 'operator', 'media', 'tu', 'tatausaha'];
        return adminRoles.some(role => jabatan.includes(role));
    });

    if (adminUnits.length > 0) {
        if (mobileNav) {
            mobileNav.style.display = 'block';
            mobileNav.onclick = () => showAdminUnitModal(adminUnits);
        }
        if (desktopBtn) {
            desktopBtn.style.display = 'block';
            desktopBtn.onclick = () => showAdminUnitModal(adminUnits);
        }
    }
}

// Menampilkan Modal
function showAdminUnitModal(units) {
    const listEl = document.getElementById('adminUnitList');
    const modal = document.getElementById('adminUnitModal');
    const confirmBtn = document.getElementById('confirmAdminUnitBtn');

    if (!listEl || !modal) return;

    currentAdminUnits = units;
    selectedAdminUnitId = null;

    // Gunakan template ini di dalam fungsi .map Anda
    listEl.innerHTML = units.map((unit) => `
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
    setTimeout(setupMobileAdminNav, 2000);
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
                tenant_id: window.currentNearestTenantId || window.userAssignments?.[0]?.tenant_id
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
}