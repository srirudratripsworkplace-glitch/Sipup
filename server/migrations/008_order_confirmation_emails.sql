CREATE TABLE IF NOT EXISTS order_confirmation_emails (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL UNIQUE,
  message_key CHAR(36) NOT NULL UNIQUE,
  recipient VARCHAR(254) NOT NULL,
  payload JSON NOT NULL,
  status ENUM('pending','sending','sent','failed','cancelled') NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at DATETIME NULL,
  lease_token CHAR(36) NULL,
  last_error VARCHAR(100) NOT NULL DEFAULT '',
  sent_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT confirmation_emails_order_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  INDEX confirmation_emails_due_idx (status,next_attempt_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
