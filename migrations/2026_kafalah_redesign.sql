-- ============================================================
-- KAFALAH REDESIGN MIGRATION
-- Add: kafalah_gaji_pokok_config, kafalah_base_mode, flags
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
-- 1. kafalah_settings: add level column
-- ============================================================
CALL _add_col_if_missing('kafalah_settings', 'level', "ENUM('global','school') DEFAULT 'global' AFTER tenant_id");

-- ============================================================
-- 2. kafalah_gaji_pokok_config (NEW TABLE)
-- ============================================================
CALL _add_table_if_missing('kafalah_gaji_pokok_config', '
  CREATE TABLE IF NOT EXISTS `kafalah_gaji_pokok_config` (
    `id` INT(11) NOT NULL AUTO_INCREMENT,
    `tenant_id` VARCHAR(50) DEFAULT NULL,
    `status_pegawai` ENUM(''PT'',''PK'') NOT NULL,
    `jenjang` ENUM(''TK'',''SD'',''SMP'',''SMA'',''PONPES'') NOT NULL,
    `pendidikan` ENUM(''SMA'',''D3'',''S1'',''S2'',''S3'') NOT NULL,
    `gaji_pokok_base` DECIMAL(12,2) NOT NULL DEFAULT 0,
    `kenaikan_per_tahun` DECIMAL(12,2) NOT NULL DEFAULT 0,
    `interval_tahun` INT(11) NOT NULL DEFAULT 2,
    `masa_kerja_max` INT(11) NOT NULL DEFAULT 30,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uniq_config` (`tenant_id`, `status_pegawai`, `jenjang`, `pendidikan`),
    KEY `idx_tenant` (`tenant_id`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
');

-- ============================================================
-- 3. kafalah_base_mode (NEW TABLE)
-- ============================================================
CALL _add_table_if_missing('kafalah_base_mode', '
  CREATE TABLE IF NOT EXISTS `kafalah_base_mode` (
    `id` INT(11) NOT NULL AUTO_INCREMENT,
    `user_id` INT(11) NOT NULL,
    `tenant_id` VARCHAR(50) DEFAULT NULL,
    `base_mode` ENUM(''global'',''school'') NOT NULL DEFAULT ''global'',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uniq_user_tenant` (`user_id`, `tenant_id`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
');

-- ============================================================
-- 4. kafalah_payroll: add is_manual_edit & base_mode_used flags
-- ============================================================
CALL _add_col_if_missing('kafalah_payroll', 'is_manual_edit', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER updated_at');
CALL _add_col_if_missing('kafalah_payroll', 'base_mode_used', "ENUM('global','school') DEFAULT NULL AFTER is_manual_edit");

-- ============================================================
-- 5. Seed default gaji pokok from existing kenaikan_config
-- ============================================================
INSERT IGNORE INTO kafalah_gaji_pokok_config (tenant_id, status_pegawai, jenjang, pendidikan, gaji_pokok_base, kenaikan_per_tahun, interval_tahun, masa_kerja_max)
SELECT NULL, status_pegawai, jenjang, pendidikan, gaji_awal, kenaikan_per_tahun, interval_tahun, masa_kerja_max
FROM kafalah_kenaikan_config;

-- ============================================================
-- 6. Seed default base_mode for existing bendahara users
-- ============================================================
INSERT IGNORE INTO kafalah_base_mode (user_id, tenant_id, base_mode)
SELECT u.id, NULL, 'global'
FROM users u
WHERE u.role IN ('admin','bendahara');

-- ============================================================
-- Cleanup procedures
-- ============================================================
DROP PROCEDURE IF EXISTS _add_col_if_missing;
DROP PROCEDURE IF EXISTS _add_table_if_missing;