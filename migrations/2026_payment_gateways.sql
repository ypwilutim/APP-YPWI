-- Multi-gateway payment system (Midtrans, Xendit, DOKU, manual BSI)
-- Tabel terpusat untuk konfigurasi gateway per tenant
CREATE TABLE IF NOT EXISTS payment_gateways (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(20) NOT NULL,
  gateway VARCHAR(20) NOT NULL, -- 'midtrans', 'xendit', 'doku', 'bsi_manual', dst
  api_key VARCHAR(255),
  api_secret VARCHAR(255),
  client_key VARCHAR(255), -- untuk Snap/DOKU
  is_active TINYINT(1) DEFAULT 0,
  config JSON, -- settings tambahan per gateway
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_gateway_per_tenant (tenant_id, gateway)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tabel transaksi terpusat semua gateway
CREATE TABLE IF NOT EXISTS payment_transactions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(20) NOT NULL,
  student_id INT,
  gateway VARCHAR(20) NOT NULL, -- 'midtrans', 'xendit', 'doku', 'bsi_manual'
  external_id VARCHAR(100), -- order_id / va_number / transaction_id
  amount DECIMAL(12,2),
  status VARCHAR(20), -- 'pending', 'paid', 'expired', 'failed', 'cancelled'
  payment_method VARCHAR(50), -- 'va', 'qris', 'ewallet', 'manual', dst
  description TEXT,
  metadata JSON, -- simpan raw response, biller_code, dll
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  paid_at TIMESTAMP NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tenant_gateway (tenant_id, gateway),
  INDEX idx_external (external_id),
  INDEX idx_student (student_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;