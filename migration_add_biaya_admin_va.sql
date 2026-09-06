-- Add biaya_admin_va to students table for WA message template
ALTER TABLE students ADD COLUMN IF NOT EXISTS biaya_admin_va DECIMAL(10,2) DEFAULT 0.00 AFTER subsidi;
