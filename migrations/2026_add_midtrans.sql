-- Midtrans integration: tenant config columns + transactions table
ALTER TABLE tenants
  ADD COLUMN midtrans_server_key VARCHAR(255) NULL AFTER iuran_bulanan,
  ADD COLUMN midtrans_client_key VARCHAR(255) NULL AFTER midtrans_server_key,
  ADD COLUMN midtrans_enabled TINYINT(1) DEFAULT 0 AFTER midtrans_client_key,
  ADD COLUMN midtrans_is_production TINYINT(1) DEFAULT 0 AFTER midtrans_enabled;

CREATE TABLE IF NOT EXISTS midtrans_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(20),
  student_id INT,
  order_id VARCHAR(100) NOT NULL,
  gross_amount DECIMAL(12,2) DEFAULT 0,
  transaction_status VARCHAR(50),
  payment_type VARCHAR(50),
  status VARCHAR(30),
  snap_token VARCHAR(255),
  redirect_url VARCHAR(512),
  raw TEXT,
  paid_at DATETIME,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_order (order_id),
  INDEX idx_tenant (tenant_id),
  INDEX idx_student (student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
