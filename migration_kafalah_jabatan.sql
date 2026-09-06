-- ============================================================
-- Referensi Tunjangan Jabatan (input sesuai jabatan)
-- Default value Tunj. Struktural per jabatan.
-- Bendahara bisa edit nominal di Pengaturan KAFALAH.
-- ============================================================

CREATE TABLE IF NOT EXISTS `kafalah_jabatan_tunjangan` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `jabatan_key` VARCHAR(50) NOT NULL COMMENT 'kepalasekolah, bendahara, walikelas, guru, admin, tu, operator, dll',
  `jabatan_label` VARCHAR(100) NOT NULL,
  `nominal` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_key` (`jabatan_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `kafalah_jabatan_tunjangan` (jabatan_key, jabatan_label, nominal) VALUES
  ('kepalasekolah', 'Kepala Sekolah', 800000),
  ('kepsek', 'Kepala Sekolah', 800000),
  ('pimpinanpondok', 'Pimpinan Pondok', 500000),
  ('bendahara', 'Bendahara', 400000),
  ('bendaharawali', 'Bendahara/Wali Kelas', 500000),
  ('walikelas', 'Wali Kelas', 100000),
  ('walikelasmengaji', 'Wali Kelas (Mengaji)', 100000),
  ('pjinternalpondok', 'PJ. Internal Pondok', 500000),
  ('guru', 'Guru', 0),
  ('tu', 'Tata Usaha', 400000),
  ('operator', 'Operator', 100000),
  ('admin', 'Admin', 0);
