-- ============================================================
-- Migration: SPMB tables
-- ============================================================

CREATE TABLE IF NOT EXISTS `spmb_settings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenant_id` VARCHAR(50) NOT NULL,
  `is_open` TINYINT(1) DEFAULT 0,
  `judul_flyer` VARCHAR(255) DEFAULT NULL,
  `keterangan_flyer` TEXT DEFAULT NULL,
  `no_wa` VARCHAR(20) DEFAULT NULL,
  `primary_color` VARCHAR(7) DEFAULT '#066e3a',
  `accent_color` VARCHAR(7) DEFAULT '#f59e0b',
  `school_name` VARCHAR(255) DEFAULT NULL,
  `school_tagline` VARCHAR(255) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_spmb_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `spmb_programs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenant_id` VARCHAR(50) NOT NULL,
  `program_name` VARCHAR(255) DEFAULT NULL,
  `description` TEXT DEFAULT NULL,
  `quota` INT DEFAULT 0,
  `is_active` TINYINT(1) DEFAULT 1,
  `tanggal_buka` DATE DEFAULT NULL,
  `tanggal_tutup` DATE DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_spmb_programs_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `spmb_waves` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenant_id` VARCHAR(50) NOT NULL,
  `wave_number` INT DEFAULT NULL,
  `wave_name` VARCHAR(255) DEFAULT NULL,
  `registration_start` DATE DEFAULT NULL,
  `registration_end` DATE DEFAULT NULL,
  `max_participants` INT DEFAULT 0,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_spmb_waves_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `spmb_faqs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenant_id` VARCHAR(50) NOT NULL,
  `question` TEXT DEFAULT NULL,
  `answer` TEXT DEFAULT NULL,
  `sort_order` INT DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_spmb_faqs_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `spmb_stats` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenant_id` VARCHAR(50) NOT NULL,
  `label` VARCHAR(255) DEFAULT NULL,
  `value` INT DEFAULT 0,
  `sort_order` INT DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_spmb_stats_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `spmb_registrations` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenant_id` VARCHAR(50) NOT NULL,
  `nama` VARCHAR(255) DEFAULT NULL,
  `nik` VARCHAR(20) DEFAULT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `no_wa` VARCHAR(20) DEFAULT NULL,
  `tempat_lahir` VARCHAR(255) DEFAULT NULL,
  `tanggal_lahir` DATE DEFAULT NULL,
  `jenis_kelamin` ENUM('L','P') DEFAULT NULL,
  `alamat` TEXT DEFAULT NULL,
  `pendidikan_terakhir` VARCHAR(50) DEFAULT NULL,
  `jurusan` VARCHAR(255) DEFAULT NULL,
  `nama_sekolah_pendidikan` VARCHAR(255) DEFAULT NULL,
  `tahun_angkatan` VARCHAR(10) DEFAULT NULL,
  `tenant_id_sekolah` VARCHAR(50) DEFAULT NULL,
  `jabatan_di_unit` VARCHAR(100) DEFAULT NULL,
  `status` ENUM('pending','approved','rejected') DEFAULT 'pending',
  `password_hash` VARCHAR(255) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_spmb_registrations_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `spmb_committees` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenant_id` VARCHAR(50) NOT NULL,
  `teacher_id` INT DEFAULT NULL,
  `nama` VARCHAR(255) DEFAULT NULL,
  `spmb_role` VARCHAR(100) DEFAULT NULL,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_spmb_committees_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
