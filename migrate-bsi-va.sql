-- Migration: BSI VA Manual Integration
-- Created: 2026-07-16

-- Tabel payment_gateways untuk config payment gateway per tenant
CREATE TABLE IF NOT EXISTS payment_gateways (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(50),
  gateway VARCHAR(20) NOT NULL, -- 'xendit', 'midtrans', 'bsi_manual', 'doku'
  api_key VARCHAR(255),
  api_secret VARCHAR(255),
  client_key VARCHAR(255),
  is_active TINYINT(1) DEFAULT 1,
  config JSON, -- { "va_prefix": "2231" } untuk BSI
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_tenant_gateway (tenant_id, gateway)
);

-- Tabel payment_transactions untuk semua transaksi payment
CREATE TABLE IF NOT EXISTS payment_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(50),
  student_id INT,
  gateway VARCHAR(20), -- 'xendit', 'midtrans', 'bsi_manual'
  external_id VARCHAR(255), -- VA number atau order_id
  amount DECIMAL(12,2),
  status ENUM('pending','paid','failed','cancelled') DEFAULT 'pending',
  payment_method VARCHAR(50),
  description TEXT,
  metadata JSON, -- { student_name: "..." }
  paid_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tenant_gateway (tenant_id, gateway),
  INDEX idx_student_gateway (student_id, gateway),
  INDEX idx_external_id (external_id)
);

-- Tambah kolom va_number & va_name ke tabel students (jika belum ada)
-- ALTER TABLE students ADD COLUMN va_number VARCHAR(50) NULL, ADD COLUMN va_name VARCHAR(100) NULL;