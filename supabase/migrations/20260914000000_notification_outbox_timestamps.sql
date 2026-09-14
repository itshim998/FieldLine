-- Migration: 20260914000000_notification_outbox_timestamps.sql
-- FieldLine: Convert notification_outbox timestamp-like columns from TEXT to TIMESTAMPTZ
-- Resolves parameter inference type mismatch on Render production PostgreSQL and provides
-- consistent native TIMESTAMPTZ semantics across all notification lifecycle timestamps.

ALTER TABLE notification_outbox
  ALTER COLUMN next_attempt_at TYPE TIMESTAMPTZ USING NULLIF(trim(next_attempt_at), '')::TIMESTAMPTZ,
  ALTER COLUMN locked_at TYPE TIMESTAMPTZ USING NULLIF(trim(locked_at), '')::TIMESTAMPTZ,
  ALTER COLUMN last_attempt_at TYPE TIMESTAMPTZ USING NULLIF(trim(last_attempt_at), '')::TIMESTAMPTZ,
  ALTER COLUMN delivered_at TYPE TIMESTAMPTZ USING NULLIF(trim(delivered_at), '')::TIMESTAMPTZ;

-- Re-assert index on (status, next_attempt_at) for efficient polling of eligible notifications
DROP INDEX IF EXISTS idx_notification_outbox_status_next_attempt;
CREATE INDEX idx_notification_outbox_status_next_attempt ON notification_outbox(status, next_attempt_at);

-- Update schema metadata version
INSERT INTO system_metadata (key, value, updated_at)
VALUES ('schema_version', '0.3.1', CURRENT_TIMESTAMP)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = CURRENT_TIMESTAMP;
