# Fitur WhatsApp Inbound - Chat Orangtua

## Akses di Admin Dashboard

Untuk melihat chat dari orangtua, akses melalui:

1. **Halaman terpisah**: `admin-whatsapp-inbound.html`
   - File: `public/admin-whatsapp-inbound.html`

2. **Atau tambahkan menu di sidebar admin-dashboard.html**:
   Cari baris ini (sekitar baris 165):
   ```html
   <span>WhatsApp Messenger</span>
   ```
   Tambahkan setelahnya:
   ```html
   <button onclick="location.href='admin-whatsapp-inbound.html'"
     class="nav-item w-full text-left flex items-center space-x-3 px-4 py-3 rounded-lg text-gray-600 hover:bg-gray-100">
     <i class="fas fa-inbox"></i>
     <span>Chat Orangtua</span>
   </button>
   ```

## API Endpoints (Admin Only)

- `GET /api/whatsapp/inbound/conversations` - List percakapan
- `GET /api/whatsapp/inbound/conversations/:phone/messages` - Pesan per kontak
- `POST /api/whatsapp/inbound/send` - Kirim balasan

## Migrasi Database

Jalankan `migrations/2026_whatsapp_inbound.sql` untuk membuat tabel:
```sql
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
    INDEX idx_from_phone (from_phone),
    INDEX idx_created_at (created_at),
    INDEX idx_status (status),
    INDEX idx_parent (parent_id)
);
```