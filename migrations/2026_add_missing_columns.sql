-- Tambah kolom yang diperlukan
ALTER TABLE whatsapp_messages ADD COLUMN media_url TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN media_filename VARCHAR(255);
ALTER TABLE whatsapp_messages ADD COLUMN contact_name VARCHAR(100) DEFAULT NULL;
ALTER TABLE whatsapp_messages ADD COLUMN contact_photo_url TEXT DEFAULT NULL;
ALTER TABLE whatsapp_messages ADD COLUMN direction ENUM('outgoing', 'incoming') DEFAULT 'incoming';
ALTER TABLE whatsapp_messages ADD COLUMN teacher_id INT DEFAULT NULL;

UPDATE whatsapp_messages SET contact_name = profile_name WHERE contact_name IS NULL;
UPDATE whatsapp_messages SET status = 'received' WHERE status IS NULL OR status = '';