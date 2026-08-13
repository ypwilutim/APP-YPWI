-- Migration: Tambah tabel jadwal_pelajaran untuk fitur Wali Kelas
-- Dapat dijalankan berulang kali tanpa error

-- 1. Buat tabel jadwal_pelajaran jika belum ada
CREATE TABLE IF NOT EXISTS `jadwal_pelajaran` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(50) DEFAULT NULL,
  `class_id` int(11) DEFAULT NULL,
  `hari` enum('Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu') NOT NULL,
  `periode_ke` int(11) NOT NULL,
  `jam_mulai` time NOT NULL,
  `jam_selesai` time NOT NULL,
  `mata_pelajaran` varchar(100) DEFAULT NULL,
  `guru` varchar(100) DEFAULT NULL,
  `ruangan` varchar(50) DEFAULT NULL,
  `keterangan` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_class_id` (`class_id`),
  KEY `idx_tenant_id` (`tenant_id`),
  KEY `idx_hari` (`hari`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Tambah foreign key jika belum ada
SET @fk_exists1 := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'jadwal_pelajaran'
    AND CONSTRAINT_NAME = 'jadwal_pelajaran_ibfk_1'
);

SET @fk_exists2 := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'jadwal_pelajaran'
    AND CONSTRAINT_NAME = 'jadwal_pelajaran_ibfk_2'
);

SET @sql := IF(@fk_exists1 = 0 AND @fk_exists2 = 0,
  'ALTER TABLE `jadwal_pelajaran`
    ADD CONSTRAINT `jadwal_pelajaran_ibfk_1` FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON DELETE CASCADE,
    ADD CONSTRAINT `jadwal_pelajaran_ibfk_2` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`tenant_id`) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
