# Waha WhatsApp Integration

## Setup Waha Server

1. **Install Docker** di server
2. **Copy file docker-compose.waha.yml** ke root project
3. **Jalankan:**
   ```bash
   docker-compose -f docker-compose.waha.yml up -d
   ```

4. **Akses UI:** http://localhost:3001
5. **API Endpoint:** http://localhost:3001

## Integrasi dengan YPWI Webapp

Tambahkan di `.env`:
```
WAHA_API_URL=http://localhost:3001
WAHA_JWT_SECRET=waha-secret-key-anda
```

## API Endpoints Waha

### Send Message
```http
POST /message/sendText/DEFAULT
{
  "number": "6281234567890",
  "text": "Pesan dari tim"
}
```

### Get Chats
```http
GET /chat/find/<number>
Authorization: Bearer <JWT_TOKEN>
```

## Webhook untuk Pesan Masuk

Daftarkan di Waha:
- URL: `https://domain-anda.com/api/webhook/waha`
- Events: `messages`, `message-update`

## Team Collaboration Features

1. **Multi-session:** Setiap team member bisa punya session terpisah
2. **Web UI:** Akses via browser untuk chat manual
3. **Broadcast:** Kirim ke grup orang tua
4. **Auto-reply:** Atur reply otomatis untuk FAQ

## Webhook Handler (Optional)

Tambahkan di server.js untuk menerima pesan masuk:
```javascript
app.post('/api/webhook/waha', express.json(), (req, res) => {
  // Process incoming messages
});
```