-- WhatsApp-style Chat Schema
-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(20) DEFAULT NULL,
  is_global BOOLEAN DEFAULT FALSE,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Conversation participants (link users to conversations)
CREATE TABLE IF NOT EXISTS conversation_participants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  user_id INT NOT NULL,
  user_type ENUM('guru', 'parent') DEFAULT 'guru',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  UNIQUE KEY unique_participant (conversation_id, user_id),
  INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Chat messages (modified for conversation-based)
CREATE TABLE IF NOT EXISTS chat_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  sender_id INT NOT NULL,
  sender_name VARCHAR(100) NOT NULL,
  sender_type ENUM('guru', 'parent') DEFAULT 'guru',
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  INDEX idx_conversation (conversation_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Indexes
CREATE INDEX idx_sender ON chat_messages(sender_id);

-- Migration: add advanced chat features
-- Reply/quote messages
ALTER TABLE chat_messages ADD COLUMN reply_to_message_id INT DEFAULT NULL AFTER message;

-- Read receipts (mark as read per participant)
ALTER TABLE conversation_participants ADD COLUMN last_read_at TIMESTAMP NULL DEFAULT NULL AFTER user_type;

-- Typing status
ALTER TABLE conversation_participants ADD COLUMN is_typing TINYINT(1) DEFAULT 0 AFTER last_read_at;
ALTER TABLE conversation_participants ADD COLUMN typing_expires_at TIMESTAMP NULL DEFAULT NULL AFTER is_typing;

-- Online status / last seen
ALTER TABLE conversation_participants ADD COLUMN last_seen_at TIMESTAMP NULL DEFAULT NULL AFTER typing_expires_at;