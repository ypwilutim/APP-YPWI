CREATE TABLE IF NOT EXISTS db_backups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  size BIGINT NOT NULL,
  type ENUM('sql', 'json') DEFAULT 'sql',
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);