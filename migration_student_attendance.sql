-- Migration: Tambah tabel student_attendance untuk fitur Wali Kelas
-- Dapat dijalankan berulang kali tanpa error karena menggunakan IF NOT EXISTS

-- 1. Buat tabel student_attendance jika belum ada
CREATE TABLE IF NOT EXISTS `student_attendance` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `student_id` int(11) NOT NULL,
  `class_id` int(11) DEFAULT NULL,
  `tenant_id` varchar(50) DEFAULT NULL,
  `tanggal` date NOT NULL,
  `status` enum('hadir','izin','sakit','alpha') NOT NULL,
  `keterangan` text DEFAULT NULL,
  `recorded_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_student_tanggal` (`student_id`, `tanggal`),
  KEY `idx_class_id` (`class_id`),
  KEY `idx_tenant_id` (`tenant_id`),
  KEY `idx_recorded_by` (`recorded_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Tambah foreign key jika belum ada
SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'student_attendance'
    AND CONSTRAINT_NAME = 'student_attendance_ibfk_1'
);

SET @sql := IF(@fk_exists = 0,
  'ALTER TABLE `student_attendance`
    ADD CONSTRAINT `student_attendance_ibfk_1` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE,
    ADD CONSTRAINT `student_attendance_ibfk_2` FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON DELETE SET NULL,
    ADD CONSTRAINT `student_attendance_ibfk_3` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`tenant_id`) ON DELETE CASCADE,
    ADD CONSTRAINT `student_attendance_ibfk_4` FOREIGN KEY (`recorded_by`) REFERENCES `teachers` (`id`) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
