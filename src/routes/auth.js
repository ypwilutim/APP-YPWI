// ============================================================
// AUTH ROUTES - Login, Profile, Forgot Password
// Extracted from server.js for modular architecture
// ============================================================

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const nodemailer = require('nodemailer');
const db = require('../../db');
const { authenticateToken, SECRET_KEY } = require('../middleware/auth');
const { logToFile } = require('../middlewares/logger');

const router = express.Router();

// Email function (standalone, not relying on global)
async function sendEmail(to, subject, htmlContent, textContent = '') {
  if (!process.env.EMAIL_ENABLED || process.env.EMAIL_ENABLED !== 'true') {
    console.log('📧 Email disabled, skipping email to:', to);
    return { success: true, message: 'Email disabled' };
  }

  if (!process.env.EMAIL_HOST) {
    return { success: false, message: 'Email host not configured' };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT) || 465,
      secure: parseInt(process.env.EMAIL_PORT) === 465,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const info = await transporter.sendMail({
      from: `"YPWI Lutim" <${process.env.EMAIL_USER}>`,
      to: to,
      subject: subject,
      html: htmlContent,
      text: textContent
    });

    console.log('✅ Email sent: %s', info.messageId);
    return { success: true, message: 'Email sent successfully', messageId: info.messageId };
  } catch (error) {
    console.error('❌ Email error:', error.message);
    return { success: false, message: `Email error: ${error.message}` };
  }
}

// Also expose to global for compatibility
global.sendEmail = sendEmail;

// ============================================================
// LOGIN
// ============================================================

router.post('/auth/login', async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: 'Username dan password wajib diisi.'
    });
  }

  try {
    const users = await db.query('SELECT * FROM users WHERE username = ?', [username]);

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Username atau password salah.'
      });
    }

    const user = users[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Username atau password salah.'
      });
    }

    const isProfileComplete = user.is_profile_complete === 1;
    const absensiMethod = user.tenant_id === 'SDIT' ? 'hp' : 'scanner';

    const tokenPayload = {
      id: user.id,
      username: user.username,
      role: user.role,
      guru_id: user.guru_id,
      tenant_id: user.tenant_id,
      absensi_method: absensiMethod,
      timestamp: new Date().toISOString()
    };

    // Cari assignments untuk semua user (needed for admin dashboard access check)
    if (user.guru_id) {
      try {
        tokenPayload.assignments = await db.query(
          'SELECT ta.tenant_id, ta.jabatan_di_unit, t.nama_sekolah FROM teacher_assignments ta JOIN tenants t ON ta.tenant_id = t.tenant_id WHERE ta.teacher_id = ?',
          [user.guru_id]
        );
        console.log('[LOGIN_DEBUG] User assignments loaded:', tokenPayload.assignments);
        logToFile(`AUTH_ASSIGNMENTS_LOADED: count=${tokenPayload.assignments?.length || 0}`);
      } catch (e) {
        tokenPayload.assignments = [];
        console.log('[LOGIN_DEBUG] Error loading assignments:', e.message);
        logToFile(`AUTH_ASSIGNMENTS_ERROR: ${e.message}`);
      }
    } else {
      tokenPayload.assignments = [];
    }

    const token = jwt.sign(tokenPayload, SECRET_KEY, { expiresIn: '8h' });

    // Debug: Log what we're sending to client
    console.log('[LOGIN_DEBUG] Login result:', { role: user.role });
    logToFile(`AUTH_LOGIN: user=${username}, role=${user.role}`);

    if (!isProfileComplete) {
      return res.json({
        success: true,
        redirect: 'complete-profile.html',
        teacherId: user.guru_id,
        role: user.role,
        tenant_id: user.tenant_id,
        message: 'Profil belum lengkap. Silakan lengkapi profil Anda.'
      });
    }

    // Simple role-based redirect: admin -> admin-dashboard, guru -> dashboard
    const redirectPage = user.role === 'admin' ? 'admin-dashboard.html' : 'dashboard.html';

    return res.json({
      success: true,
      redirect: redirectPage,
      token: token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        tenant_id: user.tenant_id,
        guru_id: user.guru_id,
        is_profile_complete: user.is_profile_complete,
        is_default_password: user.is_default_password,
        assignments: tokenPayload.assignments
      }
    });
  } catch (error) {
    console.error('[LOGIN ERROR]', error.message);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan sistem.'
    });
  }
});

// ============================================================
// PROFILE UPDATE
// ============================================================

router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const result = await db.query('UPDATE users SET is_profile_complete = 1 WHERE id = ?', [req.user.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    }
    res.json({
      success: true,
      message: 'Profil berhasil diperbarui!'
    });
  } catch (error) {
    console.error('[PROFILE UPDATE ERROR]', error.message);
    res.status(500).json({ success: false, message: 'Error updating profile' });
  }
});

// Public endpoint for profile completion (no auth required)
router.put('/profile-complete/:teacherId', async (req, res) => {
  const { teacherId } = req.params;

try {
    // Endpoint ini hanya update status, email sudah dikirim di /api/public/teachers
    await db.query('UPDATE users SET is_profile_complete = 1 WHERE guru_id = ?', [teacherId]);
    
    res.json({
      success: true,
      message: 'Status profil diperbarui'
    });
  } catch (error) {
    console.error('[PROFILE COMPLETE ERROR]', error.message);
    res.status(500).json({ success: false, message: 'Error updating profile status' });
  }
});

// ============================================================
// FORGOT PASSWORD - EMAIL OTP ONLY
// ============================================================

router.post('/forgot-password/send-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email wajib diisi' });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({ success: false, message: 'Format email tidak valid' });
    }

    const [teacher] = await db.query('SELECT id, nama FROM teachers WHERE email = ? AND status_aktif = 1', [email]);

    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Email tidak terdaftar' });
    }

    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

    global.tempOtps = global.tempOtps || {};
    global.tempOtps[email] = {
      code: verificationCode,
      expires: Date.now() + 5 * 60 * 1000,
      teacherId: teacher.id
    };

    const htmlMessage = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kode Verifikasi - YPWI Lutim</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 20px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #066e3a 0%, #0a8a4a 100%); padding: 30px; text-align: center;">
      <img src="https://app.ypwilutim.com/assets/images/icon.png" alt="YPWI Lutim" style="height: 60px; margin-bottom: 15px;">
      <h1 style="margin: 0; color: white; font-size: 28px; font-weight: bold;">YPWI LUTIM</h1>
      <p style="margin: 5px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">Sistem Informasi Kehadiran Guru</p>
    </div>
    
    <!-- Content -->
    <div style="padding: 40px 30px;">
      <h2 style="margin: 0 0 20px 0; color: #333; font-size: 24px;">🔐 KODE VERIFIKASI</h2>
      <p style="margin: 0 0 15px 0; color: #555; font-size: 16px; line-height: 1.6;">
        Assalamu'alaikum <strong>${teacher.nama}</strong>,
      </p>
      <p style="margin: 0 0 20px 0; color: #555; font-size: 16px; line-height: 1.6;">
        Anda mengirimkan permintaan reset password untuk akun YPWI Lutim.
      </p>
      
      <!-- OTP Code Box -->
      <div style="background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%); border: 2px dashed #066e3a; border-radius: 10px; padding: 25px; text-align: center; margin: 25px 0;">
        <p style="margin: 0 0 10px 0; color: #666; font-size: 14px;">Kode Verifikasi Anda:</p>
        <div style="font-size: 36px; font-weight: bold; color: #066e3a; letter-spacing: 8px; font-family: 'Courier New', monospace;">
          ${verificationCode}
        </div>
      </div>
      
      <p style="margin: 0 0 15px 0; color: #555; font-size: 15px; line-height: 1.6;">
        <strong>Kode ini berlaku selama 5 menit</strong> sejak email ini dikirim.
      </p>
      <p style="margin: 0 0 20px 0; color: #888; font-size: 14px; line-height: 1.6;">
        Jika Anda tidak meminta reset password, abaikan email ini. Keamanan akun Anda tetap terjamin.
      </p>
      
      <!-- Button -->
      <div style="text-align: center; margin: 30px 0;">
        <a href="https://ypwilutim.com/login.html" style="display: inline-block; background: #066e3a; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 15px;">
          Kembali ke Login
        </a>
      </div>
    </div>
    
    <!-- Footer -->
    <div style="background: #f8f9fa; padding: 20px 30px; text-align: center; border-top: 1px solid #eee;">
      <p style="margin: 0; color: #888; font-size: 13px;">
        © 2025 YPWI Lutim. Semua hak dilindungi.
      </p>
      <p style="margin: 8px 0 0 0; color: #aaa; font-size: 12px;">
        Email ini dikirim otomatis oleh sistem. Tidak perlu dijawab.
      </p>
    </div>
  </div>
</body>
</html>`;

    const textMessage = `🔐 KODE VERIFIKASI - LUPA PASSWORD

Assalamu'alaikum ${teacher.nama}

Kode verifikasi untuk reset password Anda: ${verificationCode}

Kode ini berlaku selama 5 menit.

Jika Anda tidak meminta reset password, abaikan email ini.

*YPWI Lutim*`;

    const emailResult = await sendEmail(email, '🔐 Kode Verifikasi Reset Password - YPWI Lutim', htmlMessage, textMessage);

    if (emailResult && emailResult.success) {
      res.json({
        success: true,
        message: 'Kode verifikasi telah dikirim ke email Anda',
        verificationCode: verificationCode
      });
    } else {
      const errMsg = emailResult?.message || 'Tidak dapat mengirim email';
      res.status(500).json({ success: false, message: 'Gagal mengirim email: ' + errMsg });
    }

  } catch (error) {
    console.error('[SEND EMAIL OTP ERROR]', error.message);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan sistem' });
  }
});

// Reset password via Email OTP (accepts email as identifier)
router.post('/forgot-password/reset', async (req, res) => {
  try {
    const { email, otpCode, newPassword } = req.body;

    if (!email || !otpCode || !newPassword) {
      return res.status(400).json({ success: false, message: 'Semua field wajib diisi' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Password baru minimal 8 karakter' });
    }

    const tempOtp = global.tempOtps?.[email];
    if (!tempOtp || tempOtp.code !== otpCode || Date.now() > tempOtp.expires) {
      return res.status(400).json({ success: false, message: 'Kode verifikasi tidak valid atau sudah kadaluarsa' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const updateResult = await db.query(
      'UPDATE users SET password = ?, is_default_password = 0, updated_at = NOW() WHERE guru_id = ?',
      [hashedPassword, tempOtp.teacherId]
    );

    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    }

    delete global.tempOtps[email];

    res.json({
      success: true,
      message: 'Password berhasil direset'
    });

  } catch (error) {
    console.error('[RESET PASSWORD ERROR]', error.message);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan sistem' });
  }
});

module.exports = router;