-- ============================================================
-- KAFALAH: Ensure level column + add override_note for audit
-- Idempotent: uses information_schema guards
-- ============================================================

DROP PROCEDURE IF EXISTS _add_col_if_missing;
DROP PROCEDURE IF EXISTS _add_table_if_missing;
DELIMITER $$
CREATE PROCEDURE _add_col_if_missing(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND COLUMN_NAME = p_column
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE _add_table_if_missing(
  IN p_table VARCHAR(64),
  IN p_create_sql TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
  ) THEN
    SET @ddl = p_create_sql;
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

-- ============================================================
-- 1. kafalah_settings: ensure level column exists
-- ============================================================
CALL _add_col_if_missing('kafalah_settings', 'level', "ENUM('global','school') DEFAULT 'global' AFTER tenant_id");

-- ============================================================
-- 2. kafalah_payroll: add override_note for audit trail
-- ============================================================
CALL _add_col_if_missing('kafalah_payroll', 'override_note', 'TEXT DEFAULT NULL COMMENT \'JSON/notes: which components used custom override\' AFTER base_mode_used');

-- ============================================================
-- 3. Seed default level for existing schools
-- ============================================================
UPDATE `kafalah_settings` SET `level` = 'global' WHERE `level` IS NULL;

-- ============================================================
-- 4. Add index for level column
-- ============================================================
SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kafalah_settings' AND INDEX_NAME = 'idx_level');
SET @sql = IF(@idx_exists = 0,
  'ALTER TABLE `kafalah_settings` ADD INDEX `idx_level` (`level`)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================
-- Cleanup procedures
-- ============================================================
DROP PROCEDURE IF EXISTS _add_col_if_missing;
DROP PROCEDURE IF EXISTS _add_table_if_missing;