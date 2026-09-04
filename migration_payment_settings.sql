-- =====================================================
-- MIGRATION: Tabel Pengaturan Pembayaran (Global - Berlaku Semua)
-- =====================================================
-- Tabel ini menyimpan biaya admin VA BSI secara global
-- (satu baris dengan subject_type='global', subject_id=0)
-- Berlaku untuk semua siswa & guru yang memiliki VA BSI
-- Default biaya admin = 2000 (Rp 2.000)
-- =====================================================

-- Update subject_type ENUM untuk include 'global'
-- Note: untuk MySQL, ALTER TABLE MODIFY COLUMN diperlukan

CREATE TABLE IF NOT EXISTS payment_admin_settings (
  id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  subject_type VARCHAR(20) NOT NULL,
  subject_id INT(11) NOT NULL,
  tenant_id VARCHAR(20) DEFAULT NULL,
  biaya_admin_va DECIMAL(12,2) NOT NULL DEFAULT 2000.00 COMMENT 'Biaya admin VA BSI per transaksi',
  keterangan TEXT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_subject (subject_type, subject_id),
  KEY idx_tenant (tenant_id),
  KEY idx_subject (subject_type, subject_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default GLOBAL setting (berlaku untuk semua siswa & guru)
INSERT IGNORE INTO payment_admin_settings (subject_type, subject_id, biaya_admin_va, keterangan)
VALUES ('global', 0, 2000.00, 'Default biaya admin VA BSI - berlaku untuk semua siswa & guru');
