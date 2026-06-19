# Perencanaan Webhook WhatsApp - Facebook Developer Console

## 1. Ringkasan Sistem WhatsApp Saat Ini

### Integrasi yang Sudah Ada: Whacenter API

```
┌─────────────────────────────────────────────────────────────┐
│                    Server (server.js)                        │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  sendWhatsAppMessage(number, message)                   │ │
│  │  ├─ https://api.whacenter.com/api/send                  │ │
│  │  ├─ WhatsApp_ENABLED toggle                             │ │
│  │  └─ global.sendWhatsAppMessage = function               │ │
│  └─────────────────────────────────────────────────────────┘ │
│                           │                                  │
│                           ▼                                  │
│                  Whacenter Gateway                          │
│                  (middleware WA)                            │
│                           │                                  │
│                           ▼                                  │
│                    WhatsApp User                            │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  - Absen (Absensi)                                      │ │
│  │  - OTP (Lupa Password)                                  │ │
│  │  - Iuran Bulanan                                        │ │
│  │  - Reminder                                             │ │
│  └─────────────────────────────────────────────────────────┘ │
```

### File Terkait:
- `server.js:401-461` — `sendWhatsAppMessage()` + export global
- `.env:13-15` — WHATSAPP_ENDPOINT, WHATSAPP_DEVICE_ID, WHATSAPP_ENABLED

### Lokasi Penggunaan:
- `server.js:881` — Notifikasi absen (scan masuk/keluar)
- `server.js:958` — Notifikasi dinas luar
- `src/routes/absensi.js:117-118` — Notifikasi evaluasi otomatis
- `src/routes/absensi.js:648-649` — Notifikasi recap harian/bulanan

---

## 2. Arsitektur Facebook WhatsApp Business API (Meta)

apa:      ```

# Objective: Di facebook developer setup webhook callbacknya.

## Perencanaan

### A. Persiapan Facebook Developer Console

1.  **Buat/Miliki Meta Business App:**
    *   Buka [Meta for Developers](https://developers.facebook.com/).
    *   Buat aplikasi baru (tipe "Business" > centang "WhatsApp").
2.  **Tambahkan Produk WhatsApp:**
    *   Di dalam aplikasi, tambahkan produk "WhatsApp".
3.  **Daftar Nomor Telepon (Phone Number ID):**
    *   Di bagian "WhatsApp > API Setup", daftarkan nomor telepon bisnis yang akan digunakan untuk mengirim pesan.
    *   Catat: **WhatsApp Business Account ID**, **Phone Number ID**, dan **Access Token**.
4.  **Konfigurasi Webhook di Dashboard Meta:**
    *   Masuk ke **WhatsApp > Configuration > Webhook**.
    *   Klik "Edit" untuk menambahkan atau mengubah Callback URL.
    *   **Callback URL:** `https://domain-anda.com/api/whatsapp/webhook` (dengan tahap verifikasi dan listener).
    *   **Verify Token:** Buat string acak (misal: `ypwi_webhook_secret_2026`) dan simpan di `.env`.
    *   **Webhook Fields:** Pilih bidang yang ingin dilacak:
        *   `messages` (Pesan masuk/keluar)
        *   `message_status` (Status terkirim/dibaca)

---

### B. Persiapan Server / Backend (`server.js`)

1.  **Tambahkan Dependensi & Konfigurasi:**
    *   Di `server.js` atau file konfigurasi, tambahkan variabel untuk token Meta:
        *   `WHATSAPP_GRAPH_API_TOKEN`: Token Akses API WhatsApp Graph (dari Meta).
        *   `WHATSAPP_PHONE_NUMBER_ID`: ID Nomor Telepon Bisnis.
        *   `WHATSAPP_WEBHOOK_VERIFY_TOKEN`: Token verifikasi callback (harus sama dengan yang di Meta).
        *   `WHATSAPP_BASE_URL`: `https://graph.facebook.com/{vAPI_VERSION}` (misal: v18.0, sesuai versi saat ini).

2.  **Fungsi Kirim Pesan (Outbound):**
    Gunakan Graph API untuk mengirim pesan. Berikut contoh fungsi yang bisa dipindah ke `mekari.js` atau dibuat baru di `server.js`:

    ```javascript
    const axios = require('axios');

    async function sendMessageToWhatsApp(to, messageTemplateName, components = []) {
      // to: format nomor Indonesia 628xxx (tanpa +)
      // messageTemplateName: nama template yang sudah ter-approve di Meta
      // components: array isian variabel template (jika ada)

      if (process.env.WHATSAPP_ENABLED !== 'true') {
        console.log('WhatsApp dinonaktifkan via .env');
        return { success: true, message: 'WhatsApp disabled' };
      }

      try {
        const response = await axios.post(
          `${process.env.WHATSAPP_BASE_URL}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
          {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to,
            type: "template",
            template: {
              name: messageTemplateName,
              language: { code: "id" }, // Bahasa Indonesia
              components: components
            }
          },
          {
            headers: {
              'Authorization': `Bearer ${process.env.WHATSAPP_GRAPH_API_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        );

        console.log('Pesan WA berhasil dikirim:', response.data);
        return { success: true, data: response.data };
      } catch (error) {
        console.error('Gagal kirim WA:', error.response?.data || error.message);
        return { success: false, error: error.response?.data || error.message };
      }
    }
    ```

3.  **Endpoint Webhook Callback (Inbound & Status):**
    Di `server.js`, buat endpoint untuk menerima data dari Meta:

    *   **GET (Verifikasi):** Digunakan oleh Meta untuk memverifikasi endpoint.
        ```javascript
        app.get('/api/whatsapp/webhook', (req, res) => {
          const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
          const mode = req.query['hub.mode'];
          const token = req.query['hub.verify_token'];
          const challenge = req.query['hub.challenge'];

          if (mode && token) {
            if (mode === 'subscribe' && token === VERIFY_TOKEN) {
              console.log('Webhook terverifikasi!');
              res.status(200).send(challenge);
            } else {
              res.sendStatus(403);
            }
          } else {
            res.sendStatus(400);
          }
        });
        ```

    *   **POST (Listener Pesan Masuk & Status):**
        ```javascript
        app.post('/api/whatsapp/webhook', (req, res) => {
          const payload = req.body;

          // Cek apakah ini pesan masuk
          if (payload.object === 'whatsapp_business_account') {
            payload.entry.forEach((entry) => {
              entry.changes.forEach((change) => {
                if (change.field === 'messages') {
                  const value = change.value;
                  // Logika untuk membaca pesan masuk (misal: balasan OTP, "stop" untuk unsubscribe)
                  // value.messages[0].text.body berisi isi pesan dari pengguna
                  console.log('Pesan masuk dari WA:', JSON.stringify(value.messages, null, 2));

                  // Contoh: Ambil nomor pengirim dan isi pesan
                  if (value.messages && value.messages[0]) {
                    const from = value.messages[0].from;
                    const messageBody = value.messages[0].text.body;
                    console.log(`Dari: ${from}, Pesan: ${messageBody}`);
                  }
                }
                // Cek apakah ini update status pesan
                if (change.field === 'messaging_status') {
                   console.log('Status update:', change.value);
                }
              });
            });
            res.status(200).send('EVENT_RECEIVED');
          } else {
            res.sendStatus(404);
          }
        });
        ```

---

### C. Persiapan Database & Template Pesan

1.  **Otentikasi Template Pesan:**
    Pesan WhatsApp Bisnis diharuskan menggunakan **Template Message** yang sudah di-approve oleh Meta (kecuali dalam *session* 24 jam setelah pesan masuk pertama). Gunakan "WhatsApp > Message Templates" di Meta Dashboard untuk membuat template seperti:
    *   `absensi_otp` (untuk OTP login)
    *   `laporan_iuran` (untuk notifikasi iuran)
    *   `pengingat_absensi` (reminder absen)

2.  **Tabel Pesan (Opsional):**
    Jika ingin mencatat semua aktivitas pengiriman dan penerimaan WA, buat tabel baru di database untuk logging:
    *   `whatsapp_logs`: id, nomor_tujuan, jenis_pesan (template/text/flash), status_pengiriman (sent, delivered, read, failed), pesan, timestamp.

3.  **Integrasi ke Fitur Sistem:**
    Hubungkan fungsi kirim pesan ke setiap fitur yang membutuhkan:
    *   **Absen:** Saat guru melakukan scan QR.
    *   **OTP:** Saat user lupa password / forgot password.
    *   **Iuran Bulanan:** Jadwal otomatis (misal cron job) atau trigger manual admin.
    *   **Reminder:** Cron job untuk pengingat absen pagi/sore atau kegiatan khusus.

---

### D. Keamanan & Validasi 

1.  **Signature Verification (Meta):**
    Pada endpoint POST webhook, Meta mengirim header `x-hub-signature-256`. Validasi signature untuk memastikan permintaan datang dari server Meta dan bukan dari pihak lain.
    ```javascript
    const crypto = require('crypto');

    app.post('/api/whatsapp/webhook', express.raw({type: 'application/json'}), (req, res) => {
      const signature = req.headers['x-hub-signature-256'];
      const expectedSignature = 'sha256=' + crypto
        .createHmac('sha256', process.env.WHATSAPP_APP_SECRET)
        .update(req.body)
        .digest('hex');

      if (signature !== expectedSignature) {
        return res.sendStatus(403);
      }

      const payload = JSON.parse(req.body);
      // Lanjutkan proses payload...
    });
    ```

2.  **HTTPS Wajib:**
    Webhook endpoint tidak akan bisa diverifikasi atau menerima data jika tidak HTTPS. Jika sedang development lokal, gunakan tunneling seperti **ngrok**:
    *   Install ngrok `npm i -g ngrok`
    *   Jalankan `ngrok http 3000`
    *   Copy HTTPS URL dari ngrok sebagai Callback URL.

3.  **Validasi Nomor HP:**
    Pastikan semua nomor yang disimpan di tabel `teachers` dengan kolom `no_wa` sudah dalam format internasional yang benar (tanpa `0` di depan, dengan kode negara `62`, tanpa `+`). Contoh: `0812xxxx` -> `62812xxxx`)

---

## 3. Langkah Verifikasi Awal (Localhost / ngrok)

1.  Jalankan aplikasi backend.
2.  Jalankan `ngrok http 3000` di terminal terpisah.
3.  Copy URL ngrok (misal: `https://abc1-23-45-67-89.ngrok-free.app`).
4.  Buka Meta Dashboard > WhatsApp > Configuration > Webhook.
5.  Masukkan:
    *   **Callback URL:** `https://abc1-23-45-67-89.ngrok-free.app/api/whatsapp/webhook`
    *   **Verify Token:** `ypwi_webhook_secret_2026` (sesuaikan dengan .env)
6.  Klik "Verify and Save".
7.  Jika berhasil, Meta akan mengirimkan GET request (verifikasi). Setelah terverifikasi, pilih field `messages` dan `message_status` untuk disubscribe.
8.  Jika berhasil, status webhook akan menjadi "Complete".

---

## 4. Roadmap Implementasi (Saran)

| Tahap | Deskripsi |
|-------|-----------|
| **1. Persiapan Meta** | Buat Business App, daftar nomor, approv template dasar. |
| **2. Persiapan Server** | Update `.env`, update `server.js` dengan endpoint verifikasi dan listener, implementasi signature check. |
| **3. Uji Coba Webhook** | Gunakan ngrok untuk uji verifikasi dan coba kirim template pertama. |
| **4. Migrasi Sistem Notif** | Ganti fungsi kirim WA untuk menggunakan Meta Graph API (modifikasi `sendWhatsAppMessage` atau buat fungsi baru). |
| **5. Fitur Two-Way** | Jika ingin menerima balasan dari user, implementasikan logika di listener POST untuk menangani pesan masuk (contoh: balasan OTP, "STOP" untuk berhenti menerima). |
| **6. Deployment** | Deploy server ke domain HTTPS (VPS/Render/etc), update Callback URL di Meta, monitoring. |

---

## 5. Catatan Penting

*   **Template Approval:** Semua pesan pengirimian di luar *session* 24 jam harus menggunakan template yang sudah disetujui Meta. Proses approval bisa memakan waktu 1-3 hari kerja.
*   **Kebijakan Meta:** Meta memiliki kebijakan ketat tentang konten pesan. Hindari konten spam, penipuan, atau melanggar aturan komunitas.
*   **Biaya:** Biaya per pesan tergantung negara tujuan. Cek [WhatsApp Business Pricing](https://developers.facebook.com/docs/whatsapp/pricing).
*   **Penggantian Whacenter:** Jika saat ini menggunakan Whacenter (unofficial API), perencanaan ini adalah untuk transisi ke Meta WA API yang resmi. Jika Anda tetap ingin menggunakan Whacenter untuk pengiriman pesan, webhook dari Meta bisa digunakan *sendiri-sendiri* (misal hanya untuk menerima balasan user), tetapi pengiriman (outbound) tetap via Whacenter. Namun, Meta webhook biasanya cocok untuk sistem yang menggunakan Meta API sebagai gantinya.

---

## 6. Referensi

*   [Meta WhatsApp Business Platform](https://developers.facebook.com/docs/whatsapp)
*   [Webhooks Reference](https://developers.facebook.com/docs/graph-api/webhooks/getting-started)
*   [Sending Template Messages](https://developers.facebook.com/docs/whatsapp/cloud-api/messages/template-messages)
*   [WhatsApp Webhook Setup](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started#set-up-a-webhook)

---

## 7. Tabel Database WhatsApp Logs (Opsional)

```sql
CREATE TABLE IF NOT EXISTS whatsapp_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nomor_tujuan VARCHAR(20) NOT NULL,
    template_pesan VARCHAR(50),
    pesan TEXT,
    jenis_pesan ENUM('template', 'text', 'flash') DEFAULT 'template',
    status_pengiriman ENUM('sent', 'delivered', 'read', 'failed', 'pending') DEFAULT 'pending',
    message_id VARCHAR(255),
    error_message TEXT,
    id_guru INT,
    id_tenant INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (id_guru) REFERENCES teachers(id),
    FOREIGN KEY (id_tenant) REFERENCES tenants(tenant_id)
);

CREATE INDEX idx_whatsapp_logs_status ON whatsapp_logs(status_pengiriman);
CREATE INDEX idx_whatsapp_logs_created_at ON whatsapp_logs(created_at);
```

---

_Dokumen ini dibuat sebagai panduan awal untuk setup webhook WhatsApp di Facebook Developer Console. Selanjutnya, ikuti langkah persiapan Meta, konfigurasi server, dan testing._
