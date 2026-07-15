// ============================================================
// pakta-viewer.js - Daftar & pratinjau PDF pakta (Viewer RBAC)
// ============================================================
(function () {
  'use strict';

  const token = localStorage.getItem('token');
  const api = (p, opt) => fetch('/api' + p, Object.assign({ headers: { Authorization: 'Bearer ' + token } }, opt));

  const $ = (id) => document.getElementById(id);

  function fmtDate(s) {
    if (!s) return '-';
    const d = new Date(s);
    return isNaN(d) ? s : d.toLocaleString('id-ID');
  }

  async function loadRecords() {
    const tenant = $('tenantFilter').value.trim();
    let url = '/pakta/records';
    if (tenant) url += '?tenant_id=' + encodeURIComponent(tenant);
    try {
      const res = await api(url);
      const json = await res.json();
      if (!json.success) {
        $('rows').innerHTML = '<tr><td colspan="6" class="empty">' + (json.message || 'Gagal memuat.') + '</td></tr>';
        return;
      }
      const data = json.data || [];
      if (data.length === 0) {
        $('rows').innerHTML = '<tr><td colspan="6" class="empty">Belum ada dokumen.</td></tr>';
        return;
      }
      $('rows').innerHTML = data.map((r) => {
        const badge = r.status === 'sudah'
          ? '<span class="badge">Sudah</span>'
          : '<span class="badge no">Belum</span>';
        const aksi = r.pdf_path
          ? '<a class="link" href="#" data-id="' + r.id + '">Lihat</a>'
          : '-';
        return '<tr>' +
          '<td>' + (r.nama_guru || r.teacher_id) + '</td>' +
          '<td>' + r.tenant_id + '</td>' +
          '<td>' + r.periode + '</td>' +
          '<td>' + badge + '</td>' +
          '<td>' + fmtDate(r.signed_at) + '</td>' +
          '<td>' + aksi + '</td>' +
        '</tr>';
      }).join('');
    } catch (e) {
      $('rows').innerHTML = '<tr><td colspan="6" class="empty">Error: ' + e.message + '</td></tr>';
    }
  }

  let previewUrl = null;
  function showPreviewError(msg) {
    const el = $('previewError');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
    const btn = $('btnOpenPdf');
    if (btn) btn.style.display = 'none';
  }

  async function preview(id) {
    const errEl = $('previewError');
    const openBtn = $('btnOpenPdf');
    if (errEl) errEl.style.display = 'none';
    if (openBtn) openBtn.style.display = 'none';
    try {
      const res = await api('/pakta/file/' + id);
      if (!res.ok) {
        showPreviewError('Gagal memuat file (HTTP ' + res.status + '). Pastikan dokumen sudah diunggah.');
        return;
      }
      const blob = await res.blob();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      $('preview').src = previewUrl;
      if (openBtn) {
        openBtn.style.display = 'inline-block';
        openBtn.onclick = () => window.open(previewUrl, '_blank');
      }
    } catch (e) {
      showPreviewError('Terjadi kesalahan: ' + e.message);
    }
  }

  $('rows').addEventListener('click', (e) => {
    const a = e.target.closest('a[data-id]');
    if (a) { e.preventDefault(); preview(a.getAttribute('data-id')); }
  });
  $('btnRefresh').addEventListener('click', loadRecords);

  loadRecords();
})();
