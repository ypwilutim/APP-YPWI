// ============================================================
// AUTH MIDDLEWARE - Authentication & Authorization
// Extracted from server.js for modular architecture
// ============================================================

const jwt = require('jsonwebtoken');
const db = require('../../db');
const { logToFile } = require('../middlewares/logger');

const SECRET_KEY = process.env.JWT_SECRET || 'ypwi-secret-key-2026';

// ============================================================
// MIDDLEWARE
// ============================================================

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Akses ditolak. Token tidak ditemukan.'
    });
  }

  jwt.verify(token, SECRET_KEY, async (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak. Token tidak valid.'
      });
    }
    req.user = user;

    // Use assignments from JWT if present (backward compatible), otherwise load from database
    if (user.assignments && user.assignments.length > 0) {
      req.user.assignments = user.assignments;
      console.log('[AUTH_DEBUG] Using assignments from JWT, count:', user.assignments.length);
    } else if (user.guru_id) {
      try {
        console.log('[AUTH_DEBUG] Loading assignments from DB for guru_id:', user.guru_id);
        const assignments = await db.query(
          'SELECT ta.tenant_id, ta.jabatan_di_unit, t.nama_sekolah FROM teacher_assignments ta JOIN tenants t ON ta.tenant_id = t.tenant_id WHERE ta.teacher_id = ? AND ta.status_aktif = 1',
          [user.guru_id]
        );
        req.user.assignments = assignments;
        console.log('[AUTH_DEBUG] Loaded assignments from DB:', assignments?.length || 0, 'data:', assignments);
      } catch (error) {
        req.user.assignments = [];
        console.error('[AUTH_DEBUG] Error loading assignments:', error.message);
      }
    } else {
      req.user.assignments = [];
    }

    next();
  });
};

const authenticateAdmin = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  logToFile(`AUTH_ADMIN: Endpoint called, authHeader=${!!authHeader}, token=${!!token}`);

  if (!token) {
    logToFile('AUTH_ADMIN: No token found - returning 401');
    return res.status(401).json({ success: false, message: 'Access denied. Token not found.' });
  }
  jwt.verify(token, SECRET_KEY, async (err, user) => {
    logToFile(`AUTH_ADMIN: JWT verify - error=${!!err}, user=${!!user}`);
    if (err) {
      logToFile('AUTH_ADMIN: JWT invalid - returning 403');
      return res.status(403).json({ success: false, message: 'Access denied. Token not valid.' });
    }

    // Load assignments if not present in JWT (backward compatible)
    if (!user.assignments || user.assignments.length === 0) {
      if (user.guru_id) {
        try {
          const assignments = await db.query(
            'SELECT ta.tenant_id, ta.jabatan_di_unit, t.nama_sekolah FROM teacher_assignments ta JOIN tenants t ON ta.tenant_id = t.tenant_id WHERE ta.teacher_id = ? AND ta.status_aktif = 1',
            [user.guru_id]
          );
          user.assignments = assignments;
          logToFile(`AUTH_ADMIN: Loaded assignments count=${assignments.length}`);
        } catch (error) {
          user.assignments = [];
          logToFile(`AUTH_ADMIN: Error loading assignments - ${error.message}`);
        }
      } else {
        user.assignments = [];
      }
    }

    // Allow admin OR guru with operator assignments
    const adminRoles = ['admin', 'tu', 'tatausaha', 'operator', 'ta', 'tata_usaha'];
    const hasAdminAccess = user.role === 'admin' ||
      (user.role === 'guru' && user.assignments &&
        user.assignments.some(a => adminRoles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''))));

    logToFile(`AUTH_ADMIN: User role=${user.role}, hasAdminAccess=${hasAdminAccess}`);

    if (!hasAdminAccess) {
      logToFile('AUTH_ADMIN: Access denied - not admin/operator');
      return res.status(403).json({ success: false, message: 'Access denied. Admin/Operator role required.' });
    }
    logToFile('AUTH_ADMIN: Access granted');
    req.user = user;
    next();
  });
};

const authenticateOperator = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  logToFile(`AUTH_OPERATOR: Endpoint called, hasToken=${!!token}`);
  if (!token) {
    logToFile('AUTH_OPERATOR: No token found - returning 401');
    return res.status(401).json({ success: false, message: 'Access denied. Token not found.' });
  }
  jwt.verify(token, SECRET_KEY, async (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'Access denied. Token not valid.' });
    }

    // Load assignments for role-based access (needed for both admin and guru)
    // Prefer assignments from JWT if present (backward compatible with old tokens)
    if (!user.assignments || user.assignments.length === 0) {
      // Only load assignments if user has guru_id (not for pure admin users)
      if (user.guru_id) {
        try {
          const assignments = await db.query(
            'SELECT ta.tenant_id, ta.jabatan_di_unit, t.nama_sekolah FROM teacher_assignments ta JOIN tenants t ON ta.tenant_id = t.tenant_id WHERE ta.teacher_id = ? AND ta.status_aktif = 1',
            [user.guru_id]
          );
          user.assignments = assignments;
        } catch (error) {
          user.assignments = [];
        }
      } else {
        user.assignments = [];
      }
    }
    req.user = user;

    // Admin boleh semua
    if (user.role === 'admin') {
      logToFile(`AUTH_OPERATOR: Admin access granted`);
      return next();
    }
    // Guru dengan assignment admin/TU/operator: boleh akses
    if (user.role === 'guru' && user.assignments) {
      const adminRoles = ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin', 'ketua', 'kepala', 'pimpinan', 'kepalasekolah', 'bendahara'];
      const hasAdminRole = user.assignments.some(a =>
        adminRoles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''))
      );
      if (hasAdminRole) {
        logToFile(`AUTH_OPERATOR: Guru with admin role access granted`);
        return next();
      }
    }
    logToFile(`AUTH_OPERATOR: Access denied - role=${user.role}`);
    return res.status(403).json({ success: false, message: 'Akses ditolak. Peran admin/operator diperlukan.' });
  });
};

const authenticateKetua = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Access denied. Token not found.' });
  jwt.verify(token, SECRET_KEY, async (err, user) => {
    if (err) return res.status(403).json({ success: false, message: 'Access denied. Token not valid.' });

    if (!user.assignments || user.assignments.length === 0) {
      if (user.guru_id) {
        try {
          user.assignments = await db.query(
            'SELECT ta.tenant_id, ta.jabatan_di_unit, t.nama_sekolah FROM teacher_assignments ta JOIN tenants t ON ta.tenant_id = t.tenant_id WHERE ta.teacher_id = ? AND ta.status_aktif = 1',
            [user.guru_id]
          );
        } catch (error) {
          user.assignments = [];
        }
      } else {
        user.assignments = [];
      }
    }
    req.user = user;

    const ketuaRoles = ['ketua', 'kepala', 'pimpinan', 'kepalasekolah'];
    const hasKetuaRole = user.role === 'admin' || (user.role === 'guru' && user.assignments &&
      user.assignments.some(a => ketuaRoles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, '')))
    );

    if (!hasKetuaRole) {
      return res.status(403).json({ success: false, message: 'Akses ditolak. Peran ketua/kepala/pimpinan diperlukan.' });
    }

    // Additional check: must be at YPWILUTIM for summary endpoints
    if (user.role !== 'admin') {
      const hasYPWILUTIM = user.assignments?.some(a => a.tenant_id === 'YPWILUTIM');
      if (!hasYPWILUTIM) {
        return res.status(403).json({ success: false, message: 'Akses ditolak. Hanya untuk ketua/kepala di YPWILUTIM.' });
      }
    }
    next();
  });
};

function verifyTenantAccess(req, requestedTenantId) {
  if (!requestedTenantId) return true;
  const userRole = req.user?.role;
  const assignments = req.user?.assignments || [];

  if (userRole === 'admin') return true;

  if (userRole === 'guru' && assignments.length > 0) {
    const adminRoles = ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin', 'ketua', 'kepala', 'pimpinan', 'kepalasekolah', 'bendahara'];
    const allowedTenants = assignments
      .filter(a => adminRoles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, '')))
      .map(a => a.tenant_id);

    // User YPWILUTIM bendahara boleh akses semua tenant
    if (allowedTenants.includes('YPWILUTIM')) return true;

    if (allowedTenants.includes(requestedTenantId)) return true;
  }

  return false;
}

function getTenantFilter(tenantId) {
  if (tenantId) {
    return { where: 'tenant_id = ?', params: [tenantId] };
  }
  return { where: '', params: [] };
}

// Check if current day matches rule days
function isDayMatch(ruleHari, currentDay) {
  if (!ruleHari || ruleHari.trim() === '') return true;

  const rule = ruleHari.toLowerCase().trim();
  const day = currentDay.toLowerCase().trim();

  if (rule.includes('-')) {
    const [start, end] = rule.split('-').map(d => d.trim());
    const days = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
    const startIdx = days.indexOf(start);
    const endIdx = days.indexOf(end);
    const currentIdx = days.indexOf(day);
    if (startIdx === -1 || endIdx === -1 || currentIdx === -1) return false;
    return currentIdx >= startIdx && currentIdx <= endIdx;
  }

  const ruleDays = rule.split(',').map(d => d.trim());
  return ruleDays.includes(day);
}

// Calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Format Islamic message with proper greeting
function formatIslamicMessage(nama, jenis_kelamin, message) {
  const panggilan = jenis_kelamin === 'P' ? 'Ustadzah' : 'Ustadz';
  return `Assalamu'alaikum ${panggilan} ${nama}\n\n${message}\n\nBarakallahu fiikum,\n*YPWI Lutim*`;
}

function isSuperAdminTenant(tenantId) {
  return tenantId === 'YPWILUTIM';
}

module.exports = {
  authenticateToken,
  authenticateAdmin,
  authenticateOperator,
  authenticateKetua,
  verifyTenantAccess,
  isDayMatch,
  calculateDistance,
  formatIslamicMessage,
  getTenantFilter,
  isSuperAdminTenant,
  SECRET_KEY
};