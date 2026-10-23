-- ============================================================
-- MIGRASI: MODUL SDM (Sumber Daya Manusia)
-- Date: 2026-10-13
-- Fitur: Kontrak kerja, arsip surat & dokumen SDM,
--        KPI guru & staf, dan riwayat perubahan status pegawai.
-- Skrip idempoten (aman dijalankan berulang).
-- Jalankan via phpMyAdmin -> Import setelah `git pull`.
-- ============================================================

-- 1. Kontrak / perjanjian kerja pegawai
CREATE TABLE IF NOT EXISTS `hr_contracts` (
  `id`             INT(11) NOT NULL AUTO_INCREMENT,
  `teacher_id`     INT(11) NOT NULL                COMMENT 'FK ke teachers.id',
  `tenant_id`      VARCHAR(20) NOT NULL            COMMENT 'Unit/tenant penempatan',
  `jenis`          VARCHAR(50) NOT NULL DEFAULT 'PKWT' COMMENT 'PKWT/PKWTT/Honorer/Perjanjian Kerja',
  `nomor`          VARCHAR(100) DEFAULT NULL       COMMENT 'Nomor kontrak',
  `tanggal_mulai`  DATE NOT NULL,
  `tanggal_selesai` DATE DEFAULT NULL              COMMENT 'NULL = masa kerja tetap',
  `status`         ENUM('aktif','habis','diperpanjang','diakhiri') NOT NULL DEFAULT 'aktif',
  `nilai_kontrak`  DECIMAL(14,2) DEFAULT NULL,
  `file_url`       VARCHAR(255) DEFAULT NULL       COMMENT 'Scan kontrak (path /uploads/hr/...)',
  `catatan`        TEXT DEFAULT NULL,
  `dokumen_kelengkapan` JSON DEFAULT NULL          COMMENT 'Checklist dokumen kontrak',
  `created_by`     INT(11) DEFAULT NULL,
  `created_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_teacher` (`teacher_id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_status` (`status`),
  KEY `idx_selesai` (`tanggal_selesai`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Arsip surat & dokumen resmi SDM
CREATE TABLE IF NOT EXISTS `hr_documents` (
  `id`             INT(11) NOT NULL AUTO_INCREMENT,
  `nomor_surat`    VARCHAR(100) DEFAULT NULL,
  `jenis`          VARCHAR(50) NOT NULL            COMMENT 'surat_keterangan_kerja/surat_tugas/pengangkatan/kontrak/lainnya',
  `teacher_id`     INT(11) DEFAULT NULL            COMMENT 'NULL untuk surat kolektif',
  `tenant_id`      VARCHAR(20) NOT NULL,
  `tanggal`        DATE NOT NULL,
  `perihal`        VARCHAR(255) NOT NULL,
  `isi`            MEDIUMTEXT DEFAULT NULL         COMMENT 'Isi/ringkasan surat',
  `file_url`       VARCHAR(255) DEFAULT NULL       COMMENT 'File .docx/.pdf di /downloads/',
  `template`       VARCHAR(100) DEFAULT NULL       COMMENT 'Nama template yang dipakai',
  `status`         ENUM('draft','terbit','dibatalkan') NOT NULL DEFAULT 'terbit',
  `dibuat_oleh`    INT(11) DEFAULT NULL,
  `created_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_teacher` (`teacher_id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_jenis` (`jenis`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Master indikator KPI (guru & staf)
CREATE TABLE IF NOT EXISTS `kpi_indicators` (
  `id`             INT(11) NOT NULL AUTO_INCREMENT,
  `nama`           VARCHAR(150) NOT NULL,
  `kategori`       ENUM('guru','staf') NOT NULL DEFAULT 'guru',
  `bobot`          DECIMAL(5,2) NOT NULL DEFAULT 0  COMMENT 'Bobot dalam persen, total seluruh indikator = 100',
  `satuan`         VARCHAR(50) DEFAULT '%'         COMMENT 'Satuan nilai aktual',
  `target_default` DECIMAL(12,2) NOT NULL DEFAULT 100,
  `sumber`         ENUM('manual','kehadiran','evaluasi') NOT NULL DEFAULT 'manual',
  `urutan`         INT(11) NOT NULL DEFAULT 0,
  `aktif`          TINYINT(1) NOT NULL DEFAULT 1,
  `keterangan`     VARCHAR(255) DEFAULT NULL,
  `created_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_kategori` (`kategori`),
  KEY `idx_aktif` (`aktif`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- 4. Periode penilaian KPI (bulanan/semester/tahunan)
CREATE TABLE IF NOT EXISTS `kpi_periods` (
  `id`             INT(11) NOT NULL AUTO_INCREMENT,
  `nama`           VARCHAR(100) NOT NULL           COMMENT 'Contoh: Oktober 2026 / Semester 1 2026/2027',
  `jenis`          ENUM('bulanan','semester','tahunan') NOT NULL DEFAULT 'bulanan',
  `bulan`          TINYINT(2) DEFAULT NULL        COMMENT '1-12 untuk periode bulanan',
  `tahun`          SMALLINT(5) UNSIGNED NOT NULL,
  `tanggal_mulai`  DATE DEFAULT NULL,
  `tanggal_selesai` DATE DEFAULT NULL,
  `status`         ENUM('draft','aktif','published') NOT NULL DEFAULT 'draft',
  `created_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`),
  UNIQUE KEY `uniq_periode` (`nama`, `tahun`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Nilai KPI per pegawai per indikator per periode
CREATE TABLE IF NOT EXISTS `kpi_scores` (
  `id`             INT(11) NOT NULL AUTO_INCREMENT,
  `period_id`      INT(11) NOT NULL,
  `teacher_id`     INT(11) NOT NULL,
  `tenant_id`      VARCHAR(20) NOT NULL,
  `kategori`       ENUM('guru','staf') NOT NULL DEFAULT 'guru',
  `indicator_id`   INT(11) NOT NULL,
  `nilai_aktual`   DECIMAL(12,2) NOT NULL DEFAULT 0,
  `target`         DECIMAL(12,2) NOT NULL DEFAULT 100,
  `pencapaian`     DECIMAL(7,2) NOT NULL DEFAULT 0   COMMENT 'Hasil % (dibatasi 0-100)',
  `skor`           DECIMAL(7,2) NOT NULL DEFAULT 0   COMMENT 'pencapaian x bobot/100',
  `sumber`         ENUM('manual','kehadiran','evaluasi') NOT NULL DEFAULT 'manual',
  `penilai_id`     INT(11) DEFAULT NULL,
  `catatan`        VARCHAR(255) DEFAULT NULL,
  `created_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_score` (`period_id`, `teacher_id`, `indicator_id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_indicator` (`indicator_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Riwayat perubahan data kepegawaian (jabatan, status, unit, gaji)
CREATE TABLE IF NOT EXISTS `hr_status_history` (
  `id`             INT(11) NOT NULL AUTO_INCREMENT,
  `teacher_id`     INT(11) NOT NULL,
  `tenant_id`      VARCHAR(20) DEFAULT NULL,
  `jenis_perubahan` VARCHAR(50) NOT NULL            COMMENT 'jabatan/status_kepegawaian/tmt/unit/gaji/data',
  `sebelum`        TEXT DEFAULT NULL,
  `sesudah`        TEXT DEFAULT NULL,
  `tanggal_efektif` DATE DEFAULT NULL,
  `dibuat_oleh`    INT(11) DEFAULT NULL,
  `created_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_teacher` (`teacher_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Data awal indikator KPI (bobot total = 100 per kategori)
INSERT INTO `kpi_indicators` (`nama`, `kategori`, `bobot`, `satuan`, `target_default`, `sumber`, `urutan`, `keterangan`)
SELECT * FROM (
  SELECT 'Kehadiran & Ketepatan Waktu' AS nama, 'guru' AS kategori, 40 AS bobot, '%' AS satuan, 95 AS target_default, 'kehadiran' AS sumber, 1 AS urutan, 'Terisi otomatis dari rekap absensi' AS keterangan
  UNION ALL SELECT 'Kualitas Pembelajaran (evaluasi)', 'guru', 25, '%', 90, 'evaluasi', 2, 'Terisi otomatis dari rata-rata skor evaluasi'
  UNION ALL SELECT 'Kedisiplinan', 'guru', 15, '%', 90, 'manual', 3, 'Dinilai pimpinan/SDM'
  UNION ALL SELECT 'Kerjasama & Komunikasi', 'guru', 10, '%', 90, 'manual', 4, 'Dinilai pimpinan/SDM'
  UNION ALL SELECT 'Inisiatif & Pengembangan Diri', 'guru', 10, '%', 90, 'manual', 5, 'Dinilai pimpinan/SDM'
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM `kpi_indicators`);

INSERT INTO `kpi_indicators` (`nama`, `kategori`, `bobot`, `satuan`, `target_default`, `sumber`, `urutan`, `keterangan`)
SELECT * FROM (
  SELECT 'Kehadiran & Ketepatan Waktu' AS nama, 'staf' AS kategori, 40 AS bobot, '%' AS satuan, 95 AS target_default, 'kehadiran' AS sumber, 1 AS urutan, 'Terisi otomatis dari rekap absensi' AS keterangan
  UNION ALL SELECT 'Kualitas Layanan (evaluasi)', 'staf', 25, '%', 90, 'evaluasi', 2, 'Terisi otomatis dari rata-rata skor evaluasi'
  UNION ALL SELECT 'Kedisiplinan Administrasi', 'staf', 15, '%', 90, 'manual', 3, 'Ketepatan laporan & berkas'
  UNION ALL SELECT 'Kerjasama Tim', 'staf', 10, '%', 90, 'manual', 4, 'Dinilai pimpinan/SDM'
  UNION ALL SELECT 'Inisiatif & Perbaikan Proses', 'staf', 10, '%', 90, 'manual', 5, 'Dinilai pimpinan/SDM'
) AS seed2
WHERE NOT EXISTS (SELECT 1 FROM `kpi_indicators` WHERE `kategori` = 'staf');

-- 8. Kolom workflow penilaian pada kpi_scores.
--    Idempotent: guarded via information_schema so it is safe to re-run on
--    both MySQL and MariaDB (no reliance on ADD COLUMN IF NOT EXISTS).
DROP PROCEDURE IF EXISTS _add_col_if_missing;
DELIMITER $$
CREATE PROCEDURE _add_col_if_missing(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND COLUMN_NAME = p_column
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

CALL _add_col_if_missing('kpi_scores', 'status', 'ENUM(''draft'',''submitted'',''approved'') NOT NULL DEFAULT ''draft'' COMMENT ''Status penilaian KPI'' AFTER `skor`');

DROP PROCEDURE IF EXISTS _add_col_if_missing;
