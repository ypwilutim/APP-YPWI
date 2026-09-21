-- ============================================================
-- Migration: Add tgl_mulai and tgl_selesai to sk_guru table
-- ============================================================

-- Add tgl_mulai column
SET @col_exists_mulai := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sk_guru' AND COLUMN_NAME = 'tgl_mulai');
SET @sql_mulai := IF(@col_exists_mulai = 0, 
  'ALTER TABLE `sk_guru` ADD COLUMN `tgl_mulai` VARCHAR(50) DEFAULT NULL COMMENT "Tanggal mulai penunjukan guru" AFTER `bm`',
  'SELECT 1'
);
PREPARE stmt_mulai FROM @sql_mulai;
EXECUTE stmt_mulai;
DEALLOCATE PREPARE stmt_mulai;

-- Add tgl_selesai column
SET @col_exists_selesai := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sk_guru' AND COLUMN_NAME = 'tgl_selesai');
SET @sql_selesai := IF(@col_exists_selesai = 0, 
  'ALTER TABLE `sk_guru` ADD COLUMN `tgl_selesai` VARCHAR(50) DEFAULT NULL COMMENT "Tanggal selesai penunjukan guru" AFTER `tgl_mulai`',
  'SELECT 1'
);
PREPARE stmt_selesai FROM @sql_selesai;
EXECUTE stmt_selesai;
DEALLOCATE PREPARE stmt_selesai;

-- ============================================================
-- Backfill existing sk_guru records with calculated dates
-- ============================================================
UPDATE `sk_guru` 
SET tgl_mulai = bh, tgl_selesai = bm 
WHERE tgl_mulai IS NULL AND bh IS NOT NULL AND bm IS NOT NULL;