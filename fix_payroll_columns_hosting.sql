-- Fix missing payroll columns in teachers table on hosting
-- Root cause: These columns exist in local DB but were never migrated to hosting
-- Application: src/routes/payroll.js - getPayrollData() selects these columns

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;

-- Add missing columns to teachers table
ALTER TABLE `teachers` ADD COLUMN IF NOT EXISTS `pending_password_hash` varchar(255) DEFAULT NULL AFTER `link_foto`;
ALTER TABLE `teachers` ADD COLUMN IF NOT EXISTS `gaji_pokok` decimal(12,2) NOT NULL DEFAULT 0.00 AFTER `pendidikan_terakhir`;
ALTER TABLE `teachers` ADD COLUMN IF NOT EXISTS `tunj_kinerja` decimal(12,2) NOT NULL DEFAULT 0.00 AFTER `gaji_pokok`;
ALTER TABLE `teachers` ADD COLUMN IF NOT EXISTS `tunj_umum` decimal(12,2) NOT NULL DEFAULT 0.00 AFTER `tunj_kinerja`;
ALTER TABLE `teachers` ADD COLUMN IF NOT EXISTS `tunj_istri` decimal(12,2) NOT NULL DEFAULT 0.00 AFTER `tunj_umum`;
ALTER TABLE `teachers` ADD COLUMN IF NOT EXISTS `tunj_anak` decimal(12,2) NOT NULL DEFAULT 0.00 AFTER `tunj_istri`;
ALTER TABLE `teachers` ADD COLUMN IF NOT EXISTS `tunj_kepala_sekolah` decimal(12,2) NOT NULL DEFAULT 0.00 AFTER `tunj_anak`;
ALTER TABLE `teachers` ADD COLUMN IF NOT EXISTS `tunj_wali_kelas` decimal(12,2) NOT NULL DEFAULT 0.00 AFTER `tunj_kepala_sekolah`;
ALTER TABLE `teachers` ADD COLUMN IF NOT EXISTS `honor_bendahara` decimal(12,2) NOT NULL DEFAULT 0.00 AFTER `tunj_wali_kelas`;
ALTER TABLE `teachers` ADD COLUMN IF NOT EXISTS `potongan` decimal(12,2) NOT NULL DEFAULT 0.00 AFTER `honor_bendahara`;

COMMIT;
