-- ============================================================
-- MIGRASI: POTONGAN ABSENSI & TUNJANGAN KEHADIRAN (PENGGAJIAN)
-- Date: 2026-07-14
-- Script ini AMAN dijalankan berulang (idempoten).
-- Jika sebagian sudah jalan (payroll_settings / teachers.tunj_kehadiran),
-- bagian tersebut akan dilewati. Tabel payroll akan dibuat LENGKAP
-- (beserta kolom tunj_kehadiran & ringkasan absensi) bila belum ada.
-- ============================================================

-- 1. Tabel pengaturan potongan (GLOBAL, 1 baris id = 1)
CREATE TABLE IF NOT EXISTS `payroll_settings` (
  `id` INT(11) NOT NULL DEFAULT 1,
  `potongan_terlambat`        DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Rupiah potongan per kali terlambat',
  `potongan_izin`             DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Rupiah potongan per hari izin/cuti',
  `potongan_sakit`            DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Rupiah potongan per hari sakit',
  `potongan_tanpa_keterangan` DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Rupiah potongan per hari tanpa keterangan (alpha)',
  `potongan_tidak_hadir`      DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Rupiah potongan per hari tidak hadir',
  `tunj_kehadiran`            DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'T. Kehadiran (nominal tetap, semua guru aktif)',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `payroll_settings` (`id`) VALUES (1)
  ON DUPLICATE KEY UPDATE `id` = `id`;

-- 2. Kolom tunj_kehadiran di teachers (lewati bila sudah ada)
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'teachers' AND COLUMN_NAME = 'tunj_kehadiran');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `teachers` ADD COLUMN `tunj_kehadiran` DECIMAL(12,2) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. Tabel payroll LENGKAP (dibuat bila belum ada, sudah termasuk kolom baru)
CREATE TABLE IF NOT EXISTS `payroll` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `teacher_id` INT(11) NOT NULL,
  `tenant_id` VARCHAR(50) DEFAULT NULL,
  `periode` VARCHAR(7) NOT NULL COMMENT 'YYYY-MM',
  `gaji_pokok` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `tunj_kinerja` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `tunj_umum` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `tunj_istri` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `tunj_anak` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `tunj_kepala_sekolah` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `tunj_wali_kelas` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `honor_bendahara` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `tunj_kehadiran` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `potongan` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `total_gaji` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `hadir` INT(11) NOT NULL DEFAULT 0,
  `terlambat` INT(11) NOT NULL DEFAULT 0,
  `izin` INT(11) NOT NULL DEFAULT 0,
  `sakit` INT(11) NOT NULL DEFAULT 0,
  `tanpa_keterangan` INT(11) NOT NULL DEFAULT 0,
  `tidak_hadir` INT(11) NOT NULL DEFAULT 0,
  `dinas_luar` INT(11) NOT NULL DEFAULT 0,
  `cuti` INT(11) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` INT(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_teacher_periode` (`teacher_id`, `periode`),
  KEY `periode` (`periode`),
  KEY `tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
