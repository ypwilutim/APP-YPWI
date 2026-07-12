-- Add bank and nomor_rekening columns to teachers table for payroll integration
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS bank VARCHAR(50) NULL AFTER status_aktif;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS nomor_rekening VARCHAR(50) NULL AFTER bank;