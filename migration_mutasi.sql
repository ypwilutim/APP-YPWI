-- Migration: Add mutasi_students table and mutasi_status column
-- Add mutasi_status column to students table (run separately if column exists)
ALTER TABLE students ADD COLUMN mutasi_status ENUM('completed', 'pending') DEFAULT NULL;

CREATE TABLE IF NOT EXISTS mutasi_students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  old_tenant_id VARCHAR(50),
  new_tenant_id VARCHAR(50) NOT NULL,
  reason TEXT,
  created_at DATETIME NOT NULL,
  INDEX idx_student_id (student_id),
  INDEX idx_created_at (created_at)
);