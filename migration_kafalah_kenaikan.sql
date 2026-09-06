-- ============================================================
-- Redesign Matrix Gaji Pokok KAFALAH
-- Konsep baru:
--   1. Gaji Pokok Awal (untuk MK 0-2 tahun) di setiap kombinasi
--   2. Kenaikan per X tahun (konfigurasi per status_pegawai/jenjang/pendidikan)
--   3. Masa kerja max: tahun dimana gaji berhenti naik (mis. 20 atau 99)
--   4. Pendidikan: dinamis (SMA, D3, S1, S2, S3, ...)
-- ============================================================

-- Tabel config kenaikan
CREATE TABLE IF NOT EXISTS `kafalah_kenaikan_config` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `status_pegawai` ENUM('PT','PK') NOT NULL,
  `jenjang` VARCHAR(20) NOT NULL,
  `pendidikan` VARCHAR(20) NOT NULL,
  `gaji_awal` DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Gaji untuk 0-2 tahun pertama',
  `kenaikan_per_tahun` DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Nominal kenaikan tiap X tahun',
  `interval_tahun` INT(11) NOT NULL DEFAULT 2 COMMENT 'Setiap berapa tahun naik (1, 2, 3, ...)',
  `masa_kerja_max` INT(11) NOT NULL DEFAULT 20 COMMENT 'Tahun max untuk perhitungan',
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_combo` (`status_pegawai`,`jenjang`,`pendidikan`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed: ambil gaji_awal dari entry 2 tahun, kenaikan = 50rb per 2 tahun (default)
-- Untuk PT
INSERT IGNORE INTO `kafalah_kenaikan_config` (status_pegawai, jenjang, pendidikan, gaji_awal, kenaikan_per_tahun, interval_tahun, masa_kerja_max)
SELECT 'PT', jenjang, pendidikan, nominal, 50000, 2, 20
FROM kafalah_gaji_matrix
WHERE status_pegawai='PT' AND masa_kerja_min=2 AND masa_kerja_max=2;

-- Untuk PK
INSERT IGNORE INTO `kafalah_kenaikan_config` (status_pegawai, jenjang, pendidikan, gaji_awal, kenaikan_per_tahun, interval_tahun, masa_kerja_max)
SELECT 'PK', jenjang, pendidikan, nominal, 50000, 1, 3
FROM kafalah_gaji_matrix
WHERE status_pegawai='PK' AND masa_kerja_min=0 AND masa_kerja_max=1;

-- Tabel referensi pendidikan (dinamis)
CREATE TABLE IF NOT EXISTS `kafalah_pendidikan_ref` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `kode` VARCHAR(20) NOT NULL,
  `label` VARCHAR(100) NOT NULL,
  `urutan` INT(11) NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_kode` (`kode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `kafalah_pendidikan_ref` (kode, label, urutan, is_active) VALUES
  ('SMA', 'SMA / Sederajat', 1, 1),
  ('D3', 'Diploma 3 (D3)', 2, 1),
  ('S1', 'Sarjana (S1)', 3, 1),
  ('S2', 'Magister (S2)', 4, 1),
  ('S3', 'Doktor (S3)', 5, 1);
