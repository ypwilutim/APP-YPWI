SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";

-- 1. attendance_logs: tambah index & foreign key rule_id
ALTER TABLE `attendance_logs`
  ADD INDEX `idx_rule_id` (`rule_id`);

ALTER TABLE `attendance_logs`
  ADD CONSTRAINT `attendance_logs_ibfk_3`
    FOREIGN KEY (`rule_id`) REFERENCES `attendance_rules` (`id`)
    ON DELETE SET NULL;

-- 2. attendance_rules: ubah status_log enum sesuai lokal (hanya 2 nilai)
ALTER TABLE `attendance_rules`
  CHANGE `status_log` `status_log` enum('tepat_waktu','terlambat') NOT NULL;

-- 3. Buat tabel attendance_summary
CREATE TABLE `attendance_summary` (
  `id` int(11) NOT NULL,
  `tenant_id` varchar(20) NOT NULL,
  `date` date NOT NULL,
  `total_teachers` int(11) DEFAULT 0,
  `present` int(11) DEFAULT 0,
  `late` int(11) DEFAULT 0,
  `absent` int(11) DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `attendance_summary`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `tenant_date` (`tenant_id`, `date`);

ALTER TABLE `attendance_summary`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

-- 4. evaluations: ubah collation ke utf8mb4_unicode_ci (sesuai lokal)
ALTER TABLE `evaluations`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 5. tenant_locations: tambah index idx_is_active
ALTER TABLE `tenant_locations`
  ADD KEY `idx_is_active` (`is_active`);

-- 6. users: tambah index yang ada di lokal
ALTER TABLE `users`
  ADD KEY `idx_username` (`username`),
  ADD KEY `idx_guru_id` (`guru_id`),
  ADD KEY `idx_tenant_id` (`tenant_id`),
  ADD KEY `idx_role` (`role`);

-- 7. sinkronisasi index tenants
ALTER TABLE `tenants`
  DROP INDEX `tenant_id`,
  ADD KEY `idx_tenant_id` (`tenant_id`);

-- 8. sinkronisasi index evaluations (ganti nama index jadi prefix idx_)
ALTER TABLE `evaluations`
  DROP INDEX `teacher_id`,
  ADD KEY `idx_teacher_id` (`teacher_id`),
  DROP INDEX `evaluator_id`,
  ADD KEY `idx_evaluator_id` (`evaluator_id`);

COMMIT;
