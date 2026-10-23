-- Migration: Add missing KAFALAH settings columns matching user-provided items.
-- Idempotent: safe to run repeatedly on MySQL and MariaDB (guards every ADD
-- with information_schema, so it does not rely on `ADD COLUMN IF NOT EXISTS`
-- which is MariaDB-only).

DROP PROCEDURE IF EXISTS _add_col_if_missing;
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
DELIMITER ;

CALL _add_col_if_missing('kafalah_settings', 'tunj_struktural',      'DECIMAL(12,2) NOT NULL DEFAULT 0.00');
CALL _add_col_if_missing('kafalah_settings', 'tunj_uang_makan',      'DECIMAL(12,2) NOT NULL DEFAULT 0.00');
CALL _add_col_if_missing('kafalah_settings', 'tunj_apresiasi',       'DECIMAL(12,2) NOT NULL DEFAULT 0.00');
CALL _add_col_if_missing('kafalah_settings', 'tunj_jam_mengajar',    'DECIMAL(12,2) NOT NULL DEFAULT 0.00');
CALL _add_col_if_missing('kafalah_settings', 'pot_luar_tanggungan',  'DECIMAL(12,2) NOT NULL DEFAULT 0.00');
CALL _add_col_if_missing('kafalah_settings', 'pot_durasi_simt',      'DECIMAL(12,2) NOT NULL DEFAULT 0.00');
CALL _add_col_if_missing('kafalah_settings', 'pot_taawun',           'DECIMAL(12,2) NOT NULL DEFAULT 0.00');
CALL _add_col_if_missing('kafalah_settings', 'pot_piutang',          'DECIMAL(12,2) NOT NULL DEFAULT 0.00');

DROP PROCEDURE IF EXISTS _add_col_if_missing;
