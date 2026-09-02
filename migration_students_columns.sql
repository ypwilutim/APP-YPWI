-- ============================================================
-- MIGRATION: Add missing columns to students table
-- Run this on both local and hosting databases
-- ============================================================

-- Add ransportasi (transportasi) column
ALTER TABLE students ADD COLUMN IF NOT EXISTS ransportasi decimal(10,2) DEFAULT 0.00 AFTER iuran_bulanan;

-- Add subsidi column
ALTER TABLE students ADD COLUMN IF NOT EXISTS subsidi decimal(10,2) DEFAULT 0.00 AFTER ransportasi;

-- Add privat column
ALTER TABLE students ADD COLUMN IF NOT EXISTS privat decimal(10,2) DEFAULT 0.00 AFTER subsidi;

-- Add biaya_lain column
ALTER TABLE students ADD COLUMN IF NOT EXISTS biaya_lain decimal(10,2) DEFAULT 0.00 AFTER privat;

-- Add biaya_lain_nama column
ALTER TABLE students ADD COLUMN IF NOT EXISTS biaya_lain_nama varchar(255) DEFAULT NULL AFTER biaya_lain;

-- Add tanggal_masuk column
ALTER TABLE students ADD COLUMN IF NOT EXISTS tanggal_masuk date DEFAULT NULL AFTER jenis_kelamin;

-- Add tahun_masuk column
ALTER TABLE students ADD COLUMN IF NOT EXISTS tahun_masuk varchar(10) DEFAULT NULL AFTER tanggal_masuk;

-- Add status column
ALTER TABLE students ADD COLUMN IF NOT EXISTS status varchar(20) DEFAULT 'aktif' AFTER tahun_masuk;

-- ============================================================
-- END MIGRATION
-- ============================================================
