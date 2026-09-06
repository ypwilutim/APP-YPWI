-- ============================================================
-- MIGRASI: GAJI PER UNIT (multi-school payroll)
-- Menambahkan flag & override komponen gaji per assignment,
-- sehingga guru bisa digaji di semua unit ATAU hanya di unit tertentu.
-- ============================================================

-- 1. Tambah flag & override gaji per assignment
ALTER TABLE `teacher_assignments`
  ADD COLUMN `is_paid` TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '1 = digaji di unit ini, 0 = tidak digaji (hanya mengajar/pinjam)',
  ADD COLUMN `gaji_pokok` DECIMAL(12,2) DEFAULT NULL
    COMMENT 'Override gaji pokok khusus unit ini (NULL = pakai default dari teachers)',
  ADD COLUMN `tunj_kinerja` DECIMAL(12,2) DEFAULT NULL,
  ADD COLUMN `tunj_umum` DECIMAL(12,2) DEFAULT NULL,
  ADD COLUMN `tunj_istri` DECIMAL(12,2) DEFAULT NULL,
  ADD COLUMN `tunj_anak` DECIMAL(12,2) DEFAULT NULL,
  ADD COLUMN `tunj_kepala_sekolah` DECIMAL(12,2) DEFAULT NULL,
  ADD COLUMN `tunj_wali_kelas` DECIMAL(12,2) DEFAULT NULL,
  ADD COLUMN `honor_bendahara` DECIMAL(12,2) DEFAULT NULL,
  ADD COLUMN `tunj_kehadiran` DECIMAL(12,2) DEFAULT NULL,
  ADD COLUMN `potongan` DECIMAL(12,2) DEFAULT NULL;

-- Default: semua assignment existing dianggap digaji (backward compatible)
-- UPDATE teacher_assignments SET is_paid = 1 WHERE is_paid IS NULL;
