
ALTER TABLE tenants
  ADD COLUMN xendit_api_key VARCHAR(255) DEFAULT NULL AFTER bank_account_name,
  ADD COLUMN xendit_public_key VARCHAR(255) DEFAULT NULL AFTER xendit_api_key,
  ADD COLUMN xendit_webhook_token VARCHAR(255) DEFAULT NULL AFTER xendit_public_key,
  ADD COLUMN xendit_enabled TINYINT(1) DEFAULT 0 AFTER xendit_webhook_token;

CREATE TABLE IF NOT EXISTS `xendit_invoices` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `tenant_id` VARCHAR(20) NOT NULL,
  `student_id` INT(11) DEFAULT NULL,
  `xendit_invoice_id` VARCHAR(100) DEFAULT NULL,
  `external_id` VARCHAR(100) DEFAULT NULL,
  `amount` DECIMAL(10,2) DEFAULT NULL,
  `description` TEXT DEFAULT NULL,
  `status` VARCHAR(50) DEFAULT 'PENDING',
  `payment_method` VARCHAR(50) DEFAULT NULL,
  `payment_channel` VARCHAR(50) DEFAULT NULL,
  `callback_url` VARCHAR(255) DEFAULT NULL,
  `invoice_url` VARCHAR(255) DEFAULT NULL,
  `paid_at` DATETIME DEFAULT NULL,
  `expiry_date` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_id` (`tenant_id`),
  KEY `idx_student_id` (`student_id`),
  KEY `idx_xendit_invoice_id` (`xendit_invoice_id`),
  KEY `idx_external_id` (`external_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
