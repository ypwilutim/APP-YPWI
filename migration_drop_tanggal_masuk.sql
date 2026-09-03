-- ==========================================
-- Hapus kolom tanggal_masuk dari students
-- Hanya gunakan tahun_masuk (sumber tunggal)
-- ==========================================

-- Step 1: Backup data tahun dari tanggal_masuk ke tahun_masuk jika tahun_masuk NULL
UPDATE students
SET tahun_masuk = LEFT(tanggal_masuk, 4)
WHERE tahun_masuk IS NULL
  AND tanggal_masuk IS NOT NULL
  AND tanggal_masuk != '';

-- Step 2: Drop kolom tanggal_masuk
ALTER TABLE students DROP COLUMN tanggal_masuk;

-- Step 3: Verifikasi
DESCRIBE students;
