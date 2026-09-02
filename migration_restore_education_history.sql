-- ==========================================
-- Restore Education History from Mutasi Records
-- Memulihkan data riwayat pendidikan dari record mutasi sebelumnya
-- ==========================================

-- Step 1: Create the education history table if not exists
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

-- Step 2: Restore education history from mutasi_students table
-- This will create education history records for students who were mutated before the education history system

INSERT INTO student_education_history (student_id, tenant_id, nama_sekolah, tahun_masuk, tahun_lulus, status, keterangan, created_at)
SELECT 
  m.student_id,
  m.old_tenant_id,
  COALESCE(tn.nama_sekolah, m.old_tenant_id) as nama_sekolah,
  s.tahun_masuk,
  YEAR(m.created_at) as tahun_lulus,
  'pindah' as status,
  CONCAT('Mutasi ke ', COALESCE(tn2.nama_sekolah, m.new_tenant_id), '. Alasan: ', COALESCE(m.reason, '-')) as keterangan,
  m.created_at
FROM mutasi_students m
JOIN students s ON m.student_id = s.id
LEFT JOIN tenants tn ON m.old_tenant_id = tn.tenant_id
LEFT JOIN tenants tn2 ON m.new_tenant_id = tn2.tenant_id
WHERE m.old_tenant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM student_education_history seh 
    WHERE seh.student_id = m.student_id 
    AND seh.tenant_id = m.old_tenant_id
  );

-- Step 3: For students currently in mutasi pool (tenant_id IS NULL, mutasi_status = 'pending')
-- Create education history from their original school if we can find it

INSERT INTO student_education_history (student_id, tenant_id, nama_sekolah, tahun_masuk, tahun_lulus, status, keterangan, created_at)
SELECT 
  s.id as student_id,
  m.old_tenant_id,
  COALESCE(tn.nama_sekolah, m.old_tenant_id) as nama_sekolah,
  s.tahun_masuk,
  YEAR(m.created_at) as tahun_lulus,
  'pindah' as status,
  CONCAT('Mutasi ke mutasi pool. Alasan: ', COALESCE(m.reason, '-')) as keterangan,
  m.created_at
FROM students s
JOIN mutasi_students m ON s.id = m.student_id
LEFT JOIN tenants tn ON m.old_tenant_id = tn.tenant_id
WHERE s.tenant_id IS NULL
  AND s.mutasi_status = 'pending'
  AND m.old_tenant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM student_education_history seh 
    WHERE seh.student_id = s.id 
    AND seh.tenant_id = m.old_tenant_id
  );

-- Step 4: Verify the restored data
SELECT 
  s.id as student_id,
  s.nama_siswa,
  s.tenant_id as current_tenant,
  seh.nama_sekolah as history_school,
  seh.status as history_status,
  seh.tahun_lulus,
  seh.keterangan
FROM students s
JOIN student_education_history seh ON s.id = seh.student_id
WHERE s.tenant_id IS NULL OR s.mutasi_status = 'pending'
ORDER BY s.id, seh.created_at;
