// WhatsApp Handler using Baileys (alternative to Meta Business API)
const path = require('path');
const fs = require('fs');

let makeWASocket, useMultiFileAuthState, DisconnectReason;
let sock = null;
let isReady = false;
let qrString = null;

async function loadBaileys() {
  if (!makeWASocket) {
    try {
      const baileys = await import('@whiskeysockets/baileys');
      makeWASocket = baileys.default;
      useMultiFileAuthState = baileys.useMultiFileAuthState;
      DisconnectReason = baileys.DisconnectReason;
    } catch (err) {
      throw new Error('Baileys not installed. Run: npm install @whiskeysockets/baileys');
    }
  }
}

async function initWhatsAppBaileys() {
  await loadBaileys();
  
  const WAHA_AUTH_DIR = path.join(__dirname, '../waha-auth');
  
  if (!fs.existsSync(WAHA_AUTH_DIR)) {
    fs.mkdirSync(WAHA_AUTH_DIR, { recursive: true });
  }
  
  const { state, saveCreds } = await useMultiFileAuthState(WAHA_AUTH_DIR);
  
  sock = makeWASocket({
    auth: state,
    browser: ['YPWI-Lutim', 'Chrome', '3.0']
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, qr, lastDisconnect } = update;
    
    if (qr) {
      qrString = qr;
    }
    
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        setTimeout(initWhatsAppBaileys, 5000);
      }
      isReady = false;
    } else if (connection === 'open') {
      isReady = true;
      console.log('[WAHA] WhatsApp connected and ready');
    }
  });
  
  sock.ev.on('creds.update', saveCreds);
}

async function sendWhatsAppBaileys(to, text) {
  await loadBaileys();
  
  if (!isReady || !sock) {
    throw new Error('WhatsApp belum siap. Scan QR terlebih dahulu.');
  }
  
  const jid = to.includes('@s.whatsapp.net') ? to : `${to}@s.whatsapp.net`;
  const result = await sock.sendMessage(jid, { text });
  return { success: true, messageId: result.key.id };
}

module.exports = { initWhatsAppBaileys, sendWhatsAppBaileys, getQR: () => qrString, isConnected: () => isReady };