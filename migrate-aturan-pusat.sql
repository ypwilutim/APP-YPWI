-- Migration: Tambah tipe_unit ke attendance_rules untuk aturan pusat global
-- Aturan pusat disimpan dengan tenant_id IS NULL

ALTER TABLE attendance_rules 
ADD COLUMN tipe_unit VARCHAR(20) NULL,
ADD INDEX idx_tipe_unit (tipe_unit);

-- Seed aturan pusat global per jenjang (opsional, sesuaikan jam/hari)
-- TKIT (contoh)
INSERT INTO attendance_rules (tenant_id, tipe_unit, tipe, jam_mulai, jam_selesai, status_log, hari, keterangan) VALUES
(NULL, 'TKIT', 'Datang', '07:00:00', '08:00:00', 'tepat_waktu', 'senin,selasa,rabu,kamis,jumat', 'Kuliah Pagi'),
(NULL, 'TKIT', 'Pulang', '12:00:00', '13:00:00', 'tepat_waktu', 'senin,selasa,rabu,kamis,jumat', 'Pulang Siang');

-- SDIT
INSERT INTO attendance_rules (tenant_id, tipe_unit, tipe, jam_mulai, jam_selesai, status_log, hari, keterangan) VALUES
(NULL, 'SDIT', 'Datang', '07:30:00', '08:00:00', 'tepat_waktu', 'senin,selasa,rabu,kamis,jumat', 'Masuk'),
(NULL, 'SDIT', 'Pulang', '12:00:00', '13:00:00', 'tepat_waktu', 'senin,selasa,rabu,kamis,jumat', 'Pulang');

-- SMPIT
INSERT INTO attendance_rules (tenant_id, tipe_unit, tipe, jam_mulai, jam_selesai, status_log, hari, keterangan) VALUES
(NULL, 'SMPIT', 'Datang', '07:00:00', '08:00:00', 'tepat_waktu', 'senin,selasa,rabu,kamis,jumat,sabtu', 'Kuliah'),
(NULL, 'SMPIT', 'Pulang', '13:00:00', '14:00:00', 'tepat_waktu', 'senin,selasa,rabu,kamis,jumat,sabtu', 'Pulang');

-- SMAIT
INSERT INTO attendance_rules (tenant_id, tipe_unit, tipe, jam_mulai, jam_selesai, status_log, hari, keterangan) VALUES
(NULL, 'SMAIT', 'Datang', '07:30:00', '08:30:00', 'tepat_waktu', 'senin,selasa,rabu,kamis,jumat,sabtu', 'Masuk'),
(NULL, 'SMAIT', 'Pulang', '14:00:00', '15:00:00', 'tepat_waktu', 'senin,selasa,rabu,kamis,jumat,sabtu', 'Pulang');

-- Pondok
INSERT INTO attendance_rules (tenant_id, tipe_unit, tipe, jam_mulai, jam_selesai, status_log, hari, keterangan) VALUES
(NULL, 'pondok', 'Datang', '04:00:00', '05:00:00', 'tepat_waktu', 'senin,selasa,rabu,kamis,jumat,sabtu,minggu', 'Subuh'),
(NULL, 'pondok', 'Pulang', '22:00:00', '23:00:00', 'tepat_waktu', 'senin,selasa,rabu,kamis,jumat,sabtu,minggu', 'Isya');

-- SELECT DISTINCT tipe_unit FROM attendance_rules WHERE tipe_unit IS NOT NULL;