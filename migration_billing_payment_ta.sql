-- ============================================================
-- Migration: Add tahun_ajaran_id + semester_id to billing_payment
-- billing_payment adalah tabel transaksional BSI (dibuat di
-- runtime oleh ensureBillingTables). Kolom TA/semester tidak
-- ditambahkan di migration_add_ta_all_tables.sql karena tabel
-- tersebut dibuat secara dinamis, bukan dari full_structure.sql.
-- Migrasi ini aman dijalankan berulang (IF NOT EXISTS via
-- prepared statement) dan juga dipanggil oleh ensureColumn di
-- runtime sebagai fallback.
-- ============================================================

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_payment' AND COLUMN_NAME = 'tahun_ajaran_id');
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `billing_payment` ADD COLUMN `tahun_ajaran_id` INT(11) DEFAULT NULL AFTER `student_id`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_payment' AND COLUMN_NAME = 'semester_id');
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `billing_payment` ADD COLUMN `semester_id` INT(11) DEFAULT NULL AFTER `tahun_ajaran_id`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_payment' AND INDEX_NAME = 'idx_ta');
SET @sql := IF(@idx_exists = 0,
  'ALTER TABLE `billing_payment` ADD KEY `idx_ta` (`tahun_ajaran_id`)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_payment' AND INDEX_NAME = 'idx_semester');
SET @sql := IF(@idx_exists = 0,
  'ALTER TABLE `billing_payment` ADD KEY `idx_semester` (`semester_id`)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;