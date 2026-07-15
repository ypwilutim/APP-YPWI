// ============================================================
// pakta-sign.js - Pakta Integritas (signature_pad + html2canvas + jsPDF)
// ============================================================
(function () {
  'use strict';

  const token = localStorage.getItem('token');
  const api = (p, opt) => fetch('/api' + p, Object.assign({ headers: { Authorization: 'Bearer ' + token } }, opt));

  const $ = (id) => document.getElementById(id);
  const PAKTA_SIGNER_JABATANS = ['kepalasekolah', 'pimpinan', 'pimpinanpondok', 'ketua'];
  let locked = false;
  let signingTenantId = null;
  let signaturePad = null;
  const canvas = $('sig-canvas');

  const isSigner = (a) =>
    PAKTA_SIGNER_JABATANS.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''));

  function setStatus(msg, ok) {
    const b = $('statusBox');
    if (!b) return;
    b.textContent = msg;
    b.className = 'status ' + (ok ? 'ok' : 'err');
  }

  function setTanggal() {
    const tgl = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const el = $('tglDokumen');
    if (el) el.textContent = tgl;
  }

  // ---- Load user data (Nama, Jabatan, Unit) ----
  async function loadUserInfo() {
    try {
      const res = await api('/teacher/info');
      const json = await res.json();
      if (!json.success) {
        setStatus('Gagal memuat data user.', false);
        return;
      }

      const teacher = json.teacher || {};
      const assignments = json.assignments || [];

      const signerUnit = assignments.find(isSigner) || assignments[0];
      signingTenantId = signerUnit ? signerUnit.tenant_id : null;

      const nama = teacher.nama || '-';
      const jabatan = signerUnit ? (signerUnit.jabatan_di_unit || '-') : '-';
      const unit = signerUnit ? (signerUnit.nama_sekolah || signerUnit.tenant_id || '-') : '-';

      if ($('namaUser')) $('namaUser').textContent = nama;
      if ($('namaUserBawah')) $('namaUserBawah').textContent = nama;
      if ($('jabatanUser')) $('jabatanUser').textContent = jabatan;
      if ($('unitUser')) $('unitUser').textContent = unit;
    } catch (e) {
      console.error('loadUserInfo error:', e);
      setStatus('Gagal memuat data user: ' + e.message, false);
    }
  }

  // ---- Signature Pad (dijaga agar tidak menggagalkan field lain) ----
  function resizeCanvas() {
    if (!signaturePad || !canvas) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const data = signaturePad.toData();
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext('2d').scale(ratio, ratio);
    signaturePad.clear();
    if (data && data.length) signaturePad.fromData(data);
  }

  function initSignaturePad() {
    if (typeof SignaturePad === 'undefined' || !canvas) {
      setStatus('Library tanda tangan gagal dimuat. Periksa koneksi internet (CDN signature_pad).', false);
      const btn = $('btnSign');
      if (btn) btn.disabled = true;
      return;
    }
    signaturePad = new SignaturePad(canvas, {
      backgroundColor: 'rgba(0,0,0,0)',
      penColor: 'rgb(15,23,42)'
    });
    window.signaturePad = signaturePad;
    resizeCanvas();
  }

  // ---- Generate & Submit PDF ----
  async function generatePDF() {
    if (locked) return;
    if (!signaturePad || signaturePad.isEmpty()) {
      setStatus('Silakan buat tanda tangan terlebih dahulu.', false);
      return;
    }

    locked = true;
    $('btnSign').disabled = true;
    setStatus('Memproses dokumen...', true);

    try {
const signatureData = canvas.toDataURL('image/png');
       const periode = new Date().toISOString().slice(0, 7);

const res = await api('/pakta/sign', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, { Authorization: 'Bearer ' + token }),
        body: JSON.stringify({ periode, signature_data: signatureData, tenant_id: signingTenantId })
      });
      const json = await res.json();
      if (json.success) {
        setStatus('Berhasil! Surat Pernyataan Komitmen tersimpan.', true);
        showSuccessModal();
      } else {
        setStatus(json.message || 'Gagal menyimpan pakta.', false);
      }
    } catch (e) {
      console.error(e);
      setStatus('Terjadi kesalahan: ' + e.message, false);
    } finally {
      locked = false;
      $('btnSign').disabled = false;
    }
  }

  function showSuccessModal() {
    const m = $('paktaSuccessModal');
    if (m) m.style.display = 'flex';
  }

  function goToDashboard() {
    window.location.href = 'dashboard.html';
  }

  window.generatePDF = generatePDF;
  window.clearSignature = () => {
    console.log('clearSignature called, signaturePad:', typeof signaturePad, signaturePad ? 'exists' : 'null');
    if (signaturePad && typeof signaturePad.clear === 'function') {
      signaturePad.clear();
      console.log('SignaturePad cleared successfully');
    } else {
      console.warn('SignaturePad not initialized - will try re-init');
      if (typeof SignaturePad !== 'undefined' && canvas) {
        signaturePad = new SignaturePad(canvas, { backgroundColor: 'rgba(0,0,0,0)', penColor: 'rgb(15,23,42)' });
        signaturePad.clear();
      }
    }
  };
  window.addEventListener('resize', resizeCanvas);

  // Jalankan pengisian field duluan (tidak bergantung SignaturePad)
  setTanggal();
  loadUserInfo();
  initSignaturePad();
})();
