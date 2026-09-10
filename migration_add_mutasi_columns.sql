-- Migration: Add mutasi columns to students table
-- Date: 2026-09-08
-- Purpose: Support cross-tenant student transfer (mutasi) without losing school assignment

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS mutasi_status VARCHAR(20) DEFAULT NULL AFTER status,
  ADD COLUMN IF NOT EXISTS mutasi_reason TEXT DEFAULT NULL AFTER mutasi_status,
  ADD COLUMN IF NOT EXISTS mutasi_date DATETIME DEFAULT NULL AFTER mutasi_reason,
  ADD COLUMN IF NOT EXISTS old_tenant_id VARCHAR(20) DEFAULT NULL AFTER mutasi_date,
  ADD INDEX IF NOT EXISTS idx_mutasi_status (mutasi_status);

-- Note for MySQL/MariaDB: if IF NOT EXISTS is not supported, run the ALTER TABLE without it.
