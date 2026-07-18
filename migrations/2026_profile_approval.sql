-- Migration: Add profile approval columns to users table
-- This enables admin approval workflow for teacher profile completion

-- Add profile_approved column: 0 = pending, 1 = approved, -1 = rejected
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_approved TINYINT(1) DEFAULT 0;

-- Add profile_rejected_reason for admin to note rejection reason
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_rejected_reason TEXT DEFAULT NULL;

-- Add profile_approved_at timestamp
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_approved_at TIMESTAMP NULL DEFAULT NULL;

-- Set all existing users as approved (backward compatibility)
UPDATE users SET profile_approved = 1, profile_approved_at = NOW() WHERE is_profile_complete = 1;

-- For users with incomplete profile, keep as pending (0)
UPDATE users SET profile_approved = 0 WHERE is_profile_complete = 0;
