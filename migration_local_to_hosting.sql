-- Migration script: Sync hosting DB with local DB structure
-- Local (struktur_db_local.sql) is the reference
-- Date: 2026-07-05
-- 
-- This script is divided into sections - run each section separately or comment out what's not needed.

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

-- ==========================================
-- SECTION 1: CREATE NEW TABLES
-- ==========================================

CREATE TABLE IF NOT EXISTS `bill_settings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `send_day` int(11) DEFAULT 1,
  `due_day` int(11) DEFAULT 10,
  `is_enabled` tinyint(1) DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `employment_rules` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `job_title_pattern` varchar(100) NOT NULL,
  `employment_type` enum('PTY','PTTY','GTY','GTTY') NOT NULL,
  `min_years` int(11) NOT NULL DEFAULT 0,
  `max_years` int(11) NOT NULL DEFAULT 2,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_title` (`job_title_pattern`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `employment_status_rules` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `employment_type` enum('PTY','PTTY','GTY','GTTY') NOT NULL,
  `min_years` int(11) NOT NULL,
  `max_years` int(11) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `idcard_templates` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `template_name` varchar(100) DEFAULT NULL,
  `template_data` longtext DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `template_type` enum('teacher','student') DEFAULT 'teacher',
  `preview_image` longtext DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `template_name` (`template_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sk_automation_settings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `min_service_years` int(11) NOT NULL DEFAULT 2,
  `auto_generate_enabled` tinyint(1) NOT NULL DEFAULT 1,
  `schedule_day` int(11) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `auto_generate_date` varchar(5) DEFAULT '01-01',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sk_guru` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `teacher_id` int(11) NOT NULL,
  `tenant_id` varchar(20) NOT NULL,
  `no_surat` varchar(100) NOT NULL,
  `tentang` varchar(255) NOT NULL,
  `ttl` varchar(100) DEFAULT NULL,
  `tmt` varchar(50) DEFAULT NULL,
  `pt` varchar(255) DEFAULT NULL,
  `niy` varchar(30) DEFAULT NULL,
  `unit` varchar(100) DEFAULT NULL,
  `bh` varchar(100) DEFAULT NULL,
  `bm` varchar(100) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_teacher_id` (`teacher_id`),
  KEY `idx_tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sk_sequence` (
  `tenant_id` varchar(20) NOT NULL,
  `hijri_year` int(11) NOT NULL,
  `hijri_month` varchar(20) DEFAULT NULL,
  `last_number` int(11) NOT NULL DEFAULT 0,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`tenant_id`,`hijri_year`),
  KEY `idx_tenant_hijri` (`tenant_id`,`hijri_year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `tagihan_siswa` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `student_id` int(11) NOT NULL,
  `tenant_id` int(11) NOT NULL,
  `periode` varchar(20) NOT NULL,
  `jumlah_tagihan` decimal(10,2) DEFAULT 0.00,
  `status` enum('terkirim','gagal','diterima') DEFAULT 'terkirim',
  `message_id` varchar(100) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_tagihan` (`student_id`,`periode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ypwi_database___database_siswa` (
  `nama_siswa` varchar(255) DEFAULT NULL,
  `jenis_kelamin` varchar(20) DEFAULT NULL,
  `tenant_id` varchar(100) DEFAULT NULL,
  `password` varchar(255) DEFAULT NULL,
  `jenjang` varchar(50) DEFAULT NULL,
  `nama_sheet` varchar(100) DEFAULT NULL,
  `nisn` varchar(50) DEFAULT NULL,
  `kelas` varchar(50) DEFAULT NULL,
  `iuran_bulanan` varchar(50) DEFAULT NULL,
  `nama_orang_tua` varchar(255) DEFAULT NULL,
  `no_wa` varchar(30) DEFAULT NULL,
  `keterangan` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- ==========================================
-- SECTION 2: ADD MISSING COLUMNS TO EXISTING TABLES
-- ==========================================

-- tenants.id (check if column exists first - will error if already exists)
-- ALTER TABLE `tenants` ADD COLUMN `id` int(11) NOT NULL AFTER `tenant_id`;
-- ALTER TABLE `tenants` ADD INDEX `idx_id` (`id`);

-- tenants.nomor_rekening
ALTER TABLE `tenants` ADD COLUMN IF NOT EXISTS `nomor_rekening` varchar(50) DEFAULT NULL AFTER `nama_sekolah`;

-- chat_messages.reply_to_message_id
ALTER TABLE `chat_messages` ADD COLUMN IF NOT EXISTS `reply_to_message_id` int(11) DEFAULT NULL AFTER `message`;

-- conversation_participants columns
ALTER TABLE `conversation_participants` ADD COLUMN IF NOT EXISTS `last_read_at` timestamp NULL DEFAULT NULL AFTER `user_type`;
ALTER TABLE `conversation_participants` ADD COLUMN IF NOT EXISTS `is_typing` tinyint(1) DEFAULT 0 AFTER `last_read_at`;
ALTER TABLE `conversation_participants` ADD COLUMN IF NOT EXISTS `typing_expires_at` timestamp NULL DEFAULT NULL AFTER `is_typing`;
ALTER TABLE `conversation_participants` ADD COLUMN IF NOT EXISTS `last_seen_at` timestamp NULL DEFAULT NULL AFTER `typing_expires_at`;

-- teachers.pendidikan_terakhir
ALTER TABLE `teachers` ADD COLUMN IF NOT EXISTS `pendidikan_terakhir` varchar(100) DEFAULT NULL AFTER `updated_at`;

-- teacher_assignments.class_id (untuk walikelas)
ALTER TABLE `teacher_assignments` ADD COLUMN IF NOT EXISTS `class_id` int(11) DEFAULT NULL AFTER `jabatan_di_unit`;
ALTER TABLE `teacher_assignments` ADD KEY IF NOT EXISTS `idx_class_id` (`class_id`);
ALTER TABLE `teacher_assignments` ADD CONSTRAINT IF NOT EXISTS `teacher_assignments_ibfk_3` FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON DELETE SET NULL;

-- ==========================================
-- SECTION 3: FIX DATA AND ADD FOREIGN KEYS
-- ==========================================

-- STEP 1: Perbaiki data users - set NULL pada tenant_id yang tidak valid
-- Users with tenant_id 'YPWI', '169', or other values not in tenants table
UPDATE `users` SET `tenant_id` = NULL 
WHERE `tenant_id` IS NOT NULL 
  AND `tenant_id` NOT IN (SELECT `tenant_id` FROM `tenants` WHERE `tenant_id` IS NOT NULL);

-- STEP 2: Perbaiki data users - set NULL pada guru_id yang tidak valid
UPDATE `users` SET `guru_id` = NULL 
WHERE `guru_id` IS NOT NULL 
  AND `guru_id` NOT IN (SELECT `id` FROM `teachers` WHERE `id` IS NOT NULL);

-- STEP 3: Setelah data diperbaiki, tambahkan foreign keys
ALTER TABLE `users` ADD CONSTRAINT `users_ibfk_1` FOREIGN KEY (`guru_id`) REFERENCES `teachers` (`id`) ON DELETE SET NULL;
ALTER TABLE `users` ADD CONSTRAINT `users_ibfk_2` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`tenant_id`) ON DELETE CASCADE;

-- ==========================================
-- NOTES: Existing column differences (review manually)
-- ==========================================
-- 1. attendance_logs.status: Local tanpa DEFAULT, Hosting DEFAULT 'tepat_waktu'
-- 2. teacher_attendance_stats.month: Local year(4), Hosting varchar(7) - TIPE BERBEDA!
-- 3. evaluations.notes: Local text, Hosting mediumtext
-- 4. conversations.created_at: Local NOT NULL, Hosting NULL
-- 5. chat_messages.created_at: Local NOT NULL, Hosting NULL
-- 6. evaluations.created_at: Local NOT NULL, Hosting NULL
-- 7. tenant_locations.location_name: Local punya DEFAULT 'Lokasi Utama', Hosting tidak

COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;