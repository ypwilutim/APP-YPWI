let allTAData = [];
let currentTAId = null;
let editingTA = false;

async function loadTA() {
  const tbody = document.getElementById('taTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="px-6 py-8 text-center text-gray-500"><i class="fas fa-spinner fa-spin mr-2"></i>Memuat data...</td></tr>';

  try {
    const token = localStorage.getItem('token');
    const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
    const res = await fetch('/api/admin/tahun-ajaran', { headers });
    const data = await res.json();

    if (!data.success) {
      tbody.innerHTML = '<tr><td colspan="7" class="px-6 py-8 text-center text-red-500">Gagal memuat data</td></tr>';
      return;
    }

    allTAData = data.data || [];
    renderTA(allTAData);
  } catch (error) {
    console.error('Load TA error:', error);
    tbody.innerHTML = '<tr><td colspan="7" class="px-6 py-8 text-center text-red-500">Error memuat data</td></tr>';
  }
}

function renderTA(data) {
  const tbody = document.getElementById('taTableBody');
  if (!tbody) return;

  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="px-6 py-8 text-center text-gray-500">Belum ada tahun ajaran</td></tr>';
    return;
  }

  tbody.innerHTML = data.map((ta, idx) => {
    const statusBadge = ta.is_active === 1
      ? '<span class="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">Aktif</span>'
      : '<span class="px-2 py-1 bg-gray-100 text-gray-800 text-xs font-medium rounded-full">Nonaktif</span>';

    return `
      <tr class="hover:bg-gray-50 border-b border-gray-100">
        <td class="px-6 py-4 text-sm text-gray-900">${idx + 1}</td>
        <td class="px-6 py-4 text-sm font-medium text-gray-900">${ta.nama || '-'}</td>
        <td class="px-6 py-4 text-sm text-gray-600">${ta.tahun_mulai}/${ta.tahun_selesai || ''}</td>
        <td class="px-6 py-4 text-sm text-gray-600">${ta.bulan_mulai ? getMonthName(ta.bulan_mulai) : '-'}</td>
        <td class="px-6 py-4 text-sm text-gray-600">${ta.tanggal_mulai ? formatDate(ta.tanggal_mulai) : '-'} s/d ${ta.tanggal_selesai ? formatDate(ta.tanggal_selesai) : '-'}</td>
        <td class="px-6 py-4 text-center">${statusBadge}</td>
        <td class="px-6 py-4 text-center">
          <div class="flex items-center justify-center gap-2">
            <button onclick="viewSemester(${ta.id})" class="text-blue-600 hover:text-blue-800" title="Lihat Semester">
              <i class="fas fa-list"></i>
            </button>
            <button onclick="editTA(${ta.id})" class="text-yellow-600 hover:text-yellow-800" title="Edit">
              <i class="fas fa-edit"></i>
            </button>
            ${ta.is_active !== 1 ? `<button onclick="setActive(${ta.id})" class="text-green-600 hover:text-green-800" title="Set Aktif"><i class="fas fa-check-circle"></i></button>` : ''}
            <button onclick="deleteTA(${ta.id}, '${(ta.nama || '').replace(/'/g, "\\'")}')" class="text-red-600 hover:text-red-800" title="Hapus">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function filterTA() {
  const search = (document.getElementById('taSearch')?.value || '').toLowerCase();
  const filtered = allTAData.filter(ta =>
    (ta.nama || '').toLowerCase().includes(search) ||
    (ta.tahun_mulai || '').includes(search) ||
    (ta.tahun_selesai || '').includes(search)
  );
  renderTA(filtered);
}

function getMonthName(num) {
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  return months[parseInt(num) - 1] || num;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function openCreateModal() {
  editingTA = false;
  document.getElementById('taModalTitle').textContent = 'Tahun Ajaran Baru';
  document.getElementById('taId').value = '';
  document.getElementById('taNama').value = '';
  document.getElementById('taTahunMulai').value = '';
  document.getElementById('taTahunSelesai').value = '';
  document.getElementById('taBulanMulai').value = '7';
  document.getElementById('taTenantId').value = '';
  document.getElementById('taTanggalMulai').value = '';
  document.getElementById('taTanggalSelesai').value = '';
  document.getElementById('taIsActive').checked = true;
  document.getElementById('taModal').classList.add('show');
}

function closeTaModal() {
  document.getElementById('taModal').classList.remove('show');
}

async function saveTA(event) {
  event.preventDefault();
  const id = document.getElementById('taId').value;
  const nama = document.getElementById('taNama').value.trim();
  const tahunMulai = document.getElementById('taTahunMulai').value.trim();
  const tahunSelesai = document.getElementById('taTahunSelesai').value.trim();
  const bulanMulai = document.getElementById('taBulanMulai').value;
  const tenantId = document.getElementById('taTenantId').value.trim() || null;
  const tanggalMulai = document.getElementById('taTanggalMulai').value;
  const tanggalSelesai = document.getElementById('taTanggalSelesai').value;
  const isActive = document.getElementById('taIsActive').checked ? 1 : 0;

  if (!nama || !tahunMulai || !tahunSelesai || !tanggalMulai || !tanggalSelesai) {
    if (typeof swal !== 'undefined') {
      swal('Error', 'Nama, tahun, dan tanggal wajib diisi', 'error');
    }
    return;
  }

  try {
    const token = localStorage.getItem('token');
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': 'Bearer ' + token } : {})
    };

    const payload = { nama, tahun_mulai: tahunMulai, tahun_selesai: tahunSelesai, bulan_mulai: bulanMulai, tanggal_mulai: tanggalMulai, tanggal_selesai: tanggalSelesai, is_active: isActive, tenant_id: tenantId };

    const url = id ? `/api/admin/tahun-ajaran/${id}` : '/api/admin/tahun-ajaran';
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.success) {
      if (typeof swal !== 'undefined') {
        swal('Berhasil', data.message || 'Tahun ajaran disimpan', 'success').then(() => {
          closeTaModal();
          loadTA();
        });
      } else {
        closeTaModal();
        loadTA();
      }
    } else {
      if (typeof swal !== 'undefined') swal('Error', data.message || 'Gagal menyimpan', 'error');
    }
  } catch (error) {
    console.error('Save TA error:', error);
    if (typeof swal !== 'undefined') swal('Error', 'Terjadi kesalahan', 'error');
  }
}

function editTA(id) {
  const ta = allTAData.find(t => t.id === id);
  if (!ta) return;

  editingTA = true;
  document.getElementById('taModalTitle').textContent = 'Edit Tahun Ajaran';
  document.getElementById('taId').value = ta.id;
  document.getElementById('taNama').value = ta.nama || '';
  document.getElementById('taTahunMulai').value = ta.tahun_mulai || '';
  document.getElementById('taTahunSelesai').value = ta.tahun_selesai || '';
  document.getElementById('taBulanMulai').value = ta.bulan_mulai || '7';
  document.getElementById('taTenantId').value = ta.tenant_id || '';
  document.getElementById('taTanggalMulai').value = ta.tanggal_mulai || '';
  document.getElementById('taTanggalSelesai').value = ta.tanggal_selesai || '';
  document.getElementById('taIsActive').checked = ta.is_active === 1;
  document.getElementById('taModal').classList.add('show');
}

async function deleteTA(id, nama) {
  if (typeof swal !== 'undefined') {
    swal({
      title: 'Hapus Tahun Ajaran?',
      text: `Apakah Anda yakin ingin menghapus "${nama}"?`,
      icon: 'warning',
      buttons: true,
      dangerMode: true,
    }).then(async (willDelete) => {
      if (willDelete) {
        try {
          const token = localStorage.getItem('token');
          const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
          const res = await fetch(`/api/admin/tahun-ajaran/${id}`, { method: 'DELETE', headers });
          const data = await res.json();
          if (data.success) {
            swal('Dihapus', 'Tahun ajaran berhasil dihapus', 'success');
            loadTA();
          } else {
            swal('Error', data.message || 'Gagal menghapus', 'error');
          }
        } catch (error) {
          console.error('Delete TA error:', error);
          swal('Error', 'Terjadi kesalahan', 'error');
        }
      }
    });
  } else {
    if (!confirm(`Hapus "${nama}"?`)) return;
    try {
      const token = localStorage.getItem('token');
      const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
      const res = await fetch(`/api/admin/tahun-ajaran/${id}`, { method: 'DELETE', headers });
      const data = await res.json();
      if (data.success) { loadTA(); }
    } catch (error) { console.error('Delete TA error:', error); }
  }
}

async function setActive(id) {
  try {
    const token = localStorage.getItem('token');
    const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
    const res = await fetch(`/api/admin/tahun-ajaran/${id}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: 1 })
    });
    const data = await res.json();
    if (data.success) { loadTA(); }
  } catch (error) { console.error('Set active error:', error); }
}

function viewSemester(taId) {
  currentTAId = taId;
  const ta = allTAData.find(t => t.id === taId);
  const section = document.getElementById('semesterSection');
  const title = document.getElementById('semesterSectionTitle');
  if (section) section.classList.remove('hidden');
  if (title && ta) title.textContent = `Semester - ${ta.nama}`;
  loadSemesters(taId);
}

async function loadSemesters(taId) {
  const tbody = document.getElementById('semesterTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-8 text-center text-gray-500"><i class="fas fa-spinner fa-spin mr-2"></i>Memuat...</td></tr>';

  try {
    const token = localStorage.getItem('token');
    const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
    const res = await fetch(`/api/admin/tahun-ajaran/${taId}`, { headers });
    const data = await res.json();

    if (data.success && data.data && data.data.semesters) {
      const semesters = data.data.semesters;
      if (!semesters.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-8 text-center text-gray-500">Belum ada semester</td></tr>';
        return;
      }
      tbody.innerHTML = semesters.map((s, idx) => `
        <tr class="hover:bg-gray-50 border-b border-gray-100">
          <td class="px-6 py-4 text-sm text-gray-900">${idx + 1}</td>
          <td class="px-6 py-4 text-sm font-medium text-gray-900">${s.nama || '-'}</td>
          <td class="px-6 py-4 text-sm text-gray-600">${s.tanggal_mulai ? formatDate(s.tanggal_mulai) : '-'}</td>
          <td class="px-6 py-4 text-sm text-gray-600">${s.tanggal_selesai ? formatDate(s.tanggal_selesai) : '-'}</td>
          <td class="px-6 py-4 text-center">
            <button onclick="deleteSemester(${s.id}, ${taId})" class="text-red-600 hover:text-red-800" title="Hapus"><i class="fas fa-trash"></i></button>
          </td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-8 text-center text-gray-500">Tidak ada data</td></tr>';
    }
  } catch (error) {
    console.error('Load semesters error:', error);
    tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-8 text-center text-red-500">Error memuat data</td></tr>';
  }
}

function openSemesterModal() {
  if (!currentTAId) return;
  document.getElementById('semesterTaId').value = currentTAId;
  document.getElementById('semesterNama').value = 'Ganjil';
  document.getElementById('semesterTanggalMulai').value = '';
  document.getElementById('semesterTanggalSelesai').value = '';
  document.getElementById('semesterModal').classList.add('show');
}

function closeSemesterModal() {
  document.getElementById('semesterModal').classList.remove('show');
}

async function saveSemester(event) {
  event.preventDefault();
  const taId = document.getElementById('semesterTaId').value;
  const nama = document.getElementById('semesterNama').value;
  const tanggalMulai = document.getElementById('semesterTanggalMulai').value;
  const tanggalSelesai = document.getElementById('semesterTanggalSelesai').value;

  if (!taId || !tanggalMulai || !tanggalSelesai) {
    if (typeof swal !== 'undefined') swal('Error', 'Data wajib diisi', 'error');
    return;
  }

  try {
    const token = localStorage.getItem('token');
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': 'Bearer ' + token } : {})
    };

    const res = await fetch('/api/admin/tahun-ajaran/semester', {
      method: 'POST',
      headers,
      body: JSON.stringify({ tahun_ajaran_id: parseInt(taId), nama, tanggal_mulai: tanggalMulai, tanggal_selesai: tanggalSelesai })
    });
    const data = await res.json();

    if (data.success) {
      closeSemesterModal();
      loadSemesters(parseInt(taId));
      if (typeof swal !== 'undefined') swal('Berhasil', data.message, 'success');
    } else {
      if (typeof swal !== 'undefined') swal('Error', data.message || 'Gagal menyimpan', 'error');
    }
  } catch (error) {
    console.error('Save semester error:', error);
    if (typeof swal !== 'undefined') swal('Error', 'Terjadi kesalahan', 'error');
  }
}

async function deleteSemester(semesterId, taId) {
  if (typeof swal !== 'undefined') {
    swal({ title: 'Hapus Semester?', text: 'Yakin hapus semester ini?', icon: 'warning', buttons: true, dangerMode: true })
      .then(async (willDelete) => {
        if (willDelete) {
          try {
            const token = localStorage.getItem('token');
            const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
            const res = await fetch(`/api/admin/semester/${semesterId}`, { method: 'DELETE', headers });
            const data = await res.json();
            if (data.success) {
              loadSemesters(taId);
              swal('Dihapus', 'Semester dihapus', 'success');
            } else {
              swal('Error', data.message || 'Gagal menghapus', 'error');
            }
          } catch (e) { console.error(e); }
        }
      });
  } else {
    if (!confirm('Hapus semester?')) return;
    try {
      const token = localStorage.getItem('token');
      const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
      await fetch(`/api/admin/semester/${semesterId}`, { method: 'DELETE', headers });
      loadSemesters(taId);
    } catch (e) { console.error(e); }
  }
}

document.addEventListener('DOMContentLoaded', function () {
  loadTA();
});
