-- Add mutasi tracking columns to teacher_assignments
ALTER TABLE teacher_assignments
  ADD COLUMN IF NOT EXISTS mutasi_status ENUM('pending','adopted','keluar') DEFAULT NULL AFTER jabatan_di_unit,
  ADD COLUMN IF NOT EXISTS mutasi_reason TEXT DEFAULT NULL AFTER mutasi_status,
  ADD COLUMN IF NOT EXISTS mutasi_date DATETIME DEFAULT NULL AFTER mutasi_reason;

-- Index untuk mempercepat query mutasi guru
CREATE INDEX IF NOT EXISTS idx_teacher_mutasi_status ON teacher_assignments(mutasi_status);
