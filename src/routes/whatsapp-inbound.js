const express = require('express');
const db = require('../../db');
const { authenticateAdmin } = require('../middleware/auth');

const router = express.Router();

(async function() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        from_phone VARCHAR(20) NOT NULL,
        message TEXT,
        message_type ENUM('text', 'image', 'audio', 'video', 'document', 'location', 'contacts', 'interactive', 'unknown') DEFAULT 'text',
        wa_message_id VARCHAR(100),
        profile_name VARCHAR(100),
        status ENUM('received', 'read', 'replied', 'archived') DEFAULT 'received',
        reply_to_id INT DEFAULT NULL,
        parent_id INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_phone (from_phone),
        INDEX idx_created_at (created_at),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  } catch (e) { console.error('WhatsApp messages table error:', e.message); }
})();

async function getContactProfile(phoneNumber) {
  const cleanPhone = phoneNumber.replace(/[\s\-\(\)+]/g, '').replace(/^0/, '62');
  
  const teacher = await db.query(
    `SELECT t.id, t.nama, t.no_wa, t.link_foto AS photo_url, ta.jabatan_di_unit 
     FROM teachers t LEFT JOIN teacher_assignments ta ON t.id = ta.teacher_id 
     WHERE REPLACE(REPLACE(t.no_wa, "+", ""), " ", "") LIKE ? OR REPLACE(REPLACE(t.no_wa, "+", ""), " ", "") = ? 
     LIMIT 1`,
    [`%${cleanPhone}%`, cleanPhone]
  );
  
  if (teacher?.length) {
    const jabatan = teacher[0].jabatan_di_unit || 'Guru';
    return { 
      name: `${teacher[0].nama} (${jabatan} - SDIT YPWI Lutim)`,
      photo: teacher[0].photo_url || null,
      type: 'teacher',
      id: teacher[0].id
    };
  }
  
  const parent = await db.query(
    'SELECT id, nama_orang_tua, no_wa FROM parents WHERE REPLACE(REPLACE(no_wa, "+", ""), " ", "") LIKE ? OR REPLACE(REPLACE(no_wa, "+", ""), " ", "") = ? LIMIT 1',
    [`%${cleanPhone}%`, cleanPhone]
  );
  
  if (parent?.length) {
    const anak = await db.query(
      'SELECT s.nama_siswa, k.nama_kelas FROM students s LEFT JOIN classes k ON s.class_id = k.id WHERE s.parent_id = ? LIMIT 1',
      [parent[0].id]
    );
    const nm = parent[0].nama_orang_tua || 'Orangtua';
    return { 
      name: anak?.[0] 
        ? `${nm} (Orangtua dari ${anak[0].nama_siswa}, ${anak[0].nama_kelas || 'Kelas'} - SDIT YPWI Lutim)`
        : `${nm} (Orangtua - SDIT YPWI Lutim)`,
      photo: null,
      type: 'parent',
      id: parent[0].id
    };
  }
  
  return { name: phoneNumber, photo: null, type: null, id: null };
}

router.get('/whatsapp/inbound/conversations', authenticateAdmin, async (req, res) => {
  try {
    const { search } = req.query;
    
    let query = `
      SELECT from_phone as phone_number, 
             MAX(created_at) as last_time,
             COUNT(*) as message_count,
             (SELECT message FROM whatsapp_messages wm2 WHERE wm2.from_phone = wm.from_phone ORDER BY wm2.created_at DESC LIMIT 1) as last_message,
             (SELECT profile_name FROM whatsapp_messages wm3 WHERE wm3.from_phone = wm.from_phone AND wm3.profile_name IS NOT NULL LIMIT 1) as contact_name
       FROM whatsapp_messages wm
     `;
    
    if (search) {
      query += ' WHERE wm.from_phone LIKE ?';
    }
    
    query += ' GROUP BY wm.from_phone ORDER BY last_time DESC';
    
    const params = search ? [`%${search}%`] : [];
    const conversations = await db.query(query, params);
    
    for (const conv of conversations) {
      conv.contact_photo = null;
      if (!conv.contact_name) {
        const profile = await getContactProfile(conv.phone_number);
        conv.contact_name = profile.name;
        conv.contact_photo = profile.photo;
      }
    }
    
    res.json({ success: true, conversations });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil percakapan' });
  }
});

router.get('/whatsapp/inbound/conversations/:phone/messages', authenticateAdmin, async (req, res) => {
  try {
    const { phone } = req.params;
    
    const profile = await getContactProfile(phone);
    
    const messages = await db.query(
      `SELECT id, from_phone as phone_number, message, message_type, profile_name as contact_name, 
              status, created_at 
       FROM whatsapp_messages 
       WHERE from_phone = ? 
       ORDER BY created_at ASC`,
      [phone]
    );
    
    const enrichedMessages = messages.map(m => ({
      ...m,
      is_outgoing: m.status === 'replied',
      contact_photo: profile.photo
    }));
    
    res.json({ success: true, messages: enrichedMessages, contact: profile });
  } catch (error) {
    console.error('Get conversation messages error:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil pesan percakapan' });
  }
});

router.post('/whatsapp/inbound/send', authenticateAdmin, async (req, res) => {
  try {
    const { to, message, message_type = 'text' } = req.body;
    
    if (!to || !message) {
      return res.status(400).json({ success: false, message: 'Nomor tujuan dan pesan diperlukan' });
    }
    
    const profile = await getContactProfile(to);
    
    const insertResult = await db.query(
      `INSERT INTO whatsapp_messages (from_phone, message, message_type, profile_name, status) 
       VALUES (?, ?, ?, ?, 'replied')`,
      [to, message, message_type, profile.name]
    );
    
    const result = await sendWhatsAppMessage(to, message, message_type);
    
    if (result.messageId) {
      await db.query(
        'UPDATE whatsapp_messages SET status = ?, wa_message_id = ? WHERE id = ?',
        ['replied', result.messageId, insertResult.insertId]
      );
    }
    
    res.json({ success: true, message: 'Pesan terkirim', id: insertResult.insertId });
  } catch (error) {
    console.error('Send error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/whatsapp/inbound/:id/reply', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    
    const msg = await db.query('SELECT * FROM whatsapp_messages WHERE id = ?', [id]);
    if (!msg?.length) {
      return res.status(404).json({ success: false, message: 'Pesan tidak ditemukan' });
    }
    
    const profile = await getContactProfile(msg[0].from_phone);
    
    const insertResult = await db.query(
      `INSERT INTO whatsapp_messages (from_phone, message, message_type, profile_name, status) 
       VALUES (?, ?, 'text', ?, 'replied')`,
      [msg[0].from_phone, message, profile.name]
    );
    
    const result = await sendWhatsAppMessage(msg[0].from_phone, message);
    
    if (result.messageId) {
      await db.query(
        'UPDATE whatsapp_messages SET status = ?, wa_message_id = ? WHERE id = ?',
        ['replied', result.messageId, insertResult.insertId]
      );
    }
    
    res.json({ success: true, message: 'Balasan terkirim' });
  } catch (error) {
    console.error('Reply error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/whatsapp/inbound/:id/status', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    await db.query('UPDATE whatsapp_messages SET status = ? WHERE id = ?', [status, id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

async function sendWhatsAppMessage(to, message, type = 'text') {
  const { WHATSAPP_BASE_URL, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_GRAPH_API_TOKEN } = process.env;
  
  if (!WHATSAPP_BASE_URL || !WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_GRAPH_API_TOKEN) {
    throw new Error('Konfigurasi WhatsApp belum lengkap.');
  }
  
  const url = `${WHATSAPP_BASE_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  
  let payload = { messaging_product: 'whatsapp', to: to };
  
  if (type === 'text') {
    payload.type = 'text';
    payload.text = { body: message };
  } else if (type === 'image') {
    payload.type = 'image';
    payload.image = { link: message };
  }
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_GRAPH_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error?.message || 'Gagal mengirim pesan');
  }
  
  return { messageId: data.messages?.[0]?.id };
}

module.exports = router;