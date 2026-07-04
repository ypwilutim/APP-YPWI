const axios = require('axios');

const WHATSAPP_BASE_URL = process.env.WHATSAPP_BASE_URL;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_GRAPH_API_TOKEN = process.env.WHATSAPP_GRAPH_API_TOKEN;

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

async function sendBillTemplate(phoneNumber, { nama_siswa, bulan, jumlah_tagihan, tanggal_jatuh_tempo, nomor_rekening, nama_penerima }) {
  if (!WHATSAPP_BASE_URL || !WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_GRAPH_API_TOKEN) {
    throw new Error('Konfigurasi WhatsApp belum lengkap. Pastikan WHATSAPP_BASE_URL, WHATSAPP_PHONE_NUMBER_ID, dan WHATSAPP_GRAPH_API_TOKEN sudah diisi di .env');
  }

  const formattedPhone = formatPhoneNumber(phoneNumber);
  if (!formattedPhone) {
    throw new Error(`Nomor telepon tidak valid: ${phoneNumber}`);
  }

  const url = `${WHATSAPP_BASE_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to: formattedPhone,
    type: 'template',
    template: {
      name: 'tagihan_spp',
      language: {
        code: 'id'
      },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: nama_siswa || '-' },
            { type: 'text', text: bulan || '-' },
            { type: 'text', text: jumlah_tagihan || '0' },
            { type: 'text', text: tanggal_jatuh_tempo || '-' },
            { type: 'text', text: nomor_rekening || '-' },
            { type: 'text', text: nama_penerima || '-' }
          ]
        }
      ]
    }
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${WHATSAPP_GRAPH_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    return {
      success: true,
      messageId: response.data?.messages?.[0]?.id,
      data: response.data
    };
  } catch (error) {
    const errorMessage = error.response?.data?.error?.message || error.message;
    const errorCode = error.response?.data?.error?.code;
    throw new Error(`Gagal mengirim template: ${errorMessage} (code: ${errorCode || 'unknown'})`);
  }
}

async function sendBillTemplateBulk(students) {
  const results = [];
  for (const student of students) {
    try {
      const result = await sendBillTemplate(student.no_wa, {
        nama_siswa: student.nama_siswa,
        jumlah_tagihan: student.jumlah_tagihan,
        tanggal_jatuh_tempo: student.tanggal_jatuh_tempo,
        semester: student.semester
      });
      results.push({ student_id: student.id, success: true, ...result });
    } catch (error) {
      results.push({ student_id: student.id, success: false, error: error.message });
    }
  }
  return results;
}

module.exports = {
  sendBillTemplate,
  sendBillTemplateBulk,
  formatPhoneNumber
};