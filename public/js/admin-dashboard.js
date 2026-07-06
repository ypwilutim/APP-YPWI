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
        <p style="margin-bottom:10px;">Fitur kirim tagihan massal akan diproses di background.</p>
        <p style="font-size:12px;color:#666;">Total siswa aktif yang akan dikirim tagihan: <span id="totalSiswaTagihan"></span></p>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'Kirim Tagihan',
    didOpen: () => {
      document.getElementById('totalSiswaTagihan').textContent = document.getElementById('billStudentSelect').options.length - 1;
    }
  });
  
  if (!formValues) return;
  
  const btn = document.getElementById('sendBulkBillBtn');
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Mengirim...';
  btn.disabled = true;
  
  try {
    const response = await fetch('/api/admin/bulk-bill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bulan: bulan,
        tanggal_jatuh_tempo: tanggalJatuhTempo,
        tenant_ids: Array.from(document.querySelectorAll('#billStudentSelect option:checked')).map(opt => opt.value)
      })
    });
    
    btn.innerHTML = 'Kirim Tagihan';
    btn.disabled = false;
  } catch (error) {
    btn.innerHTML = 'Kirim Tagihan';
    btn.disabled = false;
    showToast('Gagal mengirim tagihan', 'error');
  }
}

async function sendSingleBillTemplate() {
  const studentId = document.getElementById('billStudentSelect').value;
  const message = document.getElementById('billMessage').value;
  
  if (!studentId) {
    showToast('Pilih siswa dulu', 'error');
    return;
  }
  
  const response = await fetch('/api/admin/send-bill-template', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ student_id: studentId, message })
  });
  
  const result = await response.json();
  if (result.success) {
    showToast('Tagihan terkirim', 'success');
  } else {
    showToast('Gagal mengirim tagihan', 'error');
  }
}