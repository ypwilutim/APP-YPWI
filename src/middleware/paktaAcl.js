// ============================================================
// PAKTA ACL - Role Based Access Control (RBAC)
// Penandatangan : jabatan_di_unit IN ['Kepala Sekolah','Pimpinan','Pimpinan Pondok','Ketua']
// Pelihat       : tenant_id = 'YPWILUTIM' DAN jabatan_di_unit IN ['Admin','Ketua']
// ============================================================

const db = require('../../db');

const SIGNER_JABATANS = ['kepalasekolah', 'pimpinan', 'pimpinanpondok', 'ketua'];
const VIEWER_JABATANS = ['admin', 'ketua'];
const VIEWER_TENANT = 'YPWILUTIM';

const normalizeJabatan = (j) => (j || '').toLowerCase().replace(/\s/g, '');

// Pastikan assignments user sudah termuat (konsisten dg auth middleware)
async function ensureAssignments(req) {
  const user = req.user;
  if (!user) return [];
  if (Array.isArray(user.assignments) && user.assignments.length > 0) {
    return user.assignments;
  }
  if (user.guru_id) {
    const rows = await db.query(
      `SELECT ta.tenant_id, ta.jabatan_di_unit
         FROM teacher_assignments ta
        WHERE ta.teacher_id = ? AND ta.status_aktif = 1`,
      [user.guru_id]
    );
    user.assignments = rows || [];
    return user.assignments;
  }
  return [];
}

// ---- Fungsi murni (bisa diuji / dipakai di controller) ----

function checkAccessSign(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const assignments = user.assignments || [];
  return assignments.some((a) =>
    SIGNER_JABATANS.includes(normalizeJabatan(a.jabatan_di_unit))
  );
}

function checkAccessView(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const assignments = user.assignments || [];
  return assignments.some(
    (a) =>
      a.tenant_id === VIEWER_TENANT &&
      VIEWER_JABATANS.includes(normalizeJabatan(a.jabatan_di_unit))
  );
}

// ---- Middleware Express ----

const requireSignAccess = async (req, res, next) => {
  try {
    await ensureAssignments(req);
    if (!checkAccessSign(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak. Hanya Kepala Sekolah, Pimpinan, Pimpinan Pondok, atau Ketua yang berhak menandatangani.'
      });
    }
    next();
  } catch (err) {
    console.error('requireSignAccess error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal memeriksa akses penandatangan.' });
  }
};

const requireViewAccess = async (req, res, next) => {
  try {
    await ensureAssignments(req);
    if (!checkAccessView(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak. Hanya Admin/Ketua tenant YPWILUTIM yang berhak melihat dokumen.'
      });
    }
    next();
  } catch (err) {
    console.error('requireViewAccess error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal memeriksa akses pelihat.' });
  }
};

module.exports = {
  SIGNER_JABATANS,
  VIEWER_JABATANS,
  VIEWER_TENANT,
  normalizeJabatan,
  ensureAssignments,
  checkAccessSign,
  checkAccessView,
  requireSignAccess,
  requireViewAccess
};
