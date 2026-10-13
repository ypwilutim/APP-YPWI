const axios = require('axios');
const db = require('../../db'); // Add database connection

const WHATSAPP_BASE_URL = process.env.WHATSAPP_BASE_URL;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_WABA_ID = process.env.WHATSAPP_WABA_ID;
const WHATSAPP_GRAPH_API_TOKEN = process.env.WHATSAPP_GRAPH_API_TOKEN;

// Rate limiting configuration
const RATE_LIMIT_DELAY_MS = parseInt(process.env.WHATSAPP_RATE_LIMIT_DELAY_MS) || 1500; // 1.5 seconds between messages
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// TEMPLATE DINAMIS (Meta WhatsApp Business API)
// Struktur template diambil langsung dari Meta agar urutan variabel,
// header, dan tombol URL selalu sesuai template yang terdaftar.
// ============================================================

// Cache struktur template agar tidak memanggil Graph API setiap pengiriman
const templateStructureCache = new Map();
const TEMPLATE_CACHE_TTL_MS = parseInt(process.env.WHATSAPP_TEMPLATE_CACHE_TTL_MS) || 5 * 60 * 1000;

async function fetchTemplateByName(templateName, forceRefresh = false) {
  const cached = templateStructureCache.get(templateName);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  const { data: templates } = await fetchMetaTemplates();
  const found =
    templates.find(t => t.name === templateName && String(t.status || '').toUpperCase() === 'APPROVED') ||
    templates.find(t => t.name === templateName) ||
    null;
  templateStructureCache.set(templateName, { data: found, expiresAt: Date.now() + TEMPLATE_CACHE_TTL_MS });
  return found;
}

function countTemplatePlaceholders(text) {
  if (!text) return 0;
  const matches = String(text).match(/\{\{\s*[A-Za-z0-9_]+\s*\}\}/g);
  return matches ? matches.length : 0;
}

// Urutan parameter body per template.
// Meta sudah mengurutkan variabel bernama pada template (lihat `body_text_named_params`),
// daftar ini hanya fallback bila contoh parameter tidak tersedia.
const TEMPLATE_BODY_PARAM_ORDER = {
  pundi_ceria: ['nama_siswa', 'nama_sekolah_atau_yayasan', 'nama_siswa_copy', 'link_konfirmasi']
};

// Urutan parameter header bertipe teks (fallback bila Meta tidak memberi contoh).
// Sengaja kosong: hanya template yang strukturnya tidak bisa dibangun oleh
// logika lama perlu didaftarkan di sini.
const TEMPLATE_HEADER_PARAM_ORDER = {};

// Tombol URL dinamis milik template: nilai diambil dari param bernama lalu disesuaikan.
// mode 'path' -> hanya pathname + query string, karena URL tombol di template sudah
//                memiliki domain (contoh: https://app.ypwilutim.com/{{1}})
// mode 'raw'  -> dipakai apa adanya
const TEMPLATE_BUTTON_PARAM_SPECS = {
  pundi_ceria: [
    { index: '0', sub_type: 'url', source: 'link_konfirmasi', mode: 'path' }
  ]
};

// Media id header image yang sudah diupload agar tidak upload berulang kali
const headerMediaIdCache = {};

async function uploadWhatsAppMedia(sourceUrl, filename = 'header.jpg', contentType = 'image/jpeg') {
  if (!WHATSAPP_BASE_URL || !WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_GRAPH_API_TOKEN) {
    throw new Error('Konfigurasi WhatsApp belum lengkap untuk upload media (WHATSAPP_BASE_URL, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_GRAPH_API_TOKEN)');
  }

  const FormData = require('form-data');
  const downloaded = await axios.get(sourceUrl, { responseType: 'arraybuffer', timeout: 30000 });
  const buffer = Buffer.from(downloaded.data);

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', buffer, { filename, contentType });
  form.append('type', contentType);

  const response = await axios.post(
    `${WHATSAPP_BASE_URL}/${WHATSAPP_PHONE_NUMBER_ID}/media`,
    form,
    {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${WHATSAPP_GRAPH_API_TOKEN}` },
      timeout: 60000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    }
  );

  return response.data && response.data.id ? response.data.id : null;
}

async function resolveHeaderImageParam(templateName, headerComponent) {
  // 1. Override lewat environment (paling cepat, tidak upload ulang)
  const envOverride =
    process.env.WHATSAPP_HEADER_MEDIA_ID ||
    process.env.WHATSAPP_PUNDI_CERIA_HEADER_MEDIA_ID;
  if (envOverride) {
    return { type: 'image', image: { id: envOverride } };
  }

  // 2. Pakai hasil upload sebelumnya
  if (headerMediaIdCache[templateName]) {
    return { type: 'image', image: { id: headerMediaIdCache[templateName] } };
  }

  // 3. Upload gambar contoh milik template (header_handle dari Meta)
  const handle = headerComponent && headerComponent.example && headerComponent.example.header_handle
    ? headerComponent.example.header_handle[0]
    : null;
  if (!handle) {
    throw new Error(`Template "${templateName}" membutuhkan header image, tetapi Meta tidak menyediakan contoh gambar. Upload gambar di Meta Business Suite lalu set WHATSAPP_HEADER_MEDIA_ID di .env.`);
  }

  const mediaId = await uploadWhatsAppMedia(handle);
  if (!mediaId) {
    throw new Error('Gagal mengupload header image ke Meta (media id kosong)');
  }
  headerMediaIdCache[templateName] = mediaId;
  return { type: 'image', image: { id: mediaId } };
}

// Meta membatasi panjang parameter_name maksimal 20 karakter, sementara
// nama variabel pada template bisa lebih panjang (mis. nama_sekolah_atau_yayasan).
// Kombinasi ini membuat template tidak bisa dikirim lewat Cloud API, jadi
// masalahnya harus diperbaiki di Meta Business Manager (rename variabel).
const META_PARAM_NAME_MAX_LENGTH = 20;

// Mengembalikan pesan error bila ada nama variabel yang terlalu panjang, atau null jika aman.
function checkParamNamesLimit(templateName, names) {
  const tooLong = names.filter(n => String(n).length > META_PARAM_NAME_MAX_LENGTH);
  if (tooLong.length === 0) return null;

  return (
    `Template "${templateName}" tidak dapat dikirim: nama variabel ` +
    tooLong.map(n => `"${n}" (${n.length} karakter)`).join(', ') +
    ` melebihi batas ${META_PARAM_NAME_MAX_LENGTH} karakter dari WhatsApp Cloud API. ` +
    `Perbaiki di Meta Business Manager: edit template "${templateName}" dan ganti nama variabel tersebut ` +
    `menjadi maksimal ${META_PARAM_NAME_MAX_LENGTH} karakter (misalnya "nama_yayasan"), lalu submit ulang sampai APPROVED.`
  );
}

function validateParamNames(templateName, names) {
  const message = checkParamNamesLimit(templateName, names);
  if (message) throw new Error(message);
}

async function buildDynamicTemplateComponents(templateName, params) {
  const template = await fetchTemplateByName(templateName);
  if (!template) {
    throw new Error(`Template "${templateName}" tidak ditemukan atau belum APPROVED di Meta WhatsApp`);
  }

  const components = template.components || [];
  const header = components.find(c => String(c.type || '').toUpperCase() === 'HEADER');
  const body = components.find(c => String(c.type || '').toUpperCase() === 'BODY');
  const buttonsComp = components.find(c => String(c.type || '').toUpperCase() === 'BUTTONS');

  const payloadComponents = [];

  // --- HEADER ---
  if (header) {
    const format = String(header.format || '').toUpperCase();
    if (format === 'IMAGE') {
      payloadComponents.push({
        type: 'header',
        parameters: [await resolveHeaderImageParam(templateName, header)]
      });
    } else if (format === 'TEXT') {
      const named = header.example && header.example.header_text_named_params;
      const placeholderCount = countTemplatePlaceholders(header.text);
      const order = Array.isArray(named) && named.length > 0
        ? named.map(p => p.param_name)
        : (TEMPLATE_HEADER_PARAM_ORDER[templateName] || []);
      if (placeholderCount > 0) {
        if (order.length < placeholderCount) {
          throw new Error(`Header template "${templateName}" butuh ${placeholderCount} parameter, tetapi urutan parameternya belum terdaftar`);
        }
        validateParamNames(templateName, order);
        payloadComponents.push({
          type: 'header',
          parameters: order.slice(0, placeholderCount).map(key => ({
            type: 'text',
            parameter_name: key,
            text: String(params[key] != null && params[key] !== '' ? params[key] : '-')
          }))
        });
      }
    } else if (format === 'DOCUMENT' || format === 'VIDEO') {
      throw new Error(`Header ${format} untuk template "${templateName}" belum didukung`);
    }
  }

  // --- BODY ---
  const namedBody = body && body.example && body.example.body_text_named_params;
  let bodyOrder;
  if (Array.isArray(namedBody) && namedBody.length > 0) {
    bodyOrder = namedBody.map(p => p.param_name);
  } else {
    const placeholderCount = countTemplatePlaceholders(body && body.text);
    bodyOrder = (TEMPLATE_BODY_PARAM_ORDER[templateName] || []).slice(0, placeholderCount);
  }

  if (bodyOrder.length > 0) {
    validateParamNames(templateName, bodyOrder);
    payloadComponents.push({
      type: 'body',
      parameters: bodyOrder.map(key => ({
        type: 'text',
        parameter_name: key,
        text: String(params[key] != null && params[key] !== '' ? params[key] : '-')
      }))
    });
  }

  // --- BUTTONS (URL dinamis) ---
  const buttonSpecs = TEMPLATE_BUTTON_PARAM_SPECS[templateName] || [];
  for (const spec of buttonSpecs) {
    const buttons = (buttonsComp && buttonsComp.buttons) || [];
    const button = buttons[parseInt(spec.index, 10)];
    if (!button) continue;

    let value = params[spec.source];
    if (value === undefined || value === null || value === '') {
      throw new Error(`Parameter tombol "${spec.source}" untuk template "${templateName}" belum diisi`);
    }

    if (spec.mode === 'path') {
      try {
        const parsed = new URL(value);
        value = parsed.pathname + parsed.search;
      } catch (e) {
        // Bukan URL absolut, pakai apa adanya
      }
    }

    payloadComponents.push({
      type: 'button',
      sub_type: spec.sub_type || 'url',
      index: String(spec.index),
      parameters: [{
        type: 'text',
        // Nama variabel hanya dikirim bila tombol pada template memakai
        // placeholder bernama (bukan {{1}} yang posisional).
        ...(spec.param_name ? { parameter_name: spec.param_name } : {}),
        text: String(value)
      }]
    });
  }

  return payloadComponents;
}

// Daftar template yang komponennya dibangun dinamis dari struktur Meta
function usesDynamicTemplateComponents(templateName) {
  return Object.prototype.hasOwnProperty.call(TEMPLATE_BODY_PARAM_ORDER, templateName) ||
    Object.prototype.hasOwnProperty.call(TEMPLATE_BUTTON_PARAM_SPECS, templateName) ||
    Object.prototype.hasOwnProperty.call(TEMPLATE_HEADER_PARAM_ORDER, templateName);
}

// Queue for sequential sending with rate limiting
let sendQueue = Promise.resolve();
let lastSendTime = 0;

async function rateLimitedSend(sendFn) {
  // Wait for previous sends to complete
  sendQueue = sendQueue.then(async () => {
    // Enforce minimum delay between sends
    const now = Date.now();
    const timeSinceLastSend = now - lastSendTime;
    if (timeSinceLastSend < RATE_LIMIT_DELAY_MS) {
      await sleep(RATE_LIMIT_DELAY_MS - timeSinceLastSend);
    }
    
    lastSendTime = Date.now();
    return sendFn();
  });
  
  return sendQueue;
}

function cleanVaNumber(va) {
  if (!va) return '';
  let s = String(va).trim();
  s = s.replace(/^(Bsi|BNI|BRI|Mandiri|BTN|BSI|BTPN|BCA|Mandiri Bil| Mandiri)\s*[:\-]?\s*/i, '');
  s = s.replace(/[^0-9]/g, '');
  return s;
}

function formatPhoneNumber(phoneNumber) {
  if (!phoneNumber) return null;
  let cleaned = phoneNumber.toString().trim();
  cleaned = cleaned.replace(/[\s\-\(\)]/g, '');
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  }
  if (!cleaned.startsWith('62') && cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.substring(1);
  }
  if (!cleaned.startsWith('62') && !cleaned.startsWith('1')) {
    cleaned = '62' + cleaned;
  }
  if (!/^\d{10,15}$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

// Save outgoing message to database for CS dashboard
async function saveOutgoingMessage(phoneNumber, messageContent, messageType = 'text', waMessageId = null, templateName = null) {
  try {
    // Ensure table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        from_phone VARCHAR(20) NOT NULL,
        message TEXT,
        message_type ENUM('text', 'image', 'audio', 'video', 'document', 'location', 'contacts', 'interactive', 'unknown', 'template') DEFAULT 'text',
        wa_message_id VARCHAR(100),
        profile_name VARCHAR(100),
        status ENUM('sent', 'delivered', 'read', 'received', 'failed') DEFAULT 'sent',
        direction ENUM('outgoing', 'incoming') DEFAULT 'outgoing',
        parent_id INT DEFAULT NULL,
        reply_to_message_id INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_phone (from_phone),
        INDEX idx_created_at (created_at),
        INDEX idx_status (status),
        INDEX idx_direction (direction)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Insert outgoing message
    await db.query(
      `INSERT INTO whatsapp_messages (from_phone, message, message_type, wa_message_id, status, direction) VALUES (?, ?, ?, ?, 'sent', 'outgoing')`,
      [phoneNumber || '', messageContent || '', messageType || 'text', waMessageId || null]
    );

    console.log(`[WA DB] Saved outgoing message to ${phoneNumber}`);
  } catch (e) {
    console.error('[WA DB] Failed to save outgoing message:', e.message);
    // Don't throw - message was sent, just logging failed
  }
}

async function fetchMetaTemplates() {
  if (!WHATSAPP_BASE_URL || !WHATSAPP_WABA_ID || !WHATSAPP_GRAPH_API_TOKEN) {
    throw new Error('Konfigurasi WhatsApp belum lengkap. Pastikan WHATSAPP_BASE_URL, WHATSAPP_WABA_ID, dan WHATSAPP_GRAPH_API_TOKEN sudah diisi di .env');
  }

  // v25.0: template diakses via WABA ID, bukan phone number ID
  const url = `${WHATSAPP_BASE_URL}/${WHATSAPP_WABA_ID}/message_templates?fields=name,status,language,category,components`;

  const axiosConfig = {
    headers: {
      'Authorization': `Bearer ${WHATSAPP_GRAPH_API_TOKEN}`
    },
    timeout: 15000
  };

  if (process.env.WHATSAPP_HTTP_PROXY) {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    axiosConfig.httpsAgent = new HttpsProxyAgent(process.env.WHATSAPP_HTTP_PROXY);
  }

  try {
    const response = await axios.get(url, axiosConfig);

    const templates = (response.data && response.data.data) || [];
    const formatted = templates.map(t => ({
      name: t.name,
      language: t.language ? t.language.toLowerCase() : 'id',
      status: t.status,
      components: t.components || [],
      category: t.category || ''
    }));

    return { success: true, data: formatted };
  } catch (error) {
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      throw new Error('Gagal menghubungi Meta Graph API (timeout). Periksa koneksi internet server ke graph.facebook.com atau atur WHATSAPP_HTTP_PROXY jika server di balik proxy.');
    }
    const metaError = error.response?.data?.error?.message;
    if (metaError) {
      throw new Error(`Meta API error: ${metaError}`);
    }
    throw new Error(`Gagal mengambil template dari Meta: ${error.message}`);
  }
}

async function sendBillTemplate(phoneNumber, params, templateName = 'tagihan_spp') {
  if (!WHATSAPP_BASE_URL || !WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_GRAPH_API_TOKEN) {
    throw new Error('Konfigurasi WhatsApp belum lengkap. Pastikan WHATSAPP_BASE_URL, WHATSAPP_PHONE_NUMBER_ID, dan WHATSAPP_GRAPH_API_TOKEN sudah diisi di .env');
  }

  const formattedPhone = formatPhoneNumber(phoneNumber);
  if (!formattedPhone) {
    throw new Error(`Nomor telepon tidak valid: ${phoneNumber}`);
  }

  const url = `${WHATSAPP_BASE_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  // Template yang strukturnya diambil langsung dari Meta (header image/video,
  // urutan variabel body, dan tombol URL dinamis mengikuti template terdaftar).
  if (usesDynamicTemplateComponents(templateName)) {
    let dynamicComponents;
    try {
      dynamicComponents = await buildDynamicTemplateComponents(templateName, params);
    } catch (error) {
      throw new Error(error.message);
    }

    const dynamicPayload = {
      messaging_product: 'whatsapp',
      to: formattedPhone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'id' },
        components: dynamicComponents
      }
    };

    try {
      console.log('[WA TEMPLATE] Sending:', JSON.stringify(dynamicPayload, null, 2));
      const response = await axios.post(url, dynamicPayload, {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_GRAPH_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });
      console.log('[WA TEMPLATE] Response:', JSON.stringify(response.data, null, 2));

      const messageId = response.data && response.data.messages ? response.data.messages[0].id : null;

      const dynamicPreview = params.nama_siswa
        ? `[${templateName}] ${params.nama_siswa}`
        : `[Template: ${templateName}]`;
      await saveOutgoingMessage(formattedPhone, dynamicPreview, 'template', messageId || null, templateName);

      return { success: true, messageId: messageId || null, data: response.data };
    } catch (error) {
      const errorData = error.response && error.response.data ? error.response.data : null;
      const errorMessage = errorData && errorData.error && errorData.error.message ? errorData.error.message : error.message;
      const errorCode = errorData && errorData.error && errorData.error.code ? errorData.error.code : null;
      console.error('[WA TEMPLATE] Error response:', JSON.stringify(errorData, null, 2));

      // Batas panjang parameter_name di Meta (20 karakter). Template yang memakai
      // nama variabel lebih panjang harus diperbaiki di Meta Business Manager.
      if (/parameter_name must be at most/i.test(errorMessage)) {
        const template2 = await fetchTemplateByName(templateName).catch(() => null);
        const body2 = template2 && template2.components
          ? template2.components.find(c => String(c.type || '').toUpperCase() === 'BODY')
          : null;
        const names2 = (body2 && body2.example && Array.isArray(body2.example.body_text_named_params))
          ? body2.example.body_text_named_params.map(p => p.param_name)
          : (TEMPLATE_BODY_PARAM_ORDER[templateName] || []);
        const limitMessage = checkParamNamesLimit(templateName, names2);
        if (limitMessage) throw new Error(limitMessage);
      }

      throw new Error(`Gagal mengirim template: ${errorMessage} (code: ${errorCode || 'unknown'})`);
    }
  }

  const isInvoiceSpp = templateName === 'invoice_spp';
  const isTagihanBsi = templateName === 'tagihan_spp_bsi';
   let urlParam = '';
   if (isInvoiceSpp && params.invoice_url) {
     try { urlParam = new URL(params.invoice_url).pathname + new URL(params.invoice_url).search; } catch (e) { urlParam = params.invoice_url; }
   }

  let bodyParams = [];
  let headerParams = [];

  if (isTagihanBsi) {
    headerParams = [
      { type: 'text', text: params.nama_sekolah || '-' }
    ];
    bodyParams = [
      { type: 'text', text: params.nama_siswa || '-' },
      { type: 'text', text: params.bulan || '-' },
      { type: 'text', text: params.kelas || '-' },
      { type: 'text', text: params.jumlah_tagihan || '0' },
      { type: 'text', text: params.nomor_rekening || '-' },
      { type: 'text', text: params.nama_penerima || '-' },
      { type: 'text', text: params.nama_siswa_2 || params.nama_siswa || '-' },
      { type: 'text', text: params.info_sekolah || '-' }
    ];
  } else if (isInvoiceSpp) {
    bodyParams = [
      { type: 'text', text: params.nama_siswa || '-' },
      { type: 'text', text: params.bulan || '-' },
      { type: 'text', text: params.jumlah_tagihan || '0' },
      { type: 'text', text: params.tanggal_jatuh_tempo || '-' }
    ];
  } else {
    bodyParams = [
      { type: 'text', text: params.nama_siswa || '-' },
      { type: 'text', text: params.bulan || '-' },
      { type: 'text', text: params.jumlah_tagihan || '0' },
      { type: 'text', text: params.tanggal_jatuh_tempo || '-' },
      { type: 'text', text: params.invoice_url || params.nomor_rekening || '-' },
      { type: 'text', text: params.nama_pembayaran || params.nama_penerima || '-' }
    ];
  }

  const components = [];

  if (isTagihanBsi && headerParams.length > 0) {
    components.push({
      type: 'header',
      parameters: headerParams
    });
  }

  components.push({
    type: 'body',
    parameters: bodyParams
  });

   if (isInvoiceSpp && urlParam) {
     components.push({
       type: 'button',
       sub_type: 'url',
       index: '0',
       parameters: [{
         type: 'text',
         text: urlParam
       }]
     });
   }

    if (!isTagihanBsi && !isInvoiceSpp && (params.invoice_url || params.nomor_rekening)) {
       const vaParam = cleanVaNumber(params.va_raw || params.nomor_rekening);
       components.push({
         type: 'button',
         sub_type: 'url',
         index: '0',
         parameters: [{
           type: 'text',
           text: vaParam
         }]
       });
    }

    if (isTagihanBsi && params.nomor_rekening) {
       const vaParam = cleanVaNumber(params.va_raw || params.nomor_rekening);
       components.push({
         type: 'button',
         sub_type: 'url',
         index: '1',
         parameters: [{
           type: 'text',
           text: vaParam
         }]
       });
    }

    if (isTagihanBsi && params.va_raw) {
      components.push({
        type: 'button',
        sub_type: 'copy_code',
        index: '0',
        parameters: [{
          type: 'coupon_code',
          coupon_code: params.va_raw
        }]
      });
    } else if (isTagihanBsi) {
      throw new Error('Siswa belum memiliki VA BSI. Harap generate VA terlebih dahulu sebelum mengirim pengingat.');
    }

  const payload = {
    messaging_product: 'whatsapp',
    to: formattedPhone,
    type: 'template',
    template: {
      name: templateName,
      language: {
        code: 'id'
      },
      components
    }
  };

  try {
    console.log('[WA TEMPLATE] Sending:', JSON.stringify(payload, null, 2));
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${WHATSAPP_GRAPH_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });
    console.log('[WA TEMPLATE] Response:', JSON.stringify(response.data, null, 2));

    const messageId = response.data?.messages?.[0]?.id;

    // Save to database for CS dashboard
    const messagePreview = params.nama_siswa ? `[${templateName}] ${params.nama_siswa} - ${params.bulan || ''}` : `[Template: ${templateName}]`;
    await saveOutgoingMessage(formattedPhone, messagePreview, 'template', messageId || null, templateName);

    return {
      success: true,
      messageId: messageId || null,
      data: response.data
    };
  } catch (error) {
    const errorData = error.response?.data;
    const errorMessage = errorData?.error?.message || error.message;
    const errorCode = errorData?.error?.code;
    const errorDetails = errorData?.error?.error_data?.details || errorData?.error?.details;
    console.error('[WA TEMPLATE] Error response:', JSON.stringify(errorData, null, 2));
    console.error('[WA TEMPLATE] Error details:', JSON.stringify(errorDetails, null, 2));
    throw new Error(`Gagal mengirim template: ${errorMessage} (code: ${errorCode || 'unknown'})`);
  }
}

// Send message with rate limiting and retry
async function sendBillTemplateWithRetry(phoneNumber, params, templateName = 'tagihan_spp', attempt = 1) {
  try {
    return await rateLimitedSend(() => sendBillTemplate(phoneNumber, params, templateName));
  } catch (error) {
    // Retry on rate limit errors (code 4, 131047, or 131056)
    const isRateLimit = error.message?.includes('rate limit') || 
                        error.message?.includes('131047') ||
                        error.message?.includes('131056') ||
                        error.message?.includes('too many requests');
    
    if (attempt < MAX_RETRY_ATTEMPTS && isRateLimit) {
      const backoffDelay = RETRY_DELAY_MS * attempt;
      console.log(`[WA RATE LIMIT] Retry ${attempt}/${MAX_RETRY_ATTEMPTS} after ${backoffDelay}ms`);
      await sleep(backoffDelay);
      return sendBillTemplateWithRetry(phoneNumber, params, templateName, attempt + 1);
    }
    
    throw error;
  }
}

async function sendBillTemplateBulk(students) {
  const results = [];
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < students.length; i++) {
    const student = students[i];
    try {
      const result = await sendBillTemplateWithRetry(student.no_wa, {
        nama_siswa: student.nama_siswa,
        jumlah_tagihan: student.jumlah_tagihan,
        tanggal_jatuh_tempo: student.tanggal_jatuh_tempo,
        semester: student.semester
      });
      results.push({ student_id: student.id, success: true, ...result });
      successCount++;
    } catch (error) {
      results.push({ student_id: student.id, success: false, error: error.message });
      failCount++;
    }
    
    // Log progress every 10 messages
    if ((i + 1) % 10 === 0) {
      console.log(`[BULK SEND] Progress: ${i + 1}/${students.length} (${successCount} sent, ${failCount} failed)`);
    }
  }
  
  return results;
}

// Send free-form message (for customer service replies within 24h window)
async function sendFreeMessage(phoneNumber, messageText) {
  if (!WHATSAPP_BASE_URL || !WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_GRAPH_API_TOKEN) {
    throw new Error('Konfigurasi WhatsApp belum lengkap');
  }

  const formattedPhone = formatPhoneNumber(phoneNumber);
  if (!formattedPhone) {
    throw new Error(`Nomor telepon tidak valid: ${phoneNumber}`);
  }

  const url = `${WHATSAPP_BASE_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: formattedPhone,
    type: 'text',
    text: {
      body: messageText,
      preview_url: false
    }
  };

  return rateLimitedSend(async () => {
    try {
      const response = await axios.post(url, payload, {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_GRAPH_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });

      const messageId = response.data?.messages?.[0]?.id;

      // Save to database for CS dashboard
      await saveOutgoingMessage(formattedPhone, messageText, 'text', messageId);

      return {
        success: true,
        messageId: messageId,
        data: response.data
      };
    } catch (error) {
      const errorMessage = error.response?.data?.error?.message || error.message;
      const errorCode = error.response?.data?.error?.code;
      throw new Error(`Gagal mengirim pesan: ${errorMessage} (code: ${errorCode || 'unknown'})`);
    }
  });
}

module.exports = {
  sendBillTemplate,
  sendBillTemplateWithRetry,
  sendBillTemplateBulk,
  sendFreeMessage,
  formatPhoneNumber,
  fetchMetaTemplates,
  fetchTemplateByName,
  buildDynamicTemplateComponents,
  usesDynamicTemplateComponents,
  uploadWhatsAppMedia,
  checkParamNamesLimit,
  sleep
};