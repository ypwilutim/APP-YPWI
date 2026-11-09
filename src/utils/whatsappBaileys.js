// WhatsApp Handler using Baileys (alternative to Meta Business API)
const path = require('path');
const fs = require('fs');

// Global error handlers for WhatsApp connection failures
process.on('unhandledRejection', (reason, promise) => {
  if (reason && reason.message && 
      (reason.message.includes('Connection Failure') || 
       reason.message.includes('WebSocket') ||
       reason.message.includes('baileys') ||
       reason.message.includes('WhatsApp') ||
       reason.message.includes('decodeFrame') ||
       reason.message.includes('noise-handler') ||
       reason.message.includes('WebSocketClient'))) {
    console.error('[WAHA] Handled WhatsApp connection failure:', reason.message);
    return; // Prevent process exit
  }
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  if (err.message && 
      (err.message.includes('Connection Failure') || 
       err.message.includes('WebSocket') ||
       err.message.includes('baileys') ||
       err.message.includes('WhatsApp') ||
       err.message.includes('decodeFrame') ||
       err.message.includes('noise-handler') ||
       err.message.includes('WebSocketClient'))) {
    console.error('[WAHA] Handled WhatsApp uncaught exception:', err.message);
    return; // Prevent process exit
  }
  console.error('Uncaught Exception:', err);
});

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
  console.log('[WAHA] WhatsApp initialization skipped (disabled for stability)');
  return;
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