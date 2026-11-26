-- Fix incoming_payments table: add missing columns for MariaDB compatibility
-- This migration adds columns that the code expects but are missing from 000_full_structure.sql

ALTER TABLE `incoming_payments` ADD COLUMN `beneficiary_va` VARCHAR(50) DEFAULT NULL AFTER `beneficiary_account`;
ALTER TABLE `incoming_payments` ADD COLUMN `sender_name` VARCHAR(100) DEFAULT NULL AFTER `source_account`;
ALTER TABLE `incoming_payments` ADD COLUMN `va_name` VARCHAR(100) DEFAULT NULL AFTER `sender_name`;

-- Update beneficiary_va from beneficiary_account for existing rows
UPDATE `incoming_payments` SET `beneficiary_va` = `beneficiary_account` WHERE `beneficiary_va` IS NULL;

-- Add index for beneficiary_va
ALTER TABLE `incoming_payments` ADD INDEX `idx_beneficiary_va` (`beneficiary_va`);