SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `arrears` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(20) NOT NULL,
  `student_id` int NOT NULL,
  `amount` int DEFAULT '0',
  `month_year` varchar(7) DEFAULT NULL,
  `status` enum('paid','unpaid') DEFAULT 'unpaid',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_student` (`student_id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

CREATE TABLE IF NOT EXISTS `attendance_logs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `teacher_id` int NOT NULL,
  `rule_id` int DEFAULT NULL,
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `waktu_scan` datetime NOT NULL,
  `jenis` enum('masuk','pulang') COLLATE utf8mb4_unicode_ci NOT NULL,
  `metode` enum('dashboard','scanner') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'scanner',
  `status` enum('tepat_waktu','terlambat') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'tepat_waktu',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `selfie_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `keterangan` text COLLATE utf8mb4_unicode_ci,
  `dinas_luar` tinyint(1) DEFAULT '0',
  `kegiatan_dinas` text COLLATE utf8mb4_unicode_ci,
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `waktu_absen` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_teacher_id` (`teacher_id`),
  KEY `idx_tenant_id` (`tenant_id`),
  KEY `idx_waktu_scan` (`waktu_scan`),
  KEY `idx_jenis` (`jenis`),
  KEY `idx_rule_id` (`rule_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `attendance_rules` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `hari` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tipe` enum('Datang','Pulang') COLLATE utf8mb4_unicode_ci NOT NULL,
  `jam_mulai` time NOT NULL,
  `jam_selesai` time NOT NULL,
  `keterangan` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status_log` enum('tepat_waktu','terlambat','pulang_cepat','lembur') COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `tipe_unit` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_id` (`tenant_id`),
  KEY `idx_tipe_unit` (`tipe_unit`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `attendance_summary` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `date` date NOT NULL,
  `total_teachers` int DEFAULT '0',
  `present` int DEFAULT '0',
  `late` int DEFAULT '0',
  `absent` int DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `tenant_date` (`tenant_id`,`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `auto_billing_reports` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `periode` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `student_id` int NOT NULL,
  `nama_siswa` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `no_wa` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `saldo` decimal(10,2) DEFAULT '0.00',
  `status` enum('terkirim','gagal','no_wa') COLLATE utf8mb4_unicode_ci NOT NULL,
  `message_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_periode` (`periode`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bill_settings` (
  `id` int NOT NULL,
  `send_day` int DEFAULT '1',
  `due_day` int DEFAULT '10',
  `is_enabled` tinyint(1) DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `billing_payment` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `student_id` int NOT NULL,
  `spp_bulanan` decimal(12,2) DEFAULT '0.00',
  `ransportasi` decimal(12,2) DEFAULT '0.00',
  `subsidi` decimal(12,2) DEFAULT '0.00',
  `biaya_admin_va` decimal(12,2) DEFAULT '0.00',
  `bulan` varchar(7) COLLATE utf8mb4_unicode_ci NOT NULL,
  `transaksi` decimal(12,2) DEFAULT '0.00',
  `keterangan_spp` decimal(12,2) DEFAULT '0.00',
  `status` enum('lunas','belum') COLLATE utf8mb4_unicode_ci DEFAULT 'belum',
  `metode_pembayaran` enum('tunai','transfer_pusat','gateway','belum_bayar') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tanggal_bayar` date DEFAULT NULL,
  `dibayar_oleh` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `catatan_pelunasan` text COLLATE utf8mb4_unicode_ci,
  `catatan` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `subsid` decimal(12,2) DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_student_bulan` (`student_id`,`bulan`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_bulan` (`bulan`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `billing_payment_allocations` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `billing_id` bigint NOT NULL,
  `incoming_payment_id` bigint NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_billing` (`billing_id`),
  KEY `idx_incoming` (`incoming_payment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bsi_va_records` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(50) NOT NULL,
  `student_id` int NOT NULL,
  `va_number` varchar(50) NOT NULL,
  `va_name` varchar(255) DEFAULT NULL,
  `amount` decimal(15,2) DEFAULT NULL,
  `status` enum('active','paid','expired') DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `paid_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_student_va` (`student_id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

CREATE TABLE IF NOT EXISTS `calon_donatur_pundi_ceria` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nama_calon_donatur` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `no_wa` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nama_siswa` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `kelas` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sekolah_yayasan` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `keterangan` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('calon','menjadi_donatur','non-aktif') COLLATE utf8mb4_unicode_ci DEFAULT 'calon',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_no_wa` (`no_wa`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `chat_messages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `conversation_id` int NOT NULL,
  `sender_id` int NOT NULL,
  `sender_name` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `sender_type` enum('guru','parent') COLLATE utf8mb4_general_ci DEFAULT 'guru',
  `message` text COLLATE utf8mb4_general_ci NOT NULL,
  `reply_to_message_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_conversation` (`conversation_id`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `classes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nama_kelas` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tingkatan` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_classes_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `conversation_participants` (
  `id` int NOT NULL AUTO_INCREMENT,
  `conversation_id` int NOT NULL,
  `user_id` int NOT NULL,
  `user_type` enum('guru','parent') COLLATE utf8mb4_general_ci DEFAULT 'guru',
  `last_read_at` timestamp NULL DEFAULT NULL,
  `is_typing` tinyint(1) DEFAULT '0',
  `typing_expires_at` timestamp NULL DEFAULT NULL,
  `last_seen_at` timestamp NULL DEFAULT NULL,
  `joined_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_participant` (`conversation_id`,`user_id`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `conversations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `is_global` tinyint(1) DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `donatur_pundi_ceria` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nama_donatur` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `no_wa` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nama_siswa` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `kelas` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sekolah_yayasan` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('aktif','non-aktif') COLLATE utf8mb4_unicode_ci DEFAULT 'aktif',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `email_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `from_email` varchar(255) NOT NULL,
  `to_email` varchar(255) NOT NULL,
  `cc` varchar(255) DEFAULT NULL,
  `bcc` varchar(255) DEFAULT NULL,
  `subject` varchar(255) NOT NULL,
  `category` varchar(100) DEFAULT 'system',
  `related_id` int DEFAULT NULL,
  `status` enum('pending','sent','failed','draft') DEFAULT 'pending',
  `message_id` varchar(255) DEFAULT NULL,
  `error_message` text,
  `body_text` text,
  `body_html` longtext,
  `has_attachments` tinyint(1) DEFAULT '0',
  `is_read` tinyint(1) DEFAULT '0',
  `sent_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

CREATE TABLE IF NOT EXISTS `employment_rules` (
  `id` int NOT NULL,
  `job_title_pattern` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `employment_type` enum('PTY','PTTY','GTY','GTTY') COLLATE utf8mb4_general_ci NOT NULL,
  `min_years` int NOT NULL DEFAULT '0',
  `max_years` int NOT NULL DEFAULT '2',
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_title` (`job_title_pattern`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `employment_status_rules` (
  `id` int NOT NULL,
  `employment_type` enum('PTY','PTTY','GTY','GTTY') COLLATE utf8mb4_general_ci NOT NULL,
  `min_years` int NOT NULL,
  `max_years` int NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `evaluations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `teacher_id` int NOT NULL,
  `evaluator_id` int NOT NULL,
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `score` int NOT NULL,
  `category` enum('kehadiran','disiplin','profesionalisme','komunikasi','kepemimpinan') COLLATE utf8mb4_unicode_ci DEFAULT 'kehadiran',
  `notes` mediumtext COLLATE utf8mb4_unicode_ci,
  `evaluation_date` date DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_teacher_id` (`teacher_id`),
  KEY `idx_evaluator_id` (`evaluator_id`),
  CONSTRAINT `evaluations_chk_1` CHECK (((`score` >= 1) and (`score` <= 5)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `financial_categories` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `jenis` enum('beli','bayar','pemasukan','pengeluaran') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pengeluaran',
  `nama` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `urutan` int DEFAULT '0',
  `kelompok_akun` enum('aset','aset_tetap','liabilitas','aset_net_terbatas','aset_net_tanpa_batas','pendapatan','beban','modal') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_tenant_jenis_nama` (`tenant_id`,`jenis`,`nama`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `financial_transaction_items` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `transaction_id` bigint NOT NULL,
  `no_urut` int NOT NULL DEFAULT '1',
  `nama_barang` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `qty` decimal(12,2) NOT NULL DEFAULT '1.00',
  `harga` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total` decimal(15,2) NOT NULL DEFAULT '0.00',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_transaksi` (`transaction_id`),
  KEY `idx_transaksi_urut` (`transaction_id`,`no_urut`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `financial_transactions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tanggal` date NOT NULL,
  `jenis` enum('beli','bayar','pemasukan','pengeluaran') COLLATE utf8mb4_unicode_ci NOT NULL,
  `kategori` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `akun` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `keterangan` text COLLATE utf8mb4_unicode_ci,
  `nominal` decimal(15,2) NOT NULL DEFAULT '0.00',
  `no_bukti` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `foto_struk` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `foto_barang` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'approved',
  `created_by` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_tanggal` (`tenant_id`,`tanggal`),
  KEY `idx_tenant_jenis` (`tenant_id`,`jenis`),
  KEY `idx_tenant_kategori` (`tenant_id`,`kategori`),
  KEY `idx_tenant_status` (`tenant_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_contracts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `teacher_id` int NOT NULL COMMENT 'FK ke teachers.id',
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Unit/tenant penempatan',
  `jenis` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PKWT' COMMENT 'PKWT/PKWTT/Honorer/Perjanjian Kerja',
  `nomor` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Nomor kontrak',
  `tanggal_mulai` date NOT NULL,
  `tanggal_selesai` date DEFAULT NULL COMMENT 'NULL = masa kerja tetap',
  `status` enum('aktif','habis','diperpanjang','diakhiri') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'aktif',
  `nilai_kontrak` decimal(14,2) DEFAULT NULL,
  `file_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Scan kontrak (path /uploads/hr/...)',
  `catatan` text COLLATE utf8mb4_unicode_ci,
  `dokumen_kelengkapan` json DEFAULT NULL COMMENT 'Checklist dokumen kontrak',
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_teacher` (`teacher_id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_status` (`status`),
  KEY `idx_selesai` (`tanggal_selesai`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_documents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nomor_surat` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `jenis` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'surat_keterangan_kerja/surat_tugas/pengangkatan/kontrak/lainnya',
  `teacher_id` int DEFAULT NULL COMMENT 'NULL untuk surat kolektif',
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tanggal` date NOT NULL,
  `perihal` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `isi` mediumtext COLLATE utf8mb4_unicode_ci COMMENT 'Isi/ringkasan surat',
  `file_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'File .docx/.pdf di /downloads/',
  `template` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Nama template yang dipakai',
  `status` enum('draft','terbit','dibatalkan') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'terbit',
  `dibuat_oleh` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_teacher` (`teacher_id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_jenis` (`jenis`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_status_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `teacher_id` int NOT NULL,
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `jenis_perubahan` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'jabatan/status_kepegawaian/tmt/unit/gaji/data',
  `sebelum` text COLLATE utf8mb4_unicode_ci,
  `sesudah` text COLLATE utf8mb4_unicode_ci,
  `tanggal_efektif` date DEFAULT NULL,
  `dibuat_oleh` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_teacher` (`teacher_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `idcard_templates` (
  `id` int NOT NULL,
  `template_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `template_data` longtext COLLATE utf8mb4_unicode_ci,
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `template_type` enum('teacher','student') COLLATE utf8mb4_unicode_ci DEFAULT 'teacher',
  `preview_image` longtext COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`),
  UNIQUE KEY `template_name` (`template_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `incoming_payments` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `transaction_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_account` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `beneficiary_account` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `billing_number` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_additional_1` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_additional_2` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_additional_3` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_additional_4` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_additional_5` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_additional_6` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_additional_7` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_additional_8` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_additional_9` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `beneficiary_additional_1` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `beneficiary_additional_2` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `beneficiary_additional_3` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `beneficiary_additional_4` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `beneficiary_additional_5` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `beneficiary_additional_6` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `beneficiary_additional_7` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `beneficiary_additional_8` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `beneficiary_additional_9` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `remarks` text COLLATE utf8mb4_unicode_ci,
  `transaction_date_time` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `transaction_datetime` datetime DEFAULT NULL,
  `total_amount` decimal(12,2) DEFAULT '0.00',
  `channel` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `transfer_type` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `matched_student_id` int DEFAULT NULL,
  `periode` varchar(7) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_benef` (`beneficiary_account`),
  KEY `idx_matched` (`matched_student_id`),
  KEY `idx_periode` (`periode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `jadwal_pelajaran` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `class_id` int DEFAULT NULL,
  `hari` enum('Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu') COLLATE utf8mb4_unicode_ci NOT NULL,
  `periode_ke` int NOT NULL,
  `jam_mulai` time NOT NULL,
  `jam_selesai` time NOT NULL,
  `mata_pelajaran` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `guru` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ruangan` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `keterangan` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_class_id` (`class_id`),
  KEY `idx_tenant_id` (`tenant_id`),
  KEY `idx_hari` (`hari`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `kafalah_base_mode` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `base_mode` enum('global','school') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'global',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user_tenant` (`user_id`,`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `kafalah_gaji_matrix` (
  `id` int NOT NULL AUTO_INCREMENT,
  `status_pegawai` enum('PT','PK') COLLATE utf8mb4_unicode_ci NOT NULL,
  `jenjang` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `pendidikan` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `masa_kerja_min` int NOT NULL,
  `masa_kerja_max` int NOT NULL,
  `nominal` decimal(12,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  KEY `idx_lookup` (`status_pegawai`,`jenjang`,`pendidikan`,`masa_kerja_min`,`masa_kerja_max`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `kafalah_gaji_pokok_config` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status_pegawai` enum('PT','PK') COLLATE utf8mb4_unicode_ci NOT NULL,
  `jenjang` enum('TK','SD','SMP','SMA','PONPES') COLLATE utf8mb4_unicode_ci NOT NULL,
  `pendidikan` enum('SMA','D3','S1','S2','S3') COLLATE utf8mb4_unicode_ci NOT NULL,
  `gaji_pokok_base` decimal(12,2) NOT NULL DEFAULT '0.00',
  `kenaikan_per_tahun` decimal(12,2) NOT NULL DEFAULT '0.00',
  `interval_tahun` int NOT NULL DEFAULT '2',
  `masa_kerja_max` int NOT NULL DEFAULT '30',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_config` (`tenant_id`,`status_pegawai`,`jenjang`,`pendidikan`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `kafalah_jabatan_tunjangan` (
  `id` int NOT NULL AUTO_INCREMENT,
  `jabatan_key` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `jabatan_label` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nominal` decimal(12,2) NOT NULL DEFAULT '0.00',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_key` (`jabatan_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `kafalah_kenaikan_config` (
  `id` int NOT NULL AUTO_INCREMENT,
  `status_pegawai` enum('PT','PK') COLLATE utf8mb4_unicode_ci NOT NULL,
  `jenjang` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `pendidikan` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `gaji_awal` decimal(12,2) NOT NULL DEFAULT '0.00',
  `kenaikan_per_tahun` decimal(12,2) NOT NULL DEFAULT '0.00',
  `interval_tahun` int NOT NULL DEFAULT '2',
  `masa_kerja_max` int NOT NULL DEFAULT '20',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_combo` (`status_pegawai`,`jenjang`,`pendidikan`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `kafalah_payroll` (
  `id` int NOT NULL AUTO_INCREMENT,
  `teacher_id` int NOT NULL,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `periode_mulai` date NOT NULL,
  `periode_selesai` date NOT NULL,
  `label_periode` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nama` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nik` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `jabatan` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status_pegawai` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `jenjang` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pendidikan` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `masa_kerja_tahun` int DEFAULT '0',
  `jumlah_anak` int DEFAULT '0',
  `predikat_kinerja` varchar(5) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `hari_efektif` int DEFAULT '0',
  `hadir` int DEFAULT '0',
  `tidak_hadir` int DEFAULT '0',
  `tepat_waktu` int DEFAULT '0',
  `terlambat` int DEFAULT '0',
  `tidak_absen_masuk` int DEFAULT '0',
  `cepat_pulang` int DEFAULT '0',
  `tidak_absen_pulang` int DEFAULT '0',
  `kjm` int DEFAULT '0',
  `kafalah_pokok` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_keluarga_istri` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_keluarga_anak` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_a` decimal(14,2) NOT NULL DEFAULT '0.00',
  `tunj_struktural` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_pengabdian` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_fungsional` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_pembina` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_pondok` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_transport` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_tepat_waktu` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_tidak_cepat_pulang` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_kjm` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_prestasi_kinerja` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_apresiasi` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_b` decimal(14,2) NOT NULL DEFAULT '0.00',
  `potong_taawun` decimal(12,2) NOT NULL DEFAULT '0.00',
  `potong_simt` decimal(12,2) NOT NULL DEFAULT '0.00',
  `potong_pinjaman` decimal(12,2) NOT NULL DEFAULT '0.00',
  `potong_cuti_luar_tanggungan` decimal(12,2) NOT NULL DEFAULT '0.00',
  `potong_persen_cuti` decimal(5,2) NOT NULL DEFAULT '0.00',
  `total_c` decimal(14,2) NOT NULL DEFAULT '0.00',
  `total_pendapatan` decimal(14,2) NOT NULL DEFAULT '0.00',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_manual_edit` tinyint(1) NOT NULL DEFAULT '0',
  `base_mode_used` enum('global','school') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_teacher_periode` (`teacher_id`,`tenant_id`,`periode_mulai`,`periode_selesai`),
  KEY `idx_periode` (`periode_mulai`,`periode_selesai`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `kafalah_pendidikan_ref` (
  `id` int NOT NULL AUTO_INCREMENT,
  `kode` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `urutan` int NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_kode` (`kode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `kafalah_settings` (
  `id` int NOT NULL DEFAULT '1',
  `tunj_pengabdian` decimal(12,2) NOT NULL DEFAULT '150000.00',
  `tunj_fungsional` decimal(12,2) NOT NULL DEFAULT '100000.00',
  `tunj_transport` decimal(12,2) NOT NULL DEFAULT '168000.00',
  `tunj_tepat_waktu` decimal(12,2) NOT NULL DEFAULT '120000.00',
  `tunj_tidak_cepat_pulang` decimal(12,2) NOT NULL DEFAULT '120000.00',
  `tunj_prestasi_kinerja` decimal(12,2) NOT NULL DEFAULT '150000.00',
  `nominal_kjm` decimal(12,2) NOT NULL DEFAULT '10000.00',
  `tunj_pembina` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_pondok` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_anak` decimal(12,2) NOT NULL DEFAULT '20000.00',
  `tunj_istri` decimal(12,2) NOT NULL DEFAULT '0.00',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `level` enum('global','school') COLLATE utf8mb4_unicode_ci DEFAULT 'global',
  `tunj_struktural` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_uang_makan` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_apresiasi` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_jam_mengajar` decimal(12,2) NOT NULL DEFAULT '0.00',
  `pot_luar_tanggungan` decimal(12,2) NOT NULL DEFAULT '0.00',
  `pot_durasi_simt` decimal(12,2) NOT NULL DEFAULT '0.00',
  `pot_taawun` decimal(12,2) NOT NULL DEFAULT '0.00',
  `pot_piutang` decimal(12,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `kafalah_teacher_overrides` (
  `id` int NOT NULL AUTO_INCREMENT,
  `teacher_id` int NOT NULL,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tunj_struktural` decimal(12,2) DEFAULT NULL,
  `tunj_pembina` decimal(12,2) DEFAULT NULL,
  `tunj_pondok` decimal(12,2) DEFAULT NULL,
  `tunj_apresiasi` decimal(12,2) DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_active` tinyint(1) NOT NULL DEFAULT '0',
  `tunj_transport` decimal(12,2) DEFAULT NULL,
  `tunj_tepat_waktu` decimal(12,2) DEFAULT NULL,
  `tunj_tidak_cepat_pulang` decimal(12,2) DEFAULT NULL,
  `tunj_uang_makan` decimal(12,2) DEFAULT NULL,
  `tunj_fungsional` decimal(12,2) DEFAULT NULL,
  `tunj_prestasi_kinerja` decimal(12,2) DEFAULT NULL,
  `tunj_jam_mengajar` decimal(12,2) DEFAULT NULL,
  `tunj_istri` decimal(12,2) DEFAULT NULL,
  `tunj_anak` decimal(12,2) DEFAULT NULL,
  `nominal_kjm` decimal(12,2) DEFAULT NULL,
  `pot_luar_tanggungan` decimal(12,2) DEFAULT NULL,
  `pot_durasi_simt` decimal(12,2) DEFAULT NULL,
  `pot_taawun` decimal(12,2) DEFAULT NULL,
  `pot_piutang` decimal(12,2) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_teacher_tenant` (`teacher_id`,`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `kpi_indicators` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nama` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `kategori` enum('guru','staf') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'guru',
  `bobot` decimal(5,2) NOT NULL DEFAULT '0.00' COMMENT 'Bobot dalam persen, total seluruh indikator = 100',
  `satuan` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT '%' COMMENT 'Satuan nilai aktual',
  `target_default` decimal(12,2) NOT NULL DEFAULT '100.00',
  `sumber` enum('manual','kehadiran','evaluasi') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual',
  `scoring_method` enum('discrete_1_4','percent_0_100','scale_1_5','custom') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'discrete_1_4' COMMENT 'Metode scoring: 1-4, 0-100, 1-5, custom',
  `score_min` decimal(5,2) DEFAULT '0.00' COMMENT 'Minimum score untuk custom method',
  `score_max` decimal(5,2) DEFAULT '100.00' COMMENT 'Maximum score untuk custom method',
  `urutan` int NOT NULL DEFAULT '0',
  `aktif` tinyint(1) NOT NULL DEFAULT '1',
  `keterangan` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_kategori` (`kategori`),
  KEY `idx_aktif` (`aktif`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `kpi_periods` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nama` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Contoh: Oktober 2026 / Semester 1 2026/2027',
  `jenis` enum('bulanan','semester','tahunan') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'bulanan',
  `bulan` tinyint DEFAULT NULL COMMENT '1-12 untuk periode bulanan',
  `tahun` smallint unsigned NOT NULL,
  `tanggal_mulai` date DEFAULT NULL,
  `tanggal_selesai` date DEFAULT NULL,
  `status` enum('draft','aktif','published') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_periode` (`nama`,`tahun`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `kpi_scores` (
  `id` int NOT NULL AUTO_INCREMENT,
  `period_id` int NOT NULL,
  `teacher_id` int NOT NULL,
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `kategori` enum('guru','staf') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'guru',
  `indicator_id` int NOT NULL,
  `nilai_aktual` decimal(12,2) NOT NULL DEFAULT '0.00',
  `target` decimal(12,2) NOT NULL DEFAULT '100.00',
  `pencapaian` decimal(7,2) NOT NULL DEFAULT '0.00' COMMENT 'Hasil % (dibatasi 0-100)',
  `skor` decimal(7,2) NOT NULL DEFAULT '0.00' COMMENT 'pencapaian x bobot/100',
  `status` enum('draft','submitted','approved') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `sumber` enum('manual','kehadiran','evaluasi') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual',
  `penilai_id` int DEFAULT NULL,
  `catatan` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_score` (`period_id`,`teacher_id`,`indicator_id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_indicator` (`indicator_id`),
  KEY `fk_kpi_scores_teacher` (`teacher_id`),
  CONSTRAINT `fk_kpi_scores_indicator` FOREIGN KEY (`indicator_id`) REFERENCES `kpi_indicators` (`id`),
  CONSTRAINT `fk_kpi_scores_period` FOREIGN KEY (`period_id`) REFERENCES `kpi_periods` (`id`),
  CONSTRAINT `fk_kpi_scores_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `leave_requests` (
  `id` int NOT NULL AUTO_INCREMENT,
  `teacher_id` int NOT NULL,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `jenis` enum('izin','sakit','cuti','dinas_luar') COLLATE utf8mb4_unicode_ci NOT NULL,
  `keterangan` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `tanggal_mulai` date NOT NULL,
  `tanggal_selesai` date NOT NULL,
  `status` enum('pending','approved','rejected') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `catatan` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`),
  KEY `fk_leave_teacher` (`teacher_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `midtrans_transactions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `student_id` int DEFAULT NULL,
  `order_id` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `gross_amount` decimal(12,2) DEFAULT '0.00',
  `transaction_status` varchar(50) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `payment_type` varchar(50) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `status` varchar(30) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `snap_token` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `redirect_url` varchar(512) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `raw` text COLLATE utf8mb4_general_ci,
  `paid_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_order` (`order_id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_student` (`student_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `migrations_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `filename` varchar(255) NOT NULL,
  `executed_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `filename` (`filename`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `mutasi_siswa` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `student_id` int NOT NULL,
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `transaction_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `va_number` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `periode` varchar(7) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `iuran` decimal(12,2) DEFAULT '0.00',
  `bayar` decimal(12,2) DEFAULT '0.00',
  `selisih` decimal(12,2) DEFAULT '0.00',
  `saldo_after` decimal(12,2) DEFAULT '0.00',
  `channel` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `transaction_date` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mutasi_students` (
  `id` int NOT NULL AUTO_INCREMENT,
  `student_id` int NOT NULL,
  `old_tenant_id` varchar(50) DEFAULT NULL,
  `new_tenant_id` varchar(50) DEFAULT NULL,
  `reason` text,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `student_id` (`student_id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

CREATE TABLE IF NOT EXISTS `pakta_config` (
  `id` int NOT NULL DEFAULT '1',
  `judul` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Pakta Integritas',
  `teks_pakta` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Teks isi pakta (HTML aman / plain)',
  `klausul_sanksi` text COLLATE utf8mb4_unicode_ci COMMENT 'Teks klausul sanksi',
  `nominal_sanksi` decimal(12,2) NOT NULL DEFAULT '1500000.00' COMMENT 'Rp 1.500.000',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `pakta_integritas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `teacher_id` int NOT NULL COMMENT 'FK ke teachers.id (penandatangan)',
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Tenant sekolah penandatangan',
  `periode` varchar(7) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'YYYY-MM periode pakta',
  `status` enum('belum','sudah','ditolak') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'belum',
  `pdf_path` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Path relatif file PDF hasil tanda tangan',
  `signature_data` longtext COLLATE utf8mb4_unicode_ci COMMENT 'Data URL tanda tangan (PNG base64)',
  `signed_at` timestamp NULL DEFAULT NULL COMMENT 'Waktu penandatanganan',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_teacher_periode` (`teacher_id`,`periode`),
  KEY `tenant_id` (`tenant_id`),
  KEY `status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `parents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nama_orang_tua` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `no_wa` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nik` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `payment_admin_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `subject_type` enum('student','teacher') COLLATE utf8mb4_unicode_ci NOT NULL,
  `subject_id` int NOT NULL,
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `biaya_admin_va` decimal(12,2) NOT NULL DEFAULT '2000.00',
  `keterangan` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_subject` (`subject_type`,`subject_id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_subject` (`subject_type`,`subject_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `payment_bsi_transactions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(20) DEFAULT NULL,
  `transaction_id` varchar(50) DEFAULT NULL,
  `source_va` varchar(50) DEFAULT NULL,
  `beneficiary_va` varchar(50) DEFAULT NULL,
  `amount` int DEFAULT '0',
  `status` varchar(20) DEFAULT 'Success',
  `transaction_date` datetime DEFAULT NULL,
  `remarks` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_beneficiary` (`beneficiary_va`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

CREATE TABLE IF NOT EXISTS `payment_gateways` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(20) COLLATE utf8mb4_general_ci NOT NULL,
  `gateway` varchar(20) COLLATE utf8mb4_general_ci NOT NULL,
  `api_key` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `api_secret` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `client_key` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '0',
  `config` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_gateway_per_tenant` (`tenant_id`,`gateway`),
  CONSTRAINT `payment_gateways_chk_1` CHECK (json_valid(`config`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `payment_invoices` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `student_id` int NOT NULL,
  `invoice_number` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `periode` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('pending','approved','paid','expired','cancelled') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `due_date` date DEFAULT NULL,
  `paid_at` datetime DEFAULT NULL,
  `paid_amount` decimal(12,2) DEFAULT NULL,
  `payment_method` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `payment_channel` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `approved_by` int DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `payment_proof_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_invoice_number` (`invoice_number`),
  KEY `idx_tenant_id` (`tenant_id`),
  KEY `idx_student_id` (`student_id`),
  KEY `idx_periode` (`periode`),
  KEY `idx_status` (`status`),
  CONSTRAINT `payment_invoices_chk_1` CHECK (json_valid(`metadata`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `payment_settings` (
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `monthly_amount` decimal(12,2) DEFAULT NULL,
  `due_day` int DEFAULT '10',
  `is_enabled` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `payment_status_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `invoice_id` int NOT NULL,
  `old_status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `new_status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `changed_by` int DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_invoice_id` (`invoice_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `payment_transactions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(20) COLLATE utf8mb4_general_ci NOT NULL,
  `student_id` int DEFAULT NULL,
  `gateway` varchar(20) COLLATE utf8mb4_general_ci NOT NULL,
  `external_id` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `amount` decimal(12,2) DEFAULT NULL,
  `status` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `payment_method` varchar(50) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_general_ci,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `paid_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_gateway` (`tenant_id`,`gateway`),
  KEY `idx_external` (`external_id`),
  KEY `idx_student` (`student_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `payment_transactions_chk_1` CHECK (json_valid(`metadata`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `payroll` (
  `id` int NOT NULL AUTO_INCREMENT,
  `teacher_id` int NOT NULL,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `periode` varchar(7) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'YYYY-MM',
  `gaji_pokok` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_kinerja` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_umum` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_istri` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_anak` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_kepala_sekolah` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_wali_kelas` decimal(12,2) NOT NULL DEFAULT '0.00',
  `honor_bendahara` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_kehadiran` decimal(12,2) NOT NULL DEFAULT '0.00',
  `potongan` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_gaji` decimal(14,2) NOT NULL DEFAULT '0.00',
  `hadir` int NOT NULL DEFAULT '0',
  `terlambat` int NOT NULL DEFAULT '0',
  `izin` int NOT NULL DEFAULT '0',
  `sakit` int NOT NULL DEFAULT '0',
  `tanpa_keterangan` int NOT NULL DEFAULT '0',
  `tidak_hadir` int NOT NULL DEFAULT '0',
  `dinas_luar` int NOT NULL DEFAULT '0',
  `cuti` int NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_teacher_periode` (`teacher_id`,`periode`),
  KEY `periode` (`periode`),
  KEY `tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `payroll_settings` (
  `id` int NOT NULL DEFAULT '1',
  `potongan_terlambat` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT 'Rupiah potongan per kali terlambat',
  `potongan_izin` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT 'Rupiah potongan per hari izin/cuti',
  `potongan_sakit` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT 'Rupiah potongan per hari sakit',
  `potongan_tanpa_keterangan` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT 'Rupiah potongan per hari tanpa keterangan (alpha)',
  `potongan_tidak_hadir` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT 'Rupiah potongan per hari tidak hadir',
  `tunj_kehadiran` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT 'T. Kehadiran (nominal tetap, semua guru aktif)',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `profile_access_requests` (
  `id` int NOT NULL AUTO_INCREMENT,
  `session_id` varchar(255) NOT NULL,
  `requester_name` varchar(255) NOT NULL,
  `requester_email` varchar(255) DEFAULT NULL,
  `reason` text,
  `status` enum('pending','approved','denied') DEFAULT 'pending',
  `approved_by` int DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `notes` text,
  `selfie_url` varchar(500) DEFAULT NULL,
  `ktp_url` varchar(500) DEFAULT NULL,
  `ktp_nik` varchar(20) DEFAULT NULL,
  `ktp_nama` varchar(255) DEFAULT NULL,
  `ktp_alamat` text,
  `ktp_tempat_lahir` varchar(255) DEFAULT NULL,
  `ktp_tanggal_lahir` date DEFAULT NULL,
  `ktp_jenis_kelamin` varchar(10) DEFAULT NULL,
  `ktp_golongan_darah` varchar(5) DEFAULT NULL,
  `ktp_agama` varchar(50) DEFAULT NULL,
  `ktp_status_perkawinan` varchar(50) DEFAULT NULL,
  `ktp_pekerjaan` varchar(100) DEFAULT NULL,
  `ktp_kewarganegaraan` varchar(10) DEFAULT NULL,
  `ktp_berlaku_hingga` varchar(100) DEFAULT NULL,
  `ktp_rt_rw` varchar(10) DEFAULT NULL,
  `ktp_kel_desa` varchar(100) DEFAULT NULL,
  `ktp_kecamatan` varchar(100) DEFAULT NULL,
  `verification_status` enum('pending','verified','failed') DEFAULT 'pending',
  `matched_teacher_id` int DEFAULT NULL,
  `matched_user_id` int DEFAULT NULL,
  `verification_token` varchar(255) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `session_id` (`session_id`),
  KEY `status` (`status`),
  KEY `ktp_nik` (`ktp_nik`),
  KEY `verification_status` (`verification_status`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

CREATE TABLE IF NOT EXISTS `qr_attendance_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `scan_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `teacher_id` int DEFAULT NULL,
  `device_id` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `waktu_scan` datetime NOT NULL,
  `jenis` enum('masuk','pulang') COLLATE utf8mb4_unicode_ci NOT NULL,
  `signature` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sync_status` enum('pending','synced','failed','rejected') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `offline_validated` tinyint(1) DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `synced_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_scan_id` (`scan_id`),
  KEY `idx_device_id` (`device_id`),
  KEY `idx_teacher_id` (`teacher_id`),
  KEY `idx_tenant_id` (`tenant_id`),
  KEY `idx_sync_status` (`sync_status`),
  KEY `idx_waktu_scan` (`waktu_scan`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `relief_requests` (
  `id` int NOT NULL AUTO_INCREMENT,
  `student_id` int NOT NULL,
  `invoice_id` int NOT NULL,
  `requested_amount` decimal(10,2) DEFAULT NULL,
  `reason` text COLLATE utf8mb4_general_ci,
  `status` enum('pending','approved','rejected') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'pending',
  `relief_amount` decimal(10,2) DEFAULT '0.00',
  `reviewed_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_relief_student` (`student_id`),
  KEY `idx_relief_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `salary_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `level` enum('central','school','individual') COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'YPWILUTIM for central, specific tenant for school/individual',
  `teacher_id` int DEFAULT NULL COMMENT 'Only for individual level',
  `setting_name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Component name: kafalah_pokok, tunj_keluarga, etc.',
  `setting_value` decimal(14,2) NOT NULL DEFAULT '0.00',
  `is_override` tinyint(1) NOT NULL DEFAULT '0' COMMENT '1 if this overrides parent level',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_setting` (`level`,`tenant_id`,`teacher_id`,`setting_name`),
  KEY `idx_level` (`level`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_teacher` (`teacher_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `saldo_siswa` (
  `id` int NOT NULL AUTO_INCREMENT,
  `student_id` int NOT NULL,
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `saldo` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '- = tunggakan, + = kelebihan',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_student` (`student_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `scanner_devices` (
  `id` int NOT NULL AUTO_INCREMENT,
  `device_id` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `registration_token` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `school_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `secret_key` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('active','inactive','maintenance') COLLATE utf8mb4_unicode_ci DEFAULT 'inactive',
  `last_sync` datetime DEFAULT NULL,
  `device_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `device_id` (`device_id`),
  KEY `idx_tenant_id` (`tenant_id`),
  KEY `idx_device_id` (`device_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `semester` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tahun_ajaran_id` int NOT NULL,
  `nama` enum('Ganjil','Genap') COLLATE utf8mb4_unicode_ci NOT NULL,
  `tanggal_mulai` date NOT NULL,
  `tanggal_selesai` date NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_semester_ta_nama` (`tahun_ajaran_id`,`nama`),
  KEY `idx_semester_ta` (`tahun_ajaran_id`),
  KEY `idx_semester_date` (`tanggal_mulai`,`tanggal_selesai`),
  CONSTRAINT `fk_semester_tahun_ajaran` FOREIGN KEY (`tahun_ajaran_id`) REFERENCES `tahun_ajaran` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sk_approval_queue` (
  `id` int NOT NULL AUTO_INCREMENT,
  `teacher_id` int NOT NULL,
  `tenant_id` varchar(50) NOT NULL,
  `status` enum('pending','approved','rejected') DEFAULT 'pending',
  `tentang_type` varchar(50) DEFAULT 'baru',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_status` (`tenant_id`,`status`),
  KEY `idx_teacher` (`teacher_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sk_automation_settings` (
  `id` int NOT NULL,
  `min_service_years` int NOT NULL DEFAULT '2',
  `auto_generate_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `schedule_day` int NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `auto_generate_date` varchar(5) COLLATE utf8mb4_unicode_ci DEFAULT '01-01',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sk_guru` (
  `id` int NOT NULL AUTO_INCREMENT,
  `teacher_id` int NOT NULL,
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tahun_ajaran_id` int DEFAULT NULL COMMENT 'FK ke tahun_ajaran',
  `no_surat` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tentang` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ttl` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tmt` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pt` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `niy` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `unit` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bh` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bm` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tgl_mulai` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Tanggal mulai penunjukan',
  `tgl_selesai` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Tanggal selesai penunjukan',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `jabatan` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tentag_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `manual_verified` tinyint(1) NOT NULL DEFAULT '0' COMMENT '1=SK dibuat via verifikasi manual operator (belum memenuhi syarat masa kerja)',
  `drive_file_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `drive_file_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `drive_folder_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `drive_web_view_link` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `drive_uploaded_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_teacher_id` (`teacher_id`),
  KEY `idx_tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sk_sequence` (
  `tenant_id` varchar(20) COLLATE utf8mb4_general_ci NOT NULL,
  `hijri_year` int NOT NULL,
  `hijri_month` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `last_number` int NOT NULL DEFAULT '0',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`tenant_id`,`hijri_year`),
  KEY `idx_tenant_hijri` (`tenant_id`,`hijri_year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `spmb_committees` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `teacher_id` int NOT NULL,
  `spmb_role` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_tenant_teacher` (`tenant_id`,`teacher_id`,`is_active`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_teacher` (`teacher_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `spmb_configs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `judul_flyer` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `keterangan_flyer` text COLLATE utf8mb4_unicode_ci,
  `gambar_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_open` tinyint(1) NOT NULL DEFAULT '0',
  `no_wa` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `tenant_id` (`tenant_id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `spmb_faqs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `question` text COLLATE utf8mb4_unicode_ci,
  `answer` text COLLATE utf8mb4_unicode_ci,
  `sort_order` int DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_spmb_faqs_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `spmb_landing_faqs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `question` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `answer` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_sort` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `spmb_landing_programs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `quota` int DEFAULT '0',
  `sort_order` int DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_sort` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `spmb_landing_schools` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `primary_color` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT '#1e3a8a',
  `accent_color` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT '#d97706',
  `accreditation` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tagline` text COLLATE utf8mb4_unicode_ci,
  `logo_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `hero_banner` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address` text COLLATE utf8mb4_unicode_ci,
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `level_badge` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `terminology` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `program_label` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `selection_type` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `tenant_id` (`tenant_id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `spmb_landing_stats` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_sort` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `spmb_landing_waves` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `selection_type` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'upcoming',
  `badge_class` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT 'bg-slate-100 text-slate-800 border-slate-300',
  `sort_order` int DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_sort` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `spmb_programs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `program_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `quota` int DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `tanggal_buka` date DEFAULT NULL,
  `tanggal_tutup` date DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_spmb_programs_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `spmb_registrations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nama` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nik` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `no_wa` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tempat_lahir` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tanggal_lahir` date DEFAULT NULL,
  `jenis_kelamin` enum('L','P') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `alamat` text COLLATE utf8mb4_unicode_ci,
  `pendidikan_terakhir` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `jurusan` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nama_sekolah_pendidikan` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tahun_angkatan` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tenant_id_sekolah` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `jabatan_di_unit` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('pending','approved','rejected') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `foto_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ktp_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `kk_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ijazah_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_spmb_registrations_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `spmb_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_open` tinyint(1) DEFAULT '0',
  `judul_flyer` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `keterangan_flyer` text COLLATE utf8mb4_unicode_ci,
  `no_wa` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `primary_color` varchar(7) COLLATE utf8mb4_unicode_ci DEFAULT '#066e3a',
  `accent_color` varchar(7) COLLATE utf8mb4_unicode_ci DEFAULT '#f59e0b',
  `school_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `school_tagline` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_spmb_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `spmb_stats` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `value` int DEFAULT '0',
  `sort_order` int DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_spmb_stats_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `spmb_transactions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `transaction_type` enum('income','expense') COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'pendaftaran, buku, seragam, dll',
  `amount` decimal(14,2) NOT NULL DEFAULT '0.00',
  `description` text COLLATE utf8mb4_unicode_ci,
  `transaction_date` date NOT NULL,
  `created_by` int DEFAULT NULL COMMENT 'teacher_id of who recorded',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_type` (`transaction_type`),
  KEY `idx_date` (`transaction_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `spmb_waves` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `wave_number` int DEFAULT NULL,
  `wave_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `registration_start` date DEFAULT NULL,
  `registration_end` date DEFAULT NULL,
  `max_participants` int DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_spmb_waves_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `student_attendance` (
  `id` int NOT NULL AUTO_INCREMENT,
  `student_id` int NOT NULL,
  `class_id` int DEFAULT NULL,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tanggal` date NOT NULL,
  `status` enum('hadir','izin','sakit','alpha') COLLATE utf8mb4_unicode_ci NOT NULL,
  `keterangan` text COLLATE utf8mb4_unicode_ci,
  `recorded_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_student_tanggal` (`student_id`,`tanggal`),
  KEY `idx_class_id` (`class_id`),
  KEY `idx_tenant_id` (`tenant_id`),
  KEY `idx_recorded_by` (`recorded_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `student_education_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `student_id` int NOT NULL,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nama_sekolah` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tahun_masuk` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tahun_lulus` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('aktif','lulus','pindah','keluar') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'aktif',
  `keterangan` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_student_id` (`student_id`),
  KEY `idx_tenant_id` (`tenant_id`),
  KEY `idx_status` (`status`),
  KEY `idx_education_history_student` (`student_id`),
  KEY `idx_education_history_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `students` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `parent_id` int DEFAULT NULL,
  `class_id` int DEFAULT NULL,
  `nama_siswa` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nisn` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `jenis_kelamin` enum('L','P') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `iuran_bulanan` decimal(10,2) DEFAULT NULL,
  `nis` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `va_number` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `va_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('aktif','alumni','mutasi','keluar') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'aktif',
  `mutasi_status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mutasi_reason` text COLLATE utf8mb4_unicode_ci,
  `mutasi_date` datetime DEFAULT NULL,
  `old_tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tanggal_masuk` varchar(7) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ransportasi` decimal(10,2) DEFAULT '0.00',
  `subsidi` decimal(10,2) DEFAULT '0.00',
  `biaya_admin_va` decimal(10,2) NOT NULL DEFAULT '0.00',
  `privat` decimal(10,2) DEFAULT '0.00',
  `biaya_lain` decimal(10,2) DEFAULT '0.00',
  `biaya_lain_nama` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tahun_masuk` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tahun_ajaran_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nis` (`nis`),
  KEY `parent_id` (`parent_id`),
  KEY `class_id` (`class_id`),
  KEY `fk_students_tenant` (`tenant_id`),
  KEY `idx_status` (`status`),
  KEY `idx_mutasi_status` (`mutasi_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tagihan_siswa` (
  `id` int NOT NULL,
  `student_id` int NOT NULL,
  `tenant_id` int NOT NULL,
  `periode` varchar(20) COLLATE utf8mb4_general_ci NOT NULL,
  `jumlah_tagihan` decimal(10,2) DEFAULT '0.00',
  `status` enum('terkirim','gagal','diterima') COLLATE utf8mb4_general_ci DEFAULT 'terkirim',
  `message_id` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_tagihan` (`student_id`,`periode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `tahun_ajaran` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nama` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Format: 2024/2025',
  `tahun_mulai` year NOT NULL COMMENT 'Tahun mulai',
  `tahun_selesai` year NOT NULL COMMENT 'Tahun selesai',
  `bulan_mulai` tinyint NOT NULL DEFAULT '7' COMMENT 'Bulan mulai TA',
  `tanggal_mulai` date NOT NULL COMMENT 'Tanggal mulai TA',
  `tanggal_selesai` date NOT NULL COMMENT 'Tanggal selesai TA',
  `is_active` tinyint(1) NOT NULL DEFAULT '0' COMMENT 'Hanya 1 aktif per tenant/global',
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'NULL = global',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ta_tenant_nama` (`tenant_id`,`nama`),
  KEY `idx_ta_tenant_active` (`tenant_id`,`is_active`),
  KEY `idx_ta_date_range` (`tanggal_mulai`,`tanggal_selesai`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `teacher_assignments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `teacher_id` int NOT NULL,
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `jabatan_di_unit` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `kpi_category` enum('guru','staf') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mutasi_status` enum('pending','adopted') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mutasi_reason` text COLLATE utf8mb4_unicode_ci,
  `mutasi_date` datetime DEFAULT NULL,
  `class_id` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_paid` tinyint(1) NOT NULL DEFAULT '1' COMMENT '1=digaji, 0=tidak',
  `gaji_pokok` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_kinerja` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_umum` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_istri` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_anak` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_kepala_sekolah` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_wali_kelas` decimal(12,2) NOT NULL DEFAULT '0.00',
  `honor_bendahara` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_kehadiran` decimal(12,2) NOT NULL DEFAULT '0.00',
  `potongan` decimal(12,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_teacher_unit_job` (`teacher_id`,`tenant_id`,`jabatan_di_unit`),
  KEY `idx_teacher_id` (`teacher_id`),
  KEY `idx_tenant_id` (`tenant_id`),
  KEY `idx_class_id` (`class_id`),
  KEY `idx_teacher_mutasi_status` (`mutasi_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `teacher_attendance_stats` (
  `id` int NOT NULL AUTO_INCREMENT,
  `teacher_id` int NOT NULL,
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `month` varchar(7) COLLATE utf8mb4_unicode_ci NOT NULL,
  `total_days` int DEFAULT '0',
  `present_days` int DEFAULT '0',
  `late_days` int DEFAULT '0',
  `alpha_days` int DEFAULT '0',
  `attendance_rate` decimal(5,2) DEFAULT '0.00',
  `last_updated` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_teacher_month` (`teacher_id`,`tenant_id`,`month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `teacher_family` (
  `id` int NOT NULL,
  `teacher_id` int NOT NULL,
  `nik` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nama` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tipe` enum('suami','istri','mantan') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `related_teacher_id` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `teachers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nama` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `BANK` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nomor_rekening` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status_perkawinan` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `jumlah_anak` int DEFAULT '0',
  `data_keluarga` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `nik` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tempat_lahir` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tanggal_lahir` date DEFAULT NULL,
  `jenis_kelamin` enum('L','P') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `alamat` text COLLATE utf8mb4_unicode_ci,
  `no_wa` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status_kepegawaian` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tmt` date DEFAULT NULL,
  `nip` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `scan_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `link_foto` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `link_ktp` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `link_kk` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `link_ijazah` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pending_password_hash` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status_aktif` tinyint(1) DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `pendidikan_terakhir` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pendidikan_kode` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `gaji_pokok` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_kinerja` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_umum` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_istri` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_anak` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_kepala_sekolah` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_wali_kelas` decimal(12,2) NOT NULL DEFAULT '0.00',
  `honor_bendahara` decimal(12,2) NOT NULL DEFAULT '0.00',
  `potongan` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tunj_kehadiran` decimal(12,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `nik` (`nik`),
  UNIQUE KEY `scan_id` (`scan_id`),
  KEY `idx_nik` (`nik`),
  KEY `idx_scan_id` (`scan_id`),
  KEY `idx_status_aktif` (`status_aktif`),
  CONSTRAINT `teachers_chk_1` CHECK (json_valid(`data_keluarga`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `temp_teachers` (
  `Nama` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `NIY` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `NIK` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Jenis_Kelamin` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Tempat_Lahir` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Tanggal_Lahir` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Alamat` text COLLATE utf8mb4_unicode_ci,
  `No_WA` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tenant_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Jenjang` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Jabatan` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Status_Kepegawaian` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `TMT` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Status_Aktif` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Keterangan` text COLLATE utf8mb4_unicode_ci,
  `Link_Foto` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Terima_Notifikasi` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Gaji_Pokok` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Tunj_Kinerja` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Tunj_Umum` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Tunj_Istri` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Tunj_Anak` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Tunj_Kepala_Sekolah` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Tunj_Wali_Kelas` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Honor_Bendahara` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenant_locations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `location_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `location_radius` int DEFAULT '100',
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `tenant_id` (`tenant_id`),
  KEY `idx_is_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenants` (
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `id` int NOT NULL AUTO_INCREMENT,
  `tipe_unit` enum('yayasan','sekolah','pondok') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'sekolah',
  `nama_sekolah` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nomor_rekening` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `absensi_method` enum('personal','gateway') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'personal',
  `wa_api_key` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `location_radius` int DEFAULT '100',
  `location_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `use_central_rules` tinyint(1) DEFAULT '0',
  `registration_token` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_account_number` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_account_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `xendit_api_key` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `xendit_public_key` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `xendit_webhook_token` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `xendit_enabled` tinyint(1) DEFAULT '0',
  `midtrans_server_key` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `midtrans_client_key` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `midtrans_enabled` tinyint(1) DEFAULT '0',
  `midtrans_is_production` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_tenant_id` (`tenant_id`),
  KEY `idx_id` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `test_migration_runner` (
  `id` int NOT NULL AUTO_INCREMENT,
  `test_col` varchar(50) DEFAULT 'test',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` enum('admin','guru') COLLATE utf8mb4_unicode_ci NOT NULL,
  `guru_id` int DEFAULT NULL,
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_profile_complete` tinyint(1) DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_default_password` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  KEY `idx_username` (`username`),
  KEY `idx_guru_id` (`guru_id`),
  KEY `idx_tenant_id` (`tenant_id`),
  KEY `idx_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wa_pundi_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tujuan` enum('manual','calon_donatur','siswa') COLLATE utf8mb4_unicode_ci DEFAULT 'manual',
  `nama_penerima` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nomor` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `pesan` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `template` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('terkirim','gagal') COLLATE utf8mb4_unicode_ci DEFAULT 'terkirim',
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `message_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `whatsapp_messages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `from_phone` varchar(20) COLLATE utf8mb4_general_ci NOT NULL,
  `message` text COLLATE utf8mb4_general_ci,
  `message_type` enum('text','image','audio','video','document','location','contacts','interactive','unknown') COLLATE utf8mb4_general_ci DEFAULT 'text',
  `wa_message_id` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `profile_name` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `status` enum('received','read','replied','archived') COLLATE utf8mb4_general_ci DEFAULT 'received',
  `reply_to_id` int DEFAULT NULL,
  `parent_id` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `reply_to_message_id` int DEFAULT NULL,
  `direction` enum('outgoing','incoming') COLLATE utf8mb4_general_ci DEFAULT 'incoming',
  `media_url` text COLLATE utf8mb4_general_ci,
  `media_filename` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `contact_photo_url` text COLLATE utf8mb4_general_ci,
  PRIMARY KEY (`id`),
  KEY `idx_from_phone` (`from_phone`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_status` (`status`),
  KEY `idx_parent` (`parent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `xendit_invoices` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `student_id` int NOT NULL,
  `xendit_invoice_id` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `external_id` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `periode` char(7) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `amount` decimal(10,2) DEFAULT '0.00',
  `description` text COLLATE utf8mb4_unicode_ci,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'PENDING',
  `due_date` date DEFAULT NULL,
  `is_arrears` tinyint(1) NOT NULL DEFAULT '0',
  `type` enum('spp','keringanan') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'spp',
  `arrears_base` decimal(10,2) NOT NULL DEFAULT '0.00',
  `superseded` tinyint(1) NOT NULL DEFAULT '0',
  `payment_method` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'MULTIPLE',
  `callback_url` text COLLATE utf8mb4_unicode_ci,
  `invoice_url` text COLLATE utf8mb4_unicode_ci,
  `expiry_date` datetime DEFAULT NULL,
  `paid_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_id` (`tenant_id`),
  KEY `idx_student_id` (`student_id`),
  KEY `idx_external_id` (`external_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ypwi_database___database_siswa` (
  `nama_siswa` varchar(255) DEFAULT NULL,
  `jenis_kelamin` varchar(20) DEFAULT NULL,
  `tenant_id` varchar(100) DEFAULT NULL,
  `password` varchar(255) DEFAULT NULL,
  `jenjang` varchar(50) DEFAULT NULL,
  `nama_sheet` varchar(100) DEFAULT NULL,
  `nisn` varchar(50) DEFAULT NULL,
  `kelas` varchar(50) DEFAULT NULL,
  `iuran_bulanan` varchar(50) DEFAULT NULL,
  `nama_orang_tua` varchar(255) DEFAULT NULL,
  `no_wa` varchar(30) DEFAULT NULL,
  `keterangan` text
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;

SET FOREIGN_KEY_CHECKS = 1;
