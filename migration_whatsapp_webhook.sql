-- ==========================================
-- WhatsApp Webhook Tables
-- Tabel untuk log webhook dari WhatsApp Cloud API (Meta)
-- ==========================================

-- Tabel untuk log semua event webhook
CREATE TABLE IF NOT EXISTS whatsapp_webhook_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  phone_number_id VARCHAR(50) DEFAULT NULL,
  event_type VARCHAR(50) DEFAULT NULL,
  payload TEXT,
  received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_phone (phone_number_id),
  INDEX idx_event (event_type),
  INDEX idx_date (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabel untuk inbox pesan masuk dari orang tua
CREATE TABLE IF NOT EXISTS whatsapp_inbox (
  id INT AUTO_INCREMENT PRIMARY KEY,
  phone_number_id VARCHAR(50) DEFAULT NULL,
  from_number VARCHAR(50) NOT NULL,
  contact_name VARCHAR(255) DEFAULT NULL,
  message_type VARCHAR(50) DEFAULT NULL,
  message_body TEXT,
  message_id VARCHAR(255) DEFAULT NULL,
  student_id INT DEFAULT NULL,
  tenant_id VARCHAR(50) DEFAULT NULL,
  is_read TINYINT(1) DEFAULT 0,
  received_at DATETIME DEFAULT NULL,
  INDEX idx_from (from_number),
  INDEX idx_student (student_id),
  INDEX idx_tenant (tenant_id),
  INDEX idx_date (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabel untuk tracking status pesan (sent/delivered/read/failed)
CREATE TABLE IF NOT EXISTS whatsapp_message_status (
  id INT AUTO_INCREMENT PRIMARY KEY,
  message_id VARCHAR(255) NOT NULL,
  recipient_id VARCHAR(50) DEFAULT NULL,
  status VARCHAR(20) NOT NULL,
  error_code INT DEFAULT NULL,
  error_message VARCHAR(500) DEFAULT NULL,
  updated_at DATETIME DEFAULT NULL,
  UNIQUE KEY uniq_msg (message_id),
  INDEX idx_status (status),
  INDEX idx_recipient (recipient_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabel untuk konfigurasi WhatsApp Business API per tenant
CREATE TABLE IF NOT EXISTS whatsapp_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  phone_number_id VARCHAR(50) NOT NULL,
  business_id VARCHAR(50) DEFAULT NULL,
  access_token TEXT,
  webhook_url VARCHAR(500) DEFAULT NULL,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_phone (phone_number_id),
  INDEX idx_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
