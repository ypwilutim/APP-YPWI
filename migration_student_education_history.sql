-- ==========================================
-- Student Education History Table
-- Riwayat Pendidikan Siswa
-- ==========================================

CREATE TABLE IF NOT EXISTS student_education_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  tenant_id VARCHAR(50) NOT NULL,
  nama_sekolah VARCHAR(255) NOT NULL,
  tahun_masuk VARCHAR(10) DEFAULT NULL,
  tahun_lulus VARCHAR(10) DEFAULT NULL,
  status ENUM('aktif', 'lulus', 'pindah', 'keluar') NOT NULL DEFAULT 'aktif',
  keterangan TEXT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  INDEX idx_student_id (student_id),
  INDEX idx_tenant_id (tenant_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Index untuk mempercepat query riwayat pendidikan
CREATE INDEX IF NOT EXISTS idx_education_history_student ON student_education_history(student_id);
CREATE INDEX IF NOT EXISTS idx_education_history_tenant ON student_education_history(tenant_id);
