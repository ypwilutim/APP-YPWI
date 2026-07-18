-- Migration for Billing System Tables
-- Run this on hosting database

-- incoming_payments: raw BSI mutation report
CREATE TABLE IF NOT EXISTS incoming_payments (
  id BIGINT(20) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  transaction_id VARCHAR(100) DEFAULT NULL,
  source_account VARCHAR(150) DEFAULT NULL,
  beneficiary_account VARCHAR(150) DEFAULT NULL,
  billing_number VARCHAR(100) DEFAULT NULL,
  source_additional_1 VARCHAR(255) DEFAULT NULL,
  source_additional_2 VARCHAR(255) DEFAULT NULL,
  source_additional_3 VARCHAR(255) DEFAULT NULL,
  source_additional_4 VARCHAR(255) DEFAULT NULL,
  source_additional_5 VARCHAR(255) DEFAULT NULL,
  source_additional_6 VARCHAR(255) DEFAULT NULL,
  source_additional_7 VARCHAR(255) DEFAULT NULL,
  source_additional_8 VARCHAR(255) DEFAULT NULL,
  source_additional_9 VARCHAR(255) DEFAULT NULL,
  beneficiary_additional_1 VARCHAR(255) DEFAULT NULL,
  beneficiary_additional_2 VARCHAR(255) DEFAULT NULL,
  beneficiary_additional_3 VARCHAR(255) DEFAULT NULL,
  beneficiary_additional_4 VARCHAR(255) DEFAULT NULL,
  beneficiary_additional_5 VARCHAR(255) DEFAULT NULL,
  beneficiary_additional_6 VARCHAR(255) DEFAULT NULL,
  beneficiary_additional_7 VARCHAR(255) DEFAULT NULL,
  beneficiary_additional_8 VARCHAR(255) DEFAULT NULL,
  beneficiary_additional_9 VARCHAR(255) DEFAULT NULL,
  remarks TEXT,
  transaction_date_time VARCHAR(50) DEFAULT NULL,
  transaction_datetime DATETIME DEFAULT NULL,
  total_amount DECIMAL(12,2) DEFAULT 0,
  channel VARCHAR(50) DEFAULT NULL,
  transfer_type VARCHAR(20) DEFAULT NULL,
  status VARCHAR(20) DEFAULT NULL,
  matched_student_id INT(11) DEFAULT NULL,
  periode VARCHAR(7) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_benef (beneficiary_account),
  KEY idx_matched (matched_student_id),
  KEY idx_periode (periode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- billing_payment: tagihan per siswa per bulan
CREATE TABLE IF NOT EXISTS billing_payment (
  id BIGINT(20) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(20) DEFAULT NULL,
  student_id INT(11) NOT NULL,
  spp_bulanan DECIMAL(12,2) DEFAULT 0,
  bulan VARCHAR(7) NOT NULL,
  transaksi DECIMAL(12,2) DEFAULT 0,
  keterangan_spp DECIMAL(12,2) DEFAULT 0,
  status ENUM('lunas','belum') DEFAULT 'belum',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_student_bulan (student_id, bulan),
  KEY idx_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- saldo_siswa: saldo berjalan (- tunggakan, + kelebihan)
CREATE TABLE IF NOT EXISTS saldo_siswa (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id INT(11) NOT NULL,
  tenant_id VARCHAR(20) DEFAULT NULL,
  saldo DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '- = tunggakan, + = kelebihan',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_student (student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tambah kolom tanggal_masuk di students (ignore error if exists)
ALTER TABLE students ADD COLUMN tanggal_masuk VARCHAR(7) DEFAULT NULL;