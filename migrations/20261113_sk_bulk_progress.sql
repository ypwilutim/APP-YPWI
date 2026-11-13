-- Migration: Create sk_bulk_progress table for persistent progress tracking
-- Menyimpan progress job bulk generate ke database agar tidak hilang saat server restart

CREATE TABLE IF NOT EXISTS `sk_bulk_progress` (
  `job_id` VARCHAR(64) PRIMARY KEY,
  `total` INT NOT NULL DEFAULT 0,
  `processed` INT NOT NULL DEFAULT 0,
  `percentage` INT NOT NULL DEFAULT 0,
  `current` VARCHAR(255) DEFAULT NULL,
  `status` ENUM('processing','completed','failed') DEFAULT 'processing',
  `started_at` BIGINT NOT NULL,
  `completed_at` BIGINT DEFAULT NULL,
  `generated` LONGTEXT,
  `skipped` LONGTEXT,
  `errors` LONGTEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_status` (`status`),
  INDEX `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;