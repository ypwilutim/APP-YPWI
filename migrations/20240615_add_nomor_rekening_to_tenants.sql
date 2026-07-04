-- Add bank account number to tenants table
ALTER TABLE tenants ADD COLUMN nomor_rekening VARCHAR(50) NULL AFTER nama_sekolah;