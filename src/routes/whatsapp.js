const express = require('express');
const router = express.Router();
const db = require('../../db');
const { sendFreeMessage, sendBillTemplate } = require('../utils/whatsappTemplate');

// Ensure table has required columns
async function ensureTableColumns() {
  try {
    await db.query(`ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS reply_to_message_id INT DEFAULT NULL`);
  } catch (e) {
    // Column might already exist
  }
  try {
    await db.query(`ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS direction ENUM('outgoing', 'incoming') DEFAULT 'incoming'`);
  } catch (e) {
    // Column might already exist
  }
  // Update existing records to set direction based on status
  try {
    await db.query(`UPDATE whatsapp_messages SET direction = 'incoming' WHERE status = 'received' AND direction IS NULL`);
    await db.query(`UPDATE whatsapp_messages SET direction = 'outgoing' WHERE status IN ('sent', 'delivered', 'read', 'replied') AND direction IS NULL`);
  } catch (e) {
    // Migration might have already run
  }
   // Ensure media columns exist
  try {
    await db.query(`ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_url TEXT DEFAULT NULL`);
  } catch (e) {
    // Column might already exist
  }
  try {
    await db.query(`ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_filename VARCHAR(255) DEFAULT NULL`);
  } catch (e) {
    // Column might already exist
  }
  try {
    await db.query(`ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS contact_photo_url TEXT DEFAULT NULL`);
  } catch (e) {
    // Column might already exist
  }
  try {
    await db.query(`ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS wa_message_id VARCHAR(100) DEFAULT NULL`);
  } catch (e) {
    // Column might already exist
  }
}

ensureTableColumns();

// GET /api/whatsapp/conversations - Get all conversations (grouped by phone)
router.get('/whatsapp/conversations', async (req, res) => {
  try {
    const { search, limit = 50, offset = 0 } = req.query;
    
    let query = `SELECT wm.from_phone as phone_number, MAX(wm.created_at) as last_time, COUNT(*) as message_count, (SELECT wm2.message FROM whatsapp_messages wm2 WHERE wm2.from_phone = wm.from_phone ORDER BY wm2.created_at DESC LIMIT 1) as last_message, (SELECT wm3.profile_name FROM whatsapp_messages wm3 WHERE wm3.from_phone = wm.from_phone AND wm3.profile_name IS NOT NULL LIMIT 1) as contact_name FROM whatsapp_messages wm WHERE 1=1`;
    const params = [];

    if (search) {
      query += ' AND (wm.from_phone LIKE ? OR wm.profile_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' GROUP BY wm.from_phone ORDER BY last_time DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const conversations = await db.query(query, params);

    const [summary] = await db.query(`SELECT COUNT(DISTINCT from_phone) as total_contacts, COUNT(*) as total_messages, SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END) as unreplied_count FROM whatsapp_messages`);

    res.json({ success: true, data: conversations, summary: summary });
  } catch (error) {
    console.error('[WA API] Get conversations error:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil percakapan' });
  }
});

// GET /api/whatsapp/conversation/:phone - Get conversation history
router.get('/whatsapp/conversation/:phone', async (req, res) => {
  try {
    const phone = req.params.phone;
    
     const messages = await db.query(`SELECT id, from_phone as phone_number, message as message_content, message_type, profile_name as contact_name, status as message_status, wa_message_id, parent_id, reply_to_message_id, media_url, media_filename, created_at, direction FROM whatsapp_messages WHERE from_phone = ? ORDER BY created_at ASC LIMIT 100`, [phone]);

    const [contact] = await db.query(`SELECT from_phone as phone_number, profile_name as contact_name, parent_id, COUNT(*) as total_messages, MAX(created_at) as last_interaction FROM whatsapp_messages WHERE from_phone = ? GROUP BY from_phone, profile_name, parent_id`, [phone]);

    let studentInfo = null;
    if (contact?.parent_id) {
      const [student] = await db.query(`SELECT s.id, s.nama_siswa, s.tenant_id, tn.nama_sekolah FROM students s LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id WHERE s.parent_id = ? LIMIT 1`, [contact.parent_id]);
      studentInfo = student;
    }

    const [lastIncoming] = await db.query(`SELECT created_at FROM whatsapp_messages WHERE from_phone = ? AND status = 'received' ORDER BY created_at DESC LIMIT 1`, [phone]);

    let withinWindow = false;
    let hoursSinceLastMessage = null;
    if (lastIncoming) {
      const now = new Date();
      const diffMs = now - new Date(lastIncoming.created_at);
      hoursSinceLastMessage = diffMs / (1000 * 60 * 60);
      withinWindow = hoursSinceLastMessage <= 24;
    }

    res.json({
      success: true,
      data: messages,
      contact: contact ? { ...contact, student: studentInfo } : null,
      window_status: {
        within_24h_window: withinWindow,
        hours_since_last_message: hoursSinceLastMessage ? Math.round(hoursSinceLastMessage * 10) / 10 : null,
        can_send_free_message: withinWindow,
        can_send_template: true
      }
    });
  } catch (error) {
    console.error('[WA API] Get conversation error:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil percakapan' });
  }
});

// POST /api/whatsapp/reply - Reply to a message (within 24h window)
router.post('/whatsapp/reply', async (req, res) => {
  try {
    const { phone_number, message, note, force_template = false, reply_to_message_id = null } = req.body;

    if (!phone_number || !message) {
      return res.status(400).json({ success: false, message: 'Phone dan pesan harus diisi' });
    }

    const [lastIncoming] = await db.query(`SELECT id, created_at FROM whatsapp_messages WHERE from_phone = ? AND status = 'received' ORDER BY created_at DESC LIMIT 1`, [phone_number]);

    let withinWindow = false;
    let hoursSinceLastMessage = null;
    
    if (lastIncoming) {
      const lastMessageTime = new Date(lastIncoming.created_at);
      const now = new Date();
      const diffMs = now - lastMessageTime;
      hoursSinceLastMessage = diffMs / (1000 * 60 * 60);
      withinWindow = hoursSinceLastMessage <= 24;
    }

    if (!withinWindow && !force_template) {
      return res.status(403).json({
        success: false,
        message: 'Jendela percakapan 24 jam sudah berakhir.',
        within_24h_window: false,
        hours_since_last_message: hoursSinceLastMessage ? Math.round(hoursSinceLastMessage * 10) / 10 : null,
        suggestion: 'Kirim pesan template atau hubungi via telepon.'
      });
    }

    let result;
    let messageType = 'text';
    
    if (withinWindow) {
      result = await sendFreeMessage(phone_number, message);
    } else {
      result = await sendBillTemplate(phone_number, { nama_siswa: 'Siswa', bulan: new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }), jumlah_tagihan: '-', tanggal_jatuh_tempo: '-', nomor_rekening: '-', nama_penerima: '-' }, 'tagihan_spp');
      messageType = 'template';
    }

    const replyToId = reply_to_message_id || (lastIncoming ? lastIncoming.id : null);
    
    await db.query(`INSERT INTO whatsapp_messages (from_phone, message, message_type, wa_message_id, profile_name, status, reply_to_message_id) VALUES (?, ?, ?, ?, NULL, 'replied', ?)`, [phone_number, message, result.messageId, messageType, replyToId]);

    await db.query(`UPDATE whatsapp_messages SET status = 'replied' WHERE from_phone = ? AND status = 'received'`, [phone_number]);

    res.json({
      success: true,
      message: withinWindow ? 'Pesan berhasil dikirim' : 'Pesan template berhasil dikirim',
      within_24h_window: withinWindow,
      hours_since_last_message: hoursSinceLastMessage ? Math.round(hoursSinceLastMessage * 10) / 10 : null,
      messageId: result.messageId,
      reply_to_message_id: replyToId
    });
  } catch (error) {
    console.error('[WA API] Reply error:', error);
    res.status(500).json({ success: false, message: 'Gagal mengirim balasan' });
  }
});

// GET /api/whatsapp/window-status/:phone - Check 24h window status
router.get('/api/whatsapp/window-status/:phone', async (req, res) => {
  try {
    const phone = req.params.phone;
    
    const [lastIncoming] = await db.query(`SELECT created_at FROM whatsapp_messages WHERE from_phone = ? AND status = 'received' ORDER BY created_at DESC LIMIT 1`, [phone]);

    let withinWindow = false;
    let hoursSinceLastMessage = null;
    let lastMessageTime = null;
    
    if (lastIncoming) {
      lastMessageTime = lastIncoming.created_at;
      const now = new Date();
      const diffMs = now - new Date(lastIncoming.created_at);
      hoursSinceLastMessage = diffMs / (1000 * 60 * 60);
      withinWindow = hoursSinceLastMessage <= 24;
    }

    res.json({
      success: true,
      within_24h_window: withinWindow,
      hours_since_last_message: hoursSinceLastMessage ? Math.round(hoursSinceLastMessage * 10) / 10 : null,
      last_message_time: lastMessageTime,
      can_send_free_message: withinWindow,
      can_send_template: true
    });
  } catch (error) {
    console.error('[WA API] Window status error:', error);
    res.status(500).json({ success: false, message: 'Gagal memeriksa status jendela' });
  }
});

// PUT /api/whatsapp/conversation/:phone/archive - Archive conversation
router.put('/whatsapp/conversation/:phone/archive', async (req, res) => {
  try {
    const { phone } = req.params;
    await db.query(`UPDATE whatsapp_messages SET status = 'archived' WHERE from_phone = ?`, [phone]);
    res.json({ success: true, message: 'Percakapan diarsipkan' });
  } catch (error) {
    console.error('[WA API] Archive conversation error:', error);
    res.status(500).json({ success: false, message: 'Gagal mengarsipkan percakapan' });
  }
});

// GET /api/whatsapp/contacts - Get all contacts with last message
router.get('/whatsapp/contacts', async (req, res) => {
  try {
    const { search } = req.query;
    
    let query = `SELECT wm.from_phone as phone_number, wm.profile_name as contact_name, wm.parent_id, MAX(wm.created_at) as last_interaction, COUNT(*) as total_messages, (SELECT wm2.message FROM whatsapp_messages wm2 WHERE wm2.from_phone = wm.from_phone ORDER BY wm2.created_at DESC LIMIT 1) as last_message, (SELECT wm3.created_at FROM whatsapp_messages wm3 WHERE wm3.from_phone = wm.from_phone ORDER BY wm3.created_at DESC LIMIT 1) as last_message_time FROM whatsapp_messages wm`;
    const params = [];

    if (search) {
      query += ' WHERE wm.from_phone LIKE ? OR wm.profile_name LIKE ?';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' GROUP BY wm.from_phone, wm.profile_name, wm.parent_id ORDER BY last_interaction DESC';

    const contacts = await db.query(query, params);

    for (const contact of contacts) {
      if (contact.parent_id) {
        const [student] = await db.query(`SELECT s.nama_siswa, s.tenant_id, tn.nama_sekolah FROM students s LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id WHERE s.parent_id = ? LIMIT 1`, [contact.parent_id]);
        contact.student = student || null;
      } else {
        contact.student = null;
      }

      const [lastIncoming] = await db.query(`SELECT created_at FROM whatsapp_messages WHERE from_phone = ? AND status = 'received' ORDER BY created_at DESC LIMIT 1`, [contact.phone_number]);

      if (lastIncoming) {
        const now = new Date();
        const diffMs = now - new Date(lastIncoming.created_at);
        const hoursSince = diffMs / (1000 * 60 * 60);
        contact.within_24h_window = hoursSince <= 24;
        contact.hours_since_last_message = Math.round(hoursSince * 10) / 10;
      } else {
        contact.within_24h_window = false;
        contact.hours_since_last_message = null;
      }
    }

    res.json({ success: true, data: contacts });
  } catch (error) {
    console.error('[WA API] Get contacts error:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil kontak' });
  }
});

// GET /api/cs/whatsapp/billing-messages - Get billing message history with details
router.get('/whatsapp/billing-messages', async (req, res) => {
  try {
    const { limit = 50, offset = 0, status, date_from, date_to } = req.query;
    
     let query = `SELECT wm.id, wm.from_phone as phone_number, wm.message as message_content, wm.status as message_status, wm.message_type, wm.wa_message_id, wm.created_at, wm.parent_id, wm.direction, s.nama_siswa, s.nis, tn.nama_sekolah, bp.spp_bulanan as total_tagihan, bp.bulan, wm.created_at as tanggal_kirim FROM whatsapp_messages wm LEFT JOIN students s ON wm.parent_id = s.parent_id LEFT JOIN tenants tn ON s.tenant_id = tn.tenant_id LEFT JOIN billing_payment bp ON bp.student_id = s.id AND bp.tenant_id = s.tenant_id WHERE wm.direction = 'outgoing'`;
    const params = [];

    if (status) {
       query += ' AND wm.status = ?';
      params.push(status);
    }
    if (date_from) {
      query += ' AND DATE(wm.created_at) >= ?';
      params.push(date_from);
    }
    if (date_to) {
      query += ' AND DATE(wm.created_at) <= ?';
      params.push(date_to);
    }

    query += ' ORDER BY wm.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const messages = await db.query(query, params);

    res.json({ success: true, data: messages });
  } catch (error) {
    console.error('[WA API] Get billing messages error:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil riwayat pesan tagihan' });
  }
});

// GET /api/whatsapp/stats - Get message status statistics
router.get('/whatsapp/stats', async (req, res) => {
  try {
    const stats = await db.query(`SELECT COUNT(*) as total_messages, SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END) as total_incoming, SUM(CASE WHEN status IN ('replied', 'sent', 'delivered', 'read') THEN 1 ELSE 0 END) as total_outgoing, SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as status_sent, SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as status_delivered, SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END) as status_read, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as status_failed FROM whatsapp_messages`);

    res.json({ success: true, data: stats[0] });
  } catch (error) {
    console.error('[WA API] Get stats error:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil statistik' });
  }
});

module.exports = router;