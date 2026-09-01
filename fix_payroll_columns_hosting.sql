-- ============================================
-- COMPREHENSIVE SCHEMA MIGRATION: Local -> Hosting
-- ============================================
-- Run this SQL on hosting database to add missing columns
-- from local development schema. Uses IF NOT EXISTS so it's safe to re-run.
-- ============================================

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;

-- Add missing columns to teachers table
ALTER TABLE `teachers` 
  ADD COLUMN IF NOT EXISTS `pending_password_hash` varchar(255) DEFAULT NULL AFTER `link_foto`,
  ADD COLUMN IF NOT EXISTS `gaji_pokok` decimal(12,2) NOT NULL DEFAULT 0.00 AFTER `pendidikan_terakhir`,
  ADD COLUMN IF NOT EXISTS `tunj_kinerja` decimal(12,2) NOT NULL DEFAULT 0.00 AFTER `gaji_pokok`,
  ADD COLUMN IF NOT EXISTS `tunj_umum` decimal(12,2) NOT NULL DEFAULT 0.00 AFTER `tunj_kinerja`,
  ADD COLUMN IF NOT EXISTS `tunj_istri` decimal(12,2) NOT NULL DEFAULT 0.00 AFTER `tunj_umum`,
  ADD COLUMN IF NOT EXISTS `tunj_anak` decimal(12,2) NOT NULL DEFAULT 0.00 AFTER `tunj_istri`,
  ADD COLUMN IF NOT EXISTS `tunj_kepala_sekolah` decimal(12,2) NOT NULL DEFAULT 0.00 AFTER `tunj_anak`,
  ADD COLUMN IF NOT EXISTS `tunj_wali_kelas` decimal(12,2) NOT NULL DEFAULT 0.00 AFTER `tunj_kepala_sekolah`,
  ADD COLUMN IF NOT EXISTS `honor_bendahara` decimal(12,2) NOT NULL DEFAULT 0.00 AFTER `tunj_wali_kelas`,
  ADD COLUMN IF NOT EXISTS `potongan` decimal(12,2) NOT NULL DEFAULT 0.00 AFTER `honor_bendahara`;

-- Add missing columns to students table for NIS format and entry year support
ALTER TABLE `students`
  ADD COLUMN IF NOT EXISTS `tanggal_masuk` date DEFAULT NULL AFTER `status`;

ALTER TABLE `students`
  ADD COLUMN IF NOT EXISTS `tahun_masuk` varchar(10) DEFAULT NULL AFTER `tanggal_masuk`,
  ADD COLUMN IF NOT EXISTS `iuran_bulanan` decimal(10,2) DEFAULT 0.00 AFTER `jenis_kelamin`,
  ADD COLUMN IF NOT EXISTS `ransportasi` decimal(10,2) DEFAULT 0.00 AFTER `iuran_bulanan`,
  ADD COLUMN IF NOT EXISTS `privat` decimal(10,2) DEFAULT 0.00 AFTER `ransportasi`,
  ADD COLUMN IF NOT EXISTS `biaya_lain` decimal(10,2) DEFAULT 0.00 AFTER `privat`,
  ADD COLUMN IF NOT EXISTS `biaya_lain_nama` varchar(255) DEFAULT NULL AFTER `biaya_lain`
  ;

-- Add missing column to xendit_invoices
ALTER TABLE `xendit_invoices`
  ADD COLUMN IF NOT EXISTS `payment_channel` varchar(50) DEFAULT NULL AFTER `payment_method`;

COMMIT;
