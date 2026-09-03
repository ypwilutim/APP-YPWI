// ============================================================
// WHATSAPP CLOUD API (META) WEBHOOK ROUTES
// Endpoint untuk verifikasi & menerima event dari WhatsApp
// ============================================================

const express = require('express');
const router = express.Router();
const db = require('../../db');

// Verifikasi token - HARUS SAMA dengan yang diisi di Meta Developer Dashboard
// Disimpan di .env sebagai WHATSAPP_WEBHOOK_VERIFY_TOKEN
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'ypwi_webhook_secret_2026';

// Ambil konfigurasi WhatsApp per tenant (phone_number_id, access_token)
async function getWhatsAppConfig(phoneNumberId) {
  try {
    const [config] = await db.query(
      `SELECT tenant_id, phone_number_id, access_token, is_active 
       FROM whatsapp_config 
       WHERE phone_number_id = ? AND is_active = 1 
       LIMIT 1`,
      [phoneNumberId]
    );
    return config;
  } catch (e) {
    // Tabel belum ada, return null
    return null;
  }
}

// Simpan event ke database untuk audit
async function saveWhatsAppEvent(phoneNumberId, eventType, payload) {
  try {
    await db.query(
      `INSERT INTO whatsapp_webhook_logs (phone_number_id, event_type, payload, received_at) 
       VALUES (?, ?, ?, NOW())`,
      [phoneNumberId, eventType, JSON.stringify(payload)]
    );
  } catch (e) {
    // Tabel belum ada, skip
  }
}

// ==========================================
// GET /api/whatsapp/webhook - Webhook Verification
// Dipanggil oleh Meta untuk verifikasi saat setup
// ==========================================
router.get('/whatsapp/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const phoneNumberId = req.query['phone_number_id'] || 'unknown';

  console.log(`[WA WEBHOOK VERIFY] mode=${mode}, token_match=${token === WHATSAPP_VERIFY_TOKEN}, phone=${phoneNumberId}`);

  if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
    console.log('[WA WEBHOOK] ✓ Webhook verified successfully');
    return res.status(200).send(challenge);
  }

  console.log('[WA WEBHOOK] ✗ Webhook verification failed - invalid token');
  return res.status(403).send('Forbidden - Invalid verify token');
});

// ==========================================
// POST /api/whatsapp/webhook - Receive Events
// Menerima event: messages, message_status, dll
// ==========================================
router.post('/whatsapp/webhook', async (req, res) => {
  // WAJIB respond 200 OK dalam 5 detik (WA Meta requirement)
  res.sendStatus(200);

  try {
    const body = req.body;
    const object = body.object;
    const entries = body.entry || [];

    if (object !== 'whatsapp_business_account') {
      console.log('[WA WEBHOOK] Invalid object:', object);
      return;
    }

    for (const entry of entries) {
      const phoneNumberId = entry.changes?.[0]?.value?.metadata?.phone_number_id;
      const changes = entry.changes || [];

      for (const change of changes) {
        const field = change.field;
        const value = change.value;

        // Log event untuk audit
        await saveWhatsAppEvent(phoneNumberId, field, value);

         // ===== HANDLE MESSAGE EVENTS =====
        if (field === 'messages' && value.messages) {
          for (const message of value.messages) {
            const from = message.from; // Nomor pengirim
            const messageId = message.id;
            const messageType = message.type;
            const timestamp = message.timestamp;
            const contactName = value.contacts?.[0]?.profile?.name || '';

            console.log(`[WA INBOUND] From: ${from}, Type: ${messageType}, Name: ${contactName}`);

            // Handle media content (image, document, video, audio)
            let messageBody = '';
            let mediaUrl = null;
            if (messageType === 'text') {
              messageBody = message.text?.body || '';
            } else if (message[messageType]?.link) {
              mediaUrl = message[messageType].link;
              messageBody = `[${messageType}]`;
            } else {
              messageBody = `[${messageType}]`;
            }

            // Cari student/parent berdasarkan nomor WA
            try {
              const [parent] = await db.query(
                `SELECT id, nama_orang_tua FROM parents WHERE REPLACE(REPLACE(no_wa, '+', ''), ' ', '') LIKE CONCAT('%', REPLACE(REPLACE(?, '+', ''), ' ', ''), '%') OR REPLACE(REPLACE(no_wa, '+', ''), ' ', '') = ?`,
                [from, from]
              );

              const parentId = parent?.[0]?.id || null;

              // Simpan ke whatsapp_messages
              try {
                await db.query(
                  `INSERT INTO whatsapp_messages 
                   (from_phone, message, message_type, wa_message_id, profile_name, parent_id, media_url, status, direction) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, 'received', 'incoming')`,
                  [from, messageBody, messageType, messageId, contactName, parentId, mediaUrl]
                );
              } catch (e) { /* table columns might differ */ }

              // Simpan ke whatsapp_inbox juga
              if (parentId) {
                try {
                  await db.query(
                    `INSERT INTO whatsapp_inbox 
                     (phone_number_id, from_number, contact_name, message_type, message_body, media_url, message_id, student_id, parent_id, tenant_id, received_at) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, 
                       (SELECT id FROM students WHERE parent_id = ? LIMIT 1), 
                       ?, 
                       (SELECT tenant_id FROM students WHERE parent_id = ? LIMIT 1), 
                       FROM_UNIXTIME(?))`,
                    [
                      phoneNumberId,
                      from,
                      contactName,
                      messageType,
                      messageBody,
                      mediaUrl,
                      messageId,
                      parentId,
                      parentId,
                      parentId,
                      timestamp
                    ]
                  );
                } catch (e) { /* tabel belum ada, skip */ }
              }
            } catch (e) {
              console.error('[WA INBOUND] DB error:', e.message);
            }
          }
        }

        // ===== HANDLE MESSAGE STATUS (sent/delivered/read) =====
        if (field === 'messages' && value.statuses) {
          for (const status of value.statuses) {
            const messageId = status.id;
            const statusType = status.status; // sent, delivered, read, failed
            const recipientId = status.recipient_id;
            const timestamp = status.timestamp;
            const error = status.errors?.[0];

            console.log(`[WA STATUS] message_id=${messageId}, status=${statusType}, to=${recipientId}`);

            try {
              await db.query(
                `INSERT INTO whatsapp_message_status 
                 (message_id, recipient_id, status, error_code, error_message, updated_at) 
                 VALUES (?, ?, ?, ?, ?, FROM_UNIXTIME(?))
                 ON DUPLICATE KEY UPDATE 
                   status = VALUES(status), 
                   error_code = VALUES(error_code), 
                   error_message = VALUES(error_message),
                   updated_at = VALUES(updated_at)`,
                [
                  messageId,
                  recipientId,
                  statusType,
                  error?.code || null,
                  error?.title || null,
                  timestamp
                ]
              );
            } catch (e) { /* tabel belum ada, skip */ }

            // Update status in whatsapp_messages table based on wa_message_id
            try {
              await db.query(
                `UPDATE whatsapp_messages 
                 SET status = ?, direction = 'outgoing' 
                 WHERE wa_message_id = ? 
                 AND (status != 'replied' OR status IS NULL)`,
                [statusType, messageId]
              );
            } catch (e) { /* tabel belum ada, skip */ }
          }
        }
      }
    }
  } catch (error) {
    console.error('[WA WEBHOOK] Processing error:', error);
  }
});

module.exports = router;
