-- ============================================================
-- Tambahan entry matrix S2 untuk semua jenjang & masa kerja
-- Nominal diasumsikan sama dengan S1 (bisa diedit via UI)
-- ============================================================

INSERT IGNORE INTO `kafalah_gaji_matrix`
  (status_pegawai, jenjang, pendidikan, masa_kerja_min, masa_kerja_max, nominal)
SELECT status_pegawai, jenjang, 'S2', masa_kerja_min, masa_kerja_max, nominal
FROM kafalah_gaji_matrix
WHERE pendidikan = 'S1'
  AND NOT EXISTS (
    SELECT 1 FROM kafalah_gaji_matrix k2
    WHERE k2.status_pegawai = kafalah_gaji_matrix.status_pegawai
      AND k2.jenjang = kafalah_gaji_matrix.jenjang
      AND k2.pendidikan = 'S2'
      AND k2.masa_kerja_min = kafalah_gaji_matrix.masa_kerja_min
  );
