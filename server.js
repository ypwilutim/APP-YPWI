require('dotenv').config();

console.log('Loading environment variables...');
console.log('EMAIL_HOST:', process.env.EMAIL_HOST ? 'LOADED' : 'NOT FOUND');

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const axios = require('axios');
const PDFKit = require('pdfkit');
const nodemailer = require('nodemailer');
const db = require('./db');
const { requestLogger } = require('./src/middlewares/logger');
const validator = require('validator');

// Native fetch is available in modern Node.js, no import needed

// Helper function to check if current day matches rule days
function isDayMatch(ruleHari, currentDay) {
  if (!ruleHari || ruleHari.trim() === '') return true; // All days if empty

  const rule = ruleHari.toLowerCase().trim();
  const day = currentDay.toLowerCase().trim();

  // Handle range: 'senin-kamis'
  if (rule.includes('-')) {
    const [start, end] = rule.split('-').map(d => d.trim());
    const days = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
    const startIdx = days.indexOf(start);
    const endIdx = days.indexOf(end);
    const currentIdx = days.indexOf(day);

    if (startIdx === -1 || endIdx === -1 || currentIdx === -1) return false;
    return currentIdx >= startIdx && currentIdx <= endIdx;
  }

  // Handle multiple days: 'senin,rabu,kamis'
  const ruleDays = rule.split(',').map(d => d.trim());
  return ruleDays.includes(day);
}

// Format Islamic message with proper greeting
function formatIslamicMessage(nama, jenis_kelamin, message) {
  const panggilan = jenis_kelamin === 'P' ? 'Ustadzah' : 'Ustadz';
  return `Assalamu'alaikum ${panggilan} ${nama}\n\n${message}\n\nBarakallahu fiikum,\n*YPWI Lutim*`;
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger); // Robust logging - MUST after body parsers
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.JWT_SECRET || 'ypwi-secret-key-2026';

// Multer config for selfie uploads
const selfieStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'selfie/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'selfie-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const selfieUpload = multer({ storage: selfieStorage });

// Environment check
console.log('🔧 Environment Configuration:');
console.log('   JWT_SECRET:', process.env.JWT_SECRET ? '✅ LOADED' : '❌ MISSING');
console.log('   DB_HOST:', process.env.DB_HOST ? '✅ LOADED' : '❌ MISSING');
console.log('   PORT:', PORT);
console.log('');

// Security middleware - disabled CSP for development with IP access
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for IP access
  crossOriginOpenerPolicy: false, // Disable COOP for IP access
  crossOriginEmbedderPolicy: false // Disable COEP for IP access
}));

// Custom headers to prevent HTTPS redirect and allow IP access
app.use((req, res, next) => {
  // Prevent HTTPS redirect by setting appropriate headers
  res.setHeader('Strict-Transport-Security', 'max-age=0');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');

  // Allow all origins for development
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  next();
});

// Preflight requests are handled by the CORS middleware above

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 login attempts per windowMs
  message: 'Too many login attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// app.use(limiter);
// app.use('/api/auth/login', authLimiter);

// Input sanitization middleware
const sanitizeInput = (req, res, next) => {
  const sanitize = (obj) => {
    for (let key in obj) {
      if (typeof obj[key] === 'string') {
        // Trim whitespace only - do NOT HTML-encode (breaks JSON data)
        obj[key] = obj[key].trim();
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitize(obj[key]);
      }
    }
  };

  if (req.body) sanitize(req.body);
  if (req.query) sanitize(req.query);
  if (req.params) sanitize(req.params);

  next();
};

// Only apply sanitize to non-file-upload routes
app.use('/api', sanitizeInput);

// Error handling for multer and generic errors
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File terlalu besar. Maksimal 5MB.'
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Terlalu banyak file. Maksimal 1 file.'
      });
    }
  }

  if (error.message && (error.message.includes('Only image files') || error.message.includes('file gambar') || error.message.includes('Format file'))) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }

  // Generic error handler - log full error for debugging
  console.error('[UNHANDLED ERROR]', error.message);
  console.error(error.stack);
  return res.status(500).json({
    success: false,
    message: 'Internal server error: ' + error.message
  });
});

// Configure multer for file uploads
const teacherStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'teacher-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const teacherUpload = multer({
  storage: teacherStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 1 // Maximum 1 file
  },
  fileFilter: (req, file, cb) => {
    // Check if file is an image
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Hanya file gambar yang diperbolehkan (JPG, PNG, GIF)'));
    }

    // Check file extension
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif'];
    const fileExtension = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.includes(fileExtension)) {
      return cb(new Error('Format file tidak didukung. Gunakan JPG, PNG, atau GIF'));
    }

    cb(null, true);
  }
});

app.use(cors());
app.use(express.static('public', { index: false }));

// Redirect root: subdomain pembayaran -> landing publik, domain utama -> login admin
app.get('/', (req, res) => {
  const host = req.get('host') || '';
  if (host.toLowerCase().startsWith('payment.')) {
    return res.redirect('/landing.html');
  }
  res.redirect('/login.html');
});

// Import modular routes
const absensiRoutes = require('./src/routes/absensi');
const authRoutes = require('./src/routes/auth');
const scannerRoutes = require('./src/routes/scanner');
const adminRoutes = require('./src/routes/admin');
const idcardRoutes = require('./src/routes/idcard');
const chatRoutes = require('./src/routes/chat');
const notificationsRoutes = require('./src/routes/notifications');
const skGuruRoutes = require('./src/routes/sk-guru');
const payrollRoutes = require('./src/routes/payroll');
const wahaRoutes = require('./src/routes/waha');
require('./src/notifications');

// Start Baileys (WhatsApp Web) as the primary sender when WhatsApp is enabled
if (process.env.WHATSAPP_ENABLED !== 'false') {
  require('./src/utils/whatsappBaileys').initWhatsAppBaileys().catch(err => {
    console.error('[WAHA] Failed to initialize:', err.message);
  });
}

app.use('/api', absensiRoutes);
app.use('/api', authRoutes);
app.use('/api', scannerRoutes);
app.use('/api', adminRoutes);
app.use('/api', require('./src/routes/employment-rules'));
app.use('/api/idcard', idcardRoutes);
app.use('/api', chatRoutes);
app.use('/api', notificationsRoutes);
app.use('/api', skGuruRoutes);
app.use('/api', payrollRoutes);
app.use('/api', require('./src/routes/paktaIntegritas'));
app.use('/api', wahaRoutes);
app.use('/api', require('./src/routes/treasurer'));
app.use('/api', require('./src/routes/xendit'));
app.use('/api', require('./src/routes/payments'));
app.use('/api', require('./src/routes/midtrans'));
app.use('/api', require('./src/routes/doku'));
app.use('/api', require('./src/routes/public'));
app.use('/api', require('./src/routes/whatsapp-inbound'));

const logFilePath = path.join(__dirname, 'logs', 'app.log');
// Ensure logs directory exists
if (!fs.existsSync(path.join(__dirname, 'logs'))) {
  fs.mkdirSync(path.join(__dirname, 'logs'));
}
const logger = {
  request: (req, message = '') => {
    const timestamp = new Date().toISOString();
    const { method, url, headers, body } = req;
    const safeBody = { ...body };
    if (safeBody.password) safeBody.password = '[HIDDEN]';
    const logMessage = `[${timestamp}] 🌍 REQUEST  | ${method.padEnd(6)} | ${url.padEnd(40)} | Body: ${JSON.stringify(safeBody)}`;
    console.log(logMessage);
    fs.appendFileSync(logFilePath, logMessage + '\n', 'utf8');
  },
  response: (req, res, statusCode) => {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] 📤 RESPONSE | ${req.method.padEnd(6)} | ${req.url.padEnd(40)} | Status: ${statusCode}`;
    console.log(logMessage);
    fs.appendFileSync(logFilePath, logMessage + '\n', 'utf8');
  },
  loginDebug: {
    receivedData: (data) => {
      const timestamp = new Date().toISOString();
      const safeData = { ...data };
      if (safeData.password) safeData.password = '[HIDDEN]';
      const logMessage = `[${timestamp}] 🔐 LOGIN_DEBUG | [1/3] Data received from body: ${JSON.stringify(safeData)}`;
      console.log(logMessage);
      fs.appendFileSync(logFilePath, logMessage + '\n', 'utf8');
    },
    queryResult: (user) => {
      const timestamp = new Date().toISOString();
      let logMessage;
      if (user) {
        logMessage = `[${timestamp}] 🔐 LOGIN_DEBUG | [2/3] User found in DB: ${JSON.stringify({ id: user.id, username: user.username, role: user.role, tenant_id: user.tenant_id, guru_id: user.guru_id, hasPassword: !!user.password, is_profile_complete: user.is_profile_complete })}`;
      } else {
        logMessage = `[${timestamp}] 🔐 LOGIN_DEBUG | [2/3] No records found`;
      }
      console.log(logMessage);
      fs.appendFileSync(logFilePath, logMessage + '\n', 'utf8');
    },
    passwordCheck: (isValid) => {
      const timestamp = new Date().toISOString();
      const logMessage = `[${timestamp}] 🔐 LOGIN_DEBUG | [3/3] Password comparison result: ${isValid ? '✅ MATCH' : '❌ MISMATCH'}`;
      console.log(logMessage);
      fs.appendFileSync(logFilePath, logMessage + '\n', 'utf8');
    }
  },
  error: (error, context = '') => {
    const timestamp = new Date().toISOString();
    const logMessage = `\n[${timestamp}] ❌ ERROR    | Context: ${context}\n[${timestamp}] ❌ ERROR    | Message: ${error.message}\n[${timestamp}] ❌ ERROR    | Stack Trace:\n${error.stack}\n`;
    console.error(logMessage);
    fs.appendFileSync(logFilePath, logMessage + '\n', 'utf8');
  },
};

// Request logging middleware moved early (after body parsers) - duplicate removed to prevent empty body logs

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Akses ditolak. Token tidak ditemukan.'
    });
  }

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak. Token tidak valid.'
      });
    }
    req.user = user;
    next();
  });
};

// Admin-only middleware
const authenticateAdmin = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, message: 'Access denied. Token not found.' });
  }
  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'Access denied. Token not valid.' });
    }
    if (user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });
    }
    req.user = user;
    next();
  });
};

// Operator (guru/TU) middleware: mengizinkan admin DAN guru dengan assignment admin/TU/operator
const authenticateOperator = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, message: 'Access denied. Token not found.' });
  }
  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'Access denied. Token not valid.' });
    }
    // Admin boleh semua
    if (user.role === 'admin') {
      req.user = user;
      return next();
    }
    // Guru dengan assignment admin/TU/operator/ta/bendahara: boleh akses
    if (user.role === 'guru' && user.assignments) {
      const adminRoles = ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin', 'bendahara'];
      const hasAdminRole = user.assignments.some(a =>
        adminRoles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''))
      );
      if (hasAdminRole) {
        req.user = user;
        return next();
      }
    }
    return res.status(403).json({ success: false, message: 'Akses ditolak. Peran admin/operator diperlukan.' });
  });
};

// Helper: Build tenant filter untuk query SQL
function getTenantFilter(tenantId) {
  if (tenantId) {
    return { where: 'tenant_id = ?', params: [tenantId] };
  }
  return { where: '', params: [] };
}

// Helper: Verify tenant access untuk operators
function verifyTenantAccess(req, requestedTenantId) {
  if (!requestedTenantId) return true; // Admin pusat: akses semua
  const userRole = req.user?.role;
  const assignments = req.user?.assignments || [];

  // Super admin boleh semua
  if (userRole === 'admin') return true;

  // Guru dengan assignment admin/TU/operator/ta: cek apakah tenant_id ada di assignment-nya
  if (userRole === 'guru' && assignments.length > 0) {
    const adminRoles = ['tu', 'tatausaha', 'operator', 'ta', 'tata_usaha', 'admin'];
    const allowedTenants = assignments
      .filter(a => adminRoles.includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, '')))
      .map(a => a.tenant_id);

    if (allowedTenants.includes(requestedTenantId)) return true;
  }

  return false;
}

// WhatsApp integration using Baileys (WhatsApp Web protocol) - replaces Whacenter
async function sendWhatsAppMessage(number, message) {
  if (process.env.WHATSAPP_ENABLED === 'false') {
    console.log('📤 WhatsApp disabled, skipping message to:', number);
    return { success: true, message: 'WhatsApp disabled' };
  }

  try {
    const baileys = require('./src/utils/whatsappBaileys');

    if (!baileys.isConnected()) {
      return {
        success: false,
        message: 'WhatsApp belum terhubung. Buka fitur "WhatsApp Messenger" dan scan QR terlebih dahulu.'
      };
    }

    // Ensure number starts with country code (Indonesia)
    let cleanNumber = number.replace(/\D/g, '');
    if (!cleanNumber.startsWith('62')) {
      if (cleanNumber.startsWith('0')) {
        cleanNumber = '62' + cleanNumber.substring(1);
      } else {
        cleanNumber = '62' + cleanNumber;
      }
    }

    console.log(`[WHATSAPP] Sending to ${cleanNumber}: ${message.substring(0, 50)}...`);
    const result = await baileys.sendWhatsAppBaileys(cleanNumber, message);
    return { success: true, message: 'Message sent successfully', messageId: result.messageId };
  } catch (error) {
    console.error('❌ WhatsApp send error:', error.message);
    return { success: false, message: `Gagal mengirim pesan: ${error.message}` };
  }
}

// Export WhatsApp function to global for use in route modules
global.sendWhatsAppMessage = sendWhatsAppMessage;

// Export email function to global for use in route modules
global.sendEmail = async (to, subject, htmlContent, textContent = '', attachments = [], category = 'system', relatedId = null, cc = null, bcc = null) => {
  if (!process.env.EMAIL_ENABLED || process.env.EMAIL_ENABLED !== 'true') {
    console.log('📧 Email disabled, skipping email to:', to);
    return { success: true, message: 'Email disabled' };
  }

  const transporter = createEmailTransporter();
  if (!transporter) {
    return { success: false, message: 'Email transporter not configured' };
  }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS email_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        from_email VARCHAR(255) NOT NULL,
        to_email VARCHAR(255) NOT NULL,
        cc VARCHAR(255) DEFAULT NULL,
        bcc VARCHAR(255) DEFAULT NULL,
        subject VARCHAR(255) NOT NULL,
        category VARCHAR(100) DEFAULT 'system',
        related_id INT DEFAULT NULL,
        status ENUM('pending', 'sent', 'failed', 'draft') DEFAULT 'pending',
        message_id VARCHAR(255) DEFAULT NULL,
        error_message TEXT DEFAULT NULL,
        body_text TEXT DEFAULT NULL,
        body_html LONGTEXT DEFAULT NULL,
        has_attachments TINYINT(1) DEFAULT 0,
        is_read TINYINT(1) DEFAULT 0,
        sent_at TIMESTAMP NULL DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const logResult = await db.query(
      'INSERT INTO email_logs (from_email, to_email, subject, category, related_id, status, body_text, body_html, has_attachments, cc, bcc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        process.env.EMAIL_USER || 'noreply@ypwilutim.com',
        to,
        subject,
        category,
        relatedId,
        'pending',
        textContent || null,
        htmlContent || null,
        attachments && attachments.length > 0 ? 1 : 0,
        cc || null,
        bcc || null
      ]
    );
    const logId = logResult.insertId;

    try {
      const info = await transporter.sendMail({
        from: `"YPWI Lutim" <${process.env.EMAIL_USER}>`,
        to: to,
        cc: cc || undefined,
        bcc: bcc || undefined,
        subject: subject,
        html: htmlContent,
        text: textContent,
        attachments: attachments
      });

      await db.query(
        'UPDATE email_logs SET status = ?, message_id = ?, sent_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['sent', info.messageId, logId]
      );

      console.log('✅ Email sent: %s', info.messageId);
      return { success: true, message: 'Email sent successfully', messageId: info.messageId, logId };
    } catch (error) {
      await db.query(
        'UPDATE email_logs SET status = ?, error_message = ? WHERE id = ?',
        ['failed', error.message, logId]
      );

      console.error('❌ Email error:', error.message);
      return { success: false, message: `Email error: ${error.message}`, logId };
    }
  } catch (error) {
    console.error('❌ Email log error:', error.message);
    return { success: false, message: `Email error: ${error.message}` };
  }
};

// Email transporter setup
const createEmailTransporter = () => {
  if (!process.env.EMAIL_HOST) {
    console.log('📧 Email host not configured, skipping email setup');
    return null;
  }
  
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT) || 465,
    secure: parseInt(process.env.EMAIL_PORT) === 465,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
};

// Test route
app.get('/api/test', (req, res) => {
  console.log('[DEBUG] /api/test called');
  res.json({ success: true, message: 'Test route works', timestamp: new Date().toISOString() });
});

// Dashboard route


// app.post('/api/change-password', authenticateToken, async (req, res) => {
//   try {
//     const { oldPassword, newPassword } = req.body;

//     if (!oldPassword || !newPassword) {
//       return res.status(400).json({ success: false, message: 'Password lama dan baru harus diisi' });
//     }

//     if (newPassword.length < 8) {
//       return res.status(400).json({ success: false, message: 'Password baru minimal 8 karakter' });
//     }

//     // Check password strength
//     if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
//       return res.status(400).json({ success: false, message: 'Password harus mengandung huruf besar, huruf kecil, dan angka' });
//     }

//     // Get current user data
//     const userRows = await db.query('SELECT password, is_default_password FROM users WHERE id = ?', [req.user.id]);
//     if (userRows.length === 0) {
//       return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
//     }

//     const user = userRows[0];

//     // Verify old password
//     const isOldPasswordValid = await bcrypt.compare(oldPassword, user.password);
//     if (!isOldPasswordValid) {
//       return res.status(400).json({ success: false, message: 'Password lama salah' });
//     }

//     // Hash new password
//     const hashedNewPassword = await bcrypt.hash(newPassword, 10);

//     // Update password and reset default password flag
//     await db.query(
//       'UPDATE users SET password = ?, is_default_password = 0, updated_at = NOW() WHERE id = ?',
//       [hashedNewPassword, req.user.id]
//     );

//     res.json({
//       success: true,
//       message: 'Password berhasil diubah!'
//     });
//   } catch (error) {
//     logger.error(error, 'Change password route');
//     res.status(500).json({ success: false, message: 'Error changing password' });
//   }
// });

app.post('/api/change-password', authenticateToken, async (req, res) => {
  try {
    const { oldPassword, newPassword, confirmPassword } = req.body;

    // 1. Validasi Input
    if (!oldPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ success: false, message: 'Semua field wajib diisi' });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Password baru dan konfirmasi tidak cocok' });
    }

// 2. Ambil data user
    const userRows = await db.query('SELECT u.id, u.password, t.nama, t.email FROM users u LEFT JOIN teachers t ON u.guru_id = t.id WHERE u.id = ?', [req.user.id]);

    if (!userRows || userRows.length === 0) {
      return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    }

    const user = userRows[0];

    // 3. Verifikasi password lama
    if (!user.password) {
      return res.status(400).json({ success: false, message: 'User tidak memiliki password. Silakan hubungi admin.' });
    }
    const isOldPasswordValid = await bcrypt.compare(oldPassword, user.password);
    if (!isOldPasswordValid) {
      return res.status(400).json({ success: false, message: 'Password lama salah' });
    }

    // 4. Update password baru
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    await db.query(
      'UPDATE users SET password = ?, is_default_password = 0, updated_at = NOW() WHERE id = ?',
      [hashedNewPassword, req.user.id]
    );

    // 5. Send email notification (optional, non-blocking)
    if (user && user.email) {
      try {
        if (typeof global.sendEmail === 'function') {
          const htmlMessage = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Diubah - YPWI Lutim</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 20px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
    <div style="background: linear-gradient(135deg, #066e3a 0%, #0a8a4a 100%); padding: 30px; text-align: center;">
      <h1 style="margin: 0; color: white; font-size: 24px;">YPWI LUTIM</h1>
      <p style="margin: 5px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">Notifikasi Keamanan</p>
    </div>
    <div style="padding: 30px;">
      <h2 style="margin: 0 0 20px 0; color: #333; font-size: 20px;">🔐 Password Berhasil Diubah</h2>
      <p style="margin: 0 0 15px 0; color: #555; font-size: 16px; line-height: 1.6;">
        Assalamu'alaikum <strong>${user.nama || 'Guru'}</strong>,
      </p>
      <p style="margin: 0 0 20px 0; color: #555; font-size: 16px; line-height: 1.6;">
        Password akun YPWI Lutim Anda telah berhasil diubah.
      </p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Tanggal:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: 600;">${new Date().toLocaleDateString('id-ID')}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Waktu:</td><td style="padding: 8px 0; font-weight: 600;">${new Date().toLocaleTimeString('id-ID', { hour12: false }).slice(0, 5)} WIB</td></tr>
      </table>
      <p style="margin: 20px 0 0 0; color: #888; font-size: 14px;">Email ini dikirim otomatis oleh sistem.</p>
    </div>
  </div>
</body>
</html>`;
          await global.sendEmail(user.email, 'Password Berhasil Diubah - YPWI Lutim', htmlMessage);
        }
      } catch (emailErr) {
        console.warn('Email notification failed (password still changed):', emailErr.message);
      }
    }

res.json({ success: true, message: 'Password berhasil diubah!' });

  } catch (error) {
    console.error('Change password error:', error.message);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan sistem', error: error.message });
  }
});

// Render ID card template with actual data (requires REMOVE_BG_API_KEY)
app.post('/api/idcard/render', authenticateToken, async (req, res) => {
  try {
    const { template, data } = req.body;
    
    // For now, return template as-is - frontend will handle placeholder replacement
    res.json({ success: true, template });
  } catch (error) {
    console.error('ID card render error:', error.message);
    res.status(500).json({ success: false, message: 'Gagal render template' });
  }
});

// Remove Background API endpoint (requires REMOVE_BG_API_KEY in .env)
app.post('/api/remove-bg', authenticateToken, async (req, res) => {
  try {
    const { imageUrl } = req.body;
    
    if (!process.env.REMOVE_BG_API_KEY) {
      return res.status(500).json({ success: false, message: 'Remove.bg API key tidak dikonfigurasi' });
    }
    
    if (!imageUrl) {
      return res.status(400).json({ success: false, message: 'imageUrl diperlukan' });
    }
    
    const response = await axios.post('https://api.remove.bg/v1.0/removebg', 
      new URLSearchParams({ image_url: imageUrl }),
      {
        headers: { 'X-Api-Key': process.env.REMOVE_BG_API_KEY },
        responseType: 'arraybuffer'
      }
    );
    
    const base64 = Buffer.from(response.data).toString('base64');
    res.json({ success: true, image: `data:image/png;base64,${base64}` });
  } catch (error) {
    console.error('Remove BG error:', error.message);
    res.status(500).json({ success: false, message: 'Gagal menghapus background' });
  }
});

// ID Card Template Management
app.post('/api/idcard/templates', authenticateToken, async (req, res) => {
  try {
    const { template_name, template_data } = req.body;
    
    if (!template_name || !template_data) {
      return res.status(400).json({ success: false, message: 'Nama template dan data diperlukan' });
    }
    
    // Check if table exists, create if not
    await db.query(`
      CREATE TABLE IF NOT EXISTS idcard_templates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        template_name VARCHAR(100) UNIQUE,
        template_data LONGTEXT,
        created_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Insert or update template
    const existing = await db.query('SELECT id FROM idcard_templates WHERE template_name = ?', [template_name]);
    
    if (existing.length > 0) {
      await db.query(
        'UPDATE idcard_templates SET template_data = ? WHERE template_name = ?',
        [JSON.stringify(template_data), template_name]
      );
    } else {
      await db.query(
        'INSERT INTO idcard_templates (template_name, template_data, created_by) VALUES (?, ?, ?)',
        [template_name, JSON.stringify(template_data), req.user.id]
      );
    }
    
    res.json({ success: true, message: 'Template tersimpan' });
  } catch (error) {
    console.error('Save template error:', error.message);
    res.status(500).json({ success: false, message: 'Gagal menyimpan template' });
  }
});

app.get('/api/idcard/templates', authenticateToken, async (req, res) => {
  try {
    // Create table if not exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS idcard_templates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        template_name VARCHAR(100) UNIQUE,
        template_data LONGTEXT,
        created_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    const templates = await db.query('SELECT id, template_name, created_at FROM idcard_templates ORDER BY created_at DESC');
    res.json({ success: true, templates });
  } catch (error) {
    console.error('Get templates error:', error.message);
    res.status(500).json({ success: false, message: 'Gagal mengambil templates' });
  }
});

app.get('/api/idcard/templates/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const templates = await db.query('SELECT template_data FROM idcard_templates WHERE id = ?', [id]);
    
    if (templates.length > 0) {
      res.json({ success: true, template: JSON.parse(templates[0].template_data) });
    } else {
      res.json({ success: false, message: 'Template tidak ditemukan' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Generate QR code for ID card
app.get('/api/qrcode/:text', (req, res) => {
  const { text } = req.params;
  const size = req.query.size || 100;
  
  // Use Google Charts API for QR code (free, no API key needed)
  const qrUrl = `https://chart.googleapis.com/chart?chs=${size}x${size}&cht=qr&chl=${encodeURIComponent(text)}`;
  res.json({ success: true, qr_url: qrUrl });
});

// Get teacher list by tenant with completion status
app.get('/api/admin/tenant-teachers/:tenantId', authenticateOperator, async (req, res) => {
  try {
    const { tenantId } = req.params;

    // Verify tenant access
    if (!verifyTenantAccess(req, tenantId)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak: Anda tidak berwenang mengakses data guru sekolah ini' });
    }

    // Get teachers for this tenant with their completion status
    const teachers = await db.query(`
      SELECT
        t.id,
        t.nama,
        t.email,
        t.no_wa,
        t.jenis_kelamin,
        t.status_aktif,
        COALESCE(u.is_profile_complete, 0) as is_profile_complete,
        COALESCE(u.is_default_password, 1) as is_default_password,
        CASE
          WHEN u.is_profile_complete = 1 THEN 100
          WHEN u.id IS NOT NULL THEN 50  -- Has account but profile not complete
          ELSE 0  -- No account
        END as persentase_kelengkapan
      FROM teacher_assignments ta
      JOIN teachers t ON ta.teacher_id = t.id
      LEFT JOIN users u ON t.id = u.guru_id
      WHERE ta.tenant_id = ?
      ORDER BY persentase_kelengkapan ASC, t.nama ASC
    `, [tenantId]);

    res.json({
      success: true,
      data: teachers
    });
  } catch (error) {
    console.error('Tenant teachers error:', error);
    res.status(500).json({ success: false, message: 'Error fetching tenant teachers' });
  }
});

async function startServer() {
  console.log('Starting server...');
  try {
    await db.initializeDatabase();
    console.log('Database initialized, starting server');

    // Admin teacher completion progress
    app.get('/api/admin/teacher-completion-progress', authenticateOperator, async (req, res) => {
      try {
        console.log('Teacher completion progress endpoint called');

        // Simple query first to test database
        const simpleCount = await db.query('SELECT COUNT(*) as count FROM teachers WHERE status_aktif = 1');
        console.log('Total active teachers:', simpleCount[0].count);

        // Get basic teacher data first
        const basicTeachers = await db.query('SELECT id, nama FROM teachers WHERE status_aktif = 1 ORDER BY nama ASC LIMIT 5');
        console.log('Sample teachers:', basicTeachers);

        // Get all active teachers with their completion data
        const teachers = await db.query(`
        SELECT
          t.id,
          t.nama,
          t.nik,
          t.nip,
          t.email,
          t.tempat_lahir,
          t.tanggal_lahir,
          t.jenis_kelamin,
          t.alamat,
          t.no_wa,
          t.status_kepegawaian,
          t.tmt,
          COUNT(ta.teacher_id) as assignment_count,
          GROUP_CONCAT(DISTINCT ta.jabatan_di_unit) as jabatan_list,
          GROUP_CONCAT(DISTINCT tn.nama_sekolah) as sekolah_list
        FROM teachers t
        LEFT JOIN teacher_assignments ta ON t.id = ta.teacher_id
        LEFT JOIN tenants tn ON ta.tenant_id = tn.tenant_id
        WHERE t.status_aktif = 1
        GROUP BY t.id
        ORDER BY t.nama ASC
      `);

        console.log('Teacher completion progress query result:', teachers.length, 'teachers found');

        // Calculate completion percentage for each teacher
        const completionData = teachers.map(teacher => {
          // Define fields to check (excluding system fields and NIY if exists)
          const fieldsToCheck = [
            'nama', 'nik', 'nip', 'email', 'tempat_lahir', 'tanggal_lahir',
            'jenis_kelamin', 'alamat', 'no_wa', 'status_kepegawaian', 'tmt'
          ];

          let filledFields = 0;
          let totalFields = fieldsToCheck.length;

          // Check each field
          fieldsToCheck.forEach(field => {
            if (teacher[field] && teacher[field].toString().trim() !== '') {
              filledFields++;
            }
          });

          // Bonus for having assignments (minimum 1)
          const hasAssignments = teacher.assignment_count > 0;
          if (hasAssignments) {
            filledFields += 1; // Bonus point for assignments
            totalFields += 1;
          }

          // Calculate percentage
          const percentage = Math.round((filledFields / totalFields) * 100);

          return {
            id: teacher.id,
            nama: teacher.nama,
            nik: teacher.nik,
            nip: teacher.nip,
            email: teacher.email,
            filled_fields: filledFields,
            total_fields: totalFields,
            has_assignments: hasAssignments,
            assignment_count: teacher.assignment_count,
            jabatan_list: teacher.jabatan_list,
            sekolah_list: teacher.sekolah_list,
            completion_percentage: percentage,
            status: percentage >= 100 ? 'Lengkap' :
              percentage >= 80 ? 'Hampir Lengkap' :
                percentage >= 50 ? 'Sedang Dilengkapi' : 'Perlu Dilengkapi'
          };
        });

        console.log('Calculated completion data sample:', completionData.slice(0, 3));

        // Calculate overall statistics
        const stats = {
          total_teachers: completionData.length,
          complete_teachers: completionData.filter(t => t.completion_percentage >= 100).length,
          average_completion: completionData.length > 0 ? Math.round(completionData.reduce((sum, t) => sum + t.completion_percentage, 0) / completionData.length) : 0,
          completion_distribution: {
            lengkap: completionData.filter(t => t.completion_percentage >= 100).length,
            hampir_lengkap: completionData.filter(t => t.completion_percentage >= 80 && t.completion_percentage < 100).length,
            sedang_dilengkapi: completionData.filter(t => t.completion_percentage >= 50 && t.completion_percentage < 80).length,
            perlu_dilengkapi: completionData.filter(t => t.completion_percentage < 50).length
          }
        };

        console.log('Completion stats:', stats);

        res.json({
          success: true,
          data: completionData,
          stats: stats
        });
      } catch (error) {
        console.error('Teacher completion progress error:', error);
        res.status(500).json({ success: false, message: 'Error fetching teacher completion progress', error: error.message });
      }
    });

  } catch (dbError) {
    console.log('Database connection failed:', dbError.message);
    console.log('Continuing without database...');
  }


  /**
   * GET /api/version
   * Public endpoint to get current app version
   */
  app.get('/api/version', (req, res) => {
    res.json({
      success: true,
      version: '1.0.3',
      timestamp: new Date().toISOString(),
      features: [
        'Scanner offline-capable',
        'Auto masuk/pulang detection',
        'Force refresh for PWA',
        'iOS compatibility'
      ]
    });
  });

  /**
   * GET /api/test-buttons
   * Test endpoint to verify button functionality
   */
  app.get('/api/test-buttons', (req, res) => {
    res.json({
      success: true,
      message: 'Server is running and buttons should work',
      timestamp: new Date().toISOString(),
      buttons: {
        torch: 'Toggle flashlight',
        switch_camera: 'Switch front/back camera',
        sync: 'Sync offline data',
        manual_scan: 'Start manual scan',
        force_refresh: 'Force app refresh',
        test: 'Test button'
      }
    });
  });

  /**
   * POST /api/log-click
   * Log button clicks from scanner (for mobile debugging)
   */
  app.post('/api/log-click', (req, res) => {
    const { button, userAgent, timestamp } = req.body;
    console.log(`[BUTTON-CLICK] ${button} clicked at ${timestamp}`);
    console.log(`[BUTTON-CLICK] User-Agent: ${req.get('User-Agent')}`);
    console.log(`[BUTTON-CLICK] IP: ${req.ip}`);

    res.json({
      success: true,
      message: `Button ${button} click logged`,
      timestamp: new Date().toISOString()
    });
  });
  // ============================================
  // EVALUATION ENDPOINTS
  // ============================================

  // Get teachers for evaluation (by evaluator's tenant)
  app.get('/api/evaluations/teachers', authenticateToken, async (req, res) => {
    try {
      let tenantId = req.query.tenant_id;

      // Determine accessible tenants based on user role
      if (req.user.role === 'admin' && !tenantId) {
        return res.status(400).json({ success: false, message: 'tenant_id required for admin' });
      }

      // For guru with kepala_sekolah/pimpinan_pondok role, use their assigned tenant
      if (!tenantId) {
        const assignments = req.user.assignments || [];
        const relevantAssignments = assignments.filter(a =>
          ['kepala_sekolah', 'pimpinan_pondok'].includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''))
        );
        if (relevantAssignments.length > 0) {
          tenantId = relevantAssignments[0].tenant_id;
        }
      }

      if (!tenantId) {
        return res.status(400).json({ success: false, message: 'No accessible tenant found' });
      }

      // Verify access for non-admin
      if (req.user.role === 'guru') {
        const assignments = req.user.assignments || [];
        const hasAccess = assignments.some(a =>
          a.tenant_id === tenantId &&
          ['kepala_sekolah', 'pimpinan_pondok'].includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''))
        );
        if (!hasAccess) {
          return res.status(403).json({ success: false, message: 'Access denied to this tenant' });
        }
      }

      // Get teachers for this tenant
      const teachers = await db.query(`
          SELECT t.id, t.nama, t.scan_id, t.jenis_kelamin
          FROM teachers t
          JOIN teacher_assignments ta ON t.id = ta.teacher_id
          WHERE ta.tenant_id = ? AND t.status_aktif = 1
          ORDER BY t.nama ASC
        `, [tenantId]);

      res.json({ success: true, data: teachers });
    } catch (error) {
      console.error('Get teachers for evaluation error:', error);
      res.status(500).json({ success: false, message: 'Error fetching teachers' });
    }
  });

  // Get my evaluations (for kepala sekolah/pimpinan pondok to see their given evaluations)
  app.get('/api/evaluations/my-evaluations', authenticateToken, async (req, res) => {
    try {
      if (req.user.role !== 'guru' && req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      let query = `
          SELECT e.*, t.nama as teacher_name, tn.nama_sekolah
          FROM evaluations e
          JOIN teachers t ON e.teacher_id = t.id
          LEFT JOIN tenants tn ON e.tenant_id = tn.tenant_id
          WHERE 1=1
        `;
      let params = [];

      if (req.user.role === 'guru') {
        query += ' AND e.evaluator_id = ?';
        params.push(req.user.id);
      }

      query += ' ORDER BY e.evaluation_date DESC, e.created_at DESC LIMIT 100';

      const evaluations = await db.query(query, params);
      res.json({ success: true, data: evaluations });
    } catch (error) {
      console.error('Get my evaluations error:', error);
      res.status(500).json({ success: false, message: 'Error fetching evaluations' });
    }
  });

  // Get evaluations summary (average score per teacher)
  app.get('/api/evaluations/summary', authenticateToken, async (req, res) => {
    try {
      let tenantId = req.query.tenant_id;

      // Determine accessible tenant for non-admin
      if (req.user.role === 'guru' && !tenantId) {
        const assignments = req.user.assignments || [];
        const relevantAssignments = assignments.filter(a =>
          ['kepala_sekolah', 'pimpinan_pondok'].includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''))
        );
        if (relevantAssignments.length > 0) {
          tenantId = relevantAssignments[0].tenant_id;
        }
      }

      let query = `
          SELECT 
            t.id as teacher_id,
            t.nama as teacher_name,
            COALESCE(AVG(e.score), 0) as avg_score,
            COUNT(e.id) as evaluation_count
          FROM teachers t
          JOIN teacher_assignments ta ON t.id = ta.teacher_id
          LEFT JOIN evaluations e ON t.id = e.teacher_id
        `;
      let params = [];
      let whereAdded = false;

      if (tenantId) {
        query += ' WHERE ta.tenant_id = ?';
        params.push(tenantId);
        whereAdded = true;
      }

      query += ' GROUP BY t.id, t.nama ORDER BY avg_score DESC';

      const summary = await db.query(query, params);
      res.json({ success: true, data: summary });
    } catch (error) {
      console.error('Get evaluations summary error:', error);
      res.status(500).json({ success: false, message: 'Error fetching summary' });
    }
  });

  // Create evaluation
  app.post('/api/evaluations', authenticateToken, async (req, res) => {
    try {
      const { teacher_id, score, category, notes, evaluation_date } = req.body;

      if (!teacher_id || score === undefined) {
        return res.status(400).json({ success: false, message: 'teacher_id and score required' });
      }

      // Validate score (1-5)
      if (score < 1 || score > 5) {
        return res.status(400).json({ success: false, message: 'Score must be between 1 and 5' });
      }

      // Determine tenant from teacher's assignment
      const [assignment] = await db.query(
        'SELECT tenant_id FROM teacher_assignments WHERE teacher_id = ? LIMIT 1',
        [teacher_id]
      );

      if (!assignment) {
        return res.status(404).json({ success: false, message: 'Teacher not found or not assigned to any tenant' });
      }

      const tenant_id = assignment.tenant_id;

      // Verify evaluator access - only kepala_sekolah/pimpinan_pondok can evaluate
      if (req.user.role === 'guru') {
        const assignments = req.user.assignments || [];
        const hasAccess = assignments.some(a =>
          a.tenant_id === tenant_id &&
          ['kepala_sekolah', 'pimpinan_pondok'].includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''))
        );
        if (!hasAccess) {
          return res.status(403).json({ success: false, message: 'Only kepala sekolah or pimpinan pondok can evaluate teachers' });
        }
      } else if (req.user.role === 'admin') {
        // Admin can evaluate anyone - access granted
      } else {
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
      }

      const evaluator_id = req.user.id;

      const result = await db.query(
        `INSERT INTO evaluations (teacher_id, evaluator_id, tenant_id, score, category, notes, evaluation_date) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [teacher_id, evaluator_id, tenant_id, score, category || 'kehadiran', notes || '', evaluation_date || new Date().toISOString().split('T')[0]]
      );

      res.json({ success: true, message: 'Evaluation recorded', data: { id: result.insertId } });
    } catch (error) {
      console.error('Create evaluation error:', error);
      res.status(500).json({ success: false, message: 'Error creating evaluation' });
    }
  });

  // Get evaluations (for viewing)
  app.get('/api/evaluations', authenticateToken, async (req, res) => {
    try {
      let tenantId = req.query.tenant_id;
      const teacherId = req.query.teacher_id;

      // Determine accessible tenant for non-admin
      if (req.user.role === 'guru' && !tenantId) {
        const assignments = req.user.assignments || [];
        const relevantAssignments = assignments.filter(a =>
          ['kepala_sekolah', 'pimpinan_pondok'].includes((a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, ''))
        );
        if (relevantAssignments.length > 0) {
          tenantId = relevantAssignments[0].tenant_id;
        }
      }

      let query = `
          SELECT e.*, t.nama as teacher_name, u.username as evaluator_name
          FROM evaluations e
          JOIN teachers t ON e.teacher_id = t.id
          JOIN users u ON e.evaluator_id = u.id
          WHERE 1=1
        `;
      const params = [];

      if (tenantId) {
        query += ' AND e.tenant_id = ?';
        params.push(tenantId);
      }

      if (teacherId) {
        query += ' AND e.teacher_id = ?';
        params.push(teacherId);
      }

      query += ' ORDER BY e.evaluation_date DESC, e.created_at DESC LIMIT 100';

      const evaluations = await db.query(query, params);

      res.json({ success: true, data: evaluations });
    } catch (error) {
      console.error('Get evaluations error:', error);
      res.status(500).json({ success: false, message: 'Error fetching evaluations' });
    }
  });

  // ============================================
  // AUTOMATIC EVALUATION FROM ATTENDANCE
  // ============================================

  async function calculateAutoEvaluation(teacher_id, tenant_id, month = null) {
    if (!month) {
      const now = new Date();
      month = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    }

    try {
      const stats = await db.query(`
          SELECT 
            COUNT(*) as total_days,
            SUM(CASE WHEN status = 'hadir' THEN 1 ELSE 0 END) as present_days,
            SUM(CASE WHEN status = 'telat' THEN 1 ELSE 0 END) as late_days,
            SUM(CASE WHEN status = 'alpha' OR status IS NULL THEN 1 ELSE 0 END) as alpha_days
          FROM absensi 
          WHERE teacher_id = ? AND tenant_id = ? AND DATE_FORMAT(waktu_scan, '%Y-%m') = ?
          AND (status = 'hadir' OR status = 'telat' OR status = 'alpha')
        `, [teacher_id, tenant_id, month]);

      const stat = stats[0] || { total_days: 0, present_days: 0, late_days: 0, alpha_days: 0 };

      let score = 0;
      if (stat.total_days > 0) {
        const rate = (stat.present_days / stat.total_days) * 100;
        if (rate >= 95) score = 5.0;
        else if (rate >= 90) score = 4.5;
        else if (rate >= 85) score = 4.0;
        else if (rate >= 80) score = 3.5;
        else if (rate >= 75) score = 3.0;
        else if (rate >= 70) score = 2.5;
        else if (rate >= 65) score = 2.0;
        else score = 1.0;
      }

      return {
        score: parseFloat(score.toFixed(2)),
        total_days: stat.total_days,
        present_days: stat.present_days,
        late_days: stat.late_days,
        alpha_days: stat.alpha_days
      };
    } catch (error) {
      console.error('Auto evaluation error:', error);
      return { score: 0, total_days: 0, present_days: 0, late_days: 0, alpha_days: 0 };
    }
  }

  // Run auto evaluation for all teachers
  app.post('/api/evaluations/auto-calculate', authenticateToken, async (req, res) => {
    try {
      const userRole = req.user.role;
      const isAdmin = userRole === 'admin';

      // Get user's assigned tenant if not admin
      let tenantId = null;
      if (!isAdmin) {
        const assignments = await db.query(
          'SELECT tenant_id FROM teacher_assignments WHERE user_id = ? AND jabatan_di_unit IN (?, ?) LIMIT 1',
          [req.user.id, 'kepala_sekolah', 'pimpinan_pondok']
        );
        if (assignments.length === 0) {
          return res.status(403).json({ success: false, message: 'Akses ditolak' });
        }
        tenantId = assignments[0].tenant_id;
      }

      // Get teachers based on role
      let teachers;
      if (isAdmin) {
        teachers = await db.query('SELECT id, tenant_id FROM teachers WHERE status_aktif = 1');
      } else {
        teachers = await db.query('SELECT id, tenant_id FROM teachers WHERE status_aktif = 1 AND tenant_id = ?', [tenantId]);
      }

      const results = [];

      for (const teacher of teachers) {
        const evalData = await calculateAutoEvaluation(teacher.id, teacher.tenant_id);

        if (evalData.total_days > 0 && evalData.score > 0) {
          await db.query(`
              INSERT INTO evaluations (teacher_id, evaluator_id, tenant_id, score, category, notes, evaluation_date)
              VALUES (?, NULL, ?, ?, 'kehadiran', ?, CURDATE())
              ON DUPLICATE KEY UPDATE score = VALUES(score), notes = VALUES(notes)
            `, [teacher.id, teacher.tenant_id, evalData.score, `Otomatis: ${evalData.present_days}/${evalData.total_days} hari hadir`]);

          results.push({ teacher_id: teacher.id, score: evalData.score });
        }
      }

      res.json({ success: true, message: `Berhasil menilai ${results.length} guru`, data: results });
    } catch (error) {
      console.error('Auto calculate error:', error);
      res.status(500).json({ success: false, message: 'Error auto calculating evaluations' });
    }
  });

  // Get all evaluations (for Ketua Yayasan - admin can see all)
  app.get('/api/evaluations/all', authenticateToken, async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Hanya Ketua Yayasan yang bisa melihat semua nilai' });
      }

      const query = `
          SELECT e.*, t.nama as teacher_name, tn.nama_sekolah, u.username as evaluator_name
          FROM evaluations e
          JOIN teachers t ON e.teacher_id = t.id
          JOIN tenants tn ON e.tenant_id = tn.tenant_id
          LEFT JOIN users u ON e.evaluator_id = u.id
          ORDER BY e.tenant_id, e.evaluation_date DESC
        `;

      const evaluations = await db.query(query);
      res.json({ success: true, data: evaluations });
    } catch (error) {
      console.error('Get all evaluations error:', error);
      res.status(500).json({ success: false, message: 'Error fetching all evaluations' });
    }
  });

  // Get evaluation summary across all schools (for Ketua Yayasan dashboard)
  app.get('/api/evaluations/yayasan-summary', authenticateToken, async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Hanya Ketua Yayasan yang bisa melihat ringkasan yayasan' });
      }

      const summary = await db.query(`
          SELECT 
            e.tenant_id,
            tn.nama_sekolah,
            COUNT(DISTINCT e.teacher_id) as total_guru,
            AVG(e.score) as avg_score,
            MIN(e.score) as min_score,
            MAX(e.score) as max_score
          FROM evaluations e
          JOIN tenants tn ON e.tenant_id = tn.tenant_id
          WHERE e.evaluation_date >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
          GROUP BY e.tenant_id, tn.nama_sekolah
          ORDER BY avg_score DESC
        `);

      res.json({ success: true, data: summary });
    } catch (error) {
      console.error('Yayasan summary error:', error);
      res.status(500).json({ success: false, message: 'Error fetching yayasan summary' });
    }
  });

  // ============================================
  // END EVALUATION ENDPOINTS
  // ============================================

  // ============================================
  // WHATSAPP WEBHOOK (Meta Graph API)
  // ============================================
  const crypto = require('crypto');

  app.get('/api/whatsapp/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
        console.log('[WA] Webhook terverifikasi oleh Meta');
        res.status(200).send(challenge);
      } else {
        res.sendStatus(403);
      }
    } else {
      res.sendStatus(400);
    }
  });

// POST /api/whatsapp/webhook - Webhook untuk menerima pesan dari Meta WhatsApp API
   app.post('/api/whatsapp/webhook', async (req, res) => {
     const signature = req.headers['x-hub-signature-256'];
     if (signature && process.env.WHATSAPP_APP_SECRET) {
       const rawBody = JSON.stringify(req.body);
       const expected = 'sha256=' + crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex');
       if (signature !== expected) {
         console.warn('[WA] Webhook signature mismatch — meneruskan payload untuk testing');
       }
     } else if (signature && !process.env.WHATSAPP_APP_SECRET) {
       console.warn('[WA] Webhook signature mismatch — tambahkan WHATSAPP_APP_SECRET di .env untuk verifikasi penuh');
     }

     const payload = req.body;

     if (payload.object !== 'whatsapp_business_account') {
       return res.sendStatus(404);
     }

     payload.entry?.forEach(async (entry) => {
       entry.changes?.forEach(async (change) => {
         if (change.field === 'messages') {
           const value = change.value;
           const contacts = value.contacts || [];
           const contactMap = {};
           contacts.forEach(c => {
             contactMap[c.wa_id] = c.profile?.name || c.verified_name || null;
           });

           value.messages?.forEach(async (msg) => {
             const from = msg.from;
             const messageType = msg.type;
             const textBody = messageType === 'text' ? msg.text?.body : `[${messageType}]`;
             const profileName = contactMap[from] || msg.profile?.name || null;

             console.log(`[WA] Pesan Masuk | Dari: ${from} | Tipe: ${messageType} | Isi: ${textBody}`);

             // Simpan ke database
             try {
               // Cari parent berdasarkan nomor WA
               const parent = await db.query(
                 'SELECT id FROM parents WHERE REPLACE(REPLACE(no_wa, "+", ""), " ", "") LIKE CONCAT("%", REPLACE(REPLACE(?, "+", ""), " ", ""), "%") OR REPLACE(REPLACE(no_wa, "+", ""), " ", "") = ?',
                 [from, from]
               );

               const parentId = parent?.[0]?.id || null;

               await db.query(
                 `INSERT INTO whatsapp_messages 
                  (from_phone, message, message_type, wa_message_id, profile_name, parent_id) 
                  VALUES (?, ?, ?, ?, ?, ?)`,
                 [from, textBody || '', messageType, msg.id, profileName, parentId]
               );
             } catch (e) {
               console.error('[WA] Gagal menyimpan pesan masuk:', e.message);
             }

             if (messageType === 'text') {
               const normalized = String(textBody).trim().toUpperCase();

              if (normalized === 'STOP') {
                console.log(`[WA] Stop opt-out request: ${from}`);
              } else if (normalized === 'YA' || /^OTP[- ]/.test(normalized)) {
                console.log(`[WA] Balasan OTP dari ${from}: ${textBody}`);
              }
            }
          });
        }

        if (change.field === 'messaging_status') {
          const status = change.value;
          console.log('[WA] Status Update:', JSON.stringify(status));
        }
      });
    });

    res.status(200).send('EVENT_RECEIVED');
  });

  app.use((req, res, next) => {
    // Debugging mentah: lihat semua header yang benar-benar masuk ke server
    console.log("Daftar Header Lengkap:", req.headers);
    next();
  });

app.listen(PORT, '0.0.0.0', () => {
     console.log('🚀 Server YPWI Lutim berjalan di http://localhost:' + PORT);
     console.log('🌐 Juga dapat diakses di http://0.0.0.0:' + PORT + ' atau IP lokal Anda');
     console.log('🔐 Login endpoint: POST /api/auth/login');
     console.log('📊 Dashboard endpoint: GET /api/dashboard (protected)');
     console.log('📱 Scanner endpoints: POST /api/scanner/attendance, POST /api/scanner/register');
     console.log('🔍 QR Generator: GET /api/scanner/qr/generate?scan_id=XXX');
   });
   require('./scheduler');
 }

startServer().catch(err => {
  console.error('Server start failed:', err.message);
  process.exit(1);
});

app.use('/api', require('./src/routes/bsi-import'));
app.use('/api', require('./src/routes/spp-summary'));
