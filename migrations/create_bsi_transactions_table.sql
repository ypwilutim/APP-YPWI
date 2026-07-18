CREATE TABLE IF NOT EXISTS payment_bsi_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(20),
  transaction_id VARCHAR(50),
  source_va VARCHAR(50),
  beneficiary_va VARCHAR(50),
  amount INT DEFAULT 0,
  status VARCHAR(20) DEFAULT 'Success',
  transaction_date DATETIME,
  remarks TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tenant (tenant_id),
  INDEX idx_beneficiary (beneficiary_va)
);