// Hidden filters for modal triggers
const hiddenFilters = document.createElement('div');
hiddenFilters.style.display = 'none';
hiddenFilters.innerHTML = '<select id="teacherTenantFilter"><option value="">Semua Sekolah</option></select>';
document.body.appendChild(hiddenFilters);

let currentBillMonth = '';
let currentBillDueDate = '';
let selectedStudents = [];

let currentTeacherId = null;
let currentRuleId = null;
let currentPage = 1;
let totalPages = 1;
let pageLimit = 10;
let currentMapContext = 'edit';

function showToast(msg, type='info') {
   console.log('[TOAST]', msg);
}

function showAddTeacherModal() {
   const modal = document.getElementById('addTeacherModal');
   if (modal) modal.classList.remove('hidden');
}

function hideTeacherModal() {
   const modal = document.getElementById('addTeacherModal');
   if (modal) modal.classList.add('hidden');
}

function showAddRuleModal() {
   const modal = document.getElementById('addRuleModal');
   if (modal) modal.classList.remove('hidden');
}

function hideRuleModal() {
   const modal = document.getElementById('addRuleModal');
   if (modal) modal.classList.add('hidden');
}

const setEl = (id, val) => {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = val;
    el.classList.remove('skeleton-loader', 'skeleton-text-lg');
  }
};

window.showAddTeacherModal = showAddTeacherModal;
window.showAddRuleModal = showAddRuleModal;
window.loadEmploymentRules = loadEmploymentRules;
window.sendSingleBillTemplate = sendSingleBillTemplate;
window.openBulkBillModal = openBulkBillModal;
window.loadStudentBillData = loadStudentBillData;

async function loadStudentsForBill() {
  const select = document.getElementById('billStudentSelect');
  if (!select) return;
  select.innerHTML = '<option value="">Memuat siswa...</option>';
  
  try {
    const response = await fetch('/api/admin/students?limit=100', {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token') || ''}` }
    });
    const result = await response.json();
    
    if (result.success) {
      select.innerHTML = '<option value="">Pilih siswa...</option>' + 
        result.data.map(s => `<option value="${s.id}" data-nama="${s.nama_siswa}" data-wa="${s.no_wa_ortu || ''}" data-tagihan="${s.iuran_bulanan || ''}">${s.nama_siswa} (${s.no_wa_ortu || '-'})</option>`).join('');
    }
  } catch (error) {
    select.innerHTML = '<option value="">Error memuat siswa</option>';
  }
}

async function loadStudentBillData() {
  const select = document.getElementById('billStudentSelect');
  const selected = select.options[select.selectedIndex];
  
  if (!selected.value) {
    document.getElementById('billPhoneNumber').value = '';
    document.getElementById('billNamaSiswa').value = '';
    document.getElementById('billJumlahTagihan').value = '';
    document.getElementById('billNomorRekening').value = '';
    document.getElementById('billNamaPenerima').value = '';
    return;
  }
  
  document.getElementById('billPhoneNumber').value = selected.dataset.wa || '';
  document.getElementById('billNamaSiswa').value = selected.dataset.nama || '';
  document.getElementById('billJumlahTagihan').value = selected.dataset.tagihan || '';
}

async function openBulkBillModal() {
  const bulan = document.getElementById('billBulan').value;
  const tanggalJatuhTempo = document.getElementById('billTanggalJatuhTempo').value;
  
  if (!bulan || !tanggalJatuhTempo) {
    Swal.fire('Error', 'Pilih bulan dan tanggal jatuh tempo dulu', 'error');
    return;
  }
  
  const { value: formValues } = await Swal.fire({
    title: 'Kirim Tagihan ke Semua Siswa',
    html: `
      <div style="text-align:left;max-height:400px;overflow-y:auto;">
        <p class="text-sm text-gray-600 mb-2">Siswa yang akan dikirim tagihan (punya WA, iuran > 0):</p>
        <div id="bulkStudentsList" class="text-sm">Memuat...</div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'Kirim ke Semua',
    cancelButtonText: 'Batal',
    width: '600px',
    didOpen: async () => {
      const listEl = document.getElementById('bulkStudentsList');
      try {
        const response = await fetch('/api/admin/students/all', {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('token') || ''}` }
        });
        const result = await response.json();
        if (result.success) {
          // Filter: punya WA & iuran > 0, urut per sekolah
          const studentsWithBill = result.data
            .filter(s => (s.no_wa_ortu || s.no_wa) && parseFloat(s.iuran_bulanan || 0) > 0)
            .sort((a, b) => (a.nama_sekolah || '').localeCompare(b.nama_sekolah || ''));
          selectedStudents = studentsWithBill;
          
          // Kelompok per sekolah
          const grouped = {};
          studentsWithBill.forEach(s => {
            const school = s.nama_sekolah || 'Tanpa Sekolah';
            if (!grouped[school]) grouped[school] = [];
            grouped[school].push(s);
          });
          
          let html = '';
          Object.keys(grouped).forEach(school => {
            html += `<div class="mt-2"><strong class="text-blue-600">${school}</strong></div>`;
            grouped[school].forEach(s => {
              html += `<div class="p-1 pl-3 border-b text-sm">${s.nama_siswa} - Rp${s.iuran_bulanan}</div>`;
            });
          });
          listEl.innerHTML = html || '<p>Tidak ada siswa dengan WA aktif</p>';
        }
      } catch (e) {
        listEl.innerHTML = '<p class="text-red-500">Error memuat siswa</p>';
      }
    }
  });
  
  if (formValues) {
    try {
      const response = await fetch('/api/notifications/whatsapp/bill-template/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        },
        body: JSON.stringify({ 
          bulan, 
          tanggal_jatuh_tempo: tanggalJatuhTempo
        })
      });
      const result = await response.json();
      if (result.success) {
        Swal.fire('Berhasil', `Template terkirim ke ${result.count} siswa`, 'success');
        loadBillStatus();
      } else {
        Swal.fire('Error', result.message || 'Gagal mengirim', 'error');
      }
    } catch (error) {
      Swal.fire('Error', 'Gagal mengirim template', 'error');
    }
  }
}

async function sendSingleBillTemplate() {
  const phoneNumber = document.getElementById('billPhoneNumber').value;
  const namaSiswa = document.getElementById('billNamaSiswa').value;
  const jumlahTagihan = document.getElementById('billJumlahTagihan').value;
  const bulan = document.getElementById('billBulan').value;
  const tanggalJatuhTempo = document.getElementById('billTanggalJatuhTempo').value;
  const nomorRekening = document.getElementById('billNomorRekening').value;
  const namaPenerima = document.getElementById('billNamaPenerima').value;
  
  if (!phoneNumber || !namaSiswa || !bulan || !tanggalJatuhTempo) {
    Swal.fire('Error', 'Field wajib diisi', 'error');
    return;
  }
  
  try {
    const response = await fetch('/api/notifications/whatsapp/bill-template', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
      },
      body: JSON.stringify({
        phoneNumber,
        nama_siswa: namaSiswa,
        jumlah_tagihan: jumlahTagihan,
        bulan,
        tanggal_jatuh_tempo: tanggalJatuhTempo,
        nomor_rekening: nomorRekening,
        nama_penerima: namaPenerima
      })
    });
    const result = await response.json();
    if (result.success) {
      Swal.fire('Berhasil', 'Template tagihan berhasil dikirim', 'success');
      loadBillStatus();
    } else {
      Swal.fire('Error', result.message || 'Gagal mengirim template', 'error');
    }
  } catch (error) {
    Swal.fire('Error', 'Gagal mengirim template', 'error');
  }
}

function showTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(i => {
    i.classList.remove('nav-active');
    i.classList.add('text-gray-600');
  });
  document.getElementById(tabName + 'Tab')?.classList.remove('hidden');
  document.querySelector('[data-tab="' + tabName + '"]')?.classList.add('nav-active');

  if (tabName === 'whatsapp') {
    loadBillStatus();
    loadStudentsForBill();
  } else if (tabName === 'bankSettings') {
    refreshBankSettings();
  } else if (tabName === 'billSettings') {
    loadBillSettings();
  }
}

document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });
  loadDashboardData();
});

async function loadDashboardData() {
  try {
    const endpoint = '/api/admin/summary';
    const response = await fetch(endpoint, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token') || ''}` }
    });
    const result = await response.json();
    
    if (result.success) {
      setEl('totalTeachers', result.data.totalTeachers || result.data.totalAbsensi || 0);
      setEl('todayAttendance', result.data.todayAttendance || 0);
      setEl('lateCount', result.data.lateCount || 0);
      
      const adminName = document.getElementById('adminName');
      if (adminName) adminName.textContent = result.data.adminName || 'Admin';
    }
  } catch (error) {
    console.error('Load dashboard error:', error);
  }
}

async function loadBillStatus() {
  const container = document.getElementById('whatsappStatus');
  if (!container) return;
  
  const whatsappTab = document.getElementById('whatsappTab');
  if (!whatsappTab || whatsappTab.classList.contains('hidden')) return;
  
  container.innerHTML = '<p class="text-gray-500"><i class="fas fa-spinner fa-spin mr-2"></i>Memuat status...</p>';
  
  try {
    const response = await fetch('/api/notifications/bill-status', {
      headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
    });
    const result = await response.json();
    
    if (result.success) {
      container.innerHTML = `
        <div class="text-sm">
          <p><strong>Total Terkirim:</strong> ${result.data.total_sent || 0}</p>
          <p><strong>Terakhir:</strong> ${result.data.last_run || '-'}</p>
        </div>
      `;
    } else {
      container.innerHTML = '<p class="text-red-500">Gagal memuat status</p>';
    }
  } catch (error) {
    container.innerHTML = '<p class="text-gray-600 text-sm">Belum ada pesan yang dikirim.</p>';
  }
}

function openWhatsAppMessenger() {
  window.open('/whatsapp-messenger.html', '_blank', 'width=1200,height=800');
}

async function refreshBankSettings() {
  const container = document.getElementById('bankSettingsList');
  if (!container) return;
  container.innerHTML = '<p class="text-gray-500 text-center py-8"><i class="fas fa-spinner fa-spin mr-2"></i>Memuat data rekening...</p>';
  
  try {
    const response = await fetch('/api/admin/tenants', {
      headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
    });
    const result = await response.json();
    
    if (result.success) {
      container.innerHTML = result.data.map(tenant => `
        <div class="bg-white border border-gray-200 rounded-lg p-4" data-tenant-id="${tenant.tenant_id}">
          <div class="flex items-center justify-between mb-2">
            <h5 class="font-medium text-gray-900">${tenant.nama_sekolah}</h5>
            <button onclick="editBankSetting('${tenant.tenant_id}')" class="text-blue-600 hover:text-blue-800">
              <i class="fas fa-edit"></i>
            </button>
          </div>
          <div class="text-sm text-gray-600">
            <p><strong>No. Rekening:</strong> ${tenant.bank_account_number || '-'} <button onclick="editBankSetting('${tenant.tenant_id}')" class="text-xs text-blue-600">(ubah)</button></p>
            <p><strong>Atas Nama:</strong> ${tenant.bank_account_name || '-'} <button onclick="editBankSetting('${tenant.tenant_id}')" class="text-xs text-blue-600">(ubah)</button></p>
          </div>
        </div>
      `).join('') || '<p class="text-gray-500 text-center py-8">Tidak ada data tenant</p>';
    } else {
      container.innerHTML = '<p class="text-red-500">Gagal memuat data</p>';
    }
  } catch (error) {
    container.innerHTML = '<p class="text-red-500">Error: ' + error.message + '</p>';
  }
}

async function editBankSetting(tenantId) {
  const { value: formValues } = await Swal.fire({
    title: 'Edit Rekening Bank',
    html: `
      <div class="text-left">
        <label class="block text-sm font-medium mb-1">No. Rekening</label>
        <input id="bankAccountNumber" class="swal2-input" placeholder="Nomor rekening bank" style="width: 100%; margin: 0 0 15px 0;">
        <label class="block text-sm font-medium mb-1">Atas Nama</label>
        <input id="bankAccountName" class="swal2-input" placeholder="Nama pemilik rekening" style="width: 100%;">
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'Simpan',
    cancelButtonText: 'Batal',
    focusConfirm: false,
    didOpen: () => {
      fetch('/api/admin/tenants/' + tenantId)
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            document.getElementById('bankAccountNumber').value = data.bank_account_number || '';
            document.getElementById('bankAccountName').value = data.bank_account_name || '';
          }
        });
    }
  });
  
  if (formValues) {
    const bankAccountNumber = document.getElementById('bankAccountNumber').value;
    const bankAccountName = document.getElementById('bankAccountName').value;
    
    const response = await fetch('/api/admin/tenants/' + tenantId + '/bank', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}`
      },
      body: JSON.stringify({ bank_account_number: bankAccountNumber, bank_account_name: bankAccountName })
    });
    
    const result = await response.json();
    if (result.success) {
      Swal.fire('Berhasil', 'Rekening bank berhasil disimpan', 'success');
      refreshBankSettings();
    } else {
      Swal.fire('Error', result.message || 'Gagal menyimpan', 'error');
    }
  }
}

async function loadBillSettings() {
  try {
    const response = await fetch('/api/admin/bill-settings', {
      headers: { 'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}` }
    });
    const result = await response.json();
    
    if (result.success) {
      document.getElementById('billSendDay').value = result.data.send_day || 1;
      document.getElementById('billDueDay').value = result.data.due_day || 10;
      document.getElementById('billIsEnabled').checked = result.data.is_enabled === 1;
    }
  } catch (error) {
    console.error('Load bill settings error:', error);
  }
}

async function saveBillSettings() {
  try {
    const sendDay = document.getElementById('billSendDay').value;
    const dueDay = document.getElementById('billDueDay').value;
    const isEnabled = document.getElementById('billIsEnabled').checked;
    
    const response = await fetch('/api/admin/bill-settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${window.authToken || localStorage.getItem('token') || ''}`
      },
      body: JSON.stringify({ send_day: sendDay, due_day: dueDay, is_enabled: isEnabled })
    });
    
    const result = await response.json();
    if (result.success) {
      Swal.fire('Berhasil', 'Pengaturan tagihan otomatis disimpan', 'success');
    } else {
      Swal.fire('Error', result.message || 'Gagal menyimpan', 'error');
    }
  } catch (error) {
    console.error('Save bill settings error:', error);
    Swal.fire('Error', 'Gagal menyimpan pengaturan', 'error');
  }
}