-- ============================================================
-- MIGRATION: Add use_global column to kafalah_settings
-- Replaces level-based logic with per-tenant global toggle
-- ============================================================

-- 1. Add use_global column (boolean flag)
ALTER TABLE `kafalah_settings` 
ADD COLUMN `use_global` TINYINT(1) NOT NULL DEFAULT 0 
COMMENT '1 = use global settings, 0 = use own settings'
AFTER `level`;

-- 2. Migrate existing data: level='global' -> use_global=1, else 0
UPDATE `kafalah_settings` 
SET `use_global` = CASE WHEN `level` = 'global' THEN 1 ELSE 0 END;

-- 3. Ensure every tenant has a settings row (create missing ones from global defaults)
INSERT IGNORE INTO `kafalah_settings` (`tenant_id`, `use_global`)
SELECT DISTINCT `tenant_id`, 0 
FROM `tenants` 
WHERE `tenant_id` NOT IN (
    SELECT `tenant_id` FROM `kafalah_settings` WHERE `tenant_id` IS NOT NULL
);

-- 4. Add index for performance
ALTER TABLE `kafalah_settings` ADD INDEX `idx_use_global` (`use_global`);

-- 5. Optional: Keep level column for backward compatibility (can be dropped later)
-- ALTER TABLE `kafalah_settings` DROP COLUMN `level`;
