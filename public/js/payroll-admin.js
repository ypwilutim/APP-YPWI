// Payroll & Monthly Recap Functions (no redirect)
function fmtRp(v) { return 'Rp ' + (parseFloat(v || 0)).toLocaleString('id-ID'); }

function showToast(msg, type) {
    const t = document.createElement('div');
    t.className = 'fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg max-w-sm text-sm ' + (type === 'success' ? 'bg-green-500 text-white' : type === 'error' ? 'bg-red-500 text-white' : 'bg-blue-500 text-white');
    t.innerHTML = '<div class="flex items-center"><i class="fas ' + (type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle') + ' mr-2"></i><span>' + msg + '</span></div>';
    document.body.appendChild(t); setTimeout(() => t.remove(), 3000);
}

window.loadSppSummary = async function() {
    const month = document.getElementById('sppMonthSelect')?.value;
    const year = document.getElementById('sppYearSelect')?.value;
    const tbody = document.getElementById('sppTable');
    tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-500"><i class="fas fa-spinner fa-spin mr-2"></i>Memuat...</td></tr>';
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/treasurer/spp-summary?month=' + year + '-' + month, { headers: token ? { 'Authorization': 'Bearer ' + token } : {} });
        const json = await res.json();
        if (!json.success) { tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-red-500">Gagal: ' + json.message + '</td></tr>'; return; }
        if (!json.data.length) { tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-500">Tidak ada data sekolah</td></tr>'; return; }
        tbody.innerHTML = json.data.map((d, i) => '<tr class="hover:bg-gray-50"><td class="px-4 py-3">' + (i + 1) + '</td><td class="px-4 py-3">' + d.nama_sekolah + '</td><td class="px-4 py-3 text-right">' + d.total_siswa + '</td><td class="px-4 py-3 text-right font-medium text-emerald-600">' + fmtRp(d.total_pemasukan) + '</td><td class="px-4 py-3 text-right text-green-600">' + d.sudah_bayar + '</td><td class="px-4 py-3 text-right text-orange-600 font-medium">' + d.belum_bayar + '</td><td class="px-4 py-3 text-center"><button onclick="generateSppInvoice(\'' + d.tenant_id + '\',\'' + year + '-' + month + '\')" class="bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded text-xs" title="Buat invoice"><i class="fas fa-file-invoice"></i></button></td></tr>').join('');
    } catch (e) { tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-red-500">Error: ' + e.message + '</td></tr>'; }
};

window.generateSppInvoice = async function(tenantId, periode) {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/xendit/public/create-invoices-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ tenant_id: tenantId, periode: periode })
    });
    const json = await res.json();
    if (json.success) { showToast('Invoice Xendit dibuat: ' + json.created + ' buah', 'success'); loadSppSummary(); }
    else { showToast(json.message || 'Gagal buat invoice', 'error'); }
};

window.createStudentInvoice = async function(studentId, tenantId, amount) {
    const periode = document.getElementById('sppMonthSelect')?.value;
    const year = document.getElementById('sppYearSelect')?.value;
    const token = localStorage.getItem('token');
    const payload = { tenant_id: tenantId, student_id: studentId, periode: year + '-' + String(periode).padStart(2, '0') };
    if (amount !== undefined && amount !== null) {
        payload.amount = parseFloat(amount);
    }
    const res = await fetch('/api/xendit/public/create-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (json.success) { showToast('Invoice Xendit dibuat', 'success'); }
    else { showToast(json.message || 'Gagal buat invoice', 'error'); }
};

window.createInstallmentInvoice = async function(studentId, tenantId, amountCustom) {
    const periode = document.getElementById('sppMonthSelect')?.value;
    const year = document.getElementById('sppYearSelect')?.value;
    const token = localStorage.getItem('token');
    const res = await fetch('/api/xendit/public/create-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ tenant_id: tenantId, student_id: studentId, periode: year + '-' + String(periode).padStart(2, '0'), amount: parseFloat(amountCustom), installment_type: 'partial' })
    });
    const json = await res.json();
    if (json.success) { showToast('Invoice cicilan dibuat', 'success'); }
    else { showToast(json.message || 'Gagal buat invoice cicilan', 'error'); }
};

window.showInstallmentModal = function(studentId, tenantId) {
    const modal = document.createElement('div');
    modal.id = 'installmentModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center';
    modal.innerHTML = '<div class="bg-white rounded-lg p-6 w-96"><h3 class="text-lg font-semibold mb-4">Buat Invoice Cicilan</h3><div class="mb-4"><label class="block text-sm font-medium mb-1">Jumlah (Rp)</label><input type="number" id="installmentAmount" class="w-full border rounded px-3 py-2" min="1" step="1000" placeholder="Masukkan jumlah cicilan"></div><div class="flex justify-end gap-2"><button onclick="document.getElementById(\'installmentModal\').remove()" class="px-4 py-2 border rounded hover:bg-gray-100">Batal</button><button onclick="createInstallmentInvoice(\'' + studentId + '\',\'' + tenantId + '\',document.getElementById(\'installmentAmount\').value);document.getElementById(\'installmentModal\').remove()" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Buat Invoice</button></div></div>';
    document.body.appendChild(modal);
    setTimeout(() => document.getElementById('installmentAmount')?.focus(), 100);
};

window.loadSppInvoices = async function() {
    const month = document.getElementById('sppMonthSelect')?.value;
    const year = document.getElementById('sppYearSelect')?.value;
    const sec = document.getElementById('invoicesSection');
    const tbody = document.getElementById('invoicesTable');
    sec.classList.remove('hidden');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4">Memuat...</td></tr>';
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/payments/invoices?periode=' + year + '-' + month, { headers: { 'Authorization': 'Bearer ' + token } });
        const json = await res.json();
        if (!json.success) { tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-red-500">Gagal</td></tr>'; return; }
        tbody.innerHTML = json.data.map((d, i) => '<tr><td>' + (i + 1) + '</td><td>' + (d.nama_siswa || '') + '</td><td class="text-right">' + fmtRp(d.amount) + '</td><td>' + d.status + '</td><td>' + (d.due_date || '-') + '</td><td><a href="/payment-invoice.html?invoice=' + d.invoice_number + '" target="_blank" class="text-blue-600"><i class="fas fa-eye"></i></a></td></tr>').join('');
    } catch (e) { tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-red-500">Error</td></tr>'; }
};

function getTokenTenantId() {
    try {
        const token = localStorage.getItem('token');
        if (!token) return '';
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        const assignments = payload.assignments || [];
        const bend = assignments.find(a => (a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, '') === 'bendahara');
        return (bend && bend.tenant_id) || (assignments[0] && assignments[0].tenant_id) || '';
    } catch (e) {
        return '';
}
};

window.loadBsiTransactions = async function() {
  try {
    const tbody = document.getElementById('bsiTransactionTable') || createBsiTransactionTable();
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4">Memuat...</td></tr>';
    const res = await fetch('/api/treasurer/bsi/transactions', {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });
    const json = await res.json();
    if (!json.success) {
      showToast(json.message || 'Gagal ambil transaksi BSI', 'error');
      return;
    }
    tbody.innerHTML = json.data.length ? json.data.map((d, i) => 
      `<tr><td class="px-3 py-2">${i + 1}</td><td class="px-3 py-2">${d.beneficiary_va}</td><td class="px-3 py-2">${d.nama_siswa || '-'}</td><td class="px-3 py-2 text-right">${fmtRp(d.amount)}</td><td class="px-3 py-2">${d.transaction_date}</td></tr>`
    ).join('') : '<tr><td colspan="5" class="text-center py-4 text-gray-500">Belum ada transaksi</td></tr>';
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
};

function createBsiTransactionTable() {
  const sec = document.createElement('div');
  sec.className = 'bg-white rounded-xl shadow-sm border-2 border-amber-200 p-6 mb-4';
  sec.innerHTML = `
    <h3 class="text-lg font-semibold mb-4">Transaksi BSI</h3>
    <div class="overflow-x-auto"><table class="w-full text-sm">
      <thead class="bg-gray-50"><tr><th class="px-3 py-2">#</th><th class="px-3 py-2">VA Tujuan</th><th class="px-3 py-2">Nama Siswa</th><th class="px-3 py-2 text-right">Jumlah</th><th class="px-3 py-2">Tanggal</th></tr></thead>
      <tbody id="bsiTransactionTable"></tbody>
    </table></div>`;
  document.querySelector('#payment-gatewayTab').appendChild(sec);
  return document.getElementById('bsiTransactionTable');
}

window.importBsiReport = async function(input) {
  const file = input.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = async function(e) {
    let csv = e.target.result;
    // Handle Excel file (xlsx)
    if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      const data = XLSX.read(e.target.result, { type: 'binary' });
      const sheet = data.Sheets[data.SheetNames[0]];
      csv = XLSX.utils.sheet_to_csv(sheet);
    }
    
    const btn = event?.target?.previousElementSibling;
    const originalText = btn?.innerHTML;
    
    try {
      if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Mengimport...'; btn.disabled = true; }
      
const token = localStorage.getItem('token');
       const res = await fetch('/api/bsi/import-report', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
         body: JSON.stringify({ csv })
       });
       const json = await res.json();
       
       if (json.success) {
        if (json.data.unmatched && json.data.unmatched.length > 0) {
          showToast('Import: ' + json.data.paid + ' paid, ' + json.data.unmatched.length + ' unmatched (VA tidak ditemukan)', 'success');
        } else {
          showToast('Import selesai: ' + json.data.paid + ' tunggakan lunas', 'success');
        }
        loadPaymentDefaulters();
      } else {
        showToast(json.message || 'Gagal import', 'error');
      }
    } catch (error) {
      showToast('Error: ' + error.message, 'error');
    } finally {
      if (btn) { btn.innerHTML = originalText; btn.disabled = false; }
      input.value = '';
    }
  };
  reader.readAsText(file);
};

function extractPeriode(d) {
    const m = (d.external_id || '').match(/(20\d{2}-\d{2})/);
    if (m) return m[1];
    if (d.created_at) {
        const cd = new Date(d.created_at);
        return cd.getFullYear() + '-' + String(cd.getMonth() + 1).padStart(2, '0');
    }
    return '-';
}

function invoiceStatusBadge(status) {
    const s = (status || '').toUpperCase();
    if (s === 'PAID') return '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">' + s + '</span>';
    if (s === 'EXPIRED') return '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">' + s + '</span>';
    if (s === 'PENDING') return '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">' + s + '</span>';
    return '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">' + (status || '-') + '</span>';
}

window.loadStudentInvoices = async function() {
    const sec = document.getElementById('invoicesSection');
    const tbody = document.getElementById('studentInvoicesTable');
    sec.onclick = function(e) { if (e.target === sec) sec.classList.add('hidden'); };
    sec.classList.remove('hidden');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4">Memuat...</td></tr>';
    try {
        const token = localStorage.getItem('token');
        const tenantId = getTokenTenantId();
        if (!tenantId) { tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-red-500">Tenant tidak ditemukan di akun Anda</td></tr>'; return; }
        // Tampilkan SELURUH invoice dari xendit_invoices (paid/pending/expired) untuk scope tenant.
        const res = await fetch('/api/xendit/invoices?tenant_id=' + encodeURIComponent(tenantId) + '&limit=1000', { headers: token ? { 'Authorization': 'Bearer ' + token } : {} });
        const json = await res.json();
        if (!json.success) { tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-red-500">' + (json.message || 'Gagal memuat') + '</td></tr>'; return; }
        const data = json.data || [];
        if (!data.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-gray-500">Tidak ada invoice</td></tr>';
            return;
        }
        tbody.innerHTML = data.map((d, i) => {
            const parts = (d.description || '').split(' - ');
            const name = parts[0] || (d.external_id || '-');
            const school = parts[1] || d.tenant_id || '-';
            return '<tr class="hover:bg-gray-50"><td class="px-4 py-3">' + (i + 1) + '</td><td class="px-4 py-3">' + name + '</td><td class="px-4 py-3">' + school + '</td><td class="px-4 py-3">' + extractPeriode(d) + '</td><td class="px-4 py-3 text-right">' + fmtRp(d.amount) + '</td><td class="px-4 py-3 text-center">' + invoiceStatusBadge(d.status) + '</td><td class="px-4 py-3 text-center"><a href="xendit-payment.html?external_id=' + encodeURIComponent(d.external_id || '') + '" target="_blank" class="text-blue-600 hover:text-blue-800" title="Lihat & Bayar invoice"><i class="fas fa-eye"></i></a></td></tr>';
        }).join('');
    } catch (e) { tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-red-500">Error: ' + e.message + '</td></tr>'; }
};

window.switchAttendanceView = function(view) {
    document.getElementById('recapLogViewSection')?.classList.toggle('hidden', view === 'monthly');
    document.getElementById('recapMonthlySection')?.classList.toggle('hidden', view !== 'monthly');
};

window.loadMonthlyRecap = async function() {
    const monthNames = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const tenantId = document.getElementById('recapTenantSelect')?.value;
    const month = document.getElementById('recapMonthSelect')?.value;
    const year = document.getElementById('recapYearSelect')?.value;
    const content = document.getElementById('monthlyRecapContent');
    if (!tenantId || !month || !year) { showToast('Pilih sekolah, bulan, dan tahun', 'error'); return; }
    content.innerHTML = '<p class="text-center py-8"><i class="fas fa-spinner fa-spin"></i> Memuat...</p>';
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/admin/attendance-monthly?tenant_id=' + tenantId + '&bulan=' + month + '&tahun=' + year, { headers: token ? { 'Authorization': 'Bearer ' + token } : {} });
        const json = await res.json();
        if (!json.success) { showToast('Gagal memuat data', 'error'); return; }
        const data = json.data;
        const daysInMonth = json.daysInMonth || 30;
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
    } catch (e) { content.innerHTML = '<p class="text-red-500 p-4">Error: ' + e.message + '</p>'; }
};

window.exportMonthlyPdfFromRecap = async function() {
    const tenantId = document.getElementById('recapTenantSelect')?.value;
    const month = document.getElementById('recapMonthSelect')?.value;
    const year = document.getElementById('recapYearSelect')?.value;
    const tenantName = document.getElementById('recapTenantSelect')?.selectedOptions[0]?.text || '';
    if (!tenantId || !month || !year) { showToast('Pilih sekolah, bulan, dan tahun', 'error'); return; }
    const token = localStorage.getItem('token');
    try {
        const res = await fetch('/api/admin/attendance-export-pdf?tenant_id=' + tenantId + '&bulan=' + month + '&tahun=' + year + '&tenant_name=' + encodeURIComponent(tenantName), { headers: token ? { 'Authorization': 'Bearer ' + token } : {} });
        if (!res.ok) {
            const json = await res.json().catch(() => ({ message: 'Gagal export PDF' }));
            showToast(json.message || 'Gagal export PDF', 'error');
            return;
        }
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'rekap_absensi_' + tenantId + '_' + year + String(month).padStart(2, '0') + '.pdf';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    } catch (e) {
        showToast('Gagal export PDF: ' + e.message, 'error');
    }
};

window.loadTenantFilters = async function() {
    const elements = ['recapTenantSelect', 'payrollTenantSelect', 'dashboardTenantFilter', 'reportTenantFilter', 'reminderTenantFilter', 'individualTenantSelect'];
    elements.forEach(id => {
        const el = document.getElementById(id);
        if (el && el.options.length <= 1) el.innerHTML = '<option value="">Memuat...</option>';
    });
    const years = ['recapYearSelect', 'payrollTahun', 'sppYearSelect'];
    years.forEach(id => {
        const el = document.getElementById(id);
        if (el && el.options.length <= 1) {
            const curYear = new Date().getFullYear();
            for (let y = curYear - 2; y <= curYear + 1; y++) {
                const o = document.createElement('option'); o.value = y; o.textContent = y;
                if (y === curYear) o.selected = true;
                el.appendChild(o);
            }
        }
    });
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/treasurer/public/tenants', { headers: token ? { 'Authorization': 'Bearer ' + token } : {} });
        const json = await res.json();
        if (json.success) {
            const opts = (json.data || []).map(t => '<option value="' + t.tenant_id + '">' + t.nama_sekolah + '</option>').join('');
            elements.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.innerHTML = '<option value="">Semua Sekolah</option>' + opts;
            });
        }
    } catch (e) {
        console.error('[loadTenantFilters] Error:', e.message);
    }
};

window.updateSalaryField = async function(teacherId, field, value) {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/admin/teachers/' + teacherId + '/salary-field', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) },
        body: JSON.stringify({ field, value })
    });
    const json = await res.json();
    if (json.success) {
        const totalEl = document.getElementById('total-' + teacherId);
        if (totalEl && json.total_gaji) totalEl.textContent = fmtRp(json.total_gaji);
        showToast('Berhasil update', 'success');
    } else showToast('Gagal update', 'error');
};

window.loadPayroll = async function() {
    const tenantId = document.getElementById('payrollTenantSelect')?.value || '';
    const bulan = document.getElementById('payrollBulan')?.value;
    const tahun = document.getElementById('payrollTahun')?.value;
    const tbody = document.getElementById('payrollTable');
    const periode = tahun + '-' + String(bulan).padStart(2, '0');
    if (!bulan || !tahun) { showToast('Pilih bulan dan tahun', 'error'); return; }
    tbody.innerHTML = '<tr><td colspan="16" class="text-center py-4">Memuat...</td></tr>';
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/admin/payroll/settings?tenant_id=' + tenantId + '&bulan=' + bulan + '&tahun=' + tahun, { headers: token ? { 'Authorization': 'Bearer ' + token } : {} });
        const json = await res.json();
        if (!json.success) { showToast('Gagal muat data', 'error'); return; }
        const data = json.data;
        if (!data.length) { tbody.innerHTML = '<tr><td colspan="16" class="text-center py-4">Tidak ada data guru</td></tr>'; return; }
        tbody.innerHTML = data.map((d, i) => '<tr data-id="' + d.id + '"><td class="text-center"><input type="checkbox" class="email-checkbox" data-id="' + d.id + '" data-periode="' + periode + '"></td><td>' + (i + 1) + '</td><td style="min-width:180px">' + d.nama + '</td><td>' + (d.nik || '-') + '</td><td>' + d.status_kepegawaian + '</td><td class="text-right"><input type="number" value="' + d.gaji_pokok + '" class="w-20 border" onchange="updateSalaryField(' + d.id + ', \'gaji_pokok\', this.value)" step="1000"></td><td class="text-right"><input type="number" value="' + d.tunj_kinerja + '" class="w-16 border" onchange="updateSalaryField(' + d.id + ', \'tunj_kinerja\', this.value)" step="1000"></td><td class="text-right"><input type="number" value="' + d.tunj_umum + '" class="w-16 border" onchange="updateSalaryField(' + d.id + ', \'tunj_umum\', this.value)" step="1000"></td><td class="text-right"><input type="number" value="' + d.tunj_istri + '" class="w-16 border" onchange="updateSalaryField(' + d.id + ', \'tunj_istri\', this.value)" step="1000"></td><td class="text-right"><input type="number" value="' + d.tunj_anak + '" class="w-16 border" onchange="updateSalaryField(' + d.id + ', \'tunj_anak\', this.value)" step="1000"></td><td class="text-right"><input type="number" value="' + d.tunj_kepala_sekolah + '" class="w-16 border" onchange="updateSalaryField(' + d.id + ', \'tunj_kepala_sekolah\', this.value)" step="1000"></td><td class="text-right"><input type="number" value="' + d.tunj_wali_kelas + '" class="w-16 border" onchange="updateSalaryField(' + d.id + ', \'tunj_wali_kelas\', this.value)" step="1000"></td><td class="text-right"><input type="number" value="' + d.honor_bendahara + '" class="w-16 border" onchange="updateSalaryField(' + d.id + ', \'honor_bendahara\', this.value)" step="1000"></td><td class="text-right">' + fmtRp(d.tunj_kehadiran) + '</td><td class="text-right">' + fmtRp(d.potongan) + '</td><td class="text-right font-bold" id="total-' + d.id + '">' + fmtRp(d.total_gaji) + '</td><td class="text-center"><button onclick="sendPayrollEmail(' + d.id + ',\'' + periode + '\')" class="text-blue-600"><i class="fas fa-envelope"></i></button></td></tr>').join('');
    } catch (e) { tbody.innerHTML = '<tr><td colspan="16" class="text-center py-4 text-red-500">Error: ' + e.message + '</td></tr>'; }
};

window.generatePayroll = async function() {
    const bulan = document.getElementById('payrollBulan')?.value;
    const tahun = document.getElementById('payrollTahun')?.value;
    const tenantId = document.getElementById('payrollTenantSelect')?.value || '';
    const periode = tahun + '-' + String(bulan).padStart(2, '0');
    const token = localStorage.getItem('token');
    const res = await fetch('/api/admin/payroll/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) },
        body: JSON.stringify({ periode, tenant_id: tenantId })
    });
    const json = await res.json();
    if (json.success) { showToast(json.message, 'success'); }
    else { showToast(json.message || 'Gagal generate slip', 'error'); }
};

window.exportPayrollExcel = function() {
    const tenantId = document.getElementById('payrollTenantSelect')?.value || '';
    const bulan = document.getElementById('payrollBulan')?.value;
    const tahun = document.getElementById('payrollTahun')?.value;
    const table = document.querySelector('#payrollTab table');
    if (!table) { showToast('Tidak ada data', 'error'); return; }
    const wb = XLSX.utils.table_to_book(table, { sheet: 'Slip Gaji' });
    const name = 'slip_gaji_' + (tenantId || 'all') + '_' + tahun + String(bulan).padStart(2, '0') + '.xlsx';
    XLSX.writeFile(wb, name);
};

window.exportPayrollPDF = function() {
    const tenantId = document.getElementById('payrollTenantSelect')?.value || '';
    const bulan = document.getElementById('payrollBulan')?.value;
    const tahun = document.getElementById('payrollTahun')?.value;
    const tenantName = document.getElementById('payrollTenantSelect')?.selectedOptions[0]?.text || 'Semua Sekolah';
    const monthNames = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const table = document.querySelector('#payrollTab table');
    if (!table) { showToast('Tidak ada data', 'error'); return; }
    const win = window.open('', '_blank');
    win.document.write('<!DOCTYPE html><html><head><title>Slip Gaji Guru</title><style>@page{size:A4 landscape;margin:1cm}body{font-family:Arial,sans-serif;font-size:8pt}table{width:100%;border-collapse:collapse}th,td{border:1px solid #000;padding:2px;text-align:center;font-size:7pt}th{background:#f0f0f0}</style></head><body>' + '<h2 style="text-align:center">Slip Gaji Guru - ' + tenantName + '<br>Bulan: ' + monthNames[parseInt(bulan)] + ' ' + tahun + '</h2>' + table.outerHTML + '<script>window.onload=function(){window.print();}</script></body></html>');
    win.document.close();
};

window.exportPayrollBsiCUZ = async function() {
    const bulan = document.getElementById('payrollBulan')?.value;
    const tahun = document.getElementById('payrollTahun')?.value;
    const tenantId = document.getElementById('payrollTenantSelect')?.value || '';
    const periode = tahun + '-' + String(bulan).padStart(2, '0');
    const token = localStorage.getItem('token');

    try {
        showToast('Menyimpan slip gaji...', 'info');
        const genRes = await fetch('/api/admin/payroll/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) },
            body: JSON.stringify({ periode, tenant_id: tenantId })
        });
        const genJson = await genRes.json();
        if (!genJson.success) { showToast('Gagal simpan slip: ' + (genJson.message || ''), 'error'); return; }
        showToast('Slip tersimpan, mengekspor BSI CUZ...', 'info');

        const res = await fetch('/api/admin/payroll/bsi-export?tenant_id=' + tenantId + '&bulan=' + bulan + '&tahun=' + tahun, { headers: token ? { 'Authorization': 'Bearer ' + token } : {} });
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'payroll_bsi_cuz_' + periode + '.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Export BSI CUZ selesai', 'success');
    } catch (e) {
        console.error(e);
        showToast('Error: ' + e.message, 'error');
    }
};

window.toggleDeductionSettings = function() {
    const panel = document.getElementById('deductionSettingsPanel');
    if (!panel) return;
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) loadDeductionSettings();
};

window.loadDeductionSettings = async function() {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/admin/payroll/deduction-settings', { headers: token ? { 'Authorization': 'Bearer ' + token } : {} });
        const json = await res.json();
        if (!json.success) return;
        const d = json.data;
        document.getElementById('setPotTerlambat').value = d.potongan_terlambat || 0;
        document.getElementById('setPotIzin').value = d.potongan_izin || 0;
        document.getElementById('setPotSakit').value = d.potongan_sakit || 0;
        document.getElementById('setPotTanpaKet').value = d.potongan_tanpa_keterangan || 0;
        document.getElementById('setPotTidakHadir').value = d.potongan_tidak_hadir || 0;
        document.getElementById('setTunjKehadiran').value = d.tunj_kehadiran || 0;
    } catch (e) { console.error('loadDeductionSettings', e); }
};

window.saveDeductionSettings = async function() {
    const payload = {
        potongan_terlambat: parseFloat(document.getElementById('setPotTerlambat').value || 0),
        potongan_izin: parseFloat(document.getElementById('setPotIzin').value || 0),
        potongan_sakit: parseFloat(document.getElementById('setPotSakit').value || 0),
        potongan_tanpa_keterangan: parseFloat(document.getElementById('setPotTanpaKet').value || 0),
        potongan_tidak_hadir: parseFloat(document.getElementById('setPotTidakHadir').value || 0),
        tunj_kehadiran: parseFloat(document.getElementById('setTunjKehadiran').value || 0)
    };
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/admin/payroll/deduction-settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) },
            body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (json.success) { showToast('Pengaturan potongan tersimpan', 'success'); loadPayroll(); }
        else showToast(json.message || 'Gagal simpan', 'error');
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
};

window.togglePayrollHistory = async function() {    const sec = document.getElementById('payrollHistoryView');
    const view = document.getElementById('payrollComputeView');
    if (sec.classList.contains('hidden')) {
        sec.classList.remove('hidden');
        view.classList.add('hidden');
        await loadPayrollHistory();
    } else {
        sec.classList.add('hidden');
        view.classList.remove('hidden');
    }
};

window.loadPayrollHistory = async function() {
    const tbody = document.getElementById('payrollHistoryTable');
    const tenantId = document.getElementById('payrollTenantSelect')?.value || '';
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4">Memuat...</td></tr>';
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/admin/payroll/history?tenant_id=' + tenantId, { headers: token ? { 'Authorization': 'Bearer ' + token } : {} });
        const json = await res.json();
        if (!json.success) { tbody.innerHTML = '<tr><td colspan="6">Gagal muat</td></tr>'; return; }
        tbody.innerHTML = (json.data || []).map((d, i) => '<tr><td>' + d.periode + '</td><td>' + d.nama + '</td><td>' + (d.nik || '-') + '</td><td>' + fmtRp(d.total_gaji) + '</td><td><button onclick="sendPayrollEmail(' + d.teacher_id + ',\'' + d.periode + '\')" class="text-blue-600"><i class="fas fa-envelope"></i></button></td></tr>').join('');
    } catch (e) { tbody.innerHTML = '<tr><td colspan="6">Error</td></tr>'; }
};

window.sendPayrollEmail = async function(teacherId, periode) {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/admin/payroll/send-slip-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) },
        body: JSON.stringify({ teacher_id: teacherId, periode })
    });
    const json = await res.json();
    if (json.success) { showToast('Email terkirim', 'success'); }
    else { showToast(json.message || 'Gagal kirim email', 'error'); }
};

window.sendSelectedPayrollEmails = async function() {
    const bulan = document.getElementById('payrollBulan')?.value;
    const tahun = document.getElementById('payrollTahun')?.value;
    const periode = tahun + '-' + String(bulan).padStart(2, '0');
    const checkboxes = document.querySelectorAll('.email-checkbox:checked');
    if (checkboxes.length === 0) { showToast('Pilih minimal satu guru', 'error'); return; }
    const teacherIds = Array.from(checkboxes).map(cb => cb.dataset.id);
    const token = localStorage.getItem('token');
    const res = await fetch('/api/admin/payroll/send-selected-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) },
        body: JSON.stringify({ teacher_ids: teacherIds, periode })
    });
    const json = await res.json();
    if (json.success) { showToast(json.message, 'success'); }
    else { showToast(json.message || 'Gagal kirim email', 'error'); }
};

window.sendBulkPayrollEmail = async function() {
    const bulan = document.getElementById('payrollBulan')?.value;
    const tahun = document.getElementById('payrollTahun')?.value;
    const tenantId = document.getElementById('payrollTenantSelect')?.value || '';
    const periode = tahun + '-' + String(bulan).padStart(2, '0');
    if (!confirm('Kirim email slip gaji ke semua guru untuk ' + periode + '?')) return;
    const token = localStorage.getItem('token');
    const res = await fetch('/api/admin/payroll/send-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) },
        body: JSON.stringify({ periode, tenant_id: tenantId })
    });
    const json = await res.json();
    if (json.success) { showToast(json.message, 'success'); }
    else { showToast(json.message || 'Gagal kirim email', 'error'); }
};

window.exportPayrollTemplate = function() {
    const tbody = document.getElementById('payrollTable');
    const rows = Array.from(tbody.querySelectorAll('tr')).filter(r => r.dataset.id);
    if (!rows.length) { showToast('Tidak ada data untuk di-export', 'error'); return; }
    const data = [];
    rows.forEach(r => {
        const cells = r.querySelectorAll('td input, td');
        data.push({
            'Nama': cells[2].textContent,
            'NIK': cells[3].textContent,
            'Gaji Pokok': cells[4].querySelector('input')?.value || 0,
            'T. Kinerja': cells[5].querySelector('input')?.value || 0,
            'T. Umum': cells[6].querySelector('input')?.value || 0,
            'T. Istri': cells[7].querySelector('input')?.value || 0,
            'T. Anak': cells[8].querySelector('input')?.value || 0,
            'T. KepSek': cells[9].querySelector('input')?.value || 0,
            'T. WaliKelas': cells[10].querySelector('input')?.value || 0,
            'Honor': cells[11].querySelector('input')?.value || 0,
            'Potongan': cells[12].querySelector('input')?.value || 0
        });
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data Gaji');
    const tenantId = document.getElementById('payrollTenantSelect')?.value || 'all';
    const bulan = document.getElementById('payrollBulan')?.value;
    const tahun = document.getElementById('payrollTahun')?.value;
    XLSX.writeFile(wb, 'template_gaji_' + tenantId + '_' + tahun + String(bulan).padStart(2, '0') + '.xlsx');
};

window.importPayrollExcel = async function() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls';
    input.onchange = async function(e) {
        const file = e.target.files[0];
        if (!file) return;
        const data = await file.arrayBuffer();
        const wb = XLSX.read(data, { cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(ws);
        if (!jsonData.length) { showToast('File kosong', 'error'); return; }
        const token = localStorage.getItem('token');
        const bulan = document.getElementById('payrollBulan')?.value;
        const tahun = document.getElementById('payrollTahun')?.value;
        if (!bulan || !tahun) { showToast('Pilih bulan dan tahun', 'error'); return; }
        const periode = tahun + '-' + String(bulan).padStart(2, '0');
        const res = await fetch('/api/admin/payroll/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) },
            body: JSON.stringify({ data: jsonData, periode })
        });
        const json = await res.json();
        if (json.success) { showToast(json.message, 'success'); loadPayroll(); }
        else { showToast(json.message || 'Gagal import', 'error'); }
    };
    input.click();
};

window.generateSppBatch = async function() {
    const month = document.getElementById('sppMonthSelect')?.value;
    const year = document.getElementById('sppYearSelect')?.value;
    const token = localStorage.getItem('token');
    const res = await fetch('/api/xendit/public/create-invoices-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ tenant_id: 'YPWILUTIM', periode: year + '-' + String(month).padStart(2, '0') })
    });
    const json = await res.json();
    if (json.success) { showToast('Invoice batch dibuat:', json.created + ' buah', 'success'); loadSppSummary(); }
    else { showToast(json.message || 'Gagal buat batch invoice', 'error'); }
};

window.loadStudentInvoicePanel = async function() {
    const month = document.getElementById('sppMonthSelect')?.value;
    const year = document.getElementById('sppYearSelect')?.value;
    const tenantId = document.getElementById('recapTenantSelect')?.value;
    const sec = document.getElementById('invoicesSection');
    const list = document.getElementById('studentInvoiceList');
    const status = document.getElementById('studentInvoiceStatus');
    sec.classList.remove('hidden');
    list.classList.remove('hidden');
    list.innerHTML = '<p class="text-sm text-gray-600">Pilih periode dan sekolah lalu klik Buat Invoice</p>';
    status.innerHTML = '';
    const token = localStorage.getItem('token');
    const res = await fetch('/api/xendit/public/invoices?tenant_id=' + tenantId + '&periode=' + year + '-' + month, { headers: { 'Authorization': 'Bearer ' + token } });
    const json = await res.json();
    if (json.success) {
        status.innerHTML = '<div class="mt-2 p-2 bg-green-50 rounded text-sm">' + json.data.length + ' invoice untuk periode ' + year + '-' + month + '</div>';
    }
};

window.generateStudentInvoices = async function() {
    const month = document.getElementById('invoiceMonthSelect')?.value;
    const year = document.getElementById('invoiceYearSelect')?.value;
    const tenantId = document.getElementById('invoiceTenantSelect')?.value;
    const token = localStorage.getItem('token');
    const res = await fetch('/api/xendit/public/create-invoices-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ tenant_id: tenantId, periode: year + '-' + String(month).padStart(2, '0') })
    });
    const json = await res.json();
    if (json.success) { alert('Berhasil buat ' + json.created + ' invoice'); }
    else { alert('Gagal: ' + json.message); }
};

window.syncAllInvoices = async function() {
    const month = document.getElementById('sppMonthSelect')?.value;
    const year = document.getElementById('sppYearSelect')?.value;
    if (!month || !year) { showToast('Pilih periode', 'error'); return; }
    if (!confirm('Sync semua invoice untuk periode ' + year + '-' + String(month).padStart(2, '0') + '?')) return;
    const token = localStorage.getItem('token');
    try {
        const tenantId = getTokenTenantId();
        const listRes = await fetch('/api/xendit/public/invoices?tenant_id=' + tenantId + '&periode=' + year + '-' + String(month).padStart(2, '0') + '&limit=500', { headers: { 'Authorization': 'Bearer ' + token } });
        const { data } = await listRes.json();
        if (!data?.length) { showToast('Tidak ada invoice', 'info'); return; }
        let synced = 0;
        for (const inv of data) {
            try {
                const syncRes = await fetch('/api/xendit/public/invoices/' + inv.id + '/sync', { headers: { 'Authorization': 'Bearer ' + token } });
                if ((await syncRes.json()).success) synced++;
            } catch (e) {}
        }
        showToast(synced + ' invoice disync', 'success');
        loadSppSummary();
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
};

window.loadDashboardData = async function() {
    const tenantFilter = document.getElementById('dashboardTenantFilter')?.value || '';
    const tenantCards = document.getElementById('tenantCards');
    const totalIncomeEl = document.getElementById('totalIncome');
    const totalExpenseEl = document.getElementById('totalExpense');
    const balanceEl = document.getElementById('currentBalance');
    const unpaidEl = document.getElementById('unpaidCount');
    tenantCards.innerHTML = '<div class="col-span-full text-center py-8"><i class="fas fa-spinner fa-spin text-3xl text-gray-400"></i><p class="text-gray-500 mt-2">Memuat...</p></div>';
    
    try {
        const token = localStorage.getItem('token');
        const [sppRes, payrollRes] = await Promise.all([
            fetch('/api/treasurer/public/spp-summary' + (tenantFilter ? '?tenant_id=' + tenantFilter : ''), { headers: token ? { 'Authorization': 'Bearer ' + token } : {} }),
            fetch('/api/treasurer/public/salary-summary' + (tenantFilter ? '?tenant_id=' + tenantFilter : ''), { headers: token ? { 'Authorization': 'Bearer ' + token } : {} })
        ]);
        const [sppData, payrollData] = await Promise.all([sppRes.json(), payrollRes.json()]);
        
        if (sppData.success && sppData.data?.length) {
            const totalIncome = sppData.data.reduce((s, d) => s + (d.total_pemasukan || 0), 0);
            const totalPaid = sppData.data.reduce((s, d) => s + (d.sudah_bayar || 0), 0);
            const totalUnpaid = sppData.data.reduce((s, d) => s + (d.belum_bayar || 0), 0);
            
            tenantCards.innerHTML = sppData.data.map(d => `
              <div class="bg-white rounded-xl shadow-sm border border-emerald-200 p-5 hover:shadow-md transition-shadow">
                <div class="border-b border-gray-100 pb-3 mb-3">
                  <h4 class="font-semibold text-gray-900">${d.nama_sekolah || 'Tidak diketahui'}</h4>
                  <p class="text-xs text-gray-500 mt-1">${d.total_siswa || 0} siswa</p>
                </div>
                <div class="space-y-2 text-sm">
                  <div class="flex justify-between"><span class="text-gray-600">Pendapatan</span><span class="font-medium text-emerald-600">${fmtRp(d.total_pemasukan || 0)}</span></div>
                  <div class="flex justify-between"><span class="text-gray-600">Bayar</span><span class="font-medium text-green-600">${d.sudah_bayar || 0}</span></div>
                  <div class="flex justify-between"><span class="text-gray-600">Belum Bayar</span><span class="font-medium text-orange-600">${d.belum_bayar || 0}</span></div>
                </div>
              </div>
            `).join('');
            
            totalIncomeEl.textContent = fmtRp(totalIncome);
            unpaidEl.innerHTML = `${totalUnpaid} <span class="text-sm font-normal">Siswa</span>`;
        } else {
            tenantCards.innerHTML = '<div class="col-span-full text-center py-8 text-gray-500">Tidak ada data sekolah</div>';
        }
        
        if (payrollData.success && payrollData.data?.length) {
            const totalExpense = payrollData.data.reduce((s, d) => s + (d.total_gaji || 0), 0);
            totalExpenseEl.textContent = fmtRp(totalExpense);
            balanceEl.textContent = fmtRp(Math.max(0, (sppData.success ? sppData.data.reduce((s, d) => s + (d.total_pemasukan || 0), 0) : 0) - totalExpense));
        }
    } catch (e) {
        tenantCards.innerHTML = '<div class="col-span-full text-center py-8 text-red-500">Error memuat data</div>';
    }
};

function renderPayrollRow(d, i, periode) {
  return `<tr data-id="${d.id}" class="hover:bg-gray-50 border-b border-gray-100"><td class="px-3 py-2 text-center"><input type="checkbox" class="email-checkbox" data-id="${d.id}" data-periode="${periode}"></td><td class="px-3 py-2 text-center">${i + 1}</td><td class="px-3 py-2">${d.nama}</td><td class="px-3 py-2">${d.nik || '-'}</td><td class="px-3 py-2">${d.status_kepegawaian}</td><td class="px-3 py-2 text-right"><input type="number" value="${d.gaji_pokok}" class="w-24 border border-gray-300 rounded px-1 py-0.5 text-right text-sm" onchange="updateSalaryField(${d.id}, 'gaji_pokok', this.value)" step="1000"></td><td class="px-3 py-2 text-right"><input type="number" value="${d.tunj_kinerja}" class="w-20 border border-gray-300 rounded px-1 py-0.5 text-right text-sm" onchange="updateSalaryField(${d.id}, 'tunj_kinerja', this.value)" step="1000"></td><td class="px-3 py-2 text-right"><input type="number" value="${d.tunj_umum}" class="w-20 border border-gray-300 rounded px-1 py-0.5 text-right text-sm" onchange="updateSalaryField(${d.id}, 'tunj_umum', this.value)" step="1000"></td><td class="px-3 py-2 text-right"><input type="number" value="${d.tunj_istri}" class="w-20 border border-gray-300 rounded px-1 py-0.5 text-right text-sm" onchange="updateSalaryField(${d.id}, 'tunj_istri', this.value)" step="1000"></td><td class="px-3 py-2 text-right"><input type="number" value="${d.tunj_anak}" class="w-20 border border-gray-300 rounded px-1 py-0.5 text-right text-sm" onchange="updateSalaryField(${d.id}, 'tunj_anak', this.value)" step="1000"></td><td class="px-3 py-2 text-right"><input type="number" value="${d.tunj_kepala_sekolah}" class="w-20 border border-gray-300 rounded px-1 py-0.5 text-right text-sm" onchange="updateSalaryField(${d.id}, 'tunj_kepala_sekolah', this.value)" step="1000"></td><td class="px-3 py-2 text-right"><input type="number" value="${d.tunj_wali_kelas}" class="w-20 border border-gray-300 rounded px-1 py-0.5 text-right text-sm" onchange="updateSalaryField(${d.id}, 'tunj_wali_kelas', this.value)" step="1000"></td><td class="px-3 py-2 text-right"><input type="number" value="${d.honor_bendahara}" class="w-20 border border-gray-300 rounded px-1 py-0.5 text-right text-sm" onchange="updateSalaryField(${d.id}, 'honor_bendahara', this.value)" step="1000"></td><td class="px-3 py-2 text-right">' + fmtRp(d.tunj_kehadiran) + '</td><td class="px-3 py-2 text-right"><input type="number" value="${d.potongan}" class="w-20 border border-gray-300 rounded px-1 py-0.5 text-right text-sm" onchange="updateSalaryField(${d.id}, 'potongan', this.value)" step="1000"></td><td id="total-${d.id}" class="px-3 py-2 text-right font-semibold text-emerald-600">${fmtRp(d.total_gaji)}</td><td class="px-3 py-2 text-center"><button onclick="sendPayrollEmail(${d.id}, '${periode}')" class="text-blue-600 hover:text-blue-800" title="Kirim email slip"><i class="fas fa-envelope"></i></button></td></tr>`;
}
