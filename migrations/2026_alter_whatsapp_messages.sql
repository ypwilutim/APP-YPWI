-- Script untuk update tabel whatsapp_messages yang sudah ada
-- Jalankan via MySQL CLI: mysql -u [user] -p [database] < file.sql

-- Tambah kolom baru jika belum ada
ALTER TABLE whatsapp_messages ADD COLUMN phone_number VARCHAR(20) DEFAULT NULL;
ALTER TABLE whatsapp_messages ADD COLUMN contact_name VARCHAR(100) DEFAULT NULL;
ALTER TABLE whatsapp_messages ADD COLUMN contact_photo_url TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN direction ENUM('outgoing', 'incoming') DEFAULT 'incoming';

-- Copy data lama ke kolom baru
UPDATE whatsapp_messages SET phone_number = from_phone WHERE phone_number IS NULL AND from_phone IS NOT NULL;
UPDATE whatsapp_messages SET contact_name = profile_name WHERE contact_name IS NULL AND profile_name IS NOT NULL;

-- Update status lama ke format baru
UPDATE whatsapp_messages SET status = 'received' WHERE status = 'received';

-- Drop kolom lama (opsional, setelah yakin data sudah tercopy)
-- ALTER TABLE whatsapp_messages DROP COLUMN from_phone;
-- ALTER TABLE whatsapp_messages DROP COLUMN profile_name;

-- Buat index
ALTER TABLE whatsapp_messages ADD INDEX idx_phone (phone_number);
ALTER TABLE whatsapp_messages ADD INDEX idx_direction (direction);