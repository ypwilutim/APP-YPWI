-- Migration: salary_settings table for unified payroll hierarchy
-- Supports 3-tier override: central (YPWILUTIM), school (tenant), individual (teacher)
CREATE TABLE IF NOT EXISTS salary_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  level ENUM('central', 'school', 'individual') NOT NULL,
  tenant_id VARCHAR(20) NOT NULL COMMENT 'YPWILUTIM for central, specific tenant for school/individual',
  teacher_id INT DEFAULT NULL COMMENT 'Only for individual level',
  setting_name VARCHAR(50) NOT NULL COMMENT 'Component name: kafalah_pokok, tunj_keluarga, etc.',
  setting_value DECIMAL(14,2) NOT NULL DEFAULT 0,
  is_override TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 if this overrides parent level',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_setting (level, tenant_id, teacher_id, setting_name),
  INDEX idx_level (level),
  INDEX idx_tenant (tenant_id),
  INDEX idx_teacher (teacher_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SPMB transactions table for tracking income/expense
CREATE TABLE IF NOT EXISTS spmb_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(20) NOT NULL,
  transaction_type ENUM('income', 'expense') NOT NULL,
  category VARCHAR(100) NOT NULL COMMENT 'pendaftaran, buku, seragam, dll',
  amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  description TEXT DEFAULT NULL,
  transaction_date DATE NOT NULL,
  created_by INT DEFAULT NULL COMMENT 'teacher_id of who recorded',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tenant (tenant_id),
  INDEX idx_type (transaction_type),
  INDEX idx_date (transaction_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;