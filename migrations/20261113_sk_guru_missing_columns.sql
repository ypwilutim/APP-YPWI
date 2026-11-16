-- Migration: Ensure sk_guru has all required columns (hosting may be missing some)
-- Migration ini aman dijalankan berulang kali (IF NOT EXISTS)

ALTER TABLE `sk_guru` ADD COLUMN IF NOT EXISTS `jabatan` VARCHAR(100) DEFAULT NULL AFTER `bm`;
ALTER TABLE `sk_guru` ADD COLUMN IF NOT EXISTS `status` VARCHAR(20) DEFAULT NULL AFTER `jabatan`;
ALTER TABLE `sk_guru` ADD COLUMN IF NOT EXISTS `tentag_type` VARCHAR(50) DEFAULT NULL AFTER `status`;
ALTER TABLE `sk_guru` ADD COLUMN IF NOT EXISTS `manual_verified` TINYINT(1) NOT NULL DEFAULT 0 AFTER `tentag_type`;
ALTER TABLE `sk_guru` ADD COLUMN IF NOT EXISTS `drive_file_id` VARCHAR(255) DEFAULT NULL AFTER `manual_verified`;
ALTER TABLE `sk_guru` ADD COLUMN IF NOT EXISTS `drive_file_name` VARCHAR(255) DEFAULT NULL AFTER `drive_file_id`;
ALTER TABLE `sk_guru` ADD COLUMN IF NOT EXISTS `drive_folder_id` VARCHAR(255) DEFAULT NULL AFTER `drive_file_name`;
ALTER TABLE `sk_guru` ADD COLUMN IF NOT EXISTS `drive_web_view_link` VARCHAR(500) DEFAULT NULL AFTER `drive_folder_id`;
ALTER TABLE `sk_guru` ADD COLUMN IF NOT EXISTS `drive_uploaded_at` DATETIME DEFAULT NULL AFTER `drive_web_view_link`;