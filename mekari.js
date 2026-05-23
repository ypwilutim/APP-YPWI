/**
 * Mekari Qontak Omnichannel — WhatsApp API Module
 *
 * Supported APIs:
 *  1. Send Text Message         — free-form text via Conversation API
 *  2. Send Template Message     — pre-approved template
 *  3. Check Message Status      — delivery / read query
 *  4. Incoming Webhook          — verify + parse webhook from Qontak
 *
 * Usage — kamu hanya butuh token (access_token + optional refresh_token).
 * Tidak perlu app_id / app_secret.
 *
 *   const { setTokensFromResponse, sendWhatsAppText } = require('./mekari');
 *
 *   // Set token SEKALI SAJA di startup
 *   setTokensFromResponse({
 *     tokens: {
 *       token_type:    "bearer",
 *       access_token:  "ISI_ACCESS_TOKEN_ANDA",
 *       refresh_token: "ISI_REFRESH_TOKEN_ANDA"
 *     }
 *   });
 *
 *   // Kirim pesan
 *   await sendWhatsAppText('081234567890', 'Halo!');
 */

require('dotenv').config();
const axios = require('axios');

/* ─── Configuration ─────────────────────────────────────────── */

const CONFIG = {
  baseURL:     process.env.MEKARI_BASE_URL || 'https://api.qontak.com/omni',
  waNumberId:  process.env.MEKARI_WA_NUMBER_ID,
};

/* ─── Token State ───────────────────────────────────────────── */

let _cachedToken    = null;
let _refreshToken   = null;
let _tokenExpiresAt = null;   // epoch seconds

/* ─── Helpers ───────────────────────────────────────────────── */

function log(ctx, data) {
  console.log(`[MEKARI][${ctx}]`, typeof data === 'object' ? JSON.stringify(data) : data);
}

/** Extract access_token / refresh_token from either Mekari response format */
function _extractTokens(body) {
  if (body.tokens) {
    return {
      accessToken:  body.tokens.access_token,
      refreshToken: body.tokens.refresh_token,
      expiresIn:    body.tokens.expires_in || null,
    };
  }
  return {
    accessToken:  body.access_token,
    refreshToken: body.refresh_token || null,
    expiresIn:    body.expires_in || null,
  };
}

/** Normalise Indonesian phone → always returns 628xxxxxxxxxx  */
function normalisePhone(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/\D/g, '');
  if (cleaned.startsWith('62')) return cleaned;
  if (cleaned.startsWith('0'))  return '62' + cleaned.slice(1);
  return '62' + cleaned;
}

/* ─── Token Lifecycle ───────────────────────────────────────── */

/**
 * Return a valid access_token.
 * Priority: cache → refresh_token → throw.
 *
 * You must call setTokensFromResponse() once on startup.
 */
async function getAccessToken() {
  // Still valid?
  if (_cachedToken && _tokenExpiresAt && Date.now() / 1000 < _tokenExpiresAt - 60) {
    return _cachedToken;
  }

  // Try refresh_token if available
  if (_refreshToken) {
    try {
      return await _refreshToken_();
    } catch (err) {
      log('TOKEN', 'Refresh gagal, mencoba via app credentials …');
      _refreshToken = null;
    }
  }

  // Can still try app_id / app_secret if present
  if (CONFIG.appId && CONFIG.appSecret) {
    try {
      return await _fetchByAppCredentials_();
    } catch (err) {
      log('TOKEN', 'Fetch by app credentials gagal.');
    }
  }

  throw new Error(
    '[MEKARI] Token expired dan tidak ada refresh_token / app credentials untuk memperbarui. ' +
    'Panggil setTokensFromResponse() dengan token yang baru.'
  );
}

/** POST grant_type=refresh_token ke Qontak */
async function _refreshToken_() {
  const payload = {
    grant_type:    'refresh_token',
    refresh_token: _refreshToken,
  };

  const { data } = await axios.post(
    `${CONFIG.baseURL}/auth/access_token`,
    payload,
    { timeout: 15000 }
  );

  const { accessToken, refreshToken, expiresIn } = _extractTokens(data.data || data);

  _cachedToken    = accessToken;
  _refreshToken   = refreshToken || _refreshToken;
  _tokenExpiresAt = (expiresIn || 7200) + Date.now() / 1000;

  log('TOKEN', `Refreshed OK — expires in ~${expiresIn || 7200}s`);
  return _cachedToken;
}

/** POST app_id / app_secret ke Qontak OAuth */
async function _fetchByAppCredentials_() {
  const { data } = await axios.post(
    `${CONFIG.baseURL}/auth/access_token`,
    { app_id: CONFIG.appId, app_secret: CONFIG.appSecret },
    { timeout: 15000 }
  );

  const { accessToken, refreshToken, expiresIn } = _extractTokens(data.data || data);

  _cachedToken    = accessToken;
  _refreshToken   = refreshToken || _refreshToken;
  _tokenExpiresAt = (expiresIn || 7200) + Date.now() / 1000;

  log('TOKEN', `Fetched via app credentials — expires in ~${expiresIn || 7200}s`);
  return _cachedToken;
}

/* ─── Send Text Message ──────────────────────────────────────── */

/**
 * Kirim pesan teks WhatsApp one-to-one.
 *
 * @param {string} phone  Nomor HP Indonesia, contoh "0812xxx" atau "62812xxx"
 * @param {string} message Isi pesan
 * @returns {Promise<{success:boolean, messageId:string|null, status:string, raw:any}>}
 */
async function sendWhatsAppText(phone, message) {
  const cleanPhone = normalisePhone(phone);
  if (!cleanPhone) throw new Error('Nomor HP tidak valid / kosong.');
  if (!message)     throw new Error('Isi pesan tidak boleh kosong.');

  const token = await getAccessToken();

  log('SEND_TEXT', `→ ${cleanPhone} | "${String(message).slice(0, 60)}…"`);

  try {
    const payload = {
      to_number:  cleanPhone,
      message,
      ...(CONFIG.waNumberId ? { wa_number_id: CONFIG.waNumberId } : {}),
    };

    const { data } = await axios.post(
      `${CONFIG.baseURL}/wa_send_message`,
      payload,
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 20000,
      }
    );

    const msgId  = data.data?.message_id ?? data.message_id     ?? null;
    const status = data.data?.status     ?? data.status         ?? 'unknown';

    log('SEND_TEXT_OK', `msgId=${msgId} status=${status}`);
    return { success: true, messageId: msgId, status, raw: data };

  } catch (err) {
    const msg = err.response?.data ?? err.message;
    log('SEND_TEXT_ERR', msg);
    return { success: false, messageId: null, status: 'error', raw: err.response?.data || null, error: msg };
  }
}

/* ─── Send Template Message ──────────────────────────────────── */

/**
 * Kirim pesan template (pre-approved) via Campaign Blast API.
 *
 * @param {string} phone              Nomor HP Indonesia
 * @param {string} templateMessageId  ID template dari Qontak Dashboard → Broadcast
 * @param {Array}  customParams       Array of { field_name, value }
 * @returns {Promise<{success:boolean, messageId:string|null, raw:any}>}
 */
async function sendTemplateMessage(phone, templateMessageId, customParams = []) {
  const cleanPhone = normalisePhone(phone);
  if (!cleanPhone)     throw new Error('Nomor HP tidak valid / kosong.');
  if (!templateMessageId) throw new Error('templateMessageId wajib diisi.');

  const token = await getAccessToken();

  log('SEND_TPL', `→ ${cleanPhone} | template=${templateMessageId}`);

  try {
    const payload = {
      phone_number:        cleanPhone,
      template_message_id: templateMessageId,
      custom_variables:    customParams,
    };

    const { data } = await axios.post(
      `${CONFIG.baseURL}/campaign/send_blast`,
      payload,
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 20000,
      }
    );

    const msgId = data.data?.message_id ?? null;
    log('SEND_TPL_OK', `msgId=${msgId}`);
    return { success: true, messageId: msgId, raw: data };

  } catch (err) {
    const msg = err.response?.data ?? err.message;
    log('SEND_TPL_ERR', msg);
    return { success: false, messageId: null, raw: err.response?.data || null, error: msg };
  }
}

/* ─── Check Message Status ───────────────────────────────────── */

/**
 * Cek status pengiriman pesan (sent / delivered / read / failed).
 *
 * @param {string} messageId  message_id yang dikembalikan oleh fungsi kirim
 * @returns {Promise<{sent,delivered,read,failed,status,raw}>}
 */
async function getMessageStatus(messageId) {
  if (!messageId) throw new Error('messageId wajib diisi.');

  const token = await getAccessToken();
  log('STATUS', `messageId=${messageId}`);

  try {
    const { data } = await axios.get(
      `${CONFIG.baseURL}/message/${messageId}`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
    );

    const status = data.data?.status ?? data.status ?? 'unknown';
    log('STATUS_OK', status);
    return {
      sent:      status === 'sent',
      delivered: status === 'delivered',
      read:      status === 'read',
      failed:    status === 'failed',
      status,
      raw: data,
    };

  } catch (err) {
    const msg = err.response?.data ?? err.message;
    log('STATUS_ERR', msg);
    return { sent: false, delivered: false, read: false, failed: true, status: 'error', raw: null, error: msg };
  }
}

/* ─── Webhook Verification ───────────────────────────────────── */

/**
 * Verifikasi signature dari webhook Qontak.
 *
 * @param {express.Request} req
 * @param {string} rawBody  String JSON mentah dari req body
 * @returns {{verified:boolean, error?:string}}
 */
function verifyWebhook(req, rawBody = '') {
  const secret = process.env.MEKARI_WEBHOOK_SECRET;
  if (!secret) return { verified: false, error: 'MEKARI_WEBHOOK_SECRET tidak di-set di .env.' };

  const signature = req.headers['x-hub-signature'] || req.headers['x-qontak-signature'];
  if (!signature) return { verified: false, error: 'Tidak ada signature header.' };

  const crypto = require('crypto');
  const hmac   = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  return { verified: signature === `sha256=${hmac}` };
}

/* ─── Express Middleware ─────────────────────────────────────── */

function parseQontakWebhook(req, res, next) {
  const ct = req.headers['content-type'] || '';
  if (ct.includes('application/json')) {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try { req.body = JSON.parse(body); } catch (_) { req.body = {}; }
      req.rawBody = body;
      next();
    });
  } else {
    req.rawBody = JSON.stringify(req.body);
    next();
  }
}

/* ─── Token Management API ───────────────────────────────────── */

/**
 * Inject token dari response Mekari.
 * Panggil SEKALI SAJA saat startup aplikasi.
 *
 * @param {{tokens:{token_type,access_token,refresh_token}}} body
 */
function setTokensFromResponse(body) {
  const { accessToken, refreshToken, expiresIn } = _extractTokens(body);
  _cachedToken    = accessToken;
  _refreshToken   = refreshToken;
  _tokenExpiresAt = (expiresIn || 7200) + Date.now() / 1000;
  log('TOKEN', `Set manually — expires in ~${expiresIn || 7200}s`);
}

/** Hapus cache token (akan di-refresh / di-set ulang di panggilan berikutnya) */
function clearTokenCache() {
  _cachedToken    = null;
  _refreshToken   = null;
  _tokenExpiresAt = null;
  log('TOKEN', 'Cache cleared.');
}

/* ─── Exports ───────────────────────────────────────────────── */

module.exports = {
  CONFIG,
  getAccessToken,
  setTokensFromResponse,
  clearTokenCache,
  sendWhatsAppText,
  sendTemplateMessage,
  getMessageStatus,
  verifyWebhook,
  parseQontakWebhook,
  normalisePhone,
};
