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
      { type: 'text', text: params.nama_pembayaran || params.nama_penerima || '-' },
      { type: 'text', text: params.kelas || '-' },
      { type: 'text', text: params.info_sekolah || '-' }
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
  sleep
};