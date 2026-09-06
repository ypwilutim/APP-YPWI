-- ============================================================
-- MIGRASI KAFALAH - Penggajian Guru YPWI Lutim
-- Struktur mengikuti KAFALAH full malili 2026 Vers 1.xlsx:
--   PENDAPATAN WAJIB  : Kafalah Pokok + Tunj. Keluarga (Istri + Anak)
--   PENDAPATAN INSENTIF: Struktural + Pengabdian + Fungsional + Transport
--                        + Tepat Waktu Datang + Tidak Cepat Pulang
--                        + KJM (Kelebihan Jam Mengajar)
--                        + Tunj. Pembina (opsional) + Tunj. Pondok (opsional)
--                        + Prestasi Kinerja + Apresiasi
--   PEMOTONGAN        : Ta'awun, SIM-T, Pinjaman, Cuti Luar Tanggungan
-- Periode KAFALAH: tanggal-tanggal (cut-off custom), bukan YYYY-MM.
--   Disimpan sebagai kolom `periode_mulai` & `periode_selesai` (DATE).
-- ============================================================

-- 1. Master pengaturan KAFALAH (global, editable via Pengaturan Pembayaran)
CREATE TABLE IF NOT EXISTS `kafalah_settings` (
  `id` INT(11) NOT NULL DEFAULT 1,
  `tunj_pengabdian`        DECIMAL(12,2) NOT NULL DEFAULT 150000 COMMENT 'Flat untuk semua guru',
  `tunj_fungsional`        DECIMAL(12,2) NOT NULL DEFAULT 100000 COMMENT 'Flat default',
  `tunj_transport`         DECIMAL(12,2) NOT NULL DEFAULT 168000 COMMENT 'Transportasi harian',
  `tunj_tepat_waktu`       DECIMAL(12,2) NOT NULL DEFAULT 120000 COMMENT 'Tepat waktu datang',
  `tunj_tidak_cepat_pulang` DECIMAL(12,2) NOT NULL DEFAULT 120000 COMMENT 'Tidak cepat pulang',
  `tunj_prestasi_kinerja`  DECIMAL(12,2) NOT NULL DEFAULT 150000 COMMENT 'Prestasi kinerja flat',
  `nominal_kjm`            DECIMAL(12,2) NOT NULL DEFAULT 10000 COMMENT 'Per jam kelebihan mengajar',
  `tunj_pembina`           DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Tunj. Pembina (opsional)',
  `tunj_pondok`            DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Tunj. Pondok (opsional)',
  `tunj_anak`              DECIMAL(12,2) NOT NULL DEFAULT 20000 COMMENT 'Per anak',
  `tunj_istri`             DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Tunjangan istri',
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `kafalah_settings` (id) VALUES (1);

-- 2. Matrix gaji pokok referensi (ganti dari tabel gaji guru)
--    Jenjang: TK | SD | SMP | SMA | PONPES
--    Pendidikan: SMA | S1 | S2
--    Masa kerja: rentang tahun (ex: 0-2, 3-4, 5-6, ...)
CREATE TABLE IF NOT EXISTS `kafalah_gaji_matrix` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `status_pegawai` ENUM('PT','PK') NOT NULL COMMENT 'PT=Pegawai Tetap, PK=Pegawai Kontrak',
  `jenjang` VARCHAR(20) NOT NULL COMMENT 'TK | SD | SMP | SMA | PONPES',
  `pendidikan` VARCHAR(10) NOT NULL COMMENT 'SMA | S1 | S2',
  `masa_kerja_min` INT(11) NOT NULL COMMENT 'Tahun minimum',
  `masa_kerja_max` INT(11) NOT NULL COMMENT 'Tahun maksimum',
  `nominal` DECIMAL(12,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_lookup` (`status_pegawai`,`jenjang`,`pendidikan`,`masa_kerja_min`,`masa_kerja_max`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed matrix PT (berdasarkan Tabel Gaji Guru Tetap)
INSERT IGNORE INTO `kafalah_gaji_matrix`
  (status_pegawai, jenjang, pendidikan, masa_kerja_min, masa_kerja_max, nominal) VALUES
  ('PT','TK','SMA', 2, 2, 500000),('PT','TK','S1', 2, 2, 900000),
  ('PT','TK','SMA', 3, 4, 550000),('PT','TK','S1', 3, 4, 950000),
  ('PT','TK','SMA', 5, 6, 600000),('PT','TK','S1', 5, 6, 1000000),
  ('PT','TK','SMA', 7, 8, 650000),('PT','TK','S1', 7, 8, 1050000),
  ('PT','TK','SMA', 9,10, 700000),('PT','TK','S1', 9,10, 1100000),
  ('PT','TK','SMA',11,12, 750000),('PT','TK','S1',11,12, 1150000),
  ('PT','TK','SMA',13,14, 800000),('PT','TK','S1',13,14, 1200000),
  ('PT','TK','SMA',15,16, 850000),('PT','TK','S1',15,16, 1250000),
  ('PT','TK','SMA',17,18, 900000),('PT','TK','S1',17,18, 1300000),
  ('PT','TK','SMA',19,20, 950000),('PT','TK','S1',19,20, 1350000),
  ('PT','SD','SMA', 2, 2, 800000),('PT','SD','S1', 2, 2, 1800000),
  ('PT','SD','SMA', 3, 4, 850000),('PT','SD','S1', 3, 4, 1850000),
  ('PT','SD','SMA', 5, 6, 900000),('PT','SD','S1', 5, 6, 1900000),
  ('PT','SD','SMA', 7, 8, 950000),('PT','SD','S1', 7, 8, 1950000),
  ('PT','SD','SMA', 9,10,1000000),('PT','SD','S1', 9,10, 2000000),
  ('PT','SD','SMA',11,12,1050000),('PT','SD','S1',11,12, 2050000),
  ('PT','SD','SMA',13,14,1100000),('PT','SD','S1',13,14, 2100000),
  ('PT','SD','SMA',15,16,1150000),('PT','SD','S1',15,16, 2150000),
  ('PT','SD','SMA',17,18,1200000),('PT','SD','S1',17,18, 2200000),
  ('PT','SD','SMA',19,20,1250000),('PT','SD','S1',19,20, 2250000),
  ('PT','SMP','SMA', 2, 2, 500000),('PT','SMP','S1', 2, 2, 900000),
  ('PT','SMP','SMA', 3, 4, 550000),('PT','SMP','S1', 3, 4, 950000),
  ('PT','SMP','SMA', 5, 6, 600000),('PT','SMP','S1', 5, 6, 1000000),
  ('PT','SMP','SMA', 7, 8, 650000),('PT','SMP','S1', 7, 8, 1050000),
  ('PT','SMP','SMA', 9,10, 700000),('PT','SMP','S1', 9,10, 1100000),
  ('PT','SMP','SMA',11,12, 750000),('PT','SMP','S1',11,12, 1150000),
  ('PT','SMP','SMA',13,14, 800000),('PT','SMP','S1',13,14, 1200000),
  ('PT','SMP','SMA',15,16, 850000),('PT','SMP','S1',15,16, 1250000),
  ('PT','SMP','SMA',17,18, 900000),('PT','SMP','S1',17,18, 1300000),
  ('PT','SMP','SMA',19,20, 950000),('PT','SMP','S1',19,20, 1350000),
  ('PT','SMA','SMA', 2, 2, 500000),('PT','SMA','S1', 2, 2, 900000),
  ('PT','SMA','SMA', 3, 4, 550000),('PT','SMA','S1', 3, 4, 950000),
  ('PT','SMA','SMA', 5, 6, 600000),('PT','SMA','S1', 5, 6, 1000000),
  ('PT','SMA','SMA', 7, 8, 650000),('PT','SMA','S1', 7, 8, 1050000),
  ('PT','SMA','SMA', 9,10, 700000),('PT','SMA','S1', 9,10, 1100000),
  ('PT','SMA','SMA',11,12, 750000),('PT','SMA','S1',11,12, 1150000),
  ('PT','SMA','SMA',13,14, 800000),('PT','SMA','S1',13,14, 1200000),
  ('PT','SMA','SMA',15,16, 850000),('PT','SMA','S1',15,16, 1250000),
  ('PT','SMA','SMA',17,18, 900000),('PT','SMA','S1',17,18, 1300000),
  ('PT','SMA','SMA',19,20, 950000),('PT','SMA','S1',19,20, 1350000),
  ('PT','PONPES','SMA', 2, 2, 500000),('PT','PONPES','S1', 2, 2, 900000),
  ('PT','PONPES','SMA', 3, 4, 550000),('PT','PONPES','S1', 3, 4, 950000),
  ('PT','PONPES','SMA', 5, 6, 600000),('PT','PONPES','S1', 5, 6, 1000000),
  ('PT','PONPES','SMA', 7, 8, 650000),('PT','PONPES','S1', 7, 8, 1050000),
  ('PT','PONPES','SMA', 9,10, 700000),('PT','PONPES','S1', 9,10, 1100000),
  ('PT','PONPES','SMA',11,12, 750000),('PT','PONPES','S1',11,12, 1150000),
  ('PT','PONPES','SMA',13,14, 800000),('PT','PONPES','S1',13,14, 1200000),
  ('PT','PONPES','SMA',15,16, 850000),('PT','PONPES','S1',15,16, 1250000),
  ('PT','PONPES','SMA',17,18, 900000),('PT','PONPES','S1',17,18, 1300000),
  ('PT','PONPES','SMA',19,20, 950000),('PT','PONPES','S1',19,20, 1350000);

-- Seed matrix PK (Pegawai Kontrak, ≤1 th & 1-3 th)
INSERT IGNORE INTO `kafalah_gaji_matrix`
  (status_pegawai, jenjang, pendidikan, masa_kerja_min, masa_kerja_max, nominal) VALUES
  ('PK','TK','SMA',0,1, 300000),('PK','TK','S1',0,1, 500000),
  ('PK','TK','SMA',1,3, 350000),('PK','TK','S1',1,3, 550000),
  ('PK','SD','SMA',0,1, 300000),('PK','SD','S1',0,1, 500000),
  ('PK','SD','SMA',1,3, 350000),('PK','SD','S1',1,3, 550000),
  ('PK','SMP','SMA',0,1, 300000),('PK','SMP','S1',0,1, 500000),
  ('PK','SMP','SMA',1,3, 350000),('PK','SMP','S1',1,3, 550000),
  ('PK','SMA','SMA',0,1, 300000),('PK','SMA','S1',0,1, 500000),
  ('PK','SMA','SMA',1,3, 350000),('PK','SMA','S1',1,3, 550000),
  ('PK','PONPES','SMA',0,1, 300000),('PK','PONPES','S1',0,1, 500000),
  ('PK','PONPES','SMA',1,3, 350000),('PK','PONPES','S1',1,3, 550000);

-- 3. Override komponen KAFALAH per guru (per unit)
CREATE TABLE IF NOT EXISTS `kafalah_teacher_overrides` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `teacher_id` INT(11) NOT NULL,
  `tenant_id` VARCHAR(50) NOT NULL,
  `tunj_struktural` DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Override struktural jabatan',
  `tunj_pembina`    DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Override tunj pembina (default 0)',
  `tunj_pondok`     DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Override tunj pondok (default 0)',
  `tunj_apresiasi`  DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Override apresiasi',
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_teacher_tenant` (`teacher_id`,`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Slip KAFALAH per periode (cut-off custom)
CREATE TABLE IF NOT EXISTS `kafalah_payroll` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `teacher_id` INT(11) NOT NULL,
  `tenant_id` VARCHAR(50) NOT NULL,
  `periode_mulai` DATE NOT NULL,
  `periode_selesai` DATE NOT NULL,
  `label_periode` VARCHAR(50) DEFAULT NULL COMMENT 'cth: 26 Juni 2026 s/d 25 Juli 2026',
  -- identitas
  `nama` VARCHAR(200) DEFAULT NULL,
  `nik` VARCHAR(30) DEFAULT NULL,
  `jabatan` VARCHAR(100) DEFAULT NULL,
  `status_pegawai` VARCHAR(10) DEFAULT NULL,
  `jenjang` VARCHAR(20) DEFAULT NULL,
  `pendidikan` VARCHAR(10) DEFAULT NULL,
  `masa_kerja_tahun` INT(11) DEFAULT 0,
  `jumlah_anak` INT(11) DEFAULT 0,
  `predikat_kinerja` VARCHAR(5) DEFAULT NULL,
  -- absensi
  `hari_efektif` INT(11) DEFAULT 0,
  `hadir` INT(11) DEFAULT 0,
  `tidak_hadir` INT(11) DEFAULT 0,
  `tepat_waktu` INT(11) DEFAULT 0,
  `terlambat` INT(11) DEFAULT 0,
  `tidak_absen_masuk` INT(11) DEFAULT 0,
  `cepat_pulang` INT(11) DEFAULT 0,
  `tidak_absen_pulang` INT(11) DEFAULT 0,
  `kjm` INT(11) DEFAULT 0 COMMENT 'jam kelebihan mengajar',
  -- PENDAPATAN WAJIB (A)
  `kafalah_pokok` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `tunj_keluarga_istri` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `tunj_keluarga_anak` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `total_a` DECIMAL(14,2) NOT NULL DEFAULT 0,
  -- PENDAPATAN INSENTIF (B)
  `tunj_struktural` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `tunj_pengabdian` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `tunj_fungsional` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `tunj_pembina` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `tunj_pondok` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `tunj_transport` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `tunj_tepat_waktu` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `tunj_tidak_cepat_pulang` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `tunj_kjm` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `tunj_prestasi_kinerja` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `tunj_apresiasi` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `total_b` DECIMAL(14,2) NOT NULL DEFAULT 0,
  -- PEMOTONGAN (C)
  `potong_taawun` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `potong_simt` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `potong_pinjaman` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `potong_cuti_luar_tanggungan` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `potong_persen_cuti` DECIMAL(5,2) NOT NULL DEFAULT 0,
  `total_c` DECIMAL(14,2) NOT NULL DEFAULT 0,
  -- TOTAL
  `total_pendapatan` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` INT(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_teacher_periode` (`teacher_id`,`tenant_id`,`periode_mulai`,`periode_selesai`),
  KEY `idx_periode` (`periode_mulai`,`periode_selesai`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Override per teacher_assignments: is_paid (dari sesi sebelumnya)
--    Sudah ada di migration_payroll_per_unit.sql, tapi pastikan idempoten
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'teacher_assignments' AND COLUMN_NAME = 'is_paid');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `teacher_assignments` ADD COLUMN `is_paid` TINYINT(1) NOT NULL DEFAULT 1 COMMENT ''1=digaji, 0=tidak''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
