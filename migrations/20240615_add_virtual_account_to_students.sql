-- Add virtual_account to students table
ALTER TABLE students ADD COLUMN virtual_account VARCHAR(50) NULL UNIQUE AFTER nisn;