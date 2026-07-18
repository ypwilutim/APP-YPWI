// ============================================================
// CHAT ROUTES - WhatsApp-style messaging
// Per-user chat with search functionality
// ============================================================

const express = require('express');
const db = require('../../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Ensure tables exist
async function ensureTables() {
  try {
    await db.runMultiple(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id VARCHAR(20) DEFAULT NULL,
        is_global BOOLEAN DEFAULT FALSE,
        created_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_tenant (tenant_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await db.runMultiple(`
      CREATE TABLE IF NOT EXISTS conversation_participants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        conversation_id INT NOT NULL,
        user_id INT NOT NULL,
        user_type ENUM('guru', 'parent') DEFAULT 'guru',
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_read_at TIMESTAMP NULL DEFAULT NULL,
        is_typing TINYINT(1) DEFAULT 0,
        typing_expires_at TIMESTAMP NULL DEFAULT NULL,
        last_seen_at TIMESTAMP NULL DEFAULT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        UNIQUE KEY unique_participant (conversation_id, user_id),
        INDEX idx_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await db.runMultiple(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        conversation_id INT NOT NULL,
        sender_id INT NOT NULL,
        sender_name VARCHAR(100) NOT NULL,
        sender_type ENUM('guru', 'parent') DEFAULT 'guru',
        message TEXT NOT NULL,
        reply_to_message_id INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        INDEX idx_conversation (conversation_id),
        INDEX idx_created_at (created_at),
        INDEX idx_sender (sender_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  } catch (e) { console.error('Chat table error:', e.message); }
}

ensureTables();

// GET /api/chat/conversations - List user conversations
router.get('/chat/conversations', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    // Get conversations with other participant's name
    const conversations = await db.query(`
      SELECT c.id, c.tenant_id, c.is_global, 
        GROUP_CONCAT(cp.user_id) as participant_ids,
        (SELECT message FROM chat_messages cm WHERE cm.conversation_id = c.id ORDER BY cm.created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM chat_messages cm WHERE cm.conversation_id = c.id ORDER BY cm.created_at DESC LIMIT 1) as last_time,
        COALESCE(
          (SELECT nama FROM teachers t JOIN conversation_participants cp_other ON t.id = cp_other.user_id WHERE cp_other.conversation_id = c.id AND cp_other.user_id != ? LIMIT 1),
          (SELECT username FROM users u JOIN conversation_participants cp_other ON u.id = cp_other.user_id WHERE cp_other.conversation_id = c.id AND cp_other.user_id != ? LIMIT 1),
          'Percakapan'
        ) as other_name
      FROM conversations c
      JOIN conversation_participants cp ON c.id = cp.conversation_id
      WHERE cp.user_id = ?
      GROUP BY c.id ORDER BY last_time DESC
    `, [userId, userId, userId]);
    
    res.json({ success: true, conversations });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ success: false, message: 'Error fetching conversations' });
  }
});

// POST /api/chat/conversations - Create/start conversation with user
router.post('/chat/conversations', authenticateToken, async (req, res) => {
  try {
    let { targetUserId, targetUserType, targetName } = req.body;
    const userId = req.user.id;
    const userAssignments = req.user.assignments || [];
    const userTenantId = req.user.tenant_id || userAssignments[0]?.tenant_id;

    // Jika targetName diberikan, cari teacher_id-nya
    if (targetName && !targetUserId) {
      const teacher = await db.query('SELECT id FROM teachers WHERE nama = ? LIMIT 1', [targetName]);
      if (teacher?.[0]) targetUserId = teacher[0].id;
    }

    // Validate access - only same-tenant guru for now
    const isYpwilutimAdmin = userAssignments.some(a => 
      a.tenant_id === 'YPWILUTIM' && 
      (a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, '').includes('admin')
    );

    if (!isYpwilutimAdmin) {
      // Guru: only to same tenant guru
      const targetTenant = await db.query(
        'SELECT tenant_id FROM teacher_assignments WHERE teacher_id = ? LIMIT 1', 
        [targetUserId]
      );

      if (!targetTenant?.[0] || targetTenant[0].tenant_id !== userTenantId) {
        return res.status(403).json({ success: false, message: 'Akses ditolak - tenant berbeda' });
      }
    }

    // Check if conversation already exists between these two users
    const existing = await db.query(
      `SELECT c.id FROM conversations c 
       JOIN conversation_participants cp1 ON c.id = cp1.conversation_id 
       JOIN conversation_participants cp2 ON c.id = cp2.conversation_id 
       WHERE cp1.user_id = ? AND cp2.user_id = ?`,
      [userId, targetUserId]
    );

    let conversationId;
    if (existing.length > 0) {
      conversationId = existing[0].id;
    } else {
      const result = await db.query(
        'INSERT INTO conversations (tenant_id, created_by) VALUES (?, ?)',
        [userTenantId, userId]
      );
      conversationId = result.insertId;

      await db.query(
        'INSERT INTO conversation_participants (conversation_id, user_id, user_type) VALUES (?, ?, ?), (?, ?, ?)',
        [conversationId, userId, 'guru', conversationId, targetUserId, targetUserType || 'guru']
      );
    }

    res.json({ success: true, conversationId });
  } catch (error) {
    console.error('Create conversation error:', error);
    res.status(500).json({ success: false, message: 'Error creating conversation: ' + error.message });
  }
});

// GET /api/chat/conversations/:id/messages - Get messages in conversation
router.get('/chat/conversations/:id/messages', authenticateToken, async (req, res) => {
  try {
    const conversationId = req.params.id;
    const userId = req.user.id;

    // Verify user is participant
    const participant = await db.query(
      'SELECT id FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [conversationId, userId]
    );
    if (participant.length === 0) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const messages = await db.query(
      'SELECT id, sender_id, sender_name, message, created_at FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [conversationId]
    );

    res.json({ success: true, messages });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ success: false, message: 'Error fetching messages' });
  }
});

// POST /api/chat/conversations/:id/messages - Send message in conversation
router.post('/chat/conversations/:id/messages', authenticateToken, async (req, res) => {
  try {
    const conversationId = req.params.id;
    const userId = req.user.id;
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
      return res.json({ success: false, message: 'Pesan kosong' });
    }

    const participant = await db.query(
      'SELECT id FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [conversationId, userId]
    );
    if (participant.length === 0) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    let senderName = req.user.username || req.user.nama || 'User';
    if (req.user.guru_id) {
      const teacher = await db.query('SELECT nama FROM teachers WHERE id = ?', [req.user.guru_id]);
      if (teacher?.[0]) senderName = teacher[0].nama;
    }

    const result = await db.query(
      'INSERT INTO chat_messages (conversation_id, sender_id, sender_name, message) VALUES (?, ?, ?, ?)',
      [conversationId, userId, senderName, message.trim()]
    );

    res.json({ success: true, message: 'Terkirim', id: result.insertId });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ success: false, message: 'Error sending message' });
  }
});

// GET /api/chat/users - Search users for chat (guru only)
router.get('/chat/users', authenticateToken, async (req, res) => {
  try {
    const search = req.query.search || '';
    const userAssignments = req.user.assignments || [];
    const userTenantId = req.user.tenant_id || userAssignments[0]?.tenant_id;

    const isYpwilutimAdmin = userAssignments.some(a => 
      a.tenant_id === 'YPWILUTIM' && 
      (a.jabatan_di_unit || '').toLowerCase().replace(/\s/g, '').includes('admin')
    );

    let query = '';
    let params = [];

    if (isYpwilutimAdmin) {
      // YPWILUTIM admin: all active teachers
      query = `
        SELECT t.id as user_id, t.nama as name, 'guru' as type, ta.tenant_id 
        FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id 
        WHERE t.status_aktif = 1 AND (t.nama LIKE ? OR ta.tenant_id LIKE ?)
      `;
      params = [`%${search}%`, `%${search}%`];
    } else {
      // Guru: only same-tenant guru - exclude self
      query = `
        SELECT t.id as user_id, t.nama as name, 'guru' as type, ta.tenant_id 
        FROM teachers t JOIN teacher_assignments ta ON t.id = ta.teacher_id 
        WHERE t.status_aktif = 1 AND ta.tenant_id = ? AND t.nama LIKE ? AND t.id != ?
      `;
      params = [userTenantId, `%${search}%`, req.user.guru_id];
    }

    const users = await db.query(query, params);
    res.json({ success: true, users });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ success: false, message: 'Error searching users' });
  }
});

// DELETE /api/chat/conversations/:id - Delete conversation (leave)
router.delete('/chat/conversations/:id', authenticateToken, async (req, res) => {
  try {
    const conversationId = req.params.id;
    const userId = req.user.id;

    // Verify user is participant
    const participant = await db.query(
      'SELECT id FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [conversationId, userId]
    );
    if (participant.length === 0) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    // Remove user from participants
    await db.query(
      'DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [conversationId, userId]
    );

    // If no participants left, delete conversation and messages
    const remaining = await db.query(
      'SELECT COUNT(*) as count FROM conversation_participants WHERE conversation_id = ?',
      [conversationId]
    );

    if (remaining[0]?.count === 0) {
      await db.query('DELETE FROM conversations WHERE id = ?', [conversationId]);
    }

    res.json({ success: true, message: 'Percakapan dihapus' });
  } catch (error) {
    console.error('Delete conversation error:', error);
    res.status(500).json({ success: false, message: 'Error deleting conversation' });
  }
});

module.exports = router;