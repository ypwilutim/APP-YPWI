-- Migration: Google Drive archive metadata for sk_guru
-- Catatan: kolom manual_verified, drive_file_id, dll sudah dijamin ada oleh migration 20261113_sk_guru_missing_columns.sql
ALTER TABLE `sk_guru`
  ADD COLUMN IF NOT EXISTS `drive_file_id` VARCHAR(255) DEFAULT NULL AFTER `manual_verified`,
  ADD COLUMN IF NOT EXISTS `drive_file_name` VARCHAR(255) DEFAULT NULL AFTER `drive_file_id`,
  ADD COLUMN IF NOT EXISTS `drive_folder_id` VARCHAR(255) DEFAULT NULL AFTER `drive_file_name`,
  ADD COLUMN IF NOT EXISTS `drive_web_view_link` VARCHAR(500) DEFAULT NULL AFTER `drive_folder_id`,
  ADD COLUMN IF NOT EXISTS `drive_uploaded_at` DATETIME DEFAULT NULL AFTER `drive_web_view_link`;