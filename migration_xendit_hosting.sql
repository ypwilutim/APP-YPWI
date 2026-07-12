-- Xendit migration for hosting database
-- Add Xendit columns to tenants table
ALTER TABLE tenants 
ADD COLUMN xendit_api_key VARCHAR(255) DEFAULT NULL,
ADD COLUMN xendit_public_key VARCHAR(255) DEFAULT NULL,
ADD COLUMN xendit_webhook_token VARCHAR(255) DEFAULT NULL,
ADD COLUMN xendit_enabled TINYINT(1) DEFAULT 0;

-- Create xendit_invoices table
CREATE TABLE IF NOT EXISTS xendit_invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(20) NOT NULL,
  student_id INT NOT NULL,
  xendit_invoice_id VARCHAR(100) NOT NULL,
  external_id VARCHAR(255) NOT NULL,
  amount DECIMAL(10,2) DEFAULT 0,
  description TEXT,
  status VARCHAR(50) DEFAULT 'PENDING',
  payment_method VARCHAR(50) DEFAULT 'MULTIPLE',
  callback_url TEXT,
  invoice_url TEXT,
  expiry_date DATETIME,
  paid_at DATETIME,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tenant_id (tenant_id),
  INDEX idx_student_id (student_id),
  INDEX idx_external_id (external_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;