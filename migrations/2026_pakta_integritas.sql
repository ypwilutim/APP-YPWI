-- ============================================================
-- MIGRASI: PAKTA INTEGRITAS DIGITAL
-- Date: 2026-07-14
-- Fitur: Pengisian Pakta Integritas dengan tanda tangan digital.
-- Skrip idempoten (aman dijalankan berulang).
-- ============================================================

-- 1. Tabel utama status & hasil pakta per guru per periode
CREATE TABLE IF NOT EXISTS `pakta_integritas` (
  `id`                INT(11) NOT NULL AUTO_INCREMENT,
  `teacher_id`        INT(11) NOT NULL                COMMENT 'FK ke teachers.id (penandatangan)',
  `tenant_id`         VARCHAR(20) NOT NULL            COMMENT 'Tenant sekolah penandatangan',
  `periode`           VARCHAR(7) NOT NULL             COMMENT 'YYYY-MM periode pakta',
  `status`            ENUM('belum','sudah','ditolak') NOT NULL DEFAULT 'belum',
  `pdf_path`          VARCHAR(255) DEFAULT NULL       COMMENT 'Path relatif file PDF hasil tanda tangan',
  `signature_data`    LONGTEXT DEFAULT NULL           COMMENT 'Data URL tanda tangan (PNG base64)',
  `signed_at`         TIMESTAMP NULL DEFAULT NULL     COMMENT 'Waktu penandatanganan',
  `created_at`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_teacher_periode` (`teacher_id`, `periode`),
  KEY `tenant_id` (`tenant_id`),
  KEY `status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Tabel master konfigurasi pakta (teks, klausul sanksi, aktif/nonaktif)
--    Dipisah agar teks & nominal sanksi mudah diubah tanpa deploy ulang.
CREATE TABLE IF NOT EXISTS `pakta_config` (
  `id`                INT(11) NOT NULL DEFAULT 1,
  `judul`             VARCHAR(255) NOT NULL DEFAULT 'Pakta Integritas',
  `teks_pakta`        TEXT NOT NULL                   COMMENT 'Teks isi pakta (HTML aman / plain)',
  `klausul_sanksi`    TEXT DEFAULT NULL               COMMENT 'Teks klausul sanksi',
  `nominal_sanksi`    DECIMAL(12,2) NOT NULL DEFAULT 1500000.00 COMMENT 'Rp 1.500.000',
  `is_active`         TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `pakta_config` (`id`, `judul`, `teks_pakta`, `klausul_sanksi`, `nominal_sanksi`, `is_active`)
VALUES (
  1,
  'SURAT PERNYATAAN KOMITMEN',
  '["Saya siap untuk mengikuti program coaching THE INFLUENTIAL LEADER bersama Coach Bambang Triyawan dengan total 10 sesi pertemuan dengan sebaik-baiknya dari awal hingga akhir. Termasuk di dalamnya kesiapan untuk mengerjakan tugas-tugas yang diberikan coach secara disiplin dan penuh tanggung jawab.","Saya siap untuk menerapkan hasil pembelajaran dalam pekerjaan saya sebagai pimpinan di sekolah.","Saya siap untuk menunjukkan loyalitas kepada sekolah tempat saya mengabdi dengan tidak mengundurkan diri dalam waktu 1 tahun ke depan.","Saya menyatakan bersedia mengikuti seluruh rangkaian program dengan penuh komitmen. Apabila saya tidak menghadiri secara penuh 10 (sepuluh) kali pertemuan dalam program ini dan/atau tidak mengerjakan tugas yang telah ditetapkan tanpa alasan yang dapat dipertanggungjawabkan, maka saya bersedia mengganti biaya program sebesar Rp1.500.000,- (satu juta lima ratus ribu rupiah).","Demikian pernyataan ini saya buat tanpa paksaan pihak manapun dan menjadi pedoman untuk menilai komitmen saya berkaitan dengan program coaching yang akan saya ikuti."]',
  'Apabila saya tidak menghadiri secara penuh 10 (sepuluh) kali pertemuan dalam program ini dan/atau tidak mengerjakan tugas yang telah ditetapkan tanpa alasan yang dapat dipertanggungjawabkan, maka saya bersedia mengganti biaya program sebesar Rp1.500.000,- (satu juta lima ratus ribu rupiah).',
  1500000.00,
  1
) ON DUPLICATE KEY UPDATE `id` = `id`;

UPDATE `pakta_config` SET
  `judul` = 'SURAT PERNYATAAN KOMITMEN',
  `teks_pakta` = '["Saya siap untuk mengikuti program coaching THE INFLUENTIAL LEADER bersama Coach Bambang Triyawan dengan total 10 sesi pertemuan dengan sebaik-baiknya dari awal hingga akhir. Termasuk di dalamnya kesiapan untuk mengerjakan tugas-tugas yang diberikan coach secara disiplin dan penuh tanggung jawab.","Saya siap untuk menerapkan hasil pembelajaran dalam pekerjaan saya sebagai pimpinan di sekolah.","Saya siap untuk menunjukkan loyalitas kepada sekolah tempat saya mengabdi dengan tidak mengundurkan diri dalam waktu 1 tahun ke depan.","Saya menyatakan bersedia mengikuti seluruh rangkaian program dengan penuh komitmen. Apabila saya tidak menghadiri secara penuh 10 (sepuluh) kali pertemuan dalam program ini dan/atau tidak mengerjakan tugas yang telah ditetapkan tanpa alasan yang dapat dipertanggungjawabkan, maka saya bersedia mengganti biaya program sebesar Rp1.500.000,- (satu juta lima ratus ribu rupiah).","Demikian pernyataan ini saya buat tanpa paksaan pihak manapun dan menjadi pedoman untuk menilai komitmen saya berkaitan dengan program coaching yang akan saya ikuti."]',
  `klausul_sanksi` = 'Apabila saya tidak menghadiri secara penuh 10 (sepuluh) kali pertemuan dalam program ini dan/atau tidak mengerjakan tugas yang telah ditetapkan tanpa alasan yang dapat dipertanggungjawabkan, maka saya bersedia mengganti biaya program sebesar Rp1.500.000,- (satu juta lima ratus ribu rupiah).'
WHERE `id` = 1;
