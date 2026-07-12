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
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4">Memuat...</td></tr>';
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/treasurer/spp-summary?month=' + year + '-' + month, { headers: token ? { 'Authorization': 'Bearer ' + token } : {} });
        const json = await res.json();
        if (!json.success) { tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-red-500">Gagal: ' + json.message + '</td></tr>'; return; }
        tbody.innerHTML = json.data.map((d, i) => '<tr><td>' + (i + 1) + '</td><td>' + d.nama_sekolah + '</td><td class="text-right">' + d.total_siswa + '</td><td class="text-right">' + fmtRp(d.total_pemasukan) + '</td><td class="text-right">' + d.sudah_bayar + '</td><td class="text-right">' + d.belum_bayar + '</td><td class="text-center"><button onclick="generateSppInvoice(\'' + d.tenant_id + '\',\'' + year + '-' + month + '\')" class="bg-blue-500 text-white px-2 py-1 rounded text-xs"><i class="fas fa-file-invoice"></i></button></td></tr>').join('');
    } catch (e) { tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-red-500">Error: ' + e.message + '</td></tr>'; }
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

window.createStudentInvoice = async function(studentId, tenantId) {
    const periode = document.getElementById('sppMonthSelect')?.value;
    const year = document.getElementById('sppYearSelect')?.value;
    const token = localStorage.getItem('token');
    const res = await fetch('/api/xendit/public/create-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ tenant_id: tenantId, student_id: studentId, periode: year + '-' + String(periode).padStart(2, '0') })
    });
    const json = await res.json();
    if (json.success) { showToast('Invoice Xendit dibuat', 'success'); }
    else { showToast(json.message || 'Gagal buat invoice', 'error'); }
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

window.loadStudentInvoices = async function() {
    const month = document.getElementById('sppMonthSelect')?.value;
    const year = document.getElementById('sppYearSelect')?.value;
    const periode = year + '-' + String(month).padStart(2, '0');
    const sec = document.getElementById('invoicesSection');
    const tbody = document.getElementById('studentInvoicesTable');
    sec.onclick = function(e) { if (e.target === sec) sec.classList.add('hidden'); };
    sec.classList.remove('hidden');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4">Memuat...</td></tr>';
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/payments/invoices?periode=' + periode, { headers: { 'Authorization': 'Bearer ' + token } });
        const json = await res.json();
        if (!json.success) { tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-red-500">Gagal</td></tr>'; return; }
        const data = json.data || [];
        tbody.innerHTML = data.map((d, i) => '<tr><td>' + (i + 1) + '</td><td>' + (d.nama_siswa || '-') + '</td><td>' + (d.nama_sekolah || '-') + '</td><td>' + (d.periode || '-') + '</td><td class="text-right">' + fmtRp(d.amount) + '</td><td>' + d.status + '</td><td><a href="/payment-invoice.html?invoice=' + (d.invoice_number || d.external_id) + '" target="_blank" class="text-blue-600"><i class="fas fa-eye"></i></a></td></tr>').join('');
    } catch (e) { tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-red-500">Error</td></tr>'; }
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
        headerHtml += '<th class="p-1 border">H</th><th class="p-1 border">T</th><th class="p-1 border">I</th><th class="p-1 border">S</th><th class="p-1 border">D</th><th class="p-1 border">C</th><th class="p-1 border">-</th></tr>';
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
    const token = localStorage.getItem('token');
    const a = document.createElement('a');
    a.href = '/api/admin/attendance-export-pdf?tenant_id=' + tenantId + '&bulan=' + month + '&tahun=' + year + '&tenant_name=' + encodeURIComponent(tenantName) + '&token=' + token;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};

window.loadTenantFilters = async function() {
    const elements = ['recapTenantSelect', 'payrollTenantSelect'];
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
        const res = await fetch('/api/admin/tenants', { headers: token ? { 'Authorization': 'Bearer ' + token } : {} });
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
        tbody.innerHTML = data.map((d, i) => '<tr data-id="' + d.id + '"><td class="text-center"><input type="checkbox" class="email-checkbox" data-id="' + d.id + '" data-periode="' + periode + '"></td><td>' + (i + 1) + '</td><td style="min-width:180px">' + d.nama + '</td><td>' + (d.nik || '-') + '</td><td>' + d.status_kepegawaian + '</td><td class="text-right"><input type="number" value="' + d.gaji_pokok + '" class="w-20 border" onchange="updateSalaryField(' + d.id + ', \'gaji_pokok\', this.value)" step="1000"></td><td class="text-right"><input type="number" value="' + d.tunj_kinerja + '" class="w-16 border" onchange="updateSalaryField(' + d.id + ', \'tunj_kinerja\', this.value)" step="1000"></td><td class="text-right"><input type="number" value="' + d.tunj_umum + '" class="w-16 border" onchange="updateSalaryField(' + d.id + ', \'tunj_umum\', this.value)" step="1000"></td><td class="text-right"><input type="number" value="' + d.tunj_istri + '" class="w-16 border" onchange="updateSalaryField(' + d.id + ', \'tunj_istri\', this.value)" step="1000"></td><td class="text-right"><input type="number" value="' + d.tunj_anak + '" class="w-16 border" onchange="updateSalaryField(' + d.id + ', \'tunj_anak\', this.value)" step="1000"></td><td class="text-right"><input type="number" value="' + d.tunj_kepala_sekolah + '" class="w-16 border" onchange="updateSalaryField(' + d.id + ', \'tunj_kepala_sekolah\', this.value)" step="1000"></td><td class="text-right"><input type="number" value="' + d.tunj_wali_kelas + '" class="w-16 border" onchange="updateSalaryField(' + d.id + ', \'tunj_wali_kelas\', this.value)" step="1000"></td><td class="text-right"><input type="number" value="' + d.honor_bendahara + '" class="w-16 border" onchange="updateSalaryField(' + d.id + ', \'honor_bendahara\', this.value)" step="1000"></td><td class="text-right"><input type="number" value="' + d.potongan + '" class="w-16 border" onchange="updateSalaryField(' + d.id + ', \'potongan\', this.value)" step="1000"></td><td class="text-right font-bold" id="total-' + d.id + '">' + fmtRp(d.total_gaji) + '</td><td class="text-center"><button onclick="sendPayrollEmail(' + d.id + ',\'' + periode + '\')" class="text-blue-600"><i class="fas fa-envelope"></i></button></td></tr>').join('');
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
};

window.togglePayrollHistory = async function() {
    const sec = document.getElementById('payrollHistoryView');
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