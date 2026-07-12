-- ============================================================
-- MIGRASI FITUR PENGGAJIAN GURU
-- Menambahkan komponen gaji ke tabel teachers dan membuat
-- tabel payroll untuk menyimpan slip gaji per periode.
-- ============================================================

-- 1. Tambah kolom komponen gaji ke tabel teachers
--    (sesuai struktur temp_teachers: Gaji_Pokok + 7 tunjangan + potongan)
ALTER TABLE `teachers`
  ADD COLUMN `gaji_pokok` DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN `tunj_kinerja` DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN `tunj_umum` DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN `tunj_istri` DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN `tunj_anak` DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN `tunj_kepala_sekolah` DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN `tunj_wali_kelas` DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN `honor_bendahara` DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN `potongan` DECIMAL(12,2) NOT NULL DEFAULT 0;

-- 2. Tabel payroll (slip gaji per guru per periode)
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
  `potongan` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `total_gaji` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `hadir` INT(11) NOT NULL DEFAULT 0,
  `terlambat` INT(11) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` INT(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_teacher_periode` (`teacher_id`, `periode`),
  KEY `periode` (`periode`),
  KEY `tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
