-- Migration: Riwayat penugasan jabatan guru
-- Digunakan oleh sub-tab Penugasan pada Manajemen Guru (SDM Dashboard v2).

CREATE TABLE IF NOT EXISTS `teacher_penugasan` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `teacher_id` INT(11) NOT NULL,
  `from_assignment_id` INT(11) DEFAULT NULL,
  `to_assignment_id` INT(11) DEFAULT NULL,
  `from_tenant_id` VARCHAR(20) DEFAULT NULL,
  `to_tenant_id` VARCHAR(20) NOT NULL,
  `from_jabatan` VARCHAR(100) DEFAULT NULL,
  `to_jabatan` VARCHAR(100) NOT NULL,
  `jenis` ENUM('baru','beralih','mutasi') NOT NULL DEFAULT 'beralih',
  `tanggal_mulai` DATE NOT NULL,
  `tanggal_selesai` DATE NOT NULL,
  `periode` VARCHAR(50) DEFAULT NULL,
  `tentang` VARCHAR(255) DEFAULT NULL,
  `no_surat` VARCHAR(100) DEFAULT NULL,
  `sk_guru_id` INT(11) DEFAULT NULL,
  `keterangan` TEXT DEFAULT NULL,
  `status` ENUM('aktif','digantikan','selesai','dibatalkan') NOT NULL DEFAULT 'aktif',
  `replaced_by_id` INT(11) DEFAULT NULL,
  `created_by` INT(11) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tp_teacher` (`teacher_id`),
  KEY `idx_tp_to_tenant` (`to_tenant_id`),
  KEY `idx_tp_status` (`status`),
  KEY `idx_tp_sk` (`sk_guru_id`),
  KEY `idx_tp_from_assignment` (`from_assignment_id`),
  KEY `idx_tp_to_assignment` (`to_assignment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;