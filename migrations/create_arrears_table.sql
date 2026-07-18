CREATE TABLE IF NOT EXISTS arrears (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(20) NOT NULL,
  student_id INT NOT NULL,
  amount INT DEFAULT 0,
  month_year VARCHAR(7),
  status ENUM('paid','unpaid') DEFAULT 'unpaid',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tenant (tenant_id),
  INDEX idx_student (student_id)
);