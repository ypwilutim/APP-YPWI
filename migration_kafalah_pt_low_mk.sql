-- ============================================================
-- Tambahan entry matrix masa kerja 0-1 tahun untuk PT
-- (PK sudah ada). Untuk PT, nilai menggunakan entry terendah
-- (sesuai xlsx yang mulai dari 2 tahun → fallback ke 2 th).
-- Nominal = entry masa_kerja 2 tahun (sudah ada di matrix).
-- ============================================================

-- Hanya tambahkan untuk setiap kombinasi jenjang & pendidikan
-- jika belum ada entry 0-1.

INSERT IGNORE INTO `kafalah_gaji_matrix`
  (status_pegawai, jenjang, pendidikan, masa_kerja_min, masa_kerja_max, nominal)
SELECT 'PT', jenjang, pendidikan, 0, 1, nominal
FROM kafalah_gaji_matrix
WHERE status_pegawai = 'PT' AND masa_kerja_min = 2 AND masa_kerja_max = 2
  AND NOT EXISTS (
    SELECT 1 FROM kafalah_gaji_matrix k2
    WHERE k2.status_pegawai='PT' AND k2.jenjang=kafalah_gaji_matrix.jenjang
      AND k2.pendidikan=kafalah_gaji_matrix.pendidikan
      AND k2.masa_kerja_min=0
  );
