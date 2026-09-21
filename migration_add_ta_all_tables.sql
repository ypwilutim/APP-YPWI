-- ============================================================
-- Migration: Add tahun_ajaran_id to remaining transactional tables
-- ============================================================

-- 1. teacher_assignments (penugasan_guru)
SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'teacher_assignments' AND COLUMN_NAME = 'tahun_ajaran_id');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE `teacher_assignments` ADD COLUMN `tahun_ajaran_id` int(11) DEFAULT NULL COMMENT "FK ke tahun_ajaran" AFTER `tenant_id`, 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'teacher_assignments' AND CONSTRAINT_NAME = 'fk_teacher_assign_tahun_ajaran');
SET @sql_fk := IF(@fk_exists = 0, 'ALTER TABLE `teacher_assignments` ADD CONSTRAINT `fk_teacher_assign_tahun_ajaran` FOREIGN KEY (`tahun_ajaran_id`) REFERENCES `tahun_ajaran` (`id`) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt_fk FROM @sql_fk;
EXECUTE stmt_fk;
DEALLOCATE PREPARE stmt_fk;

SET @idx_exists := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'teacher_assignments' AND INDEX_NAME = 'idx_ta_assign');
SET @sql_idx := IF(@idx_exists = 0, 'ALTER TABLE `teacher_assignments` ADD KEY `idx_ta_assign` (`tahun_ajaran_id`)', 'SELECT 1');
PREPARE stmt_idx FROM @sql_idx;
EXECUTE stmt_idx;
DEALLOCATE PREPARE stmt_idx;

-- 2. tagihan_siswa (tagihan)
SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tagihan_siswa' AND COLUMN_NAME = 'tahun_ajaran_id');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE `tagihan_siswa` ADD COLUMN `tahun_ajaran_id` int(11) DEFAULT NULL COMMENT "FK ke tahun_ajaran" AFTER `tenant_id`, 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tagihan_siswa' AND CONSTRAINT_NAME = 'fk_tagihan_tahun_ajaran');
SET @sql_fk := IF(@fk_exists = 0, 'ALTER TABLE `tagihan_siswa` ADD CONSTRAINT `fk_tagihan_tahun_ajaran` FOREIGN KEY (`tahun_ajaran_id`) REFERENCES `tahun_ajaran` (`id`) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt_fk FROM @sql_fk;
EXECUTE stmt_fk;
DEALLOCATE PREPARE stmt_fk;

SET @idx_exists := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tagihan_siswa' AND INDEX_NAME = 'idx_ta_tagihan');
SET @sql_idx := IF(@idx_exists = 0, 'ALTER TABLE `tagihan_siswa` ADD KEY `idx_ta_tagihan` (`tahun_ajaran_id`)', 'SELECT 1');
PREPARE stmt_idx FROM @sql_idx;
EXECUTE stmt_idx;
DEALLOCATE PREPARE stmt_idx;

-- 3. payment_transactions (pembayaran)
SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_transactions' AND COLUMN_NAME = 'tahun_ajaran_id');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE `payment_transactions` ADD COLUMN `tahun_ajaran_id` int(11) DEFAULT NULL COMMENT "FK ke tahun_ajaran" AFTER `tenant_id`, 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_transactions' AND CONSTRAINT_NAME = 'fk_payment_ta');
SET @sql_fk := IF(@fk_exists = 0, 'ALTER TABLE `payment_transactions` ADD CONSTRAINT `fk_payment_ta` FOREIGN KEY (`tahun_ajaran_id`) REFERENCES `tahun_ajaran` (`id`) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt_fk FROM @sql_fk;
EXECUTE stmt_fk;
DEALLOCATE PREPARE stmt_fk;

SET @idx_exists := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_transactions' AND INDEX_NAME = 'idx_ta_payment');
SET @sql_idx := IF(@idx_exists = 0, 'ALTER TABLE `payment_transactions` ADD KEY `idx_ta_payment` (`tahun_ajaran_id`)', 'SELECT 1');
PREPARE stmt_idx FROM @sql_idx;
EXECUTE stmt_idx;
DEALLOCATE PREPARE stmt_idx;

-- 4. attendance_logs (absensi)
SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_logs' AND COLUMN_NAME = 'tahun_ajaran_id');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE `attendance_logs` ADD COLUMN `tahun_ajaran_id` int(11) DEFAULT NULL COMMENT "FK ke tahun_ajaran" AFTER `tenant_id`, 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_logs' AND CONSTRAINT_NAME = 'fk_att_log_ta');
SET @sql_fk := IF(@fk_exists = 0, 'ALTER TABLE `attendance_logs` ADD CONSTRAINT `fk_att_log_ta` FOREIGN KEY (`tahun_ajaran_id`) REFERENCES `tahun_ajaran` (`id`) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt_fk FROM @sql_fk;
EXECUTE stmt_fk;
DEALLOCATE PREPARE stmt_fk;

SET @idx_exists := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_logs' AND INDEX_NAME = 'idx_ta_attlog');
SET @sql_idx := IF(@idx_exists = 0, 'ALTER TABLE `attendance_logs` ADD KEY `idx_ta_attlog` (`tahun_ajaran_id`)', 'SELECT 1');
PREPARE stmt_idx FROM @sql_idx;
EXECUTE stmt_idx;
DEALLOCATE PREPARE stmt_idx;

-- 5. attendance_summary
SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_summary' AND COLUMN_NAME = 'tahun_ajaran_id');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE `attendance_summary` ADD COLUMN `tahun_ajaran_id` int(11) DEFAULT NULL COMMENT "FK ke tahun_ajaran" AFTER `tenant_id`, 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_summary' AND CONSTRAINT_NAME = 'fk_att_sum_ta');
SET @sql_fk := IF(@fk_exists = 0, 'ALTER TABLE `attendance_summary` ADD CONSTRAINT `fk_att_sum_ta` FOREIGN KEY (`tahun_ajaran_id`) REFERENCES `tahun_ajaran` (`id`) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt_fk FROM @sql_fk;
EXECUTE stmt_fk;
DEALLOCATE PREPARE stmt_fk;

SET @idx_exists := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_summary' AND INDEX_NAME = 'idx_ta_attsum');
SET @sql_idx := IF(@idx_exists = 0, 'ALTER TABLE `attendance_summary` ADD KEY `idx_ta_attsum` (`tahun_ajaran_id`)', 'SELECT 1');
PREPARE stmt_idx FROM @sql_idx;
EXECUTE stmt_idx;
DEALLOCATE PREPARE stmt_idx;

-- 6. payroll
SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll' AND COLUMN_NAME = 'tahun_ajaran_id');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE `payroll` ADD COLUMN `tahun_ajaran_id` int(11) DEFAULT NULL COMMENT "FK ke tahun_ajaran" AFTER `tenant_id`, 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll' AND CONSTRAINT_NAME = 'fk_payroll_ta');
SET @sql_fk := IF(@fk_exists = 0, 'ALTER TABLE `payroll` ADD CONSTRAINT `fk_payroll_ta` FOREIGN KEY (`tahun_ajaran_id`) REFERENCES `tahun_ajaran` (`id`) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt_fk FROM @sql_fk;
EXECUTE stmt_fk;
DEALLOCATE PREPARE stmt_fk;

SET @idx_exists := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll' AND INDEX_NAME = 'idx_ta_payroll');
SET @sql_idx := IF(@idx_exists = 0, 'ALTER TABLE `payroll` ADD KEY `idx_ta_payroll` (`tahun_ajaran_id`)', 'SELECT 1');
PREPARE stmt_idx FROM @sql_idx;
EXECUTE stmt_idx;
DEALLOCATE PREPARE stmt_idx;

-- 7. mutasi_students
SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mutasi_students' AND COLUMN_NAME = 'tahun_ajaran_id');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE `mutasi_students` ADD COLUMN `tahun_ajaran_id` int(11) DEFAULT NULL COMMENT "FK ke tahun_ajaran" AFTER `tenant_id`, 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mutasi_students' AND CONSTRAINT_NAME = 'fk_mutasi_ta');
SET @sql_fk := IF(@fk_exists = 0, 'ALTER TABLE `mutasi_students` ADD CONSTRAINT `fk_mutasi_ta` FOREIGN KEY (`tahun_ajaran_id`) REFERENCES `tahun_ajaran` (`id`) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt_fk FROM @sql_fk;
EXECUTE stmt_fk;
DEALLOCATE PREPARE stmt_fk;

SET @idx_exists := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mutasi_students' AND INDEX_NAME = 'idx_ta_mutasi');
SET @sql_idx := IF(@idx_exists = 0, 'ALTER TABLE `mutasi_students` ADD KEY `idx_ta_mutasi` (`tahun_ajaran_id`)', 'SELECT 1');
PREPARE stmt_idx FROM @sql_idx;
EXECUTE stmt_idx;
DEALLOCATE PREPARE stmt_idx;

-- 8. evaluations
SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'evaluations' AND COLUMN_NAME = 'tahun_ajaran_id');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE `evaluations` ADD COLUMN `tahun_ajaran_id` int(11) DEFAULT NULL COMMENT "FK ke tahun_ajaran" AFTER `tenant_id`, 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'evaluations' AND CONSTRAINT_NAME = 'fk_eval_ta');
SET @sql_fk := IF(@fk_exists = 0, 'ALTER TABLE `evaluations` ADD CONSTRAINT `fk_eval_ta` FOREIGN KEY (`tahun_ajaran_id`) REFERENCES `tahun_ajaran` (`id`) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt_fk FROM @sql_fk;
EXECUTE stmt_fk;
DEALLOCATE PREPARE stmt_fk;

SET @idx_exists := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'evaluations' AND INDEX_NAME = 'idx_ta_eval');
SET @sql_idx := IF(@idx_exists = 0, 'ALTER TABLE `evaluations` ADD KEY `idx_ta_eval` (`tahun_ajaran_id`)', 'SELECT 1');
PREPARE stmt_idx FROM @sql_idx;
EXECUTE stmt_idx;
DEALLOCATE PREPARE stmt_idx;

-- 9. leave_requests
SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leave_requests' AND COLUMN_NAME = 'tahun_ajaran_id');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE `leave_requests` ADD COLUMN `tahun_ajaran_id` int(11) DEFAULT NULL COMMENT "FK ke tahun_ajaran" AFTER `tenant_id`, 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leave_requests' AND CONSTRAINT_NAME = 'fk_leave_ta');
SET @sql_fk := IF(@fk_exists = 0, 'ALTER TABLE `leave_requests` ADD CONSTRAINT `fk_leave_ta` FOREIGN KEY (`tahun_ajaran_id`) REFERENCES `tahun_ajaran` (`id`) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt_fk FROM @sql_fk;
EXECUTE stmt_fk;
DEALLOCATE PREPARE stmt_fk;

SET @idx_exists := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leave_requests' AND INDEX_NAME = 'idx_ta_leave');
SET @sql_idx := IF(@idx_exists = 0, 'ALTER TABLE `leave_requests` ADD KEY `idx_ta_leave` (`tahun_ajaran_id`)', 'SELECT 1');
PREPARE stmt_idx FROM @sql_idx;
EXECUTE stmt_idx;
DEALLOCATE PREPARE stmt_idx;

-- 10. payment_invoices
SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_invoices' AND COLUMN_NAME = 'tahun_ajaran_id');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE `payment_invoices` ADD COLUMN `tahun_ajaran_id` int(11) DEFAULT NULL COMMENT "FK ke tahun_ajaran" AFTER `tenant_id`, 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_invoices' AND CONSTRAINT_NAME = 'fk_invoice_ta');
SET @sql_fk := IF(@fk_exists = 0, 'ALTER TABLE `payment_invoices` ADD CONSTRAINT `fk_invoice_ta` FOREIGN KEY (`tahun_ajaran_id`) REFERENCES `tahun_ajaran` (`id`) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt_fk FROM @sql_fk;
EXECUTE stmt_fk;
DEALLOCATE PREPARE stmt_fk;

SET @idx_exists := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_invoices' AND INDEX_NAME = 'idx_ta_invoice');
SET @sql_idx := IF(@idx_exists = 0, 'ALTER TABLE `payment_invoices` ADD KEY `idx_ta_invoice` (`tahun_ajaran_id`)', 'SELECT 1');
PREPARE stmt_idx FROM @sql_idx;
EXECUTE stmt_idx;
DEALLOCATE PREPARE stmt_idx;

-- 11. payment_status_history
SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_status_history' AND COLUMN_NAME = 'tahun_ajaran_id');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE `payment_status_history` ADD COLUMN `tahun_ajaran_id` int(11) DEFAULT NULL COMMENT "FK ke tahun_ajaran" AFTER `tenant_id`, 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_status_history' AND CONSTRAINT_NAME = 'fk_psh_ta');
SET @sql_fk := IF(@fk_exists = 0, 'ALTER TABLE `payment_status_history` ADD CONSTRAINT `fk_psh_ta` FOREIGN KEY (`tahun_ajaran_id`) REFERENCES `tahun_ajaran` (`id`) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt_fk FROM @sql_fk;
EXECUTE stmt_fk;
DEALLOCATE PREPARE stmt_fk;

SET @idx_exists := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_status_history' AND INDEX_NAME = 'idx_ta_psh');
SET @sql_idx := IF(@idx_exists = 0, 'ALTER TABLE `payment_status_history` ADD KEY `idx_ta_psh` (`tahun_ajaran_id`)', 'SELECT 1');
PREPARE stmt_idx FROM @sql_idx;
EXECUTE stmt_idx;
DEALLOCATE PREPARE stmt_idx;

-- ============================================================
-- Data Backfill: Set tahun_ajaran_id for existing data
-- ============================================================

-- Backfill teacher_assignments
UPDATE `teacher_assignments` ta
JOIN `classes` c ON c.id = ta.class_id
JOIN `tahun_ajaran` t ON (t.tenant_id IS NULL OR t.tenant_id = ta.tenant_id) AND t.is_active = 1
SET ta.tahun_ajaran_id = t.id
WHERE ta.tahun_ajaran_id IS NULL;

-- Backfill tagihan_siswa based on periode
UPDATE `tagihan_siswa` ts
JOIN `tahun_ajaran` t ON (t.tenant_id IS NULL OR t.tenant_id = ts.tenant_id)
  AND STR_TO_DATE(CONCAT(ts.periode, '-01'), '%Y-%m-%d') BETWEEN t.tanggal_mulai AND t.tanggal_selesai
SET ts.tahun_ajaran_id = t.id
WHERE ts.tahun_ajaran_id IS NULL;

-- Backfill payment_transactions based on created_at or tanggal
UPDATE `payment_transactions` pt
JOIN `tahun_ajaran` t ON (t.tenant_id IS NULL OR t.tenant_id = pt.tenant_id)
  AND pt.created_at BETWEEN t.tanggal_mulai AND t.tanggal_selesai
SET pt.tahun_ajaran_id = t.id
WHERE pt.tahun_ajaran_id IS NULL;

-- Backfill attendance_logs based on waktu_scan
UPDATE `attendance_logs` al
JOIN `tahun_ajaran` t ON (t.tenant_id IS NULL OR t.tenant_id = al.tenant_id)
  AND al.waktu_scan BETWEEN t.tanggal_mulai AND t.tanggal_selesai
SET al.tahun_ajaran_id = t.id
WHERE al.tahun_ajaran_id IS NULL;

-- Backfill attendance_summary
UPDATE `attendance_summary` asum
JOIN `tahun_ajaran` t ON (t.tenant_id IS NULL OR t.tenant_id = asum.tenant_id)
  AND asum.bulan BETWEEN t.bulan_mulai AND t.bulan_selesai
SET asum.tahun_ajaran_id = t.id
WHERE asum.tahun_ajaran_id IS NULL;

-- Backfill payroll based on periode
UPDATE `payroll` p
JOIN `tahun_ajaran` t ON (t.tenant_id IS NULL OR t.tenant_id = p.tenant_id)
  AND p.periode BETWEEN t.tanggal_mulai AND t.tanggal_selesai
SET p.tahun_ajaran_id = t.id
WHERE p.tahun_ajaran_id IS NULL;

-- Backfill mutasi_students based on tanggal
UPDATE `mutasi_students` ms
JOIN `tahun_ajaran` t ON (t.tenant_id IS NULL OR t.tenant_id = ms.tenant_id)
  AND ms.tanggal BETWEEN t.tanggal_mulai AND t.tanggal_selesai
SET ms.tahun_ajaran_id = t.id
WHERE ms.tahun_ajaran_id IS NULL;

-- Backfill evaluations based on tanggal
UPDATE `evaluations` e
JOIN `tahun_ajaran` t ON (t.tenant_id IS NULL OR t.tenant_id = e.tenant_id)
  AND e.tanggal BETWEEN t.tanggal_mulai AND t.tanggal_selesai
SET e.tahun_ajaran_id = t.id
WHERE e.tahun_ajaran_id IS NULL;

-- Backfill leave_requests based on tanggal
UPDATE `leave_requests` lr
JOIN `tahun_ajaran` t ON (t.tenant_id IS NULL OR t.tenant_id = lr.tenant_id)
  AND lr.tanggal BETWEEN t.tanggal_mulai AND t.tanggal_selesai
SET lr.tahun_ajaran_id = t.id
WHERE lr.tahun_ajaran_id IS NULL;

-- Backfill payment_invoices based on created_at
UPDATE `payment_invoices` pi
JOIN `tahun_ajaran` t ON (t.tenant_id IS NULL OR t.tenant_id = pi.tenant_id)
  AND pi.created_at BETWEEN t.tanggal_mulai AND t.tanggal_selesai
SET pi.tahun_ajaran_id = t.id
WHERE pi.tahun_ajaran_id IS NULL;

-- Backfill payment_status_history based on created_at
UPDATE `payment_status_history` psh
JOIN `tahun_ajaran` t ON (t.tenant_id IS NULL OR t.tenant_id = psh.tenant_id)
  AND psh.created_at BETWEEN t.tanggal_mulai AND t.tanggal_selesai
SET psh.tahun_ajaran_id = t.id
WHERE psh.tahun_ajaran_id IS NULL;

-- ============================================================
-- Backfill classes and students to active TA (if still NULL)
-- ============================================================
UPDATE `classes` c
JOIN `tahun_ajaran` t ON (t.tenant_id IS NULL OR t.tenant_id = c.tenant_id) AND t.is_active = 1
SET c.tahun_ajaran_id = t.id
WHERE c.tahun_ajaran_id IS NULL;

UPDATE `students` s
JOIN `tahun_ajaran` t ON (t.tenant_id IS NULL OR t.tenant_id = s.tenant_id) AND t.is_active = 1
SET s.tahun_ajaran_id = t.id
WHERE s.tahun_ajaran_id IS NULL;
