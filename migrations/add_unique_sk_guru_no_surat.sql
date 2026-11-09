-- Migration: Add UNIQUE constraint on sk_guru(tenant_id, no_surat)
-- Prevents duplicate SK numbers within the same tenant

-- First, identify and handle existing duplicates
-- This migration assumes duplicates have been cleaned up first
-- Run cleanup-duplicate-sk.js before applying this migration

ALTER TABLE `sk_guru` 
ADD UNIQUE KEY `uk_tenant_no_surat` (`tenant_id`, `no_surat`);

-- Note: Index on hijri_year not added as column doesn't exist in sk_guru
-- The hijri year is extracted from the `bh` field (hijri date) at query time