function escapeHtml(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let sdmRows = [];

document.addEventListener('DOMContentLoaded', async function() {
  const tbody = document.getElementById('employees-body');
  const tenantFilter = document.getElementById('tenant-filter');

  const token = localStorage.getItem('token') || window.authToken || '';
  const headers = token ? { 'Authorization': 'Bearer ' + token } : {};

  // Load tenants
  try {
    const res = await fetch('/api/admin/tenants?limit=500', { headers });
    if (res.ok) {
      const result = await res.json();
      if (result.success && result.data && result.data.length > 0) {
        const firstOption = tenantFilter.querySelector('option');
        tenantFilter.innerHTML = '';
        tenantFilter.appendChild(firstOption);
        result.data.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t.tenant_id;
          opt.textContent = t.nama_sekolah || t.tenant_id;
          tenantFilter.appendChild(opt);
        });
      }
    }
  } catch (e) { console.error('Failed to load tenants:', e); }

  window.closeModal = function() {
    document.getElementById('detail-modal').style.display = 'none';
  };

  window.showDetail = function(data) {
    if (!data) return;
    const content = document.getElementById('modal-content');
    const assignments = (data.jabatan_di_unit || '').split(', ').map((j, i) => {
      const tenant = (data.tenant_ids || '').split(', ')[i] || '-';
      const sekolah = (data.nama_sekolah || '').split(', ')[i] || '-';
      return `<div class="border-b border-gray-100 pb-2 mb-2 last:border-0">
        <strong>Assignment ${i + 1}</strong><br>
        Jabatan: <span class="font-semibold text-blue-700">${escapeHtml(j)}</span><br>
        Tenant: <span class="text-gray-600">${escapeHtml(tenant)}</span><br>
        Sekolah: <span class="text-gray-600">${escapeHtml(sekolah)}</span>
      </div>`;
    }).join('');

    content.innerHTML = `
      <div class="mb-3"><strong>Nama:</strong> ${escapeHtml(data.nama)}</div>
      <div class="mb-3"><strong>NIK:</strong> ${escapeHtml(data.nik)}</div>
      <div class="mb-3"><strong>NIP:</strong> ${escapeHtml(data.nip || '-')}</div>
      <div class="mb-3"><strong>Email:</strong> ${escapeHtml(data.email || '-')}</div>
      <div class="mb-3"><strong>Status Kepegawaian:</strong> ${escapeHtml(data.status_kepegawaian || '-')}</div>
      <hr class="my-3">
      <h3 class="font-semibold mb-2 text-blue-800">Assignment SDM</h3>
      ${assignments || '<p class="text-gray-400">Tidak ada data assignment.</p>'}
    `;
    document.getElementById('detail-modal').style.display = 'flex';
  };

  // Table rows are looked up by index so records are never serialized into
  // inline event handlers (which enables XSS via crafted field values).
  window.showDetailByIndex = function(i) {
    window.showDetail(sdmRows[i]);
  };

  async function loadEmployees() {
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-gray-400">Memuat data...</td></tr>';
    try {
      const tenantId = tenantFilter ? tenantFilter.value : '';
      const url = new URL('/api/sdm/employees', window.location.origin);
      if (tenantId) url.searchParams.set('tenantId', tenantId);
      const res = await fetch(url.toString(), { headers });
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem('token'); localStorage.removeItem('user');
        window.location.replace('login.html'); return;
      }
      const result = await res.json();
      if (result.success && result.data && result.data.data) {
        const rows = result.data.data;
        if (rows.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-gray-400">Tidak ada data SDM</td></tr>';
        } else {
          sdmRows = rows;
          tbody.innerHTML = rows.map((r, i) => `
            <tr class="hover:bg-gray-50">
              <td class="py-3 px-4 text-sm text-gray-800 font-medium">${escapeHtml(r.nama || '-')}</td>
              <td class="py-3 px-4 text-sm text-gray-600">${escapeHtml(r.nik || '-')}</td>
              <td class="py-3 px-4 text-sm text-gray-600">${escapeHtml(r.nip || '-')}</td>
              <td class="py-3 px-4 text-sm text-gray-600">${escapeHtml(r.status_kepegawaian || '-')}</td>
              <td class="py-3 px-4 text-sm text-gray-600">${escapeHtml(r.no_wa || '-')}</td>
              <td class="py-3 px-4 text-sm">
                <button onclick="showDetailByIndex(${i})" class="btn-detail">Detail</button>
              </td>
            </tr>
          `).join('');
        }
      } else {
        tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-red-400">Gagal memuat data</td></tr>';
      }
    } catch (err) {
      console.error('Load employees error:', err);
      tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-red-400">Error memuat</td></tr>';
    }
  }

  loadEmployees();
  if (tenantFilter) tenantFilter.addEventListener('change', loadEmployees);
});
