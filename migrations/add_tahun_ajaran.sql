-- Migration: Add Tahun Ajaran (Academic Year) System
-- Run this migration to add academic year support

-- ============================================================
-- 1. Create tahun_ajaran table
-- ============================================================
CREATE TABLE IF NOT EXISTS `tahun_ajaran` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nama` varchar(20) NOT NULL COMMENT 'Format: 2024/2025',
  `tahun_mulai` year NOT NULL COMMENT 'Tahun mulai (2024)',
  `tahun_selesai` year NOT NULL COMMENT 'Tahun selesai (2025)',
  `bulan_mulai` tinyint(2) NOT NULL DEFAULT 7 COMMENT 'Bulan mulai TA (default 7 = Juli)',
  `tanggal_mulai` date NOT NULL COMMENT 'Tanggal mulai TA (2024-07-01)',
  `tanggal_selesai` date NOT NULL COMMENT 'Tanggal selesai TA (2025-06-30)',
  `is_active` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Hanya 1 yang aktif per tenant/global',
  `tenant_id` varchar(50) DEFAULT NULL COMMENT 'NULL = global (yayasan), else per sekolah',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ta_tenant_nama` (`tenant_id`, `nama`),
  KEY `idx_ta_tenant_active` (`tenant_id`, `is_active`),
  KEY `idx_ta_date_range` (`tanggal_mulai`, `tanggal_selesai`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 2. Create semester table (Ganjil/Genap per Tahun Ajaran)
-- ============================================================
CREATE TABLE IF NOT EXISTS `semester` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `tahun_ajaran_id` int(11) NOT NULL,
  `nama` enum('Ganjil','Genap') NOT NULL,
  `tanggal_mulai` date NOT NULL,
  `tanggal_selesai` date NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_semester_ta_nama` (`tahun_ajaran_id`, `nama`),
  KEY `idx_semester_ta` (`tahun_ajaran_id`),
  KEY `idx_semester_date` (`tanggal_mulai`, `tanggal_selesai`),
  CONSTRAINT `fk_semester_tahun_ajaran` FOREIGN KEY (`tahun_ajaran_id`) REFERENCES `tahun_ajaran` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 3. Add tahun_ajaran_id to classes
-- ============================================================
ALTER TABLE `classes` 
  ADD COLUMN `tahun_ajaran_id` int(11) DEFAULT NULL COMMENT 'FK ke tahun_ajaran',
  ADD COLUMN `semester_id` int(11) DEFAULT NULL COMMENT 'FK ke semester (opsional, untuk kelas per semester)',
  ADD KEY `idx_classes_ta` (`tahun_ajaran_id`),
  ADD KEY `idx_classes_semester` (`semester_id`),
  ADD CONSTRAINT `fk_classes_tahun_ajaran` FOREIGN KEY (`tahun_ajaran_id`) REFERENCES `tahun_ajaran` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_classes_semester` FOREIGN KEY (`semester_id`) REFERENCES `semester` (`id`) ON DELETE SET NULL;

-- ============================================================
-- 4. Add tahun_ajaran_id to students
-- ============================================================
ALTER TABLE `students` 
  ADD COLUMN `tahun_ajaran_id` int(11) DEFAULT NULL COMMENT 'TA saat siswa masuk/terdaftar',
  ADD KEY `idx_students_ta` (`tahun_ajaran_id`),
  ADD CONSTRAINT `fk_students_tahun_ajaran` FOREIGN KEY (`tahun_ajaran_id`) REFERENCES `tahun_ajaran` (`id`) ON DELETE SET NULL;

-- ============================================================
-- 5. Add tahun_ajaran_id to billing_payment
-- ============================================================
ALTER TABLE `billing_payment` 
  ADD COLUMN `tahun_ajaran_id` int(11) DEFAULT NULL COMMENT 'TA tagihan',
  ADD COLUMN `semester_id` int(11) DEFAULT NULL COMMENT 'Semester tagihan',
  ADD KEY `idx_billing_ta` (`tahun_ajaran_id`),
  ADD KEY `idx_billing_semester` (`semester_id`),
  ADD CONSTRAINT `fk_billing_tahun_ajaran` FOREIGN KEY (`tahun_ajaran_id`) REFERENCES `tahun_ajaran` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_billing_semester` FOREIGN KEY (`semester_id`) REFERENCES `semester` (`id`) ON DELETE SET NULL;

-- ============================================================
-- 6. Add tahun_ajaran_id to student_attendance
-- ============================================================
ALTER TABLE `student_attendance` 
  ADD COLUMN `tahun_ajaran_id` int(11) DEFAULT NULL COMMENT 'TA absensi',
  ADD COLUMN `semester_id` int(11) DEFAULT NULL COMMENT 'Semester absensi',
  ADD KEY `idx_student_att_ta` (`tahun_ajaran_id`),
  ADD KEY `idx_student_att_semester` (`semester_id`),
  ADD CONSTRAINT `fk_student_att_tahun_ajaran` FOREIGN KEY (`tahun_ajaran_id`) REFERENCES `tahun_ajaran` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_student_att_semester` FOREIGN KEY (`semester_id`) REFERENCES `semester` (`id`) ON DELETE SET NULL;

-- ============================================================
-- 7. Add tahun_ajaran_id to student_education_history
-- ============================================================
ALTER TABLE `student_education_history` 
  ADD COLUMN `tahun_ajaran_id` int(11) DEFAULT NULL COMMENT 'TA riwayat pendidikan',
  ADD KEY `idx_student_edu_ta` (`tahun_ajaran_id`),
  ADD CONSTRAINT `fk_student_edu_tahun_ajaran` FOREIGN KEY (`tahun_ajaran_id`) REFERENCES `tahun_ajaran` (`id`) ON DELETE SET NULL;

-- ============================================================
-- 8. Add tahun_ajaran_id to kafalah_payroll (if exists)
-- ============================================================
-- Note: Only add if table exists - check before running
-- ALTER TABLE `kafalah_payroll` ADD COLUMN `tahun_ajaran_id` int(11) DEFAULT NULL;

-- ============================================================
-- 9. Add tahun_ajaran_id to payroll (if exists)
-- ============================================================
-- ALTER TABLE `payroll` ADD COLUMN `tahun_ajaran_id` int(11) DEFAULT NULL;

-- ============================================================
-- 10. Create view for easy querying current active TA
-- ============================================================
CREATE OR REPLACE VIEW `v_current_tahun_ajaran` AS
SELECT 
  ta.*,
  CASE 
    WHEN ta.tenant_id IS NULL THEN 'GLOBAL' 
    ELSE CONCAT('TENANT:', ta.tenant_id) 
  END AS scope
FROM `tahun_ajaran` ta
WHERE ta.is_active = 1;

-- ============================================================
-- 11. Create function to get TA by date (for auto-detection)
-- ============================================================
DELIMITER //
CREATE FUNCTION `fn_get_tahun_ajaran_by_date`(
  p_date DATE,
  p_tenant_id VARCHAR(50)
) RETURNS INT
READS SQL DATA
DETERMINISTIC
BEGIN
  DECLARE v_ta_id INT DEFAULT NULL;
  
  -- Try tenant-specific first
  SELECT id INTO v_ta_id
  FROM `tahun_ajaran`
  WHERE tenant_id = p_tenant_id
    AND tanggal_mulai <= p_date
    AND tanggal_selesai >= p_date
    AND is_active = 1
  LIMIT 1;
  
  -- Fallback to global
  IF v_ta_id IS NULL THEN
    SELECT id INTO v_ta_id
    FROM `tahun_ajaran`
    WHERE tenant_id IS NULL
      AND tanggal_mulai <= p_date
      AND tanggal_selesai >= p_date
      AND is_active = 1
    LIMIT 1;
  END IF;
  
  RETURN v_ta_id;
END//
DELIMITER ;

-- ============================================================
-- 12. Seed initial data - Global TA 2024/2025 & 2025/2026
-- ============================================================
-- Adjust dates as needed for your yayasan
INSERT IGNORE INTO `tahun_ajaran` (`nama`, `tahun_mulai`, `tahun_selesai`, `bulan_mulai`, `tanggal_mulai`, `tanggal_selesai`, `is_active`, `tenant_id`) VALUES
('2024/2025', 2024, 2025, 7, '2024-07-01', '2025-06-30', 0, NULL),
('2025/2026', 2025, 2026, 7, '2025-07-01', '2026-06-30', 1, NULL),
('2026/2027', 2026, 2027, 7, '2026-07-01', '2027-06-30', 0, NULL);

-- ============================================================
-- 13. Seed semester for each TA
-- ============================================================
INSERT IGNORE INTO `semester` (`tahun_ajaran_id`, `nama`, `tanggal_mulai`, `tanggal_selesai`, `is_active`)
SELECT 
  ta.id,
  'Ganjil',
  ta.tanggal_mulai,
  DATE_SUB(ta.tanggal_mulai, INTERVAL -5 MONTH), -- Juli samping Nov (5 bulan)
  CASE WHEN ta.is_active = 1 THEN 1 ELSE 0 END
FROM `tahun_ajaran` ta;

INSERT IGNORE INTO `semester` (`tahun_ajaran_id`, `nama`, `tanggal_mulai`, `tanggal_selesai`, `is_active`)
SELECT 
  ta.id,
  'Genap',
  DATE_ADD(ta.tanggal_mulai, INTERVAL 6 MONTH), -- Januari
  ta.tanggal_selesai,
  0
FROM `tahun_ajaran` ta;

-- ============================================================
-- 14. Backfill existing data - Map students to TA based on tahun_masuk
-- ============================================================
-- This maps existing students to appropriate TA based on their tahun_masuk
-- Assumes tahun_masuk format is 'YYYY' or 'YYYY-MM'
UPDATE `students` s
JOIN `tahun_ajaran` ta ON (
  (ta.tenant_id IS NULL OR ta.tenant_id = s.tenant_id)
  AND (
    -- If tahun_masuk is just year (YYYY)
    (s.tahun_masuk REGEXP '^[0-9]{4}$' AND ta.tahun_mulai = CAST(s.tahun_masuk AS UNSIGNED))
    OR
    -- If tahun_masuk is YYYY-MM
    (s.tahun_masuk REGEXP '^[0-9]{4}-[0-9]{2}$' AND 
     ta.tanggal_mulai <= STR_TO_DATE(CONCAT(s.tahun_masuk, '-01'), '%Y-%m-%d')
     AND ta.tanggal_selesai >= STR_TO_DATE(CONCAT(s.tahun_masuk, '-01'), '%Y-%m-%d'))
  )
  AND ta.is_active = 1
)
SET s.tahun_ajaran_id = ta.id
WHERE s.tahun_ajaran_id IS NULL AND s.tahun_masuk IS NOT NULL AND s.tahun_masuk != '';

-- ============================================================
-- 15. Backfill classes to current active TA
-- ============================================================
UPDATE `classes` c
JOIN `tahun_ajaran` ta ON (
  ta.tenant_id IS NULL OR ta.tenant_id = c.tenant_id
)
SET c.tahun_ajaran_id = ta.id
WHERE c.tahun_ajaran_id IS NULL AND ta.is_active = 1;

-- ============================================================
-- 16. Backfill billing_payment to TA based on bulan
-- ============================================================
UPDATE `billing_payment` bp
JOIN `tahun_ajaran` ta ON (
  (ta.tenant_id IS NULL OR ta.tenant_id = bp.tenant_id)
  AND STR_TO_DATE(CONCAT(bp.bulan, '-01'), '%Y-%m-%d') BETWEEN ta.tanggal_mulai AND ta.tanggal_selesai
)
SET bp.tahun_ajaran_id = ta.id
WHERE bp.tahun_ajaran_id IS NULL;

-- ============================================================
-- 17. Backfill student_attendance to TA based on tanggal
-- ============================================================
UPDATE `student_attendance` sa
JOIN `tahun_ajaran` ta ON (
  (ta.tenant_id IS NULL OR ta.tenant_id = sa.tenant_id)
  AND sa.tanggal BETWEEN ta.tanggal_mulai AND ta.tanggal_selesai
)
SET sa.tahun_ajaran_id = ta.id
WHERE sa.tahun_ajaran_id IS NULL;