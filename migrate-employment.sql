CREATE TABLE IF NOT EXISTS `employment_rules` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `job_title_pattern` varchar(100) NOT NULL,
  `employment_type` enum('PTY','PTTY','GTY','GTTY') NOT NULL,
  `min_years` int(11) NOT NULL DEFAULT 0,
  `max_years` int(11) NOT NULL DEFAULT 2,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_title` (`job_title_pattern`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `employment_status_rules` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `employment_type` enum('PTY','PTTY','GTY','GTTY') NOT NULL,
  `min_years` int(11) NOT NULL,
  `max_years` int(11) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO `employment_rules` (`job_title_pattern`, `employment_type`, `min_years`, `max_years`) VALUES
('Admin', 'PTTY', 0, 2),
('TU', 'PTTY', 0, 2),
('Operator', 'PTTY', 0, 2),
('Pimpinan', 'PTTY', 0, 2),
('Kepala Sekolah', 'GTY', 0, 2),
('Bendahara', 'PTTY', 0, 2),
('Guru Mapel', 'GTY', 2, 100),
('Walikelas', 'GTY', 2, 100);

INSERT IGNORE INTO `employment_status_rules` (`employment_type`, `min_years`, `max_years`) VALUES
('PTY', 2, 100),
('PTTY', 0, 2),
('GTY', 2, 100),
('GTTY', 0, 2);