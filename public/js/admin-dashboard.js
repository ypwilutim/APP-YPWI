// Hidden filters for modal triggers
const hiddenFilters = document.createElement('div');
hiddenFilters.style.display = 'none';
hiddenFilters.innerHTML = '<select id="teacherTenantFilter"><option value="">Semua Sekolah</option></select>';
document.body.appendChild(hiddenFilters);

let currentTeacherId = null;
let currentRuleId = null;
let currentPage = 1;
let totalPages = 1;
let pageLimit = 10;
let currentMapContext = 'edit';

function showToast(msg, type='info') {
  console.log('[TOAST]', msg);
}

const setEl = (id, val) => {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = val;
    el.classList.remove('skeleton-loader', 'skeleton-text-lg');
  }
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
window.autoDetectLocation = autoDetectLocation;
window.editTenantLocation = editTenantLocation;
window.autoDetectLocationModal = autoDetectLocationModal;

let locationMap = null;
let locationMarker = null;

window.toggleMap = function () {
  const mapContainer = document.getElementById('mapContainer');
  const mapDiv = document.getElementById('locationMap');
  
  if (mapContainer && mapDiv) {
    const isHidden = mapContainer.classList.contains('hidden');
    mapContainer.classList.toggle('hidden');
    mapContainer.style.display = mapContainer.classList.contains('hidden') ? 'none' : 'block';
    
    if (isHidden && !locationMap) {
      initLocationMap();
    }
    if (!mapContainer.classList.contains('hidden') && locationMap) {
      setTimeout(() => locationMap.invalidateSize(), 100);
    }
  }
};

function initLocationMap() {
  const mapDiv = document.getElementById('locationMap');
  if (!mapDiv || locationMap) return;
  
  locationMap = L.map('locationMap').setView([-2.2166, 113.9209], 5);
  
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(locationMap);
  
  const latInput = document.getElementById('latitudeInput');
  const lngInput = document.getElementById('longitudeInput');
  
  locationMap.on('click', function(e) {
    const lat = e.latlng.lat.toFixed(6);
    const lng = e.latlng.lng.toFixed(6);
    
    if (latInput) latInput.value = lat;
    if (lngInput) lngInput.value = lng;
    
    if (locationMarker) locationMap.removeLayer(locationMarker);
    locationMarker = L.marker([lat, lng], { draggable: true }).addTo(locationMap);
    
    locationMarker.on('dragend', function(e) {
      const newLat = e.target.getLatLng().lat.toFixed(6);
      const newLng = e.target.getLatLng().lng.toFixed(6);
      if (latInput) latInput.value = newLat;
      if (lngInput) lngInput.value = newLng;
      updateCoordinatePreview();
    });
    
    updateCoordinatePreview();
  });
  
  if (latInput && lngInput && latInput.value && lngInput.value) {
    const lat = parseFloat(latInput.value);
    const lng = parseFloat(lngInput.value);
    if (!isNaN(lat) && !isNaN(lng)) {
      locationMap.setView([lat, lng], 15);
      locationMarker = L.marker([lat, lng], { draggable: true }).addTo(locationMap);
      locationMarker.on('dragend', function(e) {
        const newLat = e.target.getLatLng().lat.toFixed(6);
        const newLng = e.target.getLatLng().lng.toFixed(6);
        latInput.value = newLat;
        lngInput.value = newLng;
        updateCoordinatePreview();
      });
    }
  }
}

window.centerMapOnCurrent = function () {
  if (!locationMap) return;
  const latInput = document.getElementById('latitudeInput');
  const lngInput = document.getElementById('longitudeInput');
  if (latInput && lngInput && latInput.value && lngInput.value) {
    const lat = parseFloat(latInput.value);
    const lng = parseFloat(lngInput.value);
    if (!isNaN(lat) && !isNaN(lng)) {
      locationMap.setView([lat, lng], 15);
      if (locationMarker) locationMap.removeLayer(locationMarker);
      locationMarker = L.marker([lat, lng], { draggable: true }).addTo(locationMap);
    }
  }
};

window.clearMapMarker = function () {
  if (locationMarker && locationMap) {
    locationMap.removeLayer(locationMarker);
    locationMarker = null;
  }
  document.getElementById('latitudeInput').value = '';
  document.getElementById('longitudeInput').value = '';
  updateCoordinatePreview();
};

window.updateMiniMap = function (lat, lng) {
  const miniMapDiv = document.getElementById('locationMiniMap');
  if (!miniMapDiv || !lat || !lng) return;
  
  miniMapDiv.innerHTML = '';
  
  const miniMap = L.map('locationMiniMap', {
    center: [lat, lng],
    zoom: 15,
    zoomControl: false
  });
  
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: ''
  }).addTo(miniMap);
  
  L.marker([lat, lng]).addTo(miniMap);
};

window.updateLocationMap = function (lat, lng) {
  if (!lat || !lng) return;
  
  const mapContainer = document.getElementById('mapContainer');
  if (mapContainer) mapContainer.classList.remove('hidden');
  
  if (!locationMap) initLocationMap();
  
  const parsedLat = parseFloat(lat);
  const parsedLng = parseFloat(lng);
  
  if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
    locationMap.setView([parsedLat, parsedLng], 15);
    if (locationMarker) locationMap.removeLayer(locationMarker);
    locationMarker = L.marker([parsedLat, parsedLng], { draggable: true }).addTo(locationMap);
    
    locationMarker.on('dragend', function(e) {
      const newLat = e.target.getLatLng().lat.toFixed(6);
      const newLng = e.target.getLatLng().lng.toFixed(6);
      document.getElementById('latitudeInput').value = newLat;
      document.getElementById('longitudeInput').value = newLng;
      updateCoordinatePreview();
    });
  }
};

window.updateCoordinatePreview = updateCoordinatePreview;

function updateCoordinatePreview() {
  const lat = document.getElementById('latitudeInput')?.value;
  const lng = document.getElementById('longitudeInput')?.value;
  const preview = document.getElementById('coordinatePreview');
  
  if (lat && lng) {
    const parsedLat = parseFloat(lat).toFixed(6);
    const parsedLng = parseFloat(lng).toFixed(6);
    preview.innerHTML = `📍 ${parsedLat}, ${parsedLng}`;
    document.getElementById('coordinateAccuracy')?.classList.remove('hidden');
  } else {
    preview.innerHTML = '<span class="text-gray-500">Belum ada koordinat dipilih</span>';
    document.getElementById('coordinateAccuracy')?.classList.add('hidden');
  }
}

window.copyCoordinates = function () {
  const lat = document.getElementById('latitudeInput')?.value;
  const lng = document.getElementById('longitudeInput')?.value;
  if (lat && lng) {
    navigator.clipboard.writeText(`${parseFloat(lat).toFixed(6)}, ${parseFloat(lng).toFixed(6)}`).then(() => {
      showToast('Koordinat disalin!', 'success');
    });
  }
};
window.copyCoordinatesModal = function () {
  const lat = document.getElementById('locationLat')?.value;
  const lng = document.getElementById('locationLng')?.value;
  if (lat && lng) {
    navigator.clipboard.writeText(`${lat}, ${lng}`).then(() => {
      showToast('Koordinat disalin!', 'success');
    });
  }
};
window.goToPage = goToPage;
window.prevPage = prevPage;
window.nextPage = nextPage;

// Stub functions for location modal and device management
window.hideTenantLocationModal = function () {
  const modal = document.getElementById('tenantLocationModal');
  if (modal) modal.classList.add('hidden');
};
window.hideAddDeviceModal = function () {
  const modal = document.getElementById('addDeviceModal');
  if (modal) modal.classList.remove('show');
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
window.loadScannerDevices = async function () {
  const container = document.getElementById('devices-list');
  if (!container) return;
  container.innerHTML = '<div class="text-center py-8 text-gray-500"><i class="fas fa-spinner fa-spin text-xl mb-2"></i><p>Memuat data device...</p></div>';

  try {
    const response = await fetch('/api/scanner/devices', {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });
    const data = await response.json();
    if (data.success) {
      container.innerHTML = data.data.map(d => `
        <div class="bg-white border border-gray-200 rounded-lg p-4 flex justify-between items-center">
          <div>
            <h5 class="font-medium">${d.school_name}</h5>
            <p class="text-sm text-gray-600">${d.device_name} - ${d.status}</p>
            <p class="text-xs text-gray-500">Total Scan: ${d.total_scans || 0}</p>
          </div>
          <div class="flex space-x-2">
            <button onclick="editDevice('${d.device_id}')" class="text-blue-600"><i class="fas fa-edit"></i></button>
            <button onclick="deleteDevice('${d.device_id}')" class="text-red-600"><i class="fas fa-trash"></i></button>
          </div>
        </div>
      `).join('') || '<p class="text-center text-gray-500 py-8">Tidak ada device terdaftar</p>';
    }
  } catch (error) {
    container.innerHTML = '<p class="text-red-500">Error memuat devices</p>';
  }
};
window.loadQRLogs = async function () {
  const tbody = document.getElementById('qr-logs-table');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-500"><i class="fas fa-spinner fa-spin mr-2"></i>Memuat logs...</td></tr>';

  try {
    const response = await fetch('/api/scanner/attendance/logs?limit=50', {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });
    const data = await response.json();
    if (data.success) {
      tbody.innerHTML = data.data.map(log => `
        <tr>
          <td class="px-4 py-3">${log.teacher_name || log.scan_id}</td>
          <td class="px-4 py-3">${log.school_name || '-'}</td>
          <td class="px-4 py-3">${log.device_name || log.device_id}</td>
          <td class="px-4 py-3">${new Date(log.created_at).toLocaleString('id-ID')}</td>
          <td class="px-4 py-3">${log.sync_status === 'synced' ? '<span class="text-green-600">Tersinkron</span>' : '<span class="text-yellow-600">Pending</span>'}</td>
        </tr>
      `).join('') || '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-500">Belum ada log</td></tr>';
    }
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-red-500">Error memuat logs</td></tr>';
  }
};
window.loadTenantLocations = fetchTenantLocations;
window.updateToggleVisual = updateToggleVisual;
window.showAddTenantModal = function () {
  const modal = document.getElementById('addTenantModal');
  if (modal) modal.classList.remove('hidden');
};

document.addEventListener('DOMContentLoaded', function () {
  // Run auth check first
  const token = localStorage.getItem('token');
  const userData = localStorage.getItem('user');

  if (!token || !userData) {
    window.location.replace('/login.html');
    return;
  }

  try {
    const user = JSON.parse(userData);
    if (user.role !== 'admin') {
      window.location.replace('/login.html');
      return;
    }
    window.authToken = token;
    window.currentUser = user;

    // Now initialize UI components after auth is confirmed
    initAllUI();
  } catch (e) {
    window.location.replace('/login.html');
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

  // Add settings navigation event listeners
  document.querySelectorAll('.settings-nav-item').forEach(item => {
    item.addEventListener('click', function () {
      const setting = this.getAttribute('data-setting');
      showSettingsTab(setting);
    });
});

// Add modal auto-detect button listener
   document.getElementById('autoDetectModalBtn')?.addEventListener('click', (event) => autoDetectLocationModal(event));

  // Add device modal button
  document.getElementById('add-device-modal-btn')?.addEventListener('click', () => {
    const modal = document.getElementById('addDeviceModal');
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
            select.appendChild(option);
          });
        }
      })
      .catch(error => console.error('Error loading tenants for device modal:', error));
  });


  // Refresh devices button
  document.getElementById('refresh-devices')?.addEventListener('click', loadScannerDevices);

  // Auto evaluation button
  document.getElementById('runAutoEvaluation')?.addEventListener('click', runAutoEvaluation);

  fetchDashboardData();
  fetchTeachers();
  loadStudents();

  // Initialize PDF report and recap view
  initPdfReport();
  initRecapView();

  // WhatsApp functionality
  setupWhatsApp();
}

// Stub functions for QR/report features
function initPdfReport() { }
function initRecapView() { }

function updateWhatsAppStatus(msg, type) {
  const statusDiv = document.getElementById('whatsappStatus');
  if (statusDiv) {
    statusDiv.innerHTML = '<p class="' + (type === 'success' ? 'text-green-600' : 'text-gray-600') + '">' + msg + '</p>';
  }
}

async function loadTenantsForWhatsApp() {
  try {
    const response = await fetch('/api/admin/tenants', {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });
    const data = await response.json();
    if (data.success) {
      const select = document.getElementById('bulkTenantSelect');
      if (select) {
        data.data.forEach(tenant => {
          const option = document.createElement('option');
          option.value = tenant.tenant_id;
          option.textContent = tenant.nama_sekolah;
          select.appendChild(option);
        });
      }
    }
  } catch (error) {
    console.error('Load tenants for WhatsApp error:', error);
  }
}

async function loadTeachersForWhatsApp() {
  try {
    // all=1: tanpa limit, has_wa=1: hanya guru yang punya nomor WA
    const response = await fetch('/api/admin/teachers?all=1&has_wa=1', {
      headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
    });

    if (response.ok) {
      const result = await response.json();
      // Store teacher data for lookup
      window.teacherDataList = result.data || [];

      // Add input event listener for real-time search
      const input = document.getElementById('singleTeacherInput');
      const hiddenInput = document.getElementById('singleTeacherSelect');
      const resultsDiv = document.getElementById('teacherSearchResults');
      const selectedInfo = document.getElementById('teacherSelectedInfo');

      let debounceTimer = null;

      input.addEventListener('input', function () {
        clearTimeout(debounceTimer);
        const query = this.value.trim().toLowerCase();

        if (query.length < 1) {
          resultsDiv.classList.add('hidden');
          resultsDiv.innerHTML = '';
          hiddenInput.value = '';
          selectedInfo.innerHTML = '';
          return;
        }

        debounceTimer = setTimeout(() => {
          const filtered = window.teacherDataList.filter(teacher => {
            if (!teacher.no_wa) return false;
            const nameMatch = (teacher.nama || '').toLowerCase().includes(query);
            const waMatch = (teacher.no_wa || '').includes(query);
            return nameMatch || waMatch;
          });

          if (filtered.length === 0) {
            resultsDiv.innerHTML = '<div class="px-4 py-3 text-sm text-gray-500 text-center">Tidak ada guru ditemukan</div>';
            resultsDiv.classList.remove('hidden');
            hiddenInput.value = '';
          } else {
            resultsDiv.innerHTML = filtered.map(teacher => {
              const assignment = teacher.assignments && teacher.assignments.length > 0 ? teacher.assignments[0] : null;
              const jabatan = assignment ? assignment.jabatan_di_unit || 'Guru' : 'Guru';
              const schoolName = assignment ? assignment.nama_sekolah || '-' : '-';
              return `<div class="teacher-search-item px-4 py-3 hover:bg-blue-50 cursor-pointer text-sm border-b border-gray-100 last:border-b-0"
                      data-id="${teacher.id}"
                      data-nama="${teacher.nama.replace(/"/g, '&quot;')}"
                      data-wa="${teacher.no_wa}"
                      data-jabatan="${jabatan.replace(/"/g, '&quot;')}"
                      data-sekolah="${schoolName.replace(/"/g, '&quot;')}">
                      <div class="font-medium text-gray-900">${teacher.nama}</div>
                      <div class="text-xs text-gray-500">\u{1F4F7} ${teacher.no_wa} &middot; ${jabatan} &middot; ${schoolName}</div>
                    </div>`;
            }).join('');
            resultsDiv.classList.remove('hidden');

            // Attach click handlers to search items
            resultsDiv.querySelectorAll('.teacher-search-item').forEach(item => {
              item.addEventListener('click', function () {
                const id = this.getAttribute('data-id');
                const nama = this.getAttribute('data-nama');
                const wa = this.getAttribute('data-wa');
                const jabatan = this.getAttribute('data-jabatan');
                const sekolah = this.getAttribute('data-sekolah');

                input.value = `${nama} (${wa}) - ${jabatan}`;
                hiddenInput.value = id;
                selectedInfo.innerHTML = `<span class="text-green-600">✅ Dipilih: ${nama} (${sekolah})</span>`;
                resultsDiv.classList.add('hidden');
              });
            });
          }
        }, 200);
      });

      // Close dropdown when clicking outside
      document.addEventListener('click', function (e) {
        if (!resultsDiv.contains(e.target) && e.target !== input) {
          resultsDiv.classList.add('hidden');
        }
      });

      input.addEventListener('blur', function () {
        setTimeout(() => {
          resultsDiv.classList.add('hidden');
        }, 200);
      });

      input.addEventListener('focus', function () {
        if (this.value.trim().length > 0) {
          this.dispatchEvent(new Event('input'));
        }
      });
    }
  } catch (error) {
    console.error('Error loading teachers for WhatsApp:', error);
  }
}

function setupMessageTemplates() {
  // Bulk message templates
  const bulkTemplateSelect = document.getElementById('bulkMessageTemplate');
  const bulkMessageTextarea = document.getElementById('bulkMessage');
  const bulkTemplates = {
    'reminder_absen': 'Mohon segera melakukan absensi untuk hari ini. Mari kita mulai hari dengan catatan kehadiran yang baik.',
    'libur': 'Diberitahukan bahwa besok adalah hari libur. Semoga hari libur ini dapat dimanfaatkan untuk beristirahat dan beribadah.',
    'rapat': 'Diberitahukan bahwa akan diadakan rapat guru hari ini pukul 13:00 WIB di aula sekolah. Kehadiran Saudara/i sangat diharapkan.',
    'selamat_pagi': 'Selamat pagi Bapak/Ibu guru sekalian. Semoga hari ini penuh berkah dan dimudahkan dalam menjalankan tugas mengajar.',
    'motivasi': 'Mari kita jadikan hari ini sebagai hari yang penuh produktivitas dan keberkahan. Semoga Allah SWT memberikan kekuatan dan kemudahan dalam mendidik generasi penerus.'
  };

  bulkTemplateSelect.addEventListener('change', () => {
    const selectedTemplate = bulkTemplateSelect.value;
    if (selectedTemplate && bulkTemplates[selectedTemplate]) {
      bulkMessageTextarea.value = bulkTemplates[selectedTemplate];
    }
  });

  // Single message templates
  const singleTemplateSelect = document.getElementById('singleMessageTemplate');
  const singleMessageTextarea = document.getElementById('singleMessage');

  const singleTemplates = {
    'pribadi': 'Terima kasih atas dedikasi dan pengabdian Bapak/Ibu dalam dunia pendidikan.',
    'peringatan': 'Mohon perhatian untuk hal berikut: [isi peringatan]. Semoga dapat diperbaiki untuk kebaikan bersama.',
    'pujian': 'Alhamdulillah, kami sangat mengapresiasi kerja keras dan kontribusi Bapak/Ibu. Teruslah menjadi teladan yang baik.',
    'permintaan': 'Mohon bantuan Bapak/Ibu untuk [isi permintaan]. Kami sangat menghargai kerjasama Bapak/Ibu.'
  };

  singleTemplateSelect.addEventListener('change', () => {
    const selectedTemplate = singleTemplateSelect.value;
    if (selectedTemplate && singleTemplates[selectedTemplate]) {
      singleMessageTextarea.value = singleTemplates[selectedTemplate];
    }
  });
}

// WhatsApp Functions
function setupWhatsApp() {
  loadTenantsForWhatsApp();
  loadTeachersForWhatsApp();
  setupMessageTemplates();

  // Bulk WhatsApp form
  document.getElementById('bulkWhatsAppForm').addEventListener('submit', async (e) => {
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
  document.getElementById('refreshWhatsApp').addEventListener('click', () => {
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
  const tenantId = window.studentTenantFilterValue || '';

  tbody.innerHTML = '<tr><td colspan="8" class="px-6 py-12 text-center text-gray-500"><i class="fas fa-spinner fa-spin"></i> Memuat...</td></tr>';

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
             <tr>
               <td class="px-6 py-4">
                 <input type="checkbox" class="student-checkbox" value="${s.id}" onchange="updateSelectAllStudents()">
               </td>
               <td class="px-6 py-4">${s.nama_siswa}</td>
               <td class="px-6 py-4">${s.nisn || '-'}</td>
               <td class="px-6 py-4">${s.nis}</td>
               <td class="px-6 py-4">${s.nama_kelas || '-'}</td>
               <td class="px-6 py-4">${s.nama_sekolah || '-'}</td>
               <td class="px-6 py-4">${s.nama_orang_tua || '-'}<br><small>${s.no_wa_ortu || ''}</small></td>
               <td class="px-6 py-4">Rp ${(s.iuran_bulanan || 0).toLocaleString('id-ID')}</td>
               <td class="px-6 py-4">
                 <button onclick="editStudent(${s.id})" class="text-blue-600 hover:text-blue-800 mr-2">
                   <i class="fas fa-edit"></i>
                 </button>
                 <button onclick="updateStudentPayment(${s.id}, ${s.iuran_bulanan || 0})" class="text-green-600 hover:text-green-800 mr-2">
                   <i class="fas fa-wallet"></i>
                 </button>
                 <button onclick="deleteStudent(${s.id})" class="text-red-600 hover:text-red-800">
                   <i class="fas fa-trash"></i>
                 </button>
               </td>
             </tr>
           `).join('') || '<tr><td colspan="9" class="px-6 py-12 text-center text-gray-500">Tidak ada data siswa</td></tr>';

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

function showAddTeacherModal() {
  currentTeacherId = null;
  document.getElementById('teacherModalTitle').textContent = 'Tambah Guru';
  document.getElementById('teacherForm').reset();

  const tenantSelect = document.getElementById('teacherTenantSelect');
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

  document.getElementById('teacherModal').classList.add('show');
}

function hideTeacherModal() {
  document.getElementById('teacherModal').classList.remove('show');
}

function showAddRuleModal() {
  currentRuleId = null;
  document.getElementById('ruleModalTitle').textContent = 'Tambah Aturan';
  document.getElementById('ruleForm').reset();

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
document.getElementById('latitudeInput').addEventListener('input', updateCoordinatePreview);
document.getElementById('longitudeInput').addEventListener('input', updateCoordinatePreview);

// Location form submit handler
document.getElementById('locationForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const tenantId = document.getElementById('locationTenantIdHidden').value;
  const latitude = document.getElementById('latitudeInput').value;
  const longitude = document.getElementById('longitudeInput').value;
  const location_radius = document.getElementById('locationForm').elements['location_radius']?.value;
  const location_name = document.getElementById('locationForm').elements['location_name']?.value;
  const use_central_rules = document.getElementById('useCentralRulesInput').checked;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Menyimpan...';

  try {
    const response = await fetch(`/api/admin/tenants/${tenantId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}`
      },
      body: JSON.stringify({
        latitude,
        longitude,
        location_radius: parseInt(location_radius) || 100,
        location_name,
        use_central_rules: use_central_rules ? 1 : 0
      })
    });

    if (response.status === 401 || response.status === 403) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.replace('login.html');
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
    submitBtn.innerHTML = originalText;
  }
});

async function fetchTenantLocations() {
  try {
    const response = await fetch('/api/admin/tenants', {
      headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
    });

    if (response.status === 401 || response.status === 403) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.replace('login.html');
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
                      <div class="w-11 h-6 bg-gray-200 rounded-full toggle-track transition-colors duration-200 ${tenant.use_central_rules ? 'bg-blue-600' : ''}"></div>
                      <div class="absolute left-0.5 top-0.5 w-5 h-5 bg-white border border-gray-300 rounded-full toggle-thumb transition-transform duration-200 ${tenant.use_central_rules ? 'translate-x-5' : ''}"><i class="fas fa-check text-xs text-white mt-1 ml-0.5"></i></div>
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

function hideLocationModal() {
  const modal = document.getElementById('locationModal');
  if (!modal) return;

  modal.classList.remove('show', 'flex');
  modal.classList.add('hidden');

  const checkbox = document.getElementById('useCentralRulesInput');
  if (checkbox) {
    checkbox.checked = false;
    updateToggleVisual(checkbox);
  }
}

function showLocationModal() {
  const modal = document.getElementById('locationModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.classList.add('show');
  setTimeout(() => {
    if (locationMap) locationMap.invalidateSize();
  }, 100);
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

function showTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.add('hidden');
  });

  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('nav-active');
    item.classList.add('text-gray-600');
  });

  const tab = document.getElementById(tabName + 'Tab');
  const navItem = document.querySelector(`[data-tab="${tabName}"]`);

  if (tab) tab.classList.remove('hidden');
  if (navItem) navItem.classList.add('nav-active');

  const titles = {
    dashboard: 'Dashboard',
    teachers: 'Manajemen Guru',
    students: 'Manajemen Siswa',
    evaluations: 'Penilaian Guru Otomatis',
    attendance: 'Log Kehadiran',
    whatsapp: 'Pesan WhatsApp',
    payroll: 'Penggajian',
    documents: 'Dokumen HR',
    'qr-generator': 'QR Scanner & Generator',
    settings: 'Pengaturan'
  };

  document.getElementById('pageTitle').textContent = titles[tabName] || tabName;

  // Load data when tab is opened
  if (tabName === 'qr-generator') {
    loadScannerDevices();
    loadQRLogs();
  } else if (tabName === 'settings') {
    // Show locations tab by default and load tenant locations
    showSettingsTab('locations');
    fetchTenantLocations();
  }
}

async function editRule(id) {
  try {
    const response = await fetch(`/api/admin/rules/${id}`, {
      headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
    });
    const res = await response.json();

    if (res.success) {
      // PERBAIKAN: Set variabel global id agar sistem tahu form ini sedang dalam mode EDIT
      currentRuleId = id;

      const rule = res.data;
      document.getElementById('ruleModalTitle').textContent = 'Edit Aturan';
      const form = document.getElementById('ruleForm');
      form.tenant_id.value = rule.tenant_id;
      form.tipe.value = rule.tipe;
      form.jam_mulai.value = rule.jam_mulai;
      form.jam_selesai.value = rule.jam_selesai;
      form.keterangan.value = rule.keterangan;
      form.status_log.value = rule.status_log;

      // ... sisa kode pengisian tenant option Anda di bawahnya tetap sama ...

      // Populate tenant options if not already done
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
      }

      document.getElementById('ruleModal').classList.add('show');
    }
  } catch (error) {
    console.error('Error fetching rule detail:', error);
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

function toggleSelectAll() {
  const selectAll = document.getElementById('selectAll');
  const checkboxes = document.querySelectorAll('.teacher-checkbox');
  checkboxes.forEach(cb => cb.checked = selectAll.checked);
}

function getSelectedTeacherIds() {
  const checkboxes = document.querySelectorAll('.teacher-checkbox:checked');
  return Array.from(checkboxes).map(cb => parseInt(cb.value));
}

function updateSelectAll() {
  const checkboxes = document.querySelectorAll('.teacher-checkbox');
  const selectAll = document.getElementById('selectAll');
  selectAll.checked = checkboxes.length > 0 && Array.from(checkboxes).every(cb => cb.checked);
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
        document.getElementById('locationTenantIdHidden').value = tenant.tenant_id;
        document.getElementById('locationNamaSekolah').value = tenant.nama_sekolah;
        document.getElementById('latitudeInput').value = tenant.latitude || '';
        document.getElementById('longitudeInput').value = tenant.longitude || '';
        document.getElementById('locationForm').elements['location_radius'].value = tenant.location_radius || 100;
        document.getElementById('locationForm').elements['location_name'].value = tenant.location_name || '';
        // Set toggle for use_central_rules
        const useCentralRulesCheckbox = document.getElementById('useCentralRulesInput');
        useCentralRulesCheckbox.checked = tenant.use_central_rules === true;
        updateToggleVisual(useCentralRulesCheckbox);

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




function attachLocationButtonListeners() {
  document.querySelectorAll('[data-action="auto-detect"]').forEach(btn => {
    btn.addEventListener('click', function () {
      const tenantId = this.getAttribute('data-tenant-id');
      autoDetectLocation(tenantId);
    });
  });

  document.querySelectorAll('[data-action="edit-location"]').forEach(btn => {
    btn.addEventListener('click', function () {
      const tenantId = this.getAttribute('data-tenant-id');
      editTenantLocation(tenantId);
    });
  });

  // Toggle central rules
  document.querySelectorAll('[data-action="toggle-central"]').forEach(cb => {
    cb.addEventListener('change', async function() {
      const tenantId = this.getAttribute('data-tenant-id');
      const isChecked = this.checked;
      try {
        const response = await fetch('/api/admin/tenants/' + tenantId, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + localStorage.getItem('token')
          },
          body: JSON.stringify({ use_central_rules: isChecked ? 1 : 0 })
        });
        const data = await response.json();
        if (data.success) {
          updateToggleVisual(this);
        }
      } catch (error) {
        console.error('Toggle error:', error);
      }
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
      window.location.replace('login.html');
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

function updateAllToggleVisuals() {
  document.querySelectorAll('.toggle-checkbox').forEach(checkbox => {
    updateToggleVisual(checkbox);
  });
}


function updateToggleVisual(checkbox, event) {
  // Mencegah propagasi event agar tidak memicu form submit atau aksi lain di parent
  if (event) {
    event.stopPropagation();
    event.preventDefault(); // Mencegah perilaku default browser jika perlu
  }

  const track = checkbox.closest('.relative')?.querySelector('.toggle-track');
  const thumb = checkbox.closest('.relative')?.querySelector('.toggle-thumb');

  if (!track || !thumb) return;

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

// Teacher Transfer Function
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

  const result = await Swal.fire({
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
  });

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
};

// Student Transfer Function
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

  const result = await Swal.fire({
    title: 'Mutasi Siswa',
    html: `
      <select id="studentTransferTenant" class="swal2-input">
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
  });

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
};

function getSelectedStudentIds() {
  const checkboxes = document.querySelectorAll('.student-checkbox:checked');
  return Array.from(checkboxes).map(cb => parseInt(cb.value));
}

// Load classes by tenant for student transfer
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
};

async function handleSubmitDevice(event) {
  event.preventDefault();
  const tenantId = document.getElementById('deviceTenantId').value;
  const status = document.getElementById('deviceStatus').value;
  const token = document.getElementById('deviceRegistrationToken').value;

  try {
    const response = await fetch('/api/admin/devices', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('token')
      },
      body: JSON.stringify({ tenant_id: tenantId, status, registration_token: token })
    });
    const data = await response.json();
    if (data.success) {
      hideAddDeviceModal();
      if (typeof loadScannerDevices === 'function') loadScannerDevices();
      alert('Device berhasil ditambahkan');
    } else {
      alert('Error: ' + data.message);
    }
  } catch (error) {
    console.error('Submit device error:', error);
    alert('Terjadi kesalahan');
  }
}

// Generate random token for device
function generateDeviceToken() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Regenerate token button handler
document.getElementById('btnRegenerateToken')?.addEventListener('click', function() {
  const tokenInput = document.getElementById('deviceRegistrationToken');
  if (tokenInput) tokenInput.value = generateDeviceToken();
});

// Copy token button handler
document.getElementById('btnCopyDeviceToken')?.addEventListener('click', function() {
  const tokenInput = document.getElementById('deviceRegistrationToken');
  if (tokenInput && tokenInput.value) {
    navigator.clipboard.writeText(tokenInput.value).then(() => {
      alert('Token disalin!');
    }).catch(() => {
      alert('Gagal menyalin token');
    });
  }
});

window.showMutasiTeachersModal = function () {
  const selectedIds = getSelectedTeacherIds();
  if (selectedIds.length === 0) {
    alert('Pilih guru yang ingin dimutasi');
    return;
  }
  showTeacherTransferModal();
};
window.showTeacherFilterModal = function () {
  console.log('Teacher filter modal belum diimplementasi');
  alert('Fitur filter guru belum tersedia');
};
window.updateSelectAllStudents = updateSelectAllStudents;

function updateSelectAllStudents() {
  const checkboxes = document.querySelectorAll('.student-checkbox');
  const selectAll = document.getElementById('selectAllStudents');
  if (checkboxes.length > 0) {
    selectAll.checked = Array.from(checkboxes).every(cb => cb.checked);
  }
}

async function fetchTeachers(page = 1) {
  currentPage = page;
  const tbody = document.getElementById('teachersTable');
  tbody.innerHTML = '<tr><td colspan="8" class="px-6 py-12 text-center text-gray-500"><i class="fas fa-spinner fa-spin"></i> Memuat...</td></tr>';

  try {
    const response = await fetch('/api/admin/teachers?page=' + page + '&limit=' + pageLimit, {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });
    const data = await response.json();
    if (data.success) {
      tbody.innerHTML = data.data.map(t => `
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
      `).join('') || '<tr><td colspan="8" class="px-6 py-12 text-center text-gray-500">Tidak ada data guru</td></tr>';
      totalPages = data.pagination?.totalPages || 1;
    } else {
      tbody.innerHTML = '<tr><td colspan="8" class="px-6 py-12 text-center text-red-500">Gagal memuat data</td></tr>';
    }
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="8" class="px-6 py-12 text-center text-red-500">Error: ' + error.message + '</td></tr>';
  }
}

async function fetchRules() {
  const container = document.getElementById('attendanceRules');
  if (!container) return;
  container.innerHTML = '<div class="text-center py-12"><i class="fas fa-spinner fa-spin text-xl"></i><p>Memuat aturan...</p></div>';

  try {
    const response = await fetch('/api/admin/rules', {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });
    const data = await response.json();
    if (data.success) {
      container.innerHTML = data.data.map(r => `
        <div class="bg-white border border-gray-200 rounded-lg p-4">
          <div class="flex justify-between items-center">
            <div>
              <h5 class="font-medium">${r.nama_sekolah || r.tenant_id}</h5>
              <p class="text-sm text-gray-600">${r.tipe} (${r.jam_mulai} - ${r.jam_selesai})</p>
            </div>
            <div class="flex space-x-2">
              <button onclick="editRule(${r.id})" class="text-blue-600"><i class="fas fa-edit"></i></button>
              <button onclick="deleteRule(${r.id})" class="text-red-600"><i class="fas fa-trash"></i></button>
            </div>
          </div>
        </div>
      `).join('') || '<p class="text-center text-gray-500">Tidak ada aturan</p>';
    }
  } catch (error) {
    container.innerHTML = '<p class="text-red-500">Error memuat aturan: ' + error.message + '</p>';
  }
}

async function fetchDashboardData() {
  try {
    // Load from correct endpoint /api/admin/summary
    const response = await fetch('/api/admin/summary', {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });
    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        setEl('totalTeachers', data.data.totalTeachers || 0);
        setEl('todayAttendance', data.data.activeToday || 0);
        setEl('lateCount', data.data.lateToday || 0);
      }
    }
  } catch (error) {
    console.error('Dashboard data error:', error);
  }
}

async function runAutoEvaluation() {
  const btn = document.getElementById('runAutoEvaluation');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Menjalankan...';
  btn.disabled = true;

  try {
    const response = await fetch('/api/admin/evaluations/auto', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });
    const data = await response.json();
    if (data.success) {
      document.getElementById('evaluationsResults').innerHTML = (data.data || []).map(r => `
        <div class="bg-white border border-gray-200 rounded-lg p-4 mb-3">
          <div class="flex justify-between items-center">
            <div>
              <h5 class="font-medium">${r.nama_guru}</h5>
              <p class="text-sm text-gray-600">Persentase Kehadiran: ${r.persentase}% - Nilai: ${r.nilai}</p>
            </div>
          </div>
        </div>
      `).join('') || '<p class="text-center text-gray-500 py-8">Tidak ada data penilaian</p>';
    } else {
      alert('Error: ' + data.message);
    }
  } catch (error) {
    alert('Terjadi kesalahan');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

window.handleTeacherSearch = function (event) {
  if (event.key === 'Enter') {
    const search = document.getElementById('teacherSearch').value.trim();
    if (search) {
      window.teacherSearchValue = search;
      fetchTeachers(1);
    }
  }
};

window.handleStudentSearch = function (event) {
  if (event.key === 'Enter') {
    const search = document.getElementById('studentSearch').value.trim();
    if (search) {
      window.studentSearchValue = search;
      loadStudents(1);
    }
  }
};

window.filterTenantLocations = function () {
  const search = document.getElementById('locationTenantSearch').value.toLowerCase();
  const cards = document.querySelectorAll('#tenantLocations > div');
  cards.forEach(card => {
    const text = card.textContent.toLowerCase();
    card.style.display = text.includes(search) ? '' : 'none';
  });
};

// Backup/Restore Functions
window.createBackup = async function () {
  const format = document.getElementById('backupFormat').value;
  const btn = event.target;
  const originalText = btn.innerHTML;
  
  btn.innerHTML = '<i class="fas fa-spinner spinner mr-2"></i> Membuat backup...';
  btn.disabled = true;
  
  try {
    const response = await fetch('/api/admin/backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const data = await response.json();
    if (data.success) {
      let downloadUrl = data.downloadUrl;
      window.location.href = downloadUrl;
      loadBackupHistory();
      alert('Backup berhasil dibuat dan diunduh!');
    } else {
      alert('Error: ' + data.message);
    }
  } catch (error) {
    alert('Terjadi kesalahan: ' + error.message);
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
};

window.restoreDatabase = function () {
  const fileInput = document.getElementById('restoreFile');
  if (!fileInput.files[0]) {
    alert('Pilih file backup terlebih dahulu');
    return;
  }
  
  if (!confirm('PERINGATAN: Restore akan menimpa data yang ada! Lanjutkan?')) {
    return;
  }
  
  alert('Restore manual via phpMyAdmin dianjurkan untuk keamanan data');
};

window.loadBackupHistory = async function () {
  try {
    const response = await fetch('/api/admin/backup');
    const data = await response.json();
    
    const historyEl = document.getElementById('backupHistory');
    if (data.success && data.data.length > 0) {
      historyEl.innerHTML = data.data.map(backup => `
        <div class="flex items-center justify-between p-3 bg-white rounded-lg border">
          <div>
            <p class="font-medium text-gray-900">${backup.filename}</p>
            <p class="text-sm text-gray-500">${new Date(backup.created_at).toLocaleDateString('id-ID')} - ${(backup.size / 1024).toFixed(2)} KB</p>
          </div>
          <a href="/api/admin/backup/download/${backup.filename}" 
             class="text-blue-600 hover:text-blue-800 text-sm font-medium">
            <i class="fas fa-download mr-1"></i>Download
          </a>
        </div>
      `).join('');
    } else {
      historyEl.innerHTML = '<p class="text-center text-gray-500 py-8">Belum ada riwayat backup</p>';
    }
  } catch (error) {
    document.getElementById('backupHistory').innerHTML = '<p class="text-red-500">Error memuat riwayat</p>';
  }
};

// Listen for restore file selection
document.addEventListener('DOMContentLoaded', function () {
  const restoreFile = document.getElementById('restoreFile');
  if (restoreFile) {
    restoreFile.addEventListener('change', function () {
      const fileName = this.files[0] ? this.files[0].name : 'Pilih file backup';
      document.getElementById('restoreFileName').textContent = fileName;
    });
  }
});