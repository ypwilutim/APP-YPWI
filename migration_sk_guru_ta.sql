-- ============================================================
-- Migration: Add tahun_ajaran_id to sk_guru table
-- ============================================================

-- Add tahun_ajaran_id column
SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sk_guru' AND COLUMN_NAME = 'tahun_ajaran_id');
SET @sql := IF(@col_exists = 0, 
  'ALTER TABLE `sk_guru` ADD COLUMN `tahun_ajaran_id` int(11) DEFAULT NULL COMMENT "FK ke tahun_ajaran" AFTER `tenant_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add index for tahun_ajaran_id
SET @idx_exists := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sk_guru' AND INDEX_NAME = 'idx_sk_ta');
SET @sql_idx := IF(@idx_exists = 0, 
  'ALTER TABLE `sk_guru` ADD KEY `idx_sk_ta` (`tahun_ajaran_id`)',
  'SELECT 1'
);
PREPARE stmt_idx FROM @sql_idx;
EXECUTE stmt_idx;
DEALLOCATE PREPARE stmt_idx;

-- Add foreign key constraint
SET @fk_exists := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sk_guru' AND CONSTRAINT_NAME = 'fk_sk_ta');
SET @sql_fk := IF(@fk_exists = 0,
  'ALTER TABLE `sk_guru` ADD CONSTRAINT `fk_sk_ta` FOREIGN KEY (`tahun_ajaran_id`) REFERENCES `tahun_ajaran` (`id`) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt_fk FROM @sql_fk;
EXECUTE stmt_fk;
DEALLOCATE PREPARE stmt_fk;

-- ============================================================
-- Backfill existing sk_guru records to current active TA
-- ============================================================
UPDATE `sk_guru` sk
JOIN `tahun_ajaran` ta ON (ta.tenant_id IS NULL OR ta.tenant_id = sk.tenant_id) AND ta.is_active = 1
SET sk.tahun_ajaran_id = ta.id
WHERE sk.tahun_ajaran_id IS NULL;

-- ============================================================
-- Default active SK to current TA (if not already set)
-- ============================================================
UPDATE `sk_guru`
JOIN `tahun_ajaran` ta ON (ta.tenant_id IS NULL OR ta.tenant_id = sk_guru.tenant_id) AND ta.is_active = 1
SET sk_guru.tahun_ajaran_id = ta.id
WHERE sk_guru.tahun_ajaran_id IS NULL AND sk_guru.tentag_type = 'baru';