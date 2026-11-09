-- Migration: Google Drive archive metadata for sk_guru
ALTER TABLE `sk_guru`
  ADD COLUMN `drive_file_id` VARCHAR(255) DEFAULT NULL AFTER `manual_verified`,
  ADD COLUMN `drive_file_name` VARCHAR(255) DEFAULT NULL AFTER `drive_file_id`,
  ADD COLUMN `drive_folder_id` VARCHAR(255) DEFAULT NULL AFTER `drive_file_name`,
  ADD COLUMN `drive_web_view_link` VARCHAR(500) DEFAULT NULL AFTER `drive_folder_id`,
  ADD COLUMN `drive_uploaded_at` DATETIME DEFAULT NULL AFTER `drive_web_view_link`;