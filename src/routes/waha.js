// WhatsApp QR API Routes
const express = require('express');
const router = express.Router();
const { initWhatsAppBaileys, getQR, isConnected } = require('../utils/whatsappBaileys');
const { authenticateToken } = require('../middleware/auth');

// GET /api/waha/qr - Get QR code (public for initial setup)
router.get('/waha/qr', (req, res) => {
  const qr = getQR();
  if (qr) {
    res.json({ success: true, qr: qr });
  } else {
    res.json({ success: false, message: 'QR belum tersedia, tunggu beberapa detik' });
  }
});

// GET /api/waha/status - Check connection
router.get('/waha/status', (req, res) => {
  res.json({ success: true, connected: isConnected() });
});

// POST /api/waha/send - Send message
router.post('/waha/send', authenticateToken, async (req, res) => {
  try {
    const { to, message } = req.body;
    const { sendWhatsAppBaileys } = require('../utils/whatsappBaileys');
    
    const result = await sendWhatsAppBaileys(to, message);
    res.json({ success: true, messageId: result.messageId });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/waha/init - Initialize WhatsApp
router.post('/waha/init', authenticateToken, async (req, res) => {
  try {
    await initWhatsAppBaileys();
    res.json({ success: true, message: 'WhatsApp initialized' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;