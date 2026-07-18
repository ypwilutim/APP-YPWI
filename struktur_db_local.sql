-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Waktu pembuatan: 17 Jul 2026 pada 23.52
-- Versi server: 10.4.32-MariaDB
-- Versi PHP: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `ypwh2917_ypwi_absensi`
--

-- --------------------------------------------------------

--
-- Struktur dari tabel `attendance_logs`
--

CREATE TABLE `attendance_logs` (
  `id` bigint(20) NOT NULL,
  `teacher_id` int(11) NOT NULL,
  `rule_id` int(11) DEFAULT NULL,
  `tenant_id` varchar(20) NOT NULL,
  `waktu_scan` datetime NOT NULL,
  `jenis` enum('masuk','pulang') NOT NULL,
  `metode` enum('dashboard','scanner') NOT NULL DEFAULT 'scanner',
  `status` enum('tepat_waktu','terlambat') NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `selfie_url` varchar(255) DEFAULT NULL,
  `dinas_luar` tinyint(1) DEFAULT 0,
  `kegiatan_dinas` text DEFAULT NULL,
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `keterangan` text DEFAULT NULL,
  `waktu_absen` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `attendance_rules`
--

CREATE TABLE `attendance_rules` (
  `id` int(11) NOT NULL,
  `tenant_id` varchar(20) NOT NULL,
  `tipe` enum('Datang','Pulang') NOT NULL,
  `jam_mulai` time NOT NULL,
  `jam_selesai` time NOT NULL,
  `keterangan` varchar(255) DEFAULT NULL,
  `status_log` enum('tepat_waktu','terlambat') NOT NULL,
  `hari` varchar(100) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `tipe_unit` varchar(20) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `attendance_summary`
--

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

-- --------------------------------------------------------

--
-- Struktur dari tabel `bill_settings`
--

CREATE TABLE `bill_settings` (
  `id` int(11) NOT NULL DEFAULT 1,
  `send_day` int(11) DEFAULT 1,
  `due_day` int(11) DEFAULT 10,
  `is_enabled` tinyint(1) DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `bsi_va_records`
--

CREATE TABLE `bsi_va_records` (
  `id` int(11) NOT NULL,
  `tenant_id` varchar(50) NOT NULL,
  `student_id` int(11) NOT NULL,
  `va_number` varchar(50) NOT NULL,
  `va_name` varchar(255) DEFAULT NULL,
  `amount` decimal(15,2) DEFAULT NULL,
  `status` enum('active','paid','expired') DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `paid_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `chat_messages`
--

CREATE TABLE `chat_messages` (
  `id` int(11) NOT NULL,
  `conversation_id` int(11) NOT NULL,
  `sender_id` int(11) NOT NULL,
  `sender_name` varchar(100) NOT NULL,
  `sender_type` enum('guru','parent') DEFAULT 'guru',
  `message` text NOT NULL,
  `reply_to_message_id` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `classes`
--

CREATE TABLE `classes` (
  `id` int(11) NOT NULL,
  `tenant_id` varchar(50) DEFAULT NULL,
  `nama_kelas` varchar(50) DEFAULT NULL,
  `tingkatan` varchar(20) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `conversations`
--

CREATE TABLE `conversations` (
  `id` int(11) NOT NULL,
  `tenant_id` varchar(20) DEFAULT NULL,
  `is_global` tinyint(1) DEFAULT 0,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `conversation_participants`
--

CREATE TABLE `conversation_participants` (
  `id` int(11) NOT NULL,
  `conversation_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `user_type` enum('guru','parent') DEFAULT 'guru',
  `last_read_at` timestamp NULL DEFAULT NULL,
  `is_typing` tinyint(1) DEFAULT 0,
  `typing_expires_at` timestamp NULL DEFAULT NULL,
  `last_seen_at` timestamp NULL DEFAULT NULL,
  `joined_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `email_logs`
--

CREATE TABLE `email_logs` (
  `id` int(11) NOT NULL,
  `from_email` varchar(255) NOT NULL,
  `to_email` varchar(255) NOT NULL,
  `cc` varchar(255) DEFAULT NULL,
  `bcc` varchar(255) DEFAULT NULL,
  `subject` varchar(255) NOT NULL,
  `category` varchar(100) DEFAULT 'system',
  `related_id` int(11) DEFAULT NULL,
  `status` enum('pending','sent','failed','draft') DEFAULT 'pending',
  `message_id` varchar(255) DEFAULT NULL,
  `error_message` text DEFAULT NULL,
  `body_text` text DEFAULT NULL,
  `body_html` longtext DEFAULT NULL,
  `has_attachments` tinyint(1) DEFAULT 0,
  `is_read` tinyint(1) DEFAULT 0,
  `sent_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `employment_rules`
--

CREATE TABLE `employment_rules` (
  `id` int(11) NOT NULL,
  `job_title_pattern` varchar(100) NOT NULL,
  `employment_type` enum('PTY','PTTY','GTY','GTTY') NOT NULL,
  `min_years` int(11) NOT NULL DEFAULT 0,
  `max_years` int(11) NOT NULL DEFAULT 2
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `employment_status_rules`
--

CREATE TABLE `employment_status_rules` (
  `id` int(11) NOT NULL,
  `employment_type` enum('PTY','PTTY','GTY','GTTY') NOT NULL,
  `min_years` int(11) NOT NULL,
  `max_years` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `evaluations`
--

CREATE TABLE `evaluations` (
  `id` int(11) NOT NULL,
  `teacher_id` int(11) NOT NULL,
  `evaluator_id` int(11) NOT NULL,
  `tenant_id` varchar(20) NOT NULL,
  `score` int(11) NOT NULL CHECK (`score` >= 1 and `score` <= 5),
  `category` enum('kehadiran','disiplin','profesionalisme','komunikasi','kepemimpinan') DEFAULT 'kehadiran',
  `notes` text DEFAULT NULL,
  `evaluation_date` date DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `idcard_templates`
--

CREATE TABLE `idcard_templates` (
  `id` int(11) NOT NULL,
  `template_name` varchar(100) DEFAULT NULL,
  `template_data` longtext DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `template_type` enum('teacher','student') DEFAULT 'teacher',
  `preview_image` longtext DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `leave_requests`
--

CREATE TABLE `leave_requests` (
  `id` int(11) NOT NULL,
  `teacher_id` int(11) NOT NULL,
  `tenant_id` varchar(50) DEFAULT NULL,
  `jenis` enum('izin','sakit','cuti','dinas_luar') NOT NULL,
  `keterangan` text NOT NULL,
  `tanggal_mulai` date NOT NULL,
  `tanggal_selesai` date NOT NULL,
  `status` enum('pending','approved','rejected') DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `midtrans_transactions`
--

CREATE TABLE `midtrans_transactions` (
  `id` int(11) NOT NULL,
  `tenant_id` varchar(20) DEFAULT NULL,
  `student_id` int(11) DEFAULT NULL,
  `order_id` varchar(100) NOT NULL,
  `gross_amount` decimal(12,2) DEFAULT 0.00,
  `transaction_status` varchar(50) DEFAULT NULL,
  `payment_type` varchar(50) DEFAULT NULL,
  `status` varchar(30) DEFAULT NULL,
  `snap_token` varchar(255) DEFAULT NULL,
  `redirect_url` varchar(512) DEFAULT NULL,
  `raw` text DEFAULT NULL,
  `paid_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `mutasi_students`
--

CREATE TABLE `mutasi_students` (
  `id` int(11) NOT NULL,
  `student_id` int(11) NOT NULL,
  `old_tenant_id` varchar(50) DEFAULT NULL,
  `new_tenant_id` varchar(50) DEFAULT NULL,
  `reason` text DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `pakta_config`
--

CREATE TABLE `pakta_config` (
  `id` int(11) NOT NULL DEFAULT 1,
  `judul` varchar(255) NOT NULL DEFAULT 'Pakta Integritas',
  `teks_pakta` text NOT NULL COMMENT 'Teks isi pakta (HTML aman / plain)',
  `klausul_sanksi` text DEFAULT NULL COMMENT 'Teks klausul sanksi',
  `nominal_sanksi` decimal(12,2) NOT NULL DEFAULT 1500000.00 COMMENT 'Rp 1.500.000',
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `pakta_integritas`
--

CREATE TABLE `pakta_integritas` (
  `id` int(11) NOT NULL,
  `teacher_id` int(11) NOT NULL COMMENT 'FK ke teachers.id (penandatangan)',
  `tenant_id` varchar(20) NOT NULL COMMENT 'Tenant sekolah penandatangan',
  `periode` varchar(7) NOT NULL COMMENT 'YYYY-MM periode pakta',
  `status` enum('belum','sudah','ditolak') NOT NULL DEFAULT 'belum',
  `pdf_path` varchar(255) DEFAULT NULL COMMENT 'Path relatif file PDF hasil tanda tangan',
  `signature_data` longtext DEFAULT NULL COMMENT 'Data URL tanda tangan (PNG base64)',
  `signed_at` timestamp NULL DEFAULT NULL COMMENT 'Waktu penandatanganan',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `parents`
--

CREATE TABLE `parents` (
  `id` int(11) NOT NULL,
  `nama_orang_tua` varchar(255) DEFAULT NULL,
  `no_wa` varchar(30) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `payment_gateways`
--

CREATE TABLE `payment_gateways` (
  `id` int(11) NOT NULL,
  `tenant_id` varchar(20) NOT NULL,
  `gateway` varchar(20) NOT NULL,
  `api_key` varchar(255) DEFAULT NULL,
  `api_secret` varchar(255) DEFAULT NULL,
  `client_key` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 0,
  `config` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`config`)),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `payment_invoices`
--

CREATE TABLE `payment_invoices` (
  `id` int(11) NOT NULL,
  `tenant_id` varchar(20) NOT NULL,
  `student_id` int(11) NOT NULL,
  `invoice_number` varchar(50) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `description` text DEFAULT NULL,
  `periode` varchar(20) NOT NULL,
  `status` enum('pending','approved','paid','expired','cancelled') DEFAULT 'pending',
  `due_date` date DEFAULT NULL,
  `paid_at` datetime DEFAULT NULL,
  `paid_amount` decimal(12,2) DEFAULT NULL,
  `payment_method` varchar(50) DEFAULT NULL,
  `payment_channel` varchar(50) DEFAULT NULL,
  `approved_by` int(11) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `payment_proof_url` varchar(255) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`metadata`)),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `payment_settings`
--

CREATE TABLE `payment_settings` (
  `tenant_id` varchar(20) NOT NULL,
  `monthly_amount` decimal(12,2) DEFAULT NULL,
  `due_day` int(11) DEFAULT 10,
  `is_enabled` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `payment_status_history`
--

CREATE TABLE `payment_status_history` (
  `id` int(11) NOT NULL,
  `invoice_id` int(11) NOT NULL,
  `old_status` varchar(50) DEFAULT NULL,
  `new_status` varchar(50) NOT NULL,
  `changed_by` int(11) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `payment_transactions`
--

CREATE TABLE `payment_transactions` (
  `id` bigint(20) NOT NULL,
  `tenant_id` varchar(20) NOT NULL,
  `student_id` int(11) DEFAULT NULL,
  `gateway` varchar(20) NOT NULL,
  `external_id` varchar(100) DEFAULT NULL,
  `amount` decimal(12,2) DEFAULT NULL,
  `status` varchar(20) DEFAULT NULL,
  `payment_method` varchar(50) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`metadata`)),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `paid_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `payroll`
--

CREATE TABLE `payroll` (
  `id` int(11) NOT NULL,
  `teacher_id` int(11) NOT NULL,
  `tenant_id` varchar(50) DEFAULT NULL,
  `periode` varchar(7) NOT NULL,
  `gaji_pokok` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tunj_kinerja` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tunj_umum` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tunj_istri` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tunj_anak` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tunj_kepala_sekolah` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tunj_wali_kelas` decimal(12,2) NOT NULL DEFAULT 0.00,
  `honor_bendahara` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tunj_kehadiran` decimal(12,2) NOT NULL DEFAULT 0.00,
  `potongan` decimal(12,2) NOT NULL DEFAULT 0.00,
  `total_gaji` decimal(14,2) NOT NULL DEFAULT 0.00,
  `hadir` int(11) NOT NULL DEFAULT 0,
  `terlambat` int(11) NOT NULL DEFAULT 0,
  `izin` int(11) NOT NULL DEFAULT 0,
  `sakit` int(11) NOT NULL DEFAULT 0,
  `tanpa_keterangan` int(11) NOT NULL DEFAULT 0,
  `tidak_hadir` int(11) NOT NULL DEFAULT 0,
  `dinas_luar` int(11) NOT NULL DEFAULT 0,
  `cuti` int(11) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `created_by` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `payroll_settings`
--

CREATE TABLE `payroll_settings` (
  `id` int(11) NOT NULL DEFAULT 1,
  `potongan_terlambat` decimal(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Rupiah potongan per kali terlambat',
  `potongan_izin` decimal(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Rupiah potongan per hari izin/cuti',
  `potongan_sakit` decimal(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Rupiah potongan per hari sakit',
  `potongan_tanpa_keterangan` decimal(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Rupiah potongan per hari tanpa keterangan (alpha)',
  `potongan_tidak_hadir` decimal(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Rupiah potongan per hari tidak hadir',
  `tunj_kehadiran` decimal(12,2) NOT NULL DEFAULT 0.00 COMMENT 'T. Kehadiran (nominal tetap, semua guru aktif)',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `qr_attendance_logs`
--

CREATE TABLE `qr_attendance_logs` (
  `id` int(11) NOT NULL,
  `scan_id` varchar(20) NOT NULL,
  `teacher_id` int(11) DEFAULT NULL,
  `device_id` varchar(100) NOT NULL,
  `tenant_id` varchar(20) NOT NULL,
  `waktu_scan` datetime NOT NULL,
  `jenis` enum('masuk','pulang') NOT NULL,
  `signature` varchar(255) NOT NULL,
  `sync_status` enum('pending','synced','failed','rejected') DEFAULT 'pending',
  `error_message` text DEFAULT NULL,
  `offline_validated` tinyint(1) DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `synced_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `relief_requests`
--

CREATE TABLE `relief_requests` (
  `id` int(11) NOT NULL,
  `student_id` int(11) NOT NULL,
  `invoice_id` int(11) NOT NULL,
  `requested_amount` decimal(10,2) DEFAULT NULL,
  `reason` text DEFAULT NULL,
  `status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `relief_amount` decimal(10,2) DEFAULT 0.00,
  `reviewed_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `reviewed_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `scanner_devices`
--

CREATE TABLE `scanner_devices` (
  `id` int(11) NOT NULL,
  `device_id` varchar(100) NOT NULL,
  `tenant_id` varchar(20) NOT NULL,
  `registration_token` varchar(255) DEFAULT NULL,
  `school_name` varchar(100) NOT NULL,
  `secret_key` varchar(255) NOT NULL,
  `status` enum('active','inactive','maintenance') DEFAULT 'inactive',
  `last_sync` datetime DEFAULT NULL,
  `device_name` varchar(100) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `sk_automation_settings`
--

CREATE TABLE `sk_automation_settings` (
  `id` int(11) NOT NULL,
  `min_service_years` int(11) NOT NULL DEFAULT 2,
  `auto_generate_enabled` tinyint(1) NOT NULL DEFAULT 1,
  `schedule_day` int(11) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `auto_generate_date` varchar(5) DEFAULT '01-01'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `sk_guru`
--

CREATE TABLE `sk_guru` (
  `id` int(11) NOT NULL,
  `teacher_id` int(11) NOT NULL,
  `tenant_id` varchar(20) NOT NULL,
  `no_surat` varchar(100) NOT NULL,
  `tentang` varchar(255) NOT NULL,
  `ttl` varchar(100) DEFAULT NULL,
  `tmt` varchar(50) DEFAULT NULL,
  `pt` varchar(255) DEFAULT NULL,
  `niy` varchar(30) DEFAULT NULL,
  `unit` varchar(100) DEFAULT NULL,
  `bh` varchar(100) DEFAULT NULL,
  `bm` varchar(100) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `sk_sequence`
--

CREATE TABLE `sk_sequence` (
  `tenant_id` varchar(20) NOT NULL,
  `hijri_year` int(11) NOT NULL,
  `hijri_month` varchar(20) DEFAULT NULL,
  `last_number` int(11) NOT NULL DEFAULT 0,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `students`
--

CREATE TABLE `students` (
  `id` int(11) NOT NULL,
  `tenant_id` varchar(50) DEFAULT NULL,
  `parent_id` int(11) DEFAULT NULL,
  `class_id` int(11) DEFAULT NULL,
  `nama_siswa` varchar(255) DEFAULT NULL,
  `nisn` varchar(50) DEFAULT NULL,
  `jenis_kelamin` enum('L','P') DEFAULT NULL,
  `iuran_bulanan` decimal(10,2) DEFAULT NULL,
  `nis` varchar(50) DEFAULT NULL,
  `va_number` varchar(50) DEFAULT NULL,
  `va_name` varchar(100) DEFAULT NULL,
  `status` enum('aktif','alumni','mutasi','keluar') NOT NULL DEFAULT 'aktif'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `tagihan_siswa`
--

CREATE TABLE `tagihan_siswa` (
  `id` int(11) NOT NULL,
  `student_id` int(11) NOT NULL,
  `tenant_id` int(11) NOT NULL,
  `periode` varchar(20) NOT NULL,
  `jumlah_tagihan` decimal(10,2) DEFAULT 0.00,
  `status` enum('terkirim','gagal','diterima') DEFAULT 'terkirim',
  `message_id` varchar(100) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `teachers`
--

CREATE TABLE `teachers` (
  `id` int(11) NOT NULL,
  `nama` varchar(100) NOT NULL,
  `BANK` varchar(50) DEFAULT NULL,
  `nomor_rekening` varchar(50) DEFAULT NULL,
  `nik` varchar(20) NOT NULL,
  `tempat_lahir` varchar(50) DEFAULT NULL,
  `tanggal_lahir` date DEFAULT NULL,
  `jenis_kelamin` enum('L','P') DEFAULT NULL,
  `alamat` text DEFAULT NULL,
  `no_wa` varchar(20) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `status_kepegawaian` varchar(50) DEFAULT NULL,
  `tmt` date DEFAULT NULL,
  `nip` varchar(50) DEFAULT NULL,
  `scan_id` varchar(20) DEFAULT NULL,
  `link_foto` varchar(255) DEFAULT NULL,
  `status_aktif` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `pendidikan_terakhir` varchar(100) DEFAULT NULL,
  `gaji_pokok` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tunj_kinerja` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tunj_umum` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tunj_istri` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tunj_anak` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tunj_kepala_sekolah` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tunj_wali_kelas` decimal(12,2) NOT NULL DEFAULT 0.00,
  `honor_bendahara` decimal(12,2) NOT NULL DEFAULT 0.00,
  `potongan` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tunj_kehadiran` decimal(12,2) NOT NULL DEFAULT 0.00
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Trigger `teachers`
--
DELIMITER $$
CREATE TRIGGER `before_teacher_insert` BEFORE INSERT ON `teachers` FOR EACH ROW BEGIN
    -- Jika TMT sudah 2 tahun atau lebih, NIP wajib diisi (tidak boleh NIK-RANDOM atau Kosong)
    IF NEW.tmt <= DATE_SUB(CURDATE(), INTERVAL 2 YEAR) THEN
        IF NEW.nip IS NULL OR NEW.nip = '' OR NEW.nip = '-' THEN
            SIGNAL SQLSTATE '45000' 
            SET MESSAGE_TEXT = 'Error #1644 - NIP wajib diisi jika TMT sudah 2 tahun atau lebih';
        END IF;
    END IF;
END
$$
DELIMITER ;

-- --------------------------------------------------------

--
-- Struktur dari tabel `teacher_assignments`
--

CREATE TABLE `teacher_assignments` (
  `id` int(11) NOT NULL,
  `teacher_id` int(11) NOT NULL,
  `tenant_id` varchar(20) NOT NULL,
  `jabatan_di_unit` varchar(100) DEFAULT NULL,
  `class_id` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `teacher_attendance_stats`
--

CREATE TABLE `teacher_attendance_stats` (
  `id` int(11) NOT NULL,
  `teacher_id` int(11) NOT NULL,
  `tenant_id` varchar(20) NOT NULL,
  `month` year(4) NOT NULL,
  `total_days` int(11) DEFAULT 0,
  `present_days` int(11) DEFAULT 0,
  `late_days` int(11) DEFAULT 0,
  `alpha_days` int(11) DEFAULT 0,
  `attendance_rate` decimal(5,2) DEFAULT 0.00,
  `last_updated` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `temp_teachers`
--

CREATE TABLE `temp_teachers` (
  `Nama` varchar(255) DEFAULT NULL,
  `NIY` varchar(100) DEFAULT NULL,
  `NIK` varchar(100) DEFAULT NULL,
  `Jenis_Kelamin` varchar(50) DEFAULT NULL,
  `Tempat_Lahir` varchar(100) DEFAULT NULL,
  `Tanggal_Lahir` varchar(100) DEFAULT NULL,
  `Alamat` text DEFAULT NULL,
  `No_WA` varchar(50) DEFAULT NULL,
  `Email` varchar(255) DEFAULT NULL,
  `tenant_id` varchar(50) DEFAULT NULL,
  `Jenjang` varchar(100) DEFAULT NULL,
  `Jabatan` varchar(100) DEFAULT NULL,
  `Status_Kepegawaian` varchar(100) DEFAULT NULL,
  `TMT` varchar(100) DEFAULT NULL,
  `Status_Aktif` varchar(50) DEFAULT NULL,
  `Keterangan` text DEFAULT NULL,
  `Link_Foto` varchar(255) DEFAULT NULL,
  `Terima_Notifikasi` varchar(20) DEFAULT NULL,
  `Gaji_Pokok` varchar(100) DEFAULT NULL,
  `Tunj_Kinerja` varchar(100) DEFAULT NULL,
  `Tunj_Umum` varchar(100) DEFAULT NULL,
  `Tunj_Istri` varchar(100) DEFAULT NULL,
  `Tunj_Anak` varchar(100) DEFAULT NULL,
  `Tunj_Kepala_Sekolah` varchar(100) DEFAULT NULL,
  `Tunj_Wali_Kelas` varchar(100) DEFAULT NULL,
  `Honor_Bendahara` varchar(100) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `tenants`
--

CREATE TABLE `tenants` (
  `id` int(11) NOT NULL,
  `tenant_id` varchar(20) NOT NULL,
  `tipe_unit` enum('yayasan','sekolah','pondok','TKIT','SDIT','SMPIT','SMAIT') NOT NULL DEFAULT 'sekolah',
  `nama_sekolah` varchar(100) NOT NULL,
  `nomor_rekening` varchar(50) DEFAULT NULL,
  `absensi_method` enum('personal','gateway') NOT NULL DEFAULT 'personal',
  `wa_api_key` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `location_radius` int(11) DEFAULT 100,
  `location_name` varchar(255) DEFAULT NULL,
  `use_central_rules` tinyint(1) DEFAULT 0,
  `registration_token` varchar(255) DEFAULT NULL,
  `bank_account_number` varchar(50) DEFAULT NULL,
  `bank_account_name` varchar(100) DEFAULT NULL,
  `xendit_api_key` varchar(255) DEFAULT NULL,
  `xendit_public_key` varchar(255) DEFAULT NULL,
  `xendit_webhook_token` varchar(255) DEFAULT NULL,
  `xendit_enabled` tinyint(1) DEFAULT 0,
  `midtrans_server_key` varchar(255) DEFAULT NULL,
  `midtrans_client_key` varchar(255) DEFAULT NULL,
  `midtrans_enabled` tinyint(1) DEFAULT 0,
  `midtrans_is_production` tinyint(1) DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `tenant_locations`
--

CREATE TABLE `tenant_locations` (
  `id` int(11) NOT NULL,
  `tenant_id` varchar(20) NOT NULL,
  `location_name` varchar(100) NOT NULL DEFAULT 'Lokasi Utama',
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `location_radius` int(11) DEFAULT 100,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `users`
--

CREATE TABLE `users` (
  `id` int(11) NOT NULL,
  `username` varchar(50) NOT NULL,
  `password` varchar(255) NOT NULL,
  `role` enum('admin','guru') NOT NULL,
  `guru_id` int(11) DEFAULT NULL,
  `tenant_id` varchar(20) DEFAULT NULL,
  `is_profile_complete` tinyint(1) DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `is_default_password` tinyint(1) DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `whatsapp_messages`
--

CREATE TABLE `whatsapp_messages` (
  `id` int(11) NOT NULL,
  `from_phone` varchar(20) NOT NULL,
  `message` text DEFAULT NULL,
  `message_type` enum('text','image','audio','video','document','location','contacts','interactive','unknown') DEFAULT 'text',
  `wa_message_id` varchar(100) DEFAULT NULL,
  `profile_name` varchar(100) DEFAULT NULL,
  `status` enum('received','read','replied','archived') DEFAULT 'received',
  `reply_to_id` int(11) DEFAULT NULL,
  `parent_id` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `xendit_invoices`
--

CREATE TABLE `xendit_invoices` (
  `id` int(11) NOT NULL,
  `tenant_id` varchar(20) NOT NULL,
  `student_id` int(11) DEFAULT NULL,
  `xendit_invoice_id` varchar(100) DEFAULT NULL,
  `external_id` varchar(100) DEFAULT NULL,
  `periode` char(7) DEFAULT NULL,
  `amount` decimal(10,2) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `status` varchar(50) DEFAULT 'PENDING',
  `due_date` date DEFAULT NULL,
  `is_arrears` tinyint(1) NOT NULL DEFAULT 0,
  `type` enum('spp','keringanan') NOT NULL DEFAULT 'spp',
  `arrears_base` decimal(10,2) NOT NULL DEFAULT 0.00,
  `superseded` tinyint(1) NOT NULL DEFAULT 0,
  `payment_method` varchar(50) DEFAULT NULL,
  `payment_channel` varchar(50) DEFAULT NULL,
  `callback_url` varchar(255) DEFAULT NULL,
  `invoice_url` varchar(255) DEFAULT NULL,
  `paid_at` datetime DEFAULT NULL,
  `expiry_date` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `ypwi_database___database_siswa`
--

CREATE TABLE `ypwi_database___database_siswa` (
  `nama_siswa` varchar(255) DEFAULT NULL,
  `jenis_kelamin` varchar(20) DEFAULT NULL,
  `tenant_id` varchar(100) DEFAULT NULL,
  `password` varchar(255) DEFAULT NULL,
  `jenjang` varchar(50) DEFAULT NULL,
  `nama_sheet` varchar(100) DEFAULT NULL,
  `nisn` varchar(50) DEFAULT NULL,
  `kelas` varchar(50) DEFAULT NULL,
  `iuran_bulanan` varchar(50) DEFAULT NULL,
  `nama_orang_tua` varchar(255) DEFAULT NULL,
  `no_wa` varchar(30) DEFAULT NULL,
  `keterangan` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

--
-- Indexes for dumped tables
--

--
-- Indeks untuk tabel `attendance_logs`
--
ALTER TABLE `attendance_logs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_teacher_id` (`teacher_id`),
  ADD KEY `idx_tenant_id` (`tenant_id`),
  ADD KEY `idx_waktu_scan` (`waktu_scan`),
  ADD KEY `idx_jenis` (`jenis`),
  ADD KEY `idx_rule_id` (`rule_id`);

--
-- Indeks untuk tabel `attendance_rules`
--
ALTER TABLE `attendance_rules`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_tenant_id` (`tenant_id`),
  ADD KEY `idx_tipe_unit` (`tipe_unit`);

--
-- Indeks untuk tabel `attendance_summary`
--
ALTER TABLE `attendance_summary`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `tenant_date` (`tenant_id`,`date`);

--
-- Indeks untuk tabel `bill_settings`
--
ALTER TABLE `bill_settings`
  ADD PRIMARY KEY (`id`);

--
-- Indeks untuk tabel `bsi_va_records`
--
ALTER TABLE `bsi_va_records`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_student_va` (`student_id`);

--
-- Indeks untuk tabel `chat_messages`
--
ALTER TABLE `chat_messages`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_conversation` (`conversation_id`),
  ADD KEY `idx_created_at` (`created_at`);

--
-- Indeks untuk tabel `classes`
--
ALTER TABLE `classes`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fk_classes_tenant` (`tenant_id`);

--
-- Indeks untuk tabel `conversations`
--
ALTER TABLE `conversations`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_tenant` (`tenant_id`);

--
-- Indeks untuk tabel `conversation_participants`
--
ALTER TABLE `conversation_participants`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_participant` (`conversation_id`,`user_id`),
  ADD KEY `idx_user` (`user_id`);

--
-- Indeks untuk tabel `email_logs`
--
ALTER TABLE `email_logs`
  ADD PRIMARY KEY (`id`);

--
-- Indeks untuk tabel `employment_rules`
--
ALTER TABLE `employment_rules`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_title` (`job_title_pattern`);

--
-- Indeks untuk tabel `employment_status_rules`
--
ALTER TABLE `employment_status_rules`
  ADD PRIMARY KEY (`id`);

--
-- Indeks untuk tabel `evaluations`
--
ALTER TABLE `evaluations`
  ADD PRIMARY KEY (`id`),
  ADD KEY `teacher_id` (`teacher_id`),
  ADD KEY `evaluator_id` (`evaluator_id`);

--
-- Indeks untuk tabel `idcard_templates`
--
ALTER TABLE `idcard_templates`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `template_name` (`template_name`);

--
-- Indeks untuk tabel `leave_requests`
--
ALTER TABLE `leave_requests`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fk_leave_teacher` (`teacher_id`);

--
-- Indeks untuk tabel `midtrans_transactions`
--
ALTER TABLE `midtrans_transactions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_order` (`order_id`),
  ADD KEY `idx_tenant` (`tenant_id`),
  ADD KEY `idx_student` (`student_id`);

--
-- Indeks untuk tabel `mutasi_students`
--
ALTER TABLE `mutasi_students`
  ADD PRIMARY KEY (`id`),
  ADD KEY `student_id` (`student_id`);

--
-- Indeks untuk tabel `pakta_config`
--
ALTER TABLE `pakta_config`
  ADD PRIMARY KEY (`id`);

--
-- Indeks untuk tabel `pakta_integritas`
--
ALTER TABLE `pakta_integritas`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_teacher_periode` (`teacher_id`,`periode`),
  ADD KEY `tenant_id` (`tenant_id`),
  ADD KEY `status` (`status`);

--
-- Indeks untuk tabel `parents`
--
ALTER TABLE `parents`
  ADD PRIMARY KEY (`id`);

--
-- Indeks untuk tabel `payment_gateways`
--
ALTER TABLE `payment_gateways`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_gateway_per_tenant` (`tenant_id`,`gateway`);

--
-- Indeks untuk tabel `payment_invoices`
--
ALTER TABLE `payment_invoices`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_invoice_number` (`invoice_number`),
  ADD KEY `idx_tenant_id` (`tenant_id`),
  ADD KEY `idx_student_id` (`student_id`),
  ADD KEY `idx_periode` (`periode`),
  ADD KEY `idx_status` (`status`);

--
-- Indeks untuk tabel `payment_settings`
--
ALTER TABLE `payment_settings`
  ADD PRIMARY KEY (`tenant_id`);

--
-- Indeks untuk tabel `payment_status_history`
--
ALTER TABLE `payment_status_history`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_invoice_id` (`invoice_id`);

--
-- Indeks untuk tabel `payment_transactions`
--
ALTER TABLE `payment_transactions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_tenant_gateway` (`tenant_id`,`gateway`),
  ADD KEY `idx_external` (`external_id`),
  ADD KEY `idx_student` (`student_id`),
  ADD KEY `idx_status` (`status`);

--
-- Indeks untuk tabel `payroll`
--
ALTER TABLE `payroll`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_teacher_periode` (`teacher_id`,`periode`),
  ADD KEY `periode` (`periode`),
  ADD KEY `tenant_id` (`tenant_id`);

--
-- Indeks untuk tabel `payroll_settings`
--
ALTER TABLE `payroll_settings`
  ADD PRIMARY KEY (`id`);

--
-- Indeks untuk tabel `qr_attendance_logs`
--
ALTER TABLE `qr_attendance_logs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_scan_id` (`scan_id`),
  ADD KEY `idx_device_id` (`device_id`),
  ADD KEY `idx_teacher_id` (`teacher_id`),
  ADD KEY `idx_tenant_id` (`tenant_id`),
  ADD KEY `idx_sync_status` (`sync_status`),
  ADD KEY `idx_waktu_scan` (`waktu_scan`);

--
-- Indeks untuk tabel `relief_requests`
--
ALTER TABLE `relief_requests`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_relief_student` (`student_id`),
  ADD KEY `idx_relief_status` (`status`);

--
-- Indeks untuk tabel `scanner_devices`
--
ALTER TABLE `scanner_devices`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `device_id` (`device_id`),
  ADD KEY `idx_tenant_id` (`tenant_id`),
  ADD KEY `idx_device_id` (`device_id`),
  ADD KEY `idx_status` (`status`);

--
-- Indeks untuk tabel `sk_automation_settings`
--
ALTER TABLE `sk_automation_settings`
  ADD PRIMARY KEY (`id`);

--
-- Indeks untuk tabel `sk_guru`
--
ALTER TABLE `sk_guru`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_teacher_id` (`teacher_id`),
  ADD KEY `idx_tenant_id` (`tenant_id`);

--
-- Indeks untuk tabel `sk_sequence`
--
ALTER TABLE `sk_sequence`
  ADD PRIMARY KEY (`tenant_id`,`hijri_year`),
  ADD KEY `idx_tenant_hijri` (`tenant_id`,`hijri_year`);

--
-- Indeks untuk tabel `students`
--
ALTER TABLE `students`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `nis` (`nis`),
  ADD KEY `parent_id` (`parent_id`),
  ADD KEY `class_id` (`class_id`),
  ADD KEY `fk_students_tenant` (`tenant_id`),
  ADD KEY `idx_status` (`status`);

--
-- Indeks untuk tabel `tagihan_siswa`
--
ALTER TABLE `tagihan_siswa`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_tagihan` (`student_id`,`periode`);

--
-- Indeks untuk tabel `teachers`
--
ALTER TABLE `teachers`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `nik` (`nik`),
  ADD UNIQUE KEY `scan_id` (`scan_id`),
  ADD KEY `idx_nik` (`nik`),
  ADD KEY `idx_scan_id` (`scan_id`),
  ADD KEY `idx_status_aktif` (`status_aktif`);

--
-- Indeks untuk tabel `teacher_assignments`
--
ALTER TABLE `teacher_assignments`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_teacher_unit_job` (`teacher_id`,`tenant_id`,`jabatan_di_unit`),
  ADD KEY `idx_teacher_id` (`teacher_id`),
  ADD KEY `idx_tenant_id` (`tenant_id`),
  ADD KEY `idx_class_id` (`class_id`);

--
-- Indeks untuk tabel `teacher_attendance_stats`
--
ALTER TABLE `teacher_attendance_stats`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_teacher_month` (`teacher_id`,`tenant_id`,`month`);

--
-- Indeks untuk tabel `tenants`
--
ALTER TABLE `tenants`
  ADD PRIMARY KEY (`tenant_id`),
  ADD KEY `idx_tenant_id` (`tenant_id`),
  ADD KEY `id` (`id`);

--
-- Indeks untuk tabel `tenant_locations`
--
ALTER TABLE `tenant_locations`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_tenant_id` (`tenant_id`),
  ADD KEY `idx_is_active` (`is_active`);

--
-- Indeks untuk tabel `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `username` (`username`),
  ADD KEY `idx_username` (`username`),
  ADD KEY `idx_guru_id` (`guru_id`),
  ADD KEY `idx_tenant_id` (`tenant_id`),
  ADD KEY `idx_role` (`role`);

--
-- Indeks untuk tabel `whatsapp_messages`
--
ALTER TABLE `whatsapp_messages`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_from_phone` (`from_phone`),
  ADD KEY `idx_created_at` (`created_at`),
  ADD KEY `idx_status` (`status`),
  ADD KEY `idx_parent` (`parent_id`);

--
-- Indeks untuk tabel `xendit_invoices`
--
ALTER TABLE `xendit_invoices`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_tenant_id` (`tenant_id`),
  ADD KEY `idx_student_id` (`student_id`),
  ADD KEY `idx_xendit_invoice_id` (`xendit_invoice_id`),
  ADD KEY `idx_external_id` (`external_id`),
  ADD KEY `idx_status` (`status`);

--
-- AUTO_INCREMENT untuk tabel yang dibuang
--

--
-- AUTO_INCREMENT untuk tabel `attendance_logs`
--
ALTER TABLE `attendance_logs`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `attendance_rules`
--
ALTER TABLE `attendance_rules`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `attendance_summary`
--
ALTER TABLE `attendance_summary`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `bsi_va_records`
--
ALTER TABLE `bsi_va_records`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `chat_messages`
--
ALTER TABLE `chat_messages`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `classes`
--
ALTER TABLE `classes`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `conversations`
--
ALTER TABLE `conversations`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `conversation_participants`
--
ALTER TABLE `conversation_participants`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `email_logs`
--
ALTER TABLE `email_logs`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `employment_rules`
--
ALTER TABLE `employment_rules`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `employment_status_rules`
--
ALTER TABLE `employment_status_rules`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `evaluations`
--
ALTER TABLE `evaluations`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `idcard_templates`
--
ALTER TABLE `idcard_templates`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `leave_requests`
--
ALTER TABLE `leave_requests`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `midtrans_transactions`
--
ALTER TABLE `midtrans_transactions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `mutasi_students`
--
ALTER TABLE `mutasi_students`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `pakta_integritas`
--
ALTER TABLE `pakta_integritas`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `parents`
--
ALTER TABLE `parents`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `payment_gateways`
--
ALTER TABLE `payment_gateways`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `payment_invoices`
--
ALTER TABLE `payment_invoices`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `payment_status_history`
--
ALTER TABLE `payment_status_history`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `payment_transactions`
--
ALTER TABLE `payment_transactions`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `payroll`
--
ALTER TABLE `payroll`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `qr_attendance_logs`
--
ALTER TABLE `qr_attendance_logs`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `relief_requests`
--
ALTER TABLE `relief_requests`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `scanner_devices`
--
ALTER TABLE `scanner_devices`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `sk_automation_settings`
--
ALTER TABLE `sk_automation_settings`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `sk_guru`
--
ALTER TABLE `sk_guru`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `students`
--
ALTER TABLE `students`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `tagihan_siswa`
--
ALTER TABLE `tagihan_siswa`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `teachers`
--
ALTER TABLE `teachers`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `teacher_assignments`
--
ALTER TABLE `teacher_assignments`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `teacher_attendance_stats`
--
ALTER TABLE `teacher_attendance_stats`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `tenants`
--
ALTER TABLE `tenants`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `tenant_locations`
--
ALTER TABLE `tenant_locations`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `users`
--
ALTER TABLE `users`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `whatsapp_messages`
--
ALTER TABLE `whatsapp_messages`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `xendit_invoices`
--
ALTER TABLE `xendit_invoices`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- Ketidakleluasaan untuk tabel pelimpahan (Dumped Tables)
--

--
-- Ketidakleluasaan untuk tabel `attendance_logs`
--
ALTER TABLE `attendance_logs`
  ADD CONSTRAINT `attendance_logs_ibfk_1` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `attendance_logs_ibfk_2` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`tenant_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `attendance_logs_ibfk_3` FOREIGN KEY (`rule_id`) REFERENCES `attendance_rules` (`id`) ON DELETE SET NULL;

--
-- Ketidakleluasaan untuk tabel `chat_messages`
--
ALTER TABLE `chat_messages`
  ADD CONSTRAINT `chat_messages_ibfk_1` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON DELETE CASCADE;

--
-- Ketidakleluasaan untuk tabel `classes`
--
ALTER TABLE `classes`
  ADD CONSTRAINT `fk_classes_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`tenant_id`);

--
-- Ketidakleluasaan untuk tabel `conversation_participants`
--
ALTER TABLE `conversation_participants`
  ADD CONSTRAINT `conversation_participants_ibfk_1` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON DELETE CASCADE;

--
-- Ketidakleluasaan untuk tabel `evaluations`
--
ALTER TABLE `evaluations`
  ADD CONSTRAINT `evaluations_ibfk_1` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `evaluations_ibfk_2` FOREIGN KEY (`evaluator_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Ketidakleluasaan untuk tabel `leave_requests`
--
ALTER TABLE `leave_requests`
  ADD CONSTRAINT `fk_leave_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`);

--
-- Ketidakleluasaan untuk tabel `mutasi_students`
--
ALTER TABLE `mutasi_students`
  ADD CONSTRAINT `mutasi_students_ibfk_1` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE;

--
-- Ketidakleluasaan untuk tabel `payment_settings`
--
ALTER TABLE `payment_settings`
  ADD CONSTRAINT `fk_payment_settings_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`tenant_id`) ON DELETE CASCADE;

--
-- Ketidakleluasaan untuk tabel `payment_status_history`
--
ALTER TABLE `payment_status_history`
  ADD CONSTRAINT `fk_payment_status_history_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `payment_invoices` (`id`) ON DELETE CASCADE;

--
-- Ketidakleluasaan untuk tabel `qr_attendance_logs`
--
ALTER TABLE `qr_attendance_logs`
  ADD CONSTRAINT `qr_attendance_logs_ibfk_device` FOREIGN KEY (`device_id`) REFERENCES `scanner_devices` (`device_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `qr_attendance_logs_ibfk_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE SET NULL;

--
-- Ketidakleluasaan untuk tabel `students`
--
ALTER TABLE `students`
  ADD CONSTRAINT `fk_students_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`tenant_id`),
  ADD CONSTRAINT `students_ibfk_1` FOREIGN KEY (`parent_id`) REFERENCES `parents` (`id`),
  ADD CONSTRAINT `students_ibfk_2` FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`);

--
-- Ketidakleluasaan untuk tabel `teacher_assignments`
--
ALTER TABLE `teacher_assignments`
  ADD CONSTRAINT `teacher_assignments_ibfk_1` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `teacher_assignments_ibfk_2` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`tenant_id`) ON DELETE CASCADE;

--
-- Ketidakleluasaan untuk tabel `teacher_attendance_stats`
--
ALTER TABLE `teacher_attendance_stats`
  ADD CONSTRAINT `teacher_attendance_stats_ibfk_1` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE CASCADE;

--
-- Ketidakleluasaan untuk tabel `users`
--
ALTER TABLE `users`
  ADD CONSTRAINT `users_ibfk_1` FOREIGN KEY (`guru_id`) REFERENCES `teachers` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `users_ibfk_2` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`tenant_id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
