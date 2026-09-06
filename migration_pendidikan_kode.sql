-- ============================================================
-- Tambah kolom pendidikan_kode di teachers
-- Kolom ini menyimpan kode pendidikan standar dari complete-profile.html
-- (SD, SMP, SMA, SMK, D1, D2, D3, S1, S2, S3, Lainnya)
-- Backfill otomatis dari pendidikan_terakhir (parse sebelum /) atau regex nama
-- ============================================================

ALTER TABLE `teachers`
  ADD COLUMN `pendidikan_kode` VARCHAR(10) DEFAULT NULL
    COMMENT 'Standar dari complete-profile: SD|SMP|SMA|SMK|D1|D2|D3|S1|S2|S3|Lainnya'
  AFTER `pendidikan_terakhir`;

-- Index untuk lookup cepat
ALTER TABLE `teachers` ADD INDEX `idx_pendidikan_kode` (`pendidikan_kode`);
